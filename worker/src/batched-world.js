/* Batched authoritative world for one account, run inside its PlayerGame
   Durable Object (GAME_BATCH="on").

   Why: write-through cost ~20 D1 rows per shot (receipt row + 2 indexes, the
   settle update, account, world, players, one ledger row + 3 indexes per
   bullet...). The free plan allows 100k D1 rows/day.

   How:
   - The DO's memory is the authority between flushes. Game V2 runs unchanged;
     its reads are answered from memory and its single commit plan
     (GAME_COMMIT) is applied in memory under the same CAS rules.
   - Durability before ack: every action that moves money (or is not a pure
     "state" tick) rewrites ONE journal row in the DO's own SQLite storage
     before the response leaves. If that put fails (e.g. DO row limit), the
     state is flushed to D1 synchronously instead; if both fail the action is
     rejected and memory is unchanged. Pure no-money ticks stay in memory
     (losing one on eviction cannot lose a credit; the client just resyncs).
   - Flush to D1 every FLUSH_MS (alarm), every FLUSH_MAX actions, at once for
     daily/bonus picks, and on demand (purchase, admin, link, logout).
     One flush = account row + world row + players row + one aggregated
     ledger row per (kind, tide) carrying the exact sums and the shot count n.
   - Fencing: economy_world.version is only ever written by this game, so it
     tells a restored journal whether D1 already has it. External writers
     (Stars, admin, link-tg) bump accounts.sync_seq; a flush that finds the
     account moved but the world at our base version rebases our exact delta
     onto the new row (no credit lost, none applied twice). */
import { RECEIPT_KEEP } from "./retention.js";
import { gameV2 } from "./game-v2.js";

export const FLUSH_MS = 5000;
export const FLUSH_MAX = 64;
export const RECEIPTS_KEPT = 32;
export const CLEAN_RELOAD_MS = 30_000;
export const IMMEDIATE = new Set(["daily", "bonus_chest", "bonus_wheel", "bonus_tap_finish"]);
const JOURNAL = "j";
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const err = (m, status = 503) => Object.assign(new Error(m), { status });

const R = {
  acctAll: norm("SELECT * FROM accounts WHERE id=?1"),
  acctAllQ: norm("SELECT * FROM accounts WHERE id=?"),
  acctLite: norm("SELECT sync_seq,tg_id,balance FROM accounts WHERE id=?"),
  worldAll: norm("SELECT * FROM economy_world WHERE account_id=?1"),
  worldAllQ: norm("SELECT * FROM economy_world WHERE account_id=?"),
  worldState: norm("SELECT state_json FROM economy_world WHERE account_id=?"),
  floor: norm("SELECT floor_seq FROM economy_retention WHERE account_id=?"),
  boost: norm("SELECT value FROM economy_config WHERE key='bonus_fish_boost_until'"),
  priorId: norm("SELECT id FROM economy_actions WHERE account_id=? AND id=?"),
  winner: norm("SELECT id FROM economy_actions WHERE account_id=? AND id=? AND status='settled'"),
  replay: norm("SELECT request_json,response_json,status FROM economy_actions WHERE account_id=?1 AND id=?2"),
  snapshot: norm("SELECT a.*,w.state_json,w.version AS world_version,COALESCE(r.floor_seq,0) receipt_floor FROM accounts a JOIN economy_world w ON w.account_id=a.id LEFT JOIN economy_retention r ON r.account_id=a.id WHERE a.id=?1"),
};

const emptyPending = () => ({ groups: {}, wins: [], actions: 0, since: 0 });
const baseOf = (account, world) => ({
  seq: account.sync_seq, balance: account.balance, pt: account.pt, bonus: account.bonus, version: world?.version || 0,
});
const moneyMoved = (plan, before) =>
  plan.command !== "state" || plan.wager || plan.paid || plan.next.balance !== before.balance ||
  plan.ledger.some((l) => l.wager || l.payout || l.gaming_payout || l.promo_credit || l.wager_refund);
const sumKeys = ["wager", "payout", "gaming_payout", "promo_credit", "wager_refund"];
/* Combat money (bullets, flight payouts, expiry refunds) shares one row per
   flush per tide: every report sums bet/win/credit/n across these types, so
   totals are unchanged and a flush costs one ledger insert (5 D1 rows incl.
   its 3 indexes + sqlite_sequence) instead of three. Daily, slot spins and
   bonus picks keep their own kind. */
const COMBAT = new Set(["launch", "state", "wager_refund", "attack"]);

/* Pure: fold one commit plan's ledger records into the pending aggregate. */
export function addPending(p, plan) {
  const out = { groups: { ...p.groups }, wins: p.wins.slice(), actions: p.actions + 1, since: p.since || plan.now };
  for (const l of plan.ledger) {
    const kind = COMBAT.has(l.kind) ? "launch" : l.kind, key = kind + "|" + l.rtp_period;
    const g = { ...(out.groups[key] || { kind, rtp_period: l.rtp_period, wager: 0, payout: 0, gaming_payout: 0, promo_credit: 0, wager_refund: 0, n: 0, ops: 0 }) };
    for (const k of sumKeys) g[k] += l[k] || 0;
    g.n += l.wager > 0 ? 1 : 0;
    g.ops++;
    g.balance_after = l.balance_after;
    g.created_at = l.created_at;
    g.account_seq = l.account_seq;
    out.groups[key] = g;
    if (l.gaming_payout > 0) out.wins.push({ kind: l.kind, win: l.gaming_payout, created_at: l.created_at, seq: l.account_seq, k: out.wins.length });
  }
  // Exact single settlements for the top-wins board, never sums.
  out.wins.sort((a, b) => b.win - a.win || b.created_at - a.created_at);
  out.wins = out.wins.slice(0, 10);
  return out;
}

class Stmt {
  constructor(w, sql, args = []) { this.w = w; this.sql = sql; this.key = norm(sql); this.args = args; }
  bind(...args) { return new Stmt(this.w, this.sql, args); }
  first(col) { return this.w.read(this, col); }
  async all() { throw err("batched world: unsupported read"); }
  async raw() { throw err("batched world: unsupported read"); }
  async run() { throw err("batched world: direct writes are not allowed"); }
}

export class BatchedWorld {
  /* storage: { get(k), put(k,v), setAlarm(ms) } (DO ctx.storage or a test fake). */
  constructor(env, accountId, storage, opts = {}) {
    this.env = env;
    this.accountId = accountId;
    this.storage = storage;
    this.s = null;
    this.unsaved = false;
    this.gate = Promise.resolve();
    this.rl = { win: 0, c: 0 };
    this.flushMs = opts.flushMs ?? FLUSH_MS;
    this.flushMax = opts.flushMax ?? FLUSH_MAX;
    this.stats = { loads: 0, restores: 0, journal: 0, journalFail: 0, flushes: 0, flushFail: 0, rebases: 0, discarded: 0, d1Fallback: 0, alarms: 0 };
    const w = this;
    this.db = {
      prepare: (sql) => new Stmt(w, sql),
      batch: async () => { throw err("batched world: direct writes are not allowed"); },
      exec: async () => { throw err("batched world: direct writes are not allowed"); },
    };
  }

  // ---- state ----
  floorOf(s) {
    // Compaction never runs here (no per-action receipts in D1); report the
    // window the in-memory receipts actually cover.
    const seq = s.account?.sync_seq || 0;
    return seq - (s.floor || 0) > RECEIPT_KEEP + 32 ? seq - RECEIPT_KEEP : s.floor || 0;
  }
  snapshotRow(s = this.s) {
    if (!s?.account || !s.world) return null;
    return { ...s.account, state_json: s.world.state_json, world_version: s.world.version, receipt_floor: this.floorOf(s) };
  }
  receipt(id, s = this.s) {
    const r = s.receipts.find((x) => x[0] === id);
    return r ? { request_json: r[1], response_json: r[2], status: "settled" } : null;
  }
  journalOf(s) {
    const { loadedAt, ...rest } = s;
    return rest;
  }

  async loadD1(now) {
    const db = this.env.DB, id = this.accountId;
    const [a, w, r, c] = await db.batch([
      db.prepare("SELECT * FROM accounts WHERE id=?1").bind(id),
      db.prepare("SELECT * FROM economy_world WHERE account_id=?1").bind(id),
      db.prepare("SELECT floor_seq FROM economy_retention WHERE account_id=?1").bind(id),
      db.prepare("SELECT value FROM economy_config WHERE key='bonus_fish_boost_until'"),
    ]);
    this.stats.loads++;
    const account = a.results?.[0] || null, world = w.results?.[0] || null;
    this.s = {
      v: 1, accountId: id, dirty: false,
      account, world,
      floor: r.results?.[0]?.floor_seq || 0,
      boost: c.results?.[0]?.value ?? 0,
      base: account ? baseOf(account, world) : null,
      pending: emptyPending(),
      attempts: [],
      receipts: this.s?.receipts || [],
      loadedAt: now,
    };
    this.unsaved = false;
    this.resync = false;
  }

  async ensure(now) {
    if (this.s && this.resync) {
      if (this.s.dirty) await this.flush(now, "resync"); // throws while D1 is down; stays flagged
      else await this.loadD1(now);
      this.resync = false;
      return;
    }
    if (this.s) {
      if (!this.s.dirty && !this.unsaved && now - this.s.loadedAt > CLEAN_RELOAD_MS) await this.loadD1(now);
      return;
    }
    const j = await this.storage.get(JOURNAL);
    if (j && j.v === 1 && j.accountId === this.accountId && j.dirty && j.account) {
      this.stats.restores++;
      this.s = { ...j, attempts: j.attempts || [], loadedAt: now };
      try { await this.flush(now, "restore"); }
      catch (e) { console.error("batched restore flush", e && e.stack || e); }
      // Serve from the journal even if D1 is unreachable; the alarm retries.
      return;
    }
    await this.loadD1(now);
  }

  // ---- Game V2 adapter ----
  mine(s, i = 0) { return Number(s.args[i]) === this.accountId; }
  async read(st, col) {
    const s = this.s, k = st.key;
    let v;
    if (k === R.boost) v = { value: s.boost };
    else if (!this.mine(st)) throw err("batched world: foreign account read");
    else if (k === R.acctAll || k === R.acctAllQ || k === R.acctLite) v = s.account && { ...s.account };
    else if (k === R.worldAll || k === R.worldAllQ || k === R.worldState) v = s.world && { ...s.world };
    else if (k === R.floor) v = { floor_seq: this.floorOf(s) };
    else if (k === R.priorId || k === R.winner) v = this.receipt(String(st.args[1])) ? { id: String(st.args[1]) } : null;
    else if (k === R.replay) v = this.receipt(String(st.args[1]));
    else if (k === R.snapshot) v = this.snapshotRow();
    else throw err("batched world: unsupported read");
    return col && v ? v[col] : v;
  }

  async commit(plan) {
    const s = this.s, prior = this.receipt(plan.id);
    if (prior) return { committed: prior, current: this.snapshotRow() }; // ON CONFLICT DO NOTHING
    const a = s.account, x = plan.expected;
    if (!a || a.sync_seq !== x.seq || a.balance !== x.balance || a.bonus !== x.bonus || a.pt !== x.pt || (s.world?.version || 0) !== x.version)
      return { committed: null, current: this.snapshotRow() };
    const next = {
      ...s,
      dirty: true,
      account: { ...a, ...plan.next },
      world: { account_id: this.accountId, enrolled_at: s.world?.enrolled_at ?? plan.now, ...plan.world },
      receipts: [...s.receipts, [plan.id, plan.canonical, plan.receipt]].slice(-RECEIPTS_KEPT),
      pending: addPending(s.pending, plan),
    };
    if (moneyMoved(plan, a)) {
      try { await this.persist(next, plan.now); }
      catch (e) {
        // The D1 fallback may have landed (response lost). Before serving the
        // next request, settle/re-read D1 so memory never trails it.
        this.resync = true;
        throw e;
      }
    }
    else this.unsaved = true;
    const wasDirty = s.dirty;
    this.s = next;
    if (!wasDirty && next.dirty) this.arm(plan.now);
    this.lastCommand = plan.command;
    return { committed: { request_json: plan.canonical, response_json: plan.receipt }, current: this.snapshotRow(next) };
  }

  async persist(next, now) {
    try {
      await this.storage.put(JOURNAL, this.journalOf(next));
      this.stats.journal++;
      this.unsaved = false;
      return;
    } catch (e) {
      this.stats.journalFail++;
      console.error("batched journal put failed; flushing to D1 instead", e && e.message || e);
    }
    // D1 becomes the durable copy for this action (throws -> action rejected).
    await this.flushState(next, now);
    if (next.stale) throw err("account changed underneath; retry", 503); // never ack an action D1 did not take
    this.stats.d1Fallback++;
  }

  arm(now) {
    try {
      const p = this.storage.setAlarm(now + this.flushMs);
      if (p && p.catch) p.catch((e) => console.error("batched setAlarm", e && e.message || e));
    } catch (e) { console.error("batched setAlarm", e && e.message || e); }
  }

  // ---- flush ----
  flushStatements(S) {
    const db = this.env.DB, id = this.accountId, A = S.account, B = S.base, V = S.world.version;
    const okS = "EXISTS(SELECT 1 FROM accounts WHERE id=?1 AND sync_seq=?2 AND balance=?3) AND COALESCE((SELECT version FROM economy_world WHERE account_id=?1),0)=?4";
    const stmts = [
      db.prepare("UPDATE accounts SET balance=?2,pt=?3,last_daily=?4,last_refill=?5,w_xp=?6,last_bonus_pick=?7,xp_curve=?8,sync_seq=?9 WHERE id=?1 AND sync_seq=?10 AND balance=?11 AND COALESCE((SELECT version FROM economy_world WHERE account_id=?1),0)=?12")
        .bind(id, A.balance, A.pt, A.last_daily ?? null, A.last_refill || 0, A.w_xp || 0, A.last_bonus_pick || 0, A.xp_curve || 2, A.sync_seq, B.seq, B.balance, B.version),
      db.prepare("INSERT INTO economy_world(account_id,state_json,version,enrolled_at) SELECT ?1,?5,?4,?6 WHERE EXISTS(SELECT 1 FROM accounts WHERE id=?1 AND sync_seq=?2 AND balance=?3) AND COALESCE((SELECT version FROM economy_world WHERE account_id=?1),0)=?7 ON CONFLICT(account_id) DO UPDATE SET state_json=excluded.state_json,version=excluded.version")
        .bind(id, A.sync_seq, A.balance, V, S.world.state_json, S.world.enrolled_at || 0, B.version),
      db.prepare(`UPDATE players SET balance=?5,pt=?6,sync_seq=?2,last_daily=?7,last_refill=?8 WHERE tg_id=(SELECT tg_id FROM accounts WHERE id=?1) AND sync_seq<>?2 AND ${okS}`)
        .bind(id, A.sync_seq, A.balance, V, A.balance, A.pt, A.last_daily ?? null, A.last_refill || 0),
    ];
    for (const g of Object.values(S.pending.groups)) {
      if (!sumKeys.some((k) => g[k]) && !g.n) continue; // no money, nothing to report
      stmts.push(db.prepare(`INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,gaming_payout,promo_credit,rtp_period,account_seq,wager_refund,n) SELECT ?1,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16 WHERE ${okS} ON CONFLICT DO NOTHING`)
        .bind(id, A.sync_seq, A.balance, V, `batch:${A.sync_seq}:${g.kind}:${g.rtp_period}`, g.kind, g.wager, g.payout, g.balance_after, g.created_at, g.gaming_payout, g.promo_credit, g.rtp_period, g.account_seq, g.wager_refund, g.n));
    }
    for (const w of S.pending.wins) {
      const bucket = Math.floor(w.created_at / 60000) * 60000, hour = Math.floor(w.created_at / 3600000) * 3600000;
      // Keep a win only while it can still be in its hour's top ten.
      stmts.push(db.prepare(`INSERT INTO economy_top_wins(ledger_id,account_id,kind,win,created_at,bucket) SELECT ?5,?1,?6,?7,?8,?9 WHERE ${okS} AND (SELECT COUNT(*) FROM economy_top_wins WHERE bucket>=?10 AND bucket<?11 AND win>=?7)<10 ON CONFLICT(ledger_id) DO NOTHING`)
        .bind(id, A.sync_seq, A.balance, V, -(id * 1e10 + w.seq * 100 + w.k), w.kind, w.win, w.created_at, bucket, hour, hour + 3600000));
    }
    stmts.push(db.prepare("SELECT a.*,COALESCE((SELECT version FROM economy_world WHERE account_id=?1),0) AS wv FROM accounts a WHERE a.id=?1").bind(id));
    return stmts;
  }

  rebase(S, row) {
    const { wv, ...d1 } = row, A = S.account, B = S.base;
    const dBal = A.balance - B.balance, dSeq = A.sync_seq - B.seq, dPt = A.pt - B.pt, dVer = S.world.version - B.version;
    let balance = d1.balance + dBal;
    if (balance < 0) { console.error("batched rebase clamped a negative balance", this.accountId, balance); balance = 0; }
    S.account = {
      ...d1,
      balance,
      pt: Math.max(0, Math.min(d1.bonus * 10, d1.pt + dPt)),
      sync_seq: d1.sync_seq + dSeq,
      last_daily: A.last_daily, last_refill: A.last_refill, w_xp: A.w_xp, last_bonus_pick: A.last_bonus_pick, xp_curve: A.xp_curve,
    };
    S.world = { ...S.world, version: wv + dVer };
    S.base = { seq: d1.sync_seq, balance: d1.balance, pt: d1.pt, bonus: d1.bonus, version: wv };
    for (const g of Object.values(S.pending.groups)) { g.balance_after = S.account.balance; g.account_seq = S.account.sync_seq; }
    this.stats.rebases++;
  }

  /* Flush S to D1 (mutates S on success). Returns S. Throws if D1 failed. */
  async flushState(S, now) {
    if (!S.dirty) return S;
    for (let attempt = 0; attempt < 4; attempt++) {
      const want = { version: S.world.version, seq: S.account.sync_seq, balance: S.account.balance };
      let res;
      try {
        res = await this.env.DB.batch(this.flushStatements(S));
      } catch (e) {
        // Outcome unknown: remember the attempt so a later flush can tell
        // "already applied" from "never applied".
        S.attempts = [...(S.attempts || []), { ...want, pending: clonePending(S.pending) }].slice(-4);
        this.stats.flushFail++;
        throw e;
      }
      const row = res[res.length - 1]?.results?.[0];
      if (!row) throw err("account missing", 403);
      if (row.wv === want.version && row.sync_seq === want.seq && row.balance === want.balance) {
        const { wv, ...d1 } = row;
        S.account = { ...d1 };
        S.base = baseOf(d1, S.world);
        S.pending = emptyPending();
        S.attempts = [];
        S.dirty = false;
        this.stats.flushes++;
        return S;
      }
      const hit = (S.attempts || []).find((t) => t.version === row.wv);
      if (hit) {
        // An earlier ambiguous flush did land: it is the real base now. Only
        // the remainder since then is still ours to apply.
        S.base = { seq: hit.seq, balance: hit.balance, pt: row.pt, bonus: row.bonus, version: hit.version };
        S.attempts = [];
        S.pending = pendingMinus(S.pending, hit.pending);
        continue;
      }
      if (row.wv === S.base.version) { this.rebase(S, row); continue; }
      if (row.wv >= S.world.version) {
        // D1 already holds this or a newer lineage (stale journal).
        this.stats.discarded++;
        console.error("batched: discarding stale state", this.accountId, { d1: row.wv, ours: S.world.version, base: S.base.version });
        const { wv, ...d1 } = row;
        Object.assign(S, { account: d1, base: baseOf(d1, { version: row.wv }), pending: emptyPending(), attempts: [], dirty: false, stale: true });
        return S;
      }
      // Someone else advanced the world (should never happen: one DO per
      // account). Keep the money exact: rebase our delta onto theirs.
      console.error("batched: world advanced outside this DO; rebasing", this.accountId, { d1: row.wv, base: S.base.version, ours: S.world.version });
      this.rebase(S, row);
    }
    throw err("flush contention; retry", 503);
  }

  async flush(now, reason = "") {
    if (!this.s || (!this.s.dirty && !this.unsaved)) return false;
    if (!this.s.dirty) { this.unsaved = false; return false; }
    const S = { ...this.s, account: { ...this.s.account }, world: { ...this.s.world }, base: { ...this.s.base }, pending: clonePending(this.s.pending), attempts: [...(this.s.attempts || [])] };
    try {
      await this.flushState(S, now);
    } catch (e) {
      this.s.attempts = S.attempts;
      throw e;
    }
    if (S.stale) { await this.loadD1(now); return true; }
    this.s = { ...S, receipts: this.s.receipts, loadedAt: this.s.loadedAt };
    this.unsaved = false;
    return true;
  }

  // ---- entry points (all serialized by the gate) ----
  locked(fn) {
    const prev = this.gate;
    let release;
    this.gate = new Promise((r) => (release = r));
    return prev.then(fn).finally(release);
  }
  rateOk(now, limit = 1200) {
    const w = Math.floor(now / 60000);
    if (this.rl.win !== w) this.rl = { win: w, c: 0 };
    return ++this.rl.c <= limit;
  }
  play(body, opts = {}) { return this.locked(() => this.playLocked(body, opts)); }
  async playLocked(body, { now = Date.now(), tgId = null, rng } = {}) {
    if (!this.rateOk(now)) throw err("slow down", 429);
    await this.ensure(now);
    if (!this.s.account) { this.s = null; throw err("protected or missing account", 403); }
    if (tgId != null && Number(this.s.account.tg_id) !== Number(tgId)) {
      // Linked/unlinked elsewhere: settle what we hold, then re-read D1.
      await this.flush(now, "tg-check");
      await this.loadD1(now);
      if (!this.s.account || Number(this.s.account.tg_id) !== Number(tgId)) throw err("account changed; retry", 409);
    }
    const t0 = Date.now(), env = { ...this.env, DB: this.db, GAME_COMMIT: (plan) => this.commit(plan) };
    this.lastCommand = null;
    const out = await gameV2(env, this.accountId, body, now, ...(rng ? [rng] : []));
    const p = this.s.pending;
    if (this.s.dirty && (IMMEDIATE.has(this.lastCommand) || p.actions >= this.flushMax || (p.since && now - p.since >= this.flushMs))) {
      try { await this.flush(now, "inline"); }
      catch (e) { console.error("batched inline flush (journal keeps it)", e && e.message || e); }
    }
    return { ...out, runtime: { ...(out.runtime || {}), do: 1, batched: 1, ms: Date.now() - t0 } };
  }
  /* Flush and forget memory so the next action re-reads D1 (after external writes). */
  sync(now = Date.now()) {
    return this.locked(async () => {
      if (!this.s) await this.ensure(now);
      const flushed = await this.flush(now, "sync");
      this.s = null;
      this.unsaved = false;
      return { flushed };
    });
  }
  alarm(now = Date.now()) {
    return this.locked(async () => {
      this.stats.alarms++;
      try {
        if (!this.s) await this.ensure(now); // restore flushes a dirty journal
        else await this.flush(now, "alarm");
      } catch (e) { console.error("batched alarm flush (journal keeps it)", e && e.message || e); }
      if (this.s?.dirty) this.arm(now + this.flushMs); // D1 down: back off and retry
      return { dirty: !!this.s?.dirty };
    });
  }
  evict() { this.s = null; this.unsaved = false; }
}

function clonePending(p) {
  return { groups: Object.fromEntries(Object.entries(p.groups).map(([k, g]) => [k, { ...g }])), wins: p.wins.map((w) => ({ ...w })), actions: p.actions, since: p.since };
}
/* What is still unflushed after an earlier (ambiguous) flush of `done` landed. */
export function pendingMinus(p, done) {
  const out = clonePending(p);
  for (const [key, d] of Object.entries(done?.groups || {})) {
    const g = out.groups[key];
    if (!g) continue;
    for (const k of [...sumKeys, "n", "ops"]) g[k] -= d[k] || 0;
    if (!g.ops) delete out.groups[key];
  }
  const seen = new Set((done?.wins || []).map((w) => w.seq + ":" + w.k + ":" + w.win));
  out.wins = out.wins.filter((w) => !seen.has(w.seq + ":" + w.k + ":" + w.win));
  out.actions = Math.max(0, out.actions - (done?.actions || 0));
  return out;
}
