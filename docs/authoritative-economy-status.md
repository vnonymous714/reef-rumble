# PR2 authoritative Reef — review revision, NOT deployed

## Corrected integration

The rejected fixed-position prototype has been retired: `candidate.html` redirects to the **original `index.html` shell**, and replacement `candidate.js/css` are removed. The original canvas, detailed reef/fish/cannon sprites, aiming, Bezier swimming, homing/ricochet presentation, auto/lock controls, account gate, store/Telegram invoices, play-through UI and fish guide remain. `authority-bridge.js` delegates only financial/combat decisions to the authenticated Worker. All original assets are byte-compared to `9b0f501` in contract tests.

- Server-owned movement/director restores original weighted species, schools, first boss at35s, first surge at80s and bounded subsequent waves. Crab art now represents Temple Crab, not a combat wheel.
- Accepted launch reserves its actual price; **no damage/capture is decided until the server's shared moving-ellipse collision**. Original-speed homing and ricochets run at bounded1/60 steps, with original7s/14-bounce miss refund. Incompatible locks/over-cap fish cannot absorb a differently priced paid projectile. Its original paid base price survives selected-tier changes and a vanished target.
- A fish locks real HP, actual paid cents and tier on its first accepted physical collision, through capture/escape. Changes apply only to new engagements; locked HP and price are labeled on fish. Capture prize is multiplier×locked actual stake; prizes exceeding400.00 are refused rather than clipped.
- Functional ARC shares one paid expected-value budget across at most3 compatible geometric targets. PLASMA doubles the landed packet, with lower landing frequency.6s activity,12s additional shared cooldown. Prism laser uses real ray geometry; empty aim is free, intersecting ticks are paid, at least90ms apart. Actual +1sec pickups extend its5s duration at most5times. Bomb/eel secondaries share the same budget. Original detailed effects and bounded actual-bomb-capture terrain remain.
- Daily-only temple wheel: authoritative LA calendar day/DST and one claim per account/day, mirrored to linked TG. Existing100-credit FREE refill/60s cooldown is also server-authoritative and promotional, not gaming winnings.
- Temple capture pays its12× capture separately, then issues an account-owned optional3×3,5-line offer.50%zero/49%1.2×/1%33.2× (Low Tide29.2×). Stakes1/5/10% of confirmed balance, floor0.05, minimum0.10/maximum12.00. Exactly50% NET PROFIT per confirmed spin; maximum398.40. Exact symbol grids agree with five-line evaluation.
- Offers carry server UUID quotes binding exact stake, account sequence/balance, eligibility/source, paytable, tide period,400cap and30s expiry. Purchase changes, tide transitions or expiry require explicit refresh/review/reconfirmation; percentages are never silently recomputed on spin. Conflict snapshots rebuild buttons. Stable buttons avoid touch replacement during a gesture.
- Bonus pause persists through spin settlement/result display and reload, until explicit acknowledgement; timestamps, projectiles, cooldowns, pickups and director all shift on resume. No paid shots are lost or double-settled behind the overlay.
- Canonical account/world sequence CAS + atomic mirror/action/ledger transactions cover combat, daily, refill, purchases and admin adjustments. Fresh TG linking is atomic and cannot pre-create an orphan account. Concurrent fresh TG initialization converges on one canonical account. Synthetic tests only; no protected account mutation or production admin tests.
- Raw client sync/grant authority is **permanently retired in this Worker**, not restored by flag rollback. Missing protocol2 gets426. Disabled authority/maintenance rejects new combat. Existing UI/auth/store code bypasses local delta reconciliation under authority.
- `accounting_events` keeps pre-cutover historical events (historical provenance remains unaudited), excludes subsequent client financial events including unknown anonymous IDs, and uses authoritative gaming/promotion/external ledger categories without purchase duplication. Miss refunds subtract original turnover and are NOT wins. FREE and daily grants are distinct promotions.
- Primary static resources/manifest/SW use `tg19`; code becomes network-first, APIs never cached, activation navigates controlled legacy documents into the gated shell. Offline is not offline-paid play. This is a branch-only coordinated cutover, not an assertion that already-open old clients have been upgraded in production.

## Mathematical contract / limits

Locked multiplierM, paid stakeC, HP quantumU gives real HP=M×U and prize=M×C. A packet consumingk remaining HP units with allocated weightw lands with probabilityR×w/k. Its expected released-or-stored prize value isR×w×C at EVERY remaining HP. Weights sum to1. R=.91 Normal/.87 Low Tide. Mild HP increase caps20%; larger packets land less often, not a free2×DPS claim. Selected base0.10 tier5 costs0.20, HP+20%, packet720 versus tier1's400.

Already-earned partial prize value `(maxHP−HP)/U×C` settles once on escape. This explicit compensation is disclosed in the UI; without it, escapes lower credited return. An ordinary consumed miss does NOT refund, but an unconsumed ricochet timeout does. Pending damage value/projectile escrow remain liabilities, not already-paid wins.

The progressive contributes1% expected value. Joint fish-plus-jackpot award is capped400.00 PER consumed shot: enumerate at most8 capture outcomes, compute expected remaining jackpot award budget, and calibrate jackpot probability against that expectation BEFORE seeing its observed draw. This avoids over-cap joint awards or silently clipping an already-drawn win. Exact cap/expectation regression is included. This cap never bounds aggregate session/house liability. Promotions are outside wagering RTP.

## Evidence / reproduction

```
npm test --prefix worker
npm run sim:candidate --prefix worker
node tools/load-v2-local.mjs
npm run preview:candidate --prefix worker
```

**Full safe suite:63passed,0failed**; production-format Worker bundle and `git diff --check` pass. Suites combine existing auth/FX tests, exact pure math, real Miniflare/D1 transactions, quote/purchase/tide changes, TG link races, external-writer contention, actual launch→flight→collision/refund, truthful reporting, director/pickup bounds and simulated device races. They are NOT a claim of browser/mobile or50-end-to-end-player verification.

`docs/combat-v2-simulation.json`:32million combat attacks/104cases; Normal/Low Tide aggregate fish value90.9636%/86.9564% versus91%/87% targets. This is seeded pure combat/escape/bankroll evidence, not a full physical HTTP/TG play simulation. `docs/local-v2-load.json` measures synthetic local D1 command contention, refund conservation and minimum receipt-payload growth, NOT production capacity or RTP. The model's exact expectation identity is tested separately from finite Monte Carlo variation.

**Material failed stress scenario:** The older100×50-player scenario excluded recurring FREE (and reported0negative batches). The revised separate scenario preserves the actual100-credit FREE immediately/every60s, funded from the SAME assumed2000-credit virtual house, at165ms shot cadence: **100/100batches went negative**, minimum ending−13174.09credits, worst drawdown15213.69credits. These are synthetic assumptions, not a statement about an actual production bankroll or real-money solvency. Initial existing player balances are treated as already funded. This explicitly invalidates any claim that earlier zero-negative results certify the preserved full feature set. FREE was NOT silently reduced/removed. Promotion funding/operating limits require review before any solvency/production claim; wagering RTP calibration alone cannot offset unrestricted promotional issuance.

## QA access / release gates

The isolated Node preview now serves `/index.html` and the original shell, synthesizes same-origin public config, uses only ephemeral local D1/dummy credentials, and injects a **LOCAL ONLY · LOAD SPECIAL-FISH TEST SCENE** button. No console required. It does not expose project config, dotfiles, private files, production API/DB or production fixture routes. Restart discards synthetic accounts. Use new local credentials, never real ones.

**Parent's browser network denied the box address. No more local-address retries/tunnels were attempted. There is NO validated browser-accessible URL yet.** The code can be launched on8089 (or `PORT=8090`) for nonbrowser diagnostics, but this is not proposed as a fix for the denied network. See `preproduction-cutover.md` for an official isolated HTTPS Preview option and its explicit separate-D1 requirement. No hosted preview was provisioned/published in this revision.

Production remains NO-GO until: independent rereview, sanctioned isolated HTTPS hosting, actual mobile/browser visual and PWA/store/account-flow QA, reviewed migration/backup/liability/payment reconciliation, and a sustainable receipt retention/capacity policy. Accepted receipts are currently retained; no unsafe cleanup was enabled. Do not merge/deploy just because unit/model tests pass. Rollback must retain authoritative receipts and a closed maintenance gate, NEVER old raw balance sync.
