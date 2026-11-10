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
    duration =
      (route.length / (def.spd * (options.speed ?? 0.85 + random() * 0.3))) *
      1000,
    born = now - (options.t0 || 0) * duration;
  return {
    id: "f" + serial,
    art: def.id,
    mult: def.id === "chest" ? 12 : def.id === "relic" ? 10 : E.rollMult(def, random),
    kind: def.id === "chest" ? "temple" : def.id === "relic" ? "bonuspick" : def.special || "normal",
    born,
    expires: born + duration,
    motion: { p: route.p, duration, off: options.off || 0 },
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
export function tick(w, now, random) {
  const d = (w.director ??= {
    spawn: now,
    boss: now + 35000,
    tide: now + 80000,
    quiet: 0,
    wave: 0,
  });
  const add = (def, options) => {
    if (w.fishes.length >= 42 && !def.boss) return;
    w.fishes.push(spawn(now, ++w.serial, random, def, options));
  };
  const school = (def, n, side, shape) => {
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
      add(def, { route, t0, off, speed: 1 });
    }
  };
  if (now >= d.tide) {
    // Catch-up on an empty (already expired) reef must not wait the live 2s
    // surge telegraph — that left the first paint as a bare tank.
    const empty = !w.fishes.some((f) => !f.dead && f.expires > now);
    d.tide = now + 85000 + random() * 25000;
    d.quiet = empty ? now : now + 2200;
    d.wave = empty ? now : now + 2000;
    for (const f of w.fishes) {
      if (f.boss) continue;
      const t = (now - f.born) / f.motion.duration;
      f.motion.duration /= 4.5;
      f.born = now - t * f.motion.duration;
      f.expires = f.born + f.motion.duration;
    }
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
  // Temple Relic Fish: semi-rare; 72h boost window raises cadence (server config).
  const boostUntil = w.bonusFishBoostUntil || 0;
  const relicBoost = boostUntil > now;
  if (
    now >= d.quiet &&
    !w.fishes.some((f) => f.kind === "bonuspick") &&
    random() < (relicBoost ? 0.22 : 0.035)
  ) {
    add(E.BY_ID.relic, { speed: relicBoost ? 1.05 : 0.9 });
  }
  if (
    now >= d.quiet &&
    now >= d.spawn &&
    w.fishes.filter((f) => !f.boss).length < 26
  ) {
    const def =
      random() < 0.045 &&
      !w.fishes.some((f) => f.kind === "laser") &&
      now >= w.laserUntil
        ? E.BY_ID.laser
        : pick(random);
    if (def.m <= 6 && !def.special && random() < 0.35)
      school(
        def,
        4 + Math.floor(random() * 5),
        null,
        random() < 0.5 ? "line" : random() < 0.5 ? "v" : "pair",
      );
    else add(def);
    d.spawn = now + 350 + random() * 500;
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
    for (const key of ["spawn", "boss", "tide", "quiet", "wave"])
      if (w.director[key]) w.director[key] += paused;
}
