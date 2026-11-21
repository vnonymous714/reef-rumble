import { HotWorld, gameDoEnabled } from "./hot-world.js";
import { BatchedWorld } from "./batched-world.js";
import { gameV2 } from "./game-v2.js";
import { SocketHost, WS_PROTOCOL } from "./game-socket.js";

export { gameDoEnabled };

/* One instance per account. GAME_BATCH="on": the DO is the authority between
   flushes (BatchedWorld: one journal row in DO SQLite per money action, D1
   flushed in aggregate). Otherwise: write-through hot cache (HotWorld), D1 is
   written before every response. Either way a dirty batched journal left by
   an earlier version is flushed to D1 before anything else runs. */
export class PlayerGame {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.hot = null;
    this.bw = null;
    this.drained = false;
    this.host = new SocketHost(this);
    // tg39: "ping" -> "pong" answered by the runtime without waking the object.
    try {
      if (typeof WebSocketRequestResponsePair === "function" && ctx.setWebSocketAutoResponse) ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {}
  }

  batchedOn() { return this.env.GAME_BATCH === "on"; }

  // Plain fetch interface (no cloudflare:workers import) so Node tests can
  // load the Worker module directly.
  async fetch(req) {
    if ((req.headers.get("Upgrade") || "").toLowerCase() === "websocket") return this.acceptSocket(req);
    const m = await req.json();
    const out = m.op === "stats" ? await this.stats()
      : m.op === "evict" ? await this.evictForTest()
      : m.op === "sync" ? await this.sync(m.accountId, m.kick)
      : await this.playHttp(m.accountId, m.body, m.tgId ?? null);
    return Response.json(out);
  }

  /* tg39 WebSocket (Hibernation API). The Worker already authenticated the
     upgrade; X-RR-Socket is only reachable through this object's stub. */
  acceptSocket(req) {
    let meta;
    try { meta = JSON.parse(req.headers.get("X-RR-Socket") || ""); } catch { meta = null; }
    if (!meta || !Number.isSafeInteger(meta.accountId)) return new Response("bad socket", { status: 400 });
    const pair = typeof WebSocketPair === "function" ? Object.values(new WebSocketPair()) : this.ctx.testPair();
    const client = this.host.accept({ accountId: meta.accountId, tgId: meta.tgId ?? null, th: meta.th || null, kind: meta.kind || "token" }, pair);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_PROTOCOL } });
  }
  async webSocketMessage(ws, message) { return this.host.message(ws, message); }
  async webSocketClose(ws, code, reason) { return this.host.closed(ws, code, reason); }
  async webSocketError(ws) { return this.host.closed(ws, 1006, ""); }

  async playHttp(accountId, body, tgId) {
    const out = await this.play(accountId, body, tgId);
    // A tab on HTTP fallback (or another device) moved the world: keep the
    // socket tabs' push plan and sequence map honest.
    if (out.ok && this.host.sockets().length) { this.host.note(out.data, { command: body?.command || "state" }); this.host.plan(); }
    return out;
  }

  world(accountId) {
    if (!this.bw || this.bw.accountId !== accountId) this.bw = new BatchedWorld(this.env, accountId, this.ctx.storage);
    return this.bw;
  }

  async drain(accountId) {
    if (this.drained) return;
    await this.world(accountId).sync(); // restore -> flush a dirty journal, then forget
    this.drained = true;
  }

  async play(accountId, body, tgId = null) {
    try {
      if (this.batchedOn()) return { ok: true, data: await this.world(accountId).play(body, { tgId }) };
      await this.drain(accountId);
      if (!this.hot || this.hot.accountId !== accountId) this.hot = new HotWorld(this.env, accountId);
      return { ok: true, data: await this.hot.play(body, { tgId }) };
    } catch (e) {
      if (!e.status) console.error("player do", e && e.stack || e);
      return { ok: false, status: e.status || 500, error: e.status ? e.message : "server error", code: e.code };
    }
  }

  /* Flush everything held for this account to D1 and drop the cache (before /
     after purchases, admin adjustments, linking, logout). */
  async sync(accountId, kick = null) {
    try {
      const r = await this.world(accountId).sync();
      this.hot?.invalidate?.();
      // After a sync D1 may hold a different seq (purchase/admin): re-learn it.
      this.host.seq = null; this.host.last = null; this.host.pushes.clear();
      if (kick) r.kicked = this.host.kick(typeof kick === "string" ? kick : null);
      return { ok: true, ...r };
    } catch (e) {
      console.error("player do sync", e && e.stack || e);
      return { ok: false, status: e.status || 500, error: "sync failed" };
    }
  }

  async alarm() {
    const j = await this.ctx.storage.get("j");
    if (!j?.accountId) return;
    await this.world(j.accountId).alarm();
  }

  async stats() {
    return { ok: true, stats: this.bw?.stats || this.hot?.stats || null, dirty: !!this.bw?.s?.dirty, cached: !!(this.bw?.s || this.hot?.cache) };
  }

  async evictForTest() {
    this.hot?.evict();
    this.bw?.evict();
    return { ok: true };
  }
}

function stubFor(env, accountId) {
  // The hint only applies when an object is first created, so it is part of
  // the name: changing GAME_DO_HINT moves players to fresh objects.
  const hint = env.GAME_DO_HINT || "wnam";
  return env.PLAYER_GAME.get(env.PLAYER_GAME.idFromName(hint + ":" + accountId), { locationHint: hint });
}

export async function playViaDo(env, accountId, body, tgId = null) {
  const stub = stubFor(env, accountId);
  const t0 = Date.now();
  const res = await stub.fetch("https://player-game/play", { method: "POST", body: JSON.stringify({ accountId, body, tgId }) });
  const out = await res.json().catch(() => null);
  if (out?.ok && out.data?.runtime) out.data.runtime.hop = Date.now() - t0;
  if (!out || out.ok === false) {
    throw Object.assign(new Error(out?.error || "Game session busy; retry"), { status: out?.status || 503, ...(out?.code ? { code: out.code } : {}) });
  }
  return out.data;
}

/* Best effort: correctness never depends on it (a flush that finds the account
   moved rebases its exact delta), it only makes D1 current right now. */
export async function syncDo(env, accountId, kick = null) {
  if (!env.PLAYER_GAME || !accountId || (env.GAME_DO_MODE || "off") === "off") return { ok: false, skipped: true };
  try {
    const res = await stubFor(env, accountId).fetch("https://player-game/sync", { method: "POST", body: JSON.stringify({ op: "sync", accountId, ...(kick ? { kick } : {}) }) });
    return (await res.json().catch(() => null)) || { ok: false };
  } catch (e) {
    console.error("syncDo", e && e.message || e);
    return { ok: false };
  }
}

/* tg39: hand an authenticated upgrade to the player's object. */
export function socketViaDo(env, accountId, meta) {
  return stubFor(env, accountId).fetch("https://player-game/ws", { headers: { Upgrade: "websocket", "X-RR-Socket": JSON.stringify({ accountId, ...meta }) } });
}

export async function playGame(env, account, body) {
  if (gameDoEnabled(env, account)) return playViaDo(env, account.id, body, account.tg_id || null);
  return gameV2(env, account.id, body);
}
