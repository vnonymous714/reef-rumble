/* Neon Tide Slots — original HD 5x3 slot sub-game for Reef Rumble. Play credits only; drawn with canvas, no external assets. */
(function () {
  'use strict';
  if(window.RR_AUTHORITATIVE){const b=document.getElementById('slotsBtn');if(b)b.onclick=()=>window.ReefAuthority.openBonus();return;}
  var M = window.NeonSlots, B = function () { return window.__slotsBridge; };
  if (!M) return;
  var $ = function (s) { return document.querySelector(s); };
  var fmt = function (c) { return (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var css = document.createElement('style');
  css.textContent = [
    '#slotsV{position:fixed;inset:0;z-index:60;display:none;background:radial-gradient(120% 90% at 50% 40%,#2a0b4a 0%,#12052a 55%,#05010f 100%);touch-action:manipulation;user-select:none;-webkit-user-select:none;font-family:system-ui,-apple-system,sans-serif}',
    '#slotsV.open{display:block}#slotsC{position:absolute;inset:0;width:100%;height:100%}',
    '#slotsV .sb{position:absolute;height:34px;min-width:34px;padding:0 12px;border-radius:17px;border:1px solid rgba(255,255,255,.25);background:linear-gradient(#3b1670,#1d0840);color:#fff;font:800 12px/34px system-ui;letter-spacing:.06em;box-shadow:0 0 10px rgba(200,80,255,.45),inset 0 1px 0 rgba(255,255,255,.25)}',
    '#slotsV .sb:active{transform:scale(.95)}',
    '#slBack{left:max(8px,env(safe-area-inset-left));top:6px}#slInfo{right:max(8px,env(safe-area-inset-right));top:6px}',
    '#slSpin{right:max(12px,env(safe-area-inset-right));bottom:8px;height:52px!important;min-width:104px!important;border-radius:26px!important;font-size:17px!important;line-height:52px!important;background:linear-gradient(#ff5bd1,#b0128a 60%,#6d0757)!important;box-shadow:0 0 18px rgba(255,70,200,.8),inset 0 2px 0 rgba(255,255,255,.4)!important}',
    '#slSpin.busy{opacity:.6}#slMinus{left:max(10px,env(safe-area-inset-left));bottom:14px}#slPlus{left:calc(max(10px,env(safe-area-inset-left)) + 120px);bottom:14px}',
    '#slAuto{right:calc(max(12px,env(safe-area-inset-right)) + 116px);bottom:14px}#slAuto.on{background:linear-gradient(#21d4ff,#0a6a9e)}',
    '#slPay{position:absolute;inset:44px 10% 10px;display:none;overflow:auto;background:rgba(10,2,25,.94);border:1px solid rgba(255,120,240,.5);border-radius:14px;color:#f3e6ff;font:600 12px/1.45 system-ui;padding:12px 16px;box-shadow:0 0 24px rgba(200,80,255,.5)}',
    '#slPay.open{display:block}#slPay table{width:100%;border-collapse:collapse}#slPay td{padding:2px 6px;text-align:center}#slPay h3{margin:0 0 6px;font-size:14px;color:#ffd84a}',
    '#slUg{position:absolute;left:50%;transform:translateX(-50%);top:40px;display:none;padding:2px 10px;border-radius:9px;background:#3a0010;border:1px solid #ff4060;color:#ffb3c0;font:800 10px/16px system-ui;letter-spacing:.08em}',
    'body.ug #slUg{display:block}'
  ].join('');
  document.head.appendChild(css);
  var V = document.createElement('div'); V.id = 'slotsV';
  V.innerHTML = '<canvas id="slotsC"></canvas><button class="sb" id="slBack" aria-label="Back to fish table">&#8249; FISH</button>' +
    '<button class="sb" id="slInfo" aria-label="Paytable">PAYS</button><div id="slUg"></div>' +
    '<button class="sb" id="slMinus" aria-label="Lower bet">&minus;</button><button class="sb" id="slPlus" aria-label="Raise bet">+</button>' +
    '<button class="sb" id="slAuto" aria-label="Auto spin">AUTO</button><button class="sb" id="slSpin" aria-label="Spin">SPIN</button><div id="slPay"></div>';
  document.body.appendChild(V);
  var cv = V.querySelector('canvas'), ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1, cell = 80, rx = 0, ry = 0, sprites = {}, blurs = {};
  var bi = 2, state = 'idle', reels = [], result = null, winShow = 0, winT = 0, big = null, parts = [], raf = 0, autoOn = false, lastPay = 0, shownWin = 0, tStart = 0, lightT = 0;
  var COL = { wild: ['#7dfcff', '#00b3ff'], seven: ['#ff4d6d', '#c0002a'], crown: ['#ffe066', '#ff9f1c'], diamond: ['#9bf6ff', '#3a86ff'], bell: ['#ffd166', '#f77f00'], star: ['#fff3b0', '#ffb703'], cherry: ['#ff6fae', '#d6005c'], lemon: ['#f5ff7a', '#b5c900'], shell: ['#ffc6ff', '#b46bff'] };
  /* ---------- procedural symbol art ---------- */
  function glowFill(c, a, b, s, blur) { var g = c.createLinearGradient(0, -s * .5, 0, s * .5); g.addColorStop(0, '#fff'); g.addColorStop(.25, a); g.addColorStop(1, b); c.fillStyle = g; c.shadowColor = a; c.shadowBlur = blur; }
  function drawSym(c, id, s) {
    var k = COL[id], a = k[0], b = k[1]; c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    glowFill(c, a, b, s, s * .18); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = s * .03;
    var p = function () { c.fill(); c.shadowBlur = 0; c.stroke(); };
    c.beginPath();
    if (id === 'seven') { c.font = '900 ' + (s * .78) + 'px Georgia,serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('7', 0, s * .04); c.shadowBlur = 0; c.strokeText('7', 0, s * .04); }
    else if (id === 'wild') { c.font = '900 ' + (s * .3) + 'px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.beginPath(); c.arc(0, 0, s * .4, 0, 7); c.fillStyle = 'rgba(0,40,80,.85)'; c.fill(); c.strokeStyle = a; c.lineWidth = s * .05; c.shadowColor = a; c.shadowBlur = s * .2; c.stroke(); glowFill(c, a, b, s, s * .15); c.fillText('WILD', 0, s * .02); }
    else if (id === 'crown') { var w = s * .36; c.moveTo(-w, s * .22); c.lineTo(-w, -s * .1); c.lineTo(-w * .5, s * .05); c.lineTo(0, -s * .28); c.lineTo(w * .5, s * .05); c.lineTo(w, -s * .1); c.lineTo(w, s * .22); c.closePath(); p(); [-w, 0, w].forEach(function (x, i) { c.beginPath(); c.arc(x, i === 1 ? -s * .3 : -s * .12, s * .05, 0, 7); c.fillStyle = '#ff4d6d'; c.fill(); }); }
    else if (id === 'diamond') { var d = s * .38; c.moveTo(-d, -s * .1); c.lineTo(-d * .5, -s * .3); c.lineTo(d * .5, -s * .3); c.lineTo(d, -s * .1); c.lineTo(0, s * .36); c.closePath(); p(); c.beginPath(); c.moveTo(-d, -s * .1); c.lineTo(d, -s * .1); c.moveTo(-d * .5, -s * .3); c.lineTo(0, s * .36); c.lineTo(d * .5, -s * .3); c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke(); }
    else if (id === 'bell') { c.moveTo(0, -s * .34); c.bezierCurveTo(s * .26, -s * .34, s * .24, s * .08, s * .36, s * .22); c.lineTo(-s * .36, s * .22); c.bezierCurveTo(-s * .24, s * .08, -s * .26, -s * .34, 0, -s * .34); p(); c.beginPath(); c.arc(0, s * .28, s * .07, 0, 7); c.fill(); }
    else if (id === 'star') { for (var i = 0; i < 10; i++) { var r = i % 2 ? s * .17 : s * .4, t = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(t) * r, Math.sin(t) * r); } c.closePath(); p(); }
    else if (id === 'cherry') { c.strokeStyle = '#7bd389'; c.lineWidth = s * .04; c.moveTo(-s * .16, s * .1); c.quadraticCurveTo(-s * .05, -s * .2, s * .12, -s * .34); c.moveTo(s * .16, s * .06); c.quadraticCurveTo(s * .14, -s * .2, s * .12, -s * .34); c.stroke(); glowFill(c, a, b, s, s * .18); [[-s * .17, s * .17], [s * .17, s * .13]].forEach(function (q) { c.beginPath(); c.arc(q[0], q[1], s * .16, 0, 7); c.fill(); }); }
    else if (id === 'lemon') { c.ellipse(0, 0, s * .36, s * .26, -.3, 0, 7); p(); }
    else if (id === 'shell') { c.moveTo(-s * .36, s * .2); c.quadraticCurveTo(-s * .4, -s * .34, 0, -s * .34); c.quadraticCurveTo(s * .4, -s * .34, s * .36, s * .2); c.lineTo(s * .1, s * .3); c.lineTo(-s * .1, s * .3); c.closePath(); p(); c.beginPath(); for (var j = -2; j <= 2; j++) { c.moveTo(0, s * .28); c.lineTo(j * s * .14, -s * .28); } c.strokeStyle = 'rgba(255,255,255,.5)'; c.stroke(); }
    c.restore();
  }
  function buildSprites() {
    var px = Math.round(cell * DPR); sprites = {}; blurs = {};
    M.SYM.forEach(function (s) {
      var o = document.createElement('canvas'); o.width = o.height = px; var c = o.getContext('2d'); c.translate(px / 2, px / 2); c.scale(DPR, DPR); drawSym(c, s.id, cell * .92); sprites[s.id] = o;
      var bl = document.createElement('canvas'); bl.width = px; bl.height = px; var d = bl.getContext('2d'); /* vertical motion blur */
      for (var k = -4; k <= 4; k++) { d.globalAlpha = .2; d.drawImage(o, 0, k * px * .05); } blurs[s.id] = bl;
    });
  }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    var top = 62, bot = 66; cell = Math.floor(Math.min((H - top - bot) / 3, (W - 40) / 5.6));
    rx = Math.round((W - cell * 5) / 2); ry = Math.round(top + (H - top - bot - cell * 3) / 2);
    buildSprites(); $('#slPlus').style.left = 'calc(max(10px, env(safe-area-inset-left)) + 140px)'; kick();
  }
  /* ---------- reels ---------- */
  var IDS = M.SYM.map(function (s) { return s.id; });
  function randSym() { return Math.floor(Math.random() * IDS.length); }
  function initReels(grid) { reels = []; for (var r = 0; r < 5; r++) reels.push({ strip: grid ? grid[r].slice() : [randSym(), randSym(), randSym()], y: 0, len: 0, t0: 0, dur: 0, done: true }); }
  function startReels(grid, now) {
    for (var r = 0; r < 5; r++) {
      var cur = reels[r].strip.slice(-3), n = 18 + r * 5, s = cur.slice();
      for (var i = 0; i < n; i++) s.push(randSym());
      s = s.concat(grid[r]); /* strip scrolls downward: we read it bottom-up */
      reels[r] = { strip: s, y: 0, len: s.length - 3, t0: now + r * 70, dur: 620 + r * 210, done: false, v: 0 };
    }
  }
  function easeOutBack(t) { var c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  /* ---------- sound ---------- */
  var AC = null; function tone(f, d, type, vol) { if (B().mute) return; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); var o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(vol || .06, AC.currentTime); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + d); } catch (e) {} }
  /* ---------- game flow ---------- */
  function bet() { return M.BETS[bi]; }
  function spin() {
    if (state !== 'idle' && state !== 'win') return;
    var b = B(); if (!b) return; var be = bet();
    if (b.bal < be) { setAuto(false); b.toast('Not enough credits. Go back and tap FREE.'); return; }
    var target = (b.rtpPeriod === 88 || b.rtpPeriod === 84) ? 0.88 : 0.92;
    b.credit(-be); b.addPlaythrough(be);
    result = M.spin(target, Math.random, !!b.ug); result.bet = be; result.pay = (window.ReefEngine && ReefEngine.clampWin) ? ReefEngine.clampWin(Math.round(result.mult * be)) : Math.round(result.mult * be);
    big = null; parts.length = 0; winShow = 0; shownWin = 0; lastPay = 0;
    state = 'spin'; tStart = performance.now(); startReels(result.grid, tStart); $('#slSpin').classList.add('busy'); tone(320, .08, 'square', .03); kick();
  }
  function settle() {
    var r = result, b = B();
    if (r.pay > 0) b.credit(r.pay);
    if (window.RRT && RRT.slot) RRT.slot(r.bet, r.pay, ('game=slots x' + (Math.round(r.mult * 10) / 10)).slice(0, 24));
    lastPay = r.pay; $('#slSpin').classList.remove('busy');
    if (r.pay > 0) {
      state = 'win'; winT = performance.now();
      if (r.mult >= 10) { big = { t0: winT, label: r.mult >= 50 ? 'EPIC WIN' : r.mult >= 25 ? 'MEGA WIN' : 'BIG WIN', amt: r.pay }; [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { tone(f, .3, 'triangle', .07); }, i * 110); }); }
      else tone(880, .15, 'sine', .06);
    } else state = 'idle';
    if (autoOn) setTimeout(function () { if (autoOn && V.classList.contains('open')) spin(); }, big ? 3200 : r.pay > 0 ? 1300 : 450);
    kick();
  }
  function setAuto(v) { autoOn = v; $('#slAuto').classList.toggle('on', v); if (v) spin(); }
  /* ---------- render ---------- */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function cellCenter(reel, row) { return [rx + reel * cell + cell / 2, ry + row * cell + cell / 2]; }
  function frame(now) {
    raf = 0; var c = ctx; c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
    lightT = now / 1000; var active = state === 'spin' || state === 'win' || parts.length > 0 || big;
    /* cabinet */
    var pad = 10, fx = rx - pad, fy = ry - pad, fw = cell * 5 + pad * 2, fh = cell * 3 + pad * 2;
    c.save(); rr(c, fx - 6, fy - 6, fw + 12, fh + 12, 18); var fg = c.createLinearGradient(fx, fy, fx + fw, fy + fh); fg.addColorStop(0, '#ff3ec9'); fg.addColorStop(.5, '#7b2cff'); fg.addColorStop(1, '#00d4ff'); c.fillStyle = fg; c.shadowColor = '#c04dff'; c.shadowBlur = 24; c.fill(); c.restore();
    c.save(); rr(c, fx, fy, fw, fh, 12); var ig = c.createLinearGradient(0, fy, 0, fy + fh); ig.addColorStop(0, '#0b0320'); ig.addColorStop(.5, '#1c0a3d'); ig.addColorStop(1, '#0b0320'); c.fillStyle = ig; c.fill(); c.restore();
    /* marquee lights */
    var nL = 26; for (var i = 0; i < nL; i++) { var t = i / nL, lx = fx - 6 + t * (fw + 12), on = ((i + Math.floor(lightT * 6)) % 3) === 0; c.beginPath(); c.arc(lx, fy - 6, 2.2, 0, 7); c.arc(lx, fy + fh + 6, 2.2, 0, 7); c.fillStyle = on ? '#fff6a8' : 'rgba(255,220,120,.25)'; c.fill(); }
    /* reels */
    c.save(); rr(c, rx, ry, cell * 5, cell * 3, 8); c.clip();
    var allDone = state === 'spin';
    for (var r = 0; r < 5; r++) {
      var R = reels[r]; if (!R) continue; var p = 0, blur = false;
      if (!R.done) { var tt = (now - R.t0) / R.dur; if (tt < 0) tt = 0; if (tt >= 1) { tt = 1; R.done = true; tone(180 + r * 40, .07, 'square', .03); } p = easeOutBack(tt); blur = tt > 0 && tt < .82; allDone = allDone && R.done; }
      else p = 1;
      var pos = p * R.len, base = Math.floor(pos), frac = pos - base;
      c.fillStyle = r % 2 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.06)'; c.fillRect(rx + r * cell, ry, cell, cell * 3);
      for (var k = -1; k < 3; k++) {
        var idx = base + k; if (idx < 0 || idx >= R.strip.length) continue;
        var row = k - frac; /* top row when pos=len is strip[len..len+2] */
        var sid = IDS[R.strip[idx]], img = blur ? blurs[sid] : sprites[sid];
        if (img) c.drawImage(img, rx + r * cell + cell * .04, ry + (row + 1) * cell - cell + cell * .04 + 0, cell * .92, cell * .92);
      }
    }
    /* glass sheen */
    var sh = c.createLinearGradient(0, ry, 0, ry + cell * 3); sh.addColorStop(0, 'rgba(0,0,0,.55)'); sh.addColorStop(.18, 'rgba(0,0,0,0)'); sh.addColorStop(.82, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.55)'); c.fillStyle = sh; c.fillRect(rx, ry, cell * 5, cell * 3);
    c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(rx, ry, cell * 5, cell * .5);
    c.restore();
    if (state === 'spin' && allDone) settle();
    /* paylines */
    if (state === 'win' && result && result.wins.length) {
      var el = now - winT, cyc = result.wins.length > 1 ? 1100 : 1e9, idxW = Math.floor(el / cyc) % result.wins.length, wlist = el < 900 ? result.wins : [result.wins[idxW]];
      wlist.forEach(function (w, j) {
        var L = M.LINES[w.line], hue = (w.line * 47) % 360, col = 'hsl(' + hue + ',100%,62%)';
        c.save(); c.strokeStyle = col; c.lineWidth = 3.5; c.shadowColor = col; c.shadowBlur = 14; c.beginPath();
        for (var q = 0; q < 5; q++) { var cc = cellCenter(q, L[q]); if (q) c.lineTo(cc[0], cc[1]); else c.moveTo(cc[0] - cell * .5, cc[1]); }
        var e = cellCenter(4, L[4]); c.lineTo(e[0] + cell * .5, e[1]); c.stroke();
        c.lineWidth = 2.5; for (var z = 0; z < w.n; z++) { var b0 = cellCenter(z, L[z]); var pulse = 1 + .04 * Math.sin(now / 90); rr(c, b0[0] - cell * .46 * pulse, b0[1] - cell * .46 * pulse, cell * .92 * pulse, cell * .92 * pulse, 10); c.stroke(); }
        c.restore();
        if (wlist.length === 1) { c.save(); c.font = '800 12px system-ui'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.shadowColor = col; c.shadowBlur = 8; var tx = 'LINE ' + (w.line + 1) + ' · ' + w.n + ' IN A ROW · ' + fmt(Math.round(w.m * result.bet / 20)), tw = c.measureText(tx).width + 20; c.shadowBlur = 0; rr(c, rx + cell * 2.5 - tw / 2, ry + cell * 3 - 24, tw, 20, 10); c.fillStyle = 'rgba(0,0,0,.7)'; c.fill(); c.fillStyle = '#fff'; c.shadowColor = col; c.shadowBlur = 8; c.fillText(tx, rx + cell * 2.5, ry + cell * 3 - 10); c.restore(); }
      });
    }
    /* header + meters */
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    var tg = c.createLinearGradient(W / 2 - 120, 0, W / 2 + 120, 0); tg.addColorStop(0, '#ff6ad5'); tg.addColorStop(.5, '#fff3a0'); tg.addColorStop(1, '#5ee7ff');
    c.font = '900 italic 22px system-ui'; c.fillStyle = tg; c.shadowColor = '#ff3ec9'; c.shadowBlur = 16; c.fillText('NEON TIDE 777', W / 2, 20);
    c.shadowBlur = 0; c.font = '700 10px system-ui'; c.fillStyle = 'rgba(230,210,255,.7)';
    var b = B(), per = b ? b.rtpPeriod : 92; c.fillText((per === 88 || per === 84) ? 'LOW TIDE · RTP 88% NOW' : 'RTP 92% · 20 LINES · PLAY CREDITS', W / 2, 37);
    c.restore();
    var by = H - 36;
    meter(c, 'BET', fmt(bet()), '', 92, by, 88);
    meter(c, 'CREDITS', fmt(b ? b.bal : 0), '', W / 2 - 70, by, 120);
    if (lastPay > 0 || state === 'win') { shownWin = Math.min(lastPay, shownWin + Math.max(1, lastPay / 40)); }
    meter(c, 'WIN', fmt(Math.round(shownWin)), '', W / 2 + 70, by, 110, lastPay > 0);
    if (parts.length) { var dt = 1 / 60; for (var i2 = parts.length - 1; i2 >= 0; i2--) { var q2 = parts[i2]; q2.vy += 600 * dt; q2.x += q2.vx * dt; q2.y += q2.vy * dt; q2.life -= dt; if (q2.life <= 0) { parts.splice(i2, 1); continue; } c.fillStyle = 'hsla(' + q2.h + ',100%,65%,' + Math.min(1, q2.life) + ')'; c.beginPath(); c.arc(q2.x, q2.y, q2.s, 0, 7); c.fill(); } }
    /* big win */
    if (big) {
      var et = (now - big.t0) / 1000;
      if (et > 3.2) big = null; else {
        if (parts.length < 160 && et < 2.2) for (var n = 0; n < 4; n++) parts.push({ x: W / 2, y: H * .45, vx: (Math.random() - .5) * 520, vy: -200 - Math.random() * 360, life: 1.6, h: Math.random() * 360, s: 3 + Math.random() * 4 });
        c.save(); c.fillStyle = 'rgba(10,0,30,' + Math.min(.55, et * 2) + ')'; c.fillRect(0, 0, W, H);
        var sc = Math.min(1, et * 3) * (1 + .05 * Math.sin(et * 10)); c.translate(W / 2, H * .44); c.scale(sc, sc); c.textAlign = 'center'; c.textBaseline = 'middle';
        var bg = c.createLinearGradient(0, -40, 0, 40); bg.addColorStop(0, '#fff7c2'); bg.addColorStop(.5, '#ffc300'); bg.addColorStop(1, '#ff5e00');
        c.font = '900 italic 54px system-ui'; c.fillStyle = bg; c.shadowColor = '#ff8a00'; c.shadowBlur = 30; c.fillText(big.label, 0, -14);
        c.lineWidth = 2; c.strokeStyle = '#fff'; c.shadowBlur = 0; c.strokeText(big.label, 0, -14);
        c.font = '900 30px system-ui'; c.fillStyle = '#fff'; c.shadowColor = '#ff3ec9'; c.shadowBlur = 18; c.fillText(fmt(Math.round(big.amt * Math.min(1, et / 1.6))), 0, 34);
        c.restore();
      }
    }
    if (state === 'win' && now - winT > 6000 && !big) state = 'idle';
    if (V.classList.contains('open') && (active || state === 'spin')) kick();
    else if (V.classList.contains('open')) setTimeout(kick, 120); /* idle: ~8 fps for marquee lights */
  }
  function meter(c, lbl, val, _, x, y, w, hot) {
    c.save(); rr(c, x - w / 2, y - 14, w, 32, 10); c.fillStyle = 'rgba(0,0,0,.45)'; c.fill(); c.strokeStyle = hot ? '#ffd84a' : 'rgba(200,120,255,.6)'; c.lineWidth = 1.2; c.stroke();
    c.textAlign = 'center'; c.font = '700 8px system-ui'; c.fillStyle = 'rgba(230,210,255,.75)'; c.fillText(lbl, x, y - 4);
    c.font = '800 14px system-ui'; c.fillStyle = hot ? '#ffd84a' : '#fff'; c.fillText(val, x, y + 11); c.restore();
  }
  function kick() { if (!raf && V.classList.contains('open')) raf = requestAnimationFrame(frame); }
  /* ---------- paytable ---------- */
  function payHtml() {
    var h = '<h3>NEON TIDE 777 — PAYS (× line bet, 20 lines)</h3><table><tr><td></td><td>3</td><td>4</td><td>5</td></tr>';
    M.SYM.forEach(function (s) { h += '<tr><td style="text-align:left">' + s.id.toUpperCase() + '</td><td>' + s.pay[2] + '</td><td>' + s.pay[3] + '</td><td>' + s.pay[4] + '</td></tr>'; });
    return h + '</table><p>Wins pay left to right on lines. WILD replaces any symbol (not on reel 1). Credits are play-only and have no cash value. RTP 92% (88% during visible Low Tide windows). Max win per spin 400.00 credits. Slot bets count toward play-through.</p>';
  }
  /* ---------- wiring ---------- */
  function open() { var b = B(); if (!b) return; b.open(); V.classList.add('open'); if (!reels.length) initReels(); resize(); }
  function close() { setAuto(false); if (state === 'spin') return; V.classList.remove('open'); $('#slPay').classList.remove('open'); B().close(); }
  $('#slBack').onclick = close; $('#slSpin').onclick = function () { setAuto(false); spin(); };
  $('#slAuto').onclick = function () { setAuto(!autoOn); };
  $('#slMinus').onclick = function () { if (state === 'spin') return; bi = Math.max(0, bi - 1); kick(); };
  $('#slPlus').onclick = function () { if (state === 'spin') return; bi = Math.min(M.BETS.length - 1, bi + 1); kick(); };
  $('#slInfo').onclick = function () { var p = $('#slPay'); p.innerHTML = payHtml(); p.classList.toggle('open'); };
  $('#slPay').onclick = function () { this.classList.remove('open'); };
  addEventListener('resize', function () { if (V.classList.contains('open')) resize(); });
  var btn = document.getElementById('slotsBtn'); if (btn) btn.onclick = open;
  window.__slots = { open: open, close: close, spin: spin, get state() { return state; }, get result() { return result; }, setBet: function (i) { bi = i; }, forceWin: null };
})();
