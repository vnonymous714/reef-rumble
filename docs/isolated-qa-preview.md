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
