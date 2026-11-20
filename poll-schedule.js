/* tg38 adaptive state polling. Pure functions, no DOM, no network; the
   authority bridge asks nextDelay() when to send the next 'state' poll.
   Before tg38 every open tab polled every 500 ms (7,200 Worker + Durable
   Object requests per hour) even while nobody played, and the auth/Telegram
   bridges added a refresh every 4-5 s that also ran in hidden tabs.
   Rules (server keeps ~10 s of upcoming fish scheduled, see director-v2.js):
   - hidden tab: no polls (one refresh when it becomes visible again);
   - shots in flight: poll right when the first one should land on the server
     (same ReefMotion step the server runs), else every 500 ms;
   - laser active or an action in the last 1.5 s: 500 ms (as before);
   - otherwise back off 2 s -> 5 s -> 8 s, and never later than the next
     server event (surge, wave, boss, locked-fish escape payout) or the end of
     the server's fish schedule;
   - no input for 2 min: stop until the next input;
   - failed polls back off 1, 2, 4 ... 15 s. */
(function (root) {
  "use strict";
  const C = Object.freeze({
    FAST_MS: 500,
    ACTION_WINDOW_MS: 1500,
    IDLE_STEPS: [
      [10000, 2000],
      [30000, 5000],
    ],
    IDLE_MAX_MS: 8000,
    INACTIVE_MS: 120000,
    MIN_MS: 250,
    EVENT_PAD_MS: 60,
    FLIGHT_PAD_MS: 30,
    DRY_MARGIN_MS: 2000,
    FLIGHT_HORIZON_MS: 1200,
    FLIGHT_MAX_SHOTS: 8,
    ERROR_MAX_MS: 15000,
  });
  // Earliest server time at which any in-flight projectile collides or is
  // refunded, simulated with the SAME step function the server runs. Bounded
  // work: at most FLIGHT_MAX_SHOTS shots x FLIGHT_HORIZON_MS of 60 Hz steps.
  function predictFlight(world, serverNow, motion) {
    const shots = (world && world.projectiles) || [];
    if (!shots.length || !motion || typeof motion.step !== "function") return null;
    const fishes = world.fishes || [],
      sim = shots.slice(0, C.FLIGHT_MAX_SHOTS).map((b) => ({ ...b, board: b.board }));
    let best = Infinity;
    for (const b of sim) {
      // Server state is as of world time b.at; never simulate past best.
      const end = Math.min(best, Math.max(serverNow, b.at) + C.FLIGHT_HORIZON_MS);
      let guard = 0;
      while (b.at < end && guard++ < 200) {
        const ev = motion.step(b, fishes, Math.min(end, b.at + 1000 / 60));
        if (ev) {
          best = Math.min(best, ev.at);
          break;
        }
      }
    }
    return Number.isFinite(best) ? best : null;
  }
  function serverDeadline(world, serverNow, flightAt) {
    const w = world || {},
      d = w.director || {};
    let at = Infinity;
    const consider = (t, pad) => {
      if (Number.isFinite(t) && t > 0) at = Math.min(at, t + pad);
    };
    if (flightAt != null) consider(flightAt, C.FLIGHT_PAD_MS);
    for (const f of w.fishes || [])
      if (f && f.lock && !f.dead) consider(f.expires, C.EVENT_PAD_MS);
    consider(d.tide, C.EVENT_PAD_MS);
    if (d.wave) consider(d.wave, C.EVENT_PAD_MS);
    consider(d.boss, C.EVENT_PAD_MS);
    // keep the server's fish schedule from running dry on screen
    if (Number.isFinite(d.spawn)) consider(d.spawn - C.DRY_MARGIN_MS, 0);
    return at;
  }
  // ctx: { hidden, now (client ms), serverNow, lastInputAt, lastActionAt,
  //        world, flightAt, errors }
  // Returns ms until the next poll, or null for "do not poll".
  function nextDelay(ctx) {
    if (!ctx || ctx.hidden || !ctx.world) return null;
    const now = ctx.now,
      sNow = Number.isFinite(ctx.serverNow) ? ctx.serverNow : now,
      w = ctx.world,
      lastInput = ctx.lastInputAt || 0,
      lastAction = ctx.lastActionAt || 0,
      quiet = now - Math.max(lastInput, lastAction);
    const flying = !!(w.projectiles && w.projectiles.length);
    if (!flying && quiet >= C.INACTIVE_MS) return null;
    let step;
    if (flying) step = C.FAST_MS;
    else if (sNow < (w.laserUntil || 0) || now - lastAction < C.ACTION_WINDOW_MS) step = C.FAST_MS;
    else {
      step = C.IDLE_MAX_MS;
      for (const [upTo, ms] of C.IDLE_STEPS)
        if (quiet < upTo) {
          step = ms;
          break;
        }
    }
    const due = serverDeadline(w, sNow, flying ? ctx.flightAt : null) - sNow;
    let delay = Math.min(step, due);
    const floor = flying && ctx.flightAt != null ? C.MIN_MS : C.FAST_MS;
    if (!(delay >= floor)) delay = Math.min(step, floor);
    if (ctx.errors > 0) delay = Math.max(delay, Math.min(C.ERROR_MAX_MS, 1000 * 2 ** (ctx.errors - 1)));
    return Math.round(delay);
  }
  const api = { C, nextDelay, predictFlight, serverDeadline };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReefPollSchedule = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
