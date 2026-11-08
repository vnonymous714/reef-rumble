# PR2 authoritative Reef — review revision, NOT deployed

## Corrected integration

The rejected fixed-position prototype has been retired: `candidate.html` redirects to the **original `index.html` shell**, and replacement `candidate.js/css` are removed. The original canvas, detailed reef/fish/cannon sprites, aiming, Bezier swimming, homing/ricochet presentation, auto/lock controls, account gate, store/Telegram invoices, play-through UI and fish guide remain. `authority-bridge.js` delegates only financial/combat decisions to the authenticated Worker. All original assets are byte-compared to `9b0f501` in contract tests.

- Server-owned movement/director restores original weighted species, schools, first boss at35s, first surge at80s and bounded subsequent waves. Crab art now represents Temple Crab, not a combat wheel.
- Accepted launch reserves its actual price; **no damage/capture is decided until the server's shared moving-ellipse collision**. Original-speed homing and ricochets run at bounded1/60 steps, with original7s/14-bounce miss refund. Incompatible locks/over-cap fish cannot absorb a differently priced paid projectile. Its original paid base price survives selected-tier changes and a vanished target.
- A fish locks real HP, actual paid cents and tier on its first accepted physical collision, through capture/escape. Changes apply only to new engagements; locked HP and price are labeled on fish. Capture prize is multiplier×locked actual stake; prizes exceeding400.00 are refused rather than clipped.
- Functional ARC shares one paid expected-value budget across at most3 compatible geometric targets. PLASMA doubles the landed packet, with lower landing frequency.6s activity,12s additional shared cooldown. Prism laser uses real ray geometry; empty aim is free, intersecting ticks are paid, at least90ms apart. Actual +1sec pickups extend its5s duration at most5times. Bomb/eel secondaries share the same budget. Original detailed effects and bounded actual-bomb-capture terrain remain.
- Daily-only temple wheel: authoritative LA calendar day/DST and one claim per account/day, mirrored to linked TG. Recurring FREE100/60s has been removed by explicit user decision: no UI, cooldown, client command or legacy/direct server grant. Existing balances, starting/reset package, paid rebuys/bonuses and daily awards remain.
- Temple capture pays its12× capture separately, then issues an account-owned optional3×3,5-line offer.50%zero/49%1.2×/1%33.2× (Low Tide29.2×). Stakes1/5/10% of confirmed balance, floor0.05, minimum0.10/maximum12.00. Exactly50% NET PROFIT per confirmed spin; maximum398.40. Exact symbol grids agree with five-line evaluation.
- Offers carry server UUID quotes binding exact stake, account sequence/balance, eligibility/source, paytable, tide period,400cap and30s expiry. Purchase changes, tide transitions or expiry require explicit refresh/review/reconfirmation; percentages are never silently recomputed on spin. Conflict snapshots rebuild buttons. Stable buttons avoid touch replacement during a gesture.
- Bonus pause persists through spin settlement/result display and reload, until explicit acknowledgement; timestamps, projectiles, cooldowns, pickups and director all shift on resume. No paid shots are lost or double-settled behind the overlay.
- Canonical account/world sequence CAS + atomic mirror/action/ledger transactions cover combat, daily, purchases and admin adjustments. Fresh TG linking is atomic and cannot pre-create an orphan account. Concurrent fresh TG initialization converges on one canonical account. Synthetic tests only; no protected account mutation or production admin tests.
- Raw client sync/grant authority is **permanently retired in this Worker**, not restored by flag rollback. Missing protocol2 gets426. Disabled authority/maintenance rejects new combat. Existing UI/auth/store code bypasses local delta reconciliation under authority.
- `accounting_events` keeps pre-cutover historical events (historical provenance remains unaudited), excludes subsequent client financial events including unknown anonymous IDs, and uses authoritative gaming/promotion/external ledger categories without purchase duplication. Miss refunds subtract original turnover and are NOT wins. Daily grants remain promotions, not gaming wins; historical refill records remain historical only.
- Primary static resources/manifest/SW use `tg20`; code becomes network-first, APIs never cached, activation navigates controlled legacy documents into the gated shell. Offline is not offline-paid play. This is a branch-only coordinated cutover, not an assertion that already-open old clients have been upgraded in production.

- Paid projectile advancement commits independently before validating a new follow-up command. Losing collision probes, unknown commands and stale followups cannot discard outcomes/RNG. Real D1 exploit regression covers the reported PLASMA probe.
- Play-through counts consumed wagers, not launch reservations. Capped progress survives timeout refunds and concurrent consumed spending. Launches are counted as shots; refunds reduce turnover in their original tide period and never become wins.

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

**Full safe suite:84passed,0failed**; production-format Worker bundle and `git diff --check` pass. Suites combine existing auth/FX tests, exact pure math, real Miniflare/D1 transactions, quote/purchase/tide changes, TG link races, external-writer contention, actual launch→flight→collision/refund, truthful reporting, director/pickup bounds and simulated device races. They are NOT a claim of browser/mobile or50-end-to-end-player verification.

`docs/combat-v2-simulation.json`:32million combat attacks/104cases; Normal/Low Tide aggregate fish value90.9636%/86.9564% versus91%/87% targets. This is seeded pure combat/escape/bankroll evidence, not a full physical HTTP/TG play simulation. `docs/local-v2-load.json` is the historical pre-retention sample; `docs/local-v3-load.json` measures current10-actor direct module/D1 contention and compact receipt payloads, NOT production capacity or RTP. The model's exact expectation identity is tested separately from finite Monte Carlo variation.

**Current no-refill stress:** `node tools/combat-v2-sim.mjs --bankroll-only` reran100×50-player batches with independent seed0x7342a5c1 and NO recurring grants.0/100negative batches; minimum ending virtual house1197.14credits; worst drawdown1135.64credits from an assumed2000credit house. Starting50credits/player are treated as previously funded; daily prizes intentionally uniform/heavier than actual, paid bonus every200shots rather than actual rare-fish frequency; up to1000shots/player and no new reset/rebuy package issuance. These are finite pure-model scenarios, NOT a production forecast, full physical-client simulation, solvency guarantee or cap on total liability. The unchanged32M combat cases were reused, not rerun. The previously failed preserved-FREE counterfactual is obsolete after the explicit user removal.

## QA access / release gates

The isolated Node preview now serves `/index.html` and the original shell, synthesizes same-origin public config, uses only ephemeral local D1/dummy credentials, and injects a **LOCAL ONLY · LOAD SPECIAL-FISH TEST SCENE** button. No console required. It does not expose project config, dotfiles, private files, production API/DB or production fixture routes. Restart discards synthetic accounts. Use new local credentials, never real ones.

**Official isolated HTTPS Preview/UI2 hotfix created:** https://pr2-reef-rumble-pr2-qa.ea-vnonymous.workers.dev . New QA-only D1/schema, no production bindings/secrets/purchases/Telegram/admin access. Fresh staging has only allowlisted original public assets and the alternate test-only entry. Parent completed normal Access browser sign-in; the box's unauthenticated HTTP remains302. Hosted UI2 (dc42 backend, no QA schema change) now fixes queued daily/modal polls, old persisted state intent, confirmed balance display and fixture CAS. Four actual-controller/fake-DOM+local-D1 tests pass against that exact staged bundle; this is not browser visual signoff. No Access policy weakened and no local-route/tunnel retry. See `isolated-qa-preview.md`.

Receipt/storage and executable release artifacts are now implemented: see `retention-protocol.md`, `retention-capacity.json`, `local-v3-load.json`, `executable-release-rehearsal.md` and `cutover-rehearsal.json`. Latest retention/SQL005/tg20 code is LOCAL/PR-only, not published into the existing QA DB/Worker. Original art and no-FREE decision remain unchanged.

Production remains NO-GO pending independent final-diff review, parent mobile/browser/PWA/store/account/TG QA against the final backend, approved actual private backup/liability/payment reconciliation and measured hosted traffic/write-quota envelope. Free quota is not compatible with an indefinite50×5shots/sec promise. No plan upgrade or production change was made. Rollback remains authoritative maintenance on the same DB, NEVER old raw sync.


Final QA3 backend/schema005/tg20 is now hosted on the same official URL; release marker7bfd047-schema005-tg20-UI2, deployment866e6a81-d967-480e-823b-0bdf5f82190e. Supersedes prior branch-only/dc42 notes. See isolated-qa-preview.md for successful migration/deployment evidence and honest Access/CLI verification limits.84tests pass; no production deployment or independent signoff claimed. User authorized Publish; parent's actual final daily/UI test and real restricted backup/reconciliation precede production.
