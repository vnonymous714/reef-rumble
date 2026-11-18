const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const W = require('../reef-weapons.js');
test('every weapon level 1-10 and every shot style maps to its own projectile kind', () => {
  const w = W.create();
  const ids = [];
  for (let lv = 1; lv <= 10; lv++) ids.push(w.kindOf(lv, 'normal'));
  assert.equal(new Set(ids).size, 10, 'ten distinct level projectiles');
  for (const s of ['arc', 'plasma', 'laser']) { assert.equal(w.kindOf(5, s), s); assert.ok(!ids.includes(s)); }
  const k = W.KINDS;
  const sig = Object.keys(k).map(id => [k[id].trail, k[id].impact, k[id].a].join('|'));
  assert.equal(new Set(sig).size, Object.keys(k).length, 'each kind differs in trail/impact/colour');
  const sounds = Object.keys(k).map(id => JSON.stringify(w.sound(id === 'arc' || id === 'plasma' || id === 'laser' ? 1 : W.LEVEL_KIND.indexOf(id) + 1, ['arc','plasma','laser'].includes(id) ? id : 'normal')));
  assert.equal(new Set(sounds).size, Object.keys(k).length, 'distinct sound per kind');
});
test('presentation only: no RNG, balance, cost or damage access; bounded pools', () => {
  const src = fs.readFileSync(require.resolve('../reef-weapons.js'), 'utf8');
  for (const bad of ['Math.random', 'credit(', 'S.bal', 'stake', 'dmg', 'RTP', 'fetch(']) assert.ok(!src.includes(bad), bad);
  const w = W.create();
  for (let i = 0; i < 2000; i++) { w.muzzle(100, 100, -1, 1 + (i % 10), 'normal', 1, false); w.impact(200, 100, 1 + (i % 10), i % 3 ? 'normal' : 'plasma', 1, false); }
  const s = w.stats(); assert.ok(s.particles <= 520 && s.effects <= 48, JSON.stringify(s));
  w.update(5); assert.equal(w.stats().particles, 0);
  const b = { x: 10, y: 10, vx: 100, vy: 0, lv: 10, style: 'normal' };
  for (let i = 0; i < 100; i++) { b.x += 2; w.track(b, 1 / 60, 1, false); }
  assert.ok(b._hn <= 14);
  assert.deepEqual(w.impact(0, 0, 3, 'normal', 1, true), { t: 0, a: 0 }, 'reduced motion: no shake');
});
test('game wires the weapons module without changing cost/damage maths', () => {
  const game = fs.readFileSync(require.resolve('../game.js'), 'utf8'), html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.ok(html.indexOf('reef-weapons.js?v=tg33') > 0 && html.indexOf('reef-weapons.js?v=tg33') < html.indexOf('game.js?v=tg33'));
  assert.match(game, /function wpnDmg\(\) \{ return Math\.min\(2, 1 \+ \(wpnLevel\(\) - 1\) \* 0\.25\); \}/);
  assert.match(game, /const cost = Math\.max\(1, Math\.round\(b \* dmg\)\);/);
  assert.match(game, /RW\.drawBullet\(ctx, b, now, K, motionPref\.matches\)/);
});
