/* tg35 Daily Temple Wheel reveal timing + landing maths. Presentation only:
   the prize always comes from the server (or the offline local roll); this
   module only decides which painted sector that prize sits on, how far to turn
   the wheel so that sector stops under the top pointer, and when the amount
   may be revealed (never before the wheel has stopped). */
(function (root) {
  'use strict';
  const SPIN_MS = 5200, SETTLE_MS = 150, REDUCED_MS = 400, TURNS = 7;
  const MULT = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
  // Server pays base * (9 + streak) / 10, streak 1..7. Map a paid amount back to its sector.
  function sectorFor(table, reward) {
    if (!reward || !Number.isFinite(reward.pay)) return -1;
    const streak = Math.max(1, Math.min(7, reward.streak | 0 || 1));
    const base = Math.round(reward.pay * 10 / (9 + streak));
    return table.findIndex((p) => p[0] === base);
  }
  // Sector i is painted centred i*step degrees clockwise from the top pointer,
  // so rotating the canvas by -i*step (mod 360) brings it under the pointer.
  function landingRotation(prev, idx, n, reduced, jitter) {
    const step = 360 / n, j = Math.max(-0.3, Math.min(0.3, (jitter || 0) / step)) * step;
    const p = Number.isFinite(prev) ? prev : 0;
    return p - (((p % 360) + 360) % 360) + (reduced ? 0 : 360 * TURNS) - idx * step + j;
  }
  function sectorAtPointer(rot, n) {
    const step = 360 / n, a = (((-rot) % 360) + 360) % 360;
    return Math.round(a / step) % n;
  }
  function revealDelay(reduced) { return reduced ? REDUCED_MS : SPIN_MS + SETTLE_MS; }
  const api = { SPIN_MS, SETTLE_MS, REDUCED_MS, TURNS, MULT, sectorFor, landingRotation, sectorAtPointer, revealDelay };
  root.ReefDailyReveal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
