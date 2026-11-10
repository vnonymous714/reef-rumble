/* Bonus Relic choice UI — canvas art only (no emoji glyphs). */
(function (root) {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  let math = root.ReefBonusChoice;
  let art = root.ReefBonusChoiceArt;
  let bridge = null;
  let current = null;

  function ensure() {
    math = root.ReefBonusChoice || math;
    art = root.ReefBonusChoiceArt || art;
    return { math, art };
  }

  function fmt(c) {
    return (Math.floor(c) / 100).toFixed(2);
  }

  function ensureModal(id, html) {
    let m = document.getElementById(id);
    if (m) return m;
    m = document.createElement('div');
    m.id = id;
    m.className = 'modal';
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  function open(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('open');
    root.__slotsBridge?.open?.();
    root.__reef?.authoritativeView?.openModal?.('#' + id);
  }

  function close(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('open');
    if (!document.querySelector('.modal.open')) root.__slotsBridge?.close?.();
    else root.__reef?.authoritativeView?.closeModal?.(m);
  }

  function sizeCanvas(cv, cssW, cssH) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(cssW * dpr));
    cv.height = Math.max(1, Math.round(cssH * dpr));
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  async function paintChoiceMenu(offer) {
    ensure();
    if (art?.ensureLoaded) await art.ensureLoaded();
    ensureModal(
      'bonusChoiceM',
      '<div class="sheet bonusSheet"><h2>TEMPLE RELIC BONUS</h2><div class="sub" id="bcSub"></div><div class="bonusChoices" id="bcChoices"></div><div class="bonusNote">One bonus pick every 12 hours · play credits only · max 400.00 per award</div></div>'
    );
    current = { offerId: offer.id, stake: offer.stake, mode: 'choice' };
    $('#bcSub').textContent = 'Locked stake ' + fmt(offer.stake) + ' · pick ONE game';
    const box = $('#bcChoices');
    box.innerHTML = '';
    const opts = [
      ['wheel', 'TEMPLE WHEEL', 'Spin a sunken-temple stake wheel'],
      ['chest', 'TREASURE CHESTS', 'Pick 1 of 3 · 2x / 5x / 10x'],
      ['tap', 'TAP FRENZY', '20s free taps · rate raises mult']
    ];
    for (const [id, title, blurb] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', title);
      const cv = document.createElement('canvas');
      b.appendChild(cv);
      b.onclick = () => pickGame(id);
      box.appendChild(b);
      const paint = (press) => {
        const r = b.getBoundingClientRect();
        const g = sizeCanvas(cv, r.width || 200, r.height || 200);
        art.paintChoiceCard(g, r.width || 200, r.height || 200, id, title, blurb, !!press);
      };
      requestAnimationFrame(() => paint(false));
      b.onpointerdown = () => paint(true);
      b.onpointerup = b.onpointerleave = () => paint(false);
    }
    open('bonusChoiceM');
  }

  async function pickGame(kind) {
    if (!bridge || !current) return;
    close('bonusChoiceM');
    if (kind === 'chest') return openChests();
    if (kind === 'tap') return openTap();
    if (kind === 'wheel') return openChoiceWheel();
  }

  function paintChestScene(layout, openIdx) {
    ensure();
    const row = $('#chRow');
    const scene = $('#chScene');
    if (!row || !scene) return;
    const rr = row.getBoundingClientRect();
    const g = sizeCanvas(scene, rr.width || 600, rr.height || 200);
    let chests;
    if (!layout) {
      // before pick: all closed
      chests = [0, 1, 2].map(() => ({ open: false, mult: null, dim: false }));
    } else {
      // after pick: chosen open+bright, others open+dimmed with their mult
      chests = layout.map((m, i) => ({
        open: true,
        mult: m,
        dim: openIdx != null && i !== openIdx
      }));
    }
    art.paintChestPanel(g, rr.width || 600, rr.height || 200, chests);
  }

  async function openChests() {
    ensure();
    if (art?.ensureLoaded) await art.ensureLoaded();
    ensureModal(
      'chestBonusM',
      '<div class="sheet bonusSheet"><h2>TEMPLE TREASURE CHESTS</h2><div class="sub" id="chSub"></div><div class="chestRow" id="chRow"><canvas id="chScene"></canvas></div><div class="bonusPay" id="chPay"></div><button class="bonusDone" id="chDone" hidden>COLLECT</button><div class="bonusNote">Server shuffled 2x · 5x · 10x · pick one chest</div></div>'
    );
    current.mode = 'chest';
    $('#chSub').textContent = 'Stake ' + fmt(current.stake) + ' · pick a chest';
    $('#chPay').textContent = '';
    $('#chDone').hidden = true;
    const row = $('#chRow');
    row.querySelectorAll('.chestBtn').forEach((b) => b.remove());
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.className = 'chestBtn';
      b.type = 'button';
      b.setAttribute('aria-label', 'Chest ' + (i + 1));
      b.dataset.i = String(i);
      b.onclick = () => claimChest(i);
      row.appendChild(b);
    }
    open('chestBonusM');
    requestAnimationFrame(() => paintChestScene(null, null));
  }

  async function claimChest(i) {
    if (!bridge || !current) return;
    const res = await bridge.command('bonus_chest', { offer: current.offerId, pick: i });
    if (!res?.detail?.chest) return;
    const chest = res.detail.chest;
    document.querySelectorAll('#chRow .chestBtn').forEach((b) => {
      b.disabled = true;
      if (+b.dataset.i === chest.pick) b.classList.add('open');
    });
    paintChestScene(chest.layout, chest.pick);
    $('#chPay').textContent = '+' + fmt(chest.pay) + ' · ' + chest.mult + '\u00d7';
    const done = $('#chDone');
    done.hidden = false;
    done.onclick = () => {
      close('chestBonusM');
      current = null;
    };
  }

  async function openTap() {
    ensure();
    if (art?.ensureLoaded) await art.ensureLoaded();
    ensureModal(
      'tapBonusM',
      '<div class="sheet bonusSheet"><h2>REEF TAP FRENZY</h2><div class="sub" id="tapSub"></div><div class="tapHud"><span>TIME <b id="tapTime">20.0</b></span><span>TAPS <b id="tapCount">0</b></span><span>MULT <b id="tapMult">1.00\u00d7</b></span><span>LIVE <b id="tapLive">0.00</b></span></div><div class="tapStage" id="tapArena" role="button" aria-label="Tap the pearl"><canvas id="tapCv"></canvas></div><div class="bonusPay" id="tapPay"></div><button class="bonusDone" id="tapDone" hidden>COLLECT</button><div class="bonusNote">Server clamps to ~12 taps/sec · 20 seconds</div></div>'
    );
    current.mode = 'tap';
    current.taps = [];
    current.startedAt = 0;
    current.bursts = [];
    current.pulse = 0;
    $('#tapSub').textContent = 'Stake ' + fmt(current.stake) + ' · tap the pearl as fast as you can';
    $('#tapPay').textContent = '';
    $('#tapDone').hidden = true;
    $('#tapCount').textContent = '0';
    $('#tapMult').textContent = '1.00\u00d7';
    $('#tapLive').textContent = fmt(current.stake);
    $('#tapTime').textContent = '20.0';
    const arena = $('#tapArena');
    arena.onclick = onTap;
    open('tapBonusM');
    requestAnimationFrame(paintTap);
    bridge.command('bonus_tap_start', { offer: current.offerId }).then((s) => {
      current.startedAt = s?.detail?.tap?.startedAt || Date.now();
      current.tick = setInterval(tapTick, 50);
    });
  }

  function paintTap() {
    if (!current || current.mode !== 'tap') return;
    ensure();
    const arena = $('#tapArena');
    const cv = $('#tapCv');
    if (!arena || !cv) return;
    const r = arena.getBoundingClientRect();
    const g = sizeCanvas(cv, r.width, r.height);
    const M = math;
    const elapsed = current.startedAt ? (Date.now() - current.startedAt) / 1000 : 0;
    const left = Math.max(0, M.TAP_SECONDS - elapsed);
    const valid = current.startedAt ? M.sanitizeTaps(current.taps, current.startedAt, Date.now()) : [];
    const live = M.tapPayout(current.stake, valid.length);
    art.paintTapScene(g, r.width, r.height, {
      timeFrac: left / M.TAP_SECONDS,
      timeLeft: left.toFixed(1),
      heat: Math.min(1, (live.mult - 1) / 5),
      multLabel: live.mult.toFixed(2) + '\u00d7',
      pulse: current.pulse || 0,
      bursts: current.bursts || []
    });
  }

  function onTap(ev) {
    if (!current || current.mode !== 'tap' || !current.startedAt) return;
    const now = Date.now();
    if (now - current.startedAt > ensure().math.TAP_SECONDS * 1000) return;
    current.taps.push(now);
    current.pulse = 1;
    const arena = $('#tapArena');
    const r = arena.getBoundingClientRect();
    current.bursts.push({
      x: ev.clientX - r.left,
      y: ev.clientY - r.top,
      t: now
    });
    current.bursts = current.bursts.filter((b) => now - b.t < 400).slice(-18);
    tapTick();
  }

  function tapTick() {
    if (!current || !current.startedAt) return;
    const M = ensure().math;
    const elapsed = (Date.now() - current.startedAt) / 1000;
    const left = Math.max(0, M.TAP_SECONDS - elapsed);
    $('#tapTime').textContent = left.toFixed(1);
    const valid = M.sanitizeTaps(current.taps, current.startedAt, Date.now());
    const live = M.tapPayout(current.stake, valid.length);
    $('#tapCount').textContent = String(valid.length);
    $('#tapMult').textContent = live.mult.toFixed(2) + '\u00d7';
    $('#tapLive').textContent = fmt(live.pay);
    current.pulse = Math.max(0, (current.pulse || 0) - 0.08);
    const now = Date.now();
    current.bursts = (current.bursts || []).filter((b) => now - b.t < 400);
    paintTap();
    if (left <= 0) finishTap();
  }

  async function finishTap() {
    if (!current || current.finishing) return;
    current.finishing = true;
    clearInterval(current.tick);
    const arena = $('#tapArena');
    if (arena) arena.onclick = null;
    const res = await bridge.command('bonus_tap_finish', {
      offer: current.offerId,
      taps: current.taps
    });
    const tap = res?.detail?.tap;
    if (tap) {
      $('#tapPay').textContent = '+' + fmt(tap.pay) + ' · ' + tap.mult + '\u00d7 · ' + tap.taps + ' taps';
      $('#tapMult').textContent = tap.mult.toFixed(2) + '\u00d7';
      $('#tapCount').textContent = String(tap.taps);
      $('#tapLive').textContent = fmt(tap.pay);
    }
    paintTap();
    const done = $('#tapDone');
    done.hidden = false;
    done.onclick = () => {
      close('tapBonusM');
      current = null;
    };
  }

  function openChoiceWheel() {
    ensure();
    if (current && current.spinRaf) {
      cancelAnimationFrame(current.spinRaf);
      current.spinRaf = 0;
    }
    ensureModal(
      'choiceWheelM',
      '<div class="sheet bonusSheet wheelSheet"><h2 class="wheelSr">TEMPLE STAKE WHEEL</h2><div class="sub wheelSr" id="cwSub"></div><canvas id="choiceWheelCv" width="600" height="400"></canvas><div class="bonusPay wheelSr" id="cwPay" aria-live="polite"></div><button class="bonusDone wheelHit" id="cwSpin">SPIN</button></div>'
    );
    current.mode = 'wheel';
    current.rotation = 0;
    current.winIndex = null;
    current.winMult = null;
    current.winPay = null;
    current.reveal = 0;
    current.buttonText = 'SPIN';
    $('#cwSub').textContent = 'Stake ' + fmt(current.stake);
    $('#cwPay').textContent = '';
    const btn = $('#cwSpin');
    btn.textContent = 'SPIN';
    btn.disabled = false;
    btn.onclick = spinChoiceWheel;
    open('choiceWheelM');
    requestAnimationFrame(paintChoiceWheel);
  }

  function choiceWheelState() {
    if (!current) return null;
    return {
      stake: current.stake,
      rotation: current.rotation || 0,
      winIndex: current.winIndex,
      winMult: current.winMult,
      winPay: current.winPay,
      reveal: current.reveal || 0,
      buttonText: current.buttonText || 'SPIN',
      seed: 9,
      paintButton: true
    };
  }

  function paintChoiceWheel() {
    ensure();
    const cv = $('#choiceWheelCv');
    const sheet = cv && cv.closest('.wheelSheet');
    if (!cv || !art || !current || current.mode !== 'wheel') return;
    const r = (sheet || cv.parentElement).getBoundingClientRect();
    const W = Math.max(1, r.width || 740);
    const H = Math.max(1, r.height || 360);
    const g = sizeCanvas(cv, W, H);
    const L = art.paintStakeWheelScene(g, W, H, choiceWheelState());
    const btn = $('#cwSpin');
    if (btn && L) {
      btn.style.left = L.btnX + 'px';
      btn.style.top = L.btnY + 'px';
      btn.style.width = L.btnW + 'px';
      btn.style.height = L.btnH + 'px';
    }
  }

  function playWheelTick() {
    const sfx = root.__reef && root.__reef.Sfx;
    if (sfx && typeof sfx.tick === 'function') sfx.tick();
  }

  function playWheelWin() {
    const sfx = root.__reef && root.__reef.Sfx;
    if (sfx && typeof sfx.big === 'function') sfx.big();
    else if (sfx && typeof sfx.coin === 'function') sfx.coin();
  }

  function reducedWheelMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  async function spinChoiceWheel() {
    if (!bridge || !current) return;
    const btn = $('#cwSpin');
    btn.disabled = true;
    current.buttonText = 'SPINNING\u2026';
    btn.textContent = 'SPINNING\u2026';
    paintChoiceWheel();
    const res = await bridge.command('bonus_wheel', { offer: current.offerId });
    const wheel = res && res.detail && res.detail.bonusWheel;
    if (!wheel) {
      btn.disabled = false;
      current.buttonText = 'RETRY';
      btn.textContent = 'RETRY';
      paintChoiceWheel();
      return;
    }
    const M = ensure().math;
    const n = M.CHOICE_WHEEL.length;
    const idx = M.wheelIndexForMult(wheel.mult);
    const target = M.wheelTargetRotation(idx, n);
    // Server result is the only landing input — no jackpot-seeking offset.
    const landed = M.wedgeAtPointer(target, n);
    if (M.CHOICE_WHEEL[landed][0] !== wheel.mult) {
      console.warn('stake wheel landing mismatch', { idx, landed, mult: wheel.mult });
    }
    const duration = reducedWheelMotion() ? 200 : M.WHEEL_SPIN_MS;
    const t0 = (root.performance && performance.now()) || Date.now();
    let lastWedge = M.wedgeAtPointer(current.rotation || 0, n);
    current.winIndex = null;
    current.reveal = 0;

    const step = (now) => {
      if (!current || current.mode !== 'wheel') return;
      const t = Math.max(0, Math.min(1, (now - t0) / duration));
      const angle = duration <= 220 ? target : M.wheelSpinAngle(t, target);
      current.rotation = angle;
      const wedge = M.wedgeAtPointer(angle, n);
      if (wedge !== lastWedge) {
        lastWedge = wedge;
        playWheelTick();
      }
      paintChoiceWheel();
      if (t < 1) {
        current.spinRaf = requestAnimationFrame(step);
        return;
      }
      current.rotation = target;
      current.winIndex = idx;
      current.winMult = wheel.mult;
      current.winPay = wheel.pay;
      current.reveal = 1;
      current.buttonText = 'COLLECT';
      $('#cwPay').textContent = fmtM(wheel.mult) + '  =  ' + fmt(wheel.pay);
      playWheelWin();
      paintChoiceWheel();
      btn.textContent = 'COLLECT';
      btn.disabled = false;
      btn.onclick = () => {
        if (current && current.spinRaf) cancelAnimationFrame(current.spinRaf);
        close('choiceWheelM');
        current = null;
      };
    };
    current.spinRaf = requestAnimationFrame(step);
  }

  function fmtM(m) {
    const M = ensure().math;
    return M.fmtWheelMult ? M.fmtWheelMult(m) : m + '\u00d7';
  }

  function showCooldown(ms) {
    const sec = Math.ceil(ms / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    root.__reef?.toast?.('Bonus ready in ' + h + 'h ' + m + 'm · Relic paid normally');
  }

  function bind(api) {
    bridge = api;
  }

  root.ReefBonusChoiceUI = {
    bind,
    openChoice: paintChoiceMenu,
    showCooldown,
    get current() {
      return current;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
