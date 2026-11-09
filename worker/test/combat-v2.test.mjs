import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profile,
  engage,
  packet,
  attack,
  potential,
  stakePayoutBonus,
  lockedPrize,
} from "../src/combat-math.js";
const fish = (id = "one", mult = 10, kind = "normal") => ({ id, mult, kind });
test("mild truthful HP and locked actual stake survive attempted bet/tier switching", () => {
  const a = engage(fish(), 10, 5);
  assert.equal(a.lock.stake, 20);
  assert.equal(a.hp, 1200);
  assert.equal(a.maxHp, 1200);
  const b = engage(a, 1000, 1);
  assert.deepEqual(a, b);
  assert.equal(profile(5).actualPacketDamage, 720);
  assert.equal(profile(1).actualPacketDamage, 400);
  assert.equal(engage(fish(), 20, 1).maxHp, 1020);
  assert.equal(engage(fish(), 10, 1).maxHp, 1000);
});
test("stake-tier payout bonus is 1.00x at min stake and rises to targetR/baseR at max", () => {
  assert.equal(stakePayoutBonus(10, 0.91), 1);
  assert.equal(stakePayoutBonus(10, 0.87), 1);
  assert.ok(Math.abs(stakePayoutBonus(50, 0.91) - 0.98 / 0.91) < 1e-12);
  assert.ok(Math.abs(stakePayoutBonus(50, 0.87) - 0.94 / 0.87) < 1e-12);
  assert.ok(stakePayoutBonus(20, 0.91) > 1 && stakePayoutBonus(20, 0.91) < stakePayoutBonus(50, 0.91));
  assert.throws(() => stakePayoutBonus(100, 0.91), /invalid base stake/);
  for (const R of [0.91, 0.87])
    for (const base of [10, 20, 50]) {
      const factor = stakePayoutBonus(base, R);
      assert.ok(R * factor < 1, `EV must stay below 100% at stake ${base} R=${R}`);
      assert.ok(factor >= 1);
    }
});
test("uniform stake proportional prizes include locked payout factor; integer caps and true HP damage", () => {
  for (const base of [10, 20, 50]) {
    const a = engage(fish("a", 10), base, 1, 0.91);
    let state = a;
    let pay = 0;
    while (!state.dead) {
      const r = packet(state, 1, "normal", 0.91, () => 0);
      state = r.target;
      pay += r.prize;
    }
    assert.equal(pay, lockedPrize(10, a.lock));
    assert.equal(pay, Math.min(40000, Math.round(base * 10 * stakePayoutBonus(base, 0.91))));
  }
  assert.throws(() => engage(fish("boss", 400), 50, 10), /cap/);
  assert.throws(() => engage(fish("boss", 350), 100, 1), /invalid base stake/);
});
test("every HP/tier/style has exactly target expected prize-value progress, including final hit", () => {
  for (let tier = 1; tier <= 10; tier++)
    for (const style of ["normal", "plasma", "arc", "laser"])
      for (const R of [0.91, 0.87])
        for (let units = 1; units <= 350; units++) {
          const a = engage(fish("a", 350), 10, tier, R);
          a.hp = units * a.lock.hpUnit;
          for (const weight of [1, 1 / 2, 1 / 3]) {
            const hit = packet(a, weight, style, R, () => 0);
            const value = (hit.damage / a.lock.hpUnit) * a.lock.stake * a.lock.payoutFactor;
            assert.ok(
              Math.abs(hit.probability * value - R * weight * a.lock.stake * a.lock.payoutFactor) <
                1e-10,
            );
            assert.ok(hit.probability <= 1);
          }
        }
});
test("arc does real multi-target damage without duplicating expected paid damage budget", () => {
  const f = [fish("a"), fish("b"), fish("c")];
  const result = attack(f, "a", 10, 1, "arc", 0.91, () => 0);
  assert.equal(result.cost, 10);
  assert.equal(result.updates.length, 3);
  assert.ok(result.updates.every((x) => x.damage > 0));
  assert.ok(
    Math.abs(
      result.updates.reduce(
        (sum, x) =>
          sum +
          ((x.probability * x.damage) / x.target.lock.hpUnit) *
            x.target.lock.stake *
            x.target.lock.payoutFactor,
        0,
      ) - 9.1,
    ) < 1e-10,
  );
});
test("target switching cannot mix locked prices or exceed total attack award cap", () => {
  const f = [
    engage(fish("a"), 10, 1),
    engage(fish("b"), 50, 1),
    fish("c", 350),
  ];
  const r = attack(f, "a", 50, 10, "arc", 0.91, () => 0);
  assert.equal(r.cost, 10);
  assert.equal(r.lockedTier, 1);
  assert.ok(!r.updates.some((x) => x.target.id === "b"));
  assert.ok(r.payout <= 40000);
});
test("completed/abandoned progress obeys conservation potential; no sample HP cherry-picking", () => {
  let f = [fish()];
  const before = potential(f);
  const r = attack(f, "one", 10, 1, "normal", 0.91, () => 0);
  assert.equal(r.updates[0].target.maxHp, 1000);
  assert.equal(potential(r.fishes) - before, 40);
  const hp = engage(fish(), 10, 1);
  assert.equal(hp.hp, 1000); // No random health threshold is revealed.
});
test("max-stake bonus raises prize above even-scaled reward but keeps EV under 100%", () => {
  const low = engage(fish("a", 10), 10, 1, 0.91);
  const high = engage(fish("b", 10), 50, 1, 0.91);
  assert.equal(lockedPrize(10, low.lock), 100);
  assert.equal(lockedPrize(10, high.lock), Math.round(50 * 10 * (0.98 / 0.91)));
  assert.ok(lockedPrize(10, high.lock) / 50 > lockedPrize(10, low.lock) / 10);
  assert.ok(0.91 * stakePayoutBonus(50, 0.91) < 1);
  assert.ok(0.87 * stakePayoutBonus(50, 0.87) < 1);
});

test("raising a base stake never reduces landed packet damage at a fixed tier", () => {
  for (let tier = 1; tier <= 10; tier++) {
    let last = 0;
    for (let base = 10; base <= 50; base++) {
      const p = profile(tier, base);
      assert.ok(p.actualPacketDamage >= last);
      last = p.actualPacketDamage;
    }
  }
});
