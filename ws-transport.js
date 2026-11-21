/* tg39 game WebSocket client. No DOM; the authority bridge owns the game.
   One socket per tab to <RR_API>/api/v2/ws, credential in the
   Sec-WebSocket-Protocol header ("rr2" + "rrt.<token>" or "rri.<initData>").
   - request(body): same body as POST /api/v2/game, same response/errors;
     rejects without a status if the socket drops mid-request (exactly like a
     failed fetch, so the bridge's pending/recover logic is unchanged);
   - server pushes ({t:'push'}) go to onPush; hints tell the server when the
     tab is hidden/paused, had input, or released the trigger;
   - reconnect with backoff 1, 2, 4 ... 30 s (+ jitter); 3 failed opens in a
     row -> HTTP only for 5 min (the tg38 polling path); no reconnects while
     hidden; "ping" every 45 s while visible (answered by the server runtime
     without waking the game object). */
(function (root) {
  "use strict";
  const C = Object.freeze({
    PROTOCOL: "rr2",
    REQUEST_MS: 10000,
    OPEN_MS: 8000,
    PING_MS: 45000,
    BACKOFF_MS: [1000, 2000, 4000, 8000, 16000, 30000],
    FAIL_LIMIT: 3,
    DISABLE_MS: 300000,
  });
  const b64url = (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  function protocols(cred) {
    if (cred && cred.token && /^[A-Za-z0-9_-]{32,128}$/.test(cred.token)) return [C.PROTOCOL, "rrt." + cred.token];
    if (cred && cred.initData) return [C.PROTOCOL, "rri." + b64url(cred.initData)];
    return null;
  }
  function wsUrl(api) {
    const u = new URL(String(api || "").replace(/\/+$/, "") + "/api/v2/ws");
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }
  // opts: { api, credential(): {token}|{initData}|null, hidden(): bool,
  //         WebSocket, setTimeout, clearTimeout, now(), random(),
  //         onPush(data), onOpen(), onClose(info), onAuthEnded() }
  function create(opts) {
    const WS = opts.WebSocket, st = opts.setTimeout, ct = opts.clearTimeout || (() => {}),
      now = opts.now || (() => Date.now()), rnd = opts.random || Math.random;
    const s = {
      ws: null, open: false, gen: 0, rid: 0, pending: new Map(), fails: 0, attempt: 0,
      disabledUntil: 0, stopped: true, timer: 0, timerGen: 0, pingGen: 0, lastRx: 0, rtt: 0,
      stats: { opens: 0, closes: 0, sent: 0, received: 0, pushes: 0, hints: 0, pings: 0, requests: 0, fallbacks: 0 },
    };
    const later = (fn, ms) => { const g = ++s.timerGen; if (s.timer) ct(s.timer); s.timer = st(() => { if (g === s.timerGen) { s.timer = 0; fn(); } }, ms); };
    function rejectAll(why) {
      for (const [, p] of s.pending) { p.reject(Object.assign(new Error(why || "connection lost"), { socket: true })); }
      s.pending.clear();
    }
    function schedulePing(gen) {
      const g = ++s.pingGen;
      st(() => {
        if (g !== s.pingGen || gen !== s.gen || !s.open) return;
        if (!opts.hidden?.()) { try { s.ws.send("ping"); s.stats.pings++; s.stats.sent++; } catch {} }
        schedulePing(gen);
      }, C.PING_MS);
    }
    function connect() {
      if (s.stopped || s.ws || !WS) return;
      if (opts.hidden?.()) return; // reconnect when visible
      if (now() < s.disabledUntil) return later(connect, s.disabledUntil - now());
      const prot = protocols(opts.credential && opts.credential());
      if (!prot) return;
      const gen = ++s.gen;
      let ws;
      try { ws = new WS(wsUrl(opts.api), prot); } catch { return failed(gen, false); }
      s.ws = ws;
      let opened = false;
      st(() => { if (gen === s.gen && !opened) { try { ws.close(); } catch {} failed(gen, false); } }, C.OPEN_MS);
      ws.onopen = () => {
        if (gen !== s.gen) return;
        opened = true; s.open = true; s.fails = 0; s.attempt = 0; s.lastRx = now(); s.stats.opens++;
        schedulePing(gen);
        try { opts.onOpen && opts.onOpen(); } catch {}
      };
      ws.onmessage = (e) => {
        if (gen !== s.gen) return;
        s.lastRx = now(); s.stats.received++;
        if (e.data === "pong") return;
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === "res") {
          const p = s.pending.get(m.rid);
          if (!p) return;
          s.pending.delete(m.rid);
          s.rtt = now() - p.sentAt;
          if (m.ok) p.resolve(m.data);
          else p.reject(Object.assign(new Error(m.error || "Request failed"), { status: m.status || 500, ...(m.code ? { code: m.code } : {}) }));
        } else if (m.t === "push") {
          s.stats.pushes++;
          try { opts.onPush && opts.onPush(m.data); } catch {}
        }
      };
      ws.onclose = (e) => {
        if (gen !== s.gen) return;
        failed(gen, opened, e && e.code);
      };
      ws.onerror = () => {};
    }
    function failed(gen, wasOpen, code) {
      if (gen !== s.gen) return;
      s.gen++; // later events of this socket are ignored
      const ws = s.ws;
      s.ws = null; s.open = false; s.pingGen++;
      if (ws) try { ws.onopen = ws.onmessage = ws.onclose = null; } catch {}
      rejectAll("connection lost");
      s.stats.closes++;
      try { opts.onClose && opts.onClose({ code, wasOpen }); } catch {}
      if (s.stopped) return;
      if (code === 4001) { s.stopped = true; try { opts.onAuthEnded && opts.onAuthEnded(); } catch {} return; }
      if (code === 4003) { s.disabledUntil = now() + C.DISABLE_MS; s.stats.fallbacks++; }
      if (!wasOpen && ++s.fails >= C.FAIL_LIMIT) { s.fails = 0; s.disabledUntil = now() + C.DISABLE_MS; s.stats.fallbacks++; }
      const base = code === 4002 ? 0 : C.BACKOFF_MS[Math.min(s.attempt++, C.BACKOFF_MS.length - 1)];
      later(connect, Math.round(base * (0.5 + rnd() * 0.5)));
    }
    return {
      C,
      start() { s.stopped = false; connect(); },
      stop() { s.stopped = true; s.timerGen++; const ws = s.ws; s.gen++; s.ws = null; s.open = false; s.pingGen++; rejectAll("socket stopped"); if (ws) try { ws.onopen = ws.onmessage = ws.onclose = null; ws.close(1000, "bye"); } catch {} },
      restart() { this.stop(); s.fails = 0; s.attempt = 0; s.disabledUntil = 0; this.start(); },
      // tab shown again: reconnect at once if the socket died while hidden
      wake() { if (!s.stopped && !s.ws) { s.timerGen++; s.attempt = 0; connect(); } },
      ready() { return !!(s.open && s.ws && s.ws.readyState === 1); },
      request(body) {
        if (!this.ready()) return Promise.reject(Object.assign(new Error("socket not open"), { socket: true, notSent: true }));
        const rid = ++s.rid, gen = s.gen;
        return new Promise((resolve, reject) => {
          s.pending.set(rid, { resolve, reject, sentAt: now() });
          try { s.ws.send(JSON.stringify({ t: "cmd", rid, body })); s.stats.sent++; s.stats.requests++; }
          catch (e) { s.pending.delete(rid); return reject(Object.assign(new Error("socket not open"), { socket: true, notSent: true })); }
          st(() => {
            if (!s.pending.has(rid)) return;
            s.pending.delete(rid);
            reject(Object.assign(new Error("Request timed out"), { socket: true }));
            // a silent socket is a dead socket: drop it (reconnect + HTTP meanwhile)
            if (gen === s.gen && s.ws) { try { s.ws.close(); } catch {} failed(gen, true, 1006); }
          }, C.REQUEST_MS);
        });
      },
      hint(h) {
        if (!this.ready()) return false;
        try { s.ws.send(JSON.stringify({ t: "hint", ...h })); s.stats.sent++; s.stats.hints++; return true; } catch { return false; }
      },
      get lastRx() { return s.lastRx; },
      get rtt() { return s.rtt; },
      get stats() { return { ...s.stats, open: s.open, disabledFor: Math.max(0, s.disabledUntil - now()) }; },
    };
  }
  const api = { C, create, protocols, wsUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReefSocket = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
