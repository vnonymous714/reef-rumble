-- REVIEW ONLY. Bonus Relic choice cooldown + harder weapon XP + 72h spawn boost key.
ALTER TABLE accounts ADD COLUMN w_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN last_bonus_pick INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN xp_curve INTEGER NOT NULL DEFAULT 1;
INSERT INTO economy_config(key,value) VALUES('bonus_fish_boost_until',0) ON CONFLICT(key) DO NOTHING;
