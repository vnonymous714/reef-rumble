# Authoritative economy rewrite — partial milestone, NOT deployable

## Implemented and isolated

- `bonusmath.js`: exact 3-reel/3-row/five-payline grid evaluator and outcome builder. Two paying triple symbols; other symbols decorative. Outcome classes correlated across the grid, explicitly not independent reel/line draws. Each generated win has exactly one winning line, which evaluates to its receipt payout. All five lines together form one total-stake bet.
- Weights out of 200: 100 zero, 98 at 1.2×, two at 33.2× (normal) or 29.2× (Low Tide). Exactly 50% NET-profit probability and exact mathematical 92%/88% gross return for every supported stake, without cap clipping. Stakes 0.10–12.00 in 0.05 increments, proposed fractions 1/5/10%, rounded down; unavailable small stakes return zero, not a silent minimum increase. Highest generated award 398.40.
- `worker/src/reward-math.js`: secure rejection-sampling selector, LA calendar/DST handling, original daily distribution and seven-day streak math. No biased RNG fallback.
- `worker/src/reward-store.js`: un-routed D1 receipt transaction prototype, expected combat sequence check, guarded debit/credit, one-use existing bonus offer, repeated receipt return, protected actor rejection. Tested in an isolated in-memory SQLite adapter; NOT Cloudflare runtime integration tested. No clients may supply `claim` directly: future route must authenticate and build it entirely on server.
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
10. Browser/mobile touch/performance QA, Miniflare/D1 runtime and end-to-end account/TG tests remain required. No production release.

## Offline review

Create a disposable directory containing this preview as index.html, bonusmath.js, reward-math.js and selected original assets under assets/ (bg, gem_b, chest, minnow, tang, jelly, turtle, koi, ray). Serve only that directory on 127.0.0.1. No secrets, auth, connectors or account state belong there. Current prepared copy is /tmp/rr-economy-qa with a local server on port 8088.

Tests:
`node --test worker/test/rewards-v2.test.mjs`
`node --test tools/reef-fx.test.cjs`
`npm test --prefix worker`

Existing auth/integration scripts can contact live services; do not run them without an isolated configuration. No server mutation was performed for this milestone.
