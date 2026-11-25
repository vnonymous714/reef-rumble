// tg38 adaptive state polling: the schedule itself (pure, no DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const PS = require('../poll-schedule.js');
const M = require('../reef-motion.js');

const T = 1_764_000_000_000;
const world = (over = {}) => ({ fishes: [], projectiles: [], laserUntil: 0, director: { spawn: T + 10000, tide: T + 60000, boss: T + 40000, wave: 0 }, ...over });
const ctx = (over = {}) => ({ hidden: false, now: T, serverNow: T, lastInputAt: T, lastActionAt: 0, world: world(), flightAt: null, errors: 0, ...over });

test('hidden tab never polls; no world yet never polls', () => {
  assert.equal(PS.nextDelay(ctx({ hidden: true })), null);
  assert.equal(PS.nextDelay(ctx({ hidden: true, world: world({ projectiles: [{}] }) })), null);
  assert.equal(PS.nextDelay(ctx({ world: null })), null);
});

test('idle visible tab backs off 3 s -> 6 s -> 8 s, then stops after 2 min without input', () => {
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 1000 })), 3000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 15000 })), 6000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000 })), 8000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 119000 })), 8000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 121000 })), null);
});

test('active laser keeps the pre-tg38 500 ms cadence; an action needs no extra polls (its response carries state)', () => {
  assert.equal(PS.nextDelay(ctx({ lastActionAt: T - 300, lastInputAt: T - 300 })), 3000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ laserUntil: T + 3000 }) })), 500);
});

test('never later than the next server event or the end of the fish schedule', () => {
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ director: { spawn: T + 5000, tide: T + 60000, boss: T + 60000 } }) })), 3000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ director: { spawn: T + 10000, tide: T + 60000, boss: T + 4000 } }) })), 4060);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ fishes: [{ lock: { stake: 10 }, dead: false, expires: T + 1200 }] }) })), 1260);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ director: { spawn: T + 10000, tide: T + 60000, boss: T + 60000, wave: T + 900 } }) })), 960);
  // An old (tg37) Worker schedules ~0.6 s ahead: the client falls back to 500 ms, never faster.
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ director: { spawn: T + 600, tide: T + 60000, boss: T + 60000 } }) })), 500);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 60000, world: world({ director: { spawn: T - 5000, tide: T - 1, boss: T - 1 } }) })), 500);
});

test('failed polls back off exponentially up to 15 s', () => {
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 1000, errors: 1 })), 3000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 1000, errors: 3 })), 4000);
  assert.equal(PS.nextDelay(ctx({ lastInputAt: T - 1000, errors: 9 })), 15000);
});

function shotAt(fish, at) {
  const board = { width: 844, height: 390, safeBottom: 0 };
  const p = M.point(fish, at, 844, 390);
  const angle = Math.atan2(p.y - (390 - 18), p.x - 422);
  return M.launch('s1', angle, undefined, board, at, 10, 1, 10, 'normal', 91);
}
const sitting = { id: 'f1', art: 'turtle', mult: 5, kind: 'normal', born: T - 1e6, expires: T + 1e6, len: 60, h: 40, boss: false, dead: false, motion: { p: [{ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.3 }], duration: 2e6, off: 0 } };

test('in-flight shot: the poll is planned for the server collision time (same step as the server)', () => {
  const b = shotAt(sitting, T), w = world({ fishes: [sitting], projectiles: [b] });
  const predicted = PS.predictFlight(w, T, M);
  // Replay what the Worker does on the next request: step at 60 Hz until an event.
  const s = { ...b };
  let ev = null;
  while (!ev) ev = M.step(s, [sitting], Math.min(T + 5000, s.at + 1000 / 60));
  assert.equal(ev.kind, 'collision');
  assert.equal(predicted, ev.at);
  assert.equal(b.at, T, 'prediction does not mutate the snapshot');
  const d = PS.nextDelay(ctx({ world: w, flightAt: predicted, lastActionAt: T }));
  assert.equal(d, Math.max(PS.C.MIN_MS, Math.round(ev.at - T + 30)));
  assert.ok(d < 500, 'lands sooner than the old 500 ms grid: ' + d);
});

test('in-flight shot with no hit inside the horizon: re-plan in 1 s; prediction work is bounded', () => {
  const board = { width: 844, height: 390, safeBottom: 0 };
  const miss = Array.from({ length: 24 }, (_, i) => M.launch('m' + i, -Math.PI / 2, undefined, board, T, 10, 1, 10, 'normal', 91));
  const w = world({ fishes: [], projectiles: miss });
  const t0 = process.hrtime.bigint();
  assert.equal(PS.predictFlight(w, T, M), null);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 50, 'bounded');
  assert.equal(PS.nextDelay(ctx({ world: w, flightAt: null, lastInputAt: T - 60000 })), 1000);
});

test('request budget: idle visible tab, 10 minutes after one tap', () => {
  let t = T, polls = 0;
  const w = world();
  for (;;) {
    const d = PS.nextDelay(ctx({ now: t, serverNow: t, lastInputAt: T, world: { ...w, director: { spawn: t + 10000, tide: t + 60000, boss: t + 40000 } } }));
    if (d == null || t + d > T + 600000) break;
    t += d; polls++;
  }
  // pre-tg38: 1,200 polls in 10 min (every 500 ms) plus a 4-5 s bridge refresh.
  assert.ok(polls <= 25, String(polls));
  assert.ok(polls >= 15, String(polls));
});
