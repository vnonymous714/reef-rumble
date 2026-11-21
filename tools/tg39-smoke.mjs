#!/usr/bin/env node
/* tg39 post-deploy smoke: exactly ONE throwaway signup, the game over the
   WebSocket (state + a few shots + wait for the server's flight push), then
   logout over HTTP (flushes the DO to D1 and must close the socket 4001).
   Prints JSON only; never prints the session token or the generated password.
   Usage: node tools/tg39-smoke.mjs https://reef-rumble-tg.ea-vnonymous.workers.dev [shots=4]
   Exports run(base, { fetch, connect }) so the same code runs locally in tests. */
import { randomBytes } from "node:crypto";
import { CLIENT_BUILD } from "../worker/src/build.js";

const board = { width: 390, height: 844, safeBottom: 34 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Node >= 22 WebSocket (undici) with an Origin header; returns a small
   {send, close, onmessage, onclose} adapter. */
export function nodeConnect(url, protocols, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { protocols, headers: { Origin: origin } });
    const a = { protocol: null, send: (m) => ws.send(m), close: () => ws.close(), onmessage: null, onclose: null };
    ws.onopen = () => { a.protocol = ws.protocol; resolve(a); };
    ws.onerror = () => reject(new Error("websocket refused"));
    ws.onmessage = (e) => a.onmessage && a.onmessage(String(e.data));
    ws.onclose = (e) => a.onclose && a.onclose(e.code);
  });
}

export async function run(base, { fetch: fetchImpl = fetch, connect = nodeConnect, shots = 4, origin = "https://vnonymous714.github.io", username } = {}) {
  let ctr = 0;
  const aid = (seq) => `${seq}_smk39${Date.now().toString(36)}${String(++ctr).padStart(4, "0")}`;
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
  if (v.clientBuild !== CLIENT_BUILD) throw new Error("Worker clientBuild is " + v.clientBuild + ", expected " + CLIENT_BUILD);
  const user = username || "rrsmk39" + Date.now().toString(36).slice(-6);
  const password = randomBytes(18).toString("base64url"); // throwaway, never printed
  const su = await call("/api/auth/signup", { username: user, password });
  const token = su.token;
  out.username = user;
  const wsUrl = base.replace(/^http/, "ws") + "/api/v2/ws";
  const sock = await connect(wsUrl, ["rr2", "rrt." + token], origin);
  out.wsProtocol = sock.protocol;
  const msgs = [], waiters = [];
  sock.onmessage = (d) => { const m = d === "pong" ? "pong" : JSON.parse(d); msgs.push(m); for (const w of [...waiters]) if (w.p(m)) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } };
  sock.onclose = (code) => { out.wsClosed = code; for (const w of waiters.splice(0)) w.r({ closed: code }); };
  const wait = (p, ms = 10000) => new Promise((r, j) => { const hit = msgs.find(p); if (hit) return r(hit); waiters.push({ p, r }); setTimeout(() => j(new Error("websocket timeout")), ms); });
  let rid = 0;
  const cmd = async (body) => { const id = ++rid; sock.send(JSON.stringify({ t: "cmd", rid: id, body })); const m = await wait((x) => x.rid === id); if (!m.ok) throw Object.assign(new Error(`ws ${body.command} -> ${m.status} ${m.error}`), { status: m.status }); return m.data; };
  out.hello = (await wait((m) => m.t === "hello")).push;
  sock.send("ping");
  out.pong = (await wait((m) => m === "pong")) === "pong";
  let s = await cmd({ command: "state", id: aid(0) });
  out.startBalance = s.balance;
  out.visibleFish = (s.world?.fishes || []).filter((f) => f.born <= s.now && f.expires > s.now && !f.dead).length;
  let fired = 0, tries = 0;
  while (fired < shots && tries++ < shots * 6) {
    await sleep(250);
    try {
      s = await cmd({ command: "launch", id: aid(s.seq), seq: s.seq, shots: [{ id: "smk39shot" + Date.now().toString(36) + ++ctr, at: Date.now() - 60, angle: -Math.PI / 2 + fired * 0.07, baseStake: 10, tier: 1, board }] });
      fired++;
      out.steps.push({ launch: fired, balance: s.balance, seq: s.seq, batched: s.runtime?.batched || 0 });
    } catch (e) {
      out.steps.push({ retry: e.message });
      if (![400, 409, 429].includes(e.status)) throw e;
      await sleep(400);
      s = await cmd({ command: "state", id: aid(0) });
    }
  }
  out.fired = fired;
  if (out.hello === "server") {
    const p = await wait((m) => m.t === "push" && m.data.seq > s.seq && !m.data.world.projectiles.length, 10000);
    s = p.data;
    out.flightPush = true;
  } else {
    await sleep(3000);
    s = await cmd({ command: "state", id: aid(s.seq), seq: s.seq });
  }
  out.servedBalance = s.balance;
  out.servedSeq = s.seq;
  out.batched = s.runtime?.batched || 0;
  await call("/api/auth/logout", {}, token); // flushes the DO to D1, closes the socket
  out.loggedOut = true;
  await wait((m) => m.closed, 5000).catch(() => null);
  try { sock.close(); } catch {}
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2], shots = Number(process.argv[3] || 4);
  if (!/^https?:\/\//.test(base || "")) { console.error("usage: node tools/tg39-smoke.mjs https://<worker> [shots]"); process.exit(2); }
  run(base.replace(/\/+$/, ""), { shots }).then((o) => { console.log(JSON.stringify(o, null, 1)); process.exit(o.wsClosed === 4001 && o.fired === shots ? 0 : 1); }, (e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
