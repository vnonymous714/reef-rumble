import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { gameV2 } from "../src/game-v2.js";
import { doubleShot, attack, engage, canDouble } from "../src/combat-math.js";

const board = { width: 390, height: 844, safeBottom: 34 };
const T0 = Date.UTC(2026, 10, 14, 20, 10, 0);
let ctr = 0;
const aid = (seq) => `${seq}_dbl${String(++ctr).padStart(10, "0")}`;
function seeded(seed) { let x = seed >>> 0; return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0)); }
function xs(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

test("double-shot math: two half-price bullets, half-size prizes, same EV per credit", () => {
  const f = { id: "a", mult: 10, kind: "normal", dead: false };
  const full = engage(f, 20, 1, 0.93), half = engage(f, 20, 1, 0.93, 2);
  assert.equal(full.lock.stake, 20);
  assert.equal(half.lock.stake, 10);
  assert.equal(half.lock.split, 2);
  assert.equal(full.lock.payoutFactor, half.lock.payoutFactor);
  // Seeded EV check: wager-weighted return matches within noise.
  for (const mode of ["single", "double"]) {
    const r = xs(99); let w = 0, p = 0, hits = 0, n = 0;
    for (let i = 0; i < 60000; i++) {
      let fishes = [{ id: "x" + i, mult: 2 + (i % 12), kind: "normal", dead: false }, { id: "y" + i, mult: 3, kind: "normal", dead: false }];
      const res = mode === "double" ? doubleShot(fishes, ["x" + i, "y" + i], 10, 1, "normal", 0.93, r) : attack(fishes, "x" + i, 10, 1, "normal", 0.93, r);
      w += res.cost - (res.refund || 0); p += res.payout; n++;
      for (const h of res.hits || [res]) if (h.payout > 0) hits++;
      // escape value of partial progress is paid in the game; count it here too
      for (const u of res.updates) if (!u.target.dead) p += Math.round(((u.target.maxHp - u.target.hp) / u.target.lock.hpUnit) * u.target.lock.stake * u.target.lock.payoutFactor);
    }
    const rtp = p / w;
    assert.ok(Math.abs(rtp - 0.93) < 0.03, `${mode} rtp ${rtp}`);
    if (mode === "double") assert.ok(hits / n > 0.2, `double perceived hits per trigger ${hits / n}`);
  }
});

test("double-shot refuses a fish already priced at full stake; second bullet never mixes prices", () => {
  const r = xs(7);
  const locked = engage({ id: "a", mult: 10, kind: "normal", dead: false }, 20, 1, 0.93);
  assert.equal(canDouble(locked), false);
  assert.throws(() => doubleShot([locked], ["a", "a"], 20, 1, "normal", 0.93, r), /locked at full stake/);
  const other = { id: "b", mult: 4, kind: "normal", dead: false };
  const res = doubleShot([other, locked], ["b", "a"], 20, 1, "normal", 0.93, r);
  assert.ok(res.hits.every((h) => h.cost === 10));
  assert.ok(res.updates.every((u) => u.target.id !== "a"), "full-price fish untouched");
});

test("D1: a double-shot trigger is ONE launch request and ONE ledger shot with two hit results; balance == ledger", async () => {
  const L = await localV2();
  try {
    await L.db.prepare("INSERT INTO accounts(id,public_id,pid,username,balance,bonus,pt,created_at,last_seen) VALUES(7,'RR-DBL7','pid_dbl7','dosmokedbl',50000,0,0,0,0)").run();
    let now = T0, requests = 0;
    const seen = [];
    const play = async (body) => { requests++; const r = await gameV2({ DB: L.db, GAME_V2: "1" }, 7, body, now, seeded(now)); seen.push(r); return r; };
    let s = await play({ command: "state", id: aid(0) });
    const doubles = [];
    for (let k = 0; k < 10; k++) {
      now += 700;
      const target = s.world.fishes.find((f) => !f.dead && !f.lock)?.id;
      s = await play({ command: "launch", id: aid(s.seq), seq: s.seq, shots: [{ id: `dshot${String(++ctr).padStart(10, "0")}`, at: now - 300, angle: -Math.PI / 2, baseStake: 10, tier: 1, board, target, double: true }] });
      doubles.push(s);
    }
    for (let k = 0; k < 6; k++) { now += 1500; s = await play({ command: "state", id: aid(s.seq), seq: s.seq }); }
    assert.equal(requests, 1 + 10 + 6, "no extra requests for the second bullet");
    const launches = (await L.db.prepare("SELECT wager FROM economy_ledger WHERE account_id=7 AND kind='launch'").all()).results;
    assert.equal(launches.length, 10, "one ledger shot per trigger");
    assert.ok(launches.every((l) => l.wager === 10), "2 x 0.05 = the normal 0.10 shot price");
    const a = await L.db.prepare("SELECT balance FROM accounts WHERE id=7").first();
    const l = await L.db.prepare("SELECT COALESCE(SUM(payout-wager),0) d FROM economy_ledger WHERE account_id=7").first();
    assert.equal(a.balance, 50000 + l.d);
    const open = await L.db.prepare("SELECT COUNT(*) n FROM economy_actions WHERE account_id=7 AND status<>'settled'").first();
    assert.equal(open.n, 0);
    const events = seen.flatMap((r) => r.detail?.motion || []);
    const dbl = events.filter((e) => e.kind === "collision" && e.double);
    assert.ok(dbl.length > 0, "double collisions settled");
    for (const e of dbl) assert.ok(e.hits >= 1 && e.hits <= 2 && e.stake === 10, JSON.stringify(e).slice(0, 200));
  } finally { await L.mf.dispose(); }
});

test("double-shot trigger never pays more than one 400.00 award, even with two area hits at max stake", () => {
  const mk = (id, mult, kind = "normal") => ({ id, mult, kind, dead: false });
  const fishes = [mk("b1", 12, "bomb"), mk("b2", 12, "bomb"), mk("w1", 2), mk("w2", 3), mk("w3", 2), mk("w4", 3)];
  const res = doubleShot(fishes, ["b1", "b2"], 500, 10, "normal", 0.97, () => 0);
  assert.equal(res.cost, 1000);
  assert.ok(res.payout <= 40000, `${res.payout}`);
  assert.ok(res.hits.every((h) => h.payout <= 40000));
});
