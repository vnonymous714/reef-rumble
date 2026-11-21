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
  assert.ok(html.indexOf('reef-weapons.js?v=tg39') > 0 && html.indexOf('reef-weapons.js?v=tg39') < html.indexOf('game.js?v=tg39'));
  assert.match(game, /function wpnDmg\(\) \{ return Math\.min\(2, 1 \+ \(wpnLevel\(\) - 1\) \* 0\.25\); \}/);
  assert.match(game, /const cost = Math\.max\(1, Math\.round\(b \* dmg\)\);/);
  assert.match(game, /RW\.drawBullet\(ctx, b, now, K, motionPref\.matches\)/);
});

test('tg34 daily temple wheel: one subtitle + one disclaimer, HD painter, no HUD debug labels, odds unchanged', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const daily = html.slice(html.indexOf('<div class="modal" id="dailyM">'), html.indexOf('<div class="modal" id="wheelM">'));
  assert.equal((daily.match(/class="sub"/g) || []).length, 1);
  assert.equal((daily.match(/class="dnote"/g) || []).length, 1);
  assert.match(daily, /One claim per LA day/); assert.match(daily, /Weighted odds/); assert.match(daily, /no cash value/);
  assert.ok(!html.includes('FUNCTIONAL SPECIALS') && !html.includes('SHARED PAID BUDGET'));
  assert.match(daily, /<canvas id="dwheel" width="1200" height="1200">/);
  const ctx = {}; require('vm').runInNewContext(fs.readFileSync('daily-wheel-art.js', 'utf8'), ctx);
  assert.equal(typeof ctx.ReefDailyWheelArt.paintDailyTempleWheelHD, 'function');
  assert.equal(typeof ctx.ReefDailyWheelArt.paintDailyTempleWheel, 'function');
  const game = fs.readFileSync('game.js', 'utf8');
  assert.match(game, /const DAILY = \[\[500, 80\], \[1000, 50\], \[1500, 28\], \[2000, 16\], \[2500, 10\], \[3000, 6\], \[3500, 4\], \[4000, 3\], \[4500, 2\], \[10000, 1\]\];/);
});
