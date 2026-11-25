/* Steady Tide payout policy (play credits only; no cash-out).
 * Chooses the per-shot fish return R. Every lever is bounded so that the
 * expected return of ANY shot, including the bigger-bullet payout bonus,
 * stays <= RETURN_CAP (0.97). With the 1% jackpot that is <= 98% worst case.
 * Levers are disclosed to players in the paytable ("Lifeline", "Second Wind").
 *   - base: normal 92%, Low Tide 88% (was 91% / 87%)
 *   - Lifeline: +3 pts while balance < 15.00 credits
 *   - Second Wind: +5 pts after 10 straight paid shots with no payout,
 *     until the next payout
 *   - Welcome tide (+2 pts, first 7 days) is supported but OFF: it pushed
 *     simulated RTP past the 88-94% band.
 * Bonuses stack, then clamp to the cap. */
export const RETURN_FLOOR = 0.8;
export const RETURN_CAP = 0.97;
export const STAKE_LIFT = 0.07;
export const LIVE_TG35 = Object.freeze({ normal: 0.91, lowTide: 0.87, cushion: null, streak: null, newPlayer: null });
export const STEADY_TIDE = Object.freeze({
  normal: 0.92,
  lowTide: 0.88,
  cushion: Object.freeze({ below: 1500, add: 0.03 }),
  streak: Object.freeze({ after: 10, add: 0.05 }),
  newPlayer: null,
});
/* Warm Tide: target ~96% overall with more frequent wins.
 *   - base: normal 95%, Low Tide 91% (was 92% / 88%)
 *   - Lifeline: +2 pts while balance < 20.00 credits (was +3 under 15.00)
 *   - Second Wind: +2 pts after 8 straight paid shots with no payout (was +5 after 10)
 *   Boosted shots still clamp at RETURN_CAP 0.97, so the worst case (cap +
 *   1% jackpot) is unchanged at <= 98%. Paired with the small-fish spawn mix
 *   in spawn-mix.js (more frequent hits, fewer rare giants). */
export const WARM_TIDE = Object.freeze({
  normal: 0.95,
  lowTide: 0.91,
  cushion: Object.freeze({ below: 2000, add: 0.02 }),
  streak: Object.freeze({ after: 8, add: 0.02 }),
  newPlayer: null,
});
export const WELCOME = Object.freeze({ days: 7, add: 0.02 });
export const ACTIVE_POLICY = WARM_TIDE;
const DAY = 86400000;
export const round4 = (x) => Math.round(x * 10000) / 10000;
export function isValidReturn(r) {
  return Number.isFinite(r) && r >= RETURN_FLOOR && r <= RETURN_CAP && round4(r) === r;
}
/** ctx: { balance (cents), missStreak (paid shots since last payout), createdAt, now } */
export function effectiveReturn(period, ctx = {}, policy = ACTIVE_POLICY) {
  let r = period === 88 ? policy.lowTide : policy.normal;
  const { balance, missStreak, createdAt, now } = ctx;
  if (policy.cushion && Number.isFinite(balance) && balance < policy.cushion.below) r += policy.cushion.add;
  if (policy.streak && Number.isFinite(missStreak) && missStreak >= policy.streak.after) r += policy.streak.add;
  if (policy.newPlayer && Number.isFinite(createdAt) && Number.isFinite(now) && now - createdAt < policy.newPlayer.days * DAY)
    r += policy.newPlayer.add;
  r = round4(Math.min(RETURN_CAP, Math.max(RETURN_FLOOR, r)));
  if (!isValidReturn(r)) throw new Error("invalid return");
  return r;
}
