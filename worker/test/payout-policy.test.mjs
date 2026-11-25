import test from "node:test";
import assert from "node:assert/strict";
import { effectiveReturn, isValidReturn, RETURN_CAP, STEADY_TIDE, LIVE_TG35, ACTIVE_POLICY, WELCOME } from "../src/payout-policy.js";
import { stakePayoutBonus, engage, packet, attack, jackpotAward, lockedPrize, MAX_AWARD, MAX_BASE_STAKE, profile } from "../src/combat-math.js";
import E from "../../engine.js";

const DAY = 86400000, NOW = Date.UTC(2026, 10, 25, 12);
const old = { createdAt: NOW - 30 * DAY, now: NOW };

test("Steady Tide is the active policy with the exact recommended parameters", () => {
  assert.equal(ACTIVE_POLICY, STEADY_TIDE);
  assert.deepEqual(JSON.parse(JSON.stringify(STEADY_TIDE)), {
    normal: 0.92, lowTide: 0.88,
    cushion: { below: 1500, add: 0.03 },
    streak: { after: 10, add: 0.05 },
    newPlayer: null,
  });
  assert.equal(RETURN_CAP, 0.97);
});

test("base returns: normal 92%, Low Tide 88%; live tg35 policy reproduces 91/87", () => {
  assert.equal(effectiveReturn(92, { ...old, balance: 5000, missStreak: 0 }), 0.92);
  assert.equal(effectiveReturn(88, { ...old, balance: 5000, missStreak: 0 }), 0.88);
  assert.equal(effectiveReturn(92, { balance: 5000, createdAt: NOW, now: NOW }), 0.92, "Welcome is off");
  assert.equal(effectiveReturn(92, { balance: 1, missStreak: 99, createdAt: NOW, now: NOW }, LIVE_TG35), 0.91);
  assert.equal(effectiveReturn(88, {}, LIVE_TG35), 0.87);
});

test("Lifeline +3 under 15.00, Second Wind +5 from the 10th straight miss; optional Welcome +2 for 7 days", () => {
  assert.equal(effectiveReturn(92, { ...old, balance: 1499 }), 0.95);
  assert.equal(effectiveReturn(92, { ...old, balance: 1500 }), 0.92);
  assert.equal(effectiveReturn(92, { ...old, balance: 5000, missStreak: 9 }), 0.92);
  assert.equal(effectiveReturn(92, { ...old, balance: 5000, missStreak: 10 }), 0.97);
  assert.equal(effectiveReturn(88, { ...old, balance: 5000, missStreak: 10 }), 0.93);
  assert.equal(effectiveReturn(92, { ...old, balance: 1000, missStreak: 10 }), 0.97, "stacked boosts clamp at the cap");
  const W = { ...STEADY_TIDE, newPlayer: WELCOME };
  assert.equal(effectiveReturn(92, { balance: 5000, createdAt: NOW - 6 * DAY, now: NOW }, W), 0.94);
  assert.equal(effectiveReturn(92, { balance: 5000, createdAt: NOW - 7 * DAY, now: NOW }, W), 0.92);
});

test("stacked boosts clamp at RETURN_CAP 0.97 and every result is a valid 4-decimal return", () => {
  for (const period of [88, 92])
    for (const balance of [0, 10, 1499, 1500, 5000, 1e7])
      for (const missStreak of [0, 9, 10, 1000])
        for (const age of [0, 6.99 * DAY, 7 * DAY, 400 * DAY]) {
          for (const pol of [STEADY_TIDE, { ...STEADY_TIDE, newPlayer: WELCOME }]) {
            const r = effectiveReturn(period, { balance, missStreak, createdAt: NOW - age, now: NOW }, pol);
            assert.ok(isValidReturn(r), `${r}`);
            assert.ok(r <= RETURN_CAP && r >= 0.88);
          }
        }
  assert.equal(effectiveReturn(92, { balance: 0, missStreak: 50, createdAt: NOW, now: NOW }), 0.97);
  assert.equal(effectiveReturn(88, { balance: 0, missStreak: 50, createdAt: NOW, now: NOW }), 0.96);
  assert.equal(isValidReturn(0.98), false);
  assert.equal(isValidReturn(0.9300000001), false);
});

test("worst case: no shot EV (return x bigger-bullet factor) exceeds 0.97; +1% jackpot keeps RTP <= 98%", () => {
  const rets = [];
  for (let r = 0.88; r <= 0.97 + 1e-9; r += 0.01) rets.push(Math.round(r * 100) / 100);
  for (const lockR of rets)
    for (let base = 10; base <= MAX_BASE_STAKE; base += 10)
      for (const shotR of rets) {
        const pf = stakePayoutBonus(base, lockR);
        const effective = Math.min(shotR, RETURN_CAP / pf) * pf;
        assert.ok(effective <= RETURN_CAP + 1e-12, `base ${base} lock ${lockR} shot ${shotR} -> ${effective}`);
        assert.ok(effective + 0.01 < 1);
      }
});

test("boosted shot on a big-bullet locked fish is clamped in packet()", () => {
  const f = engage({ id: "a", mult: 10, kind: "normal", dead: false }, 500, 1, 0.89);
  const pf = f.lock.payoutFactor;
  assert.ok(pf > 1);
  const r = packet(f, 1, "normal", 0.97, () => 0.999);
  assert.ok(Math.abs(r.probability * f.lock.packet * pf - 0.97) < 1e-12, `${r.probability}`);
});

test("400.00 cap holds for every fish at max stake / LV10 for both Steady Tide base returns", () => {
  const stake = Math.round(MAX_BASE_STAKE * profile(10, MAX_BASE_STAKE).costFactor);
  assert.equal(stake, 1000);
  for (const R of [0.88, 0.89, 0.92, 0.93, 0.96, 0.97])
    for (const def of E.FISH) {
      const mult = Array.isArray(def.m) ? def.m[1] : def.m;
      if (!(mult > 0)) continue;
      const locked = engage({ id: def.id, mult, kind: "normal", dead: false }, MAX_BASE_STAKE, 10, R);
      assert.ok(lockedPrize(mult, locked.lock) <= MAX_AWARD, `${def.id} R=${R}`);
    }
});

test("seeded Monte Carlo: per-shot RTP is at the policy return and under 100% at max stake", () => {
  let s = 12345;
  const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (const R of [0.92, 0.97]) {
    let wager = 0, paid = 0, serial = 0;
    for (let n = 0; n < 4000; n++) {
      let fishes = [{ id: "f" + ++serial, mult: 2 + Math.floor(rng() * 20), kind: "normal", dead: false }];
      while (!fishes[0].dead) {
        const res = attack(fishes, fishes[0].id, MAX_BASE_STAKE, 10, "normal", R, rng);
        wager += res.cost; paid += res.payout; fishes = res.fishes;
        paid += jackpotAward(res.updates, "normal", res.cost, 25000, rng());
      }
    }
    const rtp = paid / wager;
    assert.ok(rtp < 1, `R=${R} rtp=${rtp}`);
    assert.ok(Math.abs(rtp - (Math.min(0.97, R * stakePayoutBonus(MAX_BASE_STAKE, R)) + 0.01)) < 0.04, `R=${R} rtp=${rtp}`);
  }
});

test("game-v2 wiring: miss streak counts settled shots, resets on payout, and is disclosed in the snapshot status", async () => {
  const { noteShotResult, payoutStatus, shotReturn, periodAt } = await import("../src/game-v2.js");
  const w = {};
  for (let i = 0; i < 10; i++) noteShotResult(w, 0);
  assert.equal(w.missStreak, 10);
  const t = Date.UTC(2026, 10, 25, 12, 10); // minute 10 of the half hour: normal period
  assert.equal(periodAt(t), 92);
  const a = { balance: 5000, created_at: t - 30 * DAY };
  assert.equal(shotReturn(w, 92, { balance: 5000, createdAt: a.created_at }, t), 0.97);
  let st = payoutStatus(a, w, t);
  assert.deepEqual({ ...st }, { name: "steady-tide", returnNow: 0.97, base: 0.92, lifeline: false, secondWind: true, welcome: false, cap: 0.97 });
  noteShotResult(w, 40);
  assert.equal(w.missStreak, 0);
  st = payoutStatus({ ...a, balance: 1000 }, w, t);
  assert.equal(st.lifeline, true);
  assert.equal(st.returnNow, 0.95);
});
