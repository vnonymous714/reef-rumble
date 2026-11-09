import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Music = require('../../music.js');

test('tempo starts normal near 70-80 BPM', () => {
  const t = Music.createTempo();
  assert.equal(t.mode, 'normal');
  assert.equal(t.bonus, false);
  assert.equal(t.intensity, 0);
  assert.ok(t.bpm >= 70 && t.bpm <= 80);
  assert.equal(t.bpm, Music.NORMAL_BPM);
});

test('normal -> bonus raises target mode and ramps BPM toward 130-150', () => {
  const t = Music.createTempo();
  t.setBonus(true);
  assert.equal(t.mode, 'bonus');
  assert.equal(t.bonus, true);
  // still near normal until tick advances intensity
  assert.ok(t.bpm < 90);
  for (let i = 0; i < 40; i++) t.tick(0.05);
  assert.ok(t.intensity > 0.9);
  assert.ok(t.bpm >= 130 && t.bpm <= 150);
  assert.ok(Math.abs(t.bpm - Music.BONUS_BPM) < 2);
});

test('bonus -> normal eases BPM back to calm range', () => {
  const t = Music.createTempo();
  t.setBonus(true);
  for (let i = 0; i < 50; i++) t.tick(0.05);
  assert.ok(t.bpm >= 130);
  t.setBonus(false);
  assert.equal(t.mode, 'normal');
  assert.equal(t.bonus, false);
  // still hot until ramp down
  assert.ok(t.intensity > 0.5);
  for (let i = 0; i < 50; i++) t.tick(0.05);
  assert.equal(t.intensity, 0);
  assert.ok(t.bpm >= 70 && t.bpm <= 80);
  assert.equal(t.bpm, Music.NORMAL_BPM);
});

test('full normal->bonus->normal state machine snapshot sequence', () => {
  const t = Music.createTempo({ rampPerSec: 2 });
  const seen = [];
  seen.push(t.snapshot().mode);
  t.setBonus(true);
  seen.push(t.snapshot().mode);
  t.tick(1);
  const mid = t.snapshot();
  assert.equal(mid.mode, 'bonus');
  assert.ok(mid.intensity > 0);
  t.setBonus(false);
  seen.push(t.snapshot().mode);
  for (let i = 0; i < 20; i++) t.tick(0.1);
  seen.push(t.snapshot().mode);
  assert.deepEqual(seen, ['normal', 'bonus', 'normal', 'normal']);
  assert.equal(t.snapshot().intensity, 0);
});

test('tick ignores invalid dt and never overshoots intensity', () => {
  const t = Music.createTempo();
  t.setBonus(true);
  t.tick(NaN);
  t.tick(-1);
  assert.equal(t.intensity, 0);
  t.tick(100);
  assert.equal(t.intensity, 1);
  t.setBonus(false);
  t.tick(100);
  assert.equal(t.intensity, 0);
});

function fakeDoc(openIds, laserOn, pressed) {
  const open = new Set(openIds || []);
  const pressedSet = new Set(pressed || []);
  return {
    querySelector(sel) {
      if (sel.includes('#laserHud.on')) return laserOn ? {} : null;
      if (sel.includes('aria-pressed')) {
        for (const id of ['arcMode', 'plasmaMode']) {
          if (sel.includes('#' + id) && pressedSet.has(id)) return {};
        }
        // combined selector
        if (pressedSet.size) return {};
        return null;
      }
      for (const id of ['dailyM', 'wheelM', 'templeM', 'slotsV']) {
        if (sel.includes('#' + id + '.open') && open.has(id)) return {};
      }
      return null;
    }
  };
}

test('detectBonusActive covers temple, daily, wheel, slots, laser, ARC/PLASMA', () => {
  assert.equal(Music.detectBonusActive(fakeDoc([])), false);
  assert.equal(Music.detectBonusActive(fakeDoc(['templeM'])), true);
  assert.equal(Music.detectBonusActive(fakeDoc(['dailyM'])), true);
  assert.equal(Music.detectBonusActive(fakeDoc(['wheelM'])), true);
  assert.equal(Music.detectBonusActive(fakeDoc(['slotsV'])), true);
  assert.equal(Music.detectBonusActive(fakeDoc([], true)), true);
  assert.equal(Music.detectBonusActive(fakeDoc([], false, ['arcMode'])), true);
  assert.equal(Music.detectBonusActive(fakeDoc([], false, ['plasmaMode'])), true);
  assert.equal(Music.detectBonusActive(null, { laserOn: true }), true);
  assert.equal(Music.detectBonusActive(null, { weaponMode: true }), true);
  assert.equal(Music.detectBonusActive(null, {}), false);
});

test('music.js ships original procedural API without external tracks', () => {
  assert.equal(typeof Music.createTempo, 'function');
  assert.equal(typeof Music.createEngine, 'function');
  assert.ok(Music.NORMAL_BPM >= 70 && Music.NORMAL_BPM <= 80);
  assert.ok(Music.BONUS_BPM >= 130 && Music.BONUS_BPM <= 150);
});
