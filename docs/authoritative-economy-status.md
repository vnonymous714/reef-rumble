# Authoritative economy rewrite — partial milestone, NOT deployable

## Implemented and isolated

- `bonusmath.js`: exact 3-reel/3-row/five-payline grid evaluator and outcome builder. Two paying triple symbols; other symbols decorative. Outcome classes correlated across the grid, explicitly not independent reel/line draws. Each generated win has exactly one winning line, which evaluates to its receipt payout. All five lines together form one total-stake bet.
- Weights out of 200: 100 zero, 98 at 1.2×, two at 33.2× (normal) or 29.2× (Low Tide). Exactly 50% NET-profit probability and exact mathematical 92%/88% gross return for every supported stake, without cap clipping. Stakes 0.10–12.00 in 0.05 increments, proposed fractions 1/5/10%, rounded down; unavailable small stakes return zero, not a silent minimum increase. Highest generated award 398.40.
- `worker/src/reward-math.js`: secure rejection-sampling selector, LA calendar/DST handling, original daily distribution and seven-day streak math. No biased RNG fallback.
- `worker/src/reward-store.js`: un-routed D1 receipt transaction prototype, expected combat sequence check, guarded debit/credit, one-use existing bonus offer, repeated receipt return, protected actor rejection. Tested in an isolated in-memory SQLite adapter and in the actual local Miniflare D1 runtime; no production database used. No clients may supply `claim` directly: future route must authenticate and build it entirely on server.
- `worker/proposals/0003_rewards.sql`: review-only proposed schema, deliberately NOT in applied migrations folder. No database has been migrated.
- `tools/temple-preview.html`: local-only visual/interaction demo with original reef and existing detailed assets. It uses in-memory fake balance and local outcome math; it is NOT server settlement, not the final dramatic daily wheel, and not connected to live combat or accounts.
- `tools/temple-sim.cjs`: seeded bonus-only sampling and synthetic 50-player scenarios. See JSON report. Not evidence of whole-game economy safety.

## Outstanding release blockers (do not describe these as implemented)

1. Real encounter HP, damage-contribution payout, functional arc/plasma and explicit one-budget laser/bomb/chain allocation are not integrated. Existing live game remains memoryless capture with cosmetic ARC/PLASMA. Need a jointly calibrated encounter model, including adversarial switching, escapes, refunds and jackpots.
2. Directly retaining existing capture probability `R * damage / multiplier`, changing reward basis to actual charged cost, then adding only 20% extra resistance gives uncapped fish return `R * damage / 1.2`. At damage 2 and normal R .91 this is 151.67% fish return, before jackpot. This is a diagnostic algebraic counterexample, not a simulation result. Cannot honestly promise target return from that naive rewrite. Raw damage, HP, cost and prize cannot each independently multiply value.
3. A visible real HP model cannot merely sample a hidden geometric kill-count once and expose it as health: players can select cheap-to-kill high-reward encounters. Need adversarial verification, not just whole-encounter average EV.
4. Authoritative reward endpoints are deliberately not routed. Existing generic `/api/sync` accepts client-reported bounded balance delta and `/api/grant` accepts bounded client-chosen daily amount. Must migrate/restrict these old paths with versioning and pending-shot reconciliation before claiming reward authority. A secure bonus endpoint alone would not make the account economy secure.
5. No authoritative encounter receipt/Temple offer issuer exists. Never issue an offer merely because a browser claims to have caught a crab. Existing prototype consumes only a pre-existing offer with verified provenance; test fixtures create dummy offers locally.
6. Canonical account/TG linked-player mirroring, play-through/ledger/event accounting, server spin/daily route authentication, current balance/version responses, reload recovery and stale-client upgrade policy remain to be integrated. The receipt prototype intentionally does not yet update the linked `players` table.
7. Daily-only wheel removal from director, initial spawns, surge, both capture paths, guide and all simulators is pending. Old wheel is unchanged; deleting only the popup would corrupt the expected payout pool.
8. Full temple daily graphics and actual detailed functional weapon/cannon/HUD integration remain pending. Preserve the original assets, not the previous simplified draft.
9. Combat and capped whole-game simulations across stakes/levels/target paths, switching/escapes, confidence intervals, maximum drawdowns and 50-player tails have NOT been run. The bonus-only report must not be represented as them.
10. Browser/mobile touch/performance QA and end-to-end authenticated route/account/TG tests remain required. The isolated receipt prototype now passes actual local Miniflare D1 validation. No production release.

## Offline review

Create a disposable directory containing this preview as index.html, bonusmath.js, reward-math.js and selected original assets under assets/ (bg, gem_b, chest, minnow, tang, jelly, turtle, koi, ray). Serve only that directory on 127.0.0.1. No secrets, auth, connectors or account state belong there. Current prepared copy is /tmp/rr-economy-qa with a local server on port 8088.

Tests:
`node --test worker/test/rewards-v2.test.mjs`
`node --test tools/reef-fx.test.cjs`
`npm test --prefix worker`

Existing auth/integration scripts can contact live services; do not run them without an isolated configuration. No server mutation was performed for this milestone.

## Concrete calibration blocker found in continuation

See `docs/contribution-counterexample.json` and rerun `node tools/contribution-counterexample.cjs`.

The literal damage-weighted average-stake payout is not safe under mid-encounter stake switching, even with HP hidden and same damage per shot. Let N be random required shots for one frozen-health encounter, with E[N]=M/R so constant-stake play returns target R. Charge expensive first shot A, then cheap shots b. Average-stake payout is M*(A+b*(N-1))/N. Then:

`E[payout] - R*E[cost] = (A-b)*(M*E[1/N] - R)`.

Strict Jensen implies this is positive whenever A>b and Var(N)>0. No RNG peeking or visible-health selection is required. A geometric N with M=10 and fish target .91 gives analytic 225.0713% return for first shot 10.00 followed by 0.10, although constant 0.10 play returns 91%. One million seeded encounters measured 225.2102%. All possible prizes are at most 100.00, so the 400.00 cap does not fix it. Low Tide candidate similarly gives 217.5293% analytically / 217.5827% sampled, not 87%.

This is a counterexample to the proposed **price-history-independent random HP/damage + weighted-average stake** model. It is NOT a proof that every possible server-priced combat model is impossible. Price-history-dependent capture/damage or payout rules can compensate, but that changes the advertised fixed health/damage or literal M-times-average-stake rules and must be disclosed. Do not silently add a hidden anti-switch probability adjustment.

Decision needed before wiring that economy: recommended is lock actual shot stake AND weapon tier for each fish encounter until capture/escape. A bet change applies to new engagements; it cannot reprice surviving old progress. Uniform-stake 0.10/0.20 proportional prizes remain, but mid-fish mixed-tier play is deliberately unavailable. Alternate is permit switching and explicitly replace the simple average-stake prize with state-priced contribution entitlements, followed by new paytable/math review. Neither is the literal previously proposed unrestricted weighted-average rule.

Separate necessary balance condition: if rewards scale with actual shot cost, preserving M and R requires unchanged mean paid shots per capture. A net 2x damage /1.2x HP ratio cannot also reduce expected shots and preserve return; it needs proportional HP/resistance, lower effective damage, a different prize, or a changed target. Do not claim effective stronger damage, only slight resistance and identical target return simultaneously without explicit compensation.

Local D1 validation now passes (`node --test worker/test/rewards-d1-local.test.mjs`) using pinned Miniflare's exported compatibility adapter and project's compatibility date 2026-10-01. Verified concurrent duplicate daily claims, one-use offer settlement/replay, sequence rejection, and rollback after an injected transaction error, all with local disposable dummy accounts. No authentication routes or production bindings are loaded.
