/* Original weighted species, Bezier schools, 35s first boss and 80s first
 * tidal surge. Server owns cadence; renderer retains all original artwork. */
import E from "../../engine.js";
import motion from "../../reef-motion.js";
const table = E.spawnTable(),
  total = table.reduce((n, f) => n + f.w, 0);
export function pick(random) {
  let n = random() * total;
  for (const def of table) {
    n -= def.w;
    if (n < 0) return def;
  }
  return table[0];
}
// tg40: less predictable reef. Each fish (or whole school) rolls a route
// style, a speed profile (steady / surging / darting) and a sideways wobble;
// schools may split in two mid-route. All of it is plain data on fish.motion,
// rolled here with the server RNG and replayed by the same reef-motion.js on
// both sides, so hits, homing and payouts read the exact positions drawn.
// Payout maths, RTP, the win cap and the max bet are untouched.
const r3 = (v) => Math.round(v * 1e3) / 1e3;
export function pickStyle(random, def, school = false) {
  if (def.boss) return random() < 0.75 ? "cross" : "arc";
  const n = random();
  // Schools never U-turn: their slot offsets would fold through the loop.
  if (school) return n < 0.5 ? "cross" : n < 0.8 ? "arc" : "dive";
  return n < 0.42 ? "cross" : n < 0.66 ? "arc" : n < 0.84 ? "turn" : "dive";
}
export function flavor(random, def, school = false) {
  const calm = def.boss ? 0.3 : def.m >= 20 ? 0.6 : 1,
    out = {},
    pace = random();
  if (pace < 0.3) {
    // steady cruiser: barely varies
    out.s = [r3(0.12 * calm), 1 + Math.floor(random() * 2), r3(random() * 6.28)];
  } else if (pace < 0.72 || def.boss) {
    // surging: slow-fast swells
    out.s = [r3((0.3 + random() * 0.25) * calm), 1 + Math.floor(random() * 3), r3(random() * 6.28)];
  } else {
    // darting: quick bursts between drifts (|a1|+|a2| <= 0.72, never stops)
    out.s = [
      r3((0.4 + random() * 0.12) * calm), 2 + Math.floor(random() * 3), r3(random() * 6.28),
      r3((0.12 + random() * 0.08) * calm), 5 + Math.floor(random() * 3), r3(random() * 6.28),
    ];
  }
  if (random() < (school ? 0.7 : 0.6)) {
    const amp = Math.min(26, def.h * (0.35 + random() * 0.45)) * calm;
    out.w = [r3(amp), r3(1 + random() * 2.5), r3(random() * 6.28)];
  }
  return out;
}
export function spawn(now, serial, random, def = pick(random), options = {}) {
  const side = options.side ?? (random() < 0.5 ? 0 : 1),
    route =
      options.route ||
      (options.plain
        ? motion.path(random, side, def.len * 0.8 + 20)
        : motion.route(random, side, def.len * 0.8 + 20, pickStyle(random, def))),
    feel = options.feel || (options.plain ? {} : flavor(random, def)),
    // tg38: whole ms and 1e-4 route points (0.1 px at 844 wide). The world now
    // carries ~10 s of upcoming fish, so every response is kept compact.
    duration = Math.round(
      (route.length / (def.spd * (options.speed ?? 0.75 + random() * 0.5))) *
        1000,
    ),
    born = Math.round(now - (options.t0 || 0) * duration),
    r4 = (v) => Math.round(v * 1e4) / 1e4;
  const m = { p: route.p.map((v) => ({ x: r4(v.x), y: r4(v.y) })), duration, off: options.off || 0 };
  if (feel.s) m.s = feel.s;
  if (feel.w) m.w = options.phase ? [feel.w[0], feel.w[1], r3(feel.w[2] + options.phase)] : feel.w;
  if (options.split) m.sp = options.split;
  return {
    id: "f" + serial,
    art: def.id,
    mult: def.id === "chest" ? 12 : def.id === "relic" ? 10 : E.rollMult(def, random),
    kind: def.id === "chest" ? "temple" : def.id === "relic" ? "bonuspick" : def.special || "normal",
    born,
    expires: born + duration,
    motion: m,
    len: def.len,
    h: def.h,
    boss: !!def.boss,
    dead: false,
  };
}
export function initial(now, random) {
  return Array.from({ length: 12 }, (_, i) =>
    spawn(now, i + 1, random, pick(random), { t0: 0.1 + random() * 0.6 }),
  );
}
// tg38: the reef no longer depends on how often the client polls. Regular
// spawns and the relic roll run on the server's own timeline up to
// LOOKAHEAD_MS ahead (fish born in the future wait off-screen at the start of
// their route: point() clamps t, hit()/step()/ray() ignore t<0), and a request
// after a quiet gap backfills up to BACKFILL_MS (those fish arrive mid-route).
// Before tg38 each request added at most one fish/school and rolled the relic
// once, so a 2 s poll showed ~15 fish instead of ~22 and a 15 s poll ~6.
// Surge, wave and boss stay request-driven; the client polls at those times
// (world.director.{tide,wave,boss}) and before director.spawn runs dry.
export const LOOKAHEAD_MS = 10000,
  BACKFILL_MS = 30000,
  RELIC_STEP_MS = 500;
export function tick(w, now, random) {
  const d = (w.director ??= {
    spawn: now,
    boss: now + 35000,
    tide: now + 80000,
    quiet: 0,
    wave: 0,
  });
  const live = (f, at) => !f.dead && f.expires > at;
  const add = (def, options, at = now) => {
    if (!def.boss && w.fishes.filter((f) => live(f, at)).length >= 42) return;
    const fish = spawn(at, ++w.serial, random, def, options);
    if (fish.expires > now) w.fishes.push(fish);
  };
  const school = (def, n, side, shape, at = now) => {
    const route = motion.route(
        random,
        side ?? (random() < 0.5 ? 0 : 1),
        def.len + 30,
        pickStyle(random, def, true),
      ),
      gap = (def.len * 1.25) / route.length,
      feel = flavor(random, def, true),
      speed = 0.9 + random() * 0.25,
      // tg40: ~40% of schools break into two groups part-way along the route.
      split = random() < 0.4 ? [r3(0.3 + random() * 0.3), r3(28 + random() * 22)] : null;
    for (let i = 0; i < n; i++) {
      let t0 = -i * gap,
        off = 0;
      if (shape === "v") {
        t0 = -Math.ceil(i / 2) * gap;
        off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * def.h * 1.1;
      }
      if (shape === "pair") {
        t0 = -Math.floor(i / 2) * gap;
        off = (i % 2 ? 1 : -1) * def.h * 0.8;
      }
      // a little slack in each slot so the formation ripples instead of
      // moving as one rigid block (never more than a third of a slot)
      if (i) t0 -= (random() - 0.5) * gap * 0.6;
      const half = shape === "line" ? i % 2 : off > 0 ? 1 : off < 0 ? 0 : i % 2;
      add(
        def,
        {
          route,
          t0,
          off,
          speed,
          feel,
          phase: (random() - 0.5) * 0.8,
          split: split && [split[0], half ? split[1] : -split[1]],
        },
        at,
      );
    }
  };
  if (now >= d.tide) {
    // Catch-up on an empty (already expired) reef must not wait the live 2s
    // surge telegraph — that left the first paint as a bare tank.
    const empty = !w.fishes.some((f) => !f.dead && f.born <= now && f.expires > now);
    d.tide = now + 85000 + random() * 25000;
    d.quiet = empty ? now : now + 2200;
    d.wave = empty ? now : now + 2000;
    // Fish still waiting off-screen would arrive into the surge's quiet gap.
    w.fishes = w.fishes.filter((f) => f.born <= now || f.dead || f.lock);
    for (const f of w.fishes) {
      if (f.boss) continue;
      const t = (now - f.born) / f.motion.duration;
      f.motion.duration /= 4.5;
      f.born = now - t * f.motion.duration;
      f.expires = f.born + f.motion.duration;
    }
    d.spawn = Math.max(d.spawn, d.quiet);
    if (d.relic) d.relic = Math.max(d.relic, d.quiet);
    w.directorEvent = { id: "surge_" + now, kind: "surge" };
  }
  if (d.wave && now >= d.wave) {
    d.wave = 0;
    const kinds = ["minnow", "guppy", "darter", "tang", "pebble"];
    for (let i = 0; i < 6; i++)
      school(
        E.BY_ID[kinds[i % 5]],
        6 + Math.floor(random() * 4),
        i % 2,
        ["line", "v", "pair"][i % 3],
      );
    add(E.BY_ID[["bomb", "eel", "chest", "laser"][Math.floor(random() * 4)]]);
    add(E.BY_ID.koi);
    add(E.BY_ID.turtle);
  }
  // Never schedule past the next surge: the surge rewrites the reef.
  // A pending surge wave owns the reef first (its schools fill toward the cap).
  const horizon = Math.min(now + LOOKAHEAD_MS, d.tide, d.wave || Infinity);
  // Temple Relic Fish: semi-rare; 72h boost window raises cadence (server
  // config). One roll per RELIC_STEP_MS of reef time (= the pre-tg38 roll per
  // 500 ms idle poll), never two relics on screen.
  if (d.relic === undefined) d.relic = now;
  d.relic = Math.max(d.relic, now - BACKFILL_MS);
  for (let guard = 0; d.relic + RELIC_STEP_MS <= horizon && guard < 200; guard++) {
    const at = (d.relic += RELIC_STEP_MS);
    if (at < d.quiet) continue;
    if (w.fishes.some((f) => f.kind === "bonuspick" && live(f, at))) continue;
    const relicBoost = (w.bonusFishBoostUntil || 0) > at;
    if (random() < (relicBoost ? 0.22 : 0.035))
      add(E.BY_ID.relic, { speed: relicBoost ? 1.05 : 0.9 }, at);
  }
  d.spawn = Math.max(d.spawn, now - BACKFILL_MS);
  for (let guard = 0; d.spawn <= horizon && guard < 400; guard++) {
    const at = d.spawn;
    if (at < d.quiet) {
      d.spawn = d.quiet;
      continue;
    }
    const crowd = w.fishes.filter((f) => !f.boss && live(f, at));
    if (crowd.length >= 26) {
      // Same rule as before (spawn as soon as the reef has room), on reef time.
      d.spawn = Math.max(at + 1, Math.min(...crowd.map((f) => f.expires)));
      continue;
    }
    const def =
      random() < 0.045 &&
      !w.fishes.some((f) => f.kind === "laser" && live(f, at)) &&
      at >= w.laserUntil
        ? E.BY_ID.laser
        : pick(random);
    if (def.m <= 6 && !def.special && random() < 0.35)
      school(
        def,
        4 + Math.floor(random() * 5),
        null,
        random() < 0.5 ? "line" : random() < 0.5 ? "v" : "pair",
        at,
      );
    else add(def, undefined, at);
    // tg40: irregular cadence (mean ~570 ms, was a flat 350-850 ms): mostly
    // normal gaps, some quick bursts, the odd lull.
    const beat = random();
    d.spawn =
      at +
      (beat < 0.7
        ? 250 + random() * 600
        : beat < 0.9
          ? 100 + random() * 150
          : 1100 + random() * 800);
  }
  if (now >= d.quiet && now >= d.boss) {
    if (!w.fishes.some((f) => f.boss)) {
      const def = random() < 0.6 ? E.BY_ID.kraken : E.BY_ID.dragon;
      add(def, { speed: 1 });
      w.directorEvent = {
        id: "boss_" + now,
        kind: "boss",
        art: def.id,
        mult: w.fishes.at(-1).mult,
      };
    }
    d.boss = now + 55000 + random() * 20000;
  }
}
export function shift(w, paused) {
  if (w.director)
    for (const key of ["spawn", "boss", "tide", "quiet", "wave", "relic"])
      if (w.director[key]) w.director[key] += paused;
}
