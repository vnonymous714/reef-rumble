// tg40 "less predictable fish": varied routes, speed profiles, wobble and
// school splits must stay smooth (no teleport), on the reef, homing-hittable,
// and old fish (no new fields) must move exactly as before.
import assert from "node:assert/strict";
import test from "node:test";
import motion from "../../reef-motion.js";
import E from "../../engine.js";
import * as D from "../src/director-v2.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const boards = [
  { width: 844, height: 390 }, // reference landscape phone
  { width: 667, height: 375 }, // iPhone SE landscape
  { width: 932, height: 430 }, // iPhone Pro Max landscape
  { width: 1920, height: 1080 }, // full HD
];

function world(seed, ms, surge = true) {
  const random = rng(seed),
    w = { fishes: D.initial(0, random), serial: 12, laserUntil: 0 };
  for (let now = 0; now <= ms; now += 500) {
    D.tick(w, now, random);
    if (!surge) w.director.tide = 1e12; // the tidal surge is meant to rush
  }
  return w;
}

test("old fish without tg40 fields keep the exact pre-tg40 position", () => {
  const random = rng(7);
  for (let i = 0; i < 200; i++) {
    const def = D.pick(random),
      f = D.spawn(1000, i, random, def, { plain: true, off: (i % 5) * 7 });
    assert.equal(f.motion.s, undefined);
    for (let t = 1000; t < f.expires; t += 97) {
      const q = Math.min(1, Math.max(0, (t - f.born) / f.motion.duration)),
        a = motion.bez(f.motion.p, q),
        b = motion.bez(f.motion.p, Math.min(1, q + 0.001)),
        ang = Math.atan2((b.y - a.y) * 390, (b.x - a.x) * 844),
        p = motion.point(f, t);
      assert.ok(Math.abs(p.x - (a.x * 844 - Math.sin(ang) * f.motion.off)) < 1e-9);
      assert.ok(Math.abs(p.y - (a.y * 390 + Math.cos(ang) * f.motion.off)) < 1e-9);
    }
  }
});

test("warp is monotone with warp(0)=0, warp(1)=1", () => {
  const random = rng(11);
  for (let i = 0; i < 2000; i++) {
    const def = D.pick(random),
      m = D.flavor(random, def);
    assert.ok(Math.abs(motion.warp(m, 0)) < 1e-9);
    assert.ok(Math.abs(motion.warp(m, 1) - 1) < 1e-9);
    let last = -1;
    for (let q = 0; q <= 1; q += 0.001) {
      const v = motion.warp(m, q);
      assert.ok(v > last, "never stops or reverses");
      last = v;
    }
  }
});

test("variety: styles, speed profiles, wobble and splits all appear", () => {
  const w = world(3, 240000),
    fish = w.fishes;
  const kinds = { cross: 0, arc: 0, turn: 0, dive: 0 };
  for (const f of fish) {
    const p = f.motion.p;
    if (p[0].y < 0) kinds.dive++;
    else if (Math.sign(p[0].x - 0.5) === Math.sign(p[3].x - 0.5)) kinds.turn++;
    else kinds.cross++;
  }
  assert.ok(kinds.dive > 0 && kinds.turn > 0 && kinds.cross > 0, JSON.stringify(kinds));
  assert.ok(fish.some((f) => f.motion.s?.length === 6), "darting fish");
  assert.ok(fish.some((f) => f.motion.w), "wobbling fish");
  assert.ok(fish.some((f) => f.motion.sp), "splitting schools");
  const speeds = fish.filter((f) => !f.boss).map((f) => f.motion.duration);
  assert.ok(new Set(speeds).size > speeds.length * 0.3);
});

test("smooth on every phone/HD board: no teleport, stays above the cannon row", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = world(seed, 180000, false);
    for (const board of boards) {
      const k = Math.min(Math.max(Math.min(board.width / 844, board.height / 390), 0.62), 1.5);
      let worstStep = 0;
      for (const f of w.fishes) {
        let prev = null;
        const dt = 1000 / 60;
        for (let t = f.born; t <= f.expires; t += dt) {
          const p = motion.point(f, t, board.width, board.height);
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.ang));
          if (prev) {
            const step = Math.hypot(p.x - prev.x, p.y - prev.y);
            worstStep = Math.max(worstStep, step / k);
          }
          // never below the cannon / far outside the tank while on-screen
          if (p.x > 0 && p.x < board.width) {
            assert.ok(p.y < board.height * 0.93, `fish ${f.id} too low at ${p.y}`);
          }
          prev = p;
        }
      }
      // fastest darting fish: under 12 px per 60 fps frame at the 844 reference
      // (pre-tg40 max was ~3.5); continuous, so it reads as a dart, not a jump
      assert.ok(worstStep < 12, `${board.width}x${board.height} step ${worstStep}`);
    }
  }
});

test("homing shots still collide with wobbling / darting fish", () => {
  const board = { width: 844, height: 390 };
  let hits = 0,
    tried = 0;
  for (const seed of [21, 22, 23]) {
    const w = world(seed, 60000);
    for (const f of w.fishes) {
      for (let t = f.born + f.motion.duration * 0.2; t < f.expires - f.motion.duration * 0.25; t += 1500) {
        const p = motion.point(f, t, board.width, board.height);
        if (p.x < 40 || p.x > 804 || p.y > 300 || p.y < 20) continue;
        const angle = Math.atan2(p.y - 372, p.x - 422);
        if (angle < -Math.PI + 0.12 || angle > -0.12) continue;
        tried++;
        const b = motion.launch("s" + tried + "xxxxxxx", angle, f.id, board, t, 100, 1, 100, "normal", 0);
        const target = { ...f, mult: 2 };
        let ev = null;
        for (let i = 0; i < 600 && !ev; i++) ev = motion.step(b, [target], b.at + 1000 / 60);
        if (ev?.kind === "collision" && ev.target === f.id) hits++;
      }
    }
  }
  assert.ok(tried > 100);
  assert.ok(hits / tried > 0.97, `homing hit rate ${hits}/${tried}`);
});

test("point() cost stays tiny (server steps every fish per bullet frame)", () => {
  const w = world(9, 60000),
    t0 = performance.now();
  let n = 0;
  for (let t = 60000; t < 70000; t += 16) for (const f of w.fishes) (motion.point(f, t), n++);
  const us = ((performance.now() - t0) * 1000) / n;
  assert.ok(us < 5, `${us.toFixed(2)} us per point`);
});
