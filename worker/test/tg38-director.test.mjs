// tg38: the reef must look the same whether the client polls every 0.5 s or
// every 12 s. The director runs on server time with a LOOKAHEAD_MS schedule.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as director from "../src/director-v2.js";
import motion from "../../reef-motion.js";

const T0 = 1_764_000_000_000;
const seeded = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};
const visibleAt = (w, t) => w.fishes.filter((f) => !f.dead && f.born <= t && f.expires > t);
function run(pollMs, { seed = 11, minutes = 20 } = {}) {
  const random = seeded(seed),
    w = { fishes: director.initial(T0, random), serial: 12, laserUntil: 0 };
  let next = T0, sum = 0, n = 0, maxVisible = 0, maxList = 0, twoRelics = 0;
  const relics = new Set();
  for (let t = T0; t < T0 + minutes * 60000; t += 100) {
    if (t >= next) {
      w.fishes = w.fishes.filter((f) => !f.dead && f.expires > t);
      director.tick(w, t, random);
      next += pollMs;
      maxList = Math.max(maxList, w.fishes.length);
      for (const f of w.fishes) if (f.kind === "bonuspick") relics.add(f.id);
    }
    const v = visibleAt(w, t);
    if (v.filter((f) => f.kind === "bonuspick").length > 1) twoRelics++;
    if (t > T0 + 60000) { sum += v.length; n++; maxVisible = Math.max(maxVisible, v.length); }
  }
  return { avg: sum / n, maxVisible, maxList, relicsPerMin: relics.size / minutes, twoRelics };
}

test("reef density no longer depends on the poll interval (0.5 s vs 2 s vs 5 s vs 8 s)", () => {
  const base = run(500);
  assert.ok(base.avg > 20, JSON.stringify(base));
  for (const ms of [2000, 5000, 8000]) {
    const r = run(ms);
    // pre-tg38: 2 s -> ~65%, 5 s -> ~36%, 8 s -> ~30% of the 0.5 s reef
    assert.ok(r.avg >= base.avg * 0.9, `${ms}ms poll: ${r.avg.toFixed(1)} vs ${base.avg.toFixed(1)}`);
    assert.ok(r.maxVisible <= 43 && r.maxList <= 120, JSON.stringify(r));
  }
});

test("relic cadence is per reef time (one roll per 500 ms), not per request", () => {
  const base = run(500, { minutes: 60 }), slow = run(5000, { minutes: 60 });
  assert.ok(base.relicsPerMin > 0.5 && base.relicsPerMin < 6, JSON.stringify(base));
  assert.ok(Math.abs(slow.relicsPerMin - base.relicsPerMin) <= base.relicsPerMin * 0.35, JSON.stringify({ base, slow }));
  // (The weighted spawn table can still pick a relic, exactly as before tg38.)
});

test("every tick schedules ahead; upcoming fish wait off-screen and cannot be hit or beamed", () => {
  const random = seeded(5),
    w = { fishes: director.initial(T0, random), serial: 12, laserUntil: 0 };
  director.tick(w, T0, random);
  assert.ok(w.director.spawn > T0 + director.LOOKAHEAD_MS - 1, "schedule reaches the horizon");
  const future = w.fishes.filter((f) => f.born > T0);
  assert.ok(future.length > 0);
  const board = { width: 844, height: 390 };
  for (const f of future) {
    const p = motion.point(f, T0, board.width, board.height);
    // tg40: "dive" fish wait above the top edge instead of beside it
    assert.ok(p.x < 0 || p.x > board.width || p.y < 0, "waits outside the board");
    assert.equal(motion.hit(f, p.x, p.y, T0, board, 40), false);
  }
  const beam = { board: { ...board, safeBottom: 0 }, vx: -1, vy: -0.0001 };
  const ids = new Set(motion.ray(beam, w.fishes, T0).map((f) => f.id));
  for (const f of future) assert.ok(!ids.has(f.id));
  // compact JSON (whole ms, 1e-4 route points)
  for (const f of w.fishes.slice(12)) {
    assert.ok(Number.isInteger(f.born) && Number.isInteger(f.motion.duration));
    for (const v of f.motion.p) assert.equal(Math.round(v.x * 1e4) / 1e4, v.x);
  }
});

test("after a long quiet gap one request refills the reef mid-route (no bare tank)", () => {
  const random = seeded(9),
    w = { fishes: director.initial(T0, random), serial: 12, laserUntil: 0 };
  director.tick(w, T0, random);
  const later = T0 + 50_000; // < first surge (80 s)
  w.fishes = w.fishes.filter((f) => f.expires > later);
  director.tick(w, later, random);
  assert.ok(visibleAt(w, later).length >= 15, String(visibleAt(w, later).length));
  assert.ok(w.director.spawn > later);
});

test("surge drops not-yet-entered fish, waits for its wave, then schedules again", () => {
  const random = seeded(3),
    w = { fishes: director.initial(T0, random), serial: 12, laserUntil: 0 };
  for (let t = T0; t < T0 + 80_000; t += 4000) {
    w.fishes = w.fishes.filter((f) => f.expires > t);
    director.tick(w, t, random);
  }
  const at = T0 + 80_000;
  w.fishes = w.fishes.filter((f) => f.expires > at);
  director.tick(w, at, random);
  assert.equal(w.directorEvent.kind, "surge");
  assert.ok(w.fishes.every((f) => f.born <= at), "nothing queued into the surge gap");
  assert.ok(w.director.wave > at && w.director.spawn >= w.director.quiet);
  const waveAt = w.director.wave;
  director.tick(w, waveAt, random);
  assert.equal(w.director.wave, 0);
  for (let t = waveAt; t < waveAt + 10000; t += 250) assert.ok(visibleAt(w, t).length <= 43);
  assert.ok(w.fishes.length >= 30, "wave schools arrived");
});

test("deterministic: same world, time and RNG -> identical schedule (launch preview replay)", () => {
  const make = () => {
    const random = seeded(21),
      w = { fishes: director.initial(T0, random), serial: 12, laserUntil: 0 };
    for (const t of [T0, T0 + 700, T0 + 9000, T0 + 30000]) director.tick(w, t, random);
    return JSON.stringify(w);
  };
  assert.equal(make(), make());
});

test("pause shift moves the relic clock with the rest of the director", () => {
  const w = { director: { spawn: 10, boss: 20, tide: 30, quiet: 1, wave: 0, relic: 40 } };
  director.shift(w, 5);
  assert.deepEqual(w.director, { spawn: 15, boss: 25, tide: 35, quiet: 6, wave: 0, relic: 45 });
});
