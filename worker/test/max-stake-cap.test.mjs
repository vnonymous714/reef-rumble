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
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../../engine.js");

/** Max rolled mult for a species def (boss ranges use the high end). */
function maxMult(def) {
  if (Array.isArray(def.m)) return def.m[1];
  if (def.special === "wheel") return Math.max(...E.WHEEL.map((s) => s.m));
  return def.m || 0;
}

test("max base stake is 50 and client BETS ladder tops there", () => {
  assert.equal(MAX_BASE_STAKE, 50);
  assert.deepEqual(E.BETS, [10, 20, 50]);
  assert.equal(E.MAXBET, 50);
});

test("every fish/boss max prize at max stake and LV10 stays <= 400.00", () => {
  const tier = 10;
  const costFactor = profile(tier, MAX_BASE_STAKE).costFactor;
  assert.equal(costFactor, 2);
  for (const R of [0.91, 0.87]) {
    const pf = stakePayoutBonus(MAX_BASE_STAKE, R);
    assert.ok(R * pf < 1, `RTP must stay under 100% at max stake R=${R}`);
    for (const def of E.FISH) {
      const mult = maxMult(def);
      if (!(mult > 0)) continue; // chest special uses wheel EV path
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

test("server rejects base stakes above max", () => {
  assert.throws(() => engage({ id: "x", mult: 2 }, 51, 1), /invalid base stake/);
  assert.throws(() => engage({ id: "x", mult: 2 }, 100, 1), /invalid base stake/);
  assert.throws(() => stakePayoutBonus(100, 0.91), /invalid base stake/);
});
