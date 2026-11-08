# Revision-bound receipts / conserved financial archive

Status: hosted in isolated QA3 (see isolated-qa-preview.md), NOT deployed to production. QA3 supersedes the earlier dc42-pinned UI2 hotfix. Transport remains `X-Reef-Protocol: 2`; action-identity protocol is3, exposed in state and `/api/client-version`. Static cutover is prepared as tg20.

## Acceptance and recovery

- A new client intent uses `originalAccountSequence_randomNonce`. The prefix must equal its immutable submitted sequence; a new execution must match the canonical current sequence. Client-selected future/stale sequences cannot invoke new-world RNG or spend. Canonical request fields plus ORIGINAL sequence are SHA-256 bound.
- A paid physical-flight reconciliation commits in a separate CAS transaction before validating a follow-up. Its requested intent keeps its original sequence/hash even if this internal barrier advances the commit sequence. Invalid probes cannot discard/reroll a losing collision.
- A same-ID duplicate returns only the accepted winner's compact financial receipt and current canonical snapshot. A validation race rechecks for that winner using **recovery-only**, never reexecutes rejected intent/RNG. `replayed` distinguishes it. Nonsettled imported receipts are quarantined, not treated as accepted funds.
- Recent receipts retain exact daily/bonus results and bounded launch/financial summaries, not world snapshots or moving effects. Ordinary successful responses still deliver the full committed visual events. Retry never replays visual/audio impact effects as a new shot.
- Only explicit user intents enter sessionStorage. Polls do not. Reconnection sends `recoverOnly`; an unknown/declined request requires manual new confirmation, never an automatic new debit. Bootstrap/discovery reads existing worlds without financial advancement; the next sequence-bound state request settles pending physical outcomes once.
- Each account has a monotonic `floor_seq` range tombstone and cumulative SHA-256 archive head. A deleted action below the floor returns **410 / `receipt_expired`**, not a new application, including altered submitted sequences/parameters. The client discards only that expired intent and refreshes confirmed state; it does not repeat the charge.
- New protocol identities cannot remint arbitrary old UUIDs. Pre-protocol accepted UUID-only receipts and external/payment dedupe identities remain durable forever. A retained receipt can still acknowledge an older original sequence when its independent-flight barrier committed at a newer revision; watermark rejection governs missing identities, not a second application of known receipts.

## Atomic compaction and bounds

`worker/src/retention.js`: keep512 recent canonical revisions per account; trigger beyond512+32; retire at most128 rows/transaction. A unique compaction token plus prior-floor/head/current-account-sequence CAS prevents two compactors from adding the same aggregate twice. Archive insertions, financial totals, exact-top-win witnesses, watermark/head and receipt/ledger deletions are one D1 `batch()` transaction. Any archive failure rolls everything back; no naive UUID TTL.

Raw high-volume game ledger rows retire ONLY with corresponding settled `h3:` receipts. Every wager, actual payout, original-tide refund, gaming win, promotion/external delta, shot count and operation count is preserved in `economy_archive`. Wallets, mirrors, bonus/play-through, worlds, in-flight escrow, offers/quotes/results, daily state, old event history, payment charge IDs and external receipts are not deleted. Reporting never adds refund credit twice or treats it as a win.

Minute rollups are retained24h; daily rollups90d; older rows merge into lifetime account/kind/tide totals. Live+archived sums exactly equal precompaction totals. Reporting windows are explicitly whole-minute aligned, not second-precision historical slices. Archived IDs are negative, so they cannot jump the positive live-feed cursor. The recent individual-event feed is finite; the financial overview is lifetime-complete. Older history is aggregate audit, NOT indefinite per-shot forensic history. The cumulative digest attests the retired chain but cannot reconstruct deleted individual details or supply an inclusion proof by itself.

Exact largest settlement witnesses are preserved separately: at most10 per minute globally, within the rolling whole-minute24h ranking window (at most14,410 witnesses), plus live individual rows. `rr_top` uses these exact settlements, never a minute's summed winnings presented as one award. State settlements may combine multiple captures/earned escapes; they are labelled settlements, not single-fish jackpots. The400 cap remains per paid-shot combined award or bonus spin, not per state update/house liability.

On archive failure, new intents fail503 before charge. Accepted-flight/earned-escape liabilities may drain once; idle polls then freeze read-only with `storagePaused`, preventing unbounded outage polling receipts. Accepted receipt recovery remains available. A restored DB must retain the range tombstones and canonical sequences; resetting them is forbidden.

## Executed local evidence

- `worker/test/retention-d1.test.mjs`: real local D1 expired daily/slot recovery, exact bonus grid/result after reload, unknown/stale/future/substituted identities, simultaneous winning receipt/compactors, archive failure atomicity, accepted flight/earned escape drainage during outage, original-tide refunds, reporting totals, old UUID/external identities, quarantined pending imports, exact top-ten witness conservation, cross-account deletion isolation at unequal sequence floors and idempotent schema reruns.
- `node tools/measure-retention.mjs`:50 actors, three rounds/105,000 bulk **seeded** financial records. This is not105,000 API commands. `docs/retention-capacity.json` contains allocated SQLite bytes from supported D1Result metadata, bounded row counts and exact unchanged totals. PRAGMA page_count was denied; no raw database-file workaround was used.
- `node tools/load-v2-local.mjs --quick`:10 concurrent synthetic actors,70 direct module+D1 commands/50 reserved shots, all500cents refunded,110 receipts, average254.82bytes/max292 for this miss/refund sample. Not HTTP/TG/mobile/production throughput. A slot-result receipt can be larger. Sample logical512×50 receipt payload is about6.52MB, excluding world/index/archive/immutable external history. The bulk allocator sample uses smaller synthetic receipts; do not present its footprint as an all-workloads upper bound.
- Unchanged32M combat math evidence was NOT rerun. FREE remains removed; daily/start/reset/paid packages are unchanged.

## Capacity and operator gates

Retention bounds high-volume history, not the number of accounts or immutable payment identities. It does NOT prove50-player hosted throughput, unlimited liabilities, or indefinite operation on Free quotas. Current Cloudflare docs: Free D1 has500MB/database,5million rows read/day and100,000 rows written/day; a `batch()` counts as one invocation query but each statement's row/index writes still count. At50×5paid shots/sec,900,000 launch-ledger inserts/hour alone exceed the Free daily write quota, even before other writes. No plan upgrade/spending change was made or inferred. Confirm the actual plan and conservative traffic/write-budget envelope before production; perform bounded isolated hosted measurements, not a free-tier50-player promise.

Sources opened this turn:
- https://developers.cloudflare.com/d1/worker-api/d1-database/ (batch transactional rollback)
- https://developers.cloudflare.com/d1/platform/limits/ (limits and batch counting)
- https://developers.cloudflare.com/d1/platform/pricing/ (row/index accounting and quotas)
