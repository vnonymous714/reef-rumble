// tg37 end-to-end through the real Worker + PlayerGame DO (miniflare, local
// D1 only): write-through vs GAME_BATCH="on" over HTTP for a web (bearer)
// account and a Telegram account. Measures D1 rows written per 100 shots
// including Worker overhead (auth, rate limits, sessions), and proves logout
// and a Stars payment flush the DO so D1 is exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { localV2 } from "./local-v2.mjs";

const board = { width: 390, height: 844, safeBottom: 34 };
const TOKEN = "local-testing-fixture-not-a-real-bot-token";
let ctr = 0;
const aid = (seq) => `${seq}_httpb${String(++ctr).padStart(8, "0")}`;
const shots = (n, at) => Array.from({ length: n }, (_, i) => ({ id: `hshot${String(++ctr).padStart(10, "0")}`, at: at + i * 165, angle: -Math.PI / 2 + i * 0.05, baseStake: 10, tier: 1, board }));
function tgData(userId) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: "Local fixture" }) });
  const text = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const key = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  fields.set("hash", createHmac("sha256", key).update(text).digest("hex"));
  return fields.toString();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(mf, path, body, headers = {}) {
  const r = await mf.dispatchFetch("http://localhost" + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Reef-Protocol": "2", ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (r.status !== 200) throw Object.assign(new Error((j && j.error) + " " + path), { status: r.status });
  return j;
}
async function meterRows(mf, ids) {
  let total = 0, puts = 0, alarms = 0;
  const w = await (await mf.dispatchFetch("http://localhost/__meter")).json();
  total = w.worker.d1Rows;
  for (const id of ids) {
    const d = await (await mf.dispatchFetch("http://localhost/__meter?acct=" + id)).json();
    // Locally the DO may share the Worker's isolate (same counter object).
    if (d.do && JSON.stringify(d.do) !== JSON.stringify(w.worker)) { total += d.do.d1Rows; puts += d.do.doPuts; alarms += d.do.doAlarms; }
    else if (d.do) { puts = d.do.doPuts; alarms = d.do.doAlarms; }
  }
  return { d1: total, puts, alarms };
}
async function play100(mf, auth) {
  let s = await post(mf, "/api/v2/game", { command: "state", id: aid(0), ...auth.body }, auth.headers);
  let fired = 0;
  while (fired < 100) {
    await sleep(180);
    try {
      s = await post(mf, "/api/v2/game", { command: "launch", id: aid(s.seq), seq: s.seq, shots: shots(1, Date.now() - 60), ...auth.body }, auth.headers);
      fired++;
      if (process.env.HTTP_DEBUG && fired % 20 === 0) console.error("fired", fired, s.balance);
    } catch (e) {
      if (process.env.HTTP_DEBUG) console.error("err", e.status, e.message);
      if (![400, 409, 429].includes(e.status)) throw e;
      await sleep(150);
      s = await post(mf, "/api/v2/game", { command: "state", id: aid(0), ...auth.body }, auth.headers);
    }
  }
  await sleep(2500);
  s = await post(mf, "/api/v2/game", { command: "state", id: aid(s.seq), seq: s.seq, ...auth.body }, auth.headers);
  return s;
}

test("HTTP end to end: D1 rows per 100 shots (web + Telegram), write-through vs batched; logout and Stars payment flush exactly", async () => {
  const report = {};
  for (const batch of ["off", "on"]) {
    const { mf, db } = await localV2({ gameDoMode: "on", entry: "./fixtures/metered-entry.js", bindings: { GAME_BATCH: batch, GAME_DO_HINT: "enam", WEBHOOK_SECRET: "local-webhook-fixture" } });
    try {
      // Protected owner row exists locally and must never change.
      await db.prepare("INSERT INTO accounts(id,public_id,pid,tg_id,balance,bonus,pt,sync_seq,created_at,last_seen) VALUES(1,'RR-000001','pid_owner',7313143643,127222,10000,0,75,0,0)").run();
      const su = await post(mf, "/api/auth/signup", { username: "batchweb" + batch, password: "Local-Test-Only-9000" });
      const web = { headers: { Authorization: "Bearer " + su.token }, body: {} };
      const webId = (await db.prepare("SELECT id FROM accounts WHERE username=?").bind("batchweb" + batch).first()).id;
      // Telegram account with 500.00 play credits (seeded locally).
      await db.prepare("INSERT INTO players(tg_id,pid,balance,created_at,last_seen) VALUES(424242,'t0000000000a424',50000,0,0)").run();
      await db.prepare("INSERT INTO accounts(public_id,pid,tg_id,balance,bonus,pt,created_at,last_seen) VALUES('RR-TG4242','a0000000000b424',424242,50000,0,0,0,0)").run();
      const tg = { headers: {}, body: { initData: tgData(424242) } };
      await post(mf, "/api/v2/game", { command: "state", id: aid(0), ...tg.body });
      const tgId = (await db.prepare("SELECT id FROM accounts WHERE tg_id=424242").first()).id;
      const m0 = await meterRows(mf, [webId, tgId]);
      const endWeb = await play100(mf, web);
      const endTg = await play100(mf, tg);
      const m1 = await meterRows(mf, [webId, tgId]);
      // Session end + a Stars payment: both must leave D1 exact.
      await post(mf, "/api/auth/logout", {}, web.headers);
      const pay = { message: { from: { id: 424242 }, chat: { id: 424242, type: "private" }, successful_payment: { currency: "XTR", total_amount: 50, invoice_payload: "rr1:0:424242:abcd1234", telegram_payment_charge_id: "local-charge-" + batch } } };
      const r = await mf.dispatchFetch("http://localhost/tg/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "local-webhook-fixture" }, body: JSON.stringify(pay) });
      assert.equal(r.status, 200);
      const w = await db.prepare("SELECT balance FROM accounts WHERE id=?").bind(webId).first();
      assert.equal(w.balance, endWeb.balance, batch + ": web balance in D1 after logout");
      const t = await db.prepare("SELECT balance,sync_seq FROM accounts WHERE id=?").bind(tgId).first();
      assert.equal(t.balance, endTg.balance + 100000, batch + ": TG balance = play + Stars pack, each once");
      const p = await db.prepare("SELECT balance,sync_seq FROM players WHERE tg_id=424242").first();
      assert.deepEqual(p, t, "players mirror");
      for (const id of [webId, tgId]) {
        const l = await db.prepare("SELECT COALESCE(SUM(payout-wager+external_delta),0) d FROM economy_ledger WHERE account_id=?").bind(id).first();
        const start = id === webId ? 5000 : (await db.prepare("SELECT balance FROM players WHERE tg_id=424242").first()) && 0;
        if (id === webId) assert.equal(w.balance, start + l.d, batch + " web ledger reconciles");
      }
      // The next game call sees the purchase (DO cache dropped by the payment).
      const after = await post(mf, "/api/v2/game", { command: "state", id: aid(0), ...tg.body });
      assert.equal(after.balance, t.balance);
      const owner = await db.prepare("SELECT balance,bonus,sync_seq FROM accounts WHERE id=1").first();
      assert.deepEqual(owner, { balance: 127222, bonus: 10000, sync_seq: 75 }, "protected account untouched");
      const house = await post(mf, "/rpc/rr_house", {}).catch(() => null);
      report[batch === "on" ? "batched" : "writeThrough"] = { d1RowsFor200Shots: m1.d1 - m0.d1, perHundredShots: (m1.d1 - m0.d1) / 2, doJournalRows: m1.puts - m0.puts, doAlarmRows: m1.alarms - m0.alarms, house: house && { bets: house.bets, wagered: house.wagered } };
    } finally { await mf.dispose(); }
  }
  console.log("HTTP_WRITE_BUDGET " + JSON.stringify(report));
  assert.ok(report.writeThrough.d1RowsFor200Shots >= 10 * report.batched.d1RowsFor200Shots, JSON.stringify(report));
});
