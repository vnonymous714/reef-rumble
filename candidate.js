/* Review candidate: server owns every paid outcome. Original rich assets only. */
const actionID = () =>
  crypto.randomUUID?.() ||
  "rr_" +
    Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16),
    ).join("");
const tgInit = window.Telegram?.WebApp?.initData || "";
try {
  if (tgInit) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }
} catch {}
const API =
    document.querySelector('meta[name="reef-api"]')?.content || location.origin,
  $ = (s) => document.querySelector(s),
  fmt = (n) => (n / 100).toFixed(2),
  canvas = $("#arena"),
  ctx = canvas.getContext("2d"),
  FX = ReefFX.create(),
  reduced = matchMedia("(prefers-reduced-motion: reduce)");
const images = {},
  assets = [
    "bg",
    "cannon",
    "kraken",
    "dragon",
    "coin",
    "gem_b",
    "gem_r",
    "gem_g",
    "gem_p",
    "minnow",
    "guppy",
    "darter",
    "pebble",
    "tang",
    "lantern",
    "jelly",
    "turtle",
    "ray",
    "sword",
    "shark",
    "koi",
    "whale",
    "bomb",
    "eel",
    "chest",
    "laser",
  ];
for (const key of assets) {
  const im = new Image();
  im.src = "assets/" + (key === "laser" ? "ray" : key) + ".webp?v=6";
  images[key] = im;
}
let token = tgInit ? null : sessionStorage.getItem("rr.candidate.session"),
  snapshot = null,
  base = 10,
  tier = 1,
  target = null,
  busy = false,
  auto = false,
  shots = [],
  sparks = [],
  clockOffset = 0,
  lastFrame = performance.now(),
  noticeTimer,
  modalOffer = null,
  sound = false;
const bets = [10, 20, 50, 100, 200, 300, 500, 1000],
  now = () => Date.now() + clockOffset;
const pendingKey = () =>
  "rr.candidate.pending." + (snapshot?.owner || "unknown");
function notice(text) {
  $("#notice").textContent = text;
  $("#notice").style.display = "block";
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("#notice").style.display = "none"), 3200);
}
async function request(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const reply = await fetch(API + path, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...body,
      ...(!token && tgInit ? { initData: tgInit } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await reply.json();
  if (!reply.ok)
    throw Object.assign(new Error(result.error || "Request failed"), {
      status: reply.status,
    });
  return result;
}
function apply(s) {
  if (snapshot && s.seq < snapshot.seq) return;
  clockOffset = s.now - Date.now();
  snapshot = s;
  $("#auth").hidden = true;
  $("#credits").textContent = fmt(s.balance);
  $("#jp").textContent = fmt(s.world.jp);
  $("#tide").textContent =
    s.period === 88 ? "LOW TIDE · 88% TARGET" : "NORMAL TIDE · 92% TARGET";
  $("#daily").disabled = !s.daily.due;
  updateHUD();
}
function updateHUD() {
  const locked = snapshot?.world.fishes.find((f) => f.id === target)?.lock;
  $("#stake").textContent = fmt(
    Math.round(base * (snapshot?.profiles[tier - 1]?.costFactor || 1)),
  );
  $("#tier").textContent = "TIER " + tier;
  $("#locked").textContent = locked
    ? "TARGET LOCKED · " +
      fmt(locked.stake) +
      " / shot · TIER " +
      locked.tier +
      " · Changes affect new fish only"
    : "Tap a fish to engage. Price and tier lock until capture/escape.";
}
async function command(command, extra = {}) {
  if (busy || (!token && !tgInit)) return null;
  busy = true;
  const pending = sessionStorage.getItem(pendingKey());
  const body = pending
    ? JSON.parse(pending)
    : { command, ...extra, id: actionID(), seq: snapshot?.seq };
  sessionStorage.setItem(pendingKey(), JSON.stringify(body));
  try {
    const r = await request("/api/v2/game", body);
    apply(r);
    sessionStorage.removeItem(pendingKey());
    if (pending && body.command !== command) {
      if (r.detail?.bonus) showBonusResult(r.detail.bonus);
      notice("Pending " + body.command + " recovered · no duplicate charge");
      return null;
    }
    return r;
  } catch (e) {
    notice(e.message);
    if (e.status === 401) {
      token = null;
      sessionStorage.removeItem("rr.candidate.session");
      $("#auth").hidden = false;
    }
    if (e.status >= 400 && e.status < 500)
      sessionStorage.removeItem(pendingKey());
    if (e.status === 400 || e.status === 409) {
      try {
        apply(
          await request("/api/v2/game", { command: "state", id: actionID() }),
        );
      } catch {}
    }

    return null;
  } finally {
    busy = false;
  }
}
async function bootstrap() {
  try {
    const r = await request("/api/v2/game", {
      command: "state",
      id: actionID(),
    });
    apply(r);
    const saved = sessionStorage.getItem(pendingKey());
    if (saved) {
      try {
        const pending = JSON.parse(saved);
        const receipt = await request("/api/v2/game", pending);
        sessionStorage.removeItem(pendingKey());
        if (receipt.detail?.bonus) showBonusResult(receipt.detail.bonus);
        notice("Previous action recovered without a second charge.");
        apply(
          await request("/api/v2/game", {
            command: "state",
            id: actionID(),
          }),
        );
      } catch (e) {
        if (e.status === 409) sessionStorage.removeItem(pendingKey());
        notice("Pending action requires refresh: " + e.message);
      }
    }
    const offer = snapshot.world.offers.find((o) => !o.consumed);
    if (offer) await openBonus(offer.id);
    else if (snapshot.daily.due) openDaily();
  } catch (e) {
    $("#authError").textContent = e.message;
    $("#auth").hidden = false;
  }
}
async function authenticate(signup) {
  try {
    const r = await request("/api/auth/" + (signup ? "signup" : "login"), {
      username: $("#user").value.trim(),
      password: $("#pass").value,
    });
    token = r.token;
    $("#pass").value = "";
    sessionStorage.setItem("rr.candidate.session", token);
    await bootstrap();
  } catch (e) {
    $("#authError").textContent = e.message;
  }
}
$("#login").onsubmit = (e) => {
  e.preventDefault();
  authenticate(false);
};
$("#signup").onclick = () => {
  if ($("#login").reportValidity()) authenticate(true);
};
$("#down").onclick = () => {
  base = bets[Math.max(0, bets.indexOf(base) - 1)];
  updateHUD();
};
$("#up").onclick = () => {
  base = bets[Math.min(bets.length - 1, bets.indexOf(base) + 1)];
  updateHUD();
};
$("#tier").onclick = () => {
  tier = (tier % 5) + 1;
  updateHUD();
};
$("#auto").onclick = () => {
  auto = !auto;
  $("#auto").textContent = auto ? "AUTO ON" : "AUTO OFF";
};
for (const style of ["arc", "plasma"])
  $("#" + style).onclick = async () => {
    const r = await command("activate", { style });
    if (r)
      notice(
        style.toUpperCase() + " active for 6s · 12s shared cooldown afterward",
      );
  };
$("#sound").onclick = () => {
  sound = !sound;
  $("#sound").textContent = sound ? "SOUND ON" : "SOUND OFF";
};
function tone() {
  if (!sound) return;
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(),
      o = a.createOscillator(),
      g = a.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.025, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.16);
    o.connect(g);
    g.connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.18);
    o.onended = () => a.close();
  } catch {}
}
function pos(f) {
  const time = (snapshot?.world.pausedAt || now()) - f.born;
  if (reduced.matches) return { x: f.x * innerWidth, y: f.y * innerHeight };
  return {
    x:
      f.x * innerWidth + Math.sin(time * 0.0003 + f.x * 7) * innerWidth * 0.055,
    y: f.y * innerHeight + Math.sin(time * 0.0007 + f.y * 4) * 8,
  };
}
async function fire() {
  if (
    !snapshot ||
    busy ||
    modalOffer ||
    !$("#modal").hidden ||
    now() - snapshot.world.lastShot <
      (now() < snapshot.world.laserUntil ? 90 : 160)
  )
    return;
  let f = snapshot.world.fishes.find((f) => f.id === target && !f.dead);
  if (!f) {
    f = snapshot.world.fishes.find((f) => !f.dead);
    if (!f) return;
    target = f.id;
  }
  const p = pos(f),
    r = await command("attack", { target: f.id, baseStake: base, tier });
  if (!r) return;
  const a = r.detail.attack;
  if (!a) return;
  tone();
  shots.push({
    x: innerWidth / 2,
    y: innerHeight - 28,
    tx: p.x,
    ty: p.y,
    t: 0,
    style: a.style,
  });
  shots = shots.slice(-24);
  for (const hit of a.updates) {
    const fish = snapshot.world.fishes.find((f) => f.id === hit.id);
    if (!fish) continue;
    const q = pos(fish);
    if (hit.id !== f.id && ["arc", "laser"].includes(a.style))
      shots.push({ x: p.x, y: p.y, tx: q.x, ty: q.y, t: 0, style: a.style });
    sparks.push({
      x: q.x,
      y: q.y,
      t: 0,
      hit: hit.damage > 0,
      prize: hit.prize,
    });
    if (hit.dead && hit.kind === "bomb")
      FX.bomb(q.x, q.y, Math.min(1.2, innerHeight / 390), reduced.matches);
  }
  sparks = sparks.slice(-24);
  if (!auto && a.updates.every((h) => !h.damage))
    notice("Glanced · charged pulse did not penetrate");
  if (r.detail.offer) await openBonus(r.detail.offer);
}
canvas.onpointerdown = (e) => {
  if (!snapshot || !$("#modal").hidden) return;
  let closest = null,
    d = Infinity;
  for (const f of snapshot.world.fishes.filter((f) => !f.dead)) {
    const p = pos(f),
      v = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (v < d) {
      closest = f;
      d = v;
    }
  }
  if (closest) {
    target = closest.id;
    updateHUD();
    fire();
  }
};
setInterval(() => {
  if (auto) fire();
}, 100);
function modal(html) {
  auto = false;
  $("#auto").textContent = "AUTO OFF";
  $("#panel").innerHTML = html;
  $("#modal").hidden = false;
}
function close() {
  if (modalOffer) return;
  $("#modal").hidden = true;
}
const symbolAssets = [
  "gem_b",
  "chest",
  "minnow",
  "tang",
  "jelly",
  "turtle",
  "koi",
  "ray",
];
function gridHTML(result) {
  return (
    '<div class="reels">' +
    result.grid
      .map(
        (col, c) =>
          '<div class="reel">' +
          col
            .map(
              (s, row) =>
                '<div class="cell ' +
                (result.wins.some((w) => TempleBonus.LINES[w.line][c] === row)
                  ? "win"
                  : "") +
                '"><img src="assets/' +
                symbolAssets[s] +
                '.webp" alt="' +
                (s === 0
                  ? "Tide Jewel"
                  : s === 1
                    ? "Temple Relic"
                    : "Reef symbol") +
                '"></div>',
            )
            .join("") +
          "</div>",
      )
      .join("") +
    "</div>"
  );
}
function showBonusResult(r) {
  modal(
    "<h1>Temple Treasures</h1>" +
      gridHTML(r).replace('class="reels"', 'class="reels settling"') +
      '<div class="result">Returned ' +
      fmt(r.pay) +
      " · Net " +
      (r.net >= 0 ? "+" : "") +
      fmt(r.net) +
      '</div><button id="done">RETURN TO REEF</button>',
  );
  modalOffer = null;
  $("#done").onclick = close;
}
async function openBonus(id) {
  if (busy) return;
  const r = snapshot.world.pausedAt
    ? { world: snapshot.world }
    : await command("pause", { offer: id });
  if (!r) return;
  modalOffer = id;
  modal(
    '<h1>Temple Crab · 3 reels · 5 lines</h1><p>Optional paid play credits. Top, middle, bottom and both diagonals. Half of spins make a net profit. All five lines share ONE total stake.</p><div id="bonusGrid">' +
      gridHTML(TempleBonus.outcome(0, 0, 10, snapshot.period)) +
      '</div><div class="row" id="tiers"></div><p id="risk"></p><p>Three Tide Jewels on a line: 1.2×. Three Temple Relics: ' +
      (snapshot.period === 88 ? "29.2" : "33.2") +
      "×. Other fish symbols do not pay. 50%: 0× · 49%: 1.2× · 1%: " +
      (snapshot.period === 88 ? "29.2" : "33.2") +
      '× gross return. Maximum stake 12.00; total spin award never above 400.00.</p><button id="skip">SKIP · NO CHARGE</button>',
  );
  for (const percent of [1, 5, 10]) {
    const b = document.createElement("button"),
      stake = TempleBonus.stakeFor(snapshot.balance, percent);
    b.innerHTML =
      "SPIN " +
      (percent === 1 ? "SMALL" : percent === 5 ? "MEDIUM" : "INSANE") +
      " · " +
      fmt(stake) +
      '<small style="display:block;font-size:8px;margin-top:4px">' +
      percent +
      "% · Max return " +
      fmt(stake * (snapshot.period === 88 ? 29.2 : 33.2)) +
      "</small>";
    b.disabled = !stake;
    b.title = percent + "% rounded down; capped at 12.00";
    b.onclick = async () => {
      const result = await command("spin", { offer: id, tier: percent });
      if (result) showBonusResult(result.detail.bonus);
    };
    $("#tiers").append(b);
  }
  $("#risk").textContent =
    "Maximum loss is the displayed stake. Bigger stake does not improve the 50% profit probability.";
  $("#skip").onclick = async () => {
    if (await command("skip", { offer: id })) {
      modalOffer = null;
      close();
    }
  };
}
function openDaily() {
  if (modalOffer) return;
  modal(
    '<h1>The Daily Temple</h1><p>Server-confirmed reward · one claim per LA calendar day · streak up to seven days. Weighted prizes; equal-sized sectors do not mean equal odds.</p><div class="wheelbox"><canvas id="wheel" width="600" height="600"></canvas></div><div class="result" id="dailyResult">Return to the reef. The temple remembers.</div><button id="claim">SPIN DAILY WHEEL</button><button id="later">LATER</button>',
  );
  drawWheel();
  $("#claim").onclick = async () => {
    const r = await command("daily");
    if (!r) return;
    $("#claim").disabled = true;
    const reward = r.detail.daily,
      basePay = (reward.pay * 10) / (9 + reward.streak),
      idx = [100, 200, 300, 400, 500, 800, 1000, 1500, 2500, 10000].indexOf(
        basePay,
      );
    const wheel = $("#wheel");
    wheel.style.transition = reduced.matches
      ? "none"
      : "transform 3.5s cubic-bezier(.12,.8,.15,1)";
    wheel.style.transform = "rotate(" + (2160 - idx * 36) + "deg)";
    $("#dailyResult").textContent =
      "Confirmed · " + fmt(reward.pay) + " credits · Day " + reward.streak;
    $("#claim").textContent = "CLAIMED";
    tone();
  };
  $("#later").onclick = close;
}
function drawWheel() {
  const g = $("#wheel").getContext("2d"),
    r = 272,
    pays = [1, 2, 3, 4, 5, 8, 10, 15, 25, 100];
  g.translate(300, 300);
  for (let i = 0; i < 10; i++) {
    const a = ((i - 0.5) * Math.PI) / 5 - Math.PI / 2,
      b = a + Math.PI / 5,
      grad = g.createRadialGradient(0, 0, 50, 0, 0, r);
    grad.addColorStop(0, i % 2 ? "#386e70" : "#285064");
    grad.addColorStop(1, i === 9 ? "#9f742a" : "#051d32");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, a, b);
    g.closePath();
    g.fill();
    g.strokeStyle = "#cba85d";
    g.lineWidth = 3;
    g.stroke();
    g.save();
    g.rotate((i * Math.PI) / 5);
    g.fillStyle = "#ffe7b0";
    g.font = "900 32px system-ui";
    g.textAlign = "center";
    g.fillText(pays[i].toFixed(2), 0, -185);
    g.restore();
  }
  g.strokeStyle = "#c9a45c";
  g.lineWidth = 26;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "#fff0b0";
  g.lineWidth = 3;
  for (const rad of [r - 16, r + 14, 62]) {
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    const im = images[["gem_r", "gem_b", "gem_g", "gem_p"][i % 4]];
    if (im.complete && im.naturalWidth)
      g.drawImage(im, Math.sin(a) * r - 15, -Math.cos(a) * r - 15, 30, 30);
  }
  if (images.gem_b.complete) g.drawImage(images.gem_b, -48, -48, 96, 96);
}
$("#daily").onclick = openDaily;
$("#guide").onclick = () => {
  modal(
    '<h1>Reef combat · clear rules</h1><p>Tap fish to fire a targeted paid pulse. The first accepted attack locks that fish’s actual shot price and tier until capture or escape. Changing the controls affects only new fish.</p><p>HP is real. Higher tiers add 5% HP per tier; doubled base stake adds about 2%. The combined increase caps at 20%, frozen at engagement. Larger damage packets land less frequently; plasma concentrates the budget, arc shares it across up to three eligible targets. Laser uses the same paid budget at a faster firing interval. No free extra damage.</p><p>Prizes are multiplier × LOCKED actual stake, up to 400.00. If a fish escapes, its already-earned partial capture value is returned in credits; it is not lost or repriced. New engagements that could exceed the cap are refused.</p><p>Selected targets with different locked stake/tier cannot share an arc. No gameplay wheel spawns: Temple Crab offers optional slots; the wheel is daily only.</p><p>Normal fish value target 91%, Low Tide 87%, plus 1% progressive. Targets are not guarantees of any session’s results. Play credits only; no cash-out.</p><button id="done">RETURN</button>',
  );
  $("#done").onclick = close;
};
function electric(x1, y1, x2, y2, t, width = 1) {
  const dx = x2 - x1,
    dy = y2 - y1,
    l = Math.hypot(dx, dy) || 1,
    nx = -dy / l,
    ny = dx / l;
  ctx.save();
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i <= 12; i++) {
      const u = i / 12,
        o =
          i === 12
            ? 0
            : Math.sin(i * 9 + (reduced.matches ? 0 : Math.floor(t * 9))) * 6;
      ctx.lineTo(x1 + dx * u + nx * o, y1 + dy * u + ny * o);
    }
    ctx.strokeStyle = pass ? "#d7ffff" : "#5ad4ff66";
    ctx.lineWidth = pass ? width : width * 4;
    ctx.stroke();
  }
  for (let i = 3; i < 10; i += 3) {
    ctx.beginPath();
    const u = i / 12;
    ctx.moveTo(x1 + dx * u, y1 + dy * u);
    ctx.lineTo(x1 + dx * u + nx * 13, y1 + dy * u + ny * 13);
    ctx.lineTo(x1 + dx * (u + 0.06) + nx * 8, y1 + dy * (u + 0.06) + ny * 8);
    ctx.strokeStyle = "#b4faff99";
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.restore();
}
function frame(t) {
  const dt = Math.min(0.05, (t - lastFrame) / 1000);
  lastFrame = t;
  const w = innerWidth,
    h = innerHeight,
    dpr = Math.min(2, devicePixelRatio || 1);
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = images.bg;
  if (bg.complete && bg.naturalWidth) {
    const scale = Math.max(w / bg.width, h / bg.height);
    ctx.drawImage(
      bg,
      (w - bg.width * scale) / 2,
      (h - bg.height * scale) * 0.6,
      bg.width * scale,
      bg.height * scale,
    );
  } else {
    ctx.fillStyle = "#032139";
    ctx.fillRect(0, 0, w, h);
  }
  FX.update(dt);
  FX.terrain(ctx, reduced.matches);
  if (!reduced.matches) {
    ctx.fillStyle = "#b7efff0b";
    for (let i = 0; i < 3; i++) {
      const x = i * w * 0.35 + Math.sin(t * 0.0002 + i) * 15;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 24, 0);
      ctx.lineTo(x + 150, h * 0.8);
      ctx.lineTo(x + 90, h * 0.8);
      ctx.fill();
    }
  }
  if (snapshot) {
    for (const f of snapshot.world.fishes) {
      if (f.dead) continue;
      const p = pos(f),
        im = images[f.art],
        width =
          (f.mult >= 100 ? 205 : f.mult >= 50 ? 142 : f.mult >= 15 ? 104 : 72) *
          Math.min(1.25, Math.max(0.85, h / 430)),
        height = (width * (im.naturalHeight || 1)) / (im.naturalWidth || 2);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin((now() - f.born) * 0.0006) * 0.09);
      if (im.complete && im.naturalWidth)
        ctx.drawImage(im, -width / 2, -height / 2, width, height);
      ctx.restore();
      if (f.lock) {
        const bw = 54,
          y = p.y - height / 2 - 10;
        ctx.fillStyle = "#00131ce8";
        ctx.fillRect(p.x - bw / 2, y, bw, 5);
        ctx.fillStyle = "#7adcd3";
        ctx.fillRect(p.x - bw / 2, y, (bw * f.hp) / f.maxHp, 5);
        ctx.font = "800 8px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "#e4faff";
        ctx.strokeStyle = "#00121f";
        ctx.lineWidth = 3;
        const label =
          f.hp + "/" + f.maxHp + " · " + fmt(f.lock.stake) + " T" + f.lock.tier;
        ctx.strokeText(label, p.x, y - 4);
        ctx.fillText(label, p.x, y - 4);
      }
      if (["temple", "laser", "bomb", "chain"].includes(f.kind)) {
        ctx.font = "900 8px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffe7a4";
        ctx.fillText(
          {
            temple: "TEMPLE BONUS",
            laser: "LASER RAY",
            bomb: "BOMB CRAB",
            chain: "CHAIN EEL",
          }[f.kind],
          p.x,
          p.y + height / 2 + 9,
        );
      }
    }
    const n = now(),
      s = snapshot.world,
      active = n < s.styleUntil,
      laser = n < s.laserUntil;
    $("#arc").disabled = busy || n < s.cooldownUntil || laser;
    $("#plasma").disabled = $("#arc").disabled;
    $("#arc").classList.toggle("on", active && s.style === "arc");
    $("#plasma").classList.toggle("on", active && s.style === "plasma");
    $("#timer").textContent = laser
      ? "LASER " + Math.max(0, (s.laserUntil - n) / 1000).toFixed(1) + "s"
      : active
        ? s.style.toUpperCase() +
          " " +
          ((s.styleUntil - n) / 1000).toFixed(1) +
          "s"
        : n < s.cooldownUntil
          ? "COOLDOWN " + Math.ceil((s.cooldownUntil - n) / 1000) + "s"
          : "";
  }
  for (const shot of shots) {
    shot.t += dt;
    const u = Math.min(1, shot.t / 0.18),
      x = shot.x + (shot.tx - shot.x) * u,
      y = shot.y + (shot.ty - shot.y) * u;
    const grad = ctx.createLinearGradient(
      x,
      y,
      x - (shot.tx - shot.x) * 0.18,
      y - (shot.ty - shot.y) * 0.18,
    );
    grad.addColorStop(0, "#efffff");
    grad.addColorStop(0.4, shot.style === "plasma" ? "#ffc978" : "#7ee9ff");
    grad.addColorStop(1, "#7ee9ff00");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - (shot.tx - shot.x) * 0.18, y - (shot.ty - shot.y) * 0.18);
    ctx.stroke();
    if (["arc", "laser"].includes(shot.style))
      electric(shot.x, shot.y, x, y, t / 1000);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(shot.ty - shot.y, shot.tx - shot.x));
    ctx.fillStyle = "#dfffff";
    ctx.fillRect(-7, -2, 14, 4);
    ctx.strokeStyle = shot.style === "plasma" ? "#ffe1a4" : "#9afaff";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(-6 + i * 4, 0, 3, 6 - i, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  shots = shots.filter((s) => s.t < 0.22);
  for (const s of sparks) {
    s.t += dt;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - s.t / 0.7);
    ctx.strokeStyle = s.hit ? "#b4ffeb" : "#87afbf";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(
      s.x,
      s.y,
      5 + (reduced.matches ? 8 : s.t * 40),
      3 + (reduced.matches ? 5 : s.t * 22),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    if (s.hit && !reduced.matches)
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.fillStyle = "#ffe9b3";
        ctx.fillRect(
          s.x + Math.cos(a) * s.t * 55,
          s.y + Math.sin(a) * s.t * 35,
          2,
          2,
        );
      }
    if (s.prize) {
      ctx.fillStyle = "#ffe2a0";
      ctx.font = "900 16px ui-monospace";
      ctx.textAlign = "center";
      ctx.fillText("+" + fmt(s.prize), s.x, s.y - 20 - s.t * 20);
    }
    ctx.restore();
  }
  sparks = sparks.filter((s) => s.t < 0.7);
  const cannon = images.cannon;
  if (cannon.complete && cannon.naturalWidth) {
    const f = snapshot?.world.fishes.find((f) => f.id === target),
      p = f ? pos(f) : { x: w / 2, y: 0 };
    ctx.save();
    ctx.translate(w / 2, h - 18);
    ctx.rotate(Math.atan2(p.y - (h - 18), p.x - w / 2) + Math.PI / 2);
    const ch = 85,
      cw = (ch * cannon.naturalWidth) / cannon.naturalHeight;
    ctx.drawImage(cannon, -cw / 2, -ch * 0.75, cw, ch);
    ctx.strokeStyle = "#9eebefaa";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, -37 - i * 6, 12 - i * 2, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (token || tgInit) bootstrap();
setInterval(async () => {
  if (
    (token || tgInit) &&
    snapshot &&
    $("#auth").hidden &&
    !busy &&
    $("#modal").hidden &&
    !document.hidden
  ) {
    const r = await command("state");
    if (r?.detail.escaped?.some((f) => f.pay))
      notice("Escaped fish partial capture value returned.");
    const offer = r?.world.offers.find((o) => !o.consumed);
    if (offer) await openBonus(offer.id);
  }
}, 4000);
