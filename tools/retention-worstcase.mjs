/* Worst case for the house: every boost on at once (return pinned to the 0.97
 * cap), max base stake 5.00 at weapon LV10 (10.00 a shot), relic bonus fresh. */
import { session, rng32, CANDIDATES } from "./retention-sim.mjs";
const n = +(process.argv[2] || 1000), seed = 777;
const pinned = { normal: 0.97, lowTide: 0.97, cushion: null, streak: null, newPlayer: null };
const out = {};
for (const [name, cand] of Object.entries({
  live_max: CANDIDATES.A_live,
  steady_tide_max: CANDIDATES.L_steady92,
  steady_tide_double_max: CANDIDATES.M_steady92_double,
  steady_tide_welcome_max: CANDIDATES.L_steady92_new,
  pinned_cap: { label: "all boosts at cap", policy: pinned },
  pinned_cap_double: { label: "all boosts at cap + double", policy: pinned, double: true },
})) {
  const r = rng32(seed); let W = 0, P = 0, maxWin = 0;
  for (let i = 0; i < n; i++) {
    const s = session(cand, r, { mode: "bankroll", start: 1e9, base: 500, tier: 10, cap: 2000, t0: i * 7919000 });
    W += s.wager; P += s.paid; maxWin = Math.max(maxWin, s.maxShotPay);
  }
  // 5.00 max base bet: the server refuses anything above it.
  let refused = false; try { session(cand, rng32(1), { mode: "bankroll", start: 1e9, base: 501, tier: 10, cap: 5 }); } catch (e) { refused = /invalid base stake/.test(e.message); }
  out[name] = { refusedBase501: refused, rtp: +(P / W).toFixed(4), shots: n * 2000, maxSingleSettleCredits: maxWin / 100 };
  console.log(name, JSON.stringify(out[name]));
}
