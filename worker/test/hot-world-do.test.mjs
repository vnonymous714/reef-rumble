import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { localV2 } from "./local-v2.mjs";
import { HotWorld, gameDoEnabled } from "../src/hot-world.js";
import { gameV2 } from "../src/game-v2.js";

const board = { width: 390, height: 844, safeBottom: 34 };
const T0 = Date.UTC(2026, 10, 14, 20, 0, 0);
let ctr = 0;
const aid = (seq) => `${seq}_hotworld${String(++ctr).padStart(8, "0")}`;
function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0));
}
async function seedAccount(db, id = 7, username = "dosmokeeq", balance = 50000) {
  await db
    .prepare("INSERT INTO accounts(id,public_id,pid,username,balance,bonus,pt,created_at,last_seen) VALUES(?1,?2,?3,?4,?5,0,0,0,0)")
    .bind(id, "RR-HOT" + id, "pid_hot" + id, username, balance)
    .run();
}
function shots(n, at, stake = 10, angle = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => ({ id: `shot${String(++ctr).padStart(10, "0")}`, at: at + i * 165, angle: angle + i * 0.05, baseStake: stake, tier: 1, board }));
}
// Count every real D1 round trip (prepare().first/run/all/raw and batch).
function counted(db) {
  const c = { n: 0 };
  const wrap = (s) => new Proxy(s, { get(t, k) { const v = t[k];
    if (k === "bind") return (...a) => wrap(v.apply(t, a));
    if (["first", "run", "all", "raw"].includes(k)) return (...a) => { c.n++; return v.apply(t, a); };
    return typeof v === "function" ? v.bind(t) : v; } });
  const proxy = new Proxy(db, { get(t, k) { const v = t[k];
    if (k === "prepare") return (q) => wrap(v.call(t, q));
    if (k === "batch") return (ops) => { c.n++; return v.call(t, ops.map((o) => o.__real || o)); };
    return typeof v === "function" ? v.bind(t) : v; } });
  return { proxy, c };
}
async function ledgerCheck(db, id) {
  const a = await db.prepare("SELECT balance FROM accounts WHERE id=?").bind(id).first();
  const l = await db.prepare("SELECT COALESCE(SUM(payout-wager),0) d, COUNT(*) n FROM economy_ledger WHERE account_id=?").bind(id).first();
  const open = await db.prepare("SELECT COUNT(*) n FROM economy_actions WHERE account_id=? AND status<>'settled'").bind(id).first();
  return { balance: a.balance, ledger: 50000 + l.d, rows: l.n, pending: open.n };
}
const strip = (r) => { const { runtime, ...rest } = r; return rest; };
async function tables(db, id) {
  const q = (sql) => db.prepare(sql).bind(id).all().then((r) => r.results);
  const r = {
    a: await q("SELECT balance,bonus,pt,sync_seq,last_daily,w_xp FROM accounts WHERE id=?"),
    w: await q("SELECT state_json,version FROM economy_world WHERE account_id=?"),
    l: await q("SELECT action_id,kind,wager,payout,balance_after,wager_refund,account_seq FROM economy_ledger WHERE account_id=? ORDER BY id"),
    e: await q("SELECT id,status,wager,payout,request_json FROM economy_actions WHERE account_id=? ORDER BY id"),
  };
  // Server-minted tick ids are random UUIDs; everything else must match exactly.
  return JSON.parse(JSON.stringify(r).replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "_uuid"));
}
// A deterministic session: bootstrap, ticks, batched launches with flights in
// air, a daily claim, and a failing launch (unaffordable) that must commit
// only its tick.
async function session(play) {
  ctr = 0;
  const out = [];
  let now = T0;
  let s = await play({ command: "state", id: aid(0) }, now);
  out.push(s);
  for (let k = 0; k < 14; k++) {
    now += 700;
    const body = k % 4 === 3
      ? { command: "state", id: aid(s.seq), seq: s.seq }
      : { command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1 + (k % 4) * 2, now - 600, k === 9 ? 600 : 10) };
    try { s = await play(body, now); out.push(s); }
    catch (e) {
      out.push({ error: e.message, status: e.status });
      const cur = await play({ command: "state", id: aid(0) }, now + 1);
      s = await play({ command: "state", id: aid(cur.seq), seq: cur.seq }, now + 2);
      out.push(s);
    }
  }
  now += 4000;
  s = await play({ command: "state", id: aid(s.seq), seq: s.seq }, now);
  out.push(s);
  return out;
}

test("preview flag: throwaway QA usernames only, never the owner or any TG account", () => {
  const env = { GAME_DO_MODE: "preview", PLAYER_GAME: {} };
  assert.equal(gameDoEnabled(env, { id: 1, tg_id: 7313143643 }), false);
  assert.equal(gameDoEnabled(env, { id: 1, tg_id: null, username: "dosmoke1" }), false);
  assert.equal(gameDoEnabled(env, { id: 9, tg_id: 7313143643, username: "dosmoke1" }), false);
  assert.equal(gameDoEnabled(env, { id: 9, tg_id: 555, username: "dosmoke1" }), false);
  assert.equal(gameDoEnabled(env, { id: 9, tg_id: null, username: "rickyweb" }), false);
  assert.equal(gameDoEnabled(env, { id: 9, tg_id: null, username: "dosmokeabc" }), true);
  assert.equal(gameDoEnabled({ GAME_DO_MODE: "off", PLAYER_GAME: {} }, { id: 9, username: "dosmokeabc" }), false);
  assert.equal(gameDoEnabled({ GAME_DO_MODE: "on" }, { id: 9, username: "dosmokeabc" }), false);
  assert.equal(gameDoEnabled({ GAME_DO_MODE: "on", PLAYER_GAME: {} }, { id: 1, tg_id: 7313143643 }), true);
});

test("hot world is byte-identical to direct Game V2 (responses + D1 rows) and needs 1 D1 round trip per launch", async () => {
  const A = await localV2(), B = await localV2();
  try {
    await seedAccount(A.db); await seedAccount(B.db);
    const direct = await session((body, now) => gameV2({ DB: A.db, GAME_V2: "1" }, 7, body, now, seeded(now)));
    const { proxy, c } = counted(B.db);
    const hot = new HotWorld({ DB: proxy, GAME_V2: "1" }, 7);
    const trips = [];
    const viaHot = await session(async (body, now) => {
      const before = c.n;
      try { return await hot.play(body, { now, rng: seeded(now) }); }
      finally { trips.push([body.command, c.n - before]); }
    });
    assert.deepEqual(viaHot.map((r) => (r.error ? r : strip(r))), direct.map((r) => (r.error ? r : strip(r))));
    assert.deepEqual(await tables(B.db, 7), await tables(A.db, 7));
    assert.ok(direct.some((r) => r.error), "session exercised a rejected launch");
    // After the first (cache-loading) request, every successful launch is one batch.
    const launches = trips.slice(1).filter(([cmd]) => cmd === "launch");
    assert.ok(launches.length >= 8);
    const ok = launches.filter(([, n]) => n === 1).length;
    assert.ok(ok >= launches.length - 2, JSON.stringify(trips));
    assert.deepEqual(await ledgerCheck(B.db, 7), { ...(await ledgerCheck(B.db, 7)), pending: 0 });
    const lc = await ledgerCheck(B.db, 7);
    assert.equal(lc.balance, lc.ledger);
  } finally { await A.mf.dispose(); await B.mf.dispose(); }
});

test("consistency/load: concurrent batches, a rival writer, external credit, eviction, replay; D1 ledger exact", async () => {
  const { mf, db } = await localV2();
  try {
    await seedAccount(db, 8, "dosmokeload");
    const env = { DB: db, GAME_V2: "1" };
    const hot = new HotWorld(env, 8);
    let now = Date.now();
    let s = await hot.play({ command: "state", id: aid(0) }, { now });
    const acked = [];
    let dupes = 0;
    const fresh = async () => {
      const r = await hot.play({ command: "state", id: aid(0) }, { now: Date.now() });
      if (r.seq >= s.seq) s = r;
    };
    // A device loop: sequential launches; every launch is also re-sent
    // concurrently (network retry) and must settle once with one receipt.
    const device = async (n, k0 = 0) => {
      for (let k = 0; k < n; k++) {
        for (let tries = 0; tries < 12; tries++) {
          await new Promise((r) => setTimeout(r, 25 + ((k0 + k) % 3) * 20));
          const t = Date.now(), seq = s.seq;
          const body = { command: "launch", id: aid(seq), seq, shots: shots(1 + ((k0 + k) % 3), t - 330 - ((k0 + k) % 3) * 165) };
          const [x, y] = await Promise.allSettled([hot.play(body, { now: t }), hot.play(body, { now: t + 5 })]);
          if (x.status === "fulfilled") {
            if (y.status === "fulfilled") { assert.equal(y.value.settled.balance, x.value.settled.balance); assert.equal(y.value.replayed, true); dupes++; }
            if (x.value.seq > s.seq) s = x.value;
            acked.push(body.id);
            break;
          }
          if (![409, 429, 400].includes(x.reason.status)) throw x.reason;
          await fresh();
        }
      }
    };
    // 1) Three devices playing concurrently on one account.
    await Promise.all([device(10, 0), device(10, 1), device(10, 2)]);
    // 2) A rival writer (old non-DO Worker path) commits behind the cache.
    const cur = await db.prepare("SELECT sync_seq FROM accounts WHERE id=8").first();
    s = await gameV2(env, 8, { command: "state", id: aid(cur.sync_seq), seq: cur.sync_seq }, Date.now());
    await device(5);
    // 3) External credit (Stars purchase) changes the account behind the cache.
    await db.prepare("UPDATE accounts SET balance=balance+1000,sync_seq=sync_seq+1 WHERE id=8").run();
    await db.prepare("INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at) SELECT 8,'stars-test','purchase',0,1000,balance,0 FROM accounts WHERE id=8").run();
    await device(5);
    // 4) Eviction mid-session (DO restart), then two devices again.
    hot.evict();
    await Promise.all([device(5, 1), device(5, 2)]);
    // 5) A second DO instance for the same account (split brain) racing.
    const hot2 = new HotWorld(env, 8);
    await Promise.all([device(5), (async () => { for (let i = 0; i < 5; i++) { const c = await db.prepare("SELECT sync_seq FROM accounts WHERE id=8").first(); await hot2.play({ command: "state", id: aid(c.sync_seq), seq: c.sync_seq }, { now: Date.now() }).catch(() => null); await new Promise((r) => setTimeout(r, 60)); } })()]);
    // 6) Idempotent replay of an acked action: no second charge.
    const before = await ledgerCheck(db, 8);
    const { sync_seq: seq } = await db.prepare("SELECT sync_seq FROM accounts WHERE id=8").first();
    const body = { command: "launch", id: aid(seq), seq, shots: shots(2, Date.now() - 300) };
    await new Promise((r) => setTimeout(r, 400));
    const r1 = await hot.play(body, { now: Date.now() });
    const r2 = await hot.play(body, { now: Date.now() });
    assert.equal(r2.replayed, true);
    assert.equal(r2.settled.balance, r1.settled.balance);
    const after = await ledgerCheck(db, 8);
    assert.equal(after.rows - before.rows, (await db.prepare("SELECT COUNT(*) n FROM economy_ledger WHERE account_id=8 AND (action_id=?1 OR action_id LIKE ?1||':%')").bind(body.id).first()).n);
    await new Promise((r) => setTimeout(r, 400));
    // Settle everything in flight, then reconcile.
    await new Promise((r) => setTimeout(r, 3200));
    const fin = await hot.play({ command: "state", id: aid(r1.seq), seq: r1.seq }, { now: Date.now() });
    const lc = await ledgerCheck(db, 8);
    assert.equal(lc.pending, 0);
    assert.equal(lc.balance, lc.ledger, JSON.stringify(lc));
    assert.equal(fin.balance, lc.balance);
    for (const id of acked) assert.ok(await db.prepare("SELECT 1 FROM economy_actions WHERE account_id=8 AND id=? AND status='settled'").bind(id).first(), "every acked action is in D1");
    assert.ok(acked.length >= 40, "load test acked " + acked.length);
    assert.ok(dupes >= 20, "duplicate submits replayed " + dupes);
    assert.ok(hot.stats.invalidations >= 1);
  } finally { await mf.dispose(); }
});

function tgData(userId) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: "Local fixture" }) });
  const text = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const key = createHmac("sha256", "WebAppData").update("local-testing-fixture-not-a-real-bot-token").digest();
  fields.set("hash", createHmac("sha256", key).update(text).digest("hex"));
  return fields.toString();
}
async function httpSession(mf, auth, n = 10) {
  const post = async (body) => {
    const r = await mf.dispatchFetch("http://localhost/api/v2/game", { method: "POST", headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2", ...auth.headers }, body: JSON.stringify({ ...body, ...auth.body }) });
    const j = await r.json();
    if (r.status !== 200) throw Object.assign(new Error(j.error + " " + JSON.stringify(auth.body).slice(0, 20) + " bal=" + out.at(-1)?.balance), { status: r.status });
    return j;
  };
  const out = [];
  let s = await post({ command: "state", id: aid(0) });
  out.push(s);
  for (let k = 0; k < n; k++) {
    await new Promise((r) => setTimeout(r, 200));
    s = await post({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1, Date.now() - 100) });
    out.push(s);
  }
  return out;
}

test("Worker routing: preview sends only dosmoke web accounts to the DO; 'on' sends Telegram via the cached fast path; D1 exact", async () => {
  for (const mode of ["preview", "on"]) {
    const { mf, db } = await localV2({ gameDoMode: mode });
    try {
      // Account 1 is reserved like the owner's; QA accounts start at 2.
      await db.prepare("INSERT INTO accounts(id,public_id,pid,username,balance,bonus,pt,created_at,last_seen) VALUES(1,'RR-000001','pid_one','ownerweb',50000,0,0,0,0)").run();
      await db.prepare("INSERT INTO accounts(id,public_id,pid,tg_id,balance,bonus,pt,created_at,last_seen) VALUES(50,'RR-000050','pid_tg50',424242,5000,0,0,0,0)").run();
      const su = async (username) => {
        const r = await mf.dispatchFetch("http://localhost/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2" }, body: JSON.stringify({ username, password: "Local-Test-Only-9000" }) });
        return (await r.json()).token;
      };
      const smoke = await httpSession(mf, { headers: { Authorization: "Bearer " + (await su("dosmokehttp")) }, body: {} });
      assert.ok(smoke.every((r) => r.runtime?.do === 1), mode + " dosmoke via DO " + JSON.stringify(smoke[1]).slice(0, 300) + JSON.stringify((await db.prepare("SELECT id,username,tg_id FROM accounts").all()).results));
      const plain = await httpSession(mf, { headers: { Authorization: "Bearer " + (await su("plainplayer")) }, body: {} }, 3);
      assert.equal(plain.some((r) => r.runtime?.do === 1), mode === "on", mode + " plain web");
      const tg = await httpSession(mf, { headers: {}, body: { initData: tgData(424242) } }, 6);
      assert.equal(tg.slice(1).every((r) => r.runtime?.do === 1), mode === "on", mode + " telegram");
      assert.equal(tg.some((r) => r.runtime?.do === 1), mode === "on");
      for (const row of (await db.prepare("SELECT id,balance FROM accounts WHERE id>1").all()).results) {
        const last = await db.prepare("SELECT balance_after FROM economy_ledger WHERE account_id=? ORDER BY id DESC LIMIT 1").bind(row.id).first();
        const open = await db.prepare("SELECT COUNT(*) n FROM economy_actions WHERE account_id=? AND status<>'settled'").bind(row.id).first();
        assert.equal(open.n, 0);
        if (last) assert.equal(last.balance_after, row.balance, JSON.stringify(row));
      }
    } finally { await mf.dispose(); }
  }
});
