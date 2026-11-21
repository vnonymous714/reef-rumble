const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const DR = require('../daily-reveal.js');
const gameSrc = fs.readFileSync('game.js', 'utf8');
const CLIENT = JSON.parse(gameSrc.match(/const DAILY = (\[\[.*?\]\]);/)[1]);
test('tg35 client wheel labels = 5..45 by 5 + 100 Relic and match the server table exactly', async () => {
  const { DAILY } = await import('../worker/src/reward-math.js');
  assert.deepEqual(CLIENT, DAILY.map((p) => [...p]));
  assert.deepEqual(CLIENT.map((p) => p[0] / 100), [5, 10, 15, 20, 25, 30, 35, 40, 45, 100]);
});
test('every server-awarded prize, any streak, lands under the pointer on its own sector', async () => {
  const { dailyReward } = await import('../worker/src/reward-math.js');
  const n = CLIENT.length;
  for (let streak = 0; streak <= 7; streak++) for (let pick = 0; pick < 200; pick++) {
    const r = dailyReward('2026-11-20', '2026-11-19', streak, pick), idx = DR.sectorFor(CLIENT, r);
    assert.ok(idx >= 0); assert.equal(Math.round(CLIENT[idx][0] * DR.MULT[r.streak - 1]), r.pay);
    for (const reduced of [false, true]) for (const jit of [-20, 0, 20]) for (const prev of [0, 2484, 7000.5]) {
      const rot = DR.landingRotation(prev, idx, n, reduced, jit);
      assert.equal(DR.sectorAtPointer(rot, n), idx);
      if (!reduced) assert.ok(rot - prev >= 360 * 5, 'visible multi-turn spin');
    }
  }
});
test('reveal waits for the wheel to stop: amount + BACK TO REEF hidden during spin, shown after', () => {
  assert.ok(DR.revealDelay(false) > DR.SPIN_MS); assert.ok(DR.revealDelay(true) > 0);
  // Drive the real game.js dailySpinTo with a fake DOM + virtual clock.
  const body = gameSrc.slice(gameSrc.indexOf('function dailySpinTo('), gameSrc.indexOf('function dailyState()'));
  const el = () => { const c = new Set(); return { textContent: '', dataset: {}, style: {}, disabled: false, offsetWidth: 1, classList: { add: (...x) => x.forEach((y) => c.add(y)), remove: (...x) => x.forEach((y) => c.delete(y)), contains: (x) => c.has(x) } }; };
  const nodes = { '#dwheel': el(), '#dRes': el(), '#dSpin': el() }, timers = [];
  nodes['#dRes'].textContent = '+10.00'; nodes['#dSpin'].textContent = 'BACK TO REEF';
  const ctx = { window: { ReefDailyReveal: DR }, $: (q) => nodes[q], motionPref: { matches: false }, DAILY: CLIENT, cryptoPick: () => 500, fmt: (c) => (c / 100).toFixed(2), Sfx: { tick() {}, big() {} }, coins: [], MAX_COINS: 0, W: 844, H: 390, rnd: () => 0.5, toast() {}, setInterval: () => 0, clearInterval() {}, setTimeout: (f, ms) => timers.push({ f, ms }), dRot: 0, dRevealSeq: 0 };
  vm.runInNewContext('var dRot=0,dRevealSeq=0;' + body + ';this.run=dailySpinTo;', ctx);
  ctx.run(1, 1100, 2);
  assert.equal(nodes['#dRes'].textContent, '', 'no amount while spinning');
  assert.equal(nodes['#dSpin'].disabled, true); assert.equal(nodes['#dSpin'].dataset.done, undefined);
  assert.equal(nodes['#dwheel'].dataset.revealed, '0'); assert.equal(nodes['#dwheel'].dataset.sector, '1');
  assert.equal(timers.length, 1); assert.ok(timers[0].ms >= DR.SPIN_MS);
  timers[0].f();
  assert.equal(nodes['#dRes'].textContent, '+11.00'); assert.equal(nodes['#dSpin'].textContent, 'BACK TO REEF');
  assert.equal(nodes['#dSpin'].dataset.done, '1'); assert.equal(nodes['#dwheel'].dataset.revealed, '1');
});
test('pre-spin popup shows only SPIN; already-claimed shows a claimed notice, never a prize', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<div class="wres" id="dRes"><\/div>/);
  assert.ok(html.indexOf('daily-reveal.js?v=tg39') < html.indexOf('game.js?v=tg39'));
  assert.match(gameSrc, /dailyClaimed\(\)\{[^}]*Already claimed today/);
  assert.ok(!/dailyResult\(reward\)\{[^\n]*textContent='\+'/.test(gameSrc), 'dailyResult no longer writes the amount immediately');
});
