import { HotWorld, doBackend, gameDoEnabled } from "./hot-world.js";
import { gameV2 } from "./game-v2.js";

export { gameDoEnabled };

export class PlayerGame {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.hot = new HotWorld(env, 0, doBackend(ctx));
  }

  async play(accountId, body, now) {
    try {
      this.hot.accountId = accountId;
      this.hot.env = this.env;
      const data = await this.hot.play(body, now);
      this.ctx.waitUntil(this.hot.scheduleFlush().catch((e) => console.error("do flush", e)));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: e.status || 500, error: e.message, code: e.code };
    }
  }

  async evictForTest() {
    this.hot.evict();
    return { ok: true };
  }

  async reconcile() {
    try {
      const data = await this.hot.flush();
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: e.status || 500, error: e.message };
    }
  }
}

export async function playViaDo(env, account, body, now = Date.now()) {
  const id = env.PLAYER_GAME.idFromName(String(account.id));
  const stub = env.PLAYER_GAME.get(id, { locationHint: "wnam" });
  const out = await stub.play(account.id, body, now);
  if (!out || out.ok === false) {
    throw Object.assign(new Error(out?.error || "Game session busy; retry"), {
      status: out?.status || 503,
      code: out?.code,
    });
  }
  return out.data;
}

export async function playGame(env, account, body) {
  if (gameDoEnabled(env, account)) {
    try {
      return await playViaDo(env, account, body);
    } catch (e) {
      if (e.status && e.status < 500) throw e;
      throw Object.assign(new Error(e.message || "Game session busy; retry"), { status: e.status || 503, code: e.code });
    }
  }
  return gameV2(env, account.id, body);
}
