# PR2 cutover / rollback / isolated QA — production NOT EXECUTED

## Official browser-accessible QA route

The box-address403 is a network policy, not a reason to tunnel. No additional browser-address retries or tunnels are permitted. A local HTTP200/HEAD200 is NOT browser QA.

Official Cloudflare **Worker Previews** provide an HTTPS branch environment. Installed Wrangler4.156.0 supports the documented minimum4.135.0. Sources opened this revision:
- https://developers.cloudflare.com/workers/previews/
- https://developers.cloudflare.com/workers/previews/compare-workflows/
- https://developers.cloudflare.com/workers/previews/resources/

**Do not use `wrangler versions upload`/Version URLs for QA: they use production resources.** D1 is NOT automatically isolated: a Preview shares rows whenever its `database_id` matches production. Existing Worker Preview defaults can inherit secrets/bindings. Therefore do not invoke Preview on the production project config.

Created isolated resources: dedicated QA Worker `reef-rumble-pr2-qa`, separate QA D1 `reef-rumble-pr2-qa-db`, with no production route/domain/secrets/bindings or inherited Worker defaults. The original empty QA DB now contains synthetic QA sessions only. See `isolated-qa-preview.md` for exact URL/deployment. Parent completed normal Access sign-in. The hosted UI2 hotfix still pins dc42ae3 backend/schema; latest receipt-protocol3/SQL005 code is not hosted. A separate fresh staging directory uses public-file allowlisting and synthetic same-origin config; no private/project/production configuration or backoffice is published. QA fixture controls exist only in the QA response/entry; purchases, linking, admin, webhook and outbound Telegram are disabled. No Access policy was weakened. Parent browser retest and coordinated FINAL-backend QA remain mandatory.

Browser acceptance: initial gate, signup/login/logout/account switching, original swimming/schools/boss/surge, touch aim/lock/auto, charge-before-flight/collision-after-flight, missed-shot refund, price/tier locks, real ARC/PLASMA/laser and +1s pickups, bomb-only terrain, low/reduced motion, daily one-claim across reload/two devices, Temple skip/quote expiry/purchase/tide change/reconfirm/spin/result acknowledgement, pending reload recovery, store/TG shell and PWA upgrade/offline denial. No production account/payment/admin test.

## Mandatory maintenance / schema review

1. Independent rereview and real browser/mobile QA must pass. Keep PR draft and production unchanged meanwhile.
2. Review full `0004_combat.sql` against a private local copy of the real schema. It is proposal-only, not automatic migration. `0003_rewards.sql` prototype is not part of this model. Preserve existing store/admin functionality and IDs; never touch protected TG rows.
3. Schedule coordinated maintenance. Stop legacy play; give legitimate old clients time to settle already-authorized existing syncs BEFORE the authority boundary. The legacy client had no trustworthy server receipts for arbitrary unconfirmed local wins/projectiles. Do not fabricate these as canonical awards or import arbitrary local wallet snapshots. Report that reconciliation limit explicitly.
4. Private encrypted backup/export of ALL relevant existing tables, payment charge IDs, pending admin commands, daily/refill state and account links, plus a verified restore rehearsal in isolated local D1. Never commit/export private records or credentials into the public repository/preview. No backup/remote DB access was performed here.
5. Capture pre-cutover totals: accounts/player mirrored balances and sequences, bonus/play-through, last_daily/refill, charges/credited status, unapplied legacy admin commands. Resolve mirror/owner mismatches in review; do NOT mass-update accounts or protected users as a shortcut. Preserve charge-ID dedupe and existing accepted payments.
6. Apply the reviewed schema ONLY under the settled maintenance boundary; its `economy_config.cutover_at` is that boundary. Historical client events before it remain labeled historical/unaudited; later financial authority is exclusively the new ledger. Daily claims seed only from existing server last_daily, never arbitrary client amount/streak. Legacy local-only streak cannot be proven; initial authoritative streak resets rather than trusting a forged claim.
7. New Worker has permanently closed raw sync/grant routes. Use `GAME_V2=1` and `GAME_MAINTENANCE=1` during cutover. Maintenance refuses new combat/invoices; existing verified payment notifications still settle in the canonical deduplicated ledger. Do not disable canonical authority to accommodate cached clients. Protocol2 header is mandatory; obsolete clients receive426. Keep auth/account reads available.
8. Deploy reviewed Worker and coordinated original primary shell/index/manifest/SWtg20. Verify network-first code, noncached API, activation-driven legacy navigation and explicit offline/maintenance refusal. Newly accepted paid actions must NEVER fall back to local money/RNG. Preserve public API origin for production; QA uses only QA origin.
9. Remove maintenance only after schema/backup/reconciliation/resource checks pass; verify before/after totals and new synthetic-free transaction observations. No new real test accounts, protected account changes or unapproved actual purchases are required.

## Accounting / reconciliation invariants

For each canonical account after enrollment:
`balance = opening confirmed balance + Σ(live ledger + archived financial totals: payout − wager + external_delta)`.
`payout` includes gaming payouts, promotions and unconsumed-shot refunds; reporting splits those categories. Net gaming turnover is `Σ(wager − wager_refund)`, gaming wins exclude refunds/daily/historical refill/external credits. Both sides must match the account and linked-player mirror/sequence. Do not sum legacy financial events after the cutover or duplicate server purchase events.

Outstanding exposure additionally includes every paid in-flight projectile stake, earned partial fish value `(maxHP−HP)/hpUnit×lockedStake`, unconsumed eligible bonus offers, accepted pending/settled receipts and outstanding verified payment/admin operations. A cap on one award is NOT a cap on aggregate liability. Reporting groups cashflows by settlement time; it is not a causal per-period RTP cohort estimate when flights/escapes cross tide boundaries.

Read-only local audit queries (schema fields reviewed; parameterized account filters where needed):
```sql
SELECT COUNT(*),SUM(balance),SUM(bonus),SUM(pt) FROM accounts;
SELECT SUM(wager),SUM(wager_refund),SUM(payout),SUM(external_delta),SUM(gaming_payout),SUM(promo_credit) FROM (
 SELECT wager,wager_refund,payout,external_delta,gaming_payout,promo_credit FROM economy_ledger
 UNION ALL
 SELECT wager,wager_refund,payout,external_delta,gaming_payout,promo_credit FROM economy_archive
);
SELECT account_id,COUNT(*) FROM economy_actions WHERE status<>'settled' GROUP BY account_id;
SELECT a.id,a.sync_seq,p.sync_seq FROM accounts a JOIN players p ON p.tg_id=a.tg_id WHERE a.balance<>p.balance OR a.bonus<>p.bonus OR a.pt<>p.pt OR a.sync_seq<>p.sync_seq;
```
World/projectile liabilities must also be computed from parsed authoritative state; SQL account balances alone do not prove solvency. Compare backup hashes/counts before/after migration and rehearse receipt replay/unique charges/atomic rollback on a private isolated copy.

## Promotion-funding stress is also a release gate

The user explicitly removed recurring FREE100/60s. UI/cooldown/command/legacy grants are disabled, while historical grant state and existing balances remain. Starting/reset packages, paid rebuys/bonuses and the daily wheel are preserved. The no-refill100×50-player seeded model rerun had0negative batches, minimum ending virtual house1197.14credits and worst drawdown1135.64credits from an assumed2000credit house. Daily prizes are deliberately conservative/uniform; bonus frequency is artificial; opening balances are treated as funded. This is finite model evidence, not solvency certification or production-capacity evidence.

The official isolated Preview now exists; see `isolated-qa-preview.md`. Parent authenticated normal Access and reported real daily/fixture failures; the UI2 hotfix was isolated and published for retest. The box remains unauthenticated302, not HTTP200/browser acceptance. Retention and executable synthetic rehearsals are implemented below, but final independent review, final-backend hosted QA and real cutover remain gates. No production resource or Access policy was changed.

## Implemented retention and executable local release proof

See `retention-protocol.md` and `executable-release-rehearsal.md`. Revision-bound IDs, immutable intent hashes, range tombstones, atomic conserved archive, bounded exact top-win witnesses, archive-failure fail-closed behavior and latest-only empty-target restore are implemented and regressed. Synthetic50-actor105000-record storage measurement and actual10-actor compact-receipt sample are committed; these are not hosted capacity proof. Full pre-cutover historical events and external/payment identities are retained. Older high-volume game history is aggregate audit, not unlimited individual forensic history.

Actual private production backup/migration/provider cutover remains unexecuted. Final review, browser/mobile/PWA/store/TG checks, pending-payment/liability reconciliation and hosted operating/quota envelope remain mandatory. Do not infer storage compaction solves50-player free-tier throughput/write limits. No paid upgrade authorized or performed.

## Rollback (never raw-authority rollback)

On anomaly, set maintenance on the NEW authoritative Worker; refuse new paid actions, preserve all canonical balances, worlds/projectiles, action receipts, ledger, claims and payment IDs. Keep verified outstanding purchase settlement deduplicated; reconcile receipts before any further changes. Serve a maintenance shell if UI rollback is needed. Restore an old UI only as read-only/maintenance, never against raw sync/grant. Do not point to the old client-authoritative Worker, set flags to restore local deltas, drop new tables, erase accepted receipts, or restore a stale DB snapshot over accepted post-cutover operations. Restore/forward-fix must replay preserved accepted receipts/payment IDs and reconcile liabilities; rehearse before approval.
