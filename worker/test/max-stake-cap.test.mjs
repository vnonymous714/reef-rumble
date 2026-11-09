import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AWARD,
  MAX_BASE_STAKE,
  engage,
  lockedPrize,
  stakePayoutBonus,
  profile,
} from "../src/combat-math.js";
import {
  TAP_MAX_TOTAL,
  chestPayout,
  choiceWheelPayout,
  tapPayout,
  CHEST_MULTS,
  CHOICE_WHEEL,
} from "../src/bonus-choice.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../../engine.js");

/** Max rolled mult for a species def (boss ranges use the high end). */
function maxMult(def) {
  if (Array.isArray(def.m)) return def.m[1];
  if (def.id === "chest") return 12; // authoritative spawn mult in director-v2
  return def.m || 0;
}

test("max base stake is 500 and client BETS ladder tops there", () => {
  assert.equal(MAX_BASE_STAKE, 500);
  assert.deepEqual(E.BETS, [10, 20, 50, 100, 200, 500]);
  assert.equal(E.MAXBET, 500);
});

test("every fish/boss/wheel max prize at max stake and LV10 stays <= 400.00", () => {
  const tier = 10;
  const costFactor = profile(tier, MAX_BASE_STAKE).costFactor;
  assert.equal(costFactor, 2);
  for (const R of [0.91, 0.87]) {
    const pf = stakePayoutBonus(MAX_BASE_STAKE, R);
    assert.ok(R * pf < 1, `RTP must stay under 100% at max stake R=${R}`);
    const catalog = [...E.FISH];
    // Legacy client wheel wedges (authoritative chest capture is 12x + temple bonus)
    for (const s of E.WHEEL) catalog.push({ id: "wheel_" + s.m, m: s.m });
    for (const def of catalog) {
      const mult = maxMult(def);
      if (!(mult > 0)) continue;
      const stake = Math.round(MAX_BASE_STAKE * costFactor);
      const raw = Math.round(mult * stake * pf);
      assert.ok(
        raw <= MAX_AWARD,
        `${def.id} mult=${mult} raw=${raw} exceeds ${MAX_AWARD} at max stake`,
      );
      const locked = engage({ id: def.id, mult, kind: "normal" }, MAX_BASE_STAKE, tier, R);
      assert.equal(lockedPrize(mult, locked.lock), raw);
      assert.ok(lockedPrize(mult, locked.lock) <= MAX_AWARD);
    }
  }
});

test("bonus games at LV10 max locked stake stay <= 400.00", () => {
  const lockedStake = Math.round(MAX_BASE_STAKE * profile(10, MAX_BASE_STAKE).costFactor);
  assert.equal(lockedStake, 1000);
  for (const m of CHEST_MULTS) {
    const r = chestPayout(lockedStake, CHEST_MULTS.indexOf(m), CHEST_MULTS.slice());
    assert.ok(r.pay <= MAX_AWARD, `chest x${m} pay=${r.pay}`);
  }
  const maxChoice = Math.max(...CHOICE_WHEEL.map(([m]) => m));
  const wheel = choiceWheelPayout(lockedStake, maxChoice);
  assert.ok(wheel.pay <= MAX_AWARD, `choice wheel x${maxChoice} pay=${wheel.pay}`);
  const tap = tapPayout(lockedStake, TAP_MAX_TOTAL);
  assert.ok(tap.pay <= MAX_AWARD, `tap x${tap.mult} pay=${tap.pay}`);
});

test("server rejects base stakes above max", () => {
  assert.throws(() => engage({ id: "x", mult: 2 }, 501, 1), /invalid base stake/);
  assert.throws(() => engage({ id: "x", mult: 2 }, 1000, 1), /invalid base stake/);
  assert.throws(() => stakePayoutBonus(501, 0.91), /invalid base stake/);
});
