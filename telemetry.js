/* Reef Rumble: anonymous play stats for a class project. Fun credits only.
   Non-blocking: batches events every ~2s (shots rolled up), fails silently offline.
   Uses only the public publishable key; the database only accepts bounded inserts. */
(function () {
  'use strict';
  var API = 'https://egjbonfvdoqsedmfqpro.supabase.co/rest/v1', KEY = 'sb_publishable_z-PQ9NDys1Lad2b6YygArw_uP7BpKeJ';
  var HDR = { apikey: KEY, 'Content-Type': 'application/json' };
  var pid = null;
  try { pid = localStorage.getItem('reefrumble.pid'); } catch (e) {}
  if (!/^[0-9a-f]{16}$/.test(pid || '')) {
    var a = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    pid = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { localStorage.setItem('reefrumble.pid', pid); } catch (e) {}
  }
  var short = 'Player-' + pid.slice(0, 4).toUpperCase();
  var G = null; /* bridge from game.js: { bal(), start, setBal(v) } */
  var q = [], acc = { bet: 0, win: 0, n: 0 }, started = false, MODE = 'normal';
  var cl = function (v, lo, hi) { v = Math.round(+v || 0); return v < lo ? lo : v > hi ? hi : v; };
  var bal = function () { try { return G ? cl(G.bal(), 0, 1e11) : null; } catch (e) { return null; } };
  function push(type, o) {
    o = o || {};
    if (q.length > 300) q.splice(0, q.length - 200);
    q.push({ player_id: pid, type: type, mode: MODE, bet: cl(o.bet, 0, 1e6), win: cl(o.win, 0, 1e10), credit: cl(o.credit, -1e11, 1e11), balance_after: bal(), n: cl(o.n, 0, 2000), meta: o.meta ? String(o.meta).slice(0, 24) : null });
  }
  function post(path, body, keep) {
    return fetch(API + path, { method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, HDR), body: JSON.stringify(body), keepalive: !!keep });
  }
  function rpc(fn, args) {
    return fetch(API + '/rpc/' + fn, { method: 'POST', headers: HDR, body: JSON.stringify(args || {}) }).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }
  var sending = false;
  function flush(keep) {
    if (acc.n > 0) { push('shots', acc); acc = { bet: 0, win: 0, n: 0 }; }
    if (!q.length || sending || (navigator.onLine === false && !keep)) return;
    var batch = q.splice(0, 60); sending = true;
    post('/events', batch, keep).then(function (r) { sending = false; if (!r.ok && r.status >= 500) q = batch.concat(q); })
      .catch(function () { sending = false; if (!keep) q = batch.concat(q).slice(0, 300); });
  }
  /* ---- admin balance commands (written only by the passcode-gated server function) ---- */
  var APPLIED = 'reefrumble.applied', applied = [];
  try { applied = JSON.parse(localStorage.getItem(APPLIED) || '[]') || []; } catch (e) {}
  function poll() {
    if (!G || document.hidden || navigator.onLine === false) return;
    rpc('rr_pending', { pid: pid }).then(function (rows) {
      (rows || []).forEach(function (c) {
        if (applied.indexOf(c.id) < 0) {
          var before = G.bal(), target = c.action === 'reset' ? G.start : c.action === 'set' ? c.amount : before + c.amount;
          target = Math.max(0, Math.min(1e11 - 1, Math.floor(target)));
          G.setBal(target);
          applied.push(c.id); applied = applied.slice(-60);
          try { localStorage.setItem(APPLIED, JSON.stringify(applied)); } catch (e) {}
          push('admin_adjust', { credit: target - before, meta: c.action });
        }
        rpc('rr_ack', { pid: pid, cmd_id: c.id }).catch(function () {});
      });
    }).catch(function () {});
  }
  window.RRT = {
    pid: pid, short: short,
    setMode: function (m) { MODE = m === 'underground' ? 'underground' : 'normal'; },
    getMode: function () { return MODE; },
    shot: function (b) { acc.bet += b; acc.n++; },
    win: function (pay, def, mult, kind) {
      if (!(pay > 0)) return;
      if (kind === 'wheel') push('wheel', { win: pay, meta: 'wheel x' + mult });
      else if (kind === 'jackpot') push('jackpot', { win: pay, meta: 'jackpot' });
      else if (def && def.boss) push('boss_catch', { win: pay, meta: def.id + ' x' + mult });
      else if (def && def.special === 'bomb') push('bomb', { win: pay, meta: 'bomb' });
      else if (def && def.special === 'chain') push('chain', { win: pay, meta: 'chain' });
      else if (mult >= 30) push('catch', { win: pay, meta: (def ? def.id : 'fish') + ' x' + mult });
      else acc.win += pay;
    },
    credit: function (type, amt) { push(type, { credit: amt }); },
    start: function (bridge) {
      if (started) return; started = true; G = bridge || null;
      push('session_start', { meta: (innerWidth + 'x' + innerHeight).slice(0, 24) });
      setInterval(function () { flush(false); }, 2000);
      setTimeout(poll, 2500); setInterval(poll, 10000);
      addEventListener('visibilitychange', function () { if (document.hidden) flush(true); });
      addEventListener('pagehide', function () { push('session_end'); flush(true); });
    }
  };
})();
