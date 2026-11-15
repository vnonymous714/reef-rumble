/* Write-through hot cache for one player's game state, run inside a West
   Coast Durable Object. D1 stays the ONLY ledger: every write is the normal
   guarded Game V2 batch, committed before the response. The cache only
   answers the reads Game V2 makes before that batch, so a stale cache can at
   worst make a guarded write miss (409, client retries) and is then refreshed
   from the same transaction's read-back. Nothing is ever acknowledged that D1
   has not committed. */
import { gameV2, SNAPSHOT_SQL } from "./game-v2.js";

export const OWNER_TG_ID = 7313143643;
const CACHE_TTL_MS = 30_000;
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const Q = {
  acctAll: norm("SELECT * FROM accounts WHERE id=?1"),
  acctAllQ: norm("SELECT * FROM accounts WHERE id=?"),
  acctLite: norm("SELECT sync_seq,tg_id,balance FROM accounts WHERE id=?"),
  worldAll: norm("SELECT * FROM economy_world WHERE account_id=?1"),
  worldAllQ: norm("SELECT * FROM economy_world WHERE account_id=?"),
  worldState: norm("SELECT state_json FROM economy_world WHERE account_id=?"),
  floor: norm("SELECT floor_seq FROM economy_retention WHERE account_id=?"),
  boost: norm("SELECT value FROM economy_config WHERE key='bonus_fish_boost_until'"),
  priorId: norm("SELECT id FROM economy_actions WHERE account_id=? AND id=?"),
  replay: norm("SELECT request_json,response_json,status FROM economy_actions WHERE account_id=?1 AND id=?2"),
  snapshot: norm(SNAPSHOT_SQL),
};

export function gameDoEnabled(env, account) {
  const mode = env.GAME_DO_MODE || "off";
  if (mode === "off" || !env.PLAYER_GAME || !account) return false;
  if (mode === "on") return true;
  if (mode === "preview") {
    // Throwaway QA accounts only. Never the owner's real account.
    if (account.id === 1 || Number(account.tg_id) === OWNER_TG_ID || account.tg_id) return false;
    return /^(dosmoke|doqa)/i.test(account.username || "");
  }
  return false;
}

class Stmt {
  constructor(hot, sql, args = []) {
    this.hot = hot;
    this.sql = sql;
    this.key = norm(sql);
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.hot, this.sql, args);
  }
  real() {
    const s = this.hot.env.DB.prepare(this.sql);
    return this.args.length ? s.bind(...this.args) : s;
  }
  first(col) {
    return this.hot.read(this, col);
  }
  async all() {
    return this.hot.forward(this, "all");
  }
  async raw(o) {
    return this.hot.forward(this, "raw", o);
  }
  async run() {
    return this.hot.forward(this, "run");
  }
}

export class HotWorld {
  constructor(env, accountId) {
    this.env = env;
    this.accountId = accountId;
    this.cache = null;
    this.ids = new Set();
    this.gate = Promise.resolve();
    this.rl = { win: 0, c: 0 };
    this.stats = { loads: 0, hits: 0, forwards: 0, batches: 0, invalidations: 0 };
    const hot = this;
    this.db = {
      prepare: (sql) => new Stmt(hot, sql),
      batch: (stmts) => hot.batch(stmts),
      dump: () => hot.env.DB.dump(),
      exec: (sql) => { hot.invalidate(); return hot.env.DB.exec(sql); },
    };
  }

  invalidate() {
    if (this.cache) this.stats.invalidations++;
    this.cache = null;
  }

  evict() {
    this.cache = null;
    this.ids.clear();
  }

  async load(now) {
    const db = this.env.DB, id = this.accountId;
    const [a, w, r, c] = await db.batch([
      db.prepare("SELECT * FROM accounts WHERE id=?1").bind(id),
      db.prepare("SELECT * FROM economy_world WHERE account_id=?1").bind(id),
      db.prepare("SELECT floor_seq FROM economy_retention WHERE account_id=?1").bind(id),
      db.prepare("SELECT value FROM economy_config WHERE key='bonus_fish_boost_until'"),
    ]);
    this.stats.loads++;
    this.cache = {
      at: now,
      account: a.results?.[0] || null,
      world: w.results?.[0] || null,
      floor: r.results?.[0] || null,
      boost: c.results?.[0] || null,
    };
  }

  fromSnapshot(row, now) {
    if (!row || !this.cache) return this.invalidate();
    const { state_json, world_version, receipt_floor, ...account } = row;
    this.cache.account = account;
    this.cache.world = { ...(this.cache.world || { account_id: this.accountId, enrolled_at: now }), state_json, version: world_version };
    this.cache.floor = receipt_floor ? { floor_seq: receipt_floor } : null;
  }

  mine(s, i = 0) {
    return Number(s.args[i]) === this.accountId;
  }

  async read(s, col) {
    const c = this.cache;
    let hit;
    if (c && s.args.length) {
      const k = s.key;
      if ((k === Q.acctAll || k === Q.acctAllQ || k === Q.acctLite) && this.mine(s)) hit = { v: c.account && { ...c.account } };
      else if ((k === Q.worldAll || k === Q.worldAllQ || k === Q.worldState) && this.mine(s)) hit = { v: c.world && { ...c.world } };
      else if (k === Q.floor && this.mine(s)) hit = { v: c.floor && { ...c.floor } };
      else if ((k === Q.priorId || k === Q.replay) && this.mine(s) && !this.ids.has(String(s.args[1]))) hit = { v: null };
      else if (k === Q.snapshot && this.mine(s) && c.account && c.world)
        hit = { v: { ...c.account, state_json: c.world.state_json, world_version: c.world.version, receipt_floor: c.floor?.floor_seq || 0 } };
    } else if (c && s.key === Q.boost) hit = { v: c.boost && { ...c.boost } };
    if (hit) {
      this.stats.hits++;
      return col && hit.v ? hit.v[col] : hit.v;
    }
    return this.forward(s, "first", col);
  }

  async forward(s, method, arg) {
    this.stats.forwards++;
    const write = !/^(SELECT|WITH)\b/i.test(s.key);
    try {
      const out = await s.real()[method](arg);
      if (write) this.invalidate();
      return out;
    } catch (e) {
      this.invalidate();
      throw e;
    }
  }

  async batch(stmts) {
    this.stats.batches++;
    const real = stmts.map((s) => (s instanceof Stmt ? s.real() : s));
    let results;
    try {
      results = await this.env.DB.batch(real);
    } catch (e) {
      this.invalidate();
      throw e;
    }
    const last = stmts[stmts.length - 1];
    if (last instanceof Stmt && last.key === Q.snapshot && this.mine(last)) {
      this.fromSnapshot(results[results.length - 1]?.results?.[0], Date.now());
      // Every action id committed or attempted through here may now exist.
      for (const s of stmts) if (s instanceof Stmt && /^INSERT INTO economy_actions/i.test(s.key)) this.ids.add(String(s.args[1]));
    } else {
      this.invalidate();
      this.ids.clear();
    }
    return results;
  }

  rateOk(now, limit = 1200) {
    const w = Math.floor(now / 60000);
    if (this.rl.win !== w) this.rl = { win: w, c: 0 };
    return ++this.rl.c <= limit;
  }

  async play(body, opts = {}) {
    const prev = this.gate;
    let release;
    this.gate = new Promise((r) => (release = r));
    await prev;
    try {
      return await this.playLocked(body, opts);
    } finally {
      release();
    }
  }

  async playLocked(body, { now = Date.now(), tgId = null, rng } = {}) {
    if (!this.rateOk(now)) throw Object.assign(new Error("slow down"), { status: 429 });
    if (!this.cache || now - this.cache.at > CACHE_TTL_MS) await this.load(now);
    const acct = this.cache.account;
    if (!acct) throw Object.assign(new Error("protected or missing account"), { status: 403 });
    if (tgId != null && Number(acct.tg_id) !== Number(tgId)) {
      this.invalidate();
      throw Object.assign(new Error("account changed; retry"), { status: 409 });
    }
    const t0 = Date.now(), f0 = this.stats.forwards, b0 = this.stats.batches;
    try {
      const out = await gameV2({ ...this.env, DB: this.db }, this.accountId, body, now, ...(rng ? [rng] : []));
      return { ...out, runtime: { ...(out.runtime || {}), do: 1, d1: this.stats.forwards - f0 + this.stats.batches - b0, ms: Date.now() - t0 } };
    } catch (e) {
      this.invalidate();
      throw e;
    }
  }
}
