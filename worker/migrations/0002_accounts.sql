-- Username/password accounts. Server balance is source of truth. Play credits only; no cash-out.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  pid TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE COLLATE NOCASE,
  pass_salt TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL DEFAULT '',
  tg_id INTEGER UNIQUE,
  balance INTEGER NOT NULL DEFAULT 20000 CHECK (balance >= 0),
  bonus INTEGER NOT NULL DEFAULT 10000 CHECK (bonus >= 0),
  pt INTEGER NOT NULL DEFAULT 0 CHECK (pt >= 0),
  season TEXT, season_at INTEGER,
  last_refill INTEGER NOT NULL DEFAULT 0,
  last_daily TEXT,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_user ON accounts(username);
CREATE INDEX IF NOT EXISTS accounts_tg ON accounts(tg_id);
CREATE INDEX IF NOT EXISTS accounts_seen ON accounts(last_seen);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_acct ON sessions(account_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  pid TEXT NOT NULL,
  public_id TEXT,
  username TEXT,
  action TEXT NOT NULL,
  amount INTEGER,
  reason TEXT NOT NULL,
  bal_before INTEGER NOT NULL,
  bal_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_log(created_at);

-- Seed from existing Telegram players; public_id assigned after import via id.
INSERT OR IGNORE INTO accounts (public_id, pid, username, pass_salt, pass_hash, tg_id, balance, bonus, pt, season, season_at, last_refill, last_daily, sync_seq, created_at, last_seen)
SELECT
  'TMP-' || pid,
  pid, NULL, '', '', tg_id, balance, bonus, pt, season, season_at, last_refill, last_daily, sync_seq, created_at, last_seen
FROM players;

UPDATE accounts SET public_id = 'RR-' || printf('%06d', id) WHERE public_id LIKE 'TMP-%';
