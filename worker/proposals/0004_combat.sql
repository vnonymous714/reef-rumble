-- REVIEW ONLY. Isolated candidate schema; not in production migrations directory.
CREATE TABLE IF NOT EXISTS economy_world(account_id INTEGER PRIMARY KEY REFERENCES accounts(id),state_json TEXT NOT NULL,version INTEGER NOT NULL,enrolled_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS economy_actions(account_id INTEGER NOT NULL REFERENCES accounts(id),id TEXT NOT NULL,request_json TEXT NOT NULL,response_json TEXT NOT NULL,expected_seq INTEGER NOT NULL,status TEXT NOT NULL,wager INTEGER NOT NULL,payout INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,id));
CREATE TABLE IF NOT EXISTS economy_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id INTEGER NOT NULL REFERENCES accounts(id),action_id TEXT NOT NULL,kind TEXT NOT NULL,wager INTEGER NOT NULL,payout INTEGER NOT NULL,balance_after INTEGER NOT NULL,created_at INTEGER NOT NULL,wager_refund INTEGER NOT NULL DEFAULT 0,external_delta INTEGER NOT NULL DEFAULT 0,gaming_payout INTEGER NOT NULL DEFAULT 0,promo_credit INTEGER NOT NULL DEFAULT 0,rtp_period INTEGER NOT NULL DEFAULT 92,account_seq INTEGER NOT NULL DEFAULT 0,UNIQUE(account_id,action_id));
CREATE INDEX IF NOT EXISTS economy_ledger_time ON economy_ledger(created_at,id);
CREATE INDEX IF NOT EXISTS economy_ledger_account_time ON economy_ledger(account_id,created_at,id);
CREATE TABLE IF NOT EXISTS economy_config(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
INSERT INTO economy_config(key,value) VALUES('cutover_at',unixepoch()*1000) ON CONFLICT(key) DO NOTHING;
CREATE VIEW IF NOT EXISTS accounting_events AS
SELECT e.* FROM events e WHERE e.created_at<(SELECT value FROM economy_config WHERE key='cutover_at') AND NOT EXISTS (
 SELECT 1 FROM accounts a LEFT JOIN economy_world w ON w.account_id=a.id
 WHERE e.player_id IN(a.pid,COALESCE((SELECT p.pid FROM players p WHERE p.tg_id=a.tg_id),''))
 AND ((w.account_id IS NOT NULL AND e.created_at>=w.enrolled_at)
 OR (e.type='stars_purchase' AND EXISTS(SELECT 1 FROM economy_ledger l WHERE l.account_id=a.id AND l.kind='stars_purchase' AND l.created_at=e.created_at)))
)
UNION ALL
SELECT 1000000000000+l.id*4,a.pid,CASE WHEN l.kind='spin' THEN 'slot_spin' WHEN l.kind IN('attack','launch') THEN 'shots' ELSE 'catch' END,'normal',l.rtp_period,l.wager-l.wager_refund,l.gaming_payout,0,l.balance_after,CASE WHEN l.wager>0 THEN 1 ELSE 0 END,'authoritative '||l.kind,l.created_at FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.wager>0 OR l.gaming_payout>0 OR l.wager_refund>0
UNION ALL
SELECT 1000000000000+l.id*4+1,a.pid,CASE WHEN l.kind='refill' THEN 'refill' ELSE 'daily_bonus' END,'normal',l.rtp_period,0,0,l.promo_credit,l.balance_after,0,'authoritative promotion',l.created_at FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.promo_credit<>0
UNION ALL
SELECT 1000000000000+l.id*4+2,a.pid,CASE WHEN l.kind LIKE 'admin_%' THEN 'admin_adjust' ELSE l.kind END,'normal',l.rtp_period,0,0,l.external_delta,l.balance_after,0,'authoritative external credit',l.created_at FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.external_delta<>0;
