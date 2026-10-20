/* Reef Rumble: original fish-shooter demo. Play credits only, no cash value. */
(() => {
'use strict';
const E = window.ReefEngine;
const $ = s => document.querySelector(s);
const TAU = Math.PI * 2;
const rnd = Math.random;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = c => FMT.format(Math.floor(c) / 100);

/* ---------- state (guarded, persisted) ---------- */
const SEASON = 'class1';
const SEASON_KEY = 'reefrumble.season';
/* Season clock (UTC). Week-1 ends SEASON_START + 7d. America/Los_Angeles = UTC-7 in Oct. */
const SEASON_START = Date.parse('2026-10-19T09:45:00.000Z'); // 2026-10-19 02:45 PT
const SEASON_WEEK1_END = SEASON_START + 7 * 86400000;         // 2026-10-26 02:45 PT
const SKEY = 'reefrumble.v1';
const DEPOSIT_C = 10000, BONUS_C = 10000;           // 100.00 + 100.00
const START = DEPOSIT_C + BONUS_C;                  // 200.00 on season start
const FREE_AMT = 10000, FREE_CD = 60000, BAL_CAP = 1e11;
const REBUY_MIN = 2500, REBUY_PRESETS = [2500, 5000, 10000]; // 25/+5, 50/+10, 100/+25 bonus
/* Play-through need = total bonus balance × 10 (season 100 + any rebuy bonuses). */
const T = window.RRT || { shot() {}, win() {}, credit() {}, start() {}, short: '', setMode() {}, setRtpPeriod() {} };
let freshSeason = false;
try {
  if (localStorage.getItem(SEASON_KEY) !== SEASON) {
    freshSeason = true;
    localStorage.removeItem(SKEY);
    localStorage.removeItem('reefrumble.daily');
    localStorage.removeItem('reefrumble.underground');
    localStorage.setItem(SEASON_KEY, SEASON);
  }
} catch (e) {}
const S = { bal: START, jp: E.JP_SEED, bi: 3, mute: false, lastFree: 0, bonus: BONUS_C, pt: 0, welcomed: false };
try {
  const o = JSON.parse(localStorage.getItem(SKEY) || 'null');
  if (o && typeof o === 'object') {
    if (Number.isFinite(o.bal) && o.bal >= 0 && o.bal < BAL_CAP) S.bal = Math.floor(o.bal);
    if (Number.isFinite(o.jp) && o.jp >= E.JP_SEED && o.jp < BAL_CAP) S.jp = o.jp;
    if (Number.isInteger(o.bi) && o.bi >= 0 && o.bi < E.BETS.length) S.bi = o.bi;
    S.mute = !!o.mute;
    if (Number.isFinite(o.lastFree)) S.lastFree = o.lastFree;
    if (Number.isFinite(o.bonus) && o.bonus >= 0) S.bonus = Math.floor(o.bonus);
    if (Number.isFinite(o.pt) && o.pt >= 0) S.pt = Math.floor(o.pt);
    S.welcomed = !!o.welcomed;
  }
} catch (e) {}
if (freshSeason) { S.bal = START; S.bonus = BONUS_C; S.pt = 0; S.welcomed = false; S.jp = E.JP_SEED; S.bi = 3; S.lastFree = 0; }
let dirty = false;
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); dirty = false; } catch (e) {} };
const credit = c => { S.bal = clamp(Math.floor(S.bal + c), 0, BAL_CAP); dirty = true; };
setInterval(() => { if (dirty) save(); }, 1500);
addEventListener('pagehide', save);
const stats = { shots: 0, hits: 0, caps: 0, wagered: 0, paid: 0, refunds: 0 };

/* ---------- RTP period (week-1 all 95%; after that 5/30 min Low Tide @84) ---------- */
let rtpPeriod = 95, lastRtpTag = 0;
function computeRtpPeriod(now) {
  now = now || Date.now();
  if (now < SEASON_WEEK1_END) return 95;
  const mins = Math.floor(now / 60000);
  return (mins % 30) < 5 ? 84 : 95;
}
function syncRtpPeriod(force) {
  const p = computeRtpPeriod();
  if (!force && p === rtpPeriod) return p;
  rtpPeriod = p;
  try { E.setRtpPeriod(p); } catch (e) {}
  try { T.setRtpPeriod && T.setRtpPeriod(p); } catch (e) {}
  const ban = document.getElementById('tideBan');
  if (ban) {
    if (p === 84) {
      ban.classList.add('on');
      const mins = Math.floor(Date.now() / 60000);
      const left = 5 - (mins % 30);
      ban.textContent = 'LOW TIDE — published payout 84% · ' + Math.max(1, left) + ' min left';
    } else {
      ban.classList.remove('on');
      ban.textContent = '';
    }
  }
  return p;
}
setInterval(() => syncRtpPeriod(false), 5000);

/* ---------- play-through (10× total bonus balance wagered) ---------- */
let ptLogAt = 0, ptCompleteLogged = false;
function ptNeed() { return Math.max(0, Math.floor(S.bonus || 0)) * 10; }
function ptReady() { const n = ptNeed(); return n > 0 && S.pt >= n; }
function addPlaythrough(bet) {
  const need = ptNeed();
  if (!(bet > 0) || need <= 0 || S.pt >= need) return;
  const before = S.pt;
  S.pt = Math.min(need, S.pt + bet);
  dirty = true;
  updatePtHud();
  const now = Date.now();
  if (now - ptLogAt > 8000 || S.pt >= need) {
    ptLogAt = now;
    try { T.credit('playthrough_progress', S.pt); } catch (e) {}
  }
  if (!ptCompleteLogged && S.pt >= need && before < need) {
    ptCompleteLogged = true;
    try { T.credit('playthrough_complete', need); } catch (e) {}
    toast('Play-through met — pretend Cash Out unlocked');
  }
}
function updatePtHud() {
  const need = ptNeed() || 1;
  const fill = document.getElementById('ptFill'), num = document.getElementById('ptNum'), meter = document.getElementById('ptMeter'), btn = document.getElementById('cashBtn');
  if (fill) fill.style.width = (Math.min(1, S.pt / need) * 100).toFixed(1) + '%';
  if (num) num.textContent = fmt(S.pt) + ' / ' + fmt(ptNeed());
  if (meter) {
    meter.classList.toggle('ready', ptReady());
    meter.title = 'Wager 10× bonus (' + fmt(ptNeed()) + ') to unlock demo cash-out';
  }
  if (btn) { btn.classList.toggle('locked', !ptReady()); btn.classList.toggle('ready', ptReady()); }
}

/* ---------- sound (synthesized) ---------- */
const Sfx = (() => {
  let ac = null, master = null, lastCoin = 0;
  const init = () => {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = .5; master.connect(ac.destination); } catch (e) { ac = null; }
  };
  const tone = (f, d, type, vol, slide, delay) => {
    if (!ac || S.mute) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + d);
    g.gain.setValueAtTime(vol || .2, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + .02);
  };
  let nbuf = null;
  const noise = (d, vol, freq) => {
    if (!ac || S.mute) return;
    if (!nbuf) { nbuf = ac.createBuffer(1, ac.sampleRate * .6, ac.sampleRate); const ch = nbuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = rnd() * 2 - 1; }
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = nbuf; f.type = 'lowpass'; f.frequency.value = freq || 1200;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + d);
  };
  return {
    init,
    shot: () => tone(880, .07, 'square', .05, 420),
    net: () => noise(.12, .12, 2200),
    coin: () => { const n = performance.now(); if (n - lastCoin < 70) return; lastCoin = n; tone(1320, .08, 'sine', .12); tone(1760, .12, 'sine', .1, 0, .06); },
    big: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, .22, 'triangle', .14, 0, i * .08)); },
    boom: () => { noise(.5, .35, 500); tone(120, .5, 'sine', .3, 40); },
    zap: () => { tone(1800, .25, 'sawtooth', .06, 200); noise(.2, .1, 4000); },
    tick: () => tone(1500, .03, 'square', .04),
    alarm: () => { tone(220, .35, 'sawtooth', .08, 330); tone(220, .35, 'sawtooth', .08, 330, .4); },
    jackpot: () => { for (let i = 0; i < 10; i++) tone([523, 659, 784, 1046, 1318][i % 5], .25, 'triangle', .13, 0, i * .1); }
  };
})();

/* ---------- canvas + sizing ---------- */
const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false });
const wrap = $('#wrap');
let W = 0, H = 0, DPR = 1, K = 1, SB = 0;
let bg = null, coinSpr = null, bulletSpr = null, sprites = {};
let frameSpr = null, causticsSpr = null, deepFish = [];
const GEMS = { get 0() { return ART.gem_r; }, get 1() { return ART.gem_b; }, get 2() { return ART.gem_g; }, get 3() { return ART.gem_p; } };
function rrPath(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) { c.roundRect(x, y, w, h, r); } else { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); } }
let cannon = { x: 0, y: 0, ang: -Math.PI / 2, recoil: 0 };
let balTarget = { x: 60, y: 20 };

function resize() {
  W = innerWidth; H = innerHeight;
  DPR = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  K = clamp(Math.min(W / 844, H / 390), .62, 1.5);
  SB = H - $('#sb').getBoundingClientRect().bottom;
  cannon.x = W / 2; cannon.y = H - SB - 18 * K;
  const r = $('#balPill').getBoundingClientRect(); balTarget = { x: r.left + 18, y: r.top + r.height / 2 };
  buildBg(); buildSprites();
}

function off(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
/* ---------- generated art (WebP) with procedural fallback ---------- */
const ART = {}, ART_V = '6';
const CORE_ART = ['bg', 'cannon', 'coin', 'gem_r', 'gem_b', 'gem_g', 'gem_p', 'minnow', 'guppy', 'darter', 'pebble', 'tang', 'lantern', 'jelly', 'turtle', 'ray', 'sword', 'shark', 'koi', 'whale', 'bomb', 'eel', 'chest'];
const BOSS_ART = ['kraken', 'dragon'];
function loadArt(name) {
  if (ART[name]) return ART[name].p;
  const img = new Image(), e = ART[name] = { img, ok: false };
  const file = name === 'bg' && (Math.max(innerWidth, innerHeight) * Math.min(2, devicePixelRatio || 1)) <= 1000 ? 'bg-sm' : name;
  e.p = new Promise(res => { img.onload = () => { e.ok = true; res(true); }; img.onerror = () => res(false); });
  img.decoding = 'async'; img.src = 'assets/' + file + '.webp?v=' + ART_V; return e.p;
}
const artOk = n => ART[n] && ART[n].ok;
function preloadArt() {
  const bar = $('#plBar'), box = $('#preload'); let done = 0;
  const all = CORE_ART.map(n => loadArt(n).then(ok => { done++; if (bar) bar.style.transform = `scaleX(${done / CORE_ART.length})`; return ok; }));
  const finish = () => { if (box && !box.classList.contains('gone')) { box.classList.add('gone'); setTimeout(() => box.remove(), 500); setTimeout(() => { if (!S.welcomed) openWelcome(); else dailyCheck(); }, 700); } };
  setTimeout(finish, 9000);  // never block play on a slow network
  Promise.all(all).then(() => { buildBg(); buildSprites(); finish(); setTimeout(() => BOSS_ART.forEach(n => loadArt(n).then(ok => ok && buildOne(E.BY_ID[n]))), 600); });
}

function buildBg() {
  bg = off(W * DPR, H * DPR); const g = bg.getContext('2d'); g.scale(DPR, DPR);
  if (artOk('bg')) {
    const im = ART.bg.img, s = Math.max(W / im.width, H / im.height), iw = im.width * s, ih = im.height * s;
    g.imageSmoothingQuality = 'high'; g.drawImage(im, (W - iw) / 2, (H - ih) * .6, iw, ih);
    g.fillStyle = 'rgba(2,16,40,.22)'; g.fillRect(0, 0, W, H);  // calm the plate so fish pop
  } else {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#0e74bd'); gr.addColorStop(.3, '#064c88'); gr.addColorStop(.62, '#042c5a'); gr.addColorStop(.86, '#021d40'); gr.addColorStop(1, '#010f26');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // surface glow
  const sgl = g.createRadialGradient(W * .5, -H * .25, 10, W * .5, -H * .25, H * 1.15);
  sgl.addColorStop(0, 'rgba(150,230,255,.22)'); sgl.addColorStop(1, 'rgba(150,230,255,0)'); g.fillStyle = sgl; g.fillRect(0, 0, W, H);
  // god rays
  for (let i = 0; i < 9; i++) {
    const x = W * (-.05 + i * .13) + (rnd() - .5) * 40, w = 30 + rnd() * 70;
    const rg = g.createLinearGradient(0, 0, 0, H * .9); rg.addColorStop(0, 'rgba(188,246,255,.13)'); rg.addColorStop(1, 'rgba(188,246,255,0)');
    g.fillStyle = rg; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w * 2.4 + 90, H * .9); g.lineTo(x + w * .5 + 50, H * .9); g.fill();
  }
  // distant reef silhouettes (midground)
  g.fillStyle = 'rgba(3,24,50,.55)';
  for (let i = 0; i < 5; i++) { const x = W * (i / 5) + (rnd() - .5) * 60, bw = 80 + rnd() * 120, bh = 40 + rnd() * 70; g.beginPath(); g.moveTo(x - bw / 2, H * .9); for (let t = 0; t <= 1.0001; t += .1) g.lineTo(x - bw / 2 + bw * t, H * .9 - Math.sin(t * Math.PI) * bh * (.6 + Math.sin(t * 9 + x) * .2)); g.lineTo(x + bw / 2, H * .9); g.fill(); }
  // sand
  const sy = H * .9;
  const sg = g.createLinearGradient(0, sy - 20, 0, H); sg.addColorStop(0, '#24597a'); sg.addColorStop(1, '#0c2740');
  g.fillStyle = sg; g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 18) g.lineTo(x, sy + Math.sin(x * .013) * 9 + Math.sin(x * .041) * 4);
  g.lineTo(W, H); g.fill();
  g.fillStyle = 'rgba(180,230,255,.10)'; for (let i = 0; i < 60; i++) { const x = rnd() * W, y = sy + rnd() * (H - sy); g.fillRect(x, y, 1.5, 1.5); }
  // seaweed (gradient) + coral
  const weed = (x, hgt) => { const wg = g.createLinearGradient(0, H - hgt, 0, H); wg.addColorStop(0, 'rgba(60,200,150,.5)'); wg.addColorStop(1, 'rgba(10,80,70,.6)'); g.strokeStyle = wg; g.lineWidth = 5 * K; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, H); for (let y = 0; y < hgt; y += 7) g.lineTo(x + Math.sin(y * .06 + x) * 8 * K, H - y); g.stroke(); };
  for (let i = 0; i < 16; i++) weed(rnd() * W, (45 + rnd() * 100) * K);
  const coral = (x, s, col) => { g.fillStyle = col; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(x + (i - 2.5) * 9 * s, H - (10 + (i % 3) * 12) * s, (9 + (i % 2) * 4) * s, 0, TAU); g.fill(); } };
  coral(W * .12, K, 'rgba(255,110,140,.4)'); coral(W * .86, K * 1.2, 'rgba(255,170,90,.33)'); coral(W * .63, K * .8, 'rgba(190,120,255,.33)'); coral(W * .4, K * .7, 'rgba(90,220,255,.28)');
  }
  // baked vignette
  const vg = g.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .3, W / 2, H * .5, Math.max(W, H) * .78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,6,20,.5)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  // parallax silhouette school
  deepFish = []; for (let i = 0; i < 5; i++) deepFish.push({ x: rnd() * W, y: H * (.2 + rnd() * .5), s: .6 + rnd() * .8, spd: 6 + rnd() * 10, ph: rnd() * TAU });
  buildCaustics(); buildFrame();
  // coin & bullet sprites
  const cs = 16 * K * DPR; coinSpr = off(cs, cs); if (artOk('coin')) { const c = coinSpr.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(ART.coin.img, 0, 0, cs, cs); } else { const c = coinSpr.getContext('2d'); const rg = c.createRadialGradient(cs * .35, cs * .3, 1, cs / 2, cs / 2, cs / 2); rg.addColorStop(0, '#fff8c8'); rg.addColorStop(.5, '#ffcf4a'); rg.addColorStop(1, '#b06e00'); c.fillStyle = rg; c.beginPath(); c.arc(cs / 2, cs / 2, cs / 2 - 1, 0, TAU); c.fill(); c.strokeStyle = '#8a5400'; c.lineWidth = cs * .08; c.beginPath(); c.arc(cs / 2, cs / 2, cs * .3, 0, TAU); c.stroke(); }
  const bs = 26 * K * DPR; bulletSpr = off(bs, bs); { const c = bulletSpr.getContext('2d'); const rg = c.createRadialGradient(bs / 2, bs / 2, 0, bs / 2, bs / 2, bs / 2); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(.25, 'rgba(160,250,255,1)'); rg.addColorStop(.5, 'rgba(40,200,255,.5)'); rg.addColorStop(1, 'rgba(40,200,255,0)'); c.fillStyle = rg; c.fillRect(0, 0, bs, bs); }
}
function buildCaustics() {
  const w = Math.ceil(W), h = Math.ceil(H * .62); causticsSpr = off(w, h); const c = causticsSpr.getContext('2d');
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) { const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 32, a = .04 + rnd() * .05; const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(200,245,255,' + a + ')'); rg.addColorStop(1, 'rgba(200,245,255,0)'); c.fillStyle = rg; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  c.strokeStyle = 'rgba(210,250,255,.05)'; c.lineWidth = 2;
  for (let i = 0; i < 22; i++) { c.beginPath(); let x = rnd() * w, y = rnd() * h; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - .5) * 60; y += (rnd() - .3) * 28; c.lineTo(x, y); } c.stroke(); }
}
let frB = 14, frR = 16;
function addRR(c, x, y, w, h, r) { c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function ringPath(c) { c.beginPath(); c.rect(0, 0, W, H); addRR(c, frB, frB, W - 2 * frB, H - 2 * frB, frR); }
const GEM_RGB = { gem_r: '255,60,90', gem_b: '70,140,255', gem_g: '60,230,120', gem_p: '190,90,255' };
function gemAt(c, name, x, y, s) {
  const rg = c.createRadialGradient(x, y, 0, x, y, s * 1.25); rg.addColorStop(0, `rgba(${GEM_RGB[name]},.55)`); rg.addColorStop(1, `rgba(${GEM_RGB[name]},0)`);
  c.fillStyle = rg; c.beginPath(); c.arc(x, y, s * 1.25, 0, TAU); c.fill();
  if (artOk(name)) c.drawImage(ART[name].img, x - s / 2, y - s / 2, s, s);
  else { const g2 = c.createRadialGradient(x - s * .15, y - s * .15, 0, x, y, s / 2); g2.addColorStop(0, '#fff'); g2.addColorStop(.35, `rgb(${GEM_RGB[name]})`); g2.addColorStop(1, '#1a0820'); c.fillStyle = g2; c.beginPath(); c.arc(x, y, s / 2, 0, TAU); c.fill(); }
}
function buildFrame() {
  frameSpr = off(W * DPR, H * DPR); const c = frameSpr.getContext('2d'); c.scale(DPR, DPR); c.imageSmoothingQuality = 'high';
  const b = frB = Math.round(clamp(7.5 * K, 6, 8)), r = frR = Math.round(b * 1.6);
  // metallic base: bronze -> gold -> highlight bands
  const mg = c.createLinearGradient(0, 0, W * .35, H);
  [['#4a2a06', 0], ['#c8901c', .1], ['#ffe9a0', .17], ['#b97c12', .27], ['#5a3608', .38], ['#d9a42a', .5], ['#fff2b8', .56], ['#a96d0e', .66], ['#4a2a06', .78], ['#e2ae36', .9], ['#7a4a08', 1]].forEach(([col, o]) => mg.addColorStop(o, col));
  ringPath(c); c.fillStyle = mg; c.fill('evenodd');
  c.save(); ringPath(c); c.clip('evenodd');
  const cz = b * 4.6;
  const rail = len => {  // local coords: x along rail, y = 0 outer edge .. b inner edge
    const bv = c.createLinearGradient(0, 0, 0, b); bv.addColorStop(0, 'rgba(255,248,215,.55)'); bv.addColorStop(.18, 'rgba(255,240,190,0)'); bv.addColorStop(.62, 'rgba(0,0,0,0)'); bv.addColorStop(1, 'rgba(40,18,0,.55)');
    c.fillStyle = bv; c.fillRect(0, 0, len, b);
    c.fillStyle = 'rgba(255,246,210,.45)'; c.fillRect(0, b * .2, len, .6);  // fine highlight line
    // hairline engraved scrolls + tiny rivets, all inside the rail width
    const p = Math.max(16, 20 * K), y = b * .58, a = b * .2;
    const eng = (dy, col, lw) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
      for (let k = 0, x = cz; x < len - cz - p * .5; k++, x += p) {
        if (k % 4 === 3) continue;  // rivet slot
        c.moveTo(x, y + dy); c.bezierCurveTo(x + p * .25, y - a + dy, x + p * .45, y + a + dy, x + p * .7, y + dy);
        c.moveTo(x + p * .7 + a, y + dy); c.arc(x + p * .7, y + dy, a, 0, Math.PI * 1.5); }
      for (const [x0, d] of [[b * 2.15, 1], [len - b * 2.15, -1]]) {  // small flourishes beside the corner caps
        c.moveTo(x0, y + dy); c.bezierCurveTo(x0 + d * b * .8, y - a * 1.4 + dy, x0 + d * b * 1.4, y + a * 1.4 + dy, x0 + d * b * 2.1, y + dy);
        c.moveTo(x0 + d * b * 2.1 + a, y + dy); c.arc(x0 + d * b * 2.1, y + dy, a, 0, d > 0 ? Math.PI * 1.5 : -Math.PI * .5, d < 0); }
      c.stroke(); };
    eng(.6, 'rgba(255,246,205,.5)', .75); eng(0, 'rgba(60,30,0,.75)', .9);
    for (let k = 0, x = cz; x < len - cz - p * .5; k++, x += p) if (k % 4 === 3) {
      const rx = x + p * .45, rg = c.createRadialGradient(rx - .4, y - .4, 0, rx, y, 1.25); rg.addColorStop(0, '#fffbe0'); rg.addColorStop(.55, '#d9a32a'); rg.addColorStop(1, '#3a1d00');
      c.fillStyle = rg; c.beginPath(); c.arc(rx, y, 1.25, 0, TAU); c.fill(); }
  };
  c.save(); rail(W); c.restore();
  c.save(); c.translate(0, H); c.scale(1, -1); rail(W); c.restore();
  c.save(); c.rotate(Math.PI / 2); c.scale(1, -1); rail(H); c.restore();
  c.save(); c.translate(W, 0); c.rotate(Math.PI / 2); rail(H); c.restore();
  c.restore();
  // bevels: bright outer lip, dark inner lip + highlight
  c.strokeStyle = 'rgba(255,244,200,.7)'; c.lineWidth = 1.2; c.strokeRect(.6, .6, W - 1.2, H - 1.2);
  c.beginPath(); addRR(c, b, b, W - 2 * b, H - 2 * b, r); c.strokeStyle = '#2a1400'; c.lineWidth = 1.2; c.stroke();
  c.beginPath(); addRR(c, b - 1.2, b - 1.2, W - 2 * b + 2.4, H - 2 * b + 2.4, r + 1.2); c.strokeStyle = 'rgba(255,240,185,.7)'; c.lineWidth = .7; c.stroke();
  c.beginPath(); addRR(c, b + 3, b + 3, W - 2 * b - 6, H - 2 * b - 6, r - 2); c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 3; c.stroke();  // inner depth shadow
  // mirrored corner medallions with gems
  const R = b * 1.05, cx0 = b * 1.15;
  const medal = (sx, sy, gem) => {
    c.save(); c.translate(sx < 0 ? W : 0, sy < 0 ? H : 0); c.scale(sx, sy);
    const mg2 = c.createRadialGradient(cx0 - R * .35, cx0 - R * .35, 0, cx0, cx0, R); mg2.addColorStop(0, '#fff6c8'); mg2.addColorStop(.45, '#e0a830'); mg2.addColorStop(.85, '#8a560c'); mg2.addColorStop(1, '#3a1d00');
    c.fillStyle = mg2; c.beginPath(); c.arc(cx0, cx0, R, 0, TAU); c.fill();
    c.strokeStyle = '#2a1400'; c.lineWidth = 1.4; c.stroke();
    c.fillStyle = '#140a02'; c.beginPath(); c.arc(cx0, cx0, R * .74, 0, TAU); c.fill();
    c.restore();
    gemAt(c, gem, sx < 0 ? W - cx0 : cx0, sy < 0 ? H - cx0 : cx0, R * 1.3);
  };
  medal(1, 1, 'gem_r'); medal(-1, 1, 'gem_b'); medal(1, -1, 'gem_g'); medal(-1, -1, 'gem_p');
  // small rail gems in gold bezel cups
  // ghost seats (decor)
  const seat = (x, y, ang) => { c.save(); c.translate(x, y); c.rotate(ang); c.globalAlpha = .5;
    const dg = c.createLinearGradient(0, -16 * K, 0, 12 * K); dg.addColorStop(0, '#3a6a92'); dg.addColorStop(1, '#122638');
    c.fillStyle = dg; c.beginPath(); c.arc(0, 0, 13 * K, Math.PI, 0); c.lineTo(15 * K, 12 * K); c.lineTo(-15 * K, 12 * K); c.closePath(); c.fill();
    c.fillStyle = '#4f86b0'; rrPath(c, -4 * K, -26 * K, 8 * K, 20 * K, 2 * K); c.fill();
    c.fillStyle = 'rgba(180,230,255,.5)'; c.fillRect(-5 * K, -27 * K, 10 * K, 3 * K); c.restore(); };
  const ins = b + 15 * K;
  seat(ins, H * .36, Math.PI / 2); seat(ins, H * .66, Math.PI / 2);
  seat(W - ins, H * .36, -Math.PI / 2); seat(W - ins, H * .66, -Math.PI / 2);
  seat(W * .32, ins, Math.PI); seat(W * .68, ins, Math.PI);
}
function frameShimmer(now) {  // one low-alpha band sweeping the gold, clipped to the bezel ring
  const u = (now * .00011) % 1.7 - .25; if (u > 1.15) return;
  const x = u * (W + H * .5);
  ctx.save(); ringPath(ctx); ctx.clip('evenodd'); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x - 60, -30, x + 60, 30); g.addColorStop(0, 'rgba(255,245,200,0)'); g.addColorStop(.5, 'rgba(255,245,200,.32)'); g.addColorStop(1, 'rgba(255,245,200,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
}

/* ---------- original fish art (procedural, prerendered) ---------- */
const FRAMES = 4;
function bodyPath(g, L, h) {
  g.beginPath(); g.moveTo(L * .5, 0);
  g.bezierCurveTo(L * .38, -h * .58, -L * .12, -h * .58, -L * .32, 0);
  g.bezierCurveTo(-L * .12, h * .58, L * .38, h * .58, L * .5, 0); g.closePath();
}
function vgrad(g, h, c1, c2) { const gr = g.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, c2); gr.addColorStop(.55, c1); gr.addColorStop(1, '#ffffff'); return gr; }
function eye(g, x, y, r) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.fillStyle = '#071226'; g.beginPath(); g.arc(x + r * .25, y, r * .6, 0, TAU); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + r * .4, y - r * .3, r * .22, 0, TAU); g.fill(); }
function tail(g, L, h, ph, fan, col) {
  const w = Math.sin(ph) * h * .18;
  g.fillStyle = col; g.beginPath(); g.moveTo(-L * .28, 0);
  g.quadraticCurveTo(-L * .42, -h * .2 + w, -L * (fan ? .56 : .5), -h * (fan ? .55 : .42) + w);
  g.quadraticCurveTo(-L * .44, w, -L * (fan ? .56 : .5), h * (fan ? .55 : .42) + w);
  g.quadraticCurveTo(-L * .42, h * .2 + w, -L * .28, 0); g.fill();
}
function halo(g, R, rgb) { const rg = g.createRadialGradient(0, 0, 0, 0, 0, R); rg.addColorStop(0, `rgba(${rgb},.45)`); rg.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); }
function rarityGlow(d) {
  if (d.glow) return [d.glow, d.boss ? 1.3 : 1.05];
  const m = Array.isArray(d.m) ? d.m[1] : d.m;
  if (m >= 40) return ['255,210,90', .95]; if (m >= 20) return ['150,200,255', .78]; if (m >= 10) return ['190,140,255', .64]; if (m >= 6) return ['120,230,255', .5]; return ['130,220,255', .34];
}
function aura(g, R, rgb, strength) { const rg = g.createRadialGradient(0, 0, 0, 0, 0, R); rg.addColorStop(0, `rgba(${rgb},${.4 * strength})`); rg.addColorStop(.5, `rgba(${rgb},${.15 * strength})`); rg.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); }
function pecFin(g, L, h, ph, col) { const sw = Math.sin(ph) * .22; g.save(); g.globalAlpha = .62; g.fillStyle = col; g.beginPath(); g.moveTo(L * .16, h * .16); g.quadraticCurveTo(L * .0, h * (.5 + sw), -L * .14, h * (.6 + sw)); g.quadraticCurveTo(-L * .02, h * .28, L * .16, h * .16); g.fill(); g.restore(); }
function serpent(g, L, h, ph, c1, c2, spines, head) {
  const n = 18, pts = [];
  for (let i = 0; i <= n; i++) { const u = i / n; pts.push([L * .45 - u * L * .9, Math.sin(u * 5 - ph) * h * .35 * u]); }
  for (let i = n; i >= 0; i--) {
    const u = i / n, r = h * (.5 - u * .38), p = pts[i];
    g.fillStyle = i % 2 ? c1 : c2; g.beginPath(); g.arc(p[0], p[1], r, 0, TAU); g.fill();
    if (spines && i % 2 === 0 && i > 1) { g.fillStyle = spines; g.beginPath(); g.moveTo(p[0] - r * .5, p[1] - r * .8); g.lineTo(p[0], p[1] - r * 1.7); g.lineTo(p[0] + r * .5, p[1] - r * .8); g.fill(); }
  }
  const p = pts[0];
  if (head) head(p[0], p[1]);
}
function drawFish(g, d, ph) {
  const L = d.len, h = d.h;
  const [grgb, gstr] = rarityGlow(d);
  aura(g, Math.max(L, h) * (d.glow ? .74 : .62), grgb, gstr);
  switch (d.shape) {
    case 'fish': case 'lantern': case 'sword': {
      tail(g, L, h, ph, d.fan, d.c2);
      pecFin(g, L, h, ph, d.c2);
      g.fillStyle = d.c2; g.beginPath(); g.moveTo(L * .15, -h * .38); g.quadraticCurveTo(-L * .05, -h * .85, -L * .2, -h * .3); g.fill();
      bodyPath(g, L, h); g.fillStyle = vgrad(g, h, d.c1, d.c2); g.fill();
      g.save(); bodyPath(g, L, h); g.clip();
      if (d.pat === 'stripes') { g.fillStyle = 'rgba(10,30,80,.75)'; for (let i = 0; i < 4; i++) g.fillRect(L * (.25 - i * .15), -h, L * .06, h * 2); }
      if (d.pat === 'band') { g.fillStyle = 'rgba(255,230,80,.9)'; g.fillRect(-L * .1, -h, L * .12, h * 2); }
      if (d.pat === 'scales') { g.strokeStyle = 'rgba(200,110,0,.55)'; g.lineWidth = 1.5; for (let x = -L * .25; x < L * .3; x += 9) for (let y = -h * .4; y < h * .4; y += 9) { g.beginPath(); g.arc(x, y, 5, -1.2, 1.2); g.stroke(); } }
      else if (!d.pat) { g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; for (let x = -L * .28; x < L * .32; x += 8) for (let y = -h * .34; y < h * .34; y += 8) { g.beginPath(); g.arc(x, y, 4, -1, 1); g.stroke(); } }
      const rl = g.createLinearGradient(0, -h * .5, 0, 0); rl.addColorStop(0, 'rgba(235,250,255,.5)'); rl.addColorStop(1, 'rgba(235,250,255,0)'); g.fillStyle = rl; g.fillRect(-L, -h * .55, L * 2, h * .34);
      g.restore();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(L * .1, -h * .2, L * .22, h * .08, 0, 0, TAU); g.fill();
      if (d.shape === 'sword') { g.fillStyle = '#dfe9f5'; g.beginPath(); g.moveTo(L * .45, -h * .06); g.lineTo(L * .78, 0); g.lineTo(L * .45, h * .08); g.fill(); }
      if (d.shape === 'lantern') {
        g.strokeStyle = d.c1; g.lineWidth = 2; g.beginPath(); g.moveTo(L * .3, -h * .4); g.quadraticCurveTo(L * .5, -h * .95, L * .62, -h * .55); g.stroke();
        const rg = g.createRadialGradient(L * .62, -h * .55, 0, L * .62, -h * .55, h * .4); rg.addColorStop(0, '#fffbd0'); rg.addColorStop(.3, 'rgba(255,240,120,.9)'); rg.addColorStop(1, 'rgba(255,240,120,0)'); g.fillStyle = rg; g.beginPath(); g.arc(L * .62, -h * .55, h * .4, 0, TAU); g.fill();
        g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(L * (.38 + i * .03), h * .05); g.lineTo(L * (.395 + i * .03), h * .18); g.lineTo(L * (.41 + i * .03), h * .05); g.fill(); }
      }
      eye(g, L * .3, -h * .1, Math.max(3, h * .13));
      break;
    }
    case 'round': {
      tail(g, L * 1.3, h * .7, ph, 0, d.c2);
      g.fillStyle = vgrad(g, h, d.c1, d.c2); g.beginPath(); g.ellipse(0, 0, L * .45, h * .48, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(30,80,20,.5)'; for (let i = 0; i < 8; i++) { const a = i * .8; g.beginPath(); g.arc(Math.cos(a) * L * .25, Math.sin(a) * h * .25, 2.5, 0, TAU); g.fill(); }
      eye(g, L * .2, -h * .12, h * .14);
      break;
    }
    case 'jelly': {
      g.strokeStyle = d.c2; g.lineWidth = 2.5; g.lineCap = 'round';
      for (let i = 0; i < 5; i++) { const y = (i - 2) * h * .14; g.beginPath(); g.moveTo(-L * .05, y); for (let x = 0; x < L * .55; x += 4) g.lineTo(-L * .05 - x, y + Math.sin(x * .2 + ph * 2 + i) * 4); g.stroke(); }
      const s = 1 + Math.sin(ph) * .06;
      const rg = g.createRadialGradient(L * .1, 0, 2, L * .05, 0, h * .55); rg.addColorStop(0, '#fff'); rg.addColorStop(.5, d.c1); rg.addColorStop(1, d.c2);
      g.fillStyle = rg; g.beginPath(); g.ellipse(L * .1, 0, L * .3 * s, h * .48 / s, 0, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.ellipse(L * .2, -h * .15, L * .08, h * .12, 0, 0, TAU); g.fill();
      break;
    }
    case 'turtle': {
      const f = Math.sin(ph) * .5;
      g.fillStyle = '#7fcf6a';
      [[L * .18, -h * .32, -.6 - f], [L * .18, h * .32, .6 + f], [-L * .22, -h * .28, -2.4 + f * .5], [-L * .22, h * .28, 2.4 - f * .5]].forEach(([x, y, a]) => { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(L * .12, 0, L * .16, h * .09, 0, 0, TAU); g.fill(); g.restore(); });
      g.beginPath(); g.ellipse(L * .38, 0, L * .12, h * .12, 0, 0, TAU); g.fill();
      g.fillStyle = vgrad(g, h, d.c1, d.c2); g.beginPath(); g.ellipse(0, 0, L * .32, h * .4, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(20,70,30,.7)'; g.lineWidth = 2;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j += 2) { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(i * L * .14 + Math.cos(a) * 9, j * h * .12 + Math.sin(a) * 9); } g.closePath(); g.stroke(); }
      eye(g, L * .42, -h * .04, 3.5);
      break;
    }
    case 'ray': {
      const f = Math.sin(ph) * .22;
      g.strokeStyle = d.c2; g.lineWidth = 3; g.beginPath(); g.moveTo(-L * .2, 0); g.quadraticCurveTo(-L * .4, Math.sin(ph) * 6, -L * .55, 0); g.stroke();
      g.fillStyle = vgrad(g, h, d.c1, d.c2);
      g.beginPath(); g.moveTo(L * .4, 0); g.quadraticCurveTo(L * .1, -h * (.55 + f), -L * .05, -h * (.5 + f)); g.quadraticCurveTo(-L * .1, -h * .1, -L * .22, 0); g.quadraticCurveTo(-L * .1, h * .1, -L * .05, h * (.5 + f)); g.quadraticCurveTo(L * .1, h * (.55 + f), L * .4, 0); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(L * (.02 + (i % 3) * .07), (i < 3 ? -1 : 1) * h * (.12 + (i % 3) * .06), 2.5, 0, TAU); g.fill(); }
      eye(g, L * .28, -h * .09, 3.5); eye(g, L * .28, h * .09, 3.5);
      break;
    }
    case 'shark': {
      tail(g, L, h * 1.1, ph, 1, d.c2);
      pecFin(g, L, h, ph, d.c2);
      g.fillStyle = d.c2; g.beginPath(); g.moveTo(L * .08, -h * .4); g.lineTo(-L * .06, -h * .95); g.lineTo(-L * .12, -h * .35); g.fill();
      g.beginPath(); g.moveTo(L * .1, h * .3); g.lineTo(-L * .05, h * .7); g.lineTo(-L * .06, h * .25); g.fill();
      bodyPath(g, L, h); g.fillStyle = vgrad(g, h, d.c1, d.c2); g.fill();
      g.strokeStyle = 'rgba(40,60,80,.6)'; g.lineWidth = 1.5; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(L * (.25 - i * .04), -h * .15); g.lineTo(L * (.23 - i * .04), h * .12); g.stroke(); }
      g.strokeStyle = '#3a0a0a'; g.lineWidth = 2; g.beginPath(); g.moveTo(L * .44, h * .12); g.quadraticCurveTo(L * .38, h * .2, L * .32, h * .14); g.stroke();
      eye(g, L * .36, -h * .1, 3.5);
      break;
    }
    case 'whale': {
      const f = Math.sin(ph) * h * .15;
      g.fillStyle = d.c2; g.beginPath(); g.moveTo(-L * .35, 0); g.quadraticCurveTo(-L * .45, f, -L * .52, -h * .4 + f); g.quadraticCurveTo(-L * .46, f, -L * .52, h * .4 + f); g.quadraticCurveTo(-L * .45, f, -L * .35, 0); g.fill();
      g.fillStyle = vgrad(g, h, d.c1, d.c2); g.beginPath(); g.moveTo(L * .48, h * .05); g.bezierCurveTo(L * .45, -h * .6, -L * .2, -h * .55, -L * .38, 0); g.bezierCurveTo(-L * .2, h * .45, L * .4, h * .55, L * .48, h * .05); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 2; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(L * .4, h * (.1 + i * .06)); g.lineTo(-L * .1, h * (.12 + i * .06)); g.stroke(); }
      g.fillStyle = '#fff8b0'; for (let i = 0; i < 9; i++) { const x = L * (.3 - i * .07), y = -h * (.18 + (i % 3) * .07); g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 2 : 5, a = k * Math.PI / 5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.fill(); }
      eye(g, L * .3, -h * .02, 5);
      break;
    }
    case 'bomb': {
      g.fillStyle = '#5a0b0b'; for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.beginPath(); g.moveTo(Math.cos(a - .15) * h * .42, Math.sin(a - .15) * h * .42); g.lineTo(Math.cos(a) * h * .62, Math.sin(a) * h * .62); g.lineTo(Math.cos(a + .15) * h * .42, Math.sin(a + .15) * h * .42); g.fill(); }
      const rg = g.createRadialGradient(-h * .12, -h * .15, 2, 0, 0, h * .46); rg.addColorStop(0, '#ff9a7a'); rg.addColorStop(.6, '#d81e1e'); rg.addColorStop(1, '#6a0606');
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, h * .45, 0, TAU); g.fill();
      g.strokeStyle = '#ffd24a'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, h * .3, 0, TAU); g.stroke();
      g.fillStyle = '#ffd24a'; g.font = `900 ${h * .26}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BOOM', 0, h * .02);
      const sp = 3 + (Math.sin(ph * 3) + 1) * 3; g.fillStyle = '#fff6a0'; g.beginPath(); g.arc(h * .32, -h * .5, sp, 0, TAU); g.fill();
      g.strokeStyle = '#d8b070'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(h * .22, -h * .38); g.lineTo(h * .32, -h * .5); g.stroke();
      break;
    }
    case 'eel': {
      serpent(g, L, h, ph, '#ffe94a', '#ffb300', null, (x, y) => { g.fillStyle = '#ffe94a'; g.beginPath(); g.ellipse(x + 6, y, h * .55, h * .42, 0, 0, TAU); g.fill(); eye(g, x + 10, y - 3, 3.5); });
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { const x = L * (.2 - i * .25); g.beginPath(); g.moveTo(x, -5); g.lineTo(x - 5, 1); g.lineTo(x + 2, 1); g.lineTo(x - 3, 7); g.stroke(); }
      break;
    }
    case 'chest': {
      const f = Math.sin(ph) * 4;
      g.strokeStyle = '#e8462e'; g.lineWidth = 4; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-L * .15 + i * L * .15, s * h * .2); g.lineTo(-L * .22 + i * L * .15 + f * s, s * h * .52); g.stroke(); }
      g.fillStyle = '#ff5a3c'; g.beginPath(); g.ellipse(0, 0, L * .38, h * .3, 0, 0, TAU); g.fill();
      g.fillStyle = '#ff5a3c'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(L * .45, s * h * .3, L * .1, h * .08, s * .5, 0, TAU); g.fill(); }
      g.fillStyle = '#8a4a12'; g.fillRect(-L * .22, -h * .24, L * .44, h * .48);
      g.fillStyle = '#ffcf4a'; g.fillRect(-L * .22, -h * .05, L * .44, h * .1); g.fillRect(-L * .03, -h * .24, L * .06, h * .48);
      g.strokeStyle = '#ffcf4a'; g.lineWidth = 2; g.strokeRect(-L * .22, -h * .24, L * .44, h * .48);
      eye(g, L * .36, -h * .1, 4); eye(g, L * .36, h * .1, 4);
      break;
    }
    case 'kraken': {
      g.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const y0 = (i - 3.5) * h * .07; g.strokeStyle = i % 2 ? '#8a2fd6' : '#a74cf0'; g.lineWidth = 14 - Math.abs(i - 3.5) * 1.5;
        g.beginPath(); g.moveTo(-L * .05, y0);
        for (let u = 0; u <= 1; u += .1) g.lineTo(-L * .05 - u * L * .45, y0 * (1 + u * 1.6) + Math.sin(u * 6 + ph + i) * 14 * u);
        g.stroke();
      }
      const rg = g.createRadialGradient(L * .15, -h * .1, 5, L * .1, 0, h * .42); rg.addColorStop(0, '#e2a8ff'); rg.addColorStop(.6, '#9b3ff0'); rg.addColorStop(1, '#4a0f8a');
      g.fillStyle = rg; g.beginPath(); g.ellipse(L * .12, 0, L * .3, h * .36, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(L * (.05 + (i % 3) * .1), (i < 3 ? -1 : 1) * h * .18, 6, 0, TAU); g.fill(); }
      for (const s of [-1, 1]) { g.fillStyle = '#ffe14a'; g.beginPath(); g.ellipse(L * .3, s * h * .12, 13, 10, 0, 0, TAU); g.fill(); g.fillStyle = '#1a0030'; g.beginPath(); g.ellipse(L * .32, s * h * .12, 4, 8, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(-L * .02, -h * .3); for (let k = 0; k < 5; k++) { g.lineTo(L * (.0 + k * .05), -h * (k % 2 ? .3 : .44)); } g.lineTo(L * .22, -h * .3); g.fill();
      break;
    }
    case 'dragon': {
      serpent(g, L, h * 1.2, ph, '#1fbf8f', '#139a74', '#7dffd9', (x, y) => {
        g.fillStyle = '#21d39e'; g.beginPath(); g.moveTo(x + h * .9, y); g.quadraticCurveTo(x + h * .5, y - h * .55, x - h * .2, y - h * .4); g.lineTo(x - h * .2, y + h * .4); g.quadraticCurveTo(x + h * .5, y + h * .55, x + h * .9, y); g.fill();
        g.fillStyle = '#ffe14a'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x, y + s * h * .3); g.lineTo(x - h * .7, y + s * h * .75); g.lineTo(x + h * .1, y + s * h * .2); g.fill(); }
        g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + h * (.4 + i * .1), y + h * .1); g.lineTo(x + h * (.45 + i * .1), y + h * .25); g.lineTo(x + h * (.5 + i * .1), y + h * .1); g.fill(); }
        g.fillStyle = '#ff3d3d'; g.beginPath(); g.arc(x + h * .35, y - h * .15, h * .1, 0, TAU); g.fill();
      });
      break;
    }
  }
}
const SWIM = { jelly: 'pulse', bomb: 'bob', pebble: 'bob', chest: 'bob', kraken: 'pulse', eel: 'snake', dragon: 'snake', ray: 'flap', turtle: 'flap' };
function buildArtSprite(d) {
  const im = ART[d.id].img, ar = im.height / im.width, big = Math.max(d.len, d.h) * (d.boss ? 1.3 : d.special ? 1.25 : 1.22);
  const w = ar <= 1 ? big : big / ar, h = w * ar, mode = SWIM[d.id] || 'fish';
  const amp = mode === 'snake' ? h * .07 : mode === 'fish' ? h * .055 : 0;
  const cw = w * 1.34, chh = h * 1.5 + amp * 2, sc = K * DPR, N = d.boss ? 6 : 8, STR = 18, fr = [];
  const [grgb, gstr] = rarityGlow(d);
  for (let i = 0; i < N; i++) {
    const ph = i / N * TAU, c = off(cw * sc, chh * sc), g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.scale(sc, sc); g.imageSmoothingQuality = 'high';
    g.save(); g.scale(1, h / w); aura(g, w * .64, grgb, gstr * (d.glow ? 1 : .8)); g.restore();
    let sx = 1, sy = 1, rot = 0;
    if (mode === 'pulse') { sx = 1 - Math.sin(ph) * .04; sy = 1 + Math.sin(ph) * .06; }
    else if (mode === 'bob') { rot = Math.sin(ph) * .06; sy = 1 + Math.sin(ph * 2) * .025; }
    else if (mode === 'flap') { sy = 1 + Math.sin(ph) * .07; }
    else sy = 1 + Math.sin(ph * 2) * .018;  // breathing squash
    g.rotate(rot); g.scale(sx, sy);
    if (amp > 0) {  // sine-skew strip mesh: tail (left) swings most, head stays steady
      const sw = im.width / STR;
      for (let k = 0; k < STR; k++) {
        const u = (k + .5) / STR, wt = mode === 'snake' ? .35 + .65 * (1 - u) : Math.pow(1 - u, 1.7);
        const dy = Math.sin(ph - u * (mode === 'snake' ? 6 : 3.2)) * amp * wt;
        g.drawImage(im, k * sw, 0, sw + 1, im.height, -w / 2 + k * w / STR, -h / 2 + dy, w / STR + .6, h);
      }
    } else g.drawImage(im, -w / 2, -h / 2, w, h);
    fr.push(c);
  }
  // offscreen tinted copy for the hit flash (image only, no aura)
  const tint = off(cw * sc, chh * sc), tg = tint.getContext('2d');
  tg.translate(tint.width / 2, tint.height / 2); tg.scale(sc, sc); tg.drawImage(im, -w / 2, -h / 2, w, h);
  tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = 'rgba(255,250,235,.92)'; tg.fillRect(0, 0, tint.width, tint.height);
  return { fr, tint, w: cw * K, h: chh * K, art: true };
}
function buildOne(d) {
  if (artOk(d.id)) { try { sprites[d.id] = buildArtSprite(d); return; } catch (e) { /* fall through to procedural */ } }
  {
    const pad = d.glow || d.boss ? 1.85 : 1.62, sw = Math.max(d.len * (d.shape === 'sword' ? 1.8 : pad), d.h * pad), sh = Math.max(d.h * pad * 1.3, d.len * (d.shape === 'kraken' ? 1.05 : .24));
    const sc = K * DPR, fr = [];
    for (let i = 0; i < FRAMES; i++) {
      const c = off(sw * sc, sh * sc), g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2); g.scale(sc, sc);
      drawFish(g, d, i / FRAMES * TAU); fr.push(c);
    }
    sprites[d.id] = { fr, w: sw * K, h: sh * K };
  }
}
function buildSprites() {
  sprites = {};
  for (const d of E.FISH) buildOne(d);
}

/* ---------- entities ---------- */
let fish = [], bullets = [], nets = [], coins = [], floats = [], sparks = [], bolts = [], rings = [], bubbles = [];
let lockTarget = null, uid = 0;
const MAX_FISH = 42, MAX_BULLETS = 24, MAX_COINS = 90, MAX_SPARKS = 140, MAX_FLOATS = 18;

function bez(p, t, o) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  o.x = a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x; o.y = a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y; return o;
}
function makePath(margin, fromSide) {
  const side = fromSide != null ? fromSide : (rnd() < .5 ? 0 : 1);
  const top = H * .1, bot = H * .78;
  const y0 = top + rnd() * (bot - top), y3 = top + rnd() * (bot - top);
  const x0 = side === 0 ? -margin : W + margin, x3 = side === 0 ? W + margin : -margin;
  const p = [{ x: x0, y: y0 }, { x: W * (.2 + rnd() * .3) + (side ? W * .3 : 0), y: top + rnd() * (bot - top) }, { x: W * (.2 + rnd() * .3) + (side ? 0 : W * .3), y: top + rnd() * (bot - top) }, { x: x3, y: y3 }];
  let len = 0, prev = bez(p, 0, {}), q = {};
  for (let i = 1; i <= 24; i++) { bez(p, i / 24, q); len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = { x: q.x, y: q.y }; }
  return { p, len };
}
function spawnFish(def, opts) {
  if (fish.length >= MAX_FISH && !def.boss) return null;
  opts = opts || {};
  const path = opts.path || makePath(def.len * K * .8 + 20, opts.side);
  const f = { id: ++uid, def, mult: E.rollMult(def, rnd), path, t: opts.t0 || 0, off: (opts.off || 0) * K, spd: def.spd * (opts.spdMul || (.85 + rnd() * .3)), x: -9999, y: -9999, ang: 0, flip: false, ph: rnd() * TAU, dying: 0, flash: 0, alive: true, speedMul: 1 };
  bez(path.p, Math.max(0, f.t), f);
  fish.push(f); return f;
}
const table = E.spawnTable(), TW = table.reduce((a, f) => a + f.w, 0);
function pickDef() { let r = rnd() * TW; for (const f of table) { r -= f.w; if (r < 0) return f; } return table[0]; }
function spawnSchool(def, n, side, shape) {
  const path = makePath(def.len * K + 30, side), gap = (def.len * 1.25 * K) / path.len;
  for (let i = 0; i < n; i++) {
    let t0 = -i * gap, off = 0;
    if (shape === 'v') { t0 = -Math.ceil(i / 2) * gap; off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * def.h * 1.1; }
    if (shape === 'pair') { t0 = -Math.floor(i / 2) * gap; off = (i % 2 ? 1 : -1) * def.h * .8; }
    spawnFish(def, { path, t0, off, spdMul: 1 });
  }
}

/* ---------- director: spawns, bosses, tidal surge ---------- */
let gameT = 0, spawnCd = 0, bossCd = 35, tideCd = 80, surge = 0, quiet = 0;
function director(dt) {
  gameT += dt; spawnCd -= dt; bossCd -= dt; tideCd -= dt; if (quiet > 0) quiet -= dt;
  const live = fish.filter(f => f.alive && !f.def.boss).length;
  if (quiet <= 0 && spawnCd <= 0 && live < 26) {
    const d = pickDef();
    if (d.m <= 6 && !d.special && rnd() < .35) spawnSchool(d, 4 + (rnd() * 5 | 0), null, rnd() < .5 ? 'line' : (rnd() < .5 ? 'v' : 'pair'));
    else spawnFish(d);
    spawnCd = .35 + rnd() * .5;
  }
  if (bossCd <= 0 && quiet <= 0) {
    if (!fish.some(f => f.def.boss && f.alive)) {
      const d = rnd() < .6 ? E.BY_ID.kraken : E.BY_ID.dragon;
      const f = spawnFish(d, { spdMul: 1 });
      banner(`&#9888; ${d.name.toUpperCase()}`, `BOSS APPROACHING &middot; x${f.mult}`, 'boss'); Sfx.alarm();
    }
    bossCd = 55 + rnd() * 20;
  }
  if (tideCd <= 0) startSurge();
  if (surge > 0) {
    surge -= dt;
    if (surge <= 1.2 && surge + dt > 1.2) {
      const kinds = ['minnow', 'guppy', 'darter', 'tang', 'pebble'];
      for (let i = 0; i < 6; i++) spawnSchool(E.BY_ID[kinds[i % kinds.length]], 6 + (rnd() * 4 | 0), i % 2, ['line', 'v', 'pair'][i % 3]);
      spawnFish(E.BY_ID[['bomb', 'eel', 'chest'][rnd() * 3 | 0]]); spawnFish(E.BY_ID.koi); spawnFish(E.BY_ID.turtle);
    }
  }
}
function startSurge() {
  tideCd = 85 + rnd() * 25; surge = 3.2; quiet = 2.2;
  for (const f of fish) if (!f.def.boss) f.speedMul = 4.5;
  banner('TIDAL SURGE!', 'A GIANT SCHOOL IS COMING'); Sfx.alarm();
}

/* ---------- aiming + firing ---------- */
let firing = false, auto = false, lockMode = false, lastShot = 0, aimX = 0, aimY = 0, inputBlocked = false;
const FIRE_MS = 165;
function setAim(x, y) {
  aimX = x; aimY = y;
  let a = Math.atan2(y - cannon.y, x - cannon.x);
  if (a > 0) a = x < cannon.x ? -Math.PI + .12 : -.12;
  cannon.ang = clamp(a, -Math.PI + .12, -.12);
}
function bet() { return E.BETS[S.bi]; }
function fire(now) {
  if (inputBlocked) return;
  const b = bet();
  if (S.bal < b) { if (auto) toggleAuto(false); firing = false; toast('Not enough credits. Tap FREE for more.'); return; }
  if (bullets.length >= MAX_BULLETS) return;
  if (lockTarget && lockTarget.alive && onScreen(lockTarget)) setAim(lockTarget.x, lockTarget.y);
  credit(-b); stats.shots++; stats.wagered += b; addPlaythrough(b); T.shot(b);
  if (UG) { ugJp += b * 0.02; ugLoadShots++; ugIdle = 0; } else S.jp += b * E.JP_RATE;
  lastShot = now;
  const sp = 820 * K, bl = 46 * K, ca = Math.cos(cannon.ang), sa = Math.sin(cannon.ang);
  bullets.push({ x: cannon.x + ca * bl, y: cannon.y + sa * bl, vx: ca * sp, vy: sa * sp, bet: b, life: 0, bounces: 0, target: lockTarget && lockTarget.alive ? lockTarget : null });
  cannon.recoil = 1; Sfx.shot();
  if (UG) ugMaybeJackpot(b); else if (E.jpTrigger(b, rnd)) winJackpot();
}
function onScreen(f) { return f.x > 0 && f.x < W && f.y > 0 && f.y < H; }
function fishAt(x, y) {
  for (let i = fish.length - 1; i >= 0; i--) { const f = fish[i]; if (f.alive && f.t >= 0 && hitTest(f, x, y, 10 * K)) return f; }
  return null;
}
function hitTest(f, x, y, pad) {
  const dx = x - f.x, dy = y - f.y, c = Math.cos(-f.ang), s = Math.sin(-f.ang);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const a = f.def.len * K * (f.def.boss ? .42 : .46) + pad, b = f.def.h * K * (f.def.boss ? .38 : .42) + pad;
  return (lx * lx) / (a * a) + (ly * ly) / (b * b) <= 1;
}

/* ---------- hits, captures, specials ---------- */
function onHit(bu, f) {
  stats.hits++;
  nets.push({ x: bu.x, y: bu.y, t: 0, r: (26 + Math.min(3, S.bi * .4) * 6) * K });
  f.flash = .12; Sfx.net();
  let victims = [];
  if (f.def.special === 'bomb') victims = fish.filter(o => o !== f && o.alive && o.t >= 0 && !o.def.boss && !o.def.special && Math.hypot(o.x - f.x, o.y - f.y) < E.BOMB_RADIUS * K);
  if (f.def.special === 'chain') victims = fish.filter(o => o !== f && o.alive && o.t >= 0 && !o.def.boss && !o.def.special && onScreen(o)).map(o => [o, Math.hypot(o.x - f.x, o.y - f.y)]).filter(v => v[1] < E.CHAIN_RADIUS * K).sort((a, b) => a[1] - b[1]).slice(0, E.CHAIN_MAX).map(v => v[0]);
  const total = E.hitValue(f.def, f.mult, victims.map(v => v.mult));
  if (rnd() >= E.chance(total)) return;
  stats.caps++;
  if (f.def.special === 'wheel') { kill(f, 0, bu.bet); openWheel(bu.bet, f); return; }
  const pay = Math.round(total * bu.bet);
  credit(pay); stats.paid += pay; T.win(pay, f.def, f.mult);
  if (f.def.special === 'bomb') {
    rings.push({ x: f.x, y: f.y, t: 0, r: E.BOMB_RADIUS * K }); Sfx.boom(); shake(.45, 7);
    for (const v of victims) kill(v, v.mult * bu.bet, bu.bet, true);
    kill(f, Math.round(E.hitValue(f.def, f.mult, []) * bu.bet), bu.bet);
    floatText(f.x, f.y - 30 * K, '+' + fmt(pay), true);
  } else if (f.def.special === 'chain') {
    let px = f.x, py = f.y; Sfx.zap(); shake(.3, 4);
    for (const v of victims) { bolts.push({ pts: jag(px, py, v.x, v.y), t: 0 }); px = v.x; py = v.y; kill(v, v.mult * bu.bet, bu.bet, true); }
    kill(f, Math.round(E.hitValue(f.def, f.mult, []) * bu.bet), bu.bet);
    floatText(f.x, f.y - 30 * K, '+' + fmt(pay), true);
  } else {
    kill(f, pay, bu.bet, false, true);
    if (f.def.boss) { shake(.5, 8); Sfx.boom(); banner(`x${f.mult}!`, `${f.def.name.toUpperCase()} CAUGHT &middot; +${fmt(pay)}`); }
    if (f.mult >= 30) Sfx.big();
  }
}
function kill(f, pay, b, quietText, showText) {
  if (!f.alive) return;
  f.alive = false; f.dying = .6;
  if (lockTarget === f) lockTarget = null;
  const n = clamp(Math.round(2 + Math.sqrt(f.mult || 10) * 1.6), 3, 22);
  for (let i = 0; i < n && coins.length < MAX_COINS; i++) coins.push({ sx: f.x + (rnd() - .5) * 30 * K, sy: f.y + (rnd() - .5) * 20 * K, t: -i * .03, d: .7 + rnd() * .25, cx: f.x + (rnd() - .5) * 160 * K, cy: f.y - (40 + rnd() * 90) * K });
  for (let i = 0; i < 10 && sparks.length < MAX_SPARKS; i++) { const a = rnd() * TAU, s = (60 + rnd() * 160) * K; sparks.push({ x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, d: .5 + rnd() * .3 }); }
  if (pay > 0 && !quietText) {
    rings.push({ x: f.x, y: f.y, t: 0, r: (32 + Math.sqrt(f.mult || 8) * 9) * K, gold: true });
    if (f.def.boss || (f.mult || 0) >= 40) {
      rings.push({ x: f.x, y: f.y, t: 0, r: (74 + Math.min(260, (f.mult || 40))) * K, gold: true });
      for (let i = 0; i < 22 && sparks.length < MAX_SPARKS; i++) { const a = rnd() * TAU, sp = (120 + rnd() * 240) * K; sparks.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, d: .6 + rnd() * .4 }); }
      for (let i = 0; i < 16 && coins.length < MAX_COINS; i++) coins.push({ sx: f.x + (rnd() - .5) * 40 * K, sy: f.y + (rnd() - .5) * 30 * K, t: -i * .02, d: .8 + rnd() * .3, cx: f.x + (rnd() - .5) * 240 * K, cy: f.y - (60 + rnd() * 120) * K });
      shake(.4, 6);
    }
  }
  const fscale = clamp(1 + Math.log10((pay || 0) + 1) / 5, 1, 1.9);
  if (pay > 0 && (showText || !quietText)) floatText(f.x, f.y, '+' + fmt(pay), f.mult >= 30, false, fscale);
  else if (pay > 0) floatText(f.x, f.y, '+' + fmt(pay), false, true);
  if (pay > 0) Sfx.coin();
}
function floatText(x, y, s, big, small, scale) { if (floats.length >= MAX_FLOATS) floats.shift(); floats.push({ x, y, s, t: 0, big, small, scale: scale || 1 }); }
function jag(x1, y1, x2, y2) { const pts = [[x1, y1]], n = 7; for (let i = 1; i < n; i++) { const u = i / n; pts.push([x1 + (x2 - x1) * u + (rnd() - .5) * 26 * K, y1 + (y2 - y1) * u + (rnd() - .5) * 26 * K]); } pts.push([x2, y2]); return pts; }
let shakeT = 0, shakeA = 0;
function shake(t, a) { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; shakeT = Math.max(shakeT, t); shakeA = Math.max(shakeA, a) * K; }

/* ---------- bonus wheel ---------- */
const wheelCv = $('#wheel');
(function drawWheel() {
  const g = wheelCv.getContext('2d'), R = 290, n = E.WHEEL.length, cols = ['#ff3d8b', '#22c3ff', '#ffcf4a', '#7a5cff', '#2bd47a'];
  g.translate(300, 300);
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i - .5) * TAU / n, a1 = a0 + TAU / n;
    g.fillStyle = cols[i % cols.length]; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a1); g.fill();
    g.save(); g.rotate(-Math.PI / 2 + i * TAU / n + Math.PI / 2); g.fillStyle = '#fff'; g.font = '900 44px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(E.WHEEL[i].m + 'x', 0, -R + 70); g.restore();
  }
  g.lineWidth = 12; g.strokeStyle = '#ffcf4a'; g.beginPath(); g.arc(0, 0, R - 4, 0, TAU); g.stroke();
  g.fillStyle = '#062a5c'; g.beginPath(); g.arc(0, 0, 60, 0, TAU); g.fill(); g.fillStyle = '#ffcf4a'; g.font = '900 26px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BONUS', 0, 0);
})();
let wheelRot = 0, held = 0;
function openWheel(b, f) {
  const idx = E.wheelPick(rnd), seg = E.WHEEL[idx], pay = seg.m * b;
  credit(pay); stats.paid += pay; held += pay; T.win(pay, null, seg.m, 'wheel'); // credited now (safe on reload), shown when the wheel stops
  inputBlocked = true; firing = false;
  const m = $('#wheelM'); m.classList.add('open'); syncModalLayer(); $('#wres').textContent = 'BONUS WHEEL';
  const n = E.WHEEL.length, target = -idx * 360 / n;
  wheelCv.style.transition = 'none'; wheelCv.style.transform = `rotate(${wheelRot % 360}deg)`;
  void wheelCv.offsetWidth;
  wheelRot = (wheelRot - (wheelRot % 360)) + 360 * 5 + target + (rnd() - .5) * 360 / n * .6;
  wheelCv.style.transition = 'transform 3.2s cubic-bezier(.15,.85,.25,1)'; wheelCv.style.transform = `rotate(${wheelRot}deg)`;
  let ticks = 0; const tk = setInterval(() => { if (++ticks > 22) clearInterval(tk); Sfx.tick(); }, 120);
  setTimeout(() => {
    $('#wres').textContent = `${seg.m}x  +${fmt(pay)}`; Sfx.big(); held -= pay;
    floatText(f.x, f.y, '+' + fmt(pay), true); for (let i = 0; i < 16 && coins.length < MAX_COINS; i++) coins.push({ sx: W / 2, sy: H / 2, t: -i * .03, d: .8, cx: W / 2 + (rnd() - .5) * 200, cy: H * .3 });
    setTimeout(() => { closeM(m); }, 1300);
  }, 3300);
}

/* ---------- season welcome + rebuy (free play credits; no real payment) ---------- */
function openWelcome() {
  buildDailyWheel(); // warm canvas
  inputBlocked = true; firing = false;
  openM('#welcomeM');
}
function grantSeasonStart() {
  if (S.welcomed) return;
  S.bal = START; S.bonus = BONUS_C; S.pt = 0; S.welcomed = true; dirty = true; save();
  updatePtHud();
  try {
    const now = new Date();
    const key = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    localStorage.setItem('reefrumble.daily', JSON.stringify({ last: key, streak: 1 }));
  } catch (e) {}
  try { T.credit('deposit_credit', DEPOSIT_C); T.credit('bonus_credit', BONUS_C); } catch (e) {}
  toast('Season start: 100.00 deposit + 100.00 bonus');
}
function rebuyBonusFor(cents) {
  /* Highest tier met: ≥100 → +25, ≥50 → +10, ≥25 → +5 (cents). */
  if (cents >= 10000) return 2500;
  if (cents >= 5000) return 1000;
  if (cents >= 2500) return 500;
  return 0;
}
function doRebuy(cents) {
  cents = Math.floor(+cents || 0);
  if (cents < REBUY_MIN) { toast('Minimum rebuy is ' + fmt(REBUY_MIN) + ' credits'); return false; }
  if (cents > 5000000) { toast('Max rebuy 50,000.00 for the demo'); return false; }
  const bonus = rebuyBonusFor(cents);
  credit(cents + bonus);
  if (bonus > 0) {
    S.bonus = Math.floor(S.bonus || 0) + bonus;
    if (S.pt < ptNeed()) ptCompleteLogged = false; // new bonus raises requirement
  }
  dirty = true; save();
  try {
    T.credit('rebuy', cents);
    if (bonus > 0) T.credit('rebuy_bonus', bonus);
  } catch (e) {}
  ugMarkLoad(); // Underground: rebuys count as credit loads for biased jackpot
  Sfx.big();
  toast(bonus ? ('Rebuy +' + fmt(cents) + ' + ' + fmt(bonus) + ' bonus (play-through +' + fmt(bonus * 10) + ')') : ('Rebuy +' + fmt(cents) + ' credits'));
  updatePtHud();
  return true;
}

/* ---------- daily login bonus wheel (fun credits; once per local calendar day per phone) ---------- */
// [credits in cents, weight out of 200]. Base EV = 4.995 credits; streak multiplier x1.0..x1.6 (days 1-7).
const DAILY = [[100, 39], [200, 40], [300, 32], [400, 24], [500, 24], [800, 16], [1000, 12], [1500, 8], [2500, 4], [10000, 1]];
const DAILY_MULT = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6], DKEY = 'reefrumble.daily';
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function cryptoPick(total) {  // unbiased integer in [0,total) via rejection sampling
  const a = new Uint32Array(1), lim = Math.floor(4294967296 / total) * total;
  for (let i = 0; i < 20; i++) { (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : (a[0] = Math.random() * 4294967296); if (a[0] < lim) return a[0] % total; }
  return Math.floor(Math.random() * total);
}
let dState = null, dBuilt = false, dRot = 0;
function dailyState() {
  let st = {}; try { st = JSON.parse(localStorage.getItem(DKEY) || '{}') || {}; } catch (e) {}
  const now = new Date(), today = dayKey(now), y = new Date(now); y.setDate(now.getDate() - 1);
  const streak = st.last === dayKey(y) ? Math.min(7, (st.streak || 0) + 1) : 1;
  return { today, last: st.last, streak, due: st.last !== today };
}
function buildDailyWheel() {
  if (dBuilt) return; dBuilt = true;
  const cv = $('#dwheel'), g = cv.getContext('2d'), R = 286, n = DAILY.length, cols = [['#7a0f3a', '#d6336c'], ['#0b3d7a', '#2f8cff'], ['#5a2a8a', '#a35cff'], ['#0d5c45', '#24c48a']];
  g.translate(300, 300);
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i - .5) * TAU / n, a1 = a0 + TAU / n, rare = DAILY[i][0] >= 10000, c = rare ? ['#6a4300', '#ffcf4a'] : cols[i % 4];
    const gr = g.createRadialGradient(0, 0, 40, 0, 0, R); gr.addColorStop(0, c[1]); gr.addColorStop(1, c[0]);
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R - 26, a0, a1); g.closePath(); g.fill();
    g.save(); g.rotate(i * TAU / n); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${rare ? 40 : 36}px system-ui,sans-serif`; g.lineWidth = 6; g.strokeStyle = 'rgba(40,20,0,.75)'; g.fillStyle = rare ? '#fff6d0' : '#fff';
    const t = fmt(DAILY[i][0]); g.strokeText(t, 0, -R + 92); g.fillText(t, 0, -R + 92);
    if (rare) { g.font = '900 18px system-ui'; g.fillStyle = '#5a3200'; g.fillText('RARE', 0, -R + 128); }
    g.restore();
  }
  // gold dividers
  g.strokeStyle = '#ffd96a'; g.lineWidth = 4;
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - .5) * TAU / n; g.beginPath(); g.moveTo(Math.cos(a) * 58, Math.sin(a) * 58); g.lineTo(Math.cos(a) * (R - 26), Math.sin(a) * (R - 26)); g.stroke(); }
  // jeweled gold rim
  const rim = g.createLinearGradient(-R, -R, R, R); rim.addColorStop(0, '#fff2b0'); rim.addColorStop(.3, '#e0a52a'); rim.addColorStop(.55, '#7a4a0c'); rim.addColorStop(.8, '#ffd45a'); rim.addColorStop(1, '#a8680e');
  g.lineWidth = 30; g.strokeStyle = rim; g.beginPath(); g.arc(0, 0, R - 13, 0, TAU); g.stroke();
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,250,220,.9)'; g.beginPath(); g.arc(0, 0, R - 2, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(60,30,0,.8)'; g.beginPath(); g.arc(0, 0, R - 27, 0, TAU); g.stroke();
  const gems = ['gem_r', 'gem_b', 'gem_g', 'gem_p'];
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - .5) * TAU / n; gemAt(g, gems[i % 4], Math.cos(a) * (R - 13), Math.sin(a) * (R - 13), 26); }
  for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * TAU / n; g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(Math.cos(a) * (R - 13), Math.sin(a) * (R - 13), 3.2, 0, TAU); g.fill(); }
  // hub
  const hub = g.createRadialGradient(-14, -14, 4, 0, 0, 62); hub.addColorStop(0, '#fff4c0'); hub.addColorStop(.45, '#e3a82e'); hub.addColorStop(1, '#6e420a');
  g.fillStyle = hub; g.beginPath(); g.arc(0, 0, 60, 0, TAU); g.fill();
  g.lineWidth = 3; g.strokeStyle = '#fff1b8'; g.stroke();
  gemAt(g, 'gem_r', 0, 0, 58);
}
function dailyCheck() {
  dState = dailyState(); if (!dState.due || $('#dailyM').classList.contains('open')) return;
  buildDailyWheel();
  const m = DAILY_MULT[dState.streak - 1];
  $('#dStreak').innerHTML = Array.from({ length: 7 }, (_, i) => `<i class="${i < dState.streak ? 'on' : ''}">${i + 1}</i>`).join('');
  $('#dSub').textContent = `Day ${dState.streak} streak \u00b7 x${m.toFixed(1)} bonus. Come back tomorrow to grow it (max x1.6 on day 7).`;
  $('#dRes').textContent = 'DAILY BONUS'; $('#dSpin').disabled = false; $('#dSpin').textContent = 'SPIN';
  inputBlocked = true; firing = false; $('#dailyM').classList.add('open'); syncModalLayer();
}
function dailySpin() {
  if (!dState || !dState.due) return;
  const total = DAILY.reduce((a, s) => a + s[1], 0); let r = cryptoPick(total), idx = 0;
  while (r >= DAILY[idx][1]) r -= DAILY[idx++][1];
  const mult = DAILY_MULT[dState.streak - 1], pay = Math.round(DAILY[idx][0] * mult);
  try { localStorage.setItem(DKEY, JSON.stringify({ last: dState.today, streak: dState.streak })); } catch (e) {}
  dState.due = false; credit(pay); save(); T.credit('daily_bonus', pay); ugMarkLoad();  // credited at spin start (safe on reload)
  $('#dSpin').disabled = true; $('#dSpin').textContent = 'SPINNING\u2026';
  const n = DAILY.length, cv = $('#dwheel'), jit = ((cryptoPick(1000) / 1000) - .5) * 360 / n * .6;
  dRot = (dRot - (dRot % 360)) + 360 * 6 - idx * 360 / n + jit;
  cv.style.transition = 'transform 4.2s cubic-bezier(.12,.86,.2,1)'; cv.style.transform = `rotate(${dRot}deg)`;
  let ticks = 0; const tk = setInterval(() => { if (++ticks > 28) clearInterval(tk); Sfx.tick(); }, 130);
  setTimeout(() => {
    $('#dRes').textContent = `+${fmt(pay)} credits`; Sfx.big(); $('#dSpin').textContent = 'COLLECT'; $('#dSpin').disabled = false; $('#dSpin').dataset.done = '1';
    for (let i = 0; i < 18 && coins.length < MAX_COINS; i++) coins.push({ sx: W / 2, sy: H / 2, t: -i * .03, d: .8, cx: W / 2 + (rnd() - .5) * 220, cy: H * .28 });
    toast(`Daily bonus: +${fmt(pay)} credits${mult > 1 ? ` (x${mult.toFixed(1)} streak)` : ''}`);
  }, 4300);
}


/* ---------- Underground Mode (class-project demo of rigged tactics; off by default) ---------- */
const UG_KEY = 'reefrumble.underground';
let UG = false, ugJp = 25000, ugLoadShots = 9999, ugIdle = 0;
try { UG = localStorage.getItem(UG_KEY) === '1'; } catch (e) {}
const UG_STEPS = [
  ['Minimum cash-out (50)', 'Your balance is under the 50-credit floor. Keep playing until you clear it — or reload.'],
  ['Daily cap (300–500)', 'Only a slice can pay today. The rest is "queued" with no date.'],
  ['Play-through 1×–3×', 'You must wager your last load again before any withdrawal clears.'],
  ['"Verification" delay', 'ID / selfie / "source of funds" review — stalls the ticket for days.'],
  ['Agent-hours only', 'Payouts only when the agent is "online." Nights and weekends go dark.'],
  ['Freeze after big win', 'Account locked for "review" right after a jackpot or boss catch.'],
  ['Bonus voids withdrawal', 'Promo credits taint the balance. Cash-out is void until they clear.'],
  ['Slow-walk → redeposit', 'The agent delays until you reload more credits and keep playing.']
];
let ugCo = 0, ugCoDone = false;
function ugApply() {
  document.body.classList.toggle('ug', UG);
  const sw = $('#ugSw'), badge = $('#demoBadge');
  if (sw) { sw.classList.toggle('on', UG); sw.setAttribute('aria-pressed', UG ? 'true' : 'false'); }
  if (badge) badge.classList.toggle('on', UG);
  try { T.setMode && T.setMode(UG ? 'underground' : 'normal'); } catch (e) {}
  if (UG) { ugJp = Math.max(ugJp, Math.floor(S.jp) || 25000); lastJpTxt = ''; }
}
function ugMarkLoad() { ugLoadShots = 0; }
function ugMaybeJackpot(b) {
  const afterLoad = ugLoadShots < 40;
  const quitting = S.bal < START * 0.08 || S.bal < b * 3;
  const idleQuit = ugIdle > 25 && S.bal < START * 0.25;
  let p = 1 / 90000;
  if (afterLoad) p = 1 / 1800;
  else if (quitting || idleQuit) p = 1 / 1400;
  if (rnd() >= p) return false;
  const pay = Math.floor(ugJp * (0.35 + rnd() * 0.5));
  ugJp = Math.max(5000, ugJp - pay);
  credit(pay); stats.paid += pay; T.win(pay, null, 0, 'jackpot');
  $('#bigT').textContent = 'JACKPOT!'; $('#bigN').textContent = '+' + fmt(pay);
  $('#bigWin').classList.add('open'); syncModalLayer(); Sfx.jackpot(); shake(.55, 5);
  for (let i = 0; i < 28 && coins.length < MAX_COINS; i++) coins.push({ sx: rnd() * W, sy: -20, t: -i * .04, d: 1.05, cx: rnd() * W, cy: H * .55 });
  setTimeout(() => { $('#bigWin').classList.remove('open'); syncModalLayer(); }, 2800);
  toast('Demo jackpot (biased) +' + fmt(pay));
  return true;
}
function ugCashOpen() {
  ugCo = 0; ugCoDone = false; inputBlocked = true; firing = false;
  $('#coFill').style.width = (1 / (UG_STEPS.length + 1) * 100) + '%';
  $('#coStep').textContent = '1 / ' + UG_STEPS.length + ' · ' + UG_STEPS[0][0];
  $('#coDetail').textContent = UG_STEPS[0][1];
  $('#coNext').textContent = 'Continue'; openM('#cashM');
}
function cashOutOpen() {
  if (!ptReady()) {
    openM('#cashM');
    const need = ptNeed();
    $('#coFill').style.width = (Math.min(1, S.pt / Math.max(1, need)) * 100) + '%';
    $('#coStep').textContent = 'Locked · Play-through';
    $('#coDetail').textContent = 'Wager ' + fmt(need) + ' (10× your bonus balance of ' + fmt(S.bonus) + ') before pretend Cash Out unlocks. Progress: ' + fmt(S.pt) + ' / ' + fmt(need) + '. Fun credits only — no real payout.';
    $('#coNext').textContent = 'Got it';
    ugCoDone = true; // next tap just closes
    return;
  }
  try { T.credit('cashout_request', S.bal); } catch (e) {}
  if (UG) { ugCashOpen(); return; }
  /* Normal mode: demo "paid" result — no real money */
  ugCoDone = true;
  openM('#cashM');
  $('#coFill').style.width = '100%';
  $('#coStep').textContent = 'Demo result · Cleared';
  $('#coDetail').textContent = 'Play-through met. In this class demo your ' + fmt(S.bal) + ' credits would show as a pretend cash-out. Reef Rumble never pays real money — credits have no cash value.';
  $('#coNext').textContent = 'Got it';
}
function ugCashNext() {
  if (ugCoDone) { closeM($('#cashM')); inputBlocked = false; return; }
  ugCo++;
  if (ugCo >= UG_STEPS.length) {
    ugCoDone = true;
    $('#coStep').textContent = 'Result · Never paid';
    $('#coDetail').textContent = 'In this demo the cash-out never completes. Unlicensed apps use these stalls so winners keep reloading. Reef Rumble has no real cash-out — credits are fun only.';
    $('#coFill').style.width = '100%';
    $('#coNext').textContent = 'Got it';
    return;
  }
  const st = UG_STEPS[ugCo];
  $('#coStep').textContent = (ugCo + 1) + ' / ' + UG_STEPS.length + ' · ' + st[0];
  $('#coDetail').textContent = st[1];
  $('#coFill').style.width = ((ugCo + 1) / (UG_STEPS.length + 1) * 100) + '%';
}

/* ---------- jackpot ---------- */
function winJackpot() {
  const w = Math.floor(S.jp); S.jp = E.JP_SEED; credit(w); stats.paid += w; T.win(w, null, 0, 'jackpot');
  $('#bigT').textContent = 'JACKPOT!'; $('#bigN').textContent = '+' + fmt(w);
  $('#bigWin').classList.add('open'); syncModalLayer(); Sfx.jackpot(); shake(.6, 6);
  for (let i = 0; i < 40 && coins.length < MAX_COINS; i++) coins.push({ sx: rnd() * W, sy: -20, t: -i * .04, d: 1.1, cx: rnd() * W, cy: H * .6 });
  setTimeout(() => { $('#bigWin').classList.remove('open'); syncModalLayer(); }, 3200);
}

/* ---------- update + render ---------- */
const tmp = {};
function update(dt, now) {
  if (UG) { ugIdle += dt; ugJp += dt * 1.2; } // display meter idle climb
  director(dt);
  if ((firing || auto) && now - lastShot >= FIRE_MS && !inputBlocked) fire(now);
  if (lockTarget && (!lockTarget.alive || lockTarget.t > 1)) lockTarget = null;
  if (lockTarget && (auto || firing)) setAim(lockTarget.x, lockTarget.y);
  cannon.recoil = Math.max(0, cannon.recoil - dt * 6);
  for (const f of fish) {
    f.ph += dt * (f.def.boss ? 3 : 7);
    if (!f.alive) { f.dying -= dt; continue; }
    if (f.flash > 0) f.flash -= dt;
    const px = f.x, py = f.y;
    f.t += f.spd * f.speedMul * K * dt / f.path.len;
    if (f.t < 0) continue;
    bez(f.path.p, Math.min(1, f.t), tmp);
    const dx = tmp.x - px, dy = tmp.y - py;
    if (px > -9000 && (dx || dy)) {
      const a = Math.atan2(dy, dx); let da = a - f.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      f.ang += da * Math.min(1, dt * 8);
      if (f.off) { const nx = -Math.sin(f.ang), ny = Math.cos(f.ang); tmp.x += nx * f.off; tmp.y += ny * f.off; }
    } else if (px <= -9000) f.ang = Math.atan2(f.path.p[1].y - f.path.p[0].y, f.path.p[1].x - f.path.p[0].x);
    f.x = tmp.x; f.y = tmp.y;
  }
  fish = fish.filter(f => (f.alive && f.t <= 1) || (!f.alive && f.dying > 0));
  for (const b of bullets) {
    b.life += dt;
    if (b.target && b.target.alive && b.target.t >= 0) { const a = Math.atan2(b.target.y - b.y, b.target.x - b.x), sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; }
    else b.target = null;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < 0) { b.x = -b.x; b.vx = -b.vx; b.bounces++; } else if (b.x > W) { b.x = 2 * W - b.x; b.vx = -b.vx; b.bounces++; }
    if (b.y < 0) { b.y = -b.y; b.vy = -b.vy; b.bounces++; } else if (b.y > H) { b.y = 2 * H - b.y; b.vy = -b.vy; b.bounces++; }
    if (b.target) { if (hitTest(b.target, b.x, b.y, 4 * K)) { onHit(b, b.target); b.dead = true; } }
    else for (let i = fish.length - 1; i >= 0; i--) { const f = fish[i]; if (f.alive && f.t >= 0 && hitTest(f, b.x, b.y, 4 * K)) { onHit(b, f); b.dead = true; break; } }
    if (!b.dead && (b.life > 7 || b.bounces > 14)) { b.dead = true; credit(b.bet); stats.refunds += b.bet; } // unused shots refunded
  }
  bullets = bullets.filter(b => !b.dead);
  for (const n of nets) n.t += dt; nets = nets.filter(n => n.t < .45);
  for (const r of rings) r.t += dt; rings = rings.filter(r => r.t < .6);
  for (const b of bolts) b.t += dt; bolts = bolts.filter(b => b.t < .4);
  for (const s of sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= .96; s.vy *= .96; } sparks = sparks.filter(s => s.t < s.d);
  for (const f of floats) f.t += dt; floats = floats.filter(f => f.t < 1.2);
  let arrived = false;
  for (const c of coins) { c.t += dt; if (c.t >= c.d && !c.done) { c.done = true; arrived = true; } } coins = coins.filter(c => !c.done);
  if (arrived) pulseBal();
  if (bubbles.length < 26 && rnd() < dt * 8) bubbles.push({ x: rnd() * W, y: H + 10, r: (1.5 + rnd() * 3.5) * K, s: (25 + rnd() * 40) * K, w: rnd() * TAU });
  for (const b of bubbles) { b.y -= b.s * dt; b.w += dt * 2; } bubbles = bubbles.filter(b => b.y > -10);
}

function render(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bg, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // drifting light shimmer
  ctx.globalAlpha = .06 + Math.sin(now * .0007) * .03; ctx.fillStyle = '#bff3ff';
  for (let i = 0; i < 3; i++) { const x = ((now * .012 * (i + 1)) % (W + 300)) - 150; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 0); ctx.lineTo(x + 220, H * .75); ctx.lineTo(x + 120, H * .75); ctx.fill(); }
  ctx.globalAlpha = 1;
  // distant parallax silhouettes
  for (const d of deepFish) { d.x += d.spd * .016; if (d.x > W + 80) d.x = -80; ctx.save(); ctx.globalAlpha = .14; ctx.fillStyle = '#06294d'; ctx.translate(d.x, d.y + Math.sin(now * .0006 + d.ph) * 8); ctx.scale(d.s, d.s); ctx.beginPath(); ctx.ellipse(0, 0, 26, 10, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-40, -9); ctx.lineTo(-40, 9); ctx.closePath(); ctx.fill(); ctx.restore(); }
  ctx.globalAlpha = 1;
  // animated caustics over the water column
  if (causticsSpr) { const drift = (now * .004) % 36; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .34 + Math.sin(now * .0011) * .13; ctx.drawImage(causticsSpr, Math.sin(now * .0004) * 18, H * .38 - drift, W, H * .62); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  ctx.fillStyle = 'rgba(200,245,255,.35)';
  for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x + Math.sin(b.w) * 4, b.y, b.r, 0, TAU); ctx.fill(); }
  // surge wave
  if (surge > 1.2) { const u = 1 - (surge - 1.2) / 2, x = W * (1.1 - u * 1.4); const g = ctx.createLinearGradient(x - 120, 0, x + 60, 0); g.addColorStop(0, 'rgba(160,240,255,0)'); g.addColorStop(.7, 'rgba(160,240,255,.28)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - 120, 0, 180, H); }
  // fish
  for (const f of fish) {
    if (f.t < 0 || f.x < -9000) continue;
    const sp = sprites[f.def.id]; if (!sp) continue;
    const NF = sp.fr.length, fr = sp.fr[((f.ph / TAU * NF) % NF + NF) % NF | 0];
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
    if (Math.cos(f.ang) < 0 && f.def.shape !== 'bomb') ctx.scale(1, -1);
    if (!f.alive) { const u = 1 - f.dying / .6; ctx.rotate(u * 6); ctx.globalAlpha = Math.max(0, 1 - u); ctx.scale(1 + u * .3, 1 + u * .3); }
    ctx.drawImage(fr, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    if (f.flash > 0) { if (sp.tint) { ctx.globalAlpha = Math.min(1, f.flash / .12) * .75; ctx.drawImage(sp.tint, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.globalAlpha = 1; } else { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .45; ctx.drawImage(fr, -sp.w / 2, -sp.h / 2, sp.w, sp.h); ctx.globalCompositeOperation = 'source-over'; } }
    ctx.restore();
    if (f.alive && f.def.boss) {
      const pw = 128 * K, ph2 = 28 * K, py = Math.max(f.y - f.def.h * K * .6 - 10 * K, 96 * K);
      ctx.save(); ctx.globalAlpha = f.flash > 0 ? 1 : .92;
      rrPath(ctx, f.x - pw / 2, py - ph2, pw, ph2, 7 * K); ctx.fillStyle = 'rgba(8,16,34,.8)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,210,90,.7)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#ffe14a'; ctx.font = `900 ${Math.round(11 * K)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.def.name.toUpperCase() + '  x' + f.mult, f.x, py - ph2 * .64);
      const bx = f.x - pw / 2 + 7 * K, bw = pw - 14 * K, by = py - ph2 * .34;
      ctx.fillStyle = 'rgba(255,255,255,.16)'; rrPath(ctx, bx, by, bw, 4.5 * K, 2 * K); ctx.fill();
      const frac = .55 + .45 * Math.sin(now * .004 + f.x); const bg = ctx.createLinearGradient(bx, 0, bx + bw, 0); bg.addColorStop(0, '#ff5f7e'); bg.addColorStop(1, '#ffb33c');
      ctx.fillStyle = bg; rrPath(ctx, bx, by, bw * frac, 4.5 * K, 2 * K); ctx.fill(); ctx.restore();
    } else if (f.alive && f.def.special) {
      const label = f.def.special === 'wheel' ? 'BONUS' : f.def.special === 'bomb' ? 'BOMB' : 'CHAIN';
      ctx.font = `900 ${Math.round(11 * K)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = f.y - f.def.h * K * .7 - 6;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,10,30,.8)'; ctx.strokeText(label, f.x, y); ctx.fillStyle = '#fff'; ctx.fillText(label, f.x, y);
    }
  }
  if (lockTarget && lockTarget.alive) {
    const r = Math.max(lockTarget.def.len, lockTarget.def.h) * K * .45 + 8, a = now * .004;
    ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 2.5; ctx.save(); ctx.translate(lockTarget.x, lockTarget.y); ctx.rotate(a);
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, r, i * Math.PI / 2 + .2, i * Math.PI / 2 + 1.2); ctx.stroke(); }
    ctx.restore();
    ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(255,77,109,.45)'; ctx.beginPath(); ctx.moveTo(cannon.x, cannon.y); ctx.lineTo(lockTarget.x, lockTarget.y); ctx.stroke(); ctx.setLineDash([]);
  }
  // bullets
  const bs = 26 * K;
  for (const b of bullets) {
    const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp, tl = 36 * K;
    const tg = ctx.createLinearGradient(b.x, b.y, b.x - ux * tl, b.y - uy * tl);
    tg.addColorStop(0, 'rgba(175,250,255,.7)'); tg.addColorStop(1, 'rgba(60,200,255,0)');
    ctx.strokeStyle = tg; ctx.lineWidth = 7 * K; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - ux * tl, b.y - uy * tl); ctx.stroke();
    ctx.drawImage(bulletSpr, b.x - bs / 2, b.y - bs / 2, bs, bs);
  }
  // nets
  for (const n of nets) {
    const u = n.t / .45, r = n.r * Math.min(1, u * 2.2);
    ctx.globalAlpha = 1 - u; ctx.strokeStyle = '#d8fbff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(n.x, n.y, r * .55, 0, TAU); ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.moveTo(n.x, n.y); ctx.lineTo(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r); } ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const r of rings) { const u = r.t / .6; ctx.globalAlpha = 1 - u; const gold = r.gold; ctx.fillStyle = gold ? 'rgba(255,210,90,.28)' : 'rgba(255,140,60,.35)'; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * u, 0, TAU); ctx.fill(); ctx.strokeStyle = gold ? '#ffe14a' : '#ffd24a'; ctx.lineWidth = gold ? 4 : 5; ctx.stroke(); ctx.globalAlpha = 1; }
  for (const b of bolts) { ctx.globalAlpha = 1 - b.t / .4; ctx.strokeStyle = '#fff59a'; ctx.lineWidth = 3.5; ctx.beginPath(); b.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.fillStyle = '#ffe48a';
  for (const s of sparks) { ctx.globalAlpha = 1 - s.t / s.d; ctx.fillRect(s.x - 2, s.y - 2, 4, 4); } ctx.globalAlpha = 1;
  drawCannon();
  // coins flying to the balance
  const cs = 16 * K;
  for (const c of coins) {
    if (c.t < 0) continue; const u = Math.min(1, c.t / c.d), e = u * u, iu = 1 - e;
    const x = iu * iu * c.sx + 2 * iu * e * c.cx + e * e * balTarget.x, y = iu * iu * c.sy + 2 * iu * e * c.cy + e * e * balTarget.y;
    const gi = ((c.cx * 13) | 0) & 7, gem = gi < 2 && GEMS[(c.cy | 0) & 3];
    if (gem && gem.ok) { const gs = cs * 1.05; ctx.save(); ctx.translate(x, y); ctx.rotate(c.t * 6 + c.sx); ctx.drawImage(gem.img, -gs / 2, -gs / 2, gs, gs); ctx.restore(); }
    else { const sx2 = Math.abs(Math.cos(c.t * 10 + c.sx)); ctx.drawImage(coinSpr, x - cs * sx2 / 2, y - cs / 2, cs * sx2, cs); }
  }
  // floating amounts
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of floats) {
    const u = f.t / 1.2, sz = (f.big ? 30 : f.small ? 14 : 20) * K * (f.scale || 1) * (u < .15 ? .6 + u / .15 * .4 : 1);
    ctx.globalAlpha = u > .7 ? (1 - u) / .3 : 1; ctx.font = `900 ${Math.round(sz)}px ui-monospace,Menlo,Consolas,monospace`;
    const y = f.y - u * 50 * K; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(60,30,0,.85)'; ctx.strokeText(f.s, f.x, y); ctx.fillStyle = f.big ? '#ffe14a' : '#fff6c8'; ctx.fillText(f.s, f.x, y);
  }
  // boss red-alert pulse
  if (fish.some(f => f.alive && f.def.boss)) { ctx.globalAlpha = .1 + .07 * Math.sin(now * .006); const rv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .7); rv.addColorStop(0, 'rgba(255,40,60,0)'); rv.addColorStop(1, 'rgba(255,30,60,.9)'); ctx.fillStyle = rv; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  ctx.globalAlpha = 1;
  // cabinet bezel + ghost seats (crisp, device-res)
  if (frameSpr) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(frameSpr, 0, 0); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  if (frameSpr) frameShimmer(now);
}
function drawCannon() {
  const k = K, x = cannon.x, y = cannon.y, tier = S.bi < 3 ? 1 : S.bi < 6 ? 2 : 3;
  const cols = [['#5ad1ff', '#1b6fb0'], ['#ffd24a', '#c07a00'], ['#ff5fa2', '#a0104a']][tier - 1];
  const pg = ctx.createLinearGradient(x, y - 10 * k, x, y + 34 * k); pg.addColorStop(0, '#16324e'); pg.addColorStop(1, '#071a2e');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y + 16 * k, 48 * k, 16 * k, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(120,200,255,.4)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.globalAlpha = .45 + .2 * Math.sin(performance.now() * .005); ctx.strokeStyle = cols[0]; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.arc(x, y, 32 * k, Math.PI, 0); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(x, y); ctx.rotate(cannon.ang + Math.PI / 2);
  const rec = cannon.recoil * 6 * k;
  const useArt = artOk('cannon');
  if (useArt) {
    const im = ART.cannon.img, ch = (86 + tier * 8) * k, cw = ch * im.width / im.height;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35 + tier * .12; const gl = ctx.createRadialGradient(0, -ch * .3, 0, 0, -ch * .3, ch * .62); gl.addColorStop(0, cols[0]); gl.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gl; ctx.fillRect(-ch, -ch, ch * 2, ch * 1.4); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (tier === 3) for (const sd of [-1, 1]) { ctx.save(); ctx.translate(sd * cw * .46, ch * .02); ctx.rotate(sd * .16); ctx.drawImage(im, -cw * .3, -ch * .6 * .72 + rec * .6, cw * .6, ch * .6); ctx.restore(); }
    ctx.drawImage(im, -cw / 2, -ch * .72 + rec, cw, ch);
  }
  for (let i = 0; i < (useArt ? 0 : tier); i++) {
    const ox = (i - (tier - 1) / 2) * 11 * k, g = ctx.createLinearGradient(ox - 6 * k, 0, ox + 6 * k, 0);
    g.addColorStop(0, cols[1]); g.addColorStop(.5, cols[0]); g.addColorStop(1, cols[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(ox - 6 * k, -46 * k + rec, 12 * k, 40 * k, 4 * k) : ctx.rect(ox - 6 * k, -46 * k + rec, 12 * k, 40 * k); ctx.fill();
    ctx.fillStyle = '#e9fbff'; ctx.fillRect(ox - 7 * k, -48 * k + rec, 14 * k, 5 * k);
  }
  if (cannon.recoil > .5) { const fl = (cannon.recoil - .5) / .5; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fl; const fg = ctx.createRadialGradient(0, -54 * k, 0, 0, -54 * k, 24 * k * (.7 + fl * .5)); fg.addColorStop(0, '#ffffff'); fg.addColorStop(.35, '#bfefff'); fg.addColorStop(1, 'rgba(90,210,255,0)'); ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, -54 * k, 24 * k * (.7 + fl * .5), 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,' + fl + ')'; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * .4; ctx.save(); ctx.translate(0, -50 * k); ctx.rotate(a); ctx.fillRect(-1.5 * k, 0, 3 * k, -18 * k * fl); ctx.restore(); } ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  ctx.restore();
  if (artOk('cannon')) { rrPath(ctx, x - 17 * k, y + 13 * k, 34 * k, 14 * k, 7 * k); ctx.fillStyle = 'rgba(6,14,30,.85)'; ctx.fill(); ctx.strokeStyle = cols[0]; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#ffe14a'; ctx.font = `900 ${Math.round(10 * k)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('LV' + (S.bi + 1), x, y + 20.5 * k); ctx.textBaseline = 'alphabetic'; return; }
  const g = ctx.createRadialGradient(x, y - 6 * k, 2, x, y, 30 * k); g.addColorStop(0, '#e9fbff'); g.addColorStop(.4, cols[0]); g.addColorStop(1, cols[1]);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 24 * k, Math.PI, 0); ctx.lineTo(x + 30 * k, y + 20 * k); ctx.lineTo(x - 30 * k, y + 20 * k); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 24 * k, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#031a3a'; ctx.font = `900 ${Math.round(10 * k)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('LV' + (S.bi + 1), x, y + 6 * k);
}

/* ---------- HUD ---------- */
const balEl = $('#bal'), jpEl = $('#jp'), betEl = $('#bet');
let dispBal = S.bal, dispJp = S.jp, lastBalTxt = '', lastJpTxt = '';
function hud(dt) {
  const tgt = S.bal - held;
  dispBal += (tgt - dispBal) * Math.min(1, dt * (tgt > dispBal ? 6 : 20)); if (Math.abs(tgt - dispBal) < 1) dispBal = tgt;
  const bt = fmt(Math.round(dispBal)); if (bt !== lastBalTxt) { balEl.textContent = bt; lastBalTxt = bt; }
  const jpTarget = UG ? ugJp : S.jp;
  dispJp += (jpTarget - dispJp) * Math.min(1, dt * 4); if (jpTarget < dispJp) dispJp = jpTarget;
  const jt = fmt(dispJp); if (jt !== lastJpTxt) { jpEl.textContent = jt; lastJpTxt = jt; }
}
let pulseT = 0;
function pulseBal() { const p = $('#balPill'); if (pulseT) return; p.style.transform = 'scale(1.08)'; pulseT = setTimeout(() => { p.style.transform = ''; pulseT = 0; }, 120); }
$('#balPill').style.transition = 'transform .12s';
function showBet() { betEl.textContent = fmt(bet()); dirty = true; }
let bannerT = 0;
function banner(t, sub, cls) { const b = $('#banner'); b.innerHTML = `${t}${sub ? `<small>${sub}</small>` : ''}`; b.classList.toggle('boss', cls === 'boss'); b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), 2200); }
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2000); }

/* ---------- loop ---------- */
let last = performance.now(), running = true, frames = 0;
function loop(now) {
  if (!running) return;
  const dt = Math.min(.05, (now - last) / 1000); last = now; frames++;
  update(dt, now); render(now); hud(dt);
  if (shakeT > 0) { shakeT -= dt; wrap.style.transform = shakeT > 0 ? `translate3d(${(rnd() - .5) * shakeA}px,${(rnd() - .5) * shakeA}px,0)` : ''; if (shakeT <= 0) shakeA = 0; }
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { running = false; firing = false; save(); }
  else if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
});

/* ---------- input ---------- */
const pt = e => ({ x: e.clientX, y: e.clientY });
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); Sfx.init();
  if (inputBlocked) return;
  const p = pt(e);
  if (lockMode) { const f = fishAt(p.x, p.y); if (f) { lockTarget = f; setAim(f.x, f.y); firing = true; fire(performance.now()); return; } }
  setAim(p.x, p.y); firing = true;
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  if (performance.now() - lastShot >= FIRE_MS) fire(performance.now());
});
cv.addEventListener('pointermove', e => { if (firing && !lockTarget) { const p = pt(e); setAim(p.x, p.y); } });
const stop = () => { firing = false; };
cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop); cv.addEventListener('lostpointercapture', stop);
['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (!e.target.closest('.sheet')) e.preventDefault(); }, { passive: false });

function toggleAuto(v) { auto = v == null ? !auto : v; $('#autoBtn').classList.toggle('on', auto); }
function toggleLock() { lockMode = !lockMode; if (!lockMode) lockTarget = null; $('#lockBtn').classList.toggle('on', lockMode); toast(lockMode ? 'Lock on: tap a fish to target it' : 'Lock off'); }
const tap = (id, fn) => $(id).addEventListener('click', e => { Sfx.init(); fn(e); });
tap('#betUp', () => { if (S.bi < E.BETS.length - 1) { S.bi++; showBet(); Sfx.tick(); } });
tap('#betDn', () => { if (S.bi > 0) { S.bi--; showBet(); Sfx.tick(); } });
tap('#maxBtn', () => { S.bi = E.BETS.length - 1; showBet(); Sfx.tick(); });
tap('#autoBtn', () => toggleAuto());
tap('#lockBtn', toggleLock);
tap('#muteBtn', () => { S.mute = !S.mute; dirty = true; syncMute(); });
function syncMute() { $('#sndOn').style.display = S.mute ? 'none' : ''; $('#sndOff').style.display = S.mute ? '' : 'none'; }
tap('#freeBtn', () => {
  const left = S.lastFree + FREE_CD - Date.now();
  if (left > 0 && S.lastFree <= Date.now()) { toast(`Next free credits in ${Math.ceil(left / 1000)}s`); return; }
  S.lastFree = Date.now(); credit(FREE_AMT); save(); Sfx.big(); T.credit('refill', FREE_AMT); ugMarkLoad();
  for (let i = 0; i < 18 && coins.length < MAX_COINS; i++) coins.push({ sx: W / 2 + (rnd() - .5) * 80, sy: H / 2, t: -i * .03, d: .8, cx: W / 2 + (rnd() - .5) * 240, cy: H * .25 });
  toast(`+${fmt(FREE_AMT)} free play credits`);
});

/* store (demo checkout only, no payments) */
const PACKS = [
  { c: 100000, price: '$4.99' }, { c: 250000, price: '$9.99', tag: 'POPULAR' },
  { c: 750000, bonus: 750000, price: '$19.99', tag: 'DOUBLE CREDITS' }, { c: 2000000, price: '$49.99', tag: 'BEST VALUE' }
];
$('#packs').innerHTML = PACKS.map((p, i) => `<div class="pack">${p.tag ? `<span class="tag">${p.tag}</span>` : ''}<div class="amt">${fmt(p.c)}<small>CREDITS</small></div>${p.bonus ? `<em>+ ${fmt(p.bonus)} BONUS FREE</em>` : '<em>&nbsp;</em>'}<button class="buy" data-pack="${i}">${p.price}</button></div>`).join('');
let ckPack = null;
tap('#dSpin', () => { if ($('#dSpin').dataset.done) { delete $('#dSpin').dataset.done; closeM($('#dailyM')); } else dailySpin(); });
addEventListener('visibilitychange', () => { if (!document.hidden && dBuilt !== null) setTimeout(dailyCheck, 400); });  // new day while the app stays open
const syncModalLayer = () => {
  const any = !!document.querySelector('.modal.open, .big.open');
  wrap.classList.toggle('modalOpen', any);
  if (any) { firing = false; auto = false; }
};
const openM = id => { $(id).classList.add('open'); firing = false; inputBlocked = true; syncModalLayer(); };
const closeM = el => { el.classList.remove('open'); if (!document.querySelector('.modal.open')) inputBlocked = false; syncModalLayer(); };
tap('#storeBtn', () => openM('#storeM'));
$('#packs').addEventListener('click', e => { const b = e.target.closest('[data-pack]'); if (!b) return; ckPack = PACKS[+b.dataset.pack]; $('#ckItem').textContent = `${fmt(ckPack.c)} credits${ckPack.bonus ? ` + ${fmt(ckPack.bonus)} BONUS` : ''}`; $('#ckPrice').textContent = ckPack.price + ' (demo)'; openM('#ckM'); });
tap('#ckOk', () => { if (!ckPack) return; const amt = ckPack.c + (ckPack.bonus || 0); credit(amt); save(); T.credit('purchase', amt); ugMarkLoad(); ckPack = null; closeM($('#ckM')); closeM($('#storeM')); Sfx.big(); toast(`+${fmt(amt)} credits (demo purchase, no charge)`); });
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if ((e.target === m && m.id !== 'wheelM' && m.id !== 'dailyM' && m.id !== 'welcomeM') || e.target.closest('[data-close]')) closeM(m); }));
tap('#infoBtn', () => {
  if (!$('#pay').childElementCount) {
    $('#pay').innerHTML = E.FISH.map(d => { const sp = sprites[d.id]; const src = sp ? sp.fr[0].toDataURL() : ''; const m = Array.isArray(d.m) ? `${d.m[0]}-${d.m[1]}x` : d.special === 'wheel' ? 'WHEEL' : d.special ? `${d.m}x+` : `${d.m}x`; return `<div><img src="${src}" alt=""><span><b>${m}</b>${d.name}</span></div>`; }).join('');
  }
  openM('#infoM');
});

/* ---------- boot ---------- */
addEventListener('resize', () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 120); });
resize(); showBet(); syncMute(); preloadArt();
if ($('#pidTxt')) $('#pidTxt').textContent = T.short || 'offline';
ugApply();
syncRtpPeriod(true);
updatePtHud();
tap('#ugSw', () => { UG = !UG; try { localStorage.setItem(UG_KEY, UG ? '1' : '0'); } catch (e) {} ugApply(); toast(UG ? 'Underground Mode ON — demo of rigged tactics' : 'Underground Mode OFF — normal play'); });
let tipT = 0;
tap('#demoBadge', () => { const t = $('#demoTip'); if (!t) return; t.classList.add('on'); clearTimeout(tipT); tipT = setTimeout(() => t.classList.remove('on'), 2200); });
tap('#cashBtn', cashOutOpen);
tap('#coNext', ugCashNext);
tap('#coQuit', () => { closeM($('#cashM')); toast('Cash-out abandoned (demo)'); });
tap('#wStart', () => { grantSeasonStart(); closeM($('#welcomeM')); /* daily claimed for today with season start */ });
tap('#royaleBtn', () => { location.href = 'royale.html?v=royale1'; });
tap('#rebuyBtn', () => { $('#rebuyCustom').value = ''; openM('#rebuyM'); });
/* Coral Clash rewards are written to SKEY by royale.js; toast on return (does not add play-through). */
try {
  const rr = JSON.parse(localStorage.getItem('reefrumble.royalePending') || 'null');
  if (rr && rr.t && Date.now() - rr.t < 120000) {
    localStorage.removeItem('reefrumble.royalePending');
    if (rr.cents > 0) {
      /* bal already updated in SKEY — reload into S */
      try {
        const o = JSON.parse(localStorage.getItem(SKEY) || 'null');
        if (o && Number.isFinite(o.bal)) S.bal = Math.floor(o.bal);
      } catch (e) {}
      toast('Coral Clash: #' + (rr.place || '?') + ' · +' + fmt(rr.cents) + ' credits (' + (rr.kills || 0) + ' kills)');
    } else if (rr.place) toast('Coral Clash: #' + rr.place + ' · no reward');
  }
} catch (e) {}
document.getElementById('rebuyPresets') && document.getElementById('rebuyPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-rebuy]'); if (!b) return;
  if (doRebuy(+b.dataset.rebuy)) closeM($('#rebuyM'));
});
tap('#rebuyGo', () => {
  const v = Math.round(parseFloat($('#rebuyCustom').value || '0') * 100);
  if (doRebuy(v)) closeM($('#rebuyM'));
});

try { T.start({ start: START, bal: () => S.bal, setBal: v => { const d = v - S.bal; credit(d); save(); if (d > 0) ugMarkLoad(); toast('Balance updated by admin: ' + fmt(S.bal) + ' credits'); } }); } catch (e) {}
/* If season already welcomed but page reloaded mid-session without preload path, keep HUD honest */
if (S.welcomed && freshSeason) { /* granted on wStart */ }

setAim(W / 2, H * .4);
for (let i = 0; i < 12; i++) { const f = spawnFish(pickDef()); if (f) { f.t = .1 + rnd() * .6; bez(f.path.p, f.t, f); } }
requestAnimationFrame(loop);
window.__reef = { S, stats, E, SEASON, SEASON_START, SEASON_WEEK1_END, DEPOSIT_C, BONUS_C, ptNeed, get PT_NEED() { return ptNeed(); }, ptReady, addPlaythrough, doRebuy, rebuyBonusFor, updatePtHud, cashOutOpen, grantSeasonStart, syncRtpPeriod, computeRtpPeriod, get rtpPeriod() { return rtpPeriod; }, get fish() { return fish.filter(f => f.alive).length; }, get frames() { return frames; }, surge: startSurge, fishList: () => fish.filter(f => f.alive && f.t >= 0 && onScreen(f)).map(f => ({ x: f.x, y: f.y, id: f.def.id })), artLoaded: () => Object.keys(ART).filter(artOk), fxCatch: () => { const f = fish.filter(x => x.alive && x.t >= 0 && onScreen(x)).sort((p, q) => (q.mult || 0) - (p.mult || 0))[0]; if (f) kill(f, (f.mult || 50) * bet(), null); return f && f.def.id; }, spawnBoss: (which) => spawnFish(which === 'dragon' ? E.BY_ID.dragon : which === 'kraken' ? E.BY_ID.kraken : (rnd() < .5 ? E.BY_ID.kraken : E.BY_ID.dragon)) };
})();
