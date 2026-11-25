// tg39: WebSocket transport hosted by the PlayerGame Durable Object.
// Unit tests for the socket layer + miniflare end-to-end (Worker + DO + D1,
// GAME_BATCH on). Local only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProtocols, rebaseBody, SocketHost, WS } from "../src/game-socket.js";
import { localV2 } from "./local-v2.mjs";

const b64url = (s) => Buffer.from(s).toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("protocol header: rr2 + token or base64url initData, nothing else", () => {
  const tok = "a".repeat(64);
  assert.deepEqual(parseProtocols("rr2, rrt." + tok), { token: tok });
  assert.deepEqual(parseProtocols("rrt." + tok + ",rr2"), { token: tok });
  assert.equal(parseProtocols("rrt." + tok), null, "rr2 required");
  assert.equal(parseProtocols("rr2, rrt.short"), null);
  assert.equal(parseProtocols("rr2, rrt." + "a".repeat(64) + "!"), null);
  const init = "query_id=AA&user=%7B%22id%22%3A5%7D&auth_date=1&hash=ff";
  assert.deepEqual(parseProtocols("rr2, rri." + b64url(init)), { initData: init });
  assert.equal(parseProtocols("rr2"), null);
  assert.equal(parseProtocols(""), null);
});

test("sequence rebase: only across server pushes since the last client command", () => {
  const pushes = new Map([[7, 8], [8, 9]]), idMap = new Map();
  const b = rebaseBody({ command: "launch", seq: 7, id: "7_abcdefgh-1234", shots: [] }, pushes, idMap);
  assert.equal(b.seq, 9);
  assert.equal(b.id, "9_abcdefgh-1234");
  assert.deepEqual(idMap.get("7_abcdefgh-1234"), { id: "9_abcdefgh-1234", seq: 9 });
  // recovery of a lost response finds the rebased receipt
  assert.deepEqual(rebaseBody({ command: "launch", seq: 7, id: "7_abcdefgh-1234", recoverOnly: true }, pushes, idMap), { command: "launch", seq: 9, id: "9_abcdefgh-1234", recoverOnly: true });
  // unknown seq, mismatched id prefix, or no pushes: untouched (server still 409s stale ones)
  const x = { command: "launch", seq: 5, id: "5_abcdefgh" };
  assert.equal(rebaseBody(x, pushes, idMap), x);
  const y = { command: "launch", seq: 7, id: "6_abcdefgh" };
  assert.equal(rebaseBody(y, pushes, idMap), y);
  assert.equal(rebaseBody(x, new Map(), idMap), x);
});

/* ---- SocketHost on a fake DO ---- */
function fakeHost({ world = {}, play } = {}) {
  let t = 1_000_000;
  const timers = [];
  const socks = [];
  const plays = [];
  let seq = 10;
  const game = {
    env: { GAME_V2: "1", DB: { prepare: () => ({ bind: () => ({ first: async () => ({ expires_at: t + 1e9 }) }) }) } },
    ctx: { getWebSockets: () => socks.filter((s) => !s.closedWith), acceptWebSocket: (ws) => socks.push(ws) },
    play: play || (async (_id, body) => {
      plays.push(body);
      if (Number.isSafeInteger(body.seq) && body.seq !== seq) return { ok: false, status: 409, error: "stale account sequence" };
      seq++;
      return { ok: true, data: { seq, now: t, balance: 1000, world: { fishes: [], projectiles: [], offers: [], director: {}, ...world } } };
    }),
  };
  const host = new SocketHost(game, { now: () => t, timers: { setTimeout: (f, d) => (timers.push({ f, at: t + d }), timers.length), clearTimeout() {} } });
  const mk = () => {
    let att = null;
    const ws = { sent: [], send(m) { this.sent.push(m); }, serializeAttachment(v) { att = structuredClone(v); }, deserializeAttachment() { return att && structuredClone(att); }, close(c) { this.closedWith = c; } };
    host.accept({ accountId: 42, tgId: null, th: "h", kind: "token" }, [{}, ws]);
    return ws;
  };
  const advance = async (ms) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const n = timers[0];
      if (!n || n.at > end) break;
      timers.shift();
      t = n.at;
      await n.f();
      await host.chain;
    }
    t = end;
  };
  return { host, mk, advance, plays, socks, now: () => t, setSeq: (s) => (seq = s), getSeq: () => seq };
}
const cmd = (ws, host, rid, body) => host.message(ws, JSON.stringify({ t: "cmd", rid, body }));
const pushesOf = (ws) => ws.sent.map((m) => JSON.parse(m)).filter((m) => m.t === "push");

test("server push follows the tg38 schedule: 3 s steps, stops when hidden and after 2 min without input", async () => {
  const { host, mk, advance } = fakeHost();
  const ws = mk();
  await cmd(ws, host, 1, { command: "state", id: "0_bootbootboot" });
  await advance(9500);
  assert.equal(pushesOf(ws).length, 3, "3 s idle step");
  await host.message(ws, JSON.stringify({ t: "hint", hidden: true }));
  const n = pushesOf(ws).length;
  await advance(60000);
  assert.equal(pushesOf(ws).length, n, "nothing while hidden");
  await host.message(ws, JSON.stringify({ t: "hint", hidden: false }));
  await advance(10);
  assert.equal(pushesOf(ws).length, n + 1, "one push right when shown");
  await advance(200000);
  const m = pushesOf(ws).length;
  await advance(120000);
  assert.equal(pushesOf(ws).length, m, "no pushes after 2 min without input");
  await host.message(ws, JSON.stringify({ t: "hint", input: 1 }));
  await advance(10);
  assert.equal(pushesOf(ws).length, m + 1, "input after inactivity pushes at once");
});

test("a client command formed before a server push is rebased (no 409), others still 409", async () => {
  const { host, mk, advance, getSeq } = fakeHost();
  const ws = mk();
  await cmd(ws, host, 1, { command: "state", id: "0_bootbootboot" });
  const seenSeq = getSeq();
  await advance(3100); // one push lands; the client has not applied it yet
  assert.equal(pushesOf(ws).length, 1);
  await cmd(ws, host, 2, { command: "launch", seq: seenSeq, id: `${seenSeq}_tapnonce1`, shots: [] });
  await host.chain;
  const res = ws.sent.map((m) => JSON.parse(m)).find((m) => m.rid === 2);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(host.stats.rebased, 1);
  // after a client command the push chain is cleared: an older seq is stale
  await cmd(ws, host, 3, { command: "launch", seq: seenSeq, id: `${seenSeq}_tapnonce2`, shots: [] });
  await host.chain;
  const r3 = ws.sent.map((m) => JSON.parse(m)).find((m) => m.rid === 3);
  assert.equal(r3.ok, false);
  assert.equal(r3.status, 409);
});

test("holding fire: no pushes while launches stream in; release gets the flight push", async () => {
  const { host, mk, advance } = fakeHost();
  const ws = mk();
  await cmd(ws, host, 1, { command: "state", id: "0_bootbootboot" });
  let rid = 2;
  for (let i = 0; i < 20; i++) { await cmd(ws, host, rid++, { command: "launch", seq: host.seq, id: `${host.seq}_holdnonce${i}`, shots: [] }); await host.chain; await advance(200); }
  assert.equal(pushesOf(ws).length, 0, "launch responses carry state");
  await host.message(ws, JSON.stringify({ t: "hint", rel: 1 }));
  await advance(3100);
  assert.ok(pushesOf(ws).length >= 1);
});

test("tab shows a bonus/daily screen (paused hint): no pushes until unpaused; maintenance, attack and bad bodies refused like HTTP", async () => {
  const { host, mk, advance } = fakeHost({ world: { pausedAt: 1 } });
  const ws = mk();
  await cmd(ws, host, 1, { command: "state", id: "0_bootbootboot" });
  await host.message(ws, JSON.stringify({ t: "hint", paused: true }));
  await advance(30000);
  assert.equal(pushesOf(ws).length, 0);
  await host.message(ws, JSON.stringify({ t: "hint", paused: false }));
  await advance(10);
  assert.equal(pushesOf(ws).length, 1, "unpaused: push at once (world pause alone does not stop the tg38 schedule)");
  await cmd(ws, host, 2, { command: "attack", id: "1_xxxxxxxxxx" });
  host.g.env.GAME_MAINTENANCE = "1";
  await cmd(ws, host, 3, { command: "state", id: "1_xxxxxxxxxy" });
  delete host.g.env.GAME_MAINTENANCE;
  await cmd(ws, host, 4, [1, 2]);
  await host.chain;
  const r = Object.fromEntries(ws.sent.map((m) => JSON.parse(m)).filter((m) => m.t === "res").map((m) => [m.rid, m]));
  assert.equal(r[2].status, 400);
  assert.equal(r[3].status, 503);
  assert.equal(r[4].status, 400);
  await host.message(ws, "x".repeat(WS.MAX_MSG + 1));
  assert.equal(ws.closedWith, 1009);
});

test("sessions: re-checked every 5 min (ended session closes 4001), 60 min max age (4002)", async () => {
  const f = fakeHost();
  const ws = f.mk();
  let gone = false;
  f.host.g.env.DB = { prepare: () => ({ bind: () => ({ first: async () => (gone ? null : { expires_at: f.now() + 1e9 }) }) }) };
  await f.advance(WS.REVALIDATE_MS + 1);
  gone = true;
  await cmd(ws, f.host, 1, { command: "state", id: "0_bootbootboot" });
  assert.equal(ws.closedWith, 4001);
  const ws2 = f.mk();
  await f.advance(WS.MAX_AGE_MS + 1);
  await cmd(ws2, f.host, 1, { command: "state", id: "0_bootbootboot" });
  assert.equal(ws2.closedWith, 4002);
});

test("GAME_WS_PUSH=client: hello says so, the object sets no push timers (can hibernate)", async () => {
  const f = fakeHost();
  f.host.g.env.GAME_WS_PUSH = "client";
  const ws = f.mk();
  assert.deepEqual(JSON.parse(ws.sent[0]), { t: "hello", push: "client" });
  await cmd(ws, f.host, 1, { command: "state", id: "0_bootbootboot" });
  await f.advance(60000);
  assert.equal(pushesOf(ws).length, 0);
  assert.equal(f.host.timer, 0);
  const f2 = fakeHost();
  assert.deepEqual(JSON.parse(f2.mk().sent[0]), { t: "hello", push: "server" });
});

/* ---- end to end on miniflare: Worker upgrade -> DO hibernation socket -> D1 ---- */
const ORIGIN = "http://localhost:8089";
async function signup(mf) {
  const r = await mf.dispatchFetch("http://localhost/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2", Origin: ORIGIN }, body: JSON.stringify({ username: "ws39" + Date.now().toString(36).slice(-6), password: "local-only-" + Math.random().toString(36).slice(2) }) });
  return r.json();
}
async function connect(mf, protocols, origin = ORIGIN) {
  const res = await mf.dispatchFetch("http://localhost/api/v2/ws", { headers: { Upgrade: "websocket", Origin: origin, "Sec-WebSocket-Protocol": protocols } });
  if (res.status !== 101) return { status: res.status };
  const ws = res.webSocket;
  const msgs = [], waiters = [];
  ws.addEventListener("message", (e) => { const m = e.data === "pong" ? "pong" : JSON.parse(e.data); msgs.push(m); for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } });
  ws.addEventListener("close", (e) => { ws.closeCode = e.code; for (const w of waiters.splice(0)) w.res({ closed: e.code }); });
  ws.accept();
  let rid = 0;
  const wait = (pred, ms = 8000) => new Promise((res, rej) => { const hit = msgs.find(pred); if (hit) return res(hit); const w = { pred, res }; waiters.push(w); setTimeout(() => rej(new Error("timeout waiting")), ms); });
  const call = async (body) => { const id = ++rid; ws.send(JSON.stringify({ t: "cmd", rid: id, body })); return wait((m) => m.rid === id); };
  return { status: 101, ws, msgs, wait, call, protocol: res.headers.get("Sec-WebSocket-Protocol") };
}
const board = { width: 390, height: 844, safeBottom: 34 };

test("e2e: upgrade auth, commands over the socket use the same validation, flight push settles shots, logout closes", async () => {
  const { mf, db } = await localV2({ gameDoMode: "on", bindings: { GAME_BATCH: "on", GAME_DO_HINT: "enam" } });
  try {
    await db.prepare("INSERT INTO accounts(id,public_id,pid,tg_id,balance,bonus,pt,sync_seq,created_at,last_seen) VALUES(1,'RR-000001','pid_owner',7313143643,127222,10000,0,75,0,0)").run();
    const su = await signup(mf);
    assert.ok(su.token);
    assert.equal((await connect(mf, "rr2, rrt." + "b".repeat(64))).status, 401, "unknown session");
    assert.equal((await connect(mf, "rr2, rrt." + su.token, "https://evil.example")).status, 403, "foreign origin");
    assert.equal((await connect(mf, "rrt." + su.token)).status, 400, "rr2 required");
    const c = await connect(mf, "rr2, rrt." + su.token);
    assert.equal(c.status, 101);
    assert.equal(c.protocol, "rr2");
    c.ws.send("ping");
    assert.equal(await c.wait((m) => m === "pong"), "pong");
    let r = await c.call({ command: "state", id: "0_e2eboot0001" });
    assert.equal(r.ok, true, JSON.stringify(r));
    let s = r.data;
    const start = s.balance;
    // Same server-side validation as HTTP: over-max stake, attack, bad id.
    r = await c.call({ command: "launch", id: `${s.seq}_e2ebig00001`, seq: s.seq, shots: [{ id: "e2ebigshot" + Date.now(), at: Date.now() - 60, angle: -Math.PI / 2, baseStake: 501, tier: 1, board }] });
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300)); assert.equal(r.status, 400, JSON.stringify(r));
    if (r.ok === false) { const st = await c.call({ command: "state", id: "0_e2eresync01" }); s = st.data; }
    r = await c.call({ command: "attack", id: `${s.seq}_e2eatk00001`, seq: s.seq });
    assert.equal(r.status, 400);
    r = await c.call({ command: "launch", id: "bad id!", seq: s.seq, shots: [{ id: "e2ebadid" + Date.now(), at: Date.now() - 60, angle: -1.5, baseStake: 10, tier: 1, board }] });
    assert.equal(r.ok, false, "invalid action id refused");
    s = (await c.call({ command: "state", id: "0_e2eresync02" })).data;
    // Two real shots over the socket.
    let fired = 0;
    for (let i = 0; i < 6 && fired < 2; i++) {
      await sleep(250);
      r = await c.call({ command: "launch", id: `${s.seq}_e2eshot${i}aaaa`, seq: s.seq, shots: [{ id: "e2eshot" + i + Date.now().toString(36), at: Date.now() - 60, angle: -Math.PI / 2 + i * 0.07, baseStake: 10, tier: 1, board }] });
      if (r.ok) { fired++; s = r.data; } else s = (await c.call({ command: "state", id: "0_e2eresync1" + i })).data;
    }
    assert.equal(fired, 2);
    assert.ok(s.world.projectiles.length >= 1, "shots in flight");
    // No client poll: the DO pushes the settled world when the shots land.
    const settled = await c.wait((m) => m.t === "push" && m.data.world.projectiles.length === 0, 10000);
    assert.ok(settled.data.seq > s.seq);
    s = settled.data;
    // Logout over HTTP flushes the DO to D1 and closes this session's socket.
    const lo = await mf.dispatchFetch("http://localhost/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2", Origin: ORIGIN, Authorization: "Bearer " + su.token }, body: "{}" });
    assert.equal(lo.status, 200);
    const closed = await c.wait((m) => m.closed, 5000).catch(() => null);
    assert.equal(closed && closed.closed, 4001);
    const a = await db.prepare("SELECT a.balance,a.sync_seq,(SELECT COALESCE(SUM(n),0) FROM economy_ledger l WHERE l.account_id=a.id) bullets,(SELECT COALESCE(SUM(payout-wager+external_delta+promo_credit),0) FROM economy_ledger l WHERE l.account_id=a.id) delta FROM accounts a WHERE a.username=?").bind(su.username).first();
    assert.equal(a.balance, s.balance, "D1 == last pushed balance");
    assert.equal(a.sync_seq, s.seq);
    assert.equal(a.balance, start + a.delta, "ledger reconciles");
    assert.ok(a.bullets >= 2);
    assert.equal((await connect(mf, "rr2, rrt." + su.token)).status, 401, "logged-out token cannot reconnect");
    const owner = await db.prepare("SELECT balance,bonus,sync_seq FROM accounts WHERE id=1").first();
    assert.deepEqual(owner, { balance: 127222, bonus: 10000, sync_seq: 75 }, "protected account untouched");
  } finally { await mf.dispose(); }
});

test("e2e: GAME_WS=off or maintenance refuses the upgrade (client stays on HTTP)", async () => {
  const { mf } = await localV2({ gameDoMode: "on", bindings: { GAME_BATCH: "on", GAME_WS: "off" } });
  try {
    const su = await signup(mf);
    assert.equal((await connect(mf, "rr2, rrt." + su.token)).status, 404);
    const r = await mf.dispatchFetch("http://localhost/api/v2/game", { method: "POST", headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2", Origin: ORIGIN, Authorization: "Bearer " + su.token }, body: JSON.stringify({ command: "state", id: "0_httpstill01" }) });
    assert.equal(r.status, 200, "HTTP game path unchanged");
  } finally { await mf.dispose(); }
  const m2 = await localV2({ gameDoMode: "on", bindings: { GAME_BATCH: "on", GAME_MAINTENANCE: "1" } });
  try {
    const su = await signup(m2.mf);
    assert.equal((await connect(m2.mf, "rr2, rrt." + su.token)).status, 503);
  } finally { await m2.mf.dispose(); }
});

test("tg39 smoke script (tools/tg39-smoke.mjs) end to end on miniflare: socket shots, flight push, logout 4001, D1 exact", async () => {
  const { run } = await import("../../tools/tg39-smoke.mjs");
  const { mf, db } = await localV2({ gameDoMode: "on", bindings: { GAME_BATCH: "on", GAME_DO_HINT: "enam" } });
  try {
    await db.prepare("INSERT INTO accounts(id,public_id,pid,tg_id,balance,bonus,pt,sync_seq,created_at,last_seen) VALUES(1,'RR-000001','pid_owner',7313143643,127222,10000,0,75,0,0)").run();
    const connect = async (url, protocols, origin) => {
      const res = await mf.dispatchFetch(url.replace(/^ws/, "http"), { headers: { Upgrade: "websocket", Origin: origin, "Sec-WebSocket-Protocol": protocols.join(", ") } });
      if (res.status !== 101) throw new Error("refused " + res.status);
      const ws = res.webSocket, a = { protocol: res.headers.get("Sec-WebSocket-Protocol"), send: (m) => ws.send(m), close: () => ws.close(), onmessage: null, onclose: null };
      ws.addEventListener("message", (e) => a.onmessage && a.onmessage(e.data));
      ws.addEventListener("close", (e) => a.onclose && a.onclose(e.code));
      ws.accept();
      return a;
    };
    const out = await run("http://localhost", { fetch: (u, i) => mf.dispatchFetch(u, i), connect, shots: 4, origin: ORIGIN });
    assert.equal(out.clientBuild, "tg40");
    assert.equal(out.wsProtocol, "rr2");
    assert.equal(out.hello, "server");
    assert.equal(out.pong, true);
    assert.equal(out.fired, 4);
    assert.equal(out.flightPush, true);
    assert.equal(out.wsClosed, 4001);
    const a = await db.prepare("SELECT a.balance,a.sync_seq,(SELECT COALESCE(SUM(n),0) FROM economy_ledger l WHERE l.account_id=a.id) bullets,(SELECT COALESCE(SUM(payout-wager+external_delta+promo_credit),0) FROM economy_ledger l WHERE l.account_id=a.id) delta FROM accounts a WHERE a.username=?").bind(out.username).first();
    assert.equal(a.balance, out.servedBalance);
    assert.equal(a.sync_seq, out.servedSeq);
    assert.equal(a.balance, out.startBalance + a.delta);
    assert.ok(a.bullets >= 4);
    assert.deepEqual(await db.prepare("SELECT balance,bonus,sync_seq FROM accounts WHERE id=1").first(), { balance: 127222, bonus: 10000, sync_seq: 75 });
  } finally { await mf.dispose(); }
});
