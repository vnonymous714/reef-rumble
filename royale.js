/* Coral Clash — original underwater mini battle-royale for Reef Rumble.
   Play credits only. No Free Fire / Garena IP. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = Math.random;
const SKEY = 'reefrumble.v1';
const REWARD_KEY = 'reefrumble.royalePending';
const MATCH_MS = 180000;
const WORLD = 2200;
const BOT_N = 12;
const DPR_CAP = 2;

const WEP = [
  { id: 'harpoon', name: 'Harpoon', dmg: 18, rate: 280, speed: 520, spread: 6 },
  { id: 'trident', name: 'Trident', dmg: 28, rate: 360, speed: 480, range: 7 },
  { id: 'pulse', name: 'Pulse Spear', dmg: 40, rate: 480, speed: 600, range: 8 }
];

const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false });
let W = 0, H = 0, DPR = 1, camX = 0, camY = 0;
let running = false, over = false, matchStart = 0, zonePhase = 0;
let player, bots, bullets, pickups, rocks, feed = [], alive = 0;
let moveX = 0, moveY = 0, aimX = 0, aimY = 0, aiming = false, firing = false;
let lastT = 0, fireCd = 0;

function resize() {
  DPR = Math.min(DPR_CAP, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize);

function joyBind(el, kn, onMove, onEnd) {
  let pid = null, ox = 0, oy = 0, maxR = 40;
  const setKn = (dx, dy) => { kn.style.transform = `translate(${dx}px,${dy}px)`; };
  const start = e => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    if (pid != null) return;
    pid = t.identifier ?? 'm';
    const r = el.getBoundingClientRect();
    ox = r.left + r.width / 2; oy = r.top + r.height / 2;
    el.setPointerCapture?.(t.pointerId);
    move(e);
  };
  const move = e => {
    const touches = e.changedTouches || e.touches;
    let t = null;
    if (touches) {
      for (let i = 0; i < touches.length; i++) if ((touches[i].identifier ?? 'm') === pid || pid === 'm') { t = touches[i]; break; }
    } else if (pid === 'm') t = e;
    if (!t || pid == null) return;
    let dx = t.clientX - ox, dy = t.clientY - oy;
    const len = Math.hypot(dx, dy) || 1;
    if (len > maxR) { dx = dx / len * maxR; dy = dy / len * maxR; }
    setKn(dx, dy);
    onMove(dx / maxR, dy / maxR);
  };
  const end = e => {
    const touches = e.changedTouches;
    if (touches) {
      let hit = false;
      for (let i = 0; i < touches.length; i++) if ((touches[i].identifier ?? 'm') === pid) hit = true;
      if (!hit) return;
    } else if (pid !== 'm') return;
    pid = null; setKn(0, 0); onEnd();
  };
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchmove', move, { passive: false });
  el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  el.addEventListener('mousedown', start);
  addEventListener('mousemove', e => { if (pid === 'm') move(e); });
  addEventListener('mouseup', e => { if (pid === 'm') end(e); });
}

joyBind($('#joyL'), $('#knL'), (x, y) => { moveX = x; moveY = y; }, () => { moveX = 0; moveY = 0; });
joyBind($('#joyR'), $('#knR'), (x, y) => { aimX = x; aimY = y; aiming = Math.hypot(x, y) > 0.15; }, () => { aimX = 0; aimY = 0; aiming = false; });

$('#fireBtn').addEventListener('touchstart', e => { e.preventDefault(); firing = true; }, { passive: false });
$('#fireBtn').addEventListener('touchend', () => { firing = false; });
$('#fireBtn').addEventListener('mousedown', () => { firing = true; });
addEventListener('mouseup', () => { firing = false; });

$('#backBtn').onclick = () => { location.href = 'index.html?v=royale1'; };

function pushFeed(msg) {
  feed.unshift(msg); if (feed.length > 5) feed.pop();
  $('#feed').innerHTML = feed.map(m => `<div>${m}</div>`).join('');
}

function zoneRadius(elapsed) {
  /* Shrink from ~0.48 world to ~0.08 over match */
  const t = clamp(elapsed / MATCH_MS, 0, 1);
  const r0 = WORLD * 0.48, r1 = WORLD * 0.08;
  return r0 + (r1 - r0) * (t * t);
}
function zoneCenter() { return { x: WORLD / 2, y: WORLD / 2 }; }

function makeUnit(isPlayer, i) {
  const ang = rnd() * TAU, dist = 280 + rnd() * 700;
  const zc = zoneCenter();
  return {
    id: isPlayer ? 'you' : 'bot' + i,
    name: isPlayer ? 'You' : ('Diver-' + (i + 1)),
    x: clamp(zc.x + Math.cos(ang) * dist, 40, WORLD - 40),
    y: clamp(zc.y + Math.sin(ang) * dist, 40, WORLD - 40),
    vx: 0, vy: 0, ang: rnd() * TAU,
    hp: 100, shield: isPlayer ? 30 : (rnd() < .4 ? 20 : 0),
    wep: 0, speed: isPlayer ? 165 : 130 + rnd() * 40,
    alive: true, kills: 0, isPlayer: !!isPlayer,
    think: 0, target: null, color: isPlayer ? '#5df2a0' : `hsl(${(i * 47) % 360},70%,62%)`
  };
}

function spawnWorld() {
  rocks = [];
  for (let i = 0; i < 28; i++) {
    rocks.push({
      x: 80 + rnd() * (WORLD - 160), y: 80 + rnd() * (WORLD - 160),
      r: 28 + rnd() * 42, kind: rnd() < .5 ? 'coral' : 'rock'
    });
  }
  pickups = [];
  for (let i = 0; i < 22; i++) {
    const kinds = ['hp', 'shield', 'wep'];
    pickups.push({ x: 60 + rnd() * (WORLD - 120), y: 60 + rnd() * (WORLD - 120), kind: kinds[i % 3], taken: false });
  }
  bullets = [];
  player = makeUnit(true, 0);
  bots = [];
  for (let i = 0; i < BOT_N; i++) bots.push(makeUnit(false, i));
  alive = 1 + BOT_N;
  feed = []; $('#feed').innerHTML = '';
  over = false; running = true; matchStart = performance.now(); fireCd = 0;
  $('#overlay').classList.remove('on');
  pushFeed('Dive in — last diver standing wins');
}

function units() { return player.alive ? [player, ...bots] : bots; }
function living() { return units().filter(u => u.alive); }

function collideRock(u, nx, ny) {
  for (const r of rocks) {
    const d = Math.hypot(nx - r.x, ny - r.y);
    if (d < r.r + 14) {
      const a = Math.atan2(ny - r.y, nx - r.x);
      return { x: r.x + Math.cos(a) * (r.r + 14), y: r.y + Math.sin(a) * (r.r + 14) };
    }
  }
  return { x: nx, y: ny };
}

function tryFire(u) {
  const w = WEP[u.wep];
  const now = performance.now();
  if (u.isPlayer) {
    if (now < fireCd) return;
    fireCd = now + w.rate;
  } else {
    if (now < (u.nextShot || 0)) return;
    u.nextShot = now + w.rate * (0.9 + rnd() * 0.4);
  }
  const ang = u.ang;
  bullets.push({
    x: u.x + Math.cos(ang) * 18, y: u.y + Math.sin(ang) * 18,
    vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
    dmg: w.dmg, r: w.spread, owner: u, life: 1.1
  });
}

function hurt(u, dmg, src) {
  if (!u.alive) return;
  let left = dmg;
  if (u.shield > 0) { const s = Math.min(u.shield, left); u.shield -= s; left -= s; }
  if (left > 0) u.hp -= left;
  if (u.hp <= 0) {
    u.hp = 0; u.alive = false; alive--;
    if (src && src.alive) src.kills++;
    pushFeed(`<b style="color:${src ? src.color : '#fff'}">${src ? src.name : '?'}</b> sunk <b style="color:${u.color}">${u.name}</b>`);
    if (u.isPlayer || alive <= 1) endMatch();
  }
}

function endMatch() {
  if (over) return;
  over = true; running = false;
  const survivors = living().sort((a, b) => b.kills - a.kills);
  let place = player.alive ? 1 : (alive + 1);
  if (player.alive) {
    /* count how many still alive including self — if alone, 1st */
    place = 1;
  } else {
    place = alive + 1;
  }
  const kills = player.kills;
  let reward = kills * 100; // 1.00 per kill
  if (place === 1) reward += 2500;
  else if (place <= 3) reward += 1000;
  applyReward(reward, place, kills);
  const title = place === 1 ? 'Last Diver Standing!' : (player.alive ? 'Victory!' : 'Eliminated');
  $('#endCard').innerHTML = `
    <h1>${title}</h1>
    <h2>#${place} of ${1 + BOT_N}</h2>
    <p>Kills: <b>${kills}</b></p>
    <p>Reward: <b style="color:#ffcf4a">+${(reward / 100).toFixed(2)}</b> play credits</p>
    <p style="opacity:.75;margin-top:8px">Fun credits only · no cash value · does not count toward play-through</p>
    <div class="row">
      <button type="button" id="againBtn">PLAY AGAIN</button>
      <button type="button" class="ghost" id="toMainBtn">REEF RUMBLE</button>
    </div>`;
  $('#overlay').classList.add('on');
  $('#againBtn').onclick = () => { spawnWorld(); };
  $('#toMainBtn').onclick = () => { location.href = 'index.html?v=royale1'; };
  try {
    const T = window.RRT;
    if (T && T.credit) T.credit('royale_result', reward);
  } catch (e) {}
}

function applyReward(cents, place, kills) {
  cents = Math.floor(+cents || 0);
  if (cents <= 0) {
    try { localStorage.setItem(REWARD_KEY, JSON.stringify({ cents: 0, place, kills, t: Date.now() })); } catch (e) {}
    return;
  }
  try {
    const o = JSON.parse(localStorage.getItem(SKEY) || 'null') || {};
    if (typeof o === 'object') {
      o.bal = Math.max(0, Math.floor((+o.bal || 0) + cents));
      localStorage.setItem(SKEY, JSON.stringify(o));
    }
    localStorage.setItem(REWARD_KEY, JSON.stringify({ cents, place, kills, t: Date.now() }));
  } catch (e) {}
}

function ai(u, dt) {
  u.think -= dt;
  const zc = zoneCenter();
  const zr = zoneRadius(performance.now() - matchStart);
  const inZone = Math.hypot(u.x - zc.x, u.y - zc.y) < zr - 30;
  if (u.think <= 0 || !u.target || !u.target.alive) {
    u.think = 0.35 + rnd() * 0.55;
    let best = null, bd = 1e9;
    for (const o of living()) {
      if (o === u) continue;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (d < bd) { bd = d; best = o; }
    }
    u.target = best;
  }
  let tx = zc.x, ty = zc.y;
  if (inZone && u.target) { tx = u.target.x; ty = u.target.y; }
  else if (!inZone) { tx = zc.x; ty = zc.y; }
  const ang = Math.atan2(ty - u.y, tx - u.x);
  u.vx = Math.cos(ang) * u.speed;
  u.vy = Math.sin(ang) * u.speed;
  if (u.target && u.target.alive) {
    u.ang = Math.atan2(u.target.y - u.y, u.target.x - u.x);
    const d = Math.hypot(u.target.x - u.x, u.target.y - u.y);
    if (d < 420) tryFire(u);
  } else u.ang = ang;
}

function update(dt) {
  if (!running || over) return;
  const elapsed = performance.now() - matchStart;
  if (elapsed >= MATCH_MS) {
    /* time up: highest HP among alive, else most kills */
    const live = living();
    if (live.length > 1) {
      live.sort((a, b) => (b.hp + b.shield) - (a.hp + a.shield) || b.kills - a.kills);
      for (let i = 1; i < live.length; i++) { live[i].alive = false; alive--; }
    }
    endMatch();
    return;
  }

  /* player move */
  if (player.alive) {
    player.vx = moveX * player.speed;
    player.vy = moveY * player.speed;
    if (aiming) player.ang = Math.atan2(aimY, aimX);
    else if (Math.hypot(moveX, moveY) > 0.1) player.ang = Math.atan2(moveY, moveX);
    /* auto-aim nearest if not aiming */
    if (!aiming) {
      let best = null, bd = 280;
      for (const o of bots) {
        if (!o.alive) continue;
        const d = Math.hypot(o.x - player.x, o.y - player.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) player.ang = Math.atan2(best.y - player.y, best.x - player.x);
    }
    if (firing || aiming) tryFire(player);
  }

  for (const b of bots) if (b.alive) ai(b, dt);

  for (const u of units()) {
    if (!u.alive) continue;
    let nx = clamp(u.x + u.vx * dt, 20, WORLD - 20);
    let ny = clamp(u.y + u.vy * dt, 20, WORLD - 20);
    const c = collideRock(u, nx, ny);
    u.x = c.x; u.y = c.y;
    /* zone damage */
    const zc = zoneCenter();
    const zr = zoneRadius(elapsed);
    if (Math.hypot(u.x - zc.x, u.y - zc.y) > zr) hurt(u, 12 * dt, null);
    /* pickups */
    for (const p of pickups) {
      if (p.taken) continue;
      if (Math.hypot(p.x - u.x, p.y - u.y) < 22) {
        p.taken = true;
        if (p.kind === 'hp') u.hp = Math.min(100, u.hp + 35);
        else if (p.kind === 'shield') u.shield = Math.min(60, u.shield + 25);
        else u.wep = Math.min(WEP.length - 1, u.wep + 1);
        if (u.isPlayer) {
          if (p.kind === 'wep') $('#weap').textContent = WEP[u.wep].name;
          pushFeed('Loot: ' + (p.kind === 'hp' ? 'Health' : p.kind === 'shield' ? 'Shield' : WEP[u.wep].name));
        }
      }
    }
  }

  for (const b of bullets) {
    b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
    for (const u of living()) {
      if (u === b.owner || !u.alive) continue;
      if (Math.hypot(u.x - b.x, u.y - b.y) < 16) {
        hurt(u, b.dmg, b.owner);
        b.life = 0;
        break;
      }
    }
    for (const r of rocks) {
      if (Math.hypot(b.x - r.x, b.y - r.y) < r.r) { b.life = 0; break; }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  alive = living().length;
  if (player.alive) { camX = player.x; camY = player.y; }
  hud();
}

function hud() {
  const left = Math.max(0, MATCH_MS - (performance.now() - matchStart));
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $('#timer').textContent = m + ':' + String(s).padStart(2, '0');
  $('#aliveN').textContent = String(alive);
  $('#killsN').textContent = String(player.kills);
  $('#hpFill').style.width = clamp(player.hp, 0, 100) + '%';
  $('#shFill').style.width = clamp(player.shield / 60 * 100, 0, 100) + '%';
  if (player.alive) $('#weap').textContent = WEP[player.wep].name;
}

function draw() {
  ctx.fillStyle = '#021a33';
  ctx.fillRect(0, 0, W, H);
  const ox = W / 2 - camX, oy = H / 2 - camY;

  /* water grid */
  ctx.save();
  ctx.translate(ox, oy);
  ctx.strokeStyle = 'rgba(60,140,200,.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD); ctx.stroke(); }
  for (let y = 0; y <= WORLD; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD, y); ctx.stroke(); }

  /* zone */
  const zc = zoneCenter();
  const zr = zoneRadius(running || over ? (performance.now() - matchStart) : 0);
  ctx.beginPath(); ctx.rect(-200, -200, WORLD + 400, WORLD + 400);
  ctx.arc(zc.x, zc.y, zr, 0, TAU, true);
  ctx.fillStyle = 'rgba(180,40,80,.22)';
  ctx.fill('evenodd');
  ctx.beginPath(); ctx.arc(zc.x, zc.y, zr, 0, TAU);
  ctx.strokeStyle = 'rgba(255,120,160,.7)'; ctx.lineWidth = 3; ctx.stroke();

  /* rocks / coral */
  for (const r of rocks) {
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU);
    if (r.kind === 'coral') {
      const g = ctx.createRadialGradient(r.x - 8, r.y - 8, 4, r.x, r.y, r.r);
      g.addColorStop(0, '#ff8ec8'); g.addColorStop(1, '#7a2060');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#3a4a5a';
    }
    ctx.fill();
  }

  /* pickups */
  for (const p of pickups) {
    if (p.taken) continue;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU);
    ctx.fillStyle = p.kind === 'hp' ? '#5df2a0' : p.kind === 'shield' ? '#2f8cff' : '#ffcf4a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
  }

  /* bullets */
  for (const b of bullets) {
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, TAU);
    ctx.fillStyle = b.owner && b.owner.isPlayer ? '#fff6a0' : '#ff8a80';
    ctx.fill();
  }

  /* units */
  for (const u of units()) {
    if (!u.alive) continue;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.rotate(u.ang);
    /* body */
    ctx.fillStyle = u.color;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-10, 9); ctx.lineTo(-6, 0); ctx.lineTo(-10, -9); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    /* spear */
    ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(22, 0); ctx.stroke();
    ctx.restore();
    /* name / hp */
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(u.x - 16, u.y - 28, 32, 4);
    ctx.fillStyle = '#5df2a0';
    ctx.fillRect(u.x - 16, u.y - 28, 32 * (u.hp / 100), 4);
    if (!u.isPlayer) {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '700 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(u.name, u.x, u.y - 32);
    }
  }
  ctx.restore();

  /* vignette */
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,10,30,.35)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastT) / 1000 || 0.016);
  lastT = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* boot */
resize();
spawnWorld();
try {
  const T = window.RRT;
  if (T && T.start) T.start({ start: 20000, bal: () => {
    try { const o = JSON.parse(localStorage.getItem(SKEY) || '{}'); return +o.bal || 0; } catch (e) { return 0; }
  }, setBal: () => {} });
  if (T && T.setMode) { /* keep current; royale logs as normal unless UG flag */ }
} catch (e) {}
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(loop); });

window.__clash = { spawnWorld, get player() { return player; }, get alive() { return alive; }, get bots() { return bots; }, get zoneR() { return zoneRadius(performance.now() - matchStart); }, endMatch, applyReward };
})();
