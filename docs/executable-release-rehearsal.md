# Executable cutover / restore / rollback rehearsal (synthetic only)

Run:
```
node tools/rehearse-cutover.mjs
node --test worker/test/release-rehearsal.test.mjs
```

`tools/release-rehearsal-lib.mjs` refuses non-synthetic/protected account/player data. It never discovers credentials, reads a real DB, loads production Wrangler config, performs a remote deploy, or overwrites a nonempty target. The CLI creates ephemeral Miniflare source and empty restore D1 bindings. `docs/cutover-rehearsal.json` records executed evidence, not a production backup claim.

Executed steps:
1. Seed a synthetic confirmed opening balance; apply reviewed proposals0004/0005 twice. Original cutoff marker and existing balances remain unchanged.
2. Capture a full schema/table/SQLite-sequence snapshot with SHA-256. Exercise a real daily claim, exactly-once trusted synthetic external adjustment, preserved synthetic payment identity, paid physical projectile and paused eligible offer/quotes.
3. Reconcile opening balance + live/archive payout−wager+external delta against each wallet and linked mirror. Identify in-flight stakes, unconsumed offers, pending results, uncredited charges, unapplied legacy admin work and pending imported receipts. Unresolved payment/admin/receipt work blocks readiness; no balance-reset shortcut.
4. Verify **same-DB authoritative maintenance rollback** rejects all four money/invoice paths503 without changing any snapshot byte. This is not switching to old Worker code, raw sync or client RNG. Existing accepted liabilities/receipts stay intact.
5. Refuse the older pre-tail backup and a nonempty restore target. Restore the latest checksum-matching snapshot into a NEW EMPTY local D1, including autoincrement counters, accounts, bonus/PT, mirrors, worlds, claims/quotes, accepted receipts, range tombstones/archive, charge IDs, session hashes and legacy records. Verify identical complete snapshot hash and financial reconciliation.
6. Recover the accepted daily without a second award, preserve the paused offer/quote and paid-shot escrow, explicitly skip/resume, then refund the restored unconsumed projectile once. Receipt retry does not refund it twice.

## Real cutover — NOT executed

The executable rehearsal adapters intentionally cannot be aimed at production. Reviewed SQL proposals are idempotent and preserved in `worker/proposals/0004_combat.sql` and `0005_retention.sql`; use the official approved D1 export/migration tools for a real encrypted backup/apply only after signoff. Do not publish private SQL/records to Pages/QA/this repository.

Required operator sequence after explicit deployment approval: authoritative maintenance gate; private complete encrypted backup/verified restore and protected-row unchanged check; reconcile outstanding receipts/payment IDs/claims/legacy admin/escrow; apply004 then005; verify schema/cutoff and wallet/mirror totals; reviewed Worker with raw sync/grants permanently retired; coordinated tg20 index/manifest/network-first service worker (scope restricted to Reef, not sibling projects); authenticated smoke/PWA/store/TG checks; then release maintenance within verified operating limits.

If anything fails, keep NEW authoritative maintenance on the SAME DB. Preserve every accepted receipt, sequence floor, world/escrow and charge ID. Never restore a stale snapshot over post-backup accepted operations, erase tails, reenable old sync/grants, reset balances, or silently drop admin/store features. A disaster restore remains quarantined until a newest accepted-tail/current-source reconciliation proves it safe; the rehearsal's fingerprint check does not authorize arbitrary production restore/rerouting or solve provider traffic cutover by itself. No production backup/migration/provider settlement was performed here.
