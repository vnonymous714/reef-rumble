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
    pearlSm: 'assets/bonus-tap-pearl-sm.webp'
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

  function ensureLoaded() {
    if (ready) return Promise.resolve(imgs);
    if (readyPromise) return readyPromise;
    readyPromise = Promise.all(Object.values(ASSETS).map(loadOne)).then(() => {
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
    if (dim) g.globalAlpha = 0.42;

    // soft ground glow
    const glow = g.createRadialGradient(0, 18 * scale, 4, 0, 18 * scale, 70 * scale);
    glow.addColorStop(0, open && !dim ? 'rgba(255,210,80,.45)' : 'rgba(80,200,220,.2)');
    glow.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.ellipse(0, 22 * scale, 58 * scale, 14 * scale, 0, 0, TAU);
    g.fill();

    // Compact image box — lids/coins must clear panel top with margin
    const maxW = 120 * scale, maxH = 100 * scale;
    if (!drawContain(g, im, 0, 0, maxW, maxH)) {
      g.fillStyle = '#8a5520';
      rr(g, -44 * scale, -28 * scale, 88 * scale, 60 * scale, 8 * scale);
      g.fill();
    }

    if (open && !dim) {
      paintCoinBurst(g, 0, -2 * scale, 8, 3);
      const inn = g.createRadialGradient(0, -2 * scale, 2, 0, -2 * scale, 32 * scale);
      inn.addColorStop(0, 'rgba(255,230,120,.35)');
      inn.addColorStop(1, 'rgba(255,180,40,0)');
      g.fillStyle = inn;
      g.beginPath();
      g.ellipse(0, -2 * scale, 32 * scale, 16 * scale, 0, 0, TAU);
      g.fill();
    }

    if (mult != null) {
      const label = mult + '\u00d7';
      const ly = 58 * scale; // under chest, inside budgeted height
      const bw = 48 * scale, bh = 22 * scale;
      rr(g, -bw / 2, ly - bh / 2, bw, bh, 9 * scale);
      const bgd = g.createLinearGradient(0, ly - bh / 2, 0, ly + bh / 2);
      bgd.addColorStop(0, dim ? '#c8b070' : '#fff0b0');
      bgd.addColorStop(0.55, dim ? '#a88830' : '#f0b532');
      bgd.addColorStop(1, dim ? '#7a6018' : '#b9770e');
      g.fillStyle = bgd;
      g.fill();
      g.strokeStyle = '#7a4a0c';
      g.lineWidth = 2 * scale;
      g.stroke();
      g.font = '900 ' + Math.round(16 * scale) + 'px system-ui,sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#3a2000';
      g.fillText(label, 0, ly + 1 * scale);
    } else if (!open) {
      g.font = '900 ' + Math.round(20 * scale) + 'px system-ui,sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 4 * scale;
      g.strokeStyle = 'rgba(10,20,30,.75)';
      g.fillStyle = '#fff6d0';
      g.strokeText('?', 0, 58 * scale);
      g.fillText('?', 0, 58 * scale);
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

    const max = (160 + pulse * 6) * s;
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
    const pad = Math.max(32, Math.min(W, H) * 0.085);
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
    const pearlCx = pad + usableW * 0.58;
    const pearlCy = pad + heatH + usableH * 0.60;
    const pearlBox = Math.min(usableW * 0.40, usableH * 0.62);
    const pearlScale = (pearlBox * 0.30) / (100 + pulse * 12);
    g.save();
    g.translate(pearlCx, pearlCy);
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
    const n = chests.length;
    const padY = Math.max(20, H * 0.10);
    const padX = Math.max(12, W * 0.03);
    const slot = (W - padX * 2) / n;
    // Fit image(~50s) + badge(~70s) with clear top/bottom margins
    const scaleByH = (H - padY * 2) / 175;
    const scaleByW = (slot * 0.78) / 120;
    const scale = Math.max(0.35, Math.min(scaleByH, scaleByW, 0.72));
    for (let i = 0; i < n; i++) {
      const c = chests[i];
      g.save();
      // Shift down so lids clear the top frame; badge still above bottom
      g.translate(padX + slot * (i + 0.5), H * 0.58);
      paintChest(g, {
        scale: scale,
        open: !!c.open,
        mult: c.mult,
        dim: !!c.dim
      });
      g.restore();
    }
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
    paintCoinBurst
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
