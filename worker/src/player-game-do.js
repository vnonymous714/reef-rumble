import { HotWorld, gameDoEnabled } from "./hot-world.js";
import { gameV2 } from "./game-v2.js";

export { gameDoEnabled };

/* One instance per account, placed near West Coast players (wnam). It keeps
   no durable state of its own; D1 is the ledger. SQLite-backed so it runs on
   the Workers Free plan. */
export class PlayerGame {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.hot = null;
  }

  // Plain fetch interface (no cloudflare:workers import) so Node tests can
  // load the Worker module directly.
  async fetch(req) {
    const m = await req.json();
    const out = m.op === "stats" ? await this.stats() : m.op === "evict" ? await this.evictForTest() : await this.play(m.accountId, m.body, m.tgId ?? null);
    return Response.json(out);
  }

  async play(accountId, body, tgId = null) {
    try {
      if (!this.hot || this.hot.accountId !== accountId) this.hot = new HotWorld(this.env, accountId);
      return { ok: true, data: await this.hot.play(body, { tgId }) };
    } catch (e) {
      if (!e.status) console.error("player do", e && e.stack || e);
      return { ok: false, status: e.status || 500, error: e.status ? e.message : "server error", code: e.code };
    }
  }

  async stats() {
    return { ok: true, stats: this.hot?.stats || null, cached: !!this.hot?.cache };
  }

  async evictForTest() {
    this.hot?.evict();
    return { ok: true };
  }
}

export async function playViaDo(env, accountId, body, tgId = null) {
  // The hint only applies when an object is first created, so it is part of
  // the name: changing GAME_DO_HINT moves players to fresh objects.
  const hint = env.GAME_DO_HINT || "wnam";
  const stub = env.PLAYER_GAME.get(env.PLAYER_GAME.idFromName(hint + ":" + accountId), { locationHint: hint });
  const t0 = Date.now();
  const res = await stub.fetch("https://player-game/play", { method: "POST", body: JSON.stringify({ accountId, body, tgId }) });
  const out = await res.json().catch(() => null);
  if (out?.ok && out.data?.runtime) out.data.runtime.hop = Date.now() - t0;
  if (!out || out.ok === false) {
    throw Object.assign(new Error(out?.error || "Game session busy; retry"), { status: out?.status || 503, ...(out?.code ? { code: out.code } : {}) });
  }
  return out.data;
}

export async function playGame(env, account, body) {
  if (gameDoEnabled(env, account)) return playViaDo(env, account.id, body, account.tg_id || null);
  return gameV2(env, account.id, body);
}
