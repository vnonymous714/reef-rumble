// tg37 batched writes: the PlayerGame DO is the authority between flushes,
// journals every money action in its own SQLite row before acking, and
// flushes D1 in aggregate. These tests prove: same results as write-through,
// exact accounting, no credit lost or doubled on eviction / ambiguous flush /
// external credit, fail-closed when no durable store is available, and the
// D1 row budget (>=10x fewer rows written per 100 shots).
import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { HotWorld } from "../src/hot-world.js";
import { BatchedWorld, addPending, pendingMinus } from "../src/batched-world.js";
import { gameV2 } from "../src/game-v2.js";

const board = { width: 390, height: 844, safeBottom: 34 };
const T0 = Date.UTC(2026, 10, 20, 20, 0, 0);
let ctr = 0;
const aid = (seq) => `${seq}_batched${String(++ctr).padStart(8, "0")}`;
function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0));
}
async function seedAccount(db, id = 7, balance = 50000, tg = null) {
  await db.prepare("INSERT INTO accounts(id,public_id,pid,username,tg_id,balance,bonus,pt,created_at,last_seen) VALUES(?1,?2,?3,?4,?5,?6,0,0,0,0)")
    .bind(id, "RR-B" + id, "pid_b" + id, "bqa" + id, tg, balance).run();
  if (tg) await db.prepare("INSERT INTO players(tg_id,pid,balance,created_at,last_seen) VALUES(?1,?2,?3,0,0)").bind(tg, "tpid" + id, balance).run();
}
function shots(n, at, stake = 10, angle = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => ({ id: `shot${String(++ctr).padStart(10, "0")}`, at: at + i * 165, angle: angle + i * 0.05, baseStake: stake, tier: 1, board }));
}
export function fakeStorage() {
  const m = new Map();
  const st = {
    puts: 0, alarms: 0, failPut: false, journaled: [],
    async get(k) { const v = m.get(k); return v === undefined ? undefined : structuredClone(v); },
    async put(k, v) { if (st.failPut) throw new Error("injected: DO storage row limit"); st.puts++; st.journaled.push(v.account?.balance); m.set(k, structuredClone(v)); },
    setAlarm(t) { st.alarms++; st.alarmAt = t; },
  };
  return st;
}
/* Sums D1 meta.rows_written over every statement and batch (the number the
   free plan bills), and can inject failures. */
function meter(db) {
  const c = { rows: 0, batches: 0, fail: null };
  const add = (r) => { for (const x of Array.isArray(r) ? r : [r]) c.rows += x?.meta?.rows_written || 0; return r; };
  const wrap = (s) => new Proxy(s, { get(t, k) { const v = t[k];
    if (k === "bind") return (...a) => wrap(v.apply(t, a));
    if (["run", "all", "first", "raw"].includes(k)) return async (...a) => { if (k === "run" || k === "all") return add(await v.apply(t, a)); return v.apply(t, a); };
    return typeof v === "function" ? v.bind(t) : v; } });
  const proxy = new Proxy(db, { get(t, k) { const v = t[k];
    if (k === "prepare") return (q) => wrap(v.call(t, q));
    if (k === "batch") return async (ops) => {
      c.batches++;
      if (c.fail === "before") { c.fail = null; throw new Error("injected: D1 unreachable"); }
      const r = add(await v.call(t, ops));
      if (c.fail === "after") { c.fail = null; throw new Error("injected: response lost after commit"); }
      return r;
    };
    return typeof v === "function" ? v.bind(t) : v; } });
  return { proxy, c };
}
const strip = (r) => { const { runtime, ...rest } = r; return rest; };
async function acct(db, id) { return db.prepare("SELECT balance,bonus,pt,sync_seq,last_daily,w_xp FROM accounts WHERE id=?").bind(id).first(); }
async function totals(db, id) {
  const pid = (await db.prepare("SELECT pid FROM accounts WHERE id=?").bind(id).first()).pid;
  // Combat rows are aggregated per flush, so shots/catch labels merge; every
  // report sums across them. Daily/promo/external stay separate.
  const r = await db.prepare("SELECT CASE WHEN type IN ('shots','catch') THEN 'combat' ELSE type END t, SUM(bet) bet, SUM(win) win, SUM(credit) credit, SUM(CASE WHEN type IN ('shots','slot_spin') THEN n ELSE 0 END) bets, SUM(n) n FROM accounting_events WHERE player_id=? GROUP BY t ORDER BY t").bind(pid).all();
  const l = await db.prepare("SELECT COALESCE(SUM(payout-wager),0) d, COALESCE(SUM(wager),0) w, COALESCE(SUM(gaming_payout),0) g, COALESCE(SUM(wager_refund),0) rf FROM economy_ledger WHERE account_id=?").bind(id).first();
  return { events: r.results, ledger: l };
}
// Deterministic session (bootstrap, ticks, batched launches with flights in
// the air, a daily claim, an unaffordable launch that must commit only its tick).
async function session(play, steps = 14) {
  ctr = 0;
  const out = [];
  let now = T0;
  let s = await play({ command: "state", id: aid(0) }, now);
  out.push(s);
  for (let k = 0; k < steps; k++) {
    now += 700;
    const body = k === 5 ? { command: "daily", id: aid(s.seq), seq: s.seq }
      : k % 4 === 3 ? { command: "state", id: aid(s.seq), seq: s.seq }
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
const direct = (db, id = 7) => (body, now) => gameV2({ DB: db, GAME_V2: "1" }, id, body, now, seeded(now));
const viaBatched = (bw) => (body, now) => bw.play(body, { now, rng: seeded(now) });

test("pending aggregate: exact sums, bullet count n, exact top single wins; minus() removes a landed flush", () => {
  const plan = (seq, ledger) => ({ now: T0 + seq, ledger: ledger.map((l) => ({ wager: 0, payout: 0, gaming_payout: 0, promo_credit: 0, wager_refund: 0, balance_after: 100, created_at: T0 + seq, account_seq: seq, rtp_period: 95, ...l })) });
  let p = { groups: {}, wins: [], actions: 0, since: 0 };
  p = addPending(p, plan(1, [{ kind: "launch", wager: 10 }, { kind: "launch", wager: 20 }, { kind: "state", payout: 300, gaming_payout: 300 }]));
  const half = structuredClone(p);
  p = addPending(p, plan(2, [{ kind: "launch", wager: 10 }, { kind: "wager_refund", wager_refund: 5 }, { kind: "state", payout: 40, gaming_payout: 40 }]));
  assert.deepEqual({ w: p.groups["launch|95"].wager, n: p.groups["launch|95"].n }, { w: 40, n: 3 });
  assert.equal(p.groups["state|95"].gaming_payout, 340);
  assert.equal(p.groups["state|95"].n, 0);
  assert.deepEqual(p.wins.map((w) => w.win), [300, 40]);
  const rest = pendingMinus(p, half);
  assert.deepEqual({ w: rest.groups["launch|95"].wager, n: rest.groups["launch|95"].n, g: rest.groups["state|95"].gaming_payout }, { w: 10, n: 1, g: 40 });
  assert.deepEqual(rest.wins.map((w) => w.win), [40]);
  assert.equal(rest.actions, 1);
});

test("batched DO == write-through: identical responses, account, world and accounting totals; no per-action rows", async () => {
  const A = await localV2(), B = await localV2();
  try {
    await seedAccount(A.db); await seedAccount(B.db);
    const want = await session(direct(A.db));
    const storage = fakeStorage();
    const bw = new BatchedWorld({ DB: B.db, GAME_V2: "1" }, 7, storage);
    const got = await session(viaBatched(bw));
    assert.deepEqual(got.map((r) => (r.error ? r : strip(r))), want.map((r) => (r.error ? r : strip(r))));
    assert.ok(want.some((r) => r.error), "session exercised a rejected launch");
    assert.ok(want.some((r) => r.detail?.daily), "session claimed the daily wheel");
    await bw.sync();
    assert.deepEqual(await acct(B.db, 7), await acct(A.db, 7));
    const wa = await A.db.prepare("SELECT state_json,version FROM economy_world WHERE account_id=7").first();
    const wb = await B.db.prepare("SELECT state_json,version FROM economy_world WHERE account_id=7").first();
    assert.deepEqual(wb, wa);
    const ta = await totals(A.db, 7), tb = await totals(B.db, 7);
    assert.deepEqual(tb, ta, "house/backoffice totals (bet, win, credit, bullet count) match exactly");
    assert.equal((await acct(B.db, 7)).balance, 50000 + tb.ledger.d, "ledger reconciles to the balance");
    assert.equal((await B.db.prepare("SELECT COUNT(*) n FROM economy_actions").first()).n, 0, "no per-action receipt rows");
    assert.ok((await B.db.prepare("SELECT COUNT(*) n FROM economy_ledger").first()).n < (await A.db.prepare("SELECT COUNT(*) n FROM economy_ledger").first()).n / 3);
    assert.ok(storage.puts > 0 && storage.alarms > 0);
  } finally { await A.mf.dispose(); await B.mf.dispose(); }
});

test("idempotent retry of an acked action returns the same receipt and charges once (in memory, no D1 read)", async () => {
  const { mf, db } = await localV2();
  try {
    await seedAccount(db);
    const bw = new BatchedWorld({ DB: db, GAME_V2: "1" }, 7, fakeStorage());
    let s = await bw.play({ command: "state", id: aid(0) }, { now: T0 });
    const body = { command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(2, T0 + 100) };
    const r1 = await bw.play(body, { now: T0 + 400 });
    const r2 = await bw.play(body, { now: T0 + 450 });
    assert.equal(r2.replayed, true);
    assert.deepEqual(r2.settled, r1.settled);
    assert.equal(r2.balance, r1.balance);
    await assert.rejects(bw.play({ ...body, shots: shots(3, T0 + 100) }, { now: T0 + 500 }), /action id reused/);
  } finally { await mf.dispose(); }
});

test("eviction before any flush loses no credit: the journal restores, flushes, and play continues", async () => {
  const A = await localV2(), B = await localV2();
  try {
    await seedAccount(A.db); await seedAccount(B.db);
    const want = await session(direct(A.db));
    const storage = fakeStorage();
    const env = { DB: B.db, GAME_V2: "1" };
    // Never flush on time/count: only the journal protects the money.
    let bw = new BatchedWorld(env, 7, storage, { flushMs: 1e12, flushMax: 1e9 });
    let evictions = 0;
    const got = await session(async (body, now) => {
      const r = await bw.play(body, { now, rng: seeded(now) });
      // DO evicted after every money action (worst case): memory gone.
      if (body.command !== "state") { bw = new BatchedWorld(env, 7, storage, { flushMs: 1e12, flushMax: 1e9 }); evictions++; }
      return r;
    });
    assert.ok(evictions >= 8);
    // Responses can only differ where a pure no-money tick was dropped by an
    // eviction (client resyncs); money and final state must match exactly.
    await bw.sync();
    assert.equal((await acct(B.db, 7)).balance, (await acct(A.db, 7)).balance);
    assert.deepEqual((await totals(B.db, 7)).ledger, (await totals(A.db, 7)).ledger);
    assert.equal(got.at(-1).balance, want.at(-1).balance);
  } finally { await A.mf.dispose(); await B.mf.dispose(); }
});

test("journal only (D1 down) then eviction: acked balance survives; restore flushes exactly once", async () => {
  const { mf, db } = await localV2();
  try {
    await seedAccount(db);
    const storage = fakeStorage();
    const m = meter(db);
    let bw = new BatchedWorld({ DB: m.proxy, GAME_V2: "1" }, 7, storage, { flushMs: 1e12, flushMax: 1e9 });
    let s = await bw.play({ command: "state", id: aid(0) }, { now: T0 });
    let now = T0;
    for (let k = 0; k < 6; k++) { now += 300; s = await bw.play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(2, now - 200) }, { now }); }
    assert.equal((await acct(db, 7)).balance, 50000, "D1 untouched before a flush");
    const acked = s.balance;
    m.c.fail = "before"; // alarm flush fails: D1 unreachable
    await bw.alarm(now + 6000);
    assert.equal((await acct(db, 7)).balance, 50000);
    bw = new BatchedWorld({ DB: db, GAME_V2: "1" }, 7, storage); // evicted
    s = await bw.play({ command: "state", id: aid(0) }, { now: now + 7000 });
    assert.equal(bw.stats.restores, 1);
    assert.equal((await acct(db, 7)).balance, acked, "restore flushed the journal");
    assert.equal(s.balance, acked);
    // A second restore of the same (now flushed) journal is a no-op.
    const rows = (await db.prepare("SELECT COUNT(*) n FROM economy_ledger").first()).n;
    const bw2 = new BatchedWorld({ DB: db, GAME_V2: "1" }, 7, storage);
    await bw2.sync(now + 8000);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM economy_ledger").first()).n, rows);
    assert.equal((await acct(db, 7)).balance, acked);
  } finally { await mf.dispose(); }
});

test("ambiguous flush (committed, response lost) then more play and a crash: nothing doubled, nothing lost", async () => {
  const A = await localV2(), B = await localV2();
  try {
    await seedAccount(A.db); await seedAccount(B.db);
    const want = await session(direct(A.db), 22);
    const storage = fakeStorage();
    const m = meter(B.db);
    let bw = new BatchedWorld({ DB: m.proxy, GAME_V2: "1" }, 7, storage, { flushMs: 2000 });
    let n = 0;
    await session(async (body, now) => {
      n++;
      if (n === 6 || n === 14) m.c.fail = "after"; // the next flush lands but reports failure
      const r = await bw.play(body, { now, rng: seeded(now) });
      if (n === 16) bw = new BatchedWorld({ DB: m.proxy, GAME_V2: "1" }, 7, storage, { flushMs: 2000 }); // crash
      return r;
    }, 22);
    await bw.sync();
    assert.equal((await acct(B.db, 7)).balance, (await acct(A.db, 7)).balance);
    assert.equal((await acct(B.db, 7)).balance, want.at(-1).balance);
    assert.deepEqual(await totals(B.db, 7), await totals(A.db, 7));
  } finally { await A.mf.dispose(); await B.mf.dispose(); }
});

test("external credit (Stars/admin) lands in D1 while the DO holds unflushed play: rebased exactly once", async () => {
  const { mf, db } = await localV2();
  try {
    await seedAccount(db, 9, 50000, 555001);
    const bw = new BatchedWorld({ DB: db, GAME_V2: "1" }, 9, fakeStorage(), { flushMs: 1e12, flushMax: 1e9 });
    let s = await bw.play({ command: "state", id: aid(0) }, { now: T0 });
    let now = T0;
    for (let k = 0; k < 5; k++) { now += 300; s = await bw.play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(2, now - 200) }, { now }); }
    const before = s.balance;
    // Stars purchase, written by the Worker straight to D1 (as creditPayment does).
    await db.prepare("UPDATE accounts SET balance=balance+100000,bonus=bonus+500,sync_seq=sync_seq+1 WHERE id=9").run();
    await db.prepare("INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,external_delta,account_seq) SELECT 9,'payment_x','stars_purchase',0,0,balance,?1,100000,sync_seq FROM accounts WHERE id=9").bind(now).run();
    // The DO keeps playing on its own copy until it syncs.
    now += 300; s = await bw.play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1, now - 200) }, { now });
    const gameDelta = s.balance - 50000;
    await bw.sync(now + 10);
    const a = await db.prepare("SELECT balance,bonus,sync_seq FROM accounts WHERE id=9").first();
    assert.equal(a.balance, 50000 + 100000 + gameDelta, "purchase + every game move, each once");
    assert.equal(a.bonus, 500);
    assert.equal(bw.stats.rebases, 1);
    const p = await db.prepare("SELECT balance,sync_seq FROM players WHERE tg_id=555001").first();
    assert.deepEqual(p, { balance: a.balance, sync_seq: a.sync_seq }, "players mirror follows");
    const l = await db.prepare("SELECT SUM(payout-wager+external_delta) d FROM economy_ledger WHERE account_id=9").first();
    assert.equal(a.balance, 50000 + l.d, "ledger reconciles after rebase");
    // Next action reloads D1 and shows the credit; the old seq is refused (client resyncs).
    await assert.rejects(bw.play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1, now) }, { now: now + 400 }), /stale account sequence/);
    const fresh = await bw.play({ command: "state", id: aid(0) }, { now: now + 500 });
    assert.equal(fresh.balance, a.balance);
    assert.ok(before > 0);
  } finally { await mf.dispose(); }
});

test("no durable store => no ack: journal put fails -> D1 flush; both fail -> action rejected, state unchanged", async () => {
  const { mf, db } = await localV2();
  try {
    await seedAccount(db);
    const storage = fakeStorage();
    const m = meter(db);
    const bw = new BatchedWorld({ DB: m.proxy, GAME_V2: "1" }, 7, storage, { flushMs: 1e12, flushMax: 1e9 });
    let s = await bw.play({ command: "state", id: aid(0) }, { now: T0 });
    s = await bw.play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1, T0 + 100) }, { now: T0 + 300 });
    storage.failPut = true;
    const r = await bw.play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1, T0 + 400) }, { now: T0 + 600 });
    assert.equal(bw.stats.d1Fallback, 1);
    assert.equal((await acct(db, 7)).balance, r.balance, "D1 holds the acked balance");
    m.c.fail = "before";
    const body = { command: "launch", id: aid(r.seq), seq: r.seq, shots: shots(1, T0 + 700) };
    const snap = structuredClone(bw.s.account), world = bw.s.world.version;
    await assert.rejects(bw.play(body, { now: T0 + 900 }));
    assert.deepEqual(bw.s.account, snap, "rejected action left no trace in memory");
    assert.equal(bw.s.world.version, world);
    assert.equal(bw.receipt(body.id), null);
    assert.equal((await acct(db, 7)).balance, r.balance);
  } finally { await mf.dispose(); }
});

async function workload(play, launches, perLaunch) {
  ctr = 0;
  let now = T0, s = await play({ command: "state", id: aid(0) }, now), fired = 0;
  for (let k = 0; k < launches; k++) {
    now += 250 * perLaunch;
    s = await play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(perLaunch, now - 165 * perLaunch) }, now);
    fired += perLaunch;
    if (k % 4 === 3) { now += 120; s = await play({ command: "state", id: aid(s.seq), seq: s.seq }, now); }
  }
  now += 4000;
  s = await play({ command: "state", id: aid(s.seq), seq: s.seq }, now);
  return { fired, end: s, now };
}

test("write budget: D1 rows written per 100 shots, write-through vs batched (>=10x fewer)", async () => {
  const report = {};
  for (const perLaunch of [1, 4]) {
    const A = await localV2(), B = await localV2();
    try {
      await seedAccount(A.db, 7, 500000); await seedAccount(B.db, 7, 500000);
      const ma = meter(A.db), mb = meter(B.db);
      const hot = new HotWorld({ DB: ma.proxy, GAME_V2: "1" }, 7);
      const before = await workload((body, now) => hot.play(body, { now, rng: seeded(now) }), 100 / perLaunch, perLaunch);
      const storage = fakeStorage();
      const bw = new BatchedWorld({ DB: mb.proxy, GAME_V2: "1" }, 7, storage);
      const after = await workload((body, now) => bw.play(body, { now, rng: seeded(now) }), 100 / perLaunch, perLaunch);
      await bw.sync(after.now + 1);
      assert.equal(after.fired, 100);
      assert.equal((await acct(B.db, 7)).balance, (await acct(A.db, 7)).balance, "same money either way");
      report[`${perLaunch} shot/launch`] = {
        writeThroughD1Rows: ma.c.rows, batchedD1Rows: mb.c.rows, ratio: +(ma.c.rows / mb.c.rows).toFixed(1),
        batchedD1Flushes: bw.stats.flushes, doJournalRows: storage.puts, doAlarmRows: storage.alarms,
      };
      assert.ok(ma.c.rows >= 10 * mb.c.rows, JSON.stringify(report));
    } finally { await A.mf.dispose(); await B.mf.dispose(); }
  }
  console.log("WRITE_BUDGET " + JSON.stringify(report));
});
