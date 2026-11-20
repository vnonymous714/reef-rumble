/* Shared Daily Temple Wheel painter — original sunken-temple reef palette.
   Browser: window.ReefDailyWheelArt. Node harness loads via vm. No economy logic. */
(function (root) {
  const TAU = Math.PI * 2;
  const STONE = [
    ['#1e5a6a', '#4aa0b4', '#0f3040'],
    ['#3a4a38', '#7a8a58', '#1e2818'],
    ['#2a4860', '#5a88a0', '#142838'],
    ['#4a3a28', '#a88850', '#241808'],
    ['#1a5868', '#3e90a4', '#0c2834'],
    ['#384858', '#688898', '#182028'],
    ['#205060', '#4890a0', '#102830'],
    ['#4a4030', '#988060', '#241c10'],
    ['#164858', '#3a8498', '#0a2834'],
  ];
  const GOLD = ['#5a3a0a', '#c89628', '#ffe9a0', '#8a5a12', '#fff2b8'];

  function paintDailyTempleWheel(g, opts) {
    const R = opts.R || 286;
    const prizes = opts.prizes;
    const n = prizes.length;
    const fmt = opts.fmt || ((c) => (c / 100).toFixed(2));
    const gemDraw = opts.gemDraw || null;
    const seed = opts.seed || 1;

    g.save();
    // Deep water disc behind rim
    const water = g.createRadialGradient(0, 0, 20, 0, 0, R);
    water.addColorStop(0, '#1a6a82');
    water.addColorStop(0.45, '#0d3a52');
    water.addColorStop(1, '#041420');
    g.fillStyle = water;
    g.beginPath();
    g.arc(0, 0, R - 8, 0, TAU);
    g.fill();

    // God rays (clipped to wheel)
    g.save();
    g.beginPath();
    g.arc(0, 0, R - 28, 0, TAU);
    g.clip();
    for (let i = 0; i < 7; i++) {
      const a = -0.55 + i * 0.18;
      g.fillStyle = `rgba(140,220,240,${0.045 + (i % 2) * 0.02})`;
      g.beginPath();
      g.moveTo(0, -R);
      g.lineTo(Math.sin(a) * R * 0.35, R * 0.2);
      g.lineTo(Math.sin(a + 0.08) * R * 0.35, R * 0.2);
      g.closePath();
      g.fill();
    }
    // rising bubbles
    for (let i = 0; i < 28; i++) {
      const t = ((seed * 17 + i * 97) % 1000) / 1000;
      const ang = t * TAU;
      const rad = 40 + ((seed * 31 + i * 53) % 1000) / 1000 * (R - 70);
      const x = Math.cos(ang) * rad * 0.55;
      const y = Math.sin(ang) * rad * 0.7 + 20;
      const rr = 1.2 + (i % 4);
      g.fillStyle = `rgba(190,240,255,${0.12 + (i % 3) * 0.05})`;
      g.beginPath();
      g.arc(x, y, rr, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.25)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.arc(x - rr * 0.25, y - rr * 0.25, rr * 0.35, 0, TAU);
      g.stroke();
    }
    g.restore();

    // Carved stone / coral sectors
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i - 0.5) * (TAU / n);
      const a1 = a0 + TAU / n;
      const rare = prizes[i] >= 10000;
      const c = rare ? ['#6a4300', '#ffcf4a', '#3a2400'] : STONE[i % STONE.length];
      const gr = g.createRadialGradient(0, 0, 36, 0, 0, R - 30);
      gr.addColorStop(0, c[1]);
      gr.addColorStop(0.55, c[0]);
      gr.addColorStop(1, c[2]);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R - 28, a0, a1);
      g.closePath();
      g.fill();

      // carved inset groove
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, R - 48, a0 + 0.02, a1 - 0.02);
      g.stroke();
      g.strokeStyle = 'rgba(200,230,235,.18)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(0, 0, R - 52, a0 + 0.03, a1 - 0.03);
      g.stroke();

      // coral flecks near rim
      if (!rare) {
        const mid = (a0 + a1) / 2;
        for (let k = 0; k < 3; k++) {
          const rr = R - 38 - k * 6;
          const x = Math.cos(mid + (k - 1) * 0.04) * rr;
          const y = Math.sin(mid + (k - 1) * 0.04) * rr;
          g.fillStyle = k === 1 ? 'rgba(200,80,140,.35)' : 'rgba(255,120,70,.28)';
          g.beginPath();
          g.ellipse(x, y, 5 - k, 3, mid, 0, TAU);
          g.fill();
        }
      }

      // One radial label per sector — hub is small so the prize ring stays wide
      g.save();
      g.rotate(-Math.PI / 2 + i * (TAU / n));
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const labelR = R * 0.50; // inward so glyphs clear the gold rim
      const arcW = 2 * labelR * Math.sin(Math.PI / n);
      const fontPx = Math.max(16, Math.min(rare ? R * 0.17 : R * 0.155, arcW * 0.70));
      g.font = `900 ${fontPx}px system-ui,sans-serif`;
      g.lineWidth = Math.max(4.5, fontPx * 0.34);
      g.strokeStyle = rare ? 'rgba(40,18,0,.96)' : 'rgba(0,6,14,.95)';
      g.fillStyle = rare ? '#ffe28a' : '#ffffff';
      let t = fmt(prizes[i]);
      // shorten long tails for phone wedges
      if (t.endsWith('.00')) t = t.slice(0, -3);
      g.strokeText(t, 0, -labelR);
      g.fillText(t, 0, -labelR);
      if (rare && fontPx >= 14) {
        g.font = `800 ${Math.max(9, fontPx * 0.4)}px system-ui`;
        g.fillStyle = '#ffe9a0';
        g.strokeStyle = 'rgba(40,20,0,.85)';
        g.lineWidth = 2.5;
        g.strokeText('RELIC', 0, -labelR + fontPx * 0.9);
        g.fillText('RELIC', 0, -labelR + fontPx * 0.9);
      }
      g.restore();
    }

    // Gold engraved dividers
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - 0.5) * (TAU / n);
      const gdiv = g.createLinearGradient(0, 0, Math.cos(a) * R, Math.sin(a) * R);
      gdiv.addColorStop(0, '#fff2b0');
      gdiv.addColorStop(0.5, '#c89628');
      gdiv.addColorStop(1, '#5a3a0a');
      g.strokeStyle = gdiv;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * (R * 0.20), Math.sin(a) * (R * 0.20));
      g.lineTo(Math.cos(a) * (R - 28), Math.sin(a) * (R - 28));
      g.stroke();
    }

    // Outer carved stone + gold rim
    const rimOuter = g.createLinearGradient(-R, -R, R, R);
    rimOuter.addColorStop(0, '#fff2b0');
    rimOuter.addColorStop(0.22, '#e0a52a');
    rimOuter.addColorStop(0.45, '#6a4210');
    rimOuter.addColorStop(0.62, '#ffd45a');
    rimOuter.addColorStop(0.8, '#8a5a14');
    rimOuter.addColorStop(1, '#3a2408');
    g.lineWidth = 34;
    g.strokeStyle = rimOuter;
    g.beginPath();
    g.arc(0, 0, R - 14, 0, TAU);
    g.stroke();
    // stone under-rim
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(20,40,48,.85)';
    g.beginPath();
    g.arc(0, 0, R - 30, 0, TAU);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,250,220,.85)';
    g.beginPath();
    g.arc(0, 0, R - 2, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(60,30,0,.75)';
    g.beginPath();
    g.arc(0, 0, R - 28, 0, TAU);
    g.stroke();

    // Rivets + gems on rim
    const gems = ['gem_r', 'gem_b', 'gem_g', 'gem_p'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - 0.5) * (TAU / n);
      const x = Math.cos(a) * (R - 14);
      const y = Math.sin(a) * (R - 14);
      if (gemDraw) gemDraw(g, gems[i % 4], x, y, 24);
      else {
        const rgb = { gem_r: '255,60,90', gem_b: '70,140,255', gem_g: '60,230,120', gem_p: '190,90,255' }[gems[i % 4]];
        const gg = g.createRadialGradient(x - 4, y - 4, 1, x, y, 12);
        gg.addColorStop(0, '#fff');
        gg.addColorStop(0.35, `rgb(${rgb})`);
        gg.addColorStop(1, '#1a0820');
        g.fillStyle = gg;
        g.beginPath();
        g.arc(x, y, 11, 0, TAU);
        g.fill();
      }
    }
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * (TAU / n);
      g.fillStyle = '#fff3c4';
      g.beginPath();
      g.arc(Math.cos(a) * (R - 14), Math.sin(a) * (R - 14), 3, 0, TAU);
      g.fill();
    }

    // Hub: smaller temple medallion so prize ring stays readable at phone sizes
    const hubR = Math.max(16, R * 0.15);
    const hub = g.createRadialGradient(-hubR * 0.28, -hubR * 0.28, 2, 0, 0, hubR);
    hub.addColorStop(0, '#fff4c0');
    hub.addColorStop(0.35, '#e3a82e');
    hub.addColorStop(0.7, '#8a5a14');
    hub.addColorStop(1, '#3a2208');
    g.fillStyle = hub;
    g.beginPath();
    g.arc(0, 0, hubR, 0, TAU);
    g.fill();
    g.lineWidth = Math.max(2, hubR * 0.06);
    g.strokeStyle = '#fff1b8';
    g.stroke();
    g.strokeStyle = 'rgba(60,30,0,.7)';
    g.lineWidth = Math.max(1.5, hubR * 0.04);
    g.beginPath();
    g.arc(0, 0, hubR * 0.82, 0, TAU);
    g.stroke();
    g.fillStyle = 'rgba(255,240,180,.25)';
    g.beginPath();
    g.moveTo(0, -hubR * 0.48);
    g.lineTo(hubR * 0.38, 0);
    g.lineTo(0, hubR * 0.48);
    g.lineTo(-hubR * 0.38, 0);
    g.closePath();
    g.fill();
    const gemS = hubR * 0.9;
    if (gemDraw) gemDraw(g, 'gem_r', 0, 0, gemS);
    else {
      const gg = g.createRadialGradient(-hubR * 0.12, -hubR * 0.12, 1, 0, 0, hubR * 0.38);
      gg.addColorStop(0, '#fff');
      gg.addColorStop(0.4, '#ff3c5a');
      gg.addColorStop(1, '#2a0410');
      g.fillStyle = gg;
      g.beginPath();
      g.arc(0, 0, hubR * 0.34, 0, TAU);
      g.fill();
    }

    g.restore();
  }

  function paintDailyModalChrome(g, W, H, opts) {
    // Full landscape preview: underwater scene plate + wheel + chrome
    const bg = opts.bgImage;
    if (bg) {
      const scale = Math.max(W / bg.width, H / bg.height);
      const dw = bg.width * scale, dh = bg.height * scale;
      g.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#1a6a82');
      sky.addColorStop(1, '#041420');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
    }
    // dim veil
    g.fillStyle = 'rgba(2,12,24,.55)';
    g.fillRect(0, 0, W, H);

    // carved stone panel
    const pw = Math.min(920, W * 0.96), ph = Math.min(372, H * 0.94);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    roundRect(g, px, py, pw, ph, 18);
    const panel = g.createLinearGradient(px, py, px + pw, py + ph);
    panel.addColorStop(0, 'rgba(18,55,72,.92)');
    panel.addColorStop(0.5, 'rgba(8,28,40,.94)');
    panel.addColorStop(1, 'rgba(4,16,28,.96)');
    g.fillStyle = panel;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#c5a45d';
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(70,100,110,.8)';
    roundRect(g, px + 4, py + 4, pw - 8, ph - 8, 14);
    g.stroke();

    // Landscape split: large wheel on LEFT (readable labels), chrome/SPIN on RIGHT.
    // Fits 985x400 / 844x390 / 740x360 without clipping.
    const pad = 12;
    const leftW = pw * 0.58;
    const rightX = px + leftW + 8;
    const rightW = pw - leftW - 16;
    const wheelR = Math.min((ph - pad * 2) * 0.48, leftW * 0.46, 160);
    const wheelCx = px + leftW * 0.52;
    const wheelCy = py + ph * 0.50;

    g.save();
    g.translate(wheelCx, wheelCy);
    paintDailyTempleWheel(g, {
      R: wheelR,
      prizes: opts.prizes,
      fmt: opts.fmt,
      gemDraw: opts.gemDraw,
      seed: opts.seed || 7,
    });
    g.restore();

    // pointer at top of wheel
    g.fillStyle = '#ffe28a';
    g.strokeStyle = '#6a420a';
    g.lineWidth = 2;
    const tipY = wheelCy - wheelR - 2;
    g.beginPath();
    g.moveTo(wheelCx, tipY + 12);
    g.lineTo(wheelCx - 9, tipY);
    g.lineTo(wheelCx + 9, tipY);
    g.closePath();
    g.fill();
    g.stroke();

    // Right column: title, streak, result, SPIN
    g.textAlign = 'left';
    g.font = '900 ' + Math.max(14, Math.min(20, rightW * 0.08)) + 'px system-ui,sans-serif';
    g.fillStyle = '#ffdf9d';
    g.shadowColor = 'rgba(255,200,80,.45)';
    g.shadowBlur = 10;
    g.fillText('DAILY TEMPLE', rightX, py + 28);
    g.fillText('WHEEL', rightX, py + 48);
    g.shadowBlur = 0;
    g.font = '800 12px system-ui';
    g.fillStyle = '#cde5e7';
    g.fillText(opts.streakLabel || 'DAY 1', rightX, py + 70);

    // No prize chip list — wedge labels are large/readable; keeps right column clean.

    if (opts.resultText) {
      g.font = '900 22px system-ui';
      g.fillStyle = '#fff6d0';
      g.shadowColor = 'rgba(255,210,100,.5)';
      g.shadowBlur = 12;
      g.fillText(opts.resultText, rightX, py + ph * 0.48);
      g.shadowBlur = 0;
    }

    const bw = Math.min(200, rightW - 4), bh = 34;
    const bx = rightX, btnY = py + ph - 78;
    roundRect(g, bx, btnY, bw, bh, 17);
    const btn = g.createLinearGradient(bx, btnY, bx, btnY + bh);
    btn.addColorStop(0, '#fff0b0');
    btn.addColorStop(0.55, '#f0b532');
    btn.addColorStop(1, '#b9770e');
    g.fillStyle = btn;
    g.fill();
    g.strokeStyle = '#7a4a0c';
    g.lineWidth = 2;
    g.stroke();
    g.textAlign = 'center';
    g.font = '900 13px system-ui';
    g.fillStyle = '#3a2000';
    g.fillText(opts.buttonText || 'SPIN · DAILY GIFT', bx + bw / 2, btnY + 22);

    g.textAlign = 'left';
    g.font = '600 8px system-ui';
    g.fillStyle = 'rgba(220,240,255,.7)';
    // wrap note into right column
    g.fillText('One server-confirmed claim per', rightX, py + ph - 28);
    g.fillText('LA day. Weighted; no cash value.', rightX, py + ph - 16);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }


  /* tg34 HD Daily Temple Wheel. Face sectors are painted procedurally as cut
     gemstone/temple-stone inlays; the outer ring is the photoreal 2048px gold
     rim render (assets/bonus-wheel-rim.webp) when loaded. Prize labels are
     sized to fit their sector (never overlap) and read upright when the sector
     sits under the pointer. Presentation only: prizes/weights come from caller. */
  const GEM = [
    ['#bff6ff', '#2bb3c9', '#063a48'], // aquamarine
    ['#c7d4ff', '#2d55d8', '#0a1450'], // sapphire
    ['#c9ffd9', '#1f9a57', '#063018'], // emerald
    ['#ffe2b0', '#d07a12', '#4a2002'], // amber
    ['#e6c9ff', '#7a2ccf', '#260842'], // amethyst
    ['#ffd0dc', '#d42a50', '#4a0614'], // ruby
    ['#d9fff4', '#16a58e', '#033a30'], // jade
    ['#ffe0f2', '#c23a8e', '#3e0828'], // rose quartz
    ['#d8e8ff', '#4a7ad8', '#0c1c48'], // topaz blue
    ['#fff4c4', '#e0a520', '#5a3602']  // relic gold (top prize)
  ];
  function paintDailyTempleWheelHD(g, opts) {
    const size = opts.size || 1200, R = size / 2 * 0.985, faceR = R * 0.76, hubR = R * 0.17;
    const prizes = opts.prizes, n = prizes.length, step = TAU / n;
    const fmtLabel = opts.label || ((c) => { const v = c / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); });
    const font = opts.font || '900 {px}px CinzelBlack, "Cinzel Black", Cinzel, Georgia, serif';
    g.save();
    // back plate
    const plate = g.createRadialGradient(0, 0, hubR, 0, 0, faceR + 6);
    plate.addColorStop(0, '#1b1206'); plate.addColorStop(1, '#3a2608');
    g.fillStyle = plate; g.beginPath(); g.arc(0, 0, faceR + 8, 0, TAU); g.fill();
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i - 0.5) * step, a1 = a0 + step, mid = (a0 + a1) / 2;
      const top = prizes[i] === Math.max.apply(null, prizes);
      const c = top ? GEM[9] : GEM[i % 9];
      // gem body
      const cx = Math.cos(mid) * faceR * 0.55, cy = Math.sin(mid) * faceR * 0.55;
      const body = g.createRadialGradient(cx - Math.cos(mid) * faceR * 0.2, cy - Math.sin(mid) * faceR * 0.2, faceR * 0.02, cx, cy, faceR * 0.62);
      body.addColorStop(0, c[0]); body.addColorStop(0.45, c[1]); body.addColorStop(1, c[2]);
      g.fillStyle = body; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, faceR, a0, a1); g.closePath(); g.fill();
      // facets: two inner bevel triangles + crisp light edge
      g.save(); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, faceR, a0, a1); g.closePath(); g.clip();
      const fA = (k, alpha, col) => { g.fillStyle = col.replace('A', alpha); g.beginPath(); g.moveTo(Math.cos(a0) * hubR, Math.sin(a0) * hubR); g.lineTo(Math.cos(a0 + step * k) * faceR, Math.sin(a0 + step * k) * faceR); g.lineTo(Math.cos(a0) * faceR, Math.sin(a0) * faceR); g.closePath(); g.fill(); };
      fA(0.42, .22, 'rgba(255,255,255,A)');
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.moveTo(Math.cos(a1) * hubR, Math.sin(a1) * hubR); g.lineTo(Math.cos(a1 - step * 0.38) * faceR, Math.sin(a1 - step * 0.38) * faceR); g.lineTo(Math.cos(a1) * faceR, Math.sin(a1) * faceR); g.closePath(); g.fill();
      const sheen = g.createLinearGradient(Math.cos(a0) * faceR, Math.sin(a0) * faceR, Math.cos(a1) * faceR, Math.sin(a1) * faceR);
      sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(255,255,255,.14)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sheen; g.fillRect(-faceR, -faceR, faceR * 2, faceR * 2);
      // inner veins / sparkle
      for (let k = 0; k < 5; k++) { const rr = faceR * (0.35 + ((i * 37 + k * 53) % 100) / 100 * 0.55), aa = a0 + step * (0.15 + ((i * 13 + k * 29) % 70) / 100); g.fillStyle = 'rgba(255,255,255,' + (0.25 + (k % 2) * 0.25) + ')'; g.beginPath(); g.arc(Math.cos(aa) * rr, Math.sin(aa) * rr, size * 0.0025 * (1 + k % 3), 0, TAU); g.fill(); }
      g.restore();
    }
    // gold dividers (engraved)
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - 0.5) * step;
      const gd = g.createLinearGradient(0, 0, Math.cos(a) * faceR, Math.sin(a) * faceR);
      gd.addColorStop(0, '#fff2b0'); gd.addColorStop(0.5, '#d9a531'); gd.addColorStop(1, '#6a4410');
      g.strokeStyle = 'rgba(40,20,0,.8)'; g.lineWidth = size * 0.012; g.beginPath(); g.moveTo(Math.cos(a) * hubR, Math.sin(a) * hubR); g.lineTo(Math.cos(a) * faceR, Math.sin(a) * faceR); g.stroke();
      g.strokeStyle = gd; g.lineWidth = size * 0.0065; g.stroke();
    }
    // labels: one per sector, fitted to the sector chord, upright under the pointer
    const labelR = hubR + (faceR - hubR) * 0.60;
    const chord = 2 * labelR * Math.sin(step / 2);
    for (let i = 0; i < n; i++) {
      const t = fmtLabel(prizes[i]), top = prizes[i] === Math.max.apply(null, prizes);
      g.save(); g.rotate(i * step);
      let px = size * 0.085;
      g.font = font.replace('{px}', px.toFixed(1));
      const maxW = chord * 0.80, maxH = (faceR - hubR) * 0.42;
      const w0 = g.measureText(t).width; if (w0 > maxW) px *= maxW / w0; if (px > maxH) px = maxH;
      g.font = font.replace('{px}', px.toFixed(1));
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const y = -labelR;
      g.lineWidth = px * 0.26; g.strokeStyle = 'rgba(20,8,0,.92)'; g.strokeText(t, 0, y);
      const gt = g.createLinearGradient(0, y - px / 2, 0, y + px / 2);
      if (top) { gt.addColorStop(0, '#fffbe0'); gt.addColorStop(0.5, '#ffd23a'); gt.addColorStop(1, '#b06a06'); }
      else { gt.addColorStop(0, '#ffffff'); gt.addColorStop(0.55, '#fff2c8'); gt.addColorStop(1, '#e8c070'); }
      g.fillStyle = gt; g.fillText(t, 0, y);
      // tiny unit under the number
      const up = Math.max(size * 0.018, px * 0.30);
      g.font = '800 ' + up.toFixed(1) + 'px system-ui, sans-serif';
      g.lineWidth = up * 0.35; g.strokeStyle = 'rgba(10,4,0,.9)'; g.fillStyle = top ? '#ffe9a0' : '#e7f7ff';
      const unit = top ? 'RELIC' : 'CREDITS'; g.strokeText(unit, 0, y + px * 0.72); g.fillText(unit, 0, y + px * 0.72);
      g.restore();
    }
    // inner lip shadow
    const lip = g.createRadialGradient(0, 0, faceR * 0.86, 0, 0, faceR);
    lip.addColorStop(0, 'rgba(0,0,0,0)'); lip.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = lip; g.beginPath(); g.arc(0, 0, faceR, 0, TAU); g.fill();
    // photoreal gold rim (HD render) or carved fallback
    if (opts.rim && opts.rim.width) {
      g.drawImage(opts.rim, -R, -R, R * 2, R * 2);
    } else {
      const rim = g.createLinearGradient(-R, -R, R, R);
      rim.addColorStop(0, '#fff2b0'); rim.addColorStop(0.3, '#d99a22'); rim.addColorStop(0.55, '#6a4210'); rim.addColorStop(0.75, '#ffd45a'); rim.addColorStop(1, '#3a2408');
      g.strokeStyle = rim; g.lineWidth = R - faceR; g.beginPath(); g.arc(0, 0, (R + faceR) / 2, 0, TAU); g.stroke();
    }
    g.restore();
    return { R, faceR, hubR };
  }

  root.ReefDailyWheelArt = { paintDailyTempleWheel, paintDailyTempleWheelHD, paintDailyModalChrome };
})(typeof globalThis !== 'undefined' ? globalThis : this);
