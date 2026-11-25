/* Warm Tide worst case by bet size (play credits). Bankroll mode (no quitting),
 * 2000-shot sessions, every bet size up to the 5.00 max base at LV10 (10.00 a
 * shot), with and without double-shot bursts, and with every boost pinned at
 * the 0.97 cap. Reports RTP and the largest single settle (must be <= 400.00).
 * Usage: node tools/tide96-worstcase.mjs <base> [tier] [n] */
import { session, rng32, CANDIDATES } from "./retention-sim.mjs";
import { WARM_TIDE_WEIGHTS } from "../worker/src/spawn-mix.js";
const base = +(process.argv[2] || 500), tier = +(process.argv[3] || 10), n = +(process.argv[4] || 1000);
const pinned = { normal: 0.97, lowTide: 0.97, cushion: null, streak: null, newPlayer: null };
const set = {
  steady_tide: CANDIDATES.L_steady92,
  warm_tide: CANDIDATES.W_warm,
  warm_tide_double: CANDIDATES.W_warm_double,
  warm_lowbal: { ...CANDIDATES.W_warm, lowStart: true },
  pinned_cap_mix: { label: "all boosts at cap, warm mix", policy: pinned, mix: WARM_TIDE_WEIGHTS },
  pinned_cap_mix_double: { label: "all boosts at cap, warm mix, double", policy: pinned, mix: WARM_TIDE_WEIGHTS, double: true },
};
const out = { base, tier };
for (const [name, cand] of Object.entries(set)) {
  const r = rng32(777 + base); let W = 0, P = 0, maxWin = 0;
  for (let i = 0; i < n; i++) {
    // warm_lowbal: start under the Lifeline line so Lifeline stays on as long as possible
    const s = session(cand, r, { mode: "bankroll", start: cand.lowStart ? 1999 : 1e9, base, tier, cap: 2000, t0: i * 7919000 });
    W += s.wager; P += s.paid; maxWin = Math.max(maxWin, s.maxShotPay);
  }
  out[name] = { rtp: +(P / W).toFixed(4), shots: W ? Math.round(W / (Math.round(base * Math.min(2, 1 + (tier - 1) * 0.25)))) : 0, maxSingleSettleCredits: maxWin / 100 };
}
let refused = false; try { session(CANDIDATES.W_warm, rng32(1), { mode: "bankroll", start: 1e9, base: 501, tier: 10, cap: 5 }); } catch (e) { refused = /invalid base stake/.test(e.message); }
out.refusedBase501 = refused;
console.log(JSON.stringify(out));
