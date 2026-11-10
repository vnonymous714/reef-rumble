/* Temple Relic bonus art — HD photoreal assets + canvas overlays. No emoji glyphs. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const ASSETS = {
    bg: 'assets/bonus-bg.webp',
    chestClosed: 'assets/bonus-chest-closed.webp',
    chestOpen: 'assets/bonus-chest-open.webp',
    pearl: 'assets/bonus-tap-pearl.webp',
    chestClosedSm: 'assets/bonus-chest-closed-sm.webp',
    chestOpenSm: 'assets/bonus-chest-open-sm.webp',
    pearlSm: 'assets/bonus-tap-pearl-sm.webp',
    rim: 'assets/bonus-wheel-rim.webp?v=tg28',
    face: 'assets/bonus-wheel-face.webp?v=tg28',
    pointer: 'assets/bonus-wheel-pointer.webp?v=tg28',
    hub: 'assets/bonus-wheel-hub.webp?v=tg28',
    plaque: 'assets/bonus-wheel-plaque.webp?v=tg28',
    rimSm: 'assets/bonus-wheel-rim-sm.webp?v=tg28',
    faceSm: 'assets/bonus-wheel-face-sm.webp?v=tg28',
    pointerSm: 'assets/bonus-wheel-pointer-sm.webp?v=tg28',
    hubSm: 'assets/bonus-wheel-hub-sm.webp?v=tg28',
    plaqueSm: 'assets/bonus-wheel-plaque-sm.webp?v=tg28',
    num1_0: 'assets/bonus-wheel-num-1.0.webp?v=tg28',
    num1_5: 'assets/bonus-wheel-num-1.5.webp?v=tg28',
    num2_0: 'assets/bonus-wheel-num-2.0.webp?v=tg28',
    num2_5: 'assets/bonus-wheel-num-2.5.webp?v=tg28',
    num3_0: 'assets/bonus-wheel-num-3.0.webp?v=tg28',
    num4_0: 'assets/bonus-wheel-num-4.0.webp?v=tg28',
    num5_0: 'assets/bonus-wheel-num-5.0.webp?v=tg28',
    num8_0: 'assets/bonus-wheel-num-8.0.webp?v=tg28',
    num10: 'assets/bonus-wheel-num-10.webp?v=tg28',
    num1: 'assets/bonus-wheel-num-1.webp?v=tg28',
    num2: 'assets/bonus-wheel-num-2.webp?v=tg28',
    num3: 'assets/bonus-wheel-num-3.webp?v=tg28',
    num4: 'assets/bonus-wheel-num-4.webp?v=tg28',
    num5: 'assets/bonus-wheel-num-5.webp?v=tg28',
    num8: 'assets/bonus-wheel-num-8.webp?v=tg28'
  };
  const imgs = {};
  let ready = false;
  let readyPromise = null;

  function loadOne(src) {
    return new Promise((resolve) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
      imgs[src] = im;
    });
  }

  function loadTempleFont() {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
      return Promise.resolve();
    }
    if (root.__cinzelReady) return Promise.resolve();
    try {
      const black = new FontFace('CinzelBlack', 'url(assets/fonts/Cinzel-Black.woff?v=tg28)', { weight: '900', style: 'normal' });
      const bold = new FontFace('CinzelBold', 'url(assets/fonts/Cinzel-Bold.woff?v=tg28)', { weight: '700', style: 'normal' });
      document.fonts.add(black);
      document.fonts.add(bold);
      return Promise.all([black.load(), bold.load()]).then(function () {
        root.__cinzelReady = true;
      }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function ensureLoaded() {
    if (ready) return Promise.resolve(imgs);
    if (readyPromise) return readyPromise;
    readyPromise = Promise.all(Object.values(ASSETS).map(loadOne).concat([loadTempleFont()])).then(() => {
      ready = true;
      return imgs;
    });
    return readyPromise;
  }

  function get(key) {
    return imgs[ASSETS[key]] || null;
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function paintBubbles(g, W, H, seed) {
    for (let i = 0; i < 28; i++) {
      const t = ((seed * 19 + i * 97) % 1000) / 1000;
      const x = ((seed * 31 + i * 53) % 1000) / 1000 * W;
      const y = H * (0.12 + t * 0.82);
      const r = 1.2 + (i % 5);
      g.fillStyle = 'rgba(190,240,255,' + (0.1 + (i % 3) * 0.05) + ')';
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
  }

  function paintGodRays(g, W, H) {
    g.save();
    for (let i = 0; i < 5; i++) {
      const a = -0.3 + i * 0.14;
      g.fillStyle = 'rgba(140,220,240,' + (0.03 + (i % 2) * 0.015) + ')';
      g.beginPath();
      g.moveTo(W * 0.5, -10);
      g.lineTo(W * 0.5 + Math.sin(a) * W * 0.55, H);
      g.lineTo(W * 0.5 + Math.sin(a + 0.07) * W * 0.55, H);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function drawCover(g, im, x, y, w, h) {
    if (!im || !im.width) return false;
    const s = Math.max(w / im.width, h / im.height);
    const dw = im.width * s, dh = im.height * s;
    g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function drawContain(g, im, cx, cy, maxW, maxH) {
    if (!im || !im.width) return false;
    const s = Math.min(maxW / im.width, maxH / im.height);
    const dw = im.width * s, dh = im.height * s;
    g.drawImage(im, cx - dw / 2, cy - dh / 2, dw, dh);
    return true;
  }

  function paintBgPlate(g, W, H) {
    const bg = get('bg');
    if (bg && bg.width) {
      drawCover(g, bg, 0, 0, W, H);
      g.fillStyle = 'rgba(2,10,20,.28)';
      g.fillRect(0, 0, W, H);
    } else {
      const deep = g.createLinearGradient(0, 0, 0, H);
      deep.addColorStop(0, '#0a3a4c');
      deep.addColorStop(1, '#041018');
      g.fillStyle = deep;
      g.fillRect(0, 0, W, H);
    }
    paintGodRays(g, W, H);
    paintBubbles(g, W, H, 5);
  }

  function paintCoinBurst(g, x, y, n, seed) {
    for (let i = 0; i < n; i++) {
      const a = -1.1 + i * 0.22 + (seed % 7) * 0.01;
      const dist = 18 + (i % 5) * 10;
      const cx = x + Math.sin(a) * dist;
      const cy = y - Math.cos(a) * dist * 0.7 - 8;
      const r = 4 + (i % 3);
      const cg = g.createRadialGradient(cx - 1, cy - 1, 1, cx, cy, r);
      cg.addColorStop(0, '#fff8c8');
      cg.addColorStop(0.55, '#ffcf4a');
      cg.addColorStop(1, '#8a5500');
      g.fillStyle = cg;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    }
  }

  /** HD chest (closed or open). Origin at visual center. Fits within budgeted scale. */
  function paintChest(g, opts) {
    opts = opts || {};
    const open = !!opts.open;
    const mult = opts.mult;
    const scale = opts.scale || 1;
    const dim = !!opts.dim;
    const im = open ? get('chestOpen') || get('chestOpenSm') : get('chestClosed') || get('chestClosedSm');
    g.save();
    // Solid dark plate + ring always fully opaque so pillars never show through
    g.fillStyle = 'rgba(4,12,22,1)';
    g.beginPath();
    g.ellipse(0, 6 * scale, 82 * scale, 72 * scale, 0, 0, TAU);
    g.fill();
    // Soft drop shadow under
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath();
    g.ellipse(0, 48 * scale, 80 * scale, 18 * scale, 0, 0, TAU);
    g.fill();

    // Gold glow ring behind chest
    const ring = g.createRadialGradient(0, -4 * scale, 10 * scale, 0, 0, 110 * scale);
    ring.addColorStop(0, open && !dim ? 'rgba(255,230,120,.85)' : 'rgba(255,215,90,.7)');
    ring.addColorStop(0.35, 'rgba(255,190,70,.4)');
    ring.addColorStop(0.7, 'rgba(220,170,50,.18)');
    ring.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = ring;
    g.beginPath();
    g.arc(0, 0, 100 * scale, 0, TAU);
    g.fill();
    g.strokeStyle = dim ? 'rgba(255,210,120,.7)' : 'rgba(255,230,140,.95)';
    g.lineWidth = 5 * scale;
    g.beginPath();
    g.arc(0, 0, 78 * scale, 0, TAU);
    g.stroke();

    // Large HD chest — ~60-70% panel height
    const maxW = 180 * scale, maxH = 165 * scale;
    if (dim) g.globalAlpha = 0.78;
    if (!drawContain(g, im, 0, -6 * scale, maxW, maxH)) {
      g.fillStyle = '#8a5520';
      rr(g, -55 * scale, -40 * scale, 110 * scale, 80 * scale, 10 * scale);
      g.fill();
    }
    g.globalAlpha = 1;

    if (open && !dim) {
      paintCoinBurst(g, 0, -8 * scale, 10, 3);
      const inn = g.createRadialGradient(0, -4 * scale, 2, 0, -4 * scale, 45 * scale);
      inn.addColorStop(0, 'rgba(255,230,120,.4)');
      inn.addColorStop(1, 'rgba(255,180,40,0)');
      g.fillStyle = inn;
      g.beginPath();
      g.ellipse(0, -2 * scale, 40 * scale, 20 * scale, 0, 0, TAU);
      g.fill();
    }

    if (mult != null) {
      const label = mult + '\u00d7';
      const ly = 92 * scale;
      const bw = 72 * scale, bh = 32 * scale;
      rr(g, -bw / 2, ly - bh / 2, bw, bh, 12 * scale);
      const bgd = g.createLinearGradient(0, ly - bh / 2, 0, ly + bh / 2);
      bgd.addColorStop(0, dim ? '#d4bc78' : '#fff0b0');
      bgd.addColorStop(0.55, dim ? '#c09840' : '#f0b532');
      bgd.addColorStop(1, dim ? '#8a6820' : '#b9770e');
      g.fillStyle = bgd;
      g.fill();
      g.strokeStyle = '#7a4a0c';
      g.lineWidth = 2.5 * scale;
      g.stroke();
      g.font = '900 ' + Math.round(20 * scale) + 'px system-ui,sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#3a2000';
      g.fillText(label, 0, ly + 1 * scale);
    } else if (!open) {
      // Large ? badge under closed chest
      const ly = 92 * scale;
      const bw = 56 * scale, bh = 40 * scale;
      rr(g, -bw / 2, ly - bh / 2, bw, bh, 12 * scale);
      g.fillStyle = 'rgba(8,20,30,.72)';
      g.fill();
      g.strokeStyle = '#c5a45d';
      g.lineWidth = 2.5 * scale;
      g.stroke();
      g.font = '900 ' + Math.round(30 * scale) + 'px system-ui,sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff6d0';
      g.fillText('?', 0, ly + 1 * scale);
    }
    g.restore();
  }

  function paintPearlClam(g, opts) {
    opts = opts || {};
    const s = opts.scale || 1;
    const pulse = opts.pulse || 0;
    const im = get('pearl') || get('pearlSm');
    g.save();
    const aura = g.createRadialGradient(0, 0, 10 * s, 0, 0, (110 + pulse * 18) * s);
    aura.addColorStop(0, 'rgba(255,240,180,' + (0.28 + pulse * 0.2) + ')');
    aura.addColorStop(0.45, 'rgba(80,220,240,.16)');
    aura.addColorStop(1, 'rgba(80,220,240,0)');
    g.fillStyle = aura;
    g.beginPath();
    g.arc(0, 0, (100 + pulse * 12) * s, 0, TAU);
    g.fill();

    // ripple rings on tap
    if (pulse > 0.05) {
      g.strokeStyle = 'rgba(180,240,255,' + (0.35 * pulse) + ')';
      g.lineWidth = 3 * s;
      g.beginPath();
      g.arc(0, 8 * s, (70 + pulse * 40) * s, 0, TAU);
      g.stroke();
      g.beginPath();
      g.arc(0, 8 * s, (95 + pulse * 55) * s, 0, TAU);
      g.stroke();
    }

    const max = (200 + pulse * 8) * s;
    if (!drawContain(g, im, 0, 0, max, max)) {
      g.fillStyle = '#fff0c8';
      g.beginPath();
      g.arc(0, 0, 36 * s, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function paintMiniWheelIcon(g, s) {
    g.save();
    g.scale(s, s);
    // Compact temple wheel icon (full painter needs R>~80)
    const R = 52;
    const water = g.createRadialGradient(0, 0, 8, 0, 0, R);
    water.addColorStop(0, '#1a6a82');
    water.addColorStop(1, '#041420');
    g.fillStyle = water;
    g.beginPath();
    g.arc(0, 0, R - 6, 0, TAU);
    g.fill();
    for (let i = 0; i < 8; i++) {
      const a0 = -Math.PI / 2 + (i * TAU) / 8;
      g.fillStyle = i % 2 ? '#2a5a68' : '#4a3a28';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R - 14, a0, a0 + TAU / 8);
      g.closePath();
      g.fill();
    }
    const rim = g.createLinearGradient(-R, -R, R, R);
    rim.addColorStop(0, '#fff2b0');
    rim.addColorStop(0.5, '#c89628');
    rim.addColorStop(1, '#5a3a0a');
    g.lineWidth = 12;
    g.strokeStyle = rim;
    g.beginPath();
    g.arc(0, 0, R - 8, 0, TAU);
    g.stroke();
    const gems = ['#ff3c5a', '#468cff', '#3ce678', '#be5aff'];
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i - 0.5) * (TAU / 8);
      const x = Math.cos(a) * (R - 8);
      const y = Math.sin(a) * (R - 8);
      const gg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 5);
      gg.addColorStop(0, '#fff');
      gg.addColorStop(0.4, gems[i % 4]);
      gg.addColorStop(1, '#1a0820');
      g.fillStyle = gg;
      g.beginPath();
      g.arc(x, y, 5, 0, TAU);
      g.fill();
    }
    const hub = g.createRadialGradient(-4, -4, 1, 0, 0, 12);
    hub.addColorStop(0, '#fff4c0');
    hub.addColorStop(0.5, '#e3a82e');
    hub.addColorStop(1, '#3a2208');
    g.fillStyle = hub;
    g.beginPath();
    g.arc(0, 0, 12, 0, TAU);
    g.fill();
    g.fillStyle = '#ff3c5a';
    g.beginPath();
    g.arc(0, 0, 5, 0, TAU);
    g.fill();
    g.restore();
  }

  function paintChoiceCard(g, W, H, kind, title, blurb, press) {
    rr(g, 0, 0, W, H, 16);
    g.save();
    g.clip();
    // card backdrop from bonus-bg
    const bg = get('bg');
    if (bg && bg.width) {
      drawCover(g, bg, 0, 0, W, H);
      g.fillStyle = press ? 'rgba(10,30,44,.45)' : 'rgba(4,18,28,.55)';
      g.fillRect(0, 0, W, H);
    } else {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, press ? 'rgba(60,120,140,.98)' : 'rgba(40,90,110,.95)');
      grd.addColorStop(1, 'rgba(8,28,40,.98)');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }
    paintBubbles(g, W, H, kind === 'wheel' ? 3 : kind === 'chest' ? 7 : 11);
    g.restore();

    rr(g, 0, 0, W, H, 16);
    g.lineWidth = 2.5;
    g.strokeStyle = press ? '#ffe28a' : 'rgba(197,164,93,.9)';
    g.stroke();
    if (press) {
      g.shadowColor = 'rgba(255,200,80,.55)';
      g.shadowBlur = 18;
      g.stroke();
      g.shadowBlur = 0;
    }

    g.save();
    g.translate(W / 2, H * 0.40);
    if (kind === 'wheel') paintMiniWheelIcon(g, 1.05);
    else if (kind === 'chest') {
      const im = get('chestClosedSm') || get('chestClosed');
      drawContain(g, im, 0, 0, W * 0.62, H * 0.48);
    } else {
      const im = get('pearlSm') || get('pearl');
      drawContain(g, im, 0, 0, W * 0.62, H * 0.48);
    }
    g.restore();

    g.textAlign = 'center';
    g.font = '900 ' + Math.max(14, Math.round(H * 0.07)) + 'px system-ui,sans-serif';
    g.fillStyle = '#ffe28a';
    g.shadowColor = 'rgba(0,0,0,.55)';
    g.shadowBlur = 4;
    g.fillText(title, W / 2, H * 0.74);
    g.shadowBlur = 0;
    g.font = '600 ' + Math.max(10, Math.round(H * 0.045)) + 'px system-ui,sans-serif';
    g.fillStyle = 'rgba(220,240,255,.9)';
    g.fillText(blurb, W / 2, H * 0.84);
  }

  function paintTapScene(g, W, H, state) {
    state = state || {};
    paintBgPlate(g, W, H);

    // Generous insets — timer stroke and pearl shell must clear the gold frame
    const pad = Math.max(18, Math.min(W, H) * 0.045);
    const heatH = 30;
    const usableH = H - pad * 2 - heatH;
    const usableW = W - pad * 2;

    // heat bar across top of play area
    const hx = pad, hy = pad, hw = W - pad * 2, hh = 16;
    rr(g, hx, hy, hw, hh, 8);
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.fill();
    const heat = Math.max(0, Math.min(1, state.heat != null ? state.heat : 0.55));
    if (heat > 0.01) {
      rr(g, hx, hy, Math.max(8, hw * heat), hh, 8);
      const hg = g.createLinearGradient(hx, hy, hx + hw, hy);
      hg.addColorStop(0, '#d44a3a');
      hg.addColorStop(0.45, '#ff9a3a');
      hg.addColorStop(1, '#ffe28a');
      g.fillStyle = hg;
      g.fill();
    }
    g.strokeStyle = 'rgba(197,164,93,.75)';
    g.lineWidth = 1.5;
    rr(g, hx, hy, hw, hh, 8);
    g.stroke();
    g.fillStyle = '#ffe9a0';
    g.font = '800 11px system-ui';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText('MULT HEAT', hx, hy - 4);
    g.textAlign = 'right';
    g.fillText(state.multLabel || '3.10\u00d7', hx + hw, hy - 4);

    // circular timer — fully inside left margin (radius + stroke + pad)
    const stroke = 8;
    const R = Math.min(usableH * 0.26, usableW * 0.11, 46);
    const cx = pad + stroke + R + 14;
    const cy = pad + heatH + usableH * 0.58;
    const tf = Math.max(0, Math.min(1, state.timeFrac != null ? state.timeFrac : 0.71));
    g.lineWidth = stroke;
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    g.strokeStyle = '#ffe28a';
    g.lineCap = 'round';
    g.beginPath();
    g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + TAU * tf);
    g.stroke();
    g.fillStyle = '#fff6d0';
    g.font = '900 ' + Math.max(16, Math.round(R * 0.42)) + 'px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(state.timeLeft != null ? state.timeLeft : '14.2'), cx, cy - 3);
    g.font = '800 9px system-ui';
    g.fillStyle = 'rgba(200,230,240,.85)';
    g.fillText('SEC', cx, cy + 14);

    // pearl — scale so aura fits remaining box with margin
    const pulse = state.pulse || 0.25;
    // Clam ~65% of panel height, centered in remaining play area (right of timer)
    const pearlCx = pad + usableW * 0.55;
    const pearlCy = pad + heatH + usableH * 0.52;
    const pearlTargetH = Math.min(usableH * 0.82, H * 0.68);
    // paintPearlClam draws image at max≈200*s — scale so shell ≈ pearlTargetH (~65% panel)
    const pearlScale = pearlTargetH / 200;
    g.save();
    g.translate(pearlCx, pearlCy);
    // Opaque pop: dark vignette + gold ring behind clam
    g.fillStyle = 'rgba(2,10,18,0.85)';
    g.beginPath();
    g.ellipse(0, pearlTargetH * 0.06, pearlTargetH * 0.5, pearlTargetH * 0.48, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.beginPath();
    g.ellipse(0, pearlTargetH * 0.32, pearlTargetH * 0.44, pearlTargetH * 0.14, 0, 0, TAU);
    g.fill();
    const pr = g.createRadialGradient(0, 0, 10, 0, 0, pearlTargetH * 0.58);
    pr.addColorStop(0, 'rgba(255,230,140,.55)');
    pr.addColorStop(0.55, 'rgba(255,200,80,.2)');
    pr.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = pr;
    g.beginPath();
    g.arc(0, 0, pearlTargetH * 0.55, 0, TAU);
    g.fill();
    paintPearlClam(g, { scale: pearlScale, pulse: pulse });
    g.restore();

    if (state.bursts) {
      for (const b of state.bursts) {
        paintCoinBurst(g, b.x, b.y, 5, (b.t || 0) % 11);
        g.strokeStyle = 'rgba(180,240,255,.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(b.x, b.y, 14, 0, TAU);
        g.stroke();
      }
    }
  }

  function paintChestPanel(g, W, H, chests) {
    paintBgPlate(g, W, H);
    // Darken mid plate so opaque chests read against pillars
    const veil = g.createRadialGradient(W / 2, H * 0.5, 20, W / 2, H * 0.5, Math.max(W, H) * 0.55);
    veil.addColorStop(0, 'rgba(2,10,20,.15)');
    veil.addColorStop(1, 'rgba(2,10,20,.55)');
    g.fillStyle = veil;
    g.fillRect(0, 0, W, H);

    const n = chests.length;
    const padY = Math.max(16, Math.round(H * 0.06)); // keep ~10–18px clear of frame
    const padX = Math.max(8, W * 0.02);
    const slot = (W - padX * 2) / n;
    // Content units at scale 1: image ~156 tall + badge under ~96 → ~252
    // Target ~65% of H for chest art alone → scale ≈ (0.65*H)/150
    const scaleByH = (H - padY * 2) / 205;
    const scaleByW = (slot * 0.94) / 180;
    const scale = Math.max(0.95, Math.min(scaleByH, scaleByW, 1.55));
    for (let i = 0; i < n; i++) {
      const c = chests[i];
      g.save();
      g.translate(padX + slot * (i + 0.5), H * 0.48);
      paintChest(g, {
        scale: scale,
        open: !!c.open,
        mult: c.mult,
        dim: !!c.dim
      });
      g.restore();
    }
  }


  // Face+rim are split from one 2048px render, so both layers draw at R*2.
  // FACE_FRAC is the measured inner lip (gem face / outer radius).
  const FACE_FRAC = 0.760;
  const HUB_FRAC = 0.135;
  const FONT_GOLD = '900 16px CinzelBlack, "Cinzel Black", Cinzel, serif';
  const NUM_BULBS = 24;

  function currentDpr() {
    if (typeof window !== 'undefined' && window.devicePixelRatio) {
      return Math.min(2, window.devicePixelRatio);
    }
    return 1;
  }

  function pickLayer(base, destCss) {
    const full = get(base);
    const sm = get(base + 'Sm');
    const cands = [];
    if (sm && sm.width) cands.push(sm);
    if (full && full.width) cands.push(full);
    if (!cands.length) return null;
    const need = Math.max(1, (destCss || 256) * currentDpr() * 1.1);
    const fit = cands.filter((im) => Math.max(im.width, im.height) >= need);
    const pool = fit.length ? fit : cands;
    pool.sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height));
    return fit.length ? pool[0] : pool[pool.length - 1];
  }

  function fmtFaceLabel(m) {
    const n = Number(m);
    if (!Number.isFinite(n)) return '1\u00d7';
    // Integers drop the .0 so 4x / 3x / 10x stay compact inside the wedge
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) + '\u00d7';
    return (Math.round(n * 10) / 10).toFixed(1) + '\u00d7';
  }

  function numKeyFor(mult, fmt) {
    const t = (fmt || fmtFaceLabel)(mult);
    const core = String(t).replace(/\u00d7/g, '').replace(/[xX]$/, '');
    if (core.indexOf('.') === -1) return 'num' + core;
    return 'num' + core.replace('.', '_');
  }

  function getNum(mult, fmt) {
    const k = numKeyFor(mult, fmt || fmtFaceLabel);
    let im = get(k);
    if (im && im.width) return im;
    if (k.indexOf('_') < 0 && k !== 'num10') {
      im = get(k + '_0');
      if (im && im.width) return im;
    }
    return null;
  }

  function sectorCentroidFrac(n) {
    const a = Math.PI / Math.max(1, n);
    const c = (2 / 3) * (Math.sin(a) / a);
    return Math.max(0.62, Math.min(0.68, c));
  }

  function uprightBoxPoints(cx, cy, dw, dh, rot) {
    const hx = dw / 2, hy = dh / 2;
    const locals = [
      [-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy],
      [0, -hy], [0, hy], [-hx, 0], [hx, 0]
    ];
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [];
    for (let i = 0; i < locals.length; i++) {
      const x = locals[i][0], y = locals[i][1];
      pts.push({ x: cx + c * x - s * y, y: cy + s * x + c * y });
    }
    return pts;
  }

  function angleInWedge(ang, a0, a1) {
    let span = a1 - a0;
    while (span < 0) span += TAU;
    while (span >= TAU) span -= TAU;
    let d = ang - a0;
    while (d < 0) d += TAU;
    while (d >= TAU) d -= TAU;
    return d <= span + 1e-9;
  }

  function pointsInsideWedge(pts, a0, a1, rIn, rOut, padRay) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const r = Math.hypot(p.x, p.y);
      if (r < rIn || r > rOut) return false;
      const ang = Math.atan2(p.y, p.x);
      if (!angleInWedge(ang, a0, a1)) return false;
      const d0 = Math.abs(p.x * Math.sin(a0) - p.y * Math.cos(a0));
      const d1 = Math.abs(p.x * Math.sin(a1) - p.y * Math.cos(a1));
      if (d0 < padRay || d1 < padRay) return false;
    }
    return true;
  }

  function layoutWheelNumerals(opts) {
    opts = opts || {};
    const faceR = opts.faceR;
    const hubR = opts.hubR || faceR * 0.18;
    const n = opts.n || 9;
    const sectors = opts.sectors || [];
    const fmt = opts.fmt || fmtFaceLabel;
    const getSize = opts.getSize;
    const a = Math.PI / n;
    const frac = sectorCentroidFrac(n);
    const labelR = faceR * frac;
    const padRay = Math.max(3.5, faceR * 0.042);
    const rIn = hubR + Math.max(2, faceR * 0.03);
    const rOut = faceR - Math.max(2.5, faceR * 0.038);
    const rots = [];
    for (let d = 0; d < 360; d += 10) rots.push(d * Math.PI / 180);
    const out = [];
    for (let i = 0; i < n; i++) {
      const mid = -Math.PI / 2 + i * (TAU / n);
      const a0 = mid - a;
      const a1 = mid + a;
      const x = Math.cos(mid) * labelR;
      const y = Math.sin(mid) * labelR;
      const mult = sectors[i] ? sectors[i][0] : i;
      const text = fmt(mult);
      const sz = getSize ? getSize(mult, text) : { w: 50, h: 28, im: null };
      const natW = Math.max(1, sz.w);
      const natH = Math.max(1, sz.h);
      const wishH = faceR * 0.30;
      const wishW = 2 * labelR * Math.sin(a) * 0.84;
      let scale = Math.min(wishW / natW, wishH / natH);
      const fits = function (s) {
        const dw = natW * s, dh = natH * s;
        for (let r = 0; r < rots.length; r++) {
          const pts = uprightBoxPoints(x, y, dw, dh, rots[r]);
          if (!pointsInsideWedge(pts, a0, a1, rIn, rOut, padRay)) return false;
        }
        return true;
      };
      if (!fits(scale)) {
        let lo = 0, hi = scale;
        for (let k = 0; k < 14; k++) {
          const midS = (lo + hi) / 2;
          if (fits(midS)) lo = midS;
          else hi = midS;
        }
        scale = lo;
      }
      out.push({
        i: i,
        x: x,
        y: y,
        dw: natW * scale,
        dh: natH * scale,
        text: text,
        im: sz.im || null,
        labelR: labelR,
        frac: frac,
        a0: a0,
        a1: a1,
        padRay: padRay,
        rIn: rIn,
        rOut: rOut,
        mult: mult
      });
    }
    return out;
  }

  function numeralsClearDividers(layout, rotationDeg) {
    const rot = (rotationDeg || 0) * Math.PI / 180;
    const failures = [];
    for (let i = 0; i < layout.length; i++) {
      const lab = layout[i];
      const pts = uprightBoxPoints(lab.x, lab.y, lab.dw, lab.dh, rot);
      if (!pointsInsideWedge(pts, lab.a0, lab.a1, lab.rIn, lab.rOut, lab.padRay)) {
        failures.push({ i: lab.i, text: lab.text, rotation: rotationDeg });
      }
    }
    return failures;
  }

  function layoutStakeWheel(W, H) {
    const pad = Math.max(8, Math.round(Math.min(W, H) * 0.02));
    const btnH = Math.max(28, Math.min(34, Math.round(H * 0.085)));
    const btnW = Math.min(190, Math.max(132, W * 0.2));
    const btnGap = Math.max(10, Math.round(H * 0.028));
    const titleY = pad + Math.max(13, Math.round(H * 0.042));
    const btnX = (W - btnW) / 2;
    const btnY = H - pad - btnH;
    const pointerAbove = Math.max(16, Math.round(H * 0.05));
    const top = titleY + 2;
    const bot = btnY - btnGap;
    let R = Math.min((W * 0.80) / 2, (bot - top - pointerAbove) / 2);
    R = Math.max(64, R);
    const cx = W / 2;
    let cy = top + pointerAbove + R;
    if (cy + R > bot) {
      R = Math.max(64, (bot - top - pointerAbove) / 2);
      cy = top + pointerAbove + R;
    }
    const faceR = R * FACE_FRAC;
    const hubR = R * HUB_FRAC;
    return {
      pad: pad,
      btnH: btnH,
      btnW: btnW,
      btnX: btnX,
      btnY: btnY,
      titleY: titleY,
      stakeY: titleY,
      cx: cx,
      cy: cy,
      R: R,
      faceR: faceR,
      hubR: hubR,
      pointerH: R * 0.40,
      tipY: cy - faceR + Math.max(3, R * 0.018),
      W: W,
      H: H
    };
  }

  function drawLayer(g, im, cx, cy, diameter) {
    if (!im || !im.width) return false;
    const s = diameter / Math.max(im.width, im.height);
    const dw = im.width * s;
    const dh = im.height * s;
    g.drawImage(im, cx - dw / 2, cy - dh / 2, dw, dh);
    return true;
  }

  function paintGoldType(g, text, x, y, px, opts) {
    opts = opts || {};
    const family = opts.bold ? 'CinzelBold, "Cinzel Bold", CinzelBlack, Cinzel, serif' : 'CinzelBlack, "Cinzel Black", Cinzel, serif';
    g.save();
    g.font = '900 ' + Math.round(px) + 'px ' + family;
    g.textAlign = opts.align || 'center';
    g.textBaseline = opts.baseline || 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    const lw = Math.max(3, px * (opts.stroke || 0.2));
    g.shadowColor = 'rgba(0,0,0,.65)';
    g.shadowBlur = px * 0.25;
    g.shadowOffsetX = Math.max(1, px * 0.04);
    g.shadowOffsetY = Math.max(1, px * 0.07);
    g.lineWidth = lw;
    g.strokeStyle = 'rgba(18,6,0,.95)';
    g.strokeText(text, x, y);
    g.shadowBlur = 0;
    g.shadowOffsetX = 0;
    g.shadowOffsetY = 0;
    // Top-left key light, matching the chests and the inlaid numerals
    const h = px * 0.75;
    const grd = g.createLinearGradient(x - h, y - h, x + h, y + h);
    grd.addColorStop(0, '#fff8d0');
    grd.addColorStop(0.28, '#ffe28a');
    grd.addColorStop(0.55, '#e0a020');
    grd.addColorStop(0.8, '#a86a10');
    grd.addColorStop(1, '#5a3408');
    g.fillStyle = grd;
    g.fillText(text, x, y);
    g.globalAlpha = 0.5;
    g.fillStyle = 'rgba(255,250,230,.85)';
    g.fillText(text, x - Math.max(0.5, px * 0.03), y - Math.max(0.6, px * 0.035));
    g.globalAlpha = 1;
    if (opts.glow) {
      g.shadowColor = 'rgba(255,210,90,.6)';
      g.shadowBlur = px * 0.4;
      g.fillStyle = grd;
      g.fillText(text, x, y);
    }
    g.restore();
  }

  function paintInlaidNum(g, im, text, x, y, maxW, maxH, glow, pxFallback) {
    if (im && im.width) {
      const s = Math.min(maxW / im.width, maxH / im.height);
      const dw = im.width * s;
      const dh = im.height * s;
      if (glow) {
        g.save();
        g.shadowColor = 'rgba(255,210,90,.7)';
        g.shadowBlur = Math.max(6, dh * 0.28);
        g.drawImage(im, x - dw / 2, y - dh / 2, dw, dh);
        g.restore();
      } else {
        g.drawImage(im, x - dw / 2, y - dh / 2, dw, dh);
      }
      return;
    }
    paintGoldType(g, text, x, y, pxFallback, { glow: glow, stroke: 0.22 });
  }

  function paintWinShimmer(g, faceR, n, winIndex, reveal, shimmer) {
    if (winIndex == null || reveal <= 0) return;
    const a0 = -Math.PI / 2 + (winIndex - 0.5) * (TAU / n);
    const a1 = a0 + TAU / n;
    g.save();
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, faceR, a0, a1);
    g.closePath();
    g.clip();
    const mid = (a0 + a1) / 2;
    const wx = Math.cos(mid) * faceR * 0.45;
    const wy = Math.sin(mid) * faceR * 0.45;
    const wash = g.createRadialGradient(wx, wy, 4, 0, 0, faceR);
    wash.addColorStop(0, 'rgba(255,240,170,' + (0.42 * reveal) + ')');
    wash.addColorStop(0.55, 'rgba(255,210,90,' + (0.16 * reveal) + ')');
    wash.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = wash;
    g.fill();
    const t = shimmer == null ? 0.45 : shimmer;
    const band = faceR * 2.2;
    const x0 = -faceR + (t - 0.15) * band;
    const grd = g.createLinearGradient(x0, -faceR, x0 + faceR * 0.55, faceR * 0.2);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.45, 'rgba(255,250,220,' + (0.55 * reveal) + ')');
    grd.addColorStop(0.55, 'rgba(255,230,140,' + (0.28 * reveal) + ')');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(-faceR, -faceR, faceR * 2, faceR * 2);
    g.restore();
  }

  function paintFaceLight(g, faceR) {
    // World-space key from upper-left so baked face lighting stays consistent as it spins
    g.save();
    g.beginPath();
    g.arc(0, 0, Math.max(2, faceR - 1), 0, TAU);
    g.clip();
    const dim = g.createRadialGradient(-faceR * 0.38, -faceR * 0.48, faceR * 0.08, faceR * 0.2, faceR * 0.35, faceR * 1.15);
    dim.addColorStop(0, 'rgba(255,236,200,0.14)');
    dim.addColorStop(0.45, 'rgba(255,220,170,0.03)');
    dim.addColorStop(1, 'rgba(4,10,28,0.20)');
    g.fillStyle = dim;
    g.fillRect(-faceR, -faceR, faceR * 2, faceR * 2);
    g.globalCompositeOperation = 'lighter';
    const spec = g.createRadialGradient(-faceR * 0.30, -faceR * 0.40, 0, -faceR * 0.30, -faceR * 0.40, faceR * 0.62);
    spec.addColorStop(0, 'rgba(255,250,230,0.20)');
    spec.addColorStop(0.45, 'rgba(255,220,150,0.07)');
    spec.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = spec;
    g.fillRect(-faceR, -faceR, faceR * 2, faceR * 2);
    g.restore();
  }

  function paintInnerBevel(g, faceR) {
    g.save();
    g.strokeStyle = 'rgba(0,0,0,0.42)';
    g.lineWidth = Math.max(2, faceR * 0.018);
    g.beginPath();
    g.arc(0, 0, faceR - 0.5, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = Math.max(1.5, faceR * 0.012);
    g.beginPath();
    g.arc(0, 0, faceR - 2.2, 0, TAU);
    g.stroke();
    // Highlight on the lit inner lip (upper-left)
    g.strokeStyle = 'rgba(255,232,170,0.32)';
    g.lineWidth = Math.max(1.2, faceR * 0.01);
    g.beginPath();
    g.arc(0, 0, faceR + 0.8, -Math.PI * 0.95, -Math.PI * 0.15);
    g.stroke();
    g.restore();
  }

  function paintRimLights(g, R, faceR, phase, spinning, reveal, reduced) {
    const midR = (R + faceR) * 0.5 + (R - faceR) * 0.05;
    const rad = Math.max(2.1, (R - faceR) * 0.15);
    const t = (phase || 0) / 1000;
    const speed = spinning ? 3.4 : (reveal > 0 ? 1.6 : 0.75);
    const head = ((t * speed) % 1 + 1) % 1;
    for (let i = 0; i < NUM_BULBS; i++) {
      const a = -Math.PI / 2 + i * (TAU / NUM_BULBS);
      const u = i / NUM_BULBS;
      let d = Math.abs(u - head);
      if (d > 0.5) d = 1 - d;
      let on = Math.max(0, 1 - d * 7.5);
      if (reveal > 0) {
        on = Math.max(on, 0.32 + 0.55 * Math.pow(Math.sin(t * 7 + i * 0.7), 2));
      } else {
        on = Math.max(0.14, on);
      }
      if (reduced) on = reveal > 0 ? 0.72 : 0.30;
      const x = Math.cos(a) * midR;
      const y = Math.sin(a) * midR;
      const glow = g.createRadialGradient(x, y, 0, x, y, rad * 2.5);
      glow.addColorStop(0, 'rgba(255,240,180,' + (0.95 * on) + ')');
      glow.addColorStop(0.4, 'rgba(255,200,80,' + (0.50 * on) + ')');
      glow.addColorStop(1, 'rgba(255,180,40,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, y, rad * 2.5, 0, TAU);
      g.fill();
      const bulb = g.createRadialGradient(x - rad * 0.28, y - rad * 0.32, rad * 0.08, x, y, rad);
      bulb.addColorStop(0, 'rgba(255,255,240,' + (0.96 * on) + ')');
      bulb.addColorStop(0.45, 'rgba(255,210,90,' + (0.88 * on) + ')');
      bulb.addColorStop(1, 'rgba(120,70,16,' + (0.55 * on) + ')');
      g.fillStyle = bulb;
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
    }
  }

  function paintGlints(g, R, phase, reveal) {
    const sparks = [
      [-0.62, -0.70, 1.00],
      [-0.28, -0.86, 0.70],
      [0.58, -0.68, 0.42],
      [-0.80, -0.22, 0.38]
    ];
    const twinkle = 0.72 + 0.28 * Math.sin((phase || 0) / 260);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      const x = s[0] * R;
      const y = s[1] * R;
      const k = s[2] * twinkle * (reveal > 0 ? 1.15 : 1);
      const rad = Math.max(2.5, R * 0.034 * s[2]);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad * 2.2);
      grd.addColorStop(0, 'rgba(255,252,230,' + (0.85 * k) + ')');
      grd.addColorStop(0.35, 'rgba(255,220,140,' + (0.28 * k) + ')');
      grd.addColorStop(1, 'rgba(255,200,100,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad * 2.2, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function paintDropShadow(g, R) {
    // Light is top-left, so the contact shadow falls down-right
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.beginPath();
    g.ellipse(16, 22, R * 1.04, R * 0.96, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.40)';
    g.beginPath();
    g.ellipse(7, 11, R * 0.99, R * 0.95, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.ellipse(2, 4, R * 0.995, R * 0.985, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  function paintStakePointer(g, cx, tipY, pointerH) {
    // Soft shadow under the pointer so it sits on the wheel, not in mid-air
    g.save();
    const sh = g.createRadialGradient(cx, tipY + 8, 1, cx, tipY + 14, Math.max(16, pointerH * 0.22));
    sh.addColorStop(0, 'rgba(0,0,0,0.50)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.beginPath();
    g.ellipse(cx, tipY + 10, Math.max(7, pointerH * 0.08), Math.max(14, pointerH * 0.16), 0, 0, TAU);
    g.fill();
    g.restore();

    const im = pickLayer('pointer', pointerH) || get('pointer') || get('pointerSm');
    if (im && im.width) {
      const s = pointerH / im.height;
      const dw = im.width * s;
      const dh = im.height * s;
      g.drawImage(im, cx - dw / 2, tipY - dh, dw, dh);
      return;
    }
    g.save();
    g.translate(cx, tipY);
    g.fillStyle = '#e0a020';
    g.beginPath();
    g.moveTo(0, 6);
    g.lineTo(-10, -22);
    g.lineTo(10, -22);
    g.closePath();
    g.fill();
    g.restore();
  }

  function paintStakeWheel(g, opts) {
    opts = opts || {};
    const R = opts.R || 160;
    const faceR = opts.faceR || R * FACE_FRAC;
    const hubR = opts.hubR || R * HUB_FRAC;
    const sectors = opts.sectors || (root.ReefBonusChoice && root.ReefBonusChoice.CHOICE_WHEEL) || [];
    const n = sectors.length || 9;
    const rot = (opts.rotation || 0) * Math.PI / 180;
    const winIndex = opts.winIndex;
    const reveal = opts.reveal || 0;
    const fmt = opts.fmtMult || (root.ReefBonusChoice && root.ReefBonusChoice.fmtWheelMult) || function (m) {
      return (Math.round(m * 10) / 10).toFixed(1) + '\u00d7';
    };
    const phase = opts.lightPhase != null ? opts.lightPhase : 0;
    const spinning = !!opts.spinning;
    const reduced = !!opts.reducedMotion;

    paintDropShadow(g, R);

    // Rotating gem face (same 2048 master as the rim, drawn at the same scale)
    g.save();
    g.rotate(rot);
    const faceIm = pickLayer('face', R * 2);
    if (!drawLayer(g, faceIm, 0, 0, R * 2)) {
      g.fillStyle = '#0a3040';
      g.beginPath();
      g.arc(0, 0, faceR, 0, TAU);
      g.fill();
    }
    g.restore();

    paintFaceLight(g, faceR);

    g.save();
    g.rotate(rot);
    paintWinShimmer(g, faceR, n, winIndex, reveal, opts.shimmer);
    const labels = layoutWheelNumerals({
      faceR: faceR,
      hubR: hubR,
      n: n,
      sectors: sectors,
      fmt: fmtFaceLabel,
      getSize: function (mult) {
        const im = getNum(mult, fmtFaceLabel);
        if (im && im.width) return { w: im.width, h: im.height, im: im };
        return { w: 44, h: 24, im: null };
      }
    });
    const basePx = Math.max(11, faceR * 0.22);
    for (let i = 0; i < labels.length; i++) {
      const lab = labels[i];
      const isWin = winIndex === lab.i && reveal > 0;
      g.save();
      g.translate(lab.x, lab.y);
      g.rotate(-rot);
      paintInlaidNum(g, lab.im, lab.text, 0, 0, lab.dw, lab.dh, isWin, basePx);
      g.restore();
    }
    g.restore();

    const rimIm = pickLayer('rim', R * 2);
    if (!drawLayer(g, rimIm, 0, 0, R * 2)) {
      g.strokeStyle = '#c89628';
      g.lineWidth = R * 0.14;
      g.beginPath();
      g.arc(0, 0, R * 0.78, 0, TAU);
      g.stroke();
    }

    paintInnerBevel(g, faceR);
    paintRimLights(g, R, faceR, phase, spinning, reveal, reduced);
    paintGlints(g, R, phase, reveal);

    const hubIm = pickLayer('hub', hubR * 2) || get('hub') || get('hubSm');
    if (!drawLayer(g, hubIm, 0, 0, hubR * 2)) {
      g.fillStyle = '#e0a020';
      g.beginPath();
      g.arc(0, 0, hubR, 0, TAU);
      g.fill();
    }
  }

  function paintBrightGoldType(g, text, x, y, px, opts) {
    opts = opts || {};
    const family = 'CinzelBlack, "Cinzel Black", Cinzel, serif';
    g.save();
    g.font = '900 ' + Math.round(px) + 'px ' + family;
    g.textAlign = opts.align || 'center';
    g.textBaseline = opts.baseline || 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    const lw = Math.max(4, px * (opts.stroke || 0.22));
    // Strong dark outline so the letters never melt into the gold frame
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = Math.max(4, px * 0.18);
    g.shadowOffsetX = 0;
    g.shadowOffsetY = Math.max(1, px * 0.04);
    g.lineWidth = lw;
    g.strokeStyle = 'rgba(6,2,0,0.96)';
    g.strokeText(text, x, y);
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    // Bright gold-to-white, no dark antique tail
    const h = px * 0.7;
    const grd = g.createLinearGradient(x, y - h, x, y + h);
    grd.addColorStop(0, '#fffef6');
    grd.addColorStop(0.22, '#fff4c4');
    grd.addColorStop(0.55, '#ffe27a');
    grd.addColorStop(0.82, '#ffd24a');
    grd.addColorStop(1, '#f0b430');
    g.fillStyle = grd;
    g.fillText(text, x, y);
    g.globalAlpha = 0.7;
    g.fillStyle = 'rgba(255,255,246,0.9)';
    g.fillText(text, x, y - Math.max(0.6, px * 0.04));
    g.globalAlpha = 1;
    g.shadowColor = 'rgba(255,230,140,0.85)';
    g.shadowBlur = px * 0.55;
    g.fillStyle = grd;
    g.fillText(text, x, y);
    g.restore();
  }

  function paintWinPlaque(g, bx, by, bw, bh, leftTxt, rightTxt, alpha) {
    const plq = get('plaque') || get('plaqueSm');
    g.save();
    g.globalAlpha = alpha == null ? 1 : alpha;
    if (plq && plq.width) {
      g.drawImage(plq, bx, by, bw, bh);
    } else {
      rr(g, bx, by, bw, bh, 12);
      g.fillStyle = 'rgba(8,4,0,0.94)';
      g.fill();
      g.strokeStyle = '#ffe28a';
      g.stroke();
    }
    // Darker recessed well so the readout sits in a pit, not on the gold frame
    const ix = bx + bw * 0.16;
    const iy = by + bh * 0.28;
    const iw = bw * 0.68;
    const ih = bh * 0.48;
    const ir = Math.min(14, ih * 0.35);
    rr(g, ix, iy, iw, ih, ir);
    g.fillStyle = 'rgba(0,0,0,0.82)';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    g.stroke();
    // Inner lip highlight so the well reads as recessed
    rr(g, ix + 1.5, iy + 1.5, iw - 3, ih - 3, Math.max(2, ir - 1));
    g.strokeStyle = 'rgba(255,220,140,0.16)';
    g.lineWidth = 1;
    g.stroke();

    const padX = Math.max(8, iw * 0.06);
    const maxW = iw - padX * 2;
    const maxH = ih * 0.78;
    const line = leftTxt + '  ' + rightTxt;
    let px = Math.min(36, Math.round(maxH));
    g.font = '900 ' + px + 'px CinzelBlack, "Cinzel Black", Cinzel, serif';
    while (px > 16 && g.measureText(line).width > maxW) {
      px -= 1;
      g.font = '900 ' + px + 'px CinzelBlack, "Cinzel Black", Cinzel, serif';
    }
    const cx = ix + iw / 2;
    const cy = iy + ih / 2 + 1;
    if (px >= 22 && g.measureText(line).width <= maxW) {
      paintBrightGoldType(g, line, cx, cy, px, { stroke: 0.22 });
    } else {
      // Two lines so both the multiplier and the payout stay large and crisp
      let px1 = Math.min(36, Math.round(ih * 0.38));
      let px2 = Math.min(32, Math.round(ih * 0.34));
      g.font = '900 ' + px1 + 'px CinzelBlack, "Cinzel Black", Cinzel, serif';
      while (px1 > 15 && g.measureText(leftTxt).width > maxW) {
        px1 -= 1;
        g.font = '900 ' + px1 + 'px CinzelBlack, "Cinzel Black", Cinzel, serif';
      }
      g.font = '900 ' + px2 + 'px CinzelBlack, "Cinzel Black", Cinzel, serif';
      while (px2 > 15 && g.measureText(rightTxt).width > maxW) {
        px2 -= 1;
        g.font = '900 ' + px2 + 'px CinzelBlack, "Cinzel Black", Cinzel, serif';
      }
      const gapY = Math.max(2, ih * 0.06);
      const topY = cy - (px2 + gapY) * 0.5;
      const botY = cy + (px1 + gapY) * 0.5;
      paintBrightGoldType(g, leftTxt, cx, topY, px1, { stroke: 0.22 });
      paintBrightGoldType(g, rightTxt, cx, botY, px2, { stroke: 0.22 });
    }
    g.restore();
  }

  function paintStakeButton(g, x, y, w, h, label) {
    rr(g, x, y, w, h, h / 2);
    const btn = g.createLinearGradient(x, y, x, y + h);
    btn.addColorStop(0, '#fff0b0');
    btn.addColorStop(0.55, '#f0b532');
    btn.addColorStop(1, '#b9770e');
    g.fillStyle = btn;
    g.fill();
    g.strokeStyle = '#7a4a0c';
    g.lineWidth = 2;
    g.stroke();
    paintGoldType(g, label || 'SPIN', x + w / 2, y + h / 2 + 1, Math.max(11, h * 0.42), { stroke: 0.16 });
  }

  function paintStakeWheelScene(g, W, H, state) {
    state = state || {};
    if (g.imageSmoothingEnabled != null) g.imageSmoothingEnabled = true;
    if (g.imageSmoothingQuality) g.imageSmoothingQuality = 'high';
    paintBgPlate(g, W, H);
    const L = layoutStakeWheel(W, H);
    const math = root.ReefBonusChoice;
    const sectors = state.sectors || (math && math.CHOICE_WHEEL) || [];
    const fmtM = (math && math.fmtWheelMult) || function (m) {
      return (Math.round(m * 10) / 10).toFixed(1) + '\u00d7';
    };
    const stake = state.stake != null ? state.stake : 100;
    const stakeTxt = 'Stake ' + (Math.floor(stake) / 100).toFixed(2);

    // Panel spotlight from upper-left (same key as the chests) and an ambient glow behind the wheel
    const spot = g.createRadialGradient(L.cx - L.R * 0.42, L.cy - L.R * 0.62, 8, L.cx, L.cy, L.R * 1.75);
    spot.addColorStop(0, 'rgba(255,228,170,0.18)');
    spot.addColorStop(0.35, 'rgba(90,150,170,0.07)');
    spot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = spot;
    g.fillRect(0, 0, W, H);

    g.save();
    g.translate(L.cx, L.cy);
    const glow = g.createRadialGradient(0, 0, L.R * 0.55, 0, 0, L.R * 1.28);
    glow.addColorStop(0, 'rgba(255,186,70,0.20)');
    glow.addColorStop(0.55, 'rgba(255,150,40,0.08)');
    glow.addColorStop(1, 'rgba(255,140,20,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, L.R * 1.28, 0, TAU);
    g.fill();
    g.restore();

    const veil = g.createRadialGradient(L.cx, L.cy, L.R * 0.25, L.cx, L.cy, Math.max(W, H) * 0.72);
    veil.addColorStop(0, 'rgba(2,10,20,0)');
    veil.addColorStop(1, 'rgba(2,10,20,.42)');
    g.fillStyle = veil;
    g.fillRect(0, 0, W, H);

    g.save();
    g.translate(L.cx, L.cy);
    paintStakeWheel(g, {
      R: L.R,
      faceR: L.faceR,
      hubR: L.hubR,
      sectors: sectors,
      rotation: state.rotation || 0,
      winIndex: state.winIndex,
      reveal: state.reveal || 0,
      shimmer: state.shimmer,
      seed: state.seed || 9,
      fmtMult: fmtM,
      lightPhase: state.lightPhase != null ? state.lightPhase : 0,
      spinning: !!state.spinning,
      reducedMotion: !!state.reducedMotion
    });
    g.restore();

    paintStakePointer(g, L.cx, L.tipY, L.pointerH);

    const sideW = Math.max(80, L.cx - L.R - L.pad);
    const title = 'TEMPLE STAKE WHEEL';
    let tFont = Math.max(11, Math.min(17, Math.round(H * 0.042)));
    g.font = '900 ' + tFont + 'px CinzelBlack, Cinzel, serif';
    while (tFont > 10 && g.measureText(title).width > sideW - 8) {
      tFont -= 1;
      g.font = '900 ' + tFont + 'px CinzelBlack, Cinzel, serif';
    }
    paintGoldType(g, title, L.pad + 4, L.titleY, tFont, { align: 'left', stroke: 0.16 });
    paintGoldType(g, stakeTxt, W - L.pad - 4, L.stakeY, Math.max(11, tFont * 0.95), { align: 'right', stroke: 0.16 });

    if (state.reveal > 0 && state.winMult != null) {
      const pay = state.winPay != null ? state.winPay : Math.round(stake * state.winMult);
      const leftTxt = fmtM(state.winMult);
      const rightTxt = '=  ' + (Math.floor(pay) / 100).toFixed(2);
      const gap = 8;
      const colW = Math.max(150, L.cx - L.R - L.pad - gap);
      const bw = Math.min(Math.max(200, colW), 300);
      const bh = Math.max(70, Math.round(Math.min(bw * 0.50, H * 0.26, L.btnY - L.titleY - 32)));
      const bx = L.pad + 2;
      const by = Math.min(Math.max(L.titleY + 20, L.cy - bh / 2), L.btnY - bh - 8);
      paintWinPlaque(g, bx, by, bw, bh, leftTxt, rightTxt, Math.min(1, state.reveal));
      const coinY = Math.max(L.pad + 12, L.tipY - 8);
      const coinX = L.cx;
      paintCoinBurst(g, coinX, coinY, 12, 4);
      paintCoinBurst(g, coinX + 14, coinY + 4, 7, 7);
    }

    if (state.paintButton !== false) {
      paintStakeButton(g, L.btnX, L.btnY, L.btnW, L.btnH, state.buttonText || 'SPIN');
    }
    return L;
  }


  function setImages(map) {
    if (!map) return;
    for (const [k, im] of Object.entries(map)) {
      const src = ASSETS[k] || k;
      imgs[src] = im;
    }
    ready = true;
  }

  // kick off load immediately in browser
  if (typeof Image !== 'undefined') ensureLoaded();

  root.ReefBonusChoiceArt = {
    ASSETS,
    ensureLoaded,
    setImages,
    getImage: get,
    paintChest,
    paintPearlClam,
    paintChoiceCard,
    paintTapScene,
    paintChestPanel,
    paintBubbles,
    paintGodRays,
    paintBgPlate,
    paintMiniWheelIcon,
    paintCoinBurst,
    layoutStakeWheel,
    layoutWheelNumerals,
    numeralsClearDividers,
    sectorCentroidFrac,
    fmtFaceLabel,
    paintStakeWheel,
    paintStakePointer,
    paintStakeWheelScene,
    paintStakeButton
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
