import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/bonus-choice.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Client = require('../../bonus-choice-math.js');

test('client and server XP thresholds match', () => {
  assert.deepEqual([...Client.WPN_XP], [...M.WPN_XP]);
  assert.deepEqual([...Client.WPN_XP_OLD], [...M.WPN_XP_OLD]);
});

test('harder XP curve is ~1.75x and never demotes via migration', () => {
  for (let i = 1; i < M.WPN_XP.length; i++) {
    assert.ok(M.WPN_XP[i] >= Math.floor(M.WPN_XP_OLD[i] * 1.7));
    assert.ok(M.WPN_XP[i] <= Math.ceil(M.WPN_XP_OLD[i] * 1.8));
  }
  for (const old of [0, 25, 60, 200, 700, 1400, 5000]) {
    const migrated = M.migrateXpToHarderCurve(old);
    const lvOld = Client.levelFromXpOld(old);
    assert.equal(M.levelFromXp(migrated), Math.min(10, lvOld));
  }
});

test('XP from credits played + earned + bosses', () => {
  const g = M.xpFromSettlement({ wagerCents: 2500, winCents: 1000, bossIds: ['kraken', 'dragon'] });
  assert.equal(g.wagerXp, 25);
  assert.equal(g.winXp, 10);
  assert.equal(g.bossXp, M.BOSS_XP.kraken + M.BOSS_XP.dragon);
  assert.equal(g.total, g.wagerXp + g.winXp + g.bossXp);
});

test('chest layout is 2/5/10 and payout respects 400 cap', () => {
  const layout = M.shuffleMults(() => 0);
  assert.deepEqual([...layout].sort((a, b) => a - b), [2, 5, 10]);
  assert.equal(M.chestPayout(1000, 2, [2, 5, 10]).pay, 10000);
  assert.equal(M.chestPayout(10000, 2, [2, 5, 10]).pay, 40000);
});

test('tap frenzy clamps to ~12 taps/sec and scores server-side', () => {
  const start = 1_000_000;
  const taps = Array.from({ length: 500 }, (_, i) => start + i * 10);
  const valid = M.sanitizeTaps(taps, start, start + 20_000);
  assert.ok(valid.length <= M.TAP_MAX_TOTAL);
  const pay = M.tapPayout(100, valid.length);
  assert.ok(pay.mult >= 1 && pay.mult <= 6);
  assert.ok(pay.pay <= 40000);
});

test('choice wheel EV under 2.5x', () => {
  assert.ok(M.choiceWheelEV() < 2.5);
  assert.ok(M.choiceWheelEV() > 1.5);
});

test('12h cooldown helper', () => {
  const now = 1e12;
  assert.equal(M.onCooldown(0, now), false);
  assert.equal(M.onCooldown(now - 1000, now), true);
  assert.equal(M.onCooldown(now - M.BONUS_COOLDOWN_MS - 1, now), false);
});

test('server ensureXpCurve migrates once', () => {
  const a = M.ensureXpCurve({ w_xp: 700, xp_curve: 1 });
  assert.equal(a.xp_curve, 2);
  assert.equal(a.w_xp, M.migrateXpToHarderCurve(700));
  const b = M.applySettlementXp({ w_xp: a.w_xp, xp_curve: 2 }, { wager: 10000, paid: 5000, bossIds: ['kraken'] });
  assert.ok(b.w_xp > a.w_xp);
});

test('estimated play time report', () => {
  const xpPerSec = 1.91;
  const mins = (lv) => M.WPN_XP[lv - 1] / xpPerSec / 60;
  console.log('XP_PLAYTIME_ESTIMATE', JSON.stringify({ lv2: mins(2), lv5: mins(5), lv10: mins(10), neu: M.WPN_XP, old: M.WPN_XP_OLD }));
  assert.ok(mins(10) > 15);
});
