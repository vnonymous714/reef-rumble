/* Telegram Mini App mode. Active only inside Telegram AND when RR_API is set.
   The server holds the balance; this file syncs play results and swaps the store to Telegram Stars packs.
   Play credits only: no cash value, no cash-out, no withdrawals. */
(function () {
  'use strict';
  var W = window.Telegram && window.Telegram.WebApp, API = window.RR_API, R = window.__reef, T = window.RRT;
  if (!W || !W.initData || !API || !R) return;
  document.documentElement.classList.add('tgmode');
  try { W.ready(); W.expand(); } catch (e) {}
  try { W.disableVerticalSwipes && W.disableVerticalSwipes(); } catch (e) {}  /* aiming drags must not swipe the mini app closed */
  var S = R.S, init = W.initData, anchor = S.bal, gAcc = 0, pending = [], wSent = window.__rrW || 0, seq = 0, ready = false, busy = false, packs = [];
  var GR = { deposit_credit: 1, bonus_credit: 1, refill: 1, daily_bonus: 1 };
  function call(path, body) {
    body = body || {}; body.initData = init;
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status }); return j; }); });
  }
  function apply(v, cur) {
    var drift = S.bal - cur;                   /* local changes made while the request was in flight */
    S.bal = Math.max(0, v.balance + drift); anchor = v.balance;
    S.bonus = v.bonus; S.pt = Math.min(v.pt, v.bonus * 10); seq = v.seq;
    if (v.season) S.welcomed = true;
    try { window.__slotsBridge && window.__slotsBridge.credit(0); } catch (e) {}  /* persist */
    try { R.updatePtHud(); } catch (e) {}
  }
  function step() {
    if (busy || !ready) return; busy = true;
    var cur = S.bal, g = gAcc, grants = pending.splice(0), wNow = window.__rrW || 0, w = wNow - wSent, d = cur - anchor - g;
    /* a win that lands after its bet already synced (bullet still in flight) has w = 0; the server only accepts wins with a wager, so hold it for the next sync */
    var hold = (d > 0 && !w) ? d : 0; d -= hold;
    gAcc -= g; wSent = wNow;
    var p = (d || w) ? call('/api/sync', { seq: seq + 1, d: Math.round(d), w: Math.round(w) }) : call('/api/me');
    if (grants.length) p = p.catch(function () {});  /* a failed sync must not drop a FREE / daily grant chained behind it */
    grants.forEach(function (k) { if (k.kind !== 'bonus_credit') p = p.then(function () { return call('/api/grant', { kind: k.kind, amt: k.amt, season: 'class1' }); }); });
    p.then(function (v) { if (!v) throw 0; apply(v, cur - hold); })
      .catch(function () { return call('/api/me').then(function (v) { apply(v, cur); }); })
      .catch(function () {}).then(function () { busy = false; });
  }
  /* grants made by the game are sent to the server, which enforces cooldowns / once-per-season */
  var origCredit = T.credit;
  T.credit = function (type, amt) { if (GR[type] && ready) { gAcc += amt; pending.push({ kind: type, amt: amt }); setTimeout(step, 50); } return origCredit.apply(T, arguments); };
  /* store: Stars packs */
  var box = document.getElementById('packs'), sub = document.querySelector('#storeM .sub'), rb = document.getElementById('rebuyBtn');
  /* Stars mode: no cash-out of any kind */
  var cb = document.getElementById('cashBtn'); if (cb) cb.style.display = 'none';
  var fine = document.querySelector('.fine'); if (fine) fine.textContent = 'Play credits only \u00B7 Credits have no cash value \u00B7 No cash-out';
  if (sub) sub.textContent = 'Buy play credits with Telegram Stars. Credits are for play only, have no cash value, and can never be cashed out, withdrawn, or transferred.';
  function fmt(c) { return (c / 100).toLocaleString('en-US'); }
  function renderPacks() {
    box.innerHTML = packs.map(function (p, i) { return '<div class="pack"><div class="amt">' + fmt(p.c) + '<small>CREDITS</small></div>' + (p.bonus ? '<em>+ ' + fmt(p.bonus) + ' BONUS</em>' : '<em>&nbsp;</em>') + '<button class="buy" data-star="' + i + '" style="touch-action:manipulation">\u2B50 ' + p.stars + ' Stars</button></div>'; }).join('');
  }
  /* Rebuy in Stars mode: same packs, same server-confirmed invoice flow; nothing is granted locally.
     Tap felt delayed because buy waited on /api/invoice with no feedback — prefetch + instant pressed/busy. */
  var rm = document.getElementById('rebuyM'), rpre = document.getElementById('rebuyPresets');
  var invCache = {}, buying = false, armed = null;
  function prefetch(i) {
    if (invCache[i]) return invCache[i].p || Promise.resolve(invCache[i]);
    var p = call('/api/invoice', { pack: i }).then(function (r) { invCache[i] = { link: r.link }; return invCache[i]; })
      .catch(function (e) { delete invCache[i]; throw e; });
    invCache[i] = { p: p }; return p;
  }
  function warmInvoices() { for (var i = 0; i < packs.length; i++) prefetch(i); }
  if (rm && rpre) {
    var rsub = rm.querySelector('.sub'), rrow = rm.querySelector('.rebuyRow');
    if (rsub) rsub.textContent = 'Rebuy play credits with Telegram Stars. Credits are added only after payment succeeds. Play credits only: no cash value, no cash-out.';
    if (rrow) rrow.style.display = 'none';
    rpre.innerHTML = '<div class="note">Loading\u2026</div>';
    rpre.addEventListener('pointerdown', onPtrDown, true);
    rpre.addEventListener('pointerup', onPtrUp, true);
    rpre.addEventListener('pointercancel', onPtrUp, true);
    rpre.addEventListener('click', onBuyClick, true);
  }
  function renderRebuy() {
    if (!rpre) return;
    rpre.innerHTML = packs.map(function (p, i) {
      return '<button type="button" data-star="' + i + '" style="touch-action:manipulation">' + fmt(p.c) + ' <small>\u2B50 ' + p.stars + ' Stars' + (p.bonus ? ' \u00B7 +' + fmt(p.bonus) : '') + '</small></button>';
    }).join('');
  }
  box.addEventListener('pointerdown', onPtrDown, true);
  box.addEventListener('pointerup', onPtrUp, true);
  box.addEventListener('pointercancel', onPtrUp, true);
  box.addEventListener('click', onBuyClick, true);
  if (rb) rb.addEventListener('click', warmInvoices, true);
  var sb = document.getElementById('storeBtn'); if (sb) sb.addEventListener('click', warmInvoices, true);
  function setBusy(b, on) {
    if (!b) return;
    if (on) { b.disabled = true; b.classList.add('busy'); b.setAttribute('aria-busy', 'true'); }
    else { b.disabled = false; b.classList.remove('busy', 'pressed'); b.removeAttribute('aria-busy'); }
  }
  function onPtrDown(e) {
    var b = e.target.closest('[data-star]'); if (!b || b.disabled || buying) return;
    armed = b; b.classList.add('pressed');
    try { W.HapticFeedback && W.HapticFeedback.impactOccurred('light'); } catch (x) {}
  }
  function onPtrUp(e) {
    var b = armed; armed = null;
    if (!b) return;
    b.classList.remove('pressed');
    if (e.type === 'pointercancel') return;
    var over = e.target.closest && e.target.closest('[data-star]');
    if (over !== b) return;  /* dragged off — do not buy */
    e.preventDefault(); e.stopImmediatePropagation();
    startBuy(b);
  }
  function onBuyClick(e) {
    e.stopImmediatePropagation();
    var b = e.target.closest('[data-star]'); if (!b) return;
    startBuy(b);  /* keyboard / e2e / fallback; no-op if pointerup already started */
  }
  function startBuy(b) {
    if (!b || b.disabled || buying) return;
    var i = +b.dataset.star; if (!(i >= 0)) return;
    buying = true; setBusy(b, true);
    function open(link) {
      delete invCache[i];  /* one open per link; warm a fresh one after the sheet closes */
      try {
        W.openInvoice(link, function (status) {
          buying = false; setBusy(b, false); prefetch(i);
          if (status === 'paid') {
            var n = 0, iv = setInterval(function () { step(); if (++n > 6) clearInterval(iv); }, 1500);
            window.__slotsBridge && window.__slotsBridge.toast('Payment received: credits arrive in a moment');
          }
        });
      } catch (x) { buying = false; setBusy(b, false); alert('Store unavailable, try again.'); }
    }
    var hit = invCache[i];
    if (hit && hit.link) { open(hit.link); return; }
    (hit && hit.p ? hit.p : prefetch(i)).then(function (c) { open(c.link); })
      .catch(function () { buying = false; setBusy(b, false); alert('Store unavailable, try again.'); });
  }
  /* boot: server balance wins over any old local balance */
  var cur0 = S.bal;
  call('/api/me').then(function (v) {
    if (T.setPid) T.setPid(v.pid);
    packs = v.packs || []; renderPacks(); renderRebuy();
    gAcc = 0; pending = []; ready = true; wSent = window.__rrW || 0;
    apply(v, cur0);
    if (v.season) { var wm = document.getElementById('welcomeM'); if (wm && wm.classList.contains('open')) { try { window.__reef.closeM(wm); } catch (e) {} } }
  }).catch(function () { box.innerHTML = '<div class="note">Store offline. Credits have no cash value.</div>'; if (rpre) rpre.innerHTML = '<div class="note">Store offline.</div>'; });
  setInterval(step, 5000);
  document.addEventListener('visibilitychange', function () { if (document.hidden) step(); });
})();
