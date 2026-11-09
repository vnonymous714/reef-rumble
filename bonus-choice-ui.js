/* Bonus Relic choice UI: menu + treasure chests + tap frenzy + stake wheel. */
(function (root) {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  let math = root.ReefBonusChoice;
  let bridge = null;
  let current = null; // { offerId, stake, mode }

  function ensureMath() {
    math = root.ReefBonusChoice || math;
    return math;
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
    if (!document.querySelector('.modal.open')) {
      root.__slotsBridge?.close?.();
    } else {
      root.__reef?.authoritativeView?.closeModal?.(m);
    }
  }

  function paintChoiceMenu(offer) {
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
      ['chest', 'TREASURE CHESTS', 'Pick 1 of 3 · 2× / 5× / 10×'],
      ['tap', 'TAP FRENZY', '20s free taps · rate raises mult']
    ];
    for (const [id, title, blurb] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<b>' + title + '</b><small>' + blurb + '</small>';
      b.onclick = () => pickGame(id);
      box.appendChild(b);
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

  function openChests() {
    ensureModal(
      'chestBonusM',
      '<div class="sheet bonusSheet"><h2>TEMPLE TREASURE CHESTS</h2><div class="sub" id="chSub"></div><div class="chestRow" id="chRow"></div><div class="bonusPay" id="chPay"></div><button class="bonusDone" id="chDone" hidden>COLLECT</button><div class="bonusNote">Server shuffled 2×·5×·10× · pick one chest</div></div>'
    );
    current.mode = 'chest';
    $('#chSub').textContent = 'Stake ' + fmt(current.stake) + ' · pick a chest';
    $('#chPay').textContent = '';
    $('#chDone').hidden = true;
    const row = $('#chRow');
    row.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.className = 'chestBtn';
      b.type = 'button';
      b.dataset.i = String(i);
      b.innerHTML = '<span class="chestMult">?</span>';
      b.onclick = () => claimChest(i);
      row.appendChild(b);
    }
    open('chestBonusM');
  }

  async function claimChest(i) {
    if (!bridge || !current) return;
    const res = await bridge.command('bonus_chest', { offer: current.offerId, pick: i });
    if (!res?.detail?.chest) return;
    const chest = res.detail.chest;
    const buttons = [...document.querySelectorAll('#chRow .chestBtn')];
    buttons.forEach((b, idx) => {
      b.disabled = true;
      b.classList.add('open');
      b.querySelector('.chestMult').textContent = chest.layout[idx] + '×';
      if (idx === chest.pick) b.style.boxShadow = 'inset 0 0 0 2px #ffe28a,0 0 28px rgba(255,220,100,.55)';
    });
    $('#chPay').textContent = '+' + fmt(chest.pay) + ' · ' + chest.mult + '×';
    const done = $('#chDone');
    done.hidden = false;
    done.onclick = () => {
      close('chestBonusM');
      current = null;
    };
  }

  function openTap() {
    ensureModal(
      'tapBonusM',
      '<div class="sheet bonusSheet"><h2>REEF TAP FRENZY</h2><div class="sub" id="tapSub"></div><div class="tapHud"><span>TIME <b id="tapTime">20.0</b></span><span>TAPS <b id="tapCount">0</b></span><span>MULT <b id="tapMult">1.00×</b></span><span>LIVE <b id="tapLive">0.00</b></span></div><div class="tapArena" id="tapArena">TAP!</div><div class="bonusPay" id="tapPay"></div><button class="bonusDone" id="tapDone" hidden>COLLECT</button><div class="bonusNote">Server clamps to ~12 taps/sec · 20 seconds</div></div>'
    );
    current.mode = 'tap';
    current.taps = [];
    current.startedAt = 0;
    $('#tapSub').textContent = 'Stake ' + fmt(current.stake) + ' · tap as fast as you can';
    $('#tapPay').textContent = '';
    $('#tapDone').hidden = true;
    $('#tapCount').textContent = '0';
    $('#tapMult').textContent = '1.00×';
    $('#tapLive').textContent = fmt(current.stake);
    $('#tapTime').textContent = '20.0';
    const arena = $('#tapArena');
    arena.onclick = onTap;
    open('tapBonusM');
    bridge.command('bonus_tap_start', { offer: current.offerId }).then((s) => {
      if (s?.detail?.tap?.startedAt) current.startedAt = s.detail.tap.startedAt;
      else current.startedAt = Date.now();
      current.tick = setInterval(tapTick, 100);
    });
  }

  function onTap(ev) {
    if (!current || current.mode !== 'tap' || !current.startedAt) return;
    const now = Date.now();
    if (now - current.startedAt > ensureMath().TAP_SECONDS * 1000) return;
    current.taps.push(now);
    const pulse = document.createElement('span');
    pulse.className = 'tapPulse';
    const arena = $('#tapArena');
    const r = arena.getBoundingClientRect();
    pulse.style.left = (ev.clientX - r.left - 35) + 'px';
    pulse.style.top = (ev.clientY - r.top - 35) + 'px';
    arena.appendChild(pulse);
    setTimeout(() => pulse.remove(), 450);
    tapTick();
  }

  function tapTick() {
    if (!current || !current.startedAt) return;
    const M = ensureMath();
    const elapsed = (Date.now() - current.startedAt) / 1000;
    const left = Math.max(0, M.TAP_SECONDS - elapsed);
    $('#tapTime').textContent = left.toFixed(1);
    const valid = M.sanitizeTaps(current.taps, current.startedAt, Date.now());
    const live = M.tapPayout(current.stake, valid.length);
    $('#tapCount').textContent = String(valid.length);
    $('#tapMult').textContent = live.mult.toFixed(2) + '×';
    $('#tapLive').textContent = fmt(live.pay);
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
      $('#tapPay').textContent = '+' + fmt(tap.pay) + ' · ' + tap.mult + '× · ' + tap.taps + ' taps';
      $('#tapMult').textContent = tap.mult.toFixed(2) + '×';
      $('#tapCount').textContent = String(tap.taps);
      $('#tapLive').textContent = fmt(tap.pay);
    }
    const done = $('#tapDone');
    done.hidden = false;
    done.onclick = () => {
      close('tapBonusM');
      current = null;
    };
  }

  function openChoiceWheel() {
    ensureModal(
      'choiceWheelM',
      '<div class="sheet bonusSheet"><h2>TEMPLE STAKE WHEEL</h2><div class="sub" id="cwSub"></div><div id="choiceWheelBox"><canvas id="choiceWheelCv" width="600" height="600"></canvas><div class="ptr dptr"></div></div><div class="bonusPay" id="cwPay"></div><button class="bonusDone" id="cwSpin">SPIN</button><div class="bonusNote">Weighted stake multipliers · max 400.00</div></div>'
    );
    current.mode = 'wheel';
    $('#cwSub').textContent = 'Stake ' + fmt(current.stake);
    $('#cwPay').textContent = '';
    paintMiniWheel();
    const btn = $('#cwSpin');
    btn.textContent = 'SPIN';
    btn.disabled = false;
    btn.onclick = spinChoiceWheel;
    open('choiceWheelM');
  }

  function paintMiniWheel() {
    const art = root.ReefDailyWheelArt;
    const cv = $('#choiceWheelCv');
    if (!cv || !art) return;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 600, 600);
    g.save();
    g.translate(300, 300);
    const prizes = ensureMath().CHOICE_WHEEL.map(([m]) => Math.round(current.stake * m));
    art.paintDailyTempleWheel(g, {
      R: 280,
      prizes,
      fmt: (c) => (c / Math.max(1, current.stake)).toFixed(c % current.stake === 0 ? 0 : 1) + '×',
      seed: 9
    });
    g.restore();
  }

  async function spinChoiceWheel() {
    if (!bridge || !current) return;
    const btn = $('#cwSpin');
    btn.disabled = true;
    btn.textContent = 'SPINNING…';
    const res = await bridge.command('bonus_wheel', { offer: current.offerId });
    const wheel = res?.detail?.bonusWheel;
    if (!wheel) {
      btn.disabled = false;
      btn.textContent = 'RETRY';
      return;
    }
    const cv = $('#choiceWheelCv');
    const idx = Math.max(0, ensureMath().CHOICE_WHEEL.findIndex(([m]) => m === wheel.mult));
    const n = ensureMath().CHOICE_WHEEL.length;
    const rot = 1800 - idx * (360 / n);
    cv.style.transition = 'transform 4s cubic-bezier(.08,.9,.12,1)';
    cv.style.transform = 'rotate(' + rot + 'deg)';
    setTimeout(() => {
      $('#cwPay').textContent = '+' + fmt(wheel.pay) + ' · ' + wheel.mult + '×';
      btn.textContent = 'COLLECT';
      btn.disabled = false;
      btn.onclick = () => {
        close('choiceWheelM');
        current = null;
      };
    }, 4100);
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
