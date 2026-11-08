/* Web account bridge: username/password login, server balance is source of truth.
   Play credits only — no cash-out. Bearer token in localStorage (Pages is cross-origin).
   First visit (no valid session): sign-up modal gates play. Telegram mini-app keeps tgbridge. */
(function () {
  'use strict';
  var API = window.RR_API, R = window.__reef, T = window.RRT;
  if (!API || !R) return;
  /* Skip gate when Telegram bridge owns the session (tgbridge handles Stars sync). */
  var inTg = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
  var KEY = 'reefrumble.session', tok = null, exp = 0, seq = 0, anchor = 0, gAcc = 0, pending = [], wSent = window.__rrW || 0, ready = false, busy = false, pubId = null, uname = null, gated = false, syncTimer = null;
  try {
    var s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s.token === 'string' && s.expires_at > Date.now()) { tok = s.token; exp = s.expires_at; }
  } catch (e) {}

  function saveSess(token, expires_at) {
    tok = token; exp = expires_at || (Date.now() + 7200000);
    try { localStorage.setItem(KEY, JSON.stringify({ token: tok, expires_at: exp })); } catch (e) {}
  }
  function clearSess() {
    if(window.RR_AUTHORITATIVE)window.ReefAuthority?.stop();
    var logoutHeaders=hdr();
    tok = null; exp = 0; pubId = null; uname = null; ready = false;
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { fetch(API + '/api/auth/logout', { method: 'POST', headers: logoutHeaders, body: '{}' }); } catch (e) {}
  }
  function hdr() {
    var h = { 'Content-Type': 'application/json',...(window.RR_AUTHORITATIVE?{'X-Reef-Protocol':'2'}:{}) };
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  }
  function call(path, body) {
    body = body || {};
    return fetch(API + path, { method: 'POST', headers: hdr(), body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status }); return j; }); });
  }
  function markWelcomed() {
    try {
      if (R && R.S) { R.S.welcomed = true; }
      var wm = document.getElementById('welcomeM');
      if (wm && wm.classList.contains('open') && R && R.closeM) R.closeM(wm);
    } catch (e) {}
  }
  function apply(v, cur) {
    if(window.RR_AUTHORITATIVE){if(v.public_id)pubId=v.public_id;if(v.username)uname=v.username;if(v.token)saveSess(v.token,v.expires_at);if(v.expires_at)exp=v.expires_at;paint();if(tok&&!inTg)window.ReefAuthority.session(tok).catch(function(e){R.toast(e.message);});return;}

    var S = R.S, drift = S.bal - cur;
    S.bal = Math.max(0, v.balance + drift); anchor = v.balance;
    S.bonus = v.bonus; S.pt = Math.min(v.pt, v.bonus * 10); seq = v.seq;
    if (v.season) S.welcomed = true;
    if (v.public_id) pubId = v.public_id;
    if (v.username) uname = v.username;
    if (v.token) saveSess(v.token, v.expires_at);
    if (v.expires_at) exp = v.expires_at;
    if (v.pid && T && T.setPidAcct) T.setPidAcct(v.pid);
    paint();
    try { window.__slotsBridge && window.__slotsBridge.credit(0); } catch (e) {}
    try { R.updatePtHud && R.updatePtHud(); } catch (e) {}
  }
  function paint() {
    var el = document.getElementById('pidTxt');
    if (el) el.textContent = pubId || (T && T.pid) || '—';
    var u = document.getElementById('acctUser');
    if (u) u.textContent = uname || (tok ? 'signed in' : 'guest');
    var row = document.getElementById('acctRow');
    if (row) row.style.display = tok ? 'block' : 'none';
    var ab = document.getElementById('authBtn');
    if (ab) ab.style.display = tok ? 'none' : '';
    var tit = document.getElementById('authTitle');
    if (tit) tit.textContent = gated ? 'Sign up to play' : 'Player account';
  }
  function setGated(on) {
    gated = !!on && !inTg;
    var m = document.getElementById('authM');
    if (m) {
      m.classList.toggle('gate', gated);
      var x = m.querySelector('[data-close]');
      if (x) x.style.display = gated ? 'none' : '';
    }
    paint();
  }
  function ensureSync() {
    if (inTg || syncTimer) return;
    syncTimer = setInterval(step, 4000);
    setTimeout(step, 300);
  }
  function step() {
    if(window.RR_AUTHORITATIVE){if(tok)window.ReefAuthority.refresh();return;}
    if (!tok || busy || !ready || inTg) return; busy = true;
    var S = R.S, cur = S.bal, g = gAcc, grants = pending.splice(0), wNow = window.__rrW || 0, w = wNow - wSent, d = cur - anchor - g;
    var hold = (d > 0 && !w) ? d : 0; d -= hold;
    gAcc -= g; wSent = wNow;
    var p = (d || w) ? call('/api/sync', { seq: seq + 1, d: Math.round(d), w: Math.round(w) }) : call('/api/me');
    if (grants.length) p = p.catch(function () {});
    grants.forEach(function (k) { if (k.kind !== 'bonus_credit') p = p.then(function () { return call('/api/grant', { kind: k.kind, amt: k.amt, season: 'class1' }); }); });
    p.then(function (v) { if (!v) throw 0; apply(v, cur - hold); })
      .catch(function (e) {
        if (e && e.status === 401) { clearSess(); requireAuth('signup'); return; }
        return call('/api/me').then(function (v) { apply(v, cur); });
      })
      .catch(function () {}).then(function () { busy = false; });
  }

  function requireAuth(tab) {
    if (inTg) return;
    setGated(true);
    openAuth(tab || 'signup');
  }
  function boot() {
    if (inTg) {
      /* Still show public_id from /api/me via tgbridge path — patched below after tg ready. */
      paint(); return;
    }
    if (!tok) { paint(); requireAuth('signup'); return; }
    call('/api/auth/me').then(function (v) {
      apply(v, R.S.bal); ready = true; anchor = v.balance; seq = v.seq;
      R.S.bal = v.balance; /* server is truth on login */
      markWelcomed();
      try { R.updatePtHud && R.updatePtHud(); } catch (e) {}
      ensureSync();
    }).catch(function () { clearSess(); paint(); requireAuth('signup'); });
  }

  function openAuth(tab) {
    var m = document.getElementById('authM'); if (!m) return;
    m.classList.add('open');
    document.getElementById('wrap').classList.add('modalOpen');
    setTab(tab || (gated ? 'signup' : 'login'));
    document.getElementById('authErr').textContent = '';
    paint();
  }
  function closeAuth() {
    if (gated) return;
    var m = document.getElementById('authM'); if (!m) return;
    m.classList.remove('open');
    if (!document.querySelector('.modal.open')) document.getElementById('wrap').classList.remove('modalOpen');
  }
  function setTab(tab) {
    document.getElementById('authLogin').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('authSignup').style.display = tab === 'signup' ? 'block' : 'none';
    document.querySelectorAll('#authTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
  }

  function onAuthed(v, toastMsg) {
    saveSess(v.token, v.expires_at);
    apply(v, R.S.bal); ready = true; anchor = v.balance; seq = v.seq; R.S.bal = v.balance;
    markWelcomed();
    setGated(false);
    closeAuth();
    paint();
    try { R.toast && R.toast(toastMsg); } catch (e) {}
    if (!inTg) ensureSync();
  }
  function onLogin(ev) {
    ev.preventDefault();
    var u = document.getElementById('loginUser').value.trim();
    var p = document.getElementById('loginPass').value;
    document.getElementById('authErr').textContent = '';
    call('/api/auth/login', { username: u, password: p }).then(function (v) {
      onAuthed(v, 'Signed in as ' + (v.username || v.public_id));
    }).catch(function (e) { document.getElementById('authErr').textContent = e.message || 'login failed'; });
  }
  function onSignup(ev) {
    ev.preventDefault();
    var u = document.getElementById('suUser').value.trim();
    var p = document.getElementById('suPass').value;
    var p2 = document.getElementById('suPass2').value;
    document.getElementById('authErr').textContent = '';
    if (p !== p2) { document.getElementById('authErr').textContent = 'passwords do not match'; return; }
    var body = { username: u, password: p };
    if (inTg && window.Telegram.WebApp.initData) {
      /* Prefer set-creds so TG id links automatically. */
      call('/api/auth/set-creds', { username: u, password: p, initData: window.Telegram.WebApp.initData }).then(done).catch(function () {
        call('/api/auth/signup', body).then(done).catch(fail);
      });
    } else {
      call('/api/auth/signup', body).then(done).catch(fail);
    }
    function done(v) {
      onAuthed(v, 'Account ' + v.public_id + ' ready · 50.00 credits');
    }
    function fail(e) { document.getElementById('authErr').textContent = e.message || 'signup failed'; }
  }

  /* Hook starting / daily grants onto server when logged in (non-TG). */
  if (!inTg && window.RRT) {
    var origCredit = T.credit;
    T.credit = function (type, amt) {
      if (ready && tok && (type === 'deposit_credit' || type === 'daily_bonus')) {
        gAcc += amt; pending.push({ kind: type, amt: amt }); setTimeout(step, 50);
      }
      return origCredit.apply(T, arguments);
    };
  }

  document.addEventListener('DOMContentLoaded', function () {});
  setTimeout(function () {
    var tabs = document.getElementById('authTabs');
    if (tabs) tabs.addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
    var lf = document.getElementById('loginForm'); if (lf) lf.addEventListener('submit', onLogin);
    var sf = document.getElementById('signupForm'); if (sf) sf.addEventListener('submit', onSignup);
    var ab = document.getElementById('authBtn'); if (ab) ab.addEventListener('click', function () { openAuth(tok ? 'login' : 'signup'); });
    var lo = document.getElementById('logoutBtn'); if (lo) lo.addEventListener('click', function () {
      clearSess(); paint();
      try { R.toast && R.toast('Signed out'); } catch (e) {}
      requireAuth('login');
    });
    document.querySelectorAll('#authM [data-close]').forEach(function (b) { b.addEventListener('click', closeAuth); });
    boot();
  }, 0);

  window.__rrAuth = {
    expired: function(){if(inTg){window.ReefAuthority?.stop();R.toast('Telegram session expired; reopen the game.');return;}clearSess();paint();requireAuth('login');},
    open: openAuth, token: function () { return tok; }, publicId: function () { return pubId; },
    refresh: step, gated: function () { return gated; }, require: requireAuth
  };
})();
