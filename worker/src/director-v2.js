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
export function spawn(now, serial, random, def = pick(random), options = {}) {
  const route =
      options.route ||
      motion.path(
        random,
        options.side ?? (random() < 0.5 ? 0 : 1),
        def.len * 0.8 + 20,
      ),
    // tg38: whole ms and 1e-4 route points (0.1 px at 844 wide). The world now
    // carries ~10 s of upcoming fish, so every response is kept compact.
    duration = Math.round(
      (route.length / (def.spd * (options.speed ?? 0.85 + random() * 0.3))) *
        1000,
    ),
    born = Math.round(now - (options.t0 || 0) * duration),
    r4 = (v) => Math.round(v * 1e4) / 1e4;
  return {
    id: "f" + serial,
    art: def.id,
    mult: def.id === "chest" ? 12 : def.id === "relic" ? 10 : E.rollMult(def, random),
    kind: def.id === "chest" ? "temple" : def.id === "relic" ? "bonuspick" : def.special || "normal",
    born,
    expires: born + duration,
    motion: { p: route.p.map((v) => ({ x: r4(v.x), y: r4(v.y) })), duration, off: options.off || 0 },
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
    const route = motion.path(
        random,
        side ?? (random() < 0.5 ? 0 : 1),
        def.len + 30,
      ),
      gap = (def.len * 1.25) / route.length;
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
      add(def, { route, t0, off, speed: 1 }, at);
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
    d.spawn = at + 350 + random() * 500;
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
