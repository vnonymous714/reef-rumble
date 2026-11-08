# Authoritative Reef candidate — PR2, not production

## Integrated review candidate

`candidate.html` → `candidate.js` → authenticated `/api/v2/game` → atomic local D1 world, account/player mirror, action receipt and economy ledger. `GAME_V2=1` is required. It is **off by default**. Production `index.html`, its service worker/cache, original art, Worker configuration and production database are unchanged. This PR does not deploy anything. The old main entry remains the rollback/legacy client until the coordinated post-QA cutover below; reviewing that old URL does not test this candidate.

Implemented in the candidate:

- Daily-only temple wheel: server RNG, Los Angeles calendar day, persisted seven-day streak, one claim per day across retries/devices/reloads. Weighted sectors explicitly disclosed. No combat wheel fish/path exists in this candidate. Legacy gameplay is not silently loaded beside it.
- Real encounter HP, never a fake progress bar or a sampled/revealed kill threshold. First accepted paid attack locks **actual cents charged and tier**, through capture/escape. The controls say changes affect new engagements only. Same fish multiplier pays proportionally to that locked stake: 10× at 0.10 pays 1.00; 0.20 pays 2.00. No unrestricted mixed-stake average.
- Mild HP increase: 5 percentage points per tier above tier 1 plus approximately 2 points per doubling of base stake above 0.10, combined cap 20%; integer HP quantum is rounded once and frozen. New engagements whose prize could exceed 400.00 are refused with a lower-stake message, not silently clipped.
- Functional six-second ARC splits ONE paid expected-value budget across up to three compatible targets; PLASMA concentrates a larger damage packet with lower landing probability. Shared cooldown lasts 12 seconds after activity. Five-second capture-earned laser uses paid ticks (minimum 90 ms), with the same total budget. Bomb/eel targeting shares the budget, not free unaccounted secondary prizes. Original cannon/fish/reef art, detailed weapon plates, branching arcs, beam cores, impact ripples, and bounded actual-bomb-death terrain effects remain presentation-only around these server decisions.
- Temple Crab capture pays its ordinary locked 12× prize separately and issues an account-owned, one-use optional offer. Combat and timers freeze while that offer is open, including reloads. Skip charges nothing. Paid bonus is exactly 3 reels × 3 rows, five classic paylines, one total spin stake. Stakes use 1/5/10% of confirmed spendable balance, rounded down to 0.05, minimum 0.10, maximum 12.00. Unavailable small fractions are disabled, never rounded up.
- Server bonus outcomes: 50% zero, 49% 1.2×, 1% 33.2× (Low Tide 29.2×). **50% net-profit probability**, not merely a hit. Exact grid/paytable evaluation, only Tide Jewel and Temple Relic triples pay. Maximum offered stake yields at most 398.40; no cap distortion of that 50%. No independent incompatible line rolls.
- Existing username/password sessions and signed Telegram initData authenticate the same canonical account. Server balance/HP/payout is never accepted from client input. Atomic account/world CAS, canonical same-ID receipts, account-scoped pending retries, and mirrored linked Telegram balances/sequence/daily state. Generic legacy sync/grant authority is disabled under the candidate flag, even before world enrollment. Protected TG is rejected before new-route player creation. Tests use synthetic local fixtures only.

## Calibration — important behavior, not stronger-weapon marketing

For a locked fish multiplier `M`, stake `C`, HP quantum `U`, real HP is `M*U`; prize is `M*C`. A packet consuming `k` remaining HP units, allocated weight `w`, lands with probability `R*w/k`. Its landed damage is `k*U`. Thus expected prize-value progress is exactly `R*w*C` at **every** remaining HP, including the final hit. Multi-target weights sum to one. R is 0.91 normal or 0.87 Low Tide; independently calibrated progressive adds 0.01 expected return per actual paid stake. Bonus wagers independently target 0.92/0.88. Daily promotional grants are outside wagering RTP.

This deliberately does **not** promise “2× effective DPS plus 2× prize against only 1.2× HP”: that would over-return. At base 0.10, tier 5 costs 0.20, has +20% real HP, and standard landed packet 720 versus tier 1's 400; larger packets land less often. Plasma changes variance and multi-target ARC changes distribution, not free expected damage. Mean paid shots to finish a given multiplier remain calibrated, not halved by a price change.

**Escape compensation is explicit:** already-earned partial capture value `(maxHP−HP)/U*C` is returned when a fish escapes, exactly once, at the next reconciliation. The UI guide discloses this. Unused shots do not acquire value; misses return nothing. Without that compensation, escapes would forfeit stored value and actual long-run credited return would fall below the stated target. Capture plus settled escape value plus remaining server-stored value obeys the expectation identity even under adversarial stopping/target/price selection. Pending value remains an exposure until settled, not realized winnings. Parent should review this visible calibration rule during QA; do not describe it as the old memoryless capture model.

Jackpot meter carries fractional contributions rather than rounding every small shot up/down. Its award probability is `0.01*C/currentAward`, so seeded meter/reset does not inflate the one-percent expectation. The 400 ceiling applies separately to a catch award, spin, or jackpot, **not total house liability or all simultaneous players**.

## Reproduce safely

```
npm ci --prefix worker
npm test --prefix worker
npm run sim:candidate --prefix worker
npm run preview:candidate --prefix worker
```

Preview: `http://localhost:8089/candidate.html` (also listens on `0.0.0.0:8089`). It bundles the actual Worker in Miniflare with in-memory **local-only** D1 and fixed dummy bot credentials. No project Wrangler config, production binding, admin password, remote migration, or real account is loaded. Restart discards all synthetic accounts/worlds. Create a fresh local username/password; do not use production credentials. Static serving is allowlisted; Worker/config/dotfiles return 404. No browser/headless execution was performed by the executor.

For predictable manual visual coverage, after local login only, run this in the parent-controlled browser console:

```
await fetch('/qa/fixture', {method:'POST',headers:{Authorization:'Bearer '+sessionStorage.getItem('rr.candidate.session')}});
location.reload();
```

That **local tool-only** route stages 1000 test credits plus Temple Crab, bomb, laser ray and eel with ordinary full HP and real RNG. It is not in the production Worker or static allowlist. Capture them normally; no fake capture payout is injected. ARC/PLASMA buttons work immediately, then show durations/cooldown. Shoot a partially damaged fish, change price/tier, verify its locked charge/prize/HP stay fixed; engage another to observe the new values. Wait for escape and check one partial-value reconciliation. Capture Temple Crab, inspect all five lines and stake maxima, skip, capture another and spin; reload while paused and after a response to verify recovery. Reduced motion must suppress moving debris/shafts and settling animation without suppressing the server outcome.

## Evidence

- `npm test --prefix worker`: **50 passed, 0 failed**; safe default includes existing auth/FX tests and new pure-math, real-Miniflare D1, full-Worker auth/TG, atomic rollback, same-ID conflicting RNG, 50-device daily contention, one-use spin race, functional specials/laser expiry/cost tests. No live integration scripts run.
- `docs/combat-v2-simulation.json`: seeded **32,000,000 combat attacks**, 104 stake/tier/style/period/adversarial cases. Aggregate fish value (credited plus pending) 90.9636% vs 91% target, 86.9564% vs 87%. Individual finite cases span 86.0816–91.8772%, with approximate intervals recorded, not a promise that every finite sample matches target. Exact state-by-state identity is independently tested.
- Same file: 100 synthetic 50-player bankroll stress batches, up to 1000 shots/player, separately counted progressive/optional bonus, deliberately heavier-than-real uniform daily grants. Starting house 2000 credits; 0 observed negative batches, minimum ending 1386.29, worst drawdown 891.43. **Not a production forecast, solvency bound, or guarantee**; scenario assumptions are embedded. Initial free grants and pending liabilities must not be confused with wager RTP.
- Earlier `docs/temple-simulation.json` remains a separate bonus-only simulation, not full-game validation. `docs/contribution-counterexample.json` records why the rejected mixed-average model was unsafe; the new lock rule replaces it.

## Before production — mandatory handoff, no deploy in this run

1. Parent browser/mobile QA against the integrated local candidate, including terrain, weapon detail, reduced motion, daily wheel and real bonus flow. HTTP/syntax tests are not browser verification.
2. Review `worker/proposals/0004_combat.sql`. It is deliberately **not** an automatic production migration. The older `0003_rewards.sql` prototype is not required by this integrated world model. Back up confirmed balances and plan capacity/retention/load testing for receipts/ledger/worlds; no raw balance authority may be re-enabled to make an old client work.
3. Coordinated maintenance + primary-client/PWA cutover: stop old combat, flush legitimate outstanding legacy client syncs, freeze confirmed server balances, then ship the reviewed candidate as primary using the existing public Worker URL in the `reef-api` meta field, update manifest/service-worker cache together, apply reviewed schema, and enable the server flag. Old cached clients must be gated rather than allowed local paid play that will not settle. The legacy unaudited client-only unconfirmed win history cannot be safely reconstructed as authoritative; do not invent receipts or trust arbitrary imported snapshots. Conservatively seed daily state from existing server `last_daily`, not a client claim amount/streak.
4. Existing production store, PWA shell and admin reporting remain unchanged in this candidate PR. Parent must review integration of the new primary shell with those controls before cutover; this candidate intentionally makes no purchases and does not claim offline paid combat. Offline/failed network means no new accepted server-paid action, not a local balance simulation.
5. Only after QA/review: separately authorized production schema/Worker/static deployment, staged migration checks and public resource verification. Do not merge/deploy merely because model tests pass.
