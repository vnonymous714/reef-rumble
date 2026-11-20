#!/usr/bin/env node
/* tg37 post-deploy smoke: exactly ONE throwaway signup + a few shots + logout
   (logout flushes the PlayerGame DO to D1). Prints JSON only; never prints the
   session token or the generated password.
   Usage: node tools/tg37-smoke.mjs https://reef-rumble-tg.ea-vnonymous.workers.dev [shots=4]
   Exports run(base, fetch) so the same code is exercised locally in tests. */
import { randomBytes } from "node:crypto";

const board = { width: 390, height: 844, safeBottom: 34 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(base, fetchImpl = fetch, { shots = 4, origin = "https://vnonymous714.github.io", username } = {}) {
  let ctr = 0;
  const aid = (seq) => `${seq}_smk37${Date.now().toString(36)}${String(++ctr).padStart(4, "0")}`;
  const call = async (path, body, token) => {
    const r = await fetchImpl(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2", Origin: origin, ...(token ? { Authorization: "Bearer " + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const j = await r.json().catch(() => null);
    if (r.status !== 200) throw Object.assign(new Error(`${path} -> ${r.status} ${j && j.error}`), { status: r.status });
    return j;
  };
  const out = { base, steps: [] };
  const v = await call("/api/client-version");
  out.clientBuild = v.clientBuild;
  if (v.clientBuild !== "tg37") throw new Error("Worker clientBuild is " + v.clientBuild + ", expected tg37");
  const user = username || "rrsmk37" + Date.now().toString(36).slice(-6);
  const password = randomBytes(18).toString("base64url"); // throwaway, never printed
  const su = await call("/api/auth/signup", { username: user, password });
  const token = su.token;
  out.username = user; out.publicId = su.public_id || su.publicId || null;
  let s = await call("/api/v2/game", { command: "state", id: aid(0) }, token);
  out.startBalance = s.balance;
  let fired = 0, tries = 0;
  while (fired < shots && tries++ < shots * 6) {
    await sleep(250);
    try {
      s = await call("/api/v2/game", { command: "launch", id: aid(s.seq), seq: s.seq, shots: [{ id: "smk37shot" + Date.now().toString(36) + ++ctr, at: Date.now() - 60, angle: -Math.PI / 2 + fired * 0.07, baseStake: 10, tier: 1, board }] }, token);
      fired++;
      out.steps.push({ launch: fired, balance: s.balance, seq: s.seq, batched: s.runtime?.batched || 0 });
    } catch (e) {
      out.steps.push({ retry: e.message });
      if (![400, 409, 429].includes(e.status)) throw e;
      await sleep(400);
      s = await call("/api/v2/game", { command: "state", id: aid(0) }, token);
    }
  }
  await sleep(3000); // let flights land
  s = await call("/api/v2/game", { command: "state", id: aid(s.seq), seq: s.seq }, token);
  out.fired = fired;
  out.servedBalance = s.balance;
  out.servedSeq = s.seq;
  out.batched = s.runtime?.batched || 0;
  await call("/api/auth/logout", {}, token); // flushes the DO to D1
  out.loggedOut = true;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = (process.argv[2] || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) { console.error("usage: node tools/tg37-smoke.mjs https://<worker> [shots]"); process.exit(2); }
  run(base, fetch, { shots: Number(process.argv[3] || 4) })
    .then((o) => { console.log(JSON.stringify(o)); })
    .catch((e) => { console.error("SMOKE FAILED:", e.message); process.exit(1); });
}
