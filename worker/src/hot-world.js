/* In-memory per-player hot world with a durable WAL, flushed in order to D1.
   The Durable Object wrapper and the unit tests share this machine. */
import { prepareGameV2, commitPreparedGameAction } from "./game-v2.js";

export function memoryBackend() {
  let saved = { wal: [] };
  return {
    async load() {
      return { wal: saved.wal.map((e) => ({ ...e, pack: e.pack })) };
    },
    async save(_mem, wal) {
      saved = { wal: wal.map((e) => ({ ...e })) };
    },
  };
}

export function doBackend(ctx) {
  return {
    async load() {
      return (await ctx.storage.get("hot")) || { wal: [] };
    },
    async save(_mem, wal) {
      const slim = wal
        .filter((e, i, all) => !e.flushed || i >= all.length - 24)
        .map((e) => ({ flushed: !!e.flushed, pack: e.pack, response: e.response }));
      await ctx.storage.put("hot", { wal: slim });
    },
  };
}

export function gameDoEnabled(env, account) {
  const mode = env.GAME_DO_MODE || "off";
  if (mode === "off" || !env.PLAYER_GAME) return false;
  if (mode === "on") return true;
  if (mode === "preview") {
    if (!account || account.id === 1 || account.tg_id === 7313143643) return false;
    return !account.tg_id && /^(tg\d+|dosmoke|doqa)/i.test(account.username || "");
  }
  return false;
}

export class HotWorld {
  constructor(env, accountId, backend, { autoFlush = true } = {}) {
    this.env = env;
    this.accountId = accountId;
    this.backend = backend;
    this.mem = null;
    this.wal = [];
    this.flushing = null;
    this.autoFlush = autoFlush;
    this.gate = Promise.resolve();
  }

  evict() {
    this.mem = null;
  }

  async ensure() {
    if (this.mem) return;
    const saved = await this.backend.load();
    this.wal = saved.wal || [];
    const db = this.env.DB;
    const account = await db.prepare("SELECT * FROM accounts WHERE id=?").bind(this.accountId).first();
    if (!account) {
      const err = new Error("protected or missing account");
      err.status = 403;
      throw err;
    }
    const worldRow = await db.prepare("SELECT * FROM economy_world WHERE account_id=?").bind(this.accountId).first();
    const floor =
      (await db.prepare("SELECT floor_seq FROM economy_retention WHERE account_id=?").bind(this.accountId).first())
        ?.floor_seq || 0;
    const boost =
      Number((await db.prepare("SELECT value FROM economy_config WHERE key='bonus_fish_boost_until'").first())?.value) ||
      0;
    this.mem = {
      account: { ...account, receipt_floor: floor },
      world: worldRow ? JSON.parse(worldRow.state_json) : null,
      version: worldRow?.version || 0,
      floor,
      boost,
    };
    for (const entry of this.wal) {
      if (entry.flushed) continue;
      this.mem.account = { ...entry.pack.next, receipt_floor: floor };
      this.mem.world = entry.pack.result.w;
      this.mem.version = entry.pack.version + 1;
    }
  }

  walReplay(id) {
    const entry = [...this.wal].reverse().find((e) => e.pack.body.id === id);
    if (!entry) return undefined;
    return {
      request_json: entry.pack.canonical,
      response_json: JSON.stringify(entry.pack.receipt),
      status: "settled",
      local: entry,
    };
  }

  async play(body, now = Date.now(), rng) {
    const prev = this.gate;
    let release;
    this.gate = new Promise((r) => (release = r));
    await prev;
    try {
    return await this.playLocked(body, now, rng);
    } finally {
      release();
    }
  }

  async playLocked(body, now, rng) {
    await this.ensure();
    const local = this.walReplay(body.id);
    if (local?.local) {
      return { ...local.local.response, replayed: true, runtime: { do: true, hint: "wnam" } };
    }
    const d1Replay = await this.env.DB.prepare(
      "SELECT request_json,response_json,status FROM economy_actions WHERE account_id=? AND id=?",
    )
      .bind(this.accountId, body.id)
      .first();
    const response = await prepareGameV2(this.env, this.accountId, body, now, rng, {
      account: this.mem.account,
      world: this.mem.world,
      version: this.mem.version,
      floor: this.mem.floor,
      boostUntil: this.mem.boost,
      replay: d1Replay || null,
      onPack: async (pack, resp) => {
        this.mem.account = { ...pack.next, receipt_floor: this.mem.floor };
        this.mem.world = pack.result.w;
        this.mem.version = pack.version + 1;
        this.wal.push({ pack, response: resp, flushed: false });
      },
    });
    await this.backend.save(this.mem, this.wal);
    if (this.autoFlush) this.scheduleFlush();
    return { ...response, runtime: { ...(response.runtime || {}), do: true, hint: "wnam" } };
  }

  scheduleFlush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.flush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async flush() {
    await this.ensure();
    for (const entry of this.wal) {
      if (entry.flushed) continue;
      const committed = await commitPreparedGameAction(this.env.DB, entry.pack);
      if (!committed) {
        const existing = await this.env.DB.prepare(
          "SELECT request_json,response_json,status FROM economy_actions WHERE account_id=? AND id=?",
        )
          .bind(this.accountId, entry.pack.body.id)
          .first();
        if (existing?.status === "settled" && existing.request_json === entry.pack.canonical) {
          entry.flushed = true;
          continue;
        }
        return {
          ok: false,
          pending: this.wal.filter((e) => !e.flushed).length,
          balance: this.mem.account.balance,
          seq: this.mem.account.sync_seq,
        };
      }
      entry.flushed = true;
    }
    await this.backend.save(this.mem, this.wal);
    return {
      ok: true,
      pending: 0,
      balance: this.mem.account.balance,
      seq: this.mem.account.sync_seq,
    };
  }

  async ledger() {
    const d1 = await this.env.DB.prepare("SELECT balance, bonus, pt, sync_seq FROM accounts WHERE id=?").bind(
      this.accountId,
    ).first();
    await this.ensure();
    return {
      hot: { balance: this.mem.account.balance, pt: this.mem.account.pt, seq: this.mem.account.sync_seq },
      d1,
      pending: this.wal.filter((e) => !e.flushed).length,
    };
  }
}
