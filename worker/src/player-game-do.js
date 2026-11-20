import { HotWorld, gameDoEnabled } from "./hot-world.js";
import { BatchedWorld } from "./batched-world.js";
import { gameV2 } from "./game-v2.js";

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
  }

  batchedOn() { return this.env.GAME_BATCH === "on"; }

  // Plain fetch interface (no cloudflare:workers import) so Node tests can
  // load the Worker module directly.
  async fetch(req) {
    const m = await req.json();
    const out = m.op === "stats" ? await this.stats()
      : m.op === "evict" ? await this.evictForTest()
      : m.op === "sync" ? await this.sync(m.accountId)
      : await this.play(m.accountId, m.body, m.tgId ?? null);
    return Response.json(out);
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
  async sync(accountId) {
    try {
      const r = await this.world(accountId).sync();
      this.hot?.invalidate?.();
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
export async function syncDo(env, accountId) {
  if (!env.PLAYER_GAME || !accountId || (env.GAME_DO_MODE || "off") === "off") return { ok: false, skipped: true };
  try {
    const res = await stubFor(env, accountId).fetch("https://player-game/sync", { method: "POST", body: JSON.stringify({ op: "sync", accountId }) });
    return (await res.json().catch(() => null)) || { ok: false };
  } catch (e) {
    console.error("syncDo", e && e.message || e);
    return { ok: false };
  }
}

export async function playGame(env, account, body) {
  if (gameDoEnabled(env, account)) return playViaDo(env, account.id, body, account.tg_id || null);
  return gameV2(env, account.id, body);
}
