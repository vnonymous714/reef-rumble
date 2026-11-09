/* Original +1-second Prism pickups: bounded, server-confirmed timer only. */
(function (root) {
  "use strict";
  function start(w, at) {
    w.laserUntil = at + 5000;
    w.laserExtended = 0;
    w.laserPickups = [];
    w.nextPickup = at + 900;
  }
  function point(s, time) {
    const t = Math.max(0, (time - s.born) / 1000),
      tri = (v, min, max) => {
        const n = (v - min) % (2 * (max - min)),
          q = n < 0 ? n + 2 * (max - min) : n;
        return min + (q > max - min ? 2 * (max - min) - q : q);
      };
    return {
      x: tri(s.x + s.vx * t, 0.02, 0.98),
      y: tri(s.y + s.vy * t, 18 / 390, 90 / 390),
    };
  }
  function tick(w, now, random) {
    w.laserPickups = (w.laserPickups || []).filter(
      (s) => !s.dead && now - s.born < 4000,
    );
    if (now >= w.laserUntil) {
      w.laserPickups = [];
      return;
    }
    if (!w.nextPickup) return;
    if ((w.laserExtended || 0) >= 5 || now < (w.nextPickup || 0)) return;
    w.nextPickup = now + 900 + random() * 1100;
    if (w.laserPickups.length < 5)
      w.laserPickups.push({
        id: "prism_" + now,
        born: now,
        x: 0.2 + random() * 0.6,
        y: (20 + random() * 70) / 390,
        vx: ((random() < 0.5 ? -1 : 1) * (35 + random() * 35)) / 844,
        vy: ((random() - 0.5) * 30) / 390,
        dead: false,
      });
  }
  function collect(w, b, now) {
    if (now >= w.laserUntil) return 0;
    const W = b.board.width,
      H = b.board.height,
      k = Math.min(1.5, Math.max(0.62, Math.min(W / 844, H / 390))),
      ox = W / 2,
      oy = H - (b.board.safeBottom || 0) - 18 * k,
      length = Math.hypot(b.vx, b.vy),
      ca = b.vx / length,
      sa = b.vy / length;
    let count = 0;
    for (const s of w.laserPickups || []) {
      if (s.dead || now - s.born >= 4000) continue;
      const p = point(s, now),
        dx = p.x * W - ox,
        dy = p.y * H - oy,
        proj = dx * ca + dy * sa;
      if (proj < 20 * k || Math.abs(dx * sa - dy * ca) >= 24 * k) continue;
      s.dead = true;
      if ((w.laserExtended || 0) < 5) {
        w.laserExtended = (w.laserExtended || 0) + 1;
        w.laserUntil += 1000;
        count++;
      }
    }
    return count;
  }
  function shift(w, paused) {
    if (w.nextPickup) w.nextPickup += paused;
    for (const s of w.laserPickups || []) s.born += paused;
  }
  const api = { start, point, tick, collect, shift };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReefLaserPickups = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
