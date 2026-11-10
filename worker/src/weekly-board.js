/* Weekly Catch Board. Cosmetic ranks only; no credit prizes.
   Week resets Monday 00:00 America/Los_Angeles. Play credits have no cash value. */
import { PROTECTED_TG_ID } from "./tg.js";

const TZ = "America/Los_Angeles";
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const EXCLUDE = /^(rrsmoke|rrdiag)/i;
const TOP = 10;

function partsAt(ms) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = p.value;
  return {
    weekday: o.weekday,
    y: +o.year,
    mo: +o.month,
    d: +o.day,
    h: +o.hour,
    mi: +o.minute,
    s: +o.second,
  };
}

function isMondayStart(p) {
  return p.weekday === "Mon" && p.h === 0 && p.mi === 0 && p.s === 0;
}
export function weekStartPt(ms) {
  if (!Number.isFinite(ms)) throw new Error("invalid time");
  let t = Math.floor(ms);
  const p = partsAt(t);
  const dow = DOW[p.weekday];
  if (dow == null) throw new Error("invalid weekday");
  t -= ((dow * 86400) + p.h * 3600 + p.mi * 60 + p.s) * 1000;
  // Land inside or just beside Monday 00:00:00, then snap to its first millisecond.
  for (let i = 0; i < 4000 && !isMondayStart(partsAt(t)); i++) t -= 1;
  if (!isMondayStart(partsAt(t))) throw new Error("week start");
  while (isMondayStart(partsAt(t - 1))) t -= 1;
  return t;
}

export function isExcludedAccount(a) {
  if (!a) return true;
  if (Number(a.tg_id) === PROTECTED_TG_ID) return true;
  const names = [a.username, a.public_id, a.pid];
  return names.some((n) => typeof n === "string" && EXCLUDE.test(n.trim()));
}

export function displayName(a) {
  if (a && typeof a.username === "string") {
    const u = a.username.trim();
    if (u && !EXCLUDE.test(u)) return u;
  }
  return (a && a.public_id) || "Player";
}

export function badgeFor(rankBosses, rankMult) {
  if (rankBosses === 1) return "Reef Champion";
  if (rankMult === 1) return "High Mark";
  if (rankBosses && rankBosses <= 3) return "Boss Hunter";
  if (rankMult && rankMult <= 3) return "Sharp Shot";
  return null;
}

export function tallyCatches(updates) {
  let bosses = 0, biggest = 0;
  for (const u of updates || []) {
    if (!u || !u.dead) continue;
    const m = Number(u.mult || u.multiplier || 0);
    if (Number.isFinite(m) && m > biggest) biggest = m;
    if (u.boss) bosses += 1;
  }
  return { bosses, biggestMult: biggest };
}

export function recordBind(weekStart, accountId, tally, now) {
  return [weekStart, accountId, tally.bosses || 0, tally.biggestMult || 0, now];
}

export const RECORD_SQL = `INSERT INTO weekly_catch_stats(week_start, account_id, bosses, biggest_mult, updated_at)
SELECT ?3, ?1, ?4, ?5, ?6 WHERE ?7
ON CONFLICT(week_start, account_id) DO UPDATE SET
  bosses = weekly_catch_stats.bosses + excluded.bosses,
  biggest_mult = MAX(weekly_catch_stats.biggest_mult, excluded.biggest_mult),
  updated_at = excluded.updated_at`;

const VISIBLE = `IFNULL(a.tg_id,0) IS NOT ${PROTECTED_TG_ID}
  AND lower(IFNULL(a.username,'')) NOT LIKE 'rrsmoke%'
  AND lower(IFNULL(a.username,'')) NOT LIKE 'rrdiag%'
  AND lower(IFNULL(a.public_id,'')) NOT LIKE 'rrsmoke%'
  AND lower(IFNULL(a.public_id,'')) NOT LIKE 'rrdiag%'
  AND lower(IFNULL(a.pid,'')) NOT LIKE 'rrsmoke%'
  AND lower(IFNULL(a.pid,'')) NOT LIKE 'rrdiag%'`;

export async function readBoard(db, accountId, now) {
  const weekStart = weekStartPt(now);
  const weekEnd = weekStartPt(weekStart + 7 * 86400000 + 2 * 3600000);
  const bosses = ((await db.prepare(
    `SELECT s.account_id, s.bosses, s.biggest_mult, a.username, a.public_id, a.pid, a.tg_id
     FROM weekly_catch_stats s JOIN accounts a ON a.id = s.account_id
     WHERE s.week_start=?1 AND s.bosses>0 AND ${VISIBLE}
     ORDER BY s.bosses DESC, s.biggest_mult DESC, s.updated_at ASC, s.account_id ASC
     LIMIT ${TOP}`,
  ).bind(weekStart).all()).results) || [];
  const multipliers = ((await db.prepare(
    `SELECT s.account_id, s.bosses, s.biggest_mult, a.username, a.public_id, a.pid, a.tg_id
     FROM weekly_catch_stats s JOIN accounts a ON a.id = s.account_id
     WHERE s.week_start=?1 AND s.biggest_mult>0 AND ${VISIBLE}
     ORDER BY s.biggest_mult DESC, s.bosses DESC, s.updated_at ASC, s.account_id ASC
     LIMIT ${TOP}`,
  ).bind(weekStart).all()).results) || [];
  const meRow = accountId
    ? await db.prepare("SELECT username, public_id, pid, tg_id FROM accounts WHERE id=?").bind(accountId).first()
    : null;
  const fullMine = accountId
    ? await db.prepare(
        `SELECT bosses, biggest_mult, updated_at FROM weekly_catch_stats
         WHERE week_start=?1 AND account_id=?2`,
      ).bind(weekStart, accountId).first()
    : null;
  let rankBosses = null, rankMult = null;
  if (fullMine && meRow && !isExcludedAccount(meRow)) {
    if (fullMine.bosses > 0) {
      const b = await db.prepare(
        `SELECT COUNT(*)+1 AS r FROM weekly_catch_stats s JOIN accounts a ON a.id=s.account_id
         WHERE s.week_start=?1 AND s.bosses>0 AND ${VISIBLE}
         AND (s.bosses>?2 OR (s.bosses=?2 AND (s.biggest_mult>?3 OR (s.biggest_mult=?3 AND (s.updated_at<?4 OR (s.updated_at=?4 AND s.account_id<?5))))))`,
      ).bind(weekStart, fullMine.bosses, fullMine.biggest_mult, fullMine.updated_at, accountId).first();
      rankBosses = Number(b.r);
    }
    if (fullMine.biggest_mult > 0) {
      const m = await db.prepare(
        `SELECT COUNT(*)+1 AS r FROM weekly_catch_stats s JOIN accounts a ON a.id=s.account_id
         WHERE s.week_start=?1 AND s.biggest_mult>0 AND ${VISIBLE}
         AND (s.biggest_mult>?2 OR (s.biggest_mult=?2 AND (s.bosses>?3 OR (s.bosses=?3 AND (s.updated_at<?4 OR (s.updated_at=?4 AND s.account_id<?5))))))`,
      ).bind(weekStart, fullMine.biggest_mult, fullMine.bosses, fullMine.updated_at, accountId).first();
      rankMult = Number(m.r);
    }
  }
  const row = (r, i) => ({
    rank: i + 1,
    name: displayName(r),
    bosses: r.bosses,
    biggestMult: r.biggest_mult,
  });
  return {
    weekStart,
    weekEnd,
    reset: "Monday 00:00 PT",
    bosses: bosses.map(row),
    multipliers: multipliers.map(row),
    me: meRow && !isExcludedAccount(meRow)
      ? {
          name: displayName(meRow),
          bosses: fullMine ? fullMine.bosses : 0,
          biggestMult: fullMine ? fullMine.biggest_mult : 0,
          rankBosses,
          rankMult,
          badge: badgeFor(rankBosses, rankMult),
        }
      : null,
  };
}

export default { weekStartPt, isExcludedAccount, displayName, badgeFor, tallyCatches, recordBind, RECORD_SQL, readBoard };
