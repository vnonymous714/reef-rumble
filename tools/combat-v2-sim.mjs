/* Seeded, offline candidate model. Expected-value proof is independently tested. */
import { readFileSync, writeFileSync } from "node:fs";
import {
  jackpotAward,
  attack,
  potential,
  profile,
  stakePayoutBonus,
  MAX_BASE_STAKE,
  MAX_AWARD,
} from "../worker/src/combat-math.js";
import bonus from "../bonusmath.js";
let seed = 0x1a2b3c4d;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
let serial = 0;
const fish = (mult) => ({
  id: "sim_" + ++serial,
  kind: serial % 11 === 0 ? "bomb" : serial % 13 === 0 ? "chain" : serial % 17 === 0 ? "drill" : "normal",
  mult,
  dead: false,
});
function simulate({ base, tier, style, R, n, adversarial = false }) {
  const cost = Math.round(base * profile(tier, base).costFactor);
  let fishes = [2, 8, 16, 37]
      .filter((m) => Math.round(m * cost * stakePayoutBonus(base, R)) <= MAX_AWARD)
      .map(fish),
    wager = 0,
    paid = 0,
    escape = 0,
    errorSquares = 0,
    maxAward = 0;
  for (let i = 0; i < n; i++) {
    fishes = fishes.map((f) => (f.dead ? fish(f.mult) : f));
    const j = adversarial
      ? fishes.reduce(
          (best, f, k) => ((f.hp || 0) < (fishes[best].hp || 0) ? k : best),
          0,
        )
      : i % fishes.length;
    const before = potential(fishes),
      b = adversarial && i % 2 ? Math.min(MAX_BASE_STAKE, base * 10) : base,
      t = adversarial && i % 3 ? 10 : tier;
    let result;
    try {
      result = attack(fishes, fishes[j].id, b, t, style, R, random);
    } catch {
      result = attack(fishes, fishes[j].id, base, tier, style, R, random);
    }
    fishes = result.fishes;
    wager += result.cost;
    paid += result.payout;
    maxAward = Math.max(maxAward, result.payout);
    const delta = result.payout + potential(fishes) - before;
    const lockedBase = result.updates[0]?.target?.lock?.baseStake ?? b;
    const targetR = R * stakePayoutBonus(lockedBase, R);
    errorSquares += (delta - targetR * result.cost) ** 2;
    if (i % 37 === 36) {
      const v = potential([fishes[j]]);
      escape += v;
      paid += v;
      fishes[j] = fish(fishes[j].mult);
    }
  }
  const pending = potential(fishes),
    returned = (paid + pending) / wager,
    se = Math.sqrt(errorSquares) / wager;
  return {
    base,
    tier,
    style,
    R,
    n,
    adversarial,
    wagerCents: wager,
    paidCents: paid,
    pendingCents: pending,
    escapeCents: escape,
    returnIncludingPending: returned,
    approx95: [returned - 1.96 * se, returned + 1.96 * se],
    maxCombinedCatchCents: maxAward,
  };
}
const bankrollOnly = process.argv.includes("--bankroll-only");
const cases = bankrollOnly ? JSON.parse(readFileSync(new URL("../docs/combat-v2-simulation.json", import.meta.url))).cases : [];
if (!bankrollOnly) {
for (const base of [10, 20, 50, 100, 200, 500])
  for (const tier of [1, 5, 10])
    for (const style of ["normal", "arc", "plasma", "laser"])
      for (const R of [0.91, 0.87])
        cases.push(simulate({ base, tier, style, R, n: 250000 }));
for (const R of [0.91, 0.87])
  for (const style of ["normal", "arc", "plasma", "laser"])
    cases.push(
      simulate({ base: 10, tier: 1, style, R, n: 1000000, adversarial: true }),
    );
}
// Bankroll scenarios combine finite combat sessions, optional paid bonus, daily grants
// and a separately funded progressive. This is exposure evidence, not a guarantee.
const scenarios = [];
// Separate reproducible seed: combat evidence may be reused without rerunning32M draws.
seed = 0x7342a5c1;
  for (let batch = 0; batch < 100; batch++) {
    let house = 200000,
      maxDrawdown = 0,
      peak = house,
      negative = false,
      totalWager = 0,
      totalDaily = 0;
    const ends = [];
    for (let player = 0; player < 50; player++) {
      let balance = 5000,
        jp = 25000,
        carry = 0,
        fishes = [2, 8, 16, 37].map(fish),
        wagered = 0,
        paid = 0;
      const daily = [100, 200, 300, 400, 500, 800, 1000, 1500, 2500, 10000][
        Math.floor(random() * 10)
      ];
      // Deliberately conservative uniform daily prizes (NOT actual weighted distribution).
      balance += daily;
      house -= daily;
      totalDaily += daily;
      for (let shot = 0; shot < 1000; shot++) {
        fishes = fishes.map((f) => (f.dead ? fish(f.mult) : f));
        const target = fishes[shot % 4],
          R = shot % 30 < 5 ? 0.87 : 0.91,
          tier = 1 + (player % 5),
          base = [10, 20, 50, 100, 200, 500][player % 6];
        let a;
        try {
          a = attack(
            fishes,
            target.id,
            base,
            tier,
            ["normal", "arc", "plasma", "laser"][player % 4],
            R,
            random,
          );
        } catch {
          break;
        }
        if (a.cost > balance) break;
        fishes = a.fishes;
        balance += a.payout - a.cost;
        house += a.cost - a.payout;
        wagered += a.cost;
        paid += a.payout;
        carry += a.cost;
        jp = Math.min(40000, jp + Math.floor(carry / 100));
        carry %= 100;
        const jackpot = jackpotAward(
          a.updates,
          ["normal", "arc", "plasma", "laser"][player % 4],
          a.cost,
          jp,
          random(),
        );
        if (jackpot) {
          balance += jackpot;
          paid += jackpot;
          house -= jackpot;
          jp = 25000;
        }
        if (shot % 37 === 36) {
          const value = potential([fishes[shot % 4]]);
          balance += value;
          house -= value;
          paid += value;
          fishes[shot % 4] = fish(target.mult);
        }
        if (shot % 200 === 199) {
          const stake = bonus.stakeFor(balance, [1, 5, 10][player % 3]);
          if (stake) {
            const b = bonus.outcome(
              Math.floor(random() * 200),
              Math.floor(random() * 5),
              stake,
              R === 0.87 ? 88 : 92,
            );
            balance += b.pay - stake;
            house += stake - b.pay;
            wagered += stake;
            paid += b.pay;
          }
        }
        peak = Math.max(peak, house);
        maxDrawdown = Math.max(maxDrawdown, peak - house);
        negative ||= house < 0;
      }
      const remaining = potential(fishes);
      balance += remaining;
      house -= remaining;
      ends.push(balance);
      totalWager += wagered;
      peak = Math.max(peak, house);
      maxDrawdown = Math.max(maxDrawdown, peak - house);
      negative ||= house < 0;
    }
    scenarios.push({
      houseEndCents: house,
      maxDrawdownCents: maxDrawdown,
      wentNegative: negative,
      playerMinCents: Math.min(...ends),
      playerMaxCents: Math.max(...ends),
      totalWagerCents: totalWager,
      conservativeDailyGrantsCents: totalDaily,
    });
  }
const rtpByStake = {};
for (const c of cases.filter((c) => !c.adversarial)) {
  const key = `${c.base}:${c.R}`;
  const g = rtpByStake[key] || { base: c.base, R: c.R, wagerCents: 0, paidPlusPendingCents: 0, n: 0 };
  g.wagerCents += c.wagerCents;
  g.paidPlusPendingCents += c.paidCents + c.pendingCents;
  g.n += c.n;
  rtpByStake[key] = g;
}
const rtpPerStake = Object.values(rtpByStake).map((g) => ({
  baseStake: g.base,
  fishReturn: g.R,
  targetFishReturn: g.R * stakePayoutBonus(g.base, g.R),
  observedReturnIncludingPending: g.paidPlusPendingCents / g.wagerCents,
  shots: g.n,
})).sort((a,b)=>a.fishReturn-b.fishReturn || a.baseStake-b.baseStake);
const output = {
  seed: "0x1a2b3c4d",
  bankrollSeed: "0x7342a5c1",
  combatEvidenceReused: bankrollOnly,
  recurringFreeRefills: false,
  notes: [
    "No production accounts/network. Real combat module, exact lock model.",
    "Capture plus escaped partial value plus pending value conserves the calibrated budget.",
    "Stake-tier fish targets: min bullet 91%/87% rising to ~98%/94% at max bullet (plus ~1% jackpot). Progressive adds expected1% independently; Temple bonus remains 92/88. Daily grants are outside wagering RTP.",
    "Confidence intervals are approximate martingale-normal intervals, not proof or safety bounds. Exact state-by-state expectation is regression-tested.",
    "Bankroll stress:100 synthetic50-player batches×up to1000shots, artificial uniform daily prizes heavier than actual, bonus every200shots (not actual rare fish frequency), starting house2000credits. Not a production forecast.",
    "User removed recurring FREE. No recurring grants; existing opening balances are previously funded, starting/reset packages and paid rebuys are not generated in this finite-session scenario. Daily remains conservative and bonus intentionally more frequent than live.",
    "400 is a shared fish-plus-jackpot cap PER consumed paid shot, or per bonus spin; NOT a cap on aggregate house liability.",
  ],
  cases,
  rtpPerStake,
  bankroll: {
    batches: 100,
    playersEach: 50,
    negativeBatches: scenarios.filter((s) => s.wentNegative).length,
    minEndingHouseCents: Math.min(...scenarios.map((s) => s.houseEndCents)),
    maxDrawdownCents: Math.max(...scenarios.map((s) => s.maxDrawdownCents)),
    scenarios,
  },
};
writeFileSync(
  new URL("../docs/combat-v2-simulation.json", import.meta.url),
  JSON.stringify(output, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      cases: cases.length,
      shots: cases.reduce((s, c) => s + c.n, 0),
      returnRange: [
        Math.min(...cases.map((c) => c.returnIncludingPending)),
        Math.max(...cases.map((c) => c.returnIncludingPending)),
      ],
      rtpPerStake: output.rtpPerStake,
      ...output.bankroll,
      scenarios: undefined,
    },
    null,
    2,
  ),
);
