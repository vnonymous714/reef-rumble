-- REVIEW ONLY. Isolated candidate schema; not in production migrations directory.
CREATE TABLE economy_world(account_id INTEGER PRIMARY KEY REFERENCES accounts(id),state_json TEXT NOT NULL,version INTEGER NOT NULL);
CREATE TABLE economy_actions(account_id INTEGER NOT NULL REFERENCES accounts(id),id TEXT NOT NULL,request_json TEXT NOT NULL,response_json TEXT NOT NULL,expected_seq INTEGER NOT NULL,status TEXT NOT NULL,wager INTEGER NOT NULL,payout INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,id));
CREATE TABLE economy_ledger(account_id INTEGER NOT NULL REFERENCES accounts(id),action_id TEXT NOT NULL,kind TEXT NOT NULL,wager INTEGER NOT NULL,payout INTEGER NOT NULL,balance_after INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(account_id,action_id));
