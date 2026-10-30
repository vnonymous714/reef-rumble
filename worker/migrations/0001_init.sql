-- Play credits only. No cash value. No withdrawal by players. Amounts in credit-cents (100 = 1.00 credit).
CREATE TABLE IF NOT EXISTS players (
  tg_id INTEGER PRIMARY KEY,            -- Telegram user id (no names stored)
  pid TEXT NOT NULL UNIQUE,             -- anonymous id used in events / admin ('t' + 15 hex)
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bonus INTEGER NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  pt INTEGER NOT NULL DEFAULT 0 CHECK (pt >= 0),
  season TEXT, season_at INTEGER, last_refill INTEGER NOT NULL DEFAULT 0, last_daily TEXT,
  sync_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_tg ON ledger(tg_id, id);
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,           -- telegram_payment_charge_id (idempotency key)
  tg_id INTEGER NOT NULL, pack INTEGER NOT NULL, stars INTEGER NOT NULL, credits INTEGER NOT NULL, bonus INTEGER NOT NULL,
  payload TEXT NOT NULL, credited INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL, type TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'normal', rtp_period INTEGER NOT NULL DEFAULT 95,
  bet INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER, n INTEGER NOT NULL DEFAULT 0, meta TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
CREATE INDEX IF NOT EXISTS events_player ON events(player_id, created_at);
CREATE TABLE IF NOT EXISTS admin_cmds (   -- for web (non-Telegram) players, applied by the client like before
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, action TEXT NOT NULL, amount INTEGER,
  created_at INTEGER NOT NULL, applied_at INTEGER
);
CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, win INTEGER NOT NULL, c INTEGER NOT NULL);
