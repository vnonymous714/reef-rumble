-- tg37 batched writes. Apply BEFORE deploying the tg37 Worker (old Workers ignore the column).
-- Aggregated ledger rows (one per flush per kind/tide) carry their exact bullet count in n.
-- Legacy per-bullet rows keep n NULL and still count CASE WHEN wager>0 THEN 1 ELSE 0 END.
ALTER TABLE economy_ledger ADD COLUMN n INTEGER;
DROP VIEW IF EXISTS accounting_events;
DROP VIEW IF EXISTS accounting_events_live;
CREATE VIEW accounting_events_live AS
SELECT e.* FROM events e WHERE e.created_at<(SELECT value FROM economy_config WHERE key='cutover_at') AND NOT EXISTS (
 SELECT 1 FROM accounts a LEFT JOIN economy_world w ON w.account_id=a.id
 WHERE e.player_id IN(a.pid,COALESCE((SELECT p.pid FROM players p WHERE p.tg_id=a.tg_id),''))
 AND ((w.account_id IS NOT NULL AND e.created_at>=w.enrolled_at)
 OR (e.type='stars_purchase' AND EXISTS(SELECT 1 FROM economy_ledger l WHERE l.account_id=a.id AND l.kind='stars_purchase' AND l.created_at=e.created_at)))
)
UNION ALL
SELECT 1000000000000+l.id*4,a.pid,CASE WHEN l.kind='spin' THEN 'slot_spin' WHEN l.kind IN('attack','launch') THEN 'shots' ELSE 'catch' END,'normal',l.rtp_period,l.wager-l.wager_refund,l.gaming_payout,0,l.balance_after,COALESCE(l.n,CASE WHEN l.wager>0 THEN 1 ELSE 0 END),'authoritative '||l.kind,l.created_at FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.wager>0 OR l.gaming_payout>0 OR l.wager_refund>0
UNION ALL
SELECT 1000000000000+l.id*4+1,a.pid,CASE WHEN l.kind='refill' THEN 'refill' ELSE 'daily_bonus' END,'normal',l.rtp_period,0,0,l.promo_credit,l.balance_after,0,'authoritative promotion',l.created_at FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.promo_credit<>0
UNION ALL
SELECT 1000000000000+l.id*4+2,a.pid,CASE WHEN l.kind LIKE 'admin_%' THEN 'admin_adjust' ELSE l.kind END,'normal',l.rtp_period,0,0,l.external_delta,l.balance_after,0,'authoritative external credit',l.created_at FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.external_delta<>0;
CREATE VIEW accounting_events AS SELECT * FROM accounting_events_live
UNION ALL SELECT -l.id*4,a.pid,CASE WHEN l.kind='spin' THEN 'slot_spin' WHEN l.kind IN('launch','attack') THEN 'shots' ELSE 'catch' END,'normal',l.rtp_period,l.wager-l.wager_refund,l.gaming_payout,0,0,l.n,'archived authoritative '||l.kind,l.bucket FROM economy_archive l JOIN accounts a ON a.id=l.account_id WHERE l.wager<>0 OR l.wager_refund<>0 OR l.gaming_payout<>0
UNION ALL SELECT -l.id*4-1,a.pid,'daily_bonus','normal',l.rtp_period,0,0,l.promo_credit,0,0,'archived promotion',l.bucket FROM economy_archive l JOIN accounts a ON a.id=l.account_id WHERE l.promo_credit<>0
UNION ALL SELECT -l.id*4-2,a.pid,l.kind,'normal',l.rtp_period,0,0,l.external_delta,0,0,'archived external',l.bucket FROM economy_archive l JOIN accounts a ON a.id=l.account_id WHERE l.external_delta<>0;
