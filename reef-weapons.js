/* Reef Rumble weapon presentation (tg33). VISUAL + SOUND ONLY.
   Every weapon level 1-10 and every shot style (ARC, PLASMA, LASER) gets its own
   projectile silhouette, palette, trail, muzzle flash, impact and sound. Damage,
   cost, payout maths, caps and collisions are untouched: this file never reads or writes
   balances and never consumes the game RNG (own xorshift below).
   Perf: projectile bodies + glows are pre-rendered once per (kind, scale) into
   offscreen canvases at device resolution (HD, no quality loss); particles come
   from a fixed pool so firing creates no per-frame garbage. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  // id, display name, base length/width (CSS px at K=1), palette, trail, impact, sound
  const KINDS = {
    pellet:   { name: 'PEARL PELLET',  len: 16, wid: 16, core: '#ffffff', a: '#bfe8ff', b: '#3a9ad9', glow: '154,216,255', trail: 'bubbles',  impact: 'splash',   shake: 0,   size: 1.3 },
    needle:   { name: 'TWIN NEEDLES',  len: 34, wid: 7,  core: '#f2ffff', a: '#7af0ff', b: '#1ec8e0', glow: '122,240,255', trail: 'streak',   impact: 'needles',  shake: 0,   size: 1.15, twin: true },
    dart:     { name: 'CORAL DART',    len: 30, wid: 12, core: '#eafff9', a: '#5affe0', b: '#0f9c80', glow: '90,255,224',  trail: 'spiral',   impact: 'coral',    shake: 0,   size: 1.15 },
    torpedo:  { name: 'MINI TORPEDO',  len: 40, wid: 13, core: '#e9ffe9', a: '#7dff9a', b: '#1d7a3e', glow: '125,255,154', trail: 'wake',     impact: 'burst',    shake: .8,  size: 1.1 },
    harpoon:  { name: 'STEEL HARPOON', len: 58, wid: 14, core: '#ffffff', a: '#d4ff5a', b: '#6b7f22', glow: '212,255,90',  trail: 'rope',     impact: 'pierce',   shake: 1.2, size: 1.15 },
    goldtorp: { name: 'GOLD TORPEDO',  len: 54, wid: 18, core: '#fff7d0', a: '#ffe14a', b: '#a87808', glow: '255,225,74',  trail: 'jet',      impact: 'blast',    shake: 2.2, size: 1.25 },
    urchin:   { name: 'FIRE URCHIN',   len: 28, wid: 28, core: '#fff1c8', a: '#ffb03a', b: '#b24a06', glow: '255,150,40',  trail: 'embers',   impact: 'fire',     shake: 2.8, size: 1.35 },
    magma:    { name: 'MAGMA SHELL',   len: 36, wid: 26, core: '#ffe2c4', a: '#ff7a4a', b: '#4a1208', glow: '255,90,40',   trail: 'smoke',    impact: 'magma',    shake: 3.5, size: 1.45 },
    nova:     { name: 'NOVA STAR',     len: 34, wid: 34, core: '#ffffff', a: '#ff4d8a', b: '#8a0f55', glow: '255,77,138',  trail: 'ribbon',   impact: 'nova',     shake: 4.2, size: 1.55 },
    lance:    { name: 'KRAKEN LANCE',  len: 84, wid: 20, core: '#fffbe8', a: '#ff3d5a', b: '#ffcf4a', glow: '255,90,70',   trail: 'helix',    impact: 'supernova',shake: 5.5, size: 1.7 },
    arc:      { name: 'ARC BOLT',      len: 46, wid: 16, core: '#ffffff', a: '#9ef4ff', b: '#2a6dff', glow: '120,220,255', trail: 'lightning',impact: 'chain',    shake: 2.0, size: 1.3 },
    plasma:   { name: 'PLASMA ORB',    len: 34, wid: 34, core: '#fff6e6', a: '#ffb35a', b: '#c4209a', glow: '255,140,200', trail: 'plasma',   impact: 'plasmaRing',shake: 3.0, size: 1.5 },
    laser:    { name: 'LASER LANCE',   len: 70, wid: 10, core: '#ffffff', a: '#ff80ff', b: '#7a2cff', glow: '255,120,255', trail: 'streak',   impact: 'nova',     shake: 1.5, size: 1.2 }
  };
  const LEVEL_KIND = ['pellet', 'needle', 'dart', 'torpedo', 'harpoon', 'goldtorp', 'urchin', 'magma', 'nova', 'lance'];
  function kindOf(lv, style) {
    if (style === 'arc' || style === 'plasma' || style === 'laser') return style;
    return LEVEL_KIND[Math.min(10, Math.max(1, lv | 0 || 1)) - 1];
  }

  function create(opts) {
    const doc = (opts && opts.document) || (typeof document !== 'undefined' ? document : null);
    let seed = 0x2f6b1d3 >>> 0;
    const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    /* ---------- sprite cache (HD, device resolution) ---------- */
    const cache = new Map();
    function canvas(w, h) {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
      if (!doc) return null;
      const c = doc.createElement('canvas'); c.width = w; c.height = h; return c;
    }
    function sprite(id, scale) {
      const q = Math.max(.5, Math.round(scale * 4) / 4), key = id + '@' + q;
      let s = cache.get(key); if (s) return s;
      const k = KINDS[id], pad = 1.9, L = k.len * k.size * pad, Wd = Math.max(k.wid * k.size * pad, 1);
      const cw = Math.ceil(L * q), ch = Math.ceil(Wd * q * (k.twin ? 1.8 : 1));
      // tg36: the glow is a pure radial gradient (no detail), so its source is rendered at <=1/3 res and
      // bilinear-upscaled on draw: pixel-identical look, ~9-25x fewer source texels per bullet.
      const gq = Math.min(1, 96 / Math.max(L, Wd) / 1.3) * q, gx = Math.max(8, Math.ceil(L * gq * 1.3)), gy = Math.max(8, Math.ceil(Math.max(L, Wd) * gq * 1.3));
      const body = canvas(cw, ch), glow = canvas(gx, gy);
      if (!body || !glow) return null;
      const g = body.getContext('2d'); g.translate(cw / 2, ch / 2); g.scale(q * k.size, q * k.size);
      try { paintBody(g, id, k); } catch (e) {}
      const gg = glow.getContext('2d'), gw = glow.width, gh = glow.height;
      const rg = gg.createRadialGradient(gw / 2, gh / 2, 0, gw / 2, gh / 2, Math.min(gw, gh) / 2);
      rg.addColorStop(0, 'rgba(' + k.glow + ',.85)'); rg.addColorStop(.35, 'rgba(' + k.glow + ',.35)'); rg.addColorStop(1, 'rgba(' + k.glow + ',0)');
      gg.fillStyle = rg; gg.fillRect(0, 0, gw, gh);
      // tg36: freeze both into ImageBitmaps (immutable textures): drawing a live OffscreenCanvas forced a
      // FinalizeFrame snapshot on every drawImage, every bullet, every frame.
      const freeze = (c) => { try { return c.transferToImageBitmap ? c.transferToImageBitmap() : c; } catch (e) { return c; } };
      s = { body: freeze(body), glow: freeze(glow), w: cw / q, h: ch / q, gw: (L * 1.3), gh: (Math.max(L, Wd) * 1.3) };
      cache.set(key, s); if (cache.size > 64) cache.delete(cache.keys().next().value);
      return s;
    }
    function lg(g, x0, y0, x1, y1, stops) { const G = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => G.addColorStop(i / (stops.length - 1), c)); return G; }
    function rg(g, x, y, r, stops) { const G = g.createRadialGradient(x, y - r * .25, r * .05, x, y, r); stops.forEach((c, i) => G.addColorStop(i / (stops.length - 1), c)); return G; }
    // All bodies point along +x, centred on (0,0), in CSS px at size 1.
    function paintBody(g, id, k) {
      const L = k.len, R = k.wid / 2;
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (id === 'pellet') {
        g.fillStyle = rg(g, 0, 0, R, ['#ffffff', '#e9f7ff', '#9fd2f2', '#3d7fb0']); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.ellipse(-R * .3, -R * .35, R * .32, R * .2, -.5, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = .8; g.beginPath(); g.arc(0, 0, R * .92, 0, TAU); g.stroke();
      } else if (id === 'needle' || id === 'laser') {
        for (const off of (k.twin ? [-R * 1.6, R * 1.6] : [0])) {
          g.fillStyle = lg(g, -L / 2, 0, L / 2, 0, ['rgba(255,255,255,0)', k.a, '#ffffff']);
          g.beginPath(); g.moveTo(L / 2, off); g.lineTo(-L / 2, off - R); g.lineTo(-L / 2 + 4, off); g.lineTo(-L / 2, off + R); g.closePath(); g.fill();
          g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-L * .2, off); g.lineTo(L / 2, off); g.stroke();
        }
      } else if (id === 'dart') {
        g.fillStyle = lg(g, 0, -R, 0, R, ['#d9fff6', k.a, k.b]);
        g.beginPath(); g.moveTo(L / 2, 0); g.quadraticCurveTo(L * .1, -R, -L * .3, -R * .55); g.lineTo(-L / 2, -R); g.lineTo(-L * .38, 0); g.lineTo(-L / 2, R); g.lineTo(-L * .3, R * .55); g.quadraticCurveTo(L * .1, R, L / 2, 0); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = .9; g.stroke();
        g.fillStyle = '#ff7aa8'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-L * .05 + i * 5, 0, 1.6, 0, TAU); g.fill(); }
      } else if (id === 'torpedo' || id === 'goldtorp') {
        const gold = id === 'goldtorp';
        g.fillStyle = lg(g, 0, -R, 0, R, gold ? ['#fff4c0', '#ffd23a', '#b07a08', '#4a3002'] : ['#e8fff0', '#7ee89a', '#2b7a46', '#10301c']);
        g.beginPath(); g.moveTo(L / 2, 0); g.bezierCurveTo(L / 2, -R * 1.05, L * .25, -R, 0, -R); g.lineTo(-L * .38, -R * .9); g.lineTo(-L * .46, -R * .5); g.lineTo(-L * .46, R * .5); g.lineTo(-L * .38, R * .9); g.lineTo(0, R); g.bezierCurveTo(L * .25, R, L / 2, R * 1.05, L / 2, 0); g.fill();
        g.strokeStyle = gold ? 'rgba(255,240,180,.9)' : 'rgba(220,255,230,.8)'; g.lineWidth = .9; g.stroke();
        g.fillStyle = gold ? '#7a4a04' : '#164a2a';
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-L * .3, s * R * .8); g.lineTo(-L / 2, s * R * 1.65); g.lineTo(-L * .46, s * R * .5); g.closePath(); g.fill(); }
        g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(L * .12, -R * .45, L * .22, R * .16, 0, 0, TAU); g.fill();
        g.strokeStyle = gold ? '#fff2a0' : '#c6ffd6'; g.lineWidth = 1.3; for (const x of [L * .05, -L * .15]) { g.beginPath(); g.moveTo(x, -R * .95); g.lineTo(x, R * .95); g.stroke(); }
        if (gold) { g.fillStyle = '#ff3d5a'; g.beginPath(); g.arc(L * .36, 0, R * .22, 0, TAU); g.fill(); }
      } else if (id === 'harpoon') {
        g.strokeStyle = lg(g, -L / 2, 0, L / 2, 0, ['#4b4f3a', '#c9cfb2', '#f4f8e8']); g.lineWidth = R * .38; g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(L * .26, 0); g.stroke();
        g.fillStyle = lg(g, L * .2, -R, L * .2, R, ['#ffffff', '#cdd7c0', '#5b6450']);
        g.beginPath(); g.moveTo(L / 2, 0); g.lineTo(L * .2, -R); g.lineTo(L * .27, -R * .2); g.lineTo(L * .16, -R * .25); g.lineTo(L * .16, R * .25); g.lineTo(L * .27, R * .2); g.lineTo(L * .2, R); g.closePath(); g.fill();
        g.strokeStyle = k.a; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = '#d4ff5a'; g.fillRect(-L * .44, -R * .45, L * .06, R * .9); g.fillRect(-L * .32, -R * .45, L * .06, R * .9);
      } else if (id === 'urchin') {
        for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r2 = R * (i % 2 ? .95 : 1.25); g.strokeStyle = i % 2 ? '#ffd27a' : '#fff0c0'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(Math.cos(a) * R * .45, Math.sin(a) * R * .45); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); g.stroke(); }
        g.fillStyle = rg(g, 0, 0, R * .62, ['#fffbe0', '#ffb03a', '#d2560a', '#5a1a02']); g.beginPath(); g.arc(0, 0, R * .62, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,220,.9)'; g.beginPath(); g.arc(-R * .18, -R * .2, R * .14, 0, TAU); g.fill();
      } else if (id === 'magma') {
        g.fillStyle = rg(g, 0, 0, R, ['#ffe9c0', '#ff8a3a', '#a8200c', '#2a0a04']);
        g.beginPath(); g.moveTo(L / 2, 0); g.bezierCurveTo(L / 2, -R * 1.2, -L / 2, -R * 1.1, -L / 2, 0); g.bezierCurveTo(-L / 2, R * 1.1, L / 2, R * 1.2, L / 2, 0); g.fill();
        g.strokeStyle = '#ffd08a'; g.lineWidth = 1.1; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-L * .4 + i * L * .17, -R * .75); g.quadraticCurveTo(-L * .3 + i * L * .17, 0, -L * .4 + i * L * .17, R * .75); g.stroke(); }
        g.fillStyle = 'rgba(30,8,2,.55)'; g.beginPath(); g.ellipse(-L * .1, R * .3, L * .18, R * .22, .3, 0, TAU); g.fill();
      } else if (id === 'nova') {
        g.fillStyle = rg(g, 0, 0, R, ['#ffffff', '#ffd0e4', '#ff4d8a', '#8a0f55']);
        g.beginPath(); for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r2 = i % 2 ? R * .42 : R; i ? g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2) : g.moveTo(r2, 0); } g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, R * .22, 0, TAU); g.fill();
      } else if (id === 'lance') {
        g.fillStyle = lg(g, -L / 2, 0, L / 2, 0, ['rgba(255,207,74,0)', '#ffcf4a', '#ff3d5a', '#ffffff']);
        g.beginPath(); g.moveTo(L / 2, 0); g.lineTo(L * .22, -R); g.lineTo(L * .05, -R * .35); g.lineTo(-L / 2, -R * .25); g.lineTo(-L / 2, R * .25); g.lineTo(L * .05, R * .35); g.lineTo(L * .22, R); g.closePath(); g.fill();
        g.strokeStyle = '#fff6c0'; g.lineWidth = 1.4; g.stroke();
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(L / 2, 0); g.lineTo(L * .25, -R * .3); g.lineTo(L * .25, R * .3); g.closePath(); g.fill();
        g.strokeStyle = '#ffcf4a'; g.lineWidth = 1.6; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(L * .1, s * R * .4); g.quadraticCurveTo(-L * .05, s * R * 1.35, -L * .22, s * R * .9); g.stroke(); }
      } else if (id === 'arc') {
        g.strokeStyle = 'rgba(160,240,255,.55)'; g.lineWidth = R * .9; g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(-L * .2, -R * .7); g.lineTo(0, R * .5); g.lineTo(L * .22, -R * .4); g.lineTo(L / 2, 0); g.stroke();
        g.strokeStyle = '#ffffff'; g.lineWidth = R * .32; g.stroke();
        g.fillStyle = rg(g, L * .4, 0, R * .8, ['#ffffff', '#c8f8ff', 'rgba(80,180,255,0)']); g.beginPath(); g.arc(L * .4, 0, R * .8, 0, TAU); g.fill();
      } else if (id === 'plasma') {
        g.fillStyle = rg(g, 0, 0, R, ['#ffffff', '#ffe0a8', '#ff7ac0', 'rgba(140,30,200,.25)']); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,240,210,.9)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, 0, R * 1.0, R * .38, .5, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(0, 0, R * 1.0, R * .38, -.5, 0, TAU); g.stroke();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, R * .3, 0, TAU); g.fill();
      }
    }
    /* ---------- particle + effect pools ---------- */
    const PMAX = 520, P = []; for (let i = 0; i < PMAX; i++) P.push({ on: false });
    let pHead = 0;
    function emit(x, y, vx, vy, life, r, col, kind, grav) {
      const p = P[pHead]; pHead = (pHead + 1) % PMAX;
      p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.life = life; p.r = r; p.col = col; p.kind = kind; p.g = grav || 0; p.rot = rand() * TAU;
    }
    const FMAX = 48, FX = []; for (let i = 0; i < FMAX; i++) FX.push({ on: false });
    let fHead = 0;
    function fx(type, id, x, y, ang, scale, dur) {
      const e = FX[fHead]; fHead = (fHead + 1) % FMAX;
      e.on = true; e.type = type; e.id = id; e.x = x; e.y = y; e.ang = ang; e.s = scale; e.t = 0; e.d = dur; e.seed = (rand() * 1e6) | 0;
      return e;
    }
    /* ---------- spawn hooks ---------- */
    function muzzle(x, y, ang, lv, style, K, reduced) {
      const id = kindOf(lv, style), k = KINDS[id];
      fx('muzzle', id, x, y, ang, K * k.size, id === 'lance' || id === 'magma' ? .2 : .14);
      if (reduced) return id;
      const ca = Math.cos(ang), sa = Math.sin(ang), n = id === 'pellet' ? 3 : id === 'needle' ? 4 : 7 + (k.shake | 0);
      for (let i = 0; i < n; i++) {
        const sp = (60 + rand() * 160) * K, a = ang + (rand() - .5) * (id === 'needle' ? .3 : 1.1);
        const col = id === 'magma' || id === 'urchin' ? (rand() < .5 ? '#ffb03a' : '#5a5a5a') : rand() < .5 ? k.a : k.core;
        emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, .25 + rand() * .25, (1 + rand() * 1.8) * K * k.size, col, id === 'magma' ? 'smoke' : 'spark', 0);
      }
      if (id === 'torpedo' || id === 'goldtorp' || id === 'pellet') for (let i = 0; i < 4; i++) emit(x - ca * 6 * K, y - sa * 6 * K, (rand() - .5) * 30 * K, -(20 + rand() * 30) * K, .6 + rand() * .3, (1.5 + rand() * 2) * K, 'rgba(220,250,255,.8)', 'bubble', -10 * K);
      return id;
    }
    // Returns screen shake {t, a} the caller may apply (0 when none).
    function impact(x, y, lv, style, K, reduced) {
      const id = kindOf(lv, style), k = KINDS[id];
      fx('impact', id, x, y, 0, K * k.size, k.impact === 'supernova' ? .75 : k.impact === 'splash' || k.impact === 'needles' ? .35 : .55);
      if (!reduced) {
        const n = { splash: 8, needles: 6, coral: 10, burst: 14, pierce: 10, blast: 20, fire: 22, magma: 22, nova: 24, supernova: 34, chain: 16, plasmaRing: 22 }[k.impact] || 10;
        for (let i = 0; i < n; i++) {
          const a = rand() * TAU, sp = (50 + rand() * (90 + k.shake * 40)) * K;
          let col = rand() < .5 ? k.a : k.core, kind = 'spark', g = 0;
          if (k.impact === 'splash' || k.impact === 'burst') { kind = 'bubble'; col = 'rgba(220,250,255,.85)'; g = -30 * K; }
          if (k.impact === 'fire' || k.impact === 'magma') { kind = rand() < .35 ? 'smoke' : 'ember'; col = kind === 'smoke' ? 'rgba(70,60,60,.6)' : (rand() < .5 ? '#ffd27a' : '#ff6a2a'); g = kind === 'ember' ? 60 * K : -20 * K; }
          if (k.impact === 'coral') { kind = 'shard'; col = rand() < .5 ? '#ff7aa8' : k.a; }
          if (k.impact === 'chain') kind = 'zap';
          emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, .35 + rand() * .45, (1.2 + rand() * 2.4) * K * k.size, col, kind, g);
        }
      }
      return reduced ? { t: 0, a: 0 } : { t: k.shake ? .12 + k.shake * .03 : 0, a: k.shake };
    }
    /* ---------- per-bullet trail history (fixed arrays, no per-frame alloc) ---------- */
    const HN = 14;
    function track(b, dt, K, reduced) {
      if (!b._hx) { b._hx = new Float32Array(HN); b._hy = new Float32Array(HN); b._hn = 0; b._hi = 0; b._sp = rand() * TAU; b._em = 0; }
      // a bounce/teleport (big jump) resets the trail so it never streaks across the reef
      if (b._hn) { const li = (b._hi + HN - 1) % HN, jx = b.x - b._hx[li], jy = b.y - b._hy[li]; if (jx * jx + jy * jy > 3600 * K * K) b._hn = 0; }
      b._hx[b._hi] = b.x; b._hy[b._hi] = b.y; b._hi = (b._hi + 1) % HN; b._hn = Math.min(HN, b._hn + 1);
      b._sp += dt * 14;
      if (reduced) return;
      const id = kindOf(b.lv, b.style), k = KINDS[id];
      b._em += dt;
      const every = { bubbles: .05, wake: .03, embers: .025, smoke: .035, jet: .03, plasma: .04, helix: .03, lightning: .05 }[k.trail];
      if (!every) return;
      const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp, back = k.len * k.size * .5 * K;
      while (b._em >= every) {
        b._em -= every;
        const x = b.x - ux * back, y = b.y - uy * back, j = (rand() - .5) * 10 * K;
        if (k.trail === 'bubbles' || k.trail === 'wake') emit(x - uy * j, y + ux * j, -ux * 20 * K + (rand() - .5) * 20 * K, -uy * 20 * K - 15 * K, .55 + rand() * .4, (1 + rand() * (k.trail === 'wake' ? 2.6 : 1.6)) * K, 'rgba(225,250,255,.75)', 'bubble', -25 * K);
        else if (k.trail === 'embers') emit(x - uy * j, y + ux * j, -ux * 60 * K + (rand() - .5) * 60 * K, -uy * 60 * K + (rand() - .5) * 60 * K, .35 + rand() * .3, (1 + rand() * 2) * K, rand() < .5 ? '#ffd27a' : '#ff6a2a', 'ember', 40 * K);
        else if (k.trail === 'smoke') emit(x, y, -ux * 25 * K, -uy * 25 * K - 10 * K, .7 + rand() * .4, (3 + rand() * 3) * K, 'rgba(60,40,36,.55)', 'smoke', -12 * K);
        else if (k.trail === 'jet') emit(x, y, -ux * 120 * K + (rand() - .5) * 40 * K, -uy * 120 * K + (rand() - .5) * 40 * K, .22 + rand() * .15, (2 + rand() * 2.5) * K, rand() < .5 ? '#fff2a0' : '#ffb030', 'flame', 0);
        else if (k.trail === 'plasma') { const a = rand() * TAU; emit(b.x + Math.cos(a) * 14 * K, b.y + Math.sin(a) * 14 * K, -ux * 30 * K, -uy * 30 * K, .35, (1.5 + rand() * 1.5) * K, rand() < .5 ? '#ffb35a' : '#ff7ac0', 'spark', 0); }
        else if (k.trail === 'helix') emit(x, y, (rand() - .5) * 80 * K, (rand() - .5) * 80 * K, .3 + rand() * .2, (1.2 + rand() * 1.6) * K, rand() < .5 ? '#ffcf4a' : '#ff3d5a', 'spark', 0);
        else if (k.trail === 'lightning') emit(x, y, (rand() - .5) * 140 * K, (rand() - .5) * 140 * K, .18, 1.4 * K, '#c8f8ff', 'zap', 0);
      }
    }
    function update(dt) {
      if (!(dt > 0)) return;
      for (const p of P) { if (!p.on) continue; p.t += dt; if (p.t >= p.life) { p.on = false; continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .94; p.vy = p.vy * .94 + p.g * dt; p.rot += dt * 4; }
      for (const e of FX) { if (!e.on) continue; e.t += dt; if (e.t >= e.d) e.on = false; }
    }
    /* ---------- drawing ---------- */
    const H2 = [0, 0]; // tg36: shared scratch pair; callers destructure immediately (no per-point array garbage)
    function hist(b, i) { const j = (b._hi - 1 - i + HN * 2) % HN; H2[0] = b._hx[j]; H2[1] = b._hy[j]; return H2; }
    function drawTrail(g, b, id, k, K, now, ux, uy, reduced) {
      const n = b._hn || 0; if (n < 2) return;
      const T = k.trail;
      if (T === 'streak' || T === 'ribbon' || T === 'rope' || T === 'spiral' || T === 'helix' || T === 'jet' || T === 'wake' || T === 'smoke' || T === 'embers' || T === 'bubbles' || T === 'plasma' || T === 'lightning') {
        const m = Math.min(n, T === 'rope' ? 14 : T === 'ribbon' || T === 'helix' ? 12 : 8);
        if (T === 'rope') { g.strokeStyle = 'rgba(214,226,190,.7)'; g.lineWidth = 1.4 * K; g.setLineDash([3 * K, 2 * K]); g.beginPath(); for (let i = 0; i < m; i++) { const [x, y] = hist(b, i); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.setLineDash([]); return; }
        if (T === 'spiral' || T === 'helix') {
          for (const ph of [0, Math.PI]) {
            g.beginPath();
            for (let i = 0; i < m; i++) { const [x, y] = hist(b, i), w = (1 - i / m) * (T === 'helix' ? 11 : 7) * K * k.size, o = Math.sin(b._sp - i * .9 + ph) * w; i ? g.lineTo(x - uy * o, y + ux * o) : g.moveTo(x - uy * o, y + ux * o); }
            g.strokeStyle = ph ? k.a : (T === 'helix' ? k.b : '#ff9ac0'); g.lineWidth = (T === 'helix' ? 2.6 : 1.8) * K; g.stroke();
          }
          return;
        }
        if (T === 'lightning') {
          const [x0, y0] = hist(b, m - 1); const dx = b.x - x0, dy = b.y - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, ph = reduced ? 0 : Math.floor(now / 45);
          for (let s = 0; s < 2; s++) { g.beginPath(); g.moveTo(x0, y0); for (let i = 1; i <= 8; i++) { const u = i / 8, o = i === 8 ? 0 : Math.sin(i * 12.9898 + ph * 3.1 + s * 7) * 9 * K; g.lineTo(x0 + dx * u + nx * o, y0 + dy * u + ny * o); } g.strokeStyle = s ? '#ffffff' : 'rgba(120,200,255,.6)'; g.lineWidth = (s ? 1.4 : 4.5) * K; g.stroke(); }
          return;
        }
        // tapered streak / ribbon / exhaust glow
        const width = T === 'ribbon' ? 9 : T === 'jet' ? 8 : T === 'plasma' ? 12 : T === 'smoke' ? 7 : 4;
        for (let i = 1; i < m; i++) {
          const [x1, y1] = hist(b, i - 1), [x2, y2] = hist(b, i), u = i / m;
          g.globalAlpha = (1 - u) * (T === 'ribbon' ? .85 : .6);
          g.strokeStyle = T === 'ribbon' ? (i % 2 ? k.a : '#ffd0e4') : T === 'smoke' ? '#ff5a28' : k.a;
          g.lineWidth = Math.max(.5, width * (1 - u) * K * k.size); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
    function drawBullet(g, b, now, K, reduced) {
      const id = kindOf(b.lv, b.style), k = KINDS[id];
      const s = sprite(id, K * Math.min(2, root.devicePixelRatio || 1)); if (!s) return; // tg36: match the game canvas DPR cap (2) — no oversized 3x sprites
      const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp, ang = Math.atan2(uy, ux);
      g.save(); g.lineCap = 'round'; g.globalCompositeOperation = 'lighter';
      drawTrail(g, b, id, k, K, now, ux, uy, reduced);
      const pulse = reduced ? 1 : 1 + .12 * Math.sin(now * .02 + (b._sp || 0));
      g.globalAlpha = .9; g.drawImage(s.glow, b.x - s.gw * K * pulse / 2, b.y - s.gh * K * pulse / 2, s.gw * K * pulse, s.gh * K * pulse);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.translate(b.x, b.y);
      const spin = id === 'urchin' ? (b._sp || 0) * .8 : id === 'nova' ? (b._sp || 0) * 1.2 : id === 'plasma' ? (b._sp || 0) * .5 : 0;
      g.rotate(ang + spin);
      if (id === 'plasma' && !reduced) { const q = 1 + .15 * Math.sin(now * .03); g.scale(q, q); }
      g.drawImage(s.body, -s.w * K / 2, -s.h * K / 2, s.w * K, s.h * K);
      g.restore();
    }
    function drawFx(g, now, K, reduced) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const p of P) {
        if (!p.on) continue;
        const u = p.t / p.life, a = Math.max(0, 1 - u);
        if (p.kind === 'bubble') { g.globalCompositeOperation = 'source-over'; g.globalAlpha = a * .9; g.strokeStyle = p.col; g.lineWidth = Math.max(.6, p.r * .35); g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke(); g.globalCompositeOperation = 'lighter'; continue; }
        if (p.kind === 'smoke') { g.globalCompositeOperation = 'source-over'; g.globalAlpha = a * .5; g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, p.r * (1 + u * 1.6), 0, TAU); g.fill(); g.globalCompositeOperation = 'lighter'; continue; }
        g.globalAlpha = a; g.fillStyle = p.col;
        if (p.kind === 'shard') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.r, -p.r * .35, p.r * 2, p.r * .7); g.restore(); continue; }
        if (p.kind === 'zap') { g.strokeStyle = p.col; g.lineWidth = Math.max(.8, p.r * .6); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * .03 + Math.sin(p.rot * 3) * 3 * K, p.y - p.vy * .03); g.stroke(); continue; }
        const r = p.kind === 'flame' ? p.r * (1 + u) : p.r * (1 - u * .4);
        g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      for (const e of FX) { if (!e.on) continue; if (e.type === 'muzzle') drawMuzzle(g, e, K, reduced); else drawImpact(g, e, K, reduced); }
      g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    function star(g, x, y, n, r1, r2, rot) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, r = i % 2 ? r2 : r1; i ? g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); }
    // tg36: radial glows are cached once per palette as a small gradient texture and drawn as one textured
    // quad (pixel diff vs the live gradient: max 2/255). Was: a new CanvasGradient + path fill per glow,
    // per effect, per frame (dozens a frame at LV10 / ARC / PLASMA), each one a fresh shader on the GPU.
    const GLOW = new Map();
    function glowTex(key, stops) {
      let t = GLOW.get(key); if (t !== undefined) return t;
      t = null;
      try { const S = 128, c = canvas(S, S), cg = c && c.getContext('2d'); if (cg) { const G = cg.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); for (const [o, col] of stops) G.addColorStop(o, col); cg.fillStyle = G; cg.fillRect(0, 0, S, S); t = c.transferToImageBitmap ? c.transferToImageBitmap() : c; } } catch (e) { t = null; }
      GLOW.set(key, t); return t;
    }
    function glowDisc(g, x, y, r, rgb, alpha, core) {
      r = Math.max(1, r);
      const t = glowTex(rgb + '|' + alpha + '|' + (core || ''), [[0, core || 'rgba(255,255,255,' + alpha + ')'], [.35, 'rgba(' + rgb + ',' + alpha * .8 + ')'], [1, 'rgba(' + rgb + ',0)']]);
      if (t) { g.drawImage(t, x - r, y - r, r * 2, r * 2); return; }
      glowDiscLive(g, x, y, r, rgb, alpha, core);
    }
    function glowDiscLive(g, x, y, r, rgb, alpha, core) { const G = g.createRadialGradient(x, y, 0, x, y, Math.max(1, r)); G.addColorStop(0, core || 'rgba(255,255,255,' + alpha + ')'); G.addColorStop(.35, 'rgba(' + rgb + ',' + alpha * .8 + ')'); G.addColorStop(1, 'rgba(' + rgb + ',0)'); g.fillStyle = G; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
    function drawMuzzle(g, e, K, reduced) {
      const k = KINDS[e.id], u = e.t / e.d, a = 1 - u, s = e.s, ca = Math.cos(e.ang), sa = Math.sin(e.ang);
      g.globalAlpha = a;
      if (e.id === 'pellet') { glowDisc(g, e.x, e.y, 12 * s, k.glow, .9); return; }
      if (e.id === 'needle' || e.id === 'laser') { for (const o of [-6, 6]) glowDisc(g, e.x - sa * o * s, e.y + ca * o * s, 9 * s, k.glow, .95); g.strokeStyle = '#ffffff'; g.lineWidth = 2 * s; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(e.x + ca * 26 * s * a, e.y + sa * 26 * s * a); g.stroke(); return; }
      if (e.id === 'arc') { glowDisc(g, e.x, e.y, 22 * s, k.glow, .9); g.strokeStyle = '#e8fdff'; g.lineWidth = 1.5 * s; for (let i = 0; i < 5; i++) { const an = e.ang + (i - 2) * .55; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(e.x + Math.cos(an + .3) * 12 * s, e.y + Math.sin(an + .3) * 12 * s); g.lineTo(e.x + Math.cos(an) * 24 * s, e.y + Math.sin(an) * 24 * s); g.stroke(); } return; }
      if (e.id === 'plasma') { glowDisc(g, e.x, e.y, 30 * s * (.6 + u * .6), k.glow, .9, '#fff6e6'); g.strokeStyle = 'rgba(255,180,90,' + a + ')'; g.lineWidth = 3 * s * a; g.beginPath(); g.arc(e.x, e.y, 34 * s * u + 6 * s, 0, TAU); g.stroke(); return; }
      const r = (16 + k.shake * 4) * s;
      glowDisc(g, e.x, e.y, r * (.7 + u * .5), k.glow, .95);
      g.fillStyle = k.core; star(g, e.x + ca * 4 * s, e.y + sa * 4 * s, e.id === 'lance' ? 8 : e.id === 'nova' ? 6 : 5, r * .9 * a + 4 * s, r * .3, e.ang + (reduced ? 0 : u * 1.2)); g.fill();
      if (k.shake >= 2) { g.strokeStyle = 'rgba(' + k.glow + ',' + a + ')'; g.lineWidth = 2.5 * s * a; g.beginPath(); g.ellipse(e.x + ca * 10 * s, e.y + sa * 10 * s, r * u * 1.4 + 3, r * u * .7 + 2, e.ang, 0, TAU); g.stroke(); }
    }
    function drawImpact(g, e, K, reduced) {
      const k = KINDS[e.id], u = e.t / e.d, a = 1 - u, s = e.s, I = k.impact, eo = 1 - (1 - u) * (1 - u);
      g.globalAlpha = a;
      if (I === 'splash' || I === 'needles') { g.strokeStyle = k.a; g.lineWidth = 2 * s * a; g.beginPath(); g.arc(e.x, e.y, 22 * s * eo, 0, TAU); g.stroke(); if (I === 'needles') { g.beginPath(); g.arc(e.x, e.y, 12 * s * eo, 0, TAU); g.stroke(); } glowDisc(g, e.x, e.y, 10 * s * a + 2, k.glow, .8); return; }
      if (I === 'coral') { glowDisc(g, e.x, e.y, 22 * s * eo + 4, k.glow, .8); g.fillStyle = '#ff7aa8'; star(g, e.x, e.y, 6, 20 * s * eo + 3, 7 * s * eo + 1, u); g.globalAlpha = a * .7; g.fill(); return; }
      if (I === 'burst' || I === 'pierce') {
        glowDisc(g, e.x, e.y, 30 * s * eo + 6, k.glow, .9);
        g.strokeStyle = k.a; g.lineWidth = 3 * s * a; g.beginPath(); g.arc(e.x, e.y, 38 * s * eo, 0, TAU); g.stroke();
        if (I === 'pierce') { g.strokeStyle = '#ffffff'; g.lineWidth = 2 * s * a; for (let i = 0; i < 8; i++) { const an = i * TAU / 8 + e.seed; g.beginPath(); g.moveTo(e.x + Math.cos(an) * 10 * s, e.y + Math.sin(an) * 10 * s); g.lineTo(e.x + Math.cos(an) * 44 * s * eo, e.y + Math.sin(an) * 44 * s * eo); g.stroke(); } }
        return;
      }
      if (I === 'blast' || I === 'fire' || I === 'magma') {
        const R = (I === 'magma' ? 62 : I === 'fire' ? 54 : 48) * s;
        // tg36: every stop scales linearly with a, so a cached a=1 texture drawn at alpha a*a (the outer
        // globalAlpha was already a) gives the same pixels without a new gradient per frame.
        const Rr = Math.max(1, R * (.4 + eo * .8)), t = glowTex('blast|' + I, [[0, 'rgba(255,255,230,1)'], [.3, I === 'magma' ? 'rgba(255,110,40,1)' : I === 'fire' ? 'rgba(255,170,50,1)' : 'rgba(255,225,74,1)'], [.7, I === 'magma' ? 'rgba(140,20,8,.7)' : 'rgba(255,90,20,.5)'], [1, 'rgba(60,10,0,0)']]);
        if (t) { g.globalAlpha = a * a; g.drawImage(t, e.x - Rr, e.y - Rr, Rr * 2, Rr * 2); g.globalAlpha = a; }
        else {
        const G = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, Rr);
        G.addColorStop(0, 'rgba(255,255,230,' + a + ')'); G.addColorStop(.3, I === 'magma' ? 'rgba(255,110,40,' + a + ')' : I === 'fire' ? 'rgba(255,170,50,' + a + ')' : 'rgba(255,225,74,' + a + ')');
        G.addColorStop(.7, I === 'magma' ? 'rgba(140,20,8,' + a * .7 + ')' : 'rgba(255,90,20,' + a * .5 + ')'); G.addColorStop(1, 'rgba(60,10,0,0)');
        g.fillStyle = G; g.beginPath(); g.arc(e.x, e.y, Rr, 0, TAU); g.fill();
        }
        g.strokeStyle = I === 'blast' ? 'rgba(255,240,170,' + a + ')' : 'rgba(255,200,120,' + a + ')'; g.lineWidth = 4 * s * a; g.beginPath(); g.arc(e.x, e.y, R * 1.25 * eo, 0, TAU); g.stroke();
        return;
      }
      if (I === 'nova' || I === 'supernova') {
        const big = I === 'supernova', R = (big ? 96 : 62) * s;
        glowDisc(g, e.x, e.y, R * (.3 + eo * .7), k.glow, 1);
        g.fillStyle = big ? '#fff3c0' : '#ffd0e4'; star(g, e.x, e.y, big ? 12 : 8, R * (.25 + eo * .9), R * .1, reduced ? 0 : u * .8); g.globalAlpha = a * .85; g.fill();
        g.globalAlpha = a; g.lineWidth = 3.5 * s * a;
        for (let i = 0; i < (big ? 3 : 2); i++) { const uu = Math.max(0, eo - i * .18); g.strokeStyle = i % 2 ? k.b : k.a; g.beginPath(); g.arc(e.x, e.y, R * 1.2 * uu, 0, TAU); g.stroke(); }
        return;
      }
      if (I === 'chain') {
        glowDisc(g, e.x, e.y, 34 * s * eo + 6, k.glow, .9);
        g.strokeStyle = '#e8fdff'; g.lineWidth = 1.8 * s;
        for (let i = 0; i < 7; i++) { const an = i * TAU / 7 + e.seed * .001, L = 50 * s * (.5 + eo * .7); g.beginPath(); g.moveTo(e.x, e.y); for (let j = 1; j <= 4; j++) { const r = L * j / 4, w = (j === 4 ? 0 : Math.sin(e.seed + i * 3 + j * 5) * 7 * s); g.lineTo(e.x + Math.cos(an) * r - Math.sin(an) * w, e.y + Math.sin(an) * r + Math.cos(an) * w); } g.stroke(); }
        return;
      }
      if (I === 'plasmaRing') {
        glowDisc(g, e.x, e.y, 40 * s * (.3 + eo * .6), k.glow, 1, '#fff6e6');
        g.lineWidth = 6 * s * a; g.strokeStyle = 'rgba(255,170,90,' + a + ')'; g.beginPath(); g.arc(e.x, e.y, 64 * s * eo, 0, TAU); g.stroke();
        g.lineWidth = 3 * s * a; g.strokeStyle = 'rgba(200,60,220,' + a + ')'; g.beginPath(); g.arc(e.x, e.y, 46 * s * eo, 0, TAU); g.stroke();
      }
    }
    // Sound designs (fed to the game's own WebAudio helpers so mute/volume still apply).
    const SOUNDS = {
      pellet:   [['tone', 1250, .06, 'sine', .07, 620]],
      needle:   [['tone', 2100, .03, 'square', .035, 1500], ['tone', 2300, .03, 'square', .03, 1600, .035]],
      dart:     [['tone', 980, .09, 'triangle', .08, 320], ['noise', .07, .05, 5000]],
      torpedo:  [['tone', 210, .16, 'sine', .14, 70], ['noise', .18, .09, 900]],
      harpoon:  [['tone', 520, .14, 'triangle', .1, 230], ['tone', 1560, .05, 'square', .03, 900], ['noise', .06, .05, 3500]],
      goldtorp: [['noise', .22, .12, 1600], ['tone', 160, .22, 'sine', .15, 60], ['tone', 880, .08, 'triangle', .05, 1320]],
      urchin:   [['noise', .16, .1, 3200], ['tone', 420, .12, 'square', .05, 180], ['tone', 300, .08, 'sawtooth', .04, 120, .04]],
      magma:    [['tone', 95, .3, 'sine', .2, 38], ['noise', .3, .12, 600], ['tone', 190, .2, 'sawtooth', .05, 70]],
      nova:     [['tone', 1046, .1, 'triangle', .07], ['tone', 1568, .12, 'triangle', .06, 0, .04], ['tone', 2093, .14, 'sine', .05, 0, .08]],
      lance:    [['tone', 330, .24, 'sawtooth', .07, 110], ['tone', 440, .24, 'sawtooth', .06, 147], ['noise', .2, .1, 2400], ['tone', 82, .3, 'sine', .16, 41]],
      arc:      [['tone', 2400, .14, 'sawtooth', .05, 300], ['noise', .1, .07, 6000]],
      plasma:   [['tone', 300, .2, 'sine', .12, 900], ['tone', 150, .22, 'triangle', .1, 60]],
      laser:    [['tone', 1400, .08, 'sawtooth', .05, 900]]
    };
    const IMPACT_SOUNDS = {
      splash: [['noise', .08, .06, 2600]], needles: [['tone', 2600, .03, 'square', .025]], coral: [['noise', .1, .07, 3000]],
      burst: [['noise', .16, .12, 1200], ['tone', 180, .12, 'sine', .08, 80]], pierce: [['tone', 1700, .05, 'square', .04, 700], ['noise', .1, .08, 2400]],
      blast: [['noise', .3, .18, 800], ['tone', 120, .26, 'sine', .14, 45]], fire: [['noise', .3, .16, 1400], ['tone', 200, .2, 'sawtooth', .04, 80]],
      magma: [['noise', .38, .2, 500], ['tone', 70, .35, 'sine', .2, 32]], nova: [['tone', 1318, .18, 'triangle', .06, 2637], ['noise', .2, .1, 5000]],
      supernova: [['noise', .5, .24, 700], ['tone', 60, .5, 'sine', .22, 30], ['tone', 1046, .3, 'triangle', .06, 2093, .05]],
      chain: [['tone', 1900, .18, 'sawtooth', .06, 180], ['noise', .14, .08, 7000]], plasmaRing: [['tone', 600, .24, 'sine', .1, 120], ['noise', .2, .1, 1600]]
    };
    function sound(lv, style) { return SOUNDS[kindOf(lv, style)] || SOUNDS.pellet; }
    function impactSound(lv, style) { return IMPACT_SOUNDS[KINDS[kindOf(lv, style)].impact] || IMPACT_SOUNDS.splash; }
    function info(lv, style) { const id = kindOf(lv, style); return { id, name: KINDS[id].name, color: KINDS[id].a, glow: KINDS[id].glow }; }
    function stats() { let p = 0, f = 0; for (const x of P) if (x.on) p++; for (const x of FX) if (x.on) f++; return { particles: p, effects: f, sprites: cache.size }; }
    return { kindOf, info, muzzle, impact, track, update, drawBullet, drawFx, sound, impactSound, stats };
  }
  const api = { create, KINDS, LEVEL_KIND, kindOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReefWeapons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
