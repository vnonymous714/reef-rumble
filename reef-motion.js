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
  // tg40: varied routes. "cross" is the original edge-to-edge school route;
  // "arc" swings wide, "turn" comes in, loops and leaves by the side it entered,
  // "dive" drops in from the top edge. Every route starts and ends off-screen.
  function route(random, side = 0, margin = 50, style = "cross") {
    if (style === "cross") return path(random, side, margin);
    const W = 844,
      H = 390,
      top = H * 0.1,
      bot = H * 0.78,
      y = () => top + random() * (bot - top),
      inX = side ? W + margin : -margin,
      outX = side ? -margin : W + margin,
      dir = side ? -1 : 1;
    let p;
    if (style === "arc") {
      const hi = random() < 0.5,
        yA = hi ? top + random() * 40 : bot - random() * 40,
        yB = hi ? bot - random() * 40 : top + random() * 40;
      p = [
        { x: inX, y: y() },
        { x: W / 2 - dir * W * (0.05 + random() * 0.15), y: yA },
        { x: W / 2 + dir * W * (0.05 + random() * 0.15), y: yB },
        { x: outX, y: y() },
      ];
    } else if (style === "turn") {
      const y0 = y(),
        reach = W * (0.45 + random() * 0.3),
        // loop toward the middle so the turn always has room (never a hairpin)
        y1 = clamp(y0 + (y0 < (top + bot) / 2 ? 1 : -1) * (110 + random() * 70), top, bot);
      p = [
        { x: inX, y: y0 },
        { x: side ? W - reach * 1.33 : reach * 1.33, y: y0 },
        { x: side ? W - reach * 1.33 : reach * 1.33, y: y1 },
        { x: inX, y: y1 },
      ];
    } else {
      // dive: in through the top edge, out through a side
      const x0 = W * (0.15 + random() * 0.7);
      p = [
        { x: x0, y: -margin },
        { x: x0 + dir * W * (0.05 + random() * 0.15), y: H * (0.45 + random() * 0.3) },
        { x: W * (0.3 + random() * 0.4), y: y() },
        { x: x0 < W / 2 ? W + margin : -margin, y: y() },
      ];
    }
    let length = 0,
      last = bez(p, 0);
    for (let i = 1; i <= 24; i++) {
      const n = bez(p, i / 24);
      length += Math.hypot(n.x - last.x, n.y - last.y);
      last = n;
    }
    return { p: p.map((v) => ({ x: v.x / W, y: v.y / H })), length };
  }
  const TAU = Math.PI * 2;
  // Progress along the route. motion.s = [a1,k1,ph1,a2,k2,ph2]: integer k keeps
  // warp(0)=0 and warp(1)=1 and |a1|+|a2|<1 keeps it strictly increasing, so a
  // fish speeds up / slows down (darts) but never stops, reverses or jumps.
  function warp(m, q) {
    const s = m.s;
    if (!s) return q;
    let v = q;
    for (let i = 0; i + 2 < s.length; i += 3)
      v += (s[i] * (Math.sin(TAU * s[i + 1] * q + s[i + 2]) - Math.sin(s[i + 2]))) / (TAU * s[i + 1]);
    return clamp(v, 0, 1);
  }
  // Sideways offset in 844-wide px: school slot + wobble (motion.w =
  // [amp,cycles,phase], faded in/out at the route ends) + school split
  // (motion.sp = [startQ, px], eased over 20% of the route).
  function lateral(m, q) {
    let off = m.off || 0;
    if (m.w) {
      const e = clamp(Math.min(q, 1 - q) / 0.12, 0, 1),
        fade = e * e * (3 - 2 * e);
      off += fade * m.w[0] * Math.sin(TAU * m.w[1] * q + m.w[2]);
    }
    if (m.sp) {
      const e = clamp((q - m.sp[0]) / 0.2, 0, 1);
      off += m.sp[1] * e * e * (3 - 2 * e);
    }
    return off;
  }
  function at(m, q, width, height, k) {
    const u = warp(m, q),
      a = bez(m.p, u),
      e = u < 0.999 ? 0.001 : -0.001,
      b = bez(m.p, u + e),
      ang = Math.atan2((b.y - a.y) * height * Math.sign(e), (b.x - a.x) * width * Math.sign(e)),
      off = lateral(m, q) * k,
      y = a.y * height + Math.cos(ang) * off,
      // soft floor: formation offsets/wobble/splits ease in above the cannon
      // row instead of sinking into it (smooth, so still no jumps)
      L = height * 0.84,
      R = height * 0.05;
    return {
      x: a.x * width - Math.sin(ang) * off,
      y: y > L ? L + R * Math.tanh((y - L) / R) : y,
    };
  }
  function point(f, time, width = 844, height = 390) {
    if (!f.motion) return { x: f.x * width, y: f.y * height, ang: 0, t: 0 };
    const m = f.motion,
      t = (time - f.born) / m.duration,
      q = clamp(t, 0, 1),
      k = clamp(Math.min(width / 844, height / 390), 0.62, 1.5);
    if (!m.s && !m.w && !m.sp) {
      // pre-tg40 fish: unchanged maths
      const a = bez(m.p, q),
        b = bez(m.p, clamp(q + 0.001, 0, 1));
      const ang = Math.atan2((b.y - a.y) * height, (b.x - a.x) * width),
        off = (m.off || 0) * k;
      return { x: a.x * width - Math.sin(ang) * off, y: a.y * height + Math.cos(ang) * off, ang, t };
    }
    const a = at(m, q, width, height, k),
      e = q < 0.998 ? 0.002 : -0.002,
      b = at(m, q + e, width, height, k),
      ang = Math.atan2((b.y - a.y) * Math.sign(e), (b.x - a.x) * Math.sign(e));
    return { x: a.x, y: a.y, ang, t };
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
  const api = { bez, path, route, warp, lateral, point, hit, launch, step, ray };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReefMotion = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
