# Isolated official PR2 QA Preview — not production

URL: https://pr2-reef-rumble-pr2-qa.ea-vnonymous.workers.dev

Official `wrangler preview --name pr2 --ignore-base-config` created Preview deployment `ce94fb8c-15ff-4f84-904d-efac5a6639b9` on Nov7,2026 at10:27PM PT. This is a new QA-only resource, NOT the production Worker/Pages.

## Current access blocker

Public HTTPS was tested. Cloudflare Access returns302 to its login; following sign-in without a session fails403/error1010. The Worker health/UI was NOT reachable unauthenticated, and browser QA is NOT claimed. Use the ordinary supported Cloudflare Access sign-in in the parent's browser. Do not bypass Access, weaken an account policy, tunnel or retry the denied local address.

## Isolation

- New D1 `reef-rumble-pr2-qa-db`, UUID `c78bb817-3eba-4620-a9a1-fb9807f20465`; created empty, then only schema migrations0001/0002/proposal0004 applied. No production DB read/write.
- Fresh `/workspace/rr-tg-qa-stage/wrangler.json` contains only this QA DB, ASSETS and TEST_QA=1. No inherited bot/payment/admin/push/service/production bindings or dotenv files. No paid upgrade requested.
- `tools/build-qa.mjs` copies an explicit public allowlist and original tracked art. Worker bundle is separate, not a public asset. No project config/private files are served.
- Alternate `tools/qa-worker.mjs` is not imported by production. It denies signup, account linking, purchases/invoices, admin/webhook/RPC/events; allows only synthetic RR-QA accounts. Telegram SDK and outbound purchase links are disabled in the QA copy; same-origin public config disables PWA registration.
- Local Miniflare QA isolation tests pass. Production entry has no `/qa/session` endpoint.

## Browser flow after Access sign-in

1. Open URL on landscape mobile viewport. Banner says TEST ONLY/NO REAL CREDENTIALS.
2. Click **START NEW TEST SESSION ·1000CREDITS**. Do not enter any real credential. Session belongs only to empty QA D1.
3. Click **SPECIAL-FISH TEST SCENE** to stage original Temple/bomb/Prism/eel sprites with real HP/collision/RNG; capture normally (no free wins or console needed). TOOLS collapses the toolbar.
4. Review original reef/fish/cannon art, movement/aim/bounce/auto/lock, daily temple wheel, ARC/PLASMA timers and geometry, real laser, actual bomb terrain/scar cleanup, Temple five-line bonus and refresh/pause/ack/reload flows.
5. Purchases/TG/account linking/admin must remain disabled. This QA environment deliberately cannot verify real payment/TG/provider flows.

Remaining HTTP checks after Access: `/qa/health` must report testOnly/synthetic/no-production-bindings/no-purchases/no-freeRefills; root includes test controls; original bg/cannon/script files200; synthetic session/state1000credits; fixture200; privileged/refill routes denied. Do not claim these hosted checks passed until run with supported authenticated Access.

## Rebuild / official Preview update

Run `node tools/build-qa.mjs` from repo; inspect generated QA-only config, then run installed Wrangler from the **fresh stage directory**, not repository cwd, with explicit fresh config and `--ignore-base-config`. Never use production config/version uploads/production DB. The currently published content includes review exploit/PT/reporting fixes and removed recurring refills, but receipt-retention/cutover-script gates are still pending.

## UI2 hotfix — Nov7,10:48PM PT

Parent completed normal Access sign-in and observed blocked daily/fixture flows. Preview deployment `2a72687f-3577-459c-8aeb-37af4d13ffb3` keeps **dc42ae3 backend and existing QA DB/schema unchanged**, with narrow UI/fixture fixes only. `--ui-hotfix-dc42` explicitly pins reviewed backend modules; unfinished retention work is NOT in this hosted artifact. `qa-build.json` identifies `dc42ae3-core-plus-UI-fix`.

The actual controller now queues a daily/explicit user action behind in-flight polling (never queues extra paid autofire), stops modal polling churn, does not persist no-op polls as user intent, recovers old persisted state polls without blocking SPIN, and exposes pending/retry feedback. Auth immediately displays its confirmed account balance rather than leaving the local50-credit default while engine bootstrap waits. Legacy client `rr_pending` balance mutation is retired under authority; isolated telemetry sends no `/events`. Canonical admin adjustments still arrive through account snapshots.

The QA scene control awaits controller quiescence before a guarded account/world CAS, never discards an in-flight paid shot, and reloads only on successful fixture commit. Failure resumes polling and gives an explicit retry. Normal concurrent-device conflicts remain real409s, not fake success.

**Parent browser retest:** reload the same URL; START NEW TEST SESSION if wanting a fresh1000-credit synthetic account; SPIN daily gift once, wait for server result, BACK TO REEF; SPECIAL-FISH TEST SCENE; after reload daily remains claimed and the Temple/bomb/Prism/eel scene is playable. No console or new Access credentials required if its session persists. If an older persisted daily request was never accepted, the first click may explicitly clear its declined receipt; RETRY is a new manually confirmed claim, never an automatic extra charge.

Four fake-DOM controller integrations execute the actual staged bundle against isolated local D1: slow poll+daily click+stale state recovery, wheel-open scene+reload+single daily claim, no legacy events/admin RPC, and real auth bootstrap showing confirmed1000 even through a transient engine conflict. This is NOT browser/visual verification. Production untouched, no QA schema migration or account reset performed by deployment.


## Final coordinated QA3 — Nov7,11:18PM PT

Same official URL: https://pr2-reef-rumble-pr2-qa.ea-vnonymous.workers.dev . Preview deployment `866e6a81-d967-480e-823b-0bdf5f82190e`, number3, runs final7bfd047 backend plus QA-only release-marker overlay, schema005, tg20 and UI2. UI banner and `X-Reef-QA-Release` HTML/health header identify `7bfd047-schema005-tg20-UI2`; `/qa/health` JSON and `/qa-build.json` identify the same release. This supersedes the dc42-pinned UI2 deployment above. Only ASSETS, TEST_QA and QA D1c78bb817 are bound.

Reviewed005 import succeeded:9queries,5211rows read,2586rows written,1343488allocated bytes. Existing synthetic sessions/data retained. No production resource, Access policy or privileged route changed.84full regressions pass after QA-marker overlay;14targeted isolation/retention/actual-controller flow tests pass.

Hosted authenticated flow is NOT claimed: the box gets Access302; parent's browser login is not accessible to Shell and was not extracted. The follow-up official CLI schema-metadata query returned7403(account not authorized); it was not rerouted through another API. Migration import and Preview deployment themselves explicitly succeeded. Parent should reload same URL/confirm marker, start TEST session, daily SPIN/result/close/reload, special-fish fixture, real Temple capture→quote/spin/reload/replay and ARC/PLASMA/bomb. No new challenge or Access policy change initiated.

Current subscription read via sanctioned connector returned403: OAuth lacks Billing Read; no alternative credential path attempted. Therefore no new independent account-plan confirmation is claimed. Using the stated Free envelope, current D1 pricing docs specify5Mreads/day,100kwrites/day (indexes count),5GBaccount storage; daily reset currently4PM PT. Other project use shares quota. Source: https://developers.cloudflare.com/d1/platform/pricing/ .

Practical beta OPTIONS ONLY, not implemented shot throttles: begin with one tester/60seconds/max60paid shots at1/sec; then two testers/30seconds/max30shots each at1/sec; only after observed metrics try five testers/20seconds/max10shots each at0.5/sec. These are bounded measurement sessions, NOT certified capacities. Reserve at least half the daily read/write envelope for settlement, other traffic and uncertainty; inspect actual before/after row metrics and remaining account quota before repeating. Paid-shot counts alone cannot budget polls, indexes, archives or bonus operations. Preserve per-shot costs/odds; do not silently impose economics changes or upgrade. Continuous50×5/sec needs at least900klaunch writes/hour before all other work, so cannot be promised on Free.

User subsequently authorized Publish; production remains waiting for parent's actual final daily/modal browser test. Unavailable independent helper is not retried/replaced and no independent signoff is claimed. Real restricted backup/reconciliation and exact deployment steps must precede production; no production operation occurred in this QA deployment.


## UI3 concrete first-frame repair — Nov7,11:48PM PT

Same official URL. Deployment `d24e127b-6efe-4d1a-b869-99391c8de80f`; release `UI3-firstframe-input-schema005-tg20` in TEST banner, health JSON, HTML/health header and qa-build.json. Same QA DB/schema005; no production or account changes. QA script URLs now useqa-ui3 to force one coherent fresh script graph.

Browser proved frames1→1 while all23art assets and canonical balance were loaded. Root: native RAF can execute aftergame.js but BEFOREauthority-bridge.js finishes downloading. drawCannon evaluated an unguarded `window.ReefAuthority.now()` on the comparison's RHS even when its optional LHS was undefined. Render threw beforeHUD and the nextRAF; frozen fallback art/50HUD were the original FIRST frame, not failed original art or overwritten canonical money. Exact Node actual-render callback reproduced the SAME stack before repair; guarded initial clock/world now lets frames continue through bootstrap and confirmedHUD. No catch-and-hide loop patch.

Bounded manual input fixf89d56d retained: explicit pointer shots queue once across polls; AUTO/frame requests never accumulate; queued shots cancel on suspension/session change/modal; mode disabled state uses real cooldown/pending user intent, not background polls.

89full tests pass; five actual original-renderer/controller/full-shell network tests cover delayed authority-script load/missing world, daily→close→shot/HUD, slow polls/single debit, cancellation, cooldown/reload/server expiry and actual auth/telemetry graph. The latter has no400 or legacyRPC/events calls locally. Canvas pixels/image decoding are simulated; this is NOT browser visual signoff.

Browser's repeated400/rr_pending403 were not reproduced in that full graph, so not falsely declared fixed. Freshqa-ui3 cache keys plus an explicit QA telemetry guard prevent stale/early legacy polling. If400 recurs, TOOLS shows Last API rejection with command/status/error/sequence/id-prefix only, no token/account credentials. Backend authority remains strict. Credentialed QA manifest now usescrossorigin=use-credentials per https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest ; no Access policy/session changes.

Parent: reload and confirmUI3, frames increasing/HUD canonical/rich original art, daily result-close→manual shot/AUTO, ARC timer/expiry, Temple fixture/capture/spin/reload. IfAPI rejection remains capture the new safe diagnostic. Production awaits actual browser pass; independent blocked helper not retried/replaced.
