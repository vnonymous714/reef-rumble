-- REVIEW + apply on publish. Weekly Catch Board: bosses caught and biggest single multiplier.
-- Cosmetic badges only. No credit prizes. Week key is Monday 00:00 America/Los_Angeles (unix ms).
CREATE TABLE IF NOT EXISTS weekly_catch_stats (
  week_start INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  bosses INTEGER NOT NULL DEFAULT 0 CHECK (bosses >= 0),
  biggest_mult INTEGER NOT NULL DEFAULT 0 CHECK (biggest_mult >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (week_start, account_id)
);
CREATE INDEX IF NOT EXISTS weekly_catch_bosses ON weekly_catch_stats(week_start, bosses DESC, biggest_mult DESC, updated_at ASC);
CREATE INDEX IF NOT EXISTS weekly_catch_mult ON weekly_catch_stats(week_start, biggest_mult DESC, bosses DESC, updated_at ASC);
