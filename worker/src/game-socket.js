/* tg39: one WebSocket per tab, hosted by the player's Durable Object with the
   Hibernation API (ctx.acceptWebSocket + webSocketMessage/Close/Error).

   Why: every HTTP poll/launch was one Worker request + one Durable Object
   request. On a socket the upgrade is the only Worker request, outgoing
   messages (server pushes) are free, and incoming messages are billed by
   Cloudflare at 20:1 as Durable Object requests (Durable Objects pricing,
   footnote 2).

   Money path is unchanged: every socket command goes through the same
   PlayerGame.play() -> BatchedWorld/HotWorld -> gameV2() as POST
   /api/v2/game, with the same id/seq/receipt validation, stake caps, balance
   settlement and RTP. The socket layer adds:
   - auth at upgrade (session token or Telegram initData, checked by the
     Worker exactly like HTTP), session re-check every 5 min, max age 60 min,
     logout closes the account's sockets;
   - server push: the DO runs the SAME tg38 schedule (poll-schedule.js) the
     client ran, on the server's own world (flight-timed push when a shot
     lands, 3 s -> 6 s -> 8 s idle, nothing while every tab is hidden or after
     2 min without input), and broadcasts the resulting 'state' to the tabs;
   - sequence rebase: a client command formed one or more server pushes ago
     (seq N while pushes moved the account to N+k with no client command in
     between) is re-addressed to the current seq. This is exactly what the
     tg38 client did when a tap queued behind an in-flight poll. Any other
     stale sequence still fails 409 as before.
   All socket commands and pushes for one DO run one at a time (this.serial). */
import PS from "../../poll-schedule.js";
import motion from "../../reef-motion.js";

export const WS_PROTOCOL = "rr2";
export const WS = Object.freeze({
  MAX_MSG: 64 * 1024,
  REVALIDATE_MS: 5 * 60 * 1000,
  MAX_AGE_MS: 60 * 60 * 1000,
  SHOOT_WINDOW_MS: 1000,
  REBASE_KEEP: 64,
  MAX_SOCKETS: 8,
});

const b64urlDecode = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/* Sec-WebSocket-Protocol: "rr2, rrt.<session token>" or "rr2, rri.<base64url initData>".
   Browsers cannot set Authorization on a WebSocket; the protocol header keeps
   the token out of URLs (and access logs). */
export function parseProtocols(header) {
  const list = String(header || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.includes(WS_PROTOCOL)) return null;
  const t = list.find((s) => s.startsWith("rrt."));
  if (t) {
    const token = t.slice(4);
    return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? { token } : null;
  }
  const i = list.find((s) => s.startsWith("rri."));
  if (i && /^[A-Za-z0-9_-]{16,6000}$/.test(i.slice(4))) {
    try {
      const initData = b64urlDecode(i.slice(4));
      return initData.length <= 4096 ? { initData } : null;
    } catch { return null; }
  }
  return null;
}

export function rebaseBody(body, pushes, idMap) {
  if (!body || typeof body !== "object") return body;
  if (body.recoverOnly) {
    const r = idMap.get(body.id);
    return r ? { ...body, id: r.id, seq: r.seq } : body;
  }
  if (!Number.isSafeInteger(body.seq) || !pushes.size) return body;
  let s = body.seq, hops = 0;
  while (pushes.has(s) && hops++ < 256) s = pushes.get(s);
  if (s === body.seq) return body;
  const m = /^(0|[1-9][0-9]*)_([a-zA-Z0-9_-]{8,70})$/.exec(body.id || "");
  if (!m || Number(m[1]) !== body.seq) return body;
  const out = { ...body, seq: s, id: `${s}_${m[2]}` };
  idMap.set(body.id, { id: out.id, seq: s });
  while (idMap.size > WS.REBASE_KEEP) idMap.delete(idMap.keys().next().value);
  return out;
}

const nonce = () => {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return "sp" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export class SocketHost {
  /* game: the PlayerGame (ctx, env, play(accountId, body, tgId)). */
  constructor(game, { now = () => Date.now(), timers = globalThis } = {}) {
    this.g = game;
    this.now = now;
    this.timers = timers;
    this.chain = Promise.resolve();
    this.pushes = new Map();   // seq before a server push -> seq after it
    this.idMap = new Map();    // original action id -> rebased { id, seq }
    this.last = null;          // last snapshot this DO produced (any path)
    this.seq = null;
    this.lastActionAt = 0;
    this.launches = [];        // recent launch arrival times (shooting detection)
    this.released = false;
    this.timer = 0;
    this.gen = 0;
    this.due = 0;
    this.errors = 0;
    this.stats = { pushes: 0, pushFail: 0, cmds: 0, hints: 0, rebased: 0, opened: 0, closed: 0 };
  }
  /* GAME_WS_PUSH="client": the tab keeps its tg38 schedule and sends each 'state'
     over the socket (no server timers -> the object can hibernate between
     messages; incoming messages are billed 20:1). Default "server": the object
     runs that schedule and pushes (outgoing messages are free, but a pending
     setTimeout keeps the object in memory, billed as duration). */
  get mode() { return this.g.env.GAME_WS_PUSH === "client" ? "client" : "server"; }
  get ctx() { return this.g.ctx; }
  sockets() { try { return this.ctx.getWebSockets() || []; } catch { return []; } }
  meta(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  save(ws, m) { try { ws.serializeAttachment(m); } catch {} }
  serial(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); return true; } catch { return false; } }

  accept(meta, pair) {
    const [client, server] = pair;
    const open = this.sockets();
    // Bounded per account; the oldest tab is told to reconnect (HTTP meanwhile).
    if (open.length >= WS.MAX_SOCKETS) try { open[0].close(4008, "too many tabs"); } catch {}
    this.ctx.acceptWebSocket(server);
    const t = this.now();
    this.save(server, { ...meta, at: t, checked: t, input: t, hidden: false, paused: false });
    this.send(server, { t: "hello", push: this.mode });
    this.stats.opened++;
    return client;
  }

  /* Any result for this account (socket, push or HTTP) keeps the push plan current. */
  note(data, { fromPush = false, inSeq = null, command = null } = {}) {
    if (!data || !data.world) return;
    if (!this.last || data.seq >= this.last.seq) { this.last = data; this.seq = data.seq; }
    if (fromPush && Number.isSafeInteger(inSeq) && Number.isSafeInteger(data.seq) && data.seq !== inSeq) this.pushes.set(inSeq, data.seq);
    if (!fromPush && command) {
      this.pushes.clear();
      if (command !== "state") this.lastActionAt = this.now();
    }
  }

  async revalidate(ws, m, t) {
    if (t - (m.at || 0) > WS.MAX_AGE_MS) { try { ws.close(4002, "reconnect"); } catch {} return false; }
    if (m.th && t - (m.checked || 0) > WS.REVALIDATE_MS) {
      const row = await this.g.env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?1").bind(m.th).first().catch(() => undefined);
      if (row === undefined) return true; // D1 hiccup: keep going, re-check on the next message
      if (!row || row.expires_at < t) { try { ws.close(4001, "session ended"); } catch {} return false; }
      m.checked = t;
      this.save(ws, m);
    }
    return true;
  }

  async message(ws, raw) {
    if (typeof raw !== "string") { try { ws.close(1003, "text only"); } catch {} return; }
    if (raw === "ping") { this.send(ws, "pong"); return; } // normally answered by setWebSocketAutoResponse
    if (raw.length > WS.MAX_MSG) { try { ws.close(1009, "too big"); } catch {} return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { try { ws.close(1003, "bad json"); } catch {} return; }
    const t = this.now(), m = this.meta(ws);
    if (!m.accountId) { try { ws.close(1011, "no account"); } catch {} return; }
    if (!(await this.revalidate(ws, m, t))) return;
    if (msg && msg.t === "hint") return this.hint(ws, m, msg, t);
    if (!msg || msg.t !== "cmd" || typeof msg.rid !== "number") return;
    return this.command(ws, m, msg);
  }

  hint(ws, m, msg, t) {
    this.stats.hints++;
    const wasActive = this.anyActive(t);
    if (typeof msg.hidden === "boolean") m.hidden = msg.hidden;
    if (typeof msg.paused === "boolean") m.paused = msg.paused;
    if (msg.input || msg.hidden === false) m.input = t;
    this.save(ws, m);
    if (msg.rel) this.released = true;
    const nowActive = this.anyActive(t);
    // Shown again / back from inactivity / released the trigger: push now
    // (tg38 refreshed once in each of these cases). Otherwise re-plan.
    if (nowActive && (!wasActive || msg.hidden === false)) return this.plan(0);
    if (!nowActive) return this.cancel();
    if (msg.rel) return this.plan(); // shots in flight now get their collision-time push
    if (msg.input && (!this.due || this.due - t > PS.C.IDLE_STEPS[0][1])) return this.plan();
  }

  async command(ws, m, msg) {
    const env = this.g.env;
    const reply = (o) => this.send(ws, { t: "res", rid: msg.rid, ...o });
    let body = msg.body;
    if (env.GAME_MAINTENANCE === "1" || env.GAME_V2 !== "1") return reply({ ok: false, status: 503, error: "Economy paused; no new game action accepted" });
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ ok: false, status: 400, error: "bad request" });
    if (body.command === "attack") return reply({ ok: false, status: 400, error: "use authoritative projectile launch" });
    delete body.token; delete body.initData;
    const t = this.now();
    m.input = t;
    this.save(ws, m);
    if (body.command === "launch") {
      this.launches = this.launches.filter((x) => t - x < WS.SHOOT_WINDOW_MS);
      this.launches.push(t);
      this.released = false;
    }
    this.stats.cmds++;
    return this.serial(async () => {
      const b = rebaseBody(body, this.pushes, this.idMap);
      if (b !== body && !body.recoverOnly) this.stats.rebased++;
      const out = await this.g.play(m.accountId, b, m.tgId ?? null);
      if (out.ok) this.note(out.data, { command: body.command || "state" });
      else this.pushes.clear();
      reply(out.ok ? { ok: true, data: out.data } : { ok: false, status: out.status, error: out.error, code: out.code });
      this.plan();
    });
  }

  anyActive(t) {
    for (const ws of this.sockets()) {
      const m = this.meta(ws);
      if (!m.hidden && !m.paused && t - (m.input || 0) < PS.C.INACTIVE_MS) return true;
    }
    return false;
  }
  shooting(t) {
    if (this.released) return false;
    return this.launches.filter((x) => t - x < WS.SHOOT_WINDOW_MS).length >= 2;
  }
  cancel() { this.gen++; if (this.timer) try { this.timers.clearTimeout(this.timer); } catch {} this.timer = 0; this.due = 0; }

  /* The tg38 client schedule, evaluated on the server's own world. */
  delay(t) {
    const socks = this.sockets();
    if (!socks.length) return null;
    let visible = false, input = 0;
    for (const ws of socks) {
      const m = this.meta(ws);
      if (!m.hidden && !m.paused) visible = true;
      input = Math.max(input, m.input || 0);
    }
    if (!visible) return null;
    // Fresh connection or woken from hibernation: learn the world now.
    if (!this.last) return this.errors ? Math.min(PS.C.ERROR_MAX_MS, 1000 * 2 ** (this.errors - 1)) : 0;
    const w = this.last.world;
    // Same gating as tg38: the schedule itself ignores offers/pauses; a tab
    // showing a bonus/result/daily screen sends {paused:true} (tg38 skipped
    // its polls there), which makes the tab inactive above.
    const shooting = this.shooting(t);
    let flightAt = null;
    if (!shooting && w.projectiles && w.projectiles.length) {
      try { flightAt = PS.predictFlight(w, t, motion); } catch { flightAt = null; }
    }
    const d = PS.nextDelay({ hidden: false, now: t, serverNow: t, lastInputAt: input, lastActionAt: this.lastActionAt, world: w, flightAt, errors: this.errors });
    return d == null ? null : shooting ? Math.max(d, PS.C.FAST_MS) : d;
  }
  plan(force = null) {
    this.cancel();
    if (this.mode === "client") return;
    const t = this.now(), d = force != null ? force : this.delay(t);
    if (d == null) return;
    const gen = this.gen;
    this.due = t + d;
    this.timer = this.timers.setTimeout(() => { if (gen === this.gen) this.tick(); }, d);
  }

  tick() {
    this.timer = 0;
    this.due = 0;
    const t = this.now();
    if (!this.anyActive(t)) return;
    if (this.shooting(t)) return this.plan(PS.C.FAST_MS); // launches carry state
    return this.serial(() => this.push());
  }

  async push() {
    const socks = this.sockets();
    if (!socks.length) return;
    const m = this.meta(socks[0]);
    if (!m.accountId) return;
    const inSeq = Number.isSafeInteger(this.seq) ? this.seq : null;
    const body = inSeq != null ? { command: "state", seq: inSeq, id: `${inSeq}_${nonce()}` } : { command: "state", id: `0_${nonce()}` };
    let out = await this.g.play(m.accountId, body, m.tgId ?? null);
    if (!out.ok && out.status === 409 && inSeq != null) {
      // Moved elsewhere (HTTP fallback tab, admin, purchase): re-learn the seq.
      out = await this.g.play(m.accountId, { command: "state", id: `0_${nonce()}` }, m.tgId ?? null);
    }
    if (!out.ok) {
      this.errors++;
      this.stats.pushFail++;
      if (out.status === 401 || out.status === 403) { for (const ws of socks) try { ws.close(4003, "forbidden"); } catch {} return; }
      return this.plan();
    }
    this.errors = 0;
    this.stats.pushes++;
    this.note(out.data, { fromPush: true, inSeq: body.seq ?? null });
    const msg = JSON.stringify({ t: "push", data: out.data });
    for (const ws of this.sockets()) try { ws.send(msg); } catch {}
    this.plan();
  }

  closed(ws, code, reason) {
    this.stats.closed++;
    // Reply to the peer's Close frame (Cloudflare docs: webSocketClose()).
    try { if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) ws.close(code, reason); else ws.close(); } catch {}
    if (!this.sockets().some((s) => s !== ws)) this.cancel();
  }

  kick(tokenHash = null) {
    let n = 0;
    for (const ws of this.sockets()) {
      const m = this.meta(ws);
      if (tokenHash && m.th !== tokenHash) continue;
      try { ws.close(4001, "session ended"); n++; } catch {}
    }
    if (!tokenHash) this.cancel();
    return n;
  }
}
