# Review-fix file manifest

Exact files changed in this revision relative to4915eb3; includes removal of the rejected prototype. Original artwork, production Wrangler config, production DB and unrelated local artifacts are unchanged.

- `auth.js`
- `authority-bridge.js`
- `backoffice.html`
- `candidate.css`
- `candidate.html`
- `candidate.js`
- `docs/authoritative-economy-status.md`
- `docs/combat-v2-simulation.json`
- `docs/local-v2-load.json`
- `docs/preproduction-cutover.md`
- `docs/review-fix-manifest.md`
- `game.js`
- `index.html`
- `manifest.webmanifest`
- `reef-laser-pickups.js`
- `reef-motion.js`
- `slots.js`
- `sw.js`
- `temple-ui.css`
- `tgbridge.js`
- `tools/candidate-contract.test.cjs`
- `tools/candidate-server.mjs`
- `tools/combat-v2-sim.mjs`
- `tools/load-v2-local.mjs`
- `tools/reef-fx.test.cjs`
- `worker/proposals/0004_combat.sql`
- `worker/src/combat-math.js`
- `worker/src/director-v2.js`
- `worker/src/external-writer.js`
- `worker/src/game-v2.js`
- `worker/src/index.js`
- `worker/test/game-v2-d1.test.mjs`
- `worker/test/physical-v2-d1.test.mjs`

## Follow-up relative to205c26ad

Fixes the three reproduced review blockers, removes recurring refills by user decision, and adds the isolated official QA entry/build/isolation regression.69tests pass; no production changes. Hosted Access authentication, retention protocol and executable cutover rehearsal remain gates.

- `auth.js`
- `authority-bridge.js`
- `docs/authoritative-economy-status.md`
- `docs/combat-v2-simulation.json`
- `docs/isolated-qa-http.json`
- `docs/isolated-qa-preview.md`
- `docs/preproduction-cutover.md`
- `game.js`
- `index.html`
- `tgbridge.js`
- `tools/build-qa.mjs`
- `tools/combat-v2-sim.mjs`
- `tools/qa-worker.mjs`
- `worker/proposals/0004_combat.sql`
- `worker/src/game-v2.js`
- `worker/src/index.js`
- `worker/src/tg.js`
- `worker/test/physical-v2-d1.test.mjs`
- `worker/test/qa-isolation.test.mjs`


## UI2 + final retention/rehearsal follow-up relative to dc42ae3

84 tests pass (not84 browser/end-to-end tests). Includes four actual-controller/auth/telemetry fake-DOM + real local D1 UI-flow tests. Hosted UI2 pins dc42ae3 backend with only narrow UI/fixture updates; receipt-protocol3, SQL005 and tg20 remain branch-only pending coordinated final review/QA. The final local regression also caught and repaired a cross-account ledger-delete scope defect before any retention deployment; unequal sequence floors now prove another account's rows/totals remain untouched. Bulk measurement validates every account before/after other actors' compactions.

Complete file scope for this follow-up (including this manifest); original artwork, production config/bindings/accounts unchanged:

- `auth.js`
- `authority-bridge.js`
- `docs/authoritative-economy-status.md`
- `docs/cutover-rehearsal.json`
- `docs/executable-release-rehearsal.md`
- `docs/isolated-qa-preview.md`
- `docs/local-v3-load.json`
- `docs/preproduction-cutover.md`
- `docs/retention-capacity.json`
- `docs/retention-protocol.md`
- `docs/review-fix-manifest.md`
- `game.js`
- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `telemetry.js`
- `tools/build-qa.mjs`
- `tools/candidate-contract.test.cjs`
- `tools/load-v2-local.mjs`
- `tools/measure-retention.mjs`
- `tools/qa-worker.mjs`
- `tools/reef-fx.test.cjs`
- `tools/rehearse-cutover.mjs`
- `tools/release-rehearsal-lib.mjs`
- `worker/proposals/0004_combat.sql`
- `worker/proposals/0005_retention.sql`
- `worker/src/game-v2.js`
- `worker/src/index.js`
- `worker/src/retention.js`
- `worker/test/game-v2-d1.test.mjs`
- `worker/test/local-v2.mjs`
- `worker/test/physical-v2-d1.test.mjs`
- `worker/test/protocol-client.mjs`
- `worker/test/qa-isolation.test.mjs`
- `worker/test/release-rehearsal.test.mjs`
- `worker/test/retention-d1.test.mjs`
- `worker/test/retention-fixture.mjs`
- `worker/test/ui-flow.test.mjs`
