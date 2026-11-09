-- REVIEW ONLY. Intentionally outside migrations/: not applied to production.
-- Canonical account identity must be resolved before using reward operations.
CREATE TABLE reward_receipts (
 id TEXT PRIMARY KEY,
 account_id INTEGER NOT NULL REFERENCES accounts(id),
 kind TEXT NOT NULL CHECK(kind IN ('daily','temple_spin')),
 reference TEXT NOT NULL,
 expected_seq INTEGER NOT NULL,
 stake INTEGER NOT NULL CHECK(stake >= 0),
 payout INTEGER NOT NULL CHECK(payout BETWEEN 0 AND 40000),
 result_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','settled')),
 created_at INTEGER NOT NULL,
 UNIQUE(account_id, kind, reference)
);
CREATE TABLE temple_offers (
 id TEXT PRIMARY KEY,
 account_id INTEGER NOT NULL REFERENCES accounts(id),
 encounter_receipt TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('available','consumed','skipped')),
 expires_at INTEGER NOT NULL
);
ALTER TABLE accounts ADD COLUMN daily_day_v2 TEXT;
ALTER TABLE accounts ADD COLUMN daily_streak_v2 INTEGER NOT NULL DEFAULT 0;
