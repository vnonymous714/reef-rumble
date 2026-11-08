/* Shared original-style Bezier schools, homing shots, ellipse collisions and
   bounded ricochet lifetime. No RNG, balance or capture authority in renderer. */
(function (root) {
  "use strict";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function bez(p, t) {
    const q = 1 - t;
    return {
      x:
        q * q * q * p[0].x +
        3 * q * q * t * p[1].x +
        3 * q * t * t * p[2].x +
        t * t * t * p[3].x,
      y:
        q * q * q * p[0].y +
        3 * q * q * t * p[1].y +
        3 * q * t * t * p[2].y +
        t * t * t * p[3].y,
    };
  }
  function path(random, side = 0, margin = 50) {
    const W = 844,
      H = 390,
      top = H * 0.1,
      bot = H * 0.78,
      y = () => top + random() * (bot - top),
      p = [
        { x: side ? W + margin : -margin, y: y() },
        { x: W * (0.2 + random() * 0.3) + (side ? W * 0.3 : 0), y: y() },
        { x: W * (0.2 + random() * 0.3) + (side ? 0 : W * 0.3), y: y() },
        { x: side ? -margin : W + margin, y: y() },
      ];
    let length = 0,
      last = bez(p, 0);
    for (let i = 1; i <= 24; i++) {
      const n = bez(p, i / 24);
      length += Math.hypot(n.x - last.x, n.y - last.y);
      last = n;
    }
    return { p: p.map((v) => ({ x: v.x / W, y: v.y / H })), length };
  }
  function point(f, time, width = 844, height = 390) {
    if (!f.motion) return { x: f.x * width, y: f.y * height, ang: 0, t: 0 };
    const t = (time - f.born) / f.motion.duration,
      q = clamp(t, 0, 1),
      a = bez(f.motion.p, q),
      b = bez(f.motion.p, clamp(q + 0.001, 0, 1));
    const ang = Math.atan2((b.y - a.y) * height, (b.x - a.x) * width),
      off =
        (f.motion.off || 0) *
        clamp(Math.min(width / 844, height / 390), 0.62, 1.5);
    return {
      x: a.x * width - Math.sin(ang) * off,
      y: a.y * height + Math.cos(ang) * off,
      ang,
      t,
    };
  }
  function hit(f, x, y, time, board, pad = 4) {
    const p = point(f, time, board.width, board.height);
    if (f.dead || p.t < 0 || p.t > 1) return false;
    const k = clamp(Math.min(board.width / 844, board.height / 390), 0.62, 1.5),
      dx = x - p.x,
      dy = y - p.y,
      c = Math.cos(-p.ang),
      s = Math.sin(-p.ang),
      lx = dx * c - dy * s,
      ly = dx * s + dy * c,
      a = f.len * k * (f.boss ? 0.42 : 0.46) + pad * k,
      b = f.h * k * (f.boss ? 0.38 : 0.42) + pad * k;
    return (lx * lx) / (a * a) + (ly * ly) / (b * b) <= 1;
  }
  function launch(
    id,
    angle,
    target,
    board,
    now,
    stake,
    tier,
    base,
    style,
    period,
  ) {
    if (!Number.isFinite(angle) || angle < -Math.PI + 0.12 || angle > -0.12)
      throw new Error("invalid aim");
    if (
      !board ||
      (board.safeBottom !== undefined && !Number.isFinite(board.safeBottom)) ||
      !Number.isFinite(board.width) ||
      !Number.isFinite(board.height) ||
      board.width < 360 ||
      board.width > 2560 ||
      board.height < 240 ||
      board.height > 1440
    )
      throw new Error("invalid board");
    const k = clamp(Math.min(board.width / 844, board.height / 390), 0.62, 1.5),
      ca = Math.cos(angle),
      sa = Math.sin(angle),
      origin = {
        x: board.width / 2,
        y: board.height - clamp(board.safeBottom || 0, 0, 80) - 18 * k,
      };
    return {
      id,
      x: origin.x + ca * 46 * k,
      y: origin.y + sa * 46 * k,
      vx: ca * 820 * k,
      vy: sa * 820 * k,
      board: {
        width: board.width,
        height: board.height,
        safeBottom: clamp(board.safeBottom || 0, 0, 80),
      },
      target,
      born: now,
      at: now,
      life: 0,
      bounces: 0,
      stake,
      tier,
      base,
      style,
      period,
    };
  }
  function step(b, fishes, time) {
    const dt = Math.min(1 / 60, (time - b.at) / 1000);
    if (dt <= 0) return null;
    const at = b.at + dt * 1000;
    b.at = at;
    b.life += dt;
    let target = fishes.find((f) => f.id === b.target && !f.dead);
    if (target) {
      const p = point(target, at, b.board.width, b.board.height);
      if (p.t >= 0 && p.t <= 1) {
        const a = Math.atan2(p.y - b.y, p.x - b.x),
          speed = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
      } else {
        b.target = null;
        target = null;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const W = b.board.width,
      H = b.board.height;
    if (b.x < 0) {
      b.x = -b.x;
      b.vx = -b.vx;
      b.bounces++;
    } else if (b.x > W) {
      b.x = 2 * W - b.x;
      b.vx = -b.vx;
      b.bounces++;
    }
    if (b.y < 0) {
      b.y = -b.y;
      b.vy = -b.vy;
      b.bounces++;
    } else if (b.y > H) {
      b.y = 2 * H - b.y;
      b.vy = -b.vy;
      b.bounces++;
    }
    const eligible = (f) =>
      f.mult * b.stake <= 40000 &&
      (!f.lock || (f.lock.stake === b.stake && f.lock.tier === b.tier));
    const hitFish = target
      ? eligible(target) && hit(target, b.x, b.y, at, b.board)
        ? target
        : null
      : [...fishes]
          .reverse()
          .find((f) => eligible(f) && hit(f, b.x, b.y, at, b.board));
    if (hitFish)
      return { kind: "collision", target: hitFish.id, at, x: b.x, y: b.y };
    if (b.life > 7 || b.bounces > 14) return { kind: "refund", at };
    return null;
  }
  function ray(b, fishes, time) {
    const k = clamp(
        Math.min(b.board.width / 844, b.board.height / 390),
        0.62,
        1.5,
      ),
      origin = {
        x: b.board.width / 2,
        y: b.board.height - (b.board.safeBottom || 0) - 18 * k,
      },
      speed = Math.hypot(b.vx, b.vy),
      ca = b.vx / speed,
      sa = b.vy / speed;
    return fishes
      .filter((f) => !f.dead && f.kind !== "laser")
      .map((f) => {
        const p = point(f, time, b.board.width, b.board.height),
          dx = p.x - origin.x,
          dy = p.y - origin.y,
          proj = dx * ca + dy * sa,
          r = Math.max(f.len, f.h) * k * (f.boss ? 0.32 : 0.38) + 10 * k;
        return { f, p, proj, dist: Math.abs(dx * sa - dy * ca), r };
      })
      .filter(
        (v) =>
          v.p.t >= 0 &&
          v.p.t <= 1 &&
          v.proj >= 28 * k &&
          v.proj <= Math.hypot(b.board.width, b.board.height) &&
          v.dist < v.r,
      )
      .sort((a, b) => a.proj - b.proj)
      .map((v) => v.f);
  }
  const api = { bez, path, point, hit, launch, step, ray };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReefMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
