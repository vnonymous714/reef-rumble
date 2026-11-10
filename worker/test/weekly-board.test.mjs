import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PROTECTED_TG_ID } from "../src/tg.js";
import {
  weekStartPt,
  isExcludedAccount,
  displayName,
  badgeFor,
  tallyCatches,
  readBoard,
} from "../src/weekly-board.js";

test("week starts Monday 00:00 America/Los_Angeles including around DST", () => {
  // Monday 2026-11-09 00:00 PST = 2026-11-09T08:00:00Z
  const mon = Date.parse("2026-11-09T08:00:00Z");
  assert.equal(weekStartPt(mon), mon);
  assert.equal(weekStartPt(mon + 12 * 3600000), mon);
  assert.equal(weekStartPt(mon + 6 * 86400000 - 1), mon);
  // Sunday Nov 8 is still the prior week (started Mon Nov 2, PST)
  const sun = Date.parse("2026-11-08T23:00:00Z");
  const prior = weekStartPt(sun);
  assert.ok(prior < mon);
  assert.equal(weekStartPt(prior), prior);
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(prior));
  const o = Object.fromEntries(p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  assert.equal(o.weekday, "Mon");
  assert.equal(o.hour, "00");
  assert.equal(o.minute, "00");
  // spring-forward neighborhood 2026-03-08 PDT start
  const beforeDst = Date.parse("2026-03-08T09:30:00Z");
  const start = weekStartPt(beforeDst);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(start));
  const q = Object.fromEntries(parts.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  assert.equal(q.weekday, "Mon");
  assert.equal(q.hour, "00");
});

test("excluded handles and the protected Telegram account never appear", () => {
  assert.equal(isExcludedAccount({ tg_id: PROTECTED_TG_ID, public_id: "RR-000001", username: "Ricky" }), true);
  assert.equal(isExcludedAccount({ username: "rrsmoke1", public_id: "RR-9" }), true);
  assert.equal(isExcludedAccount({ pid: "rrdiag-bot", public_id: "RR-8" }), true);
  assert.equal(isExcludedAccount({ username: "reef-lover", public_id: "RR-000010" }), false);
  assert.equal(displayName({ username: "  Maya  ", public_id: "RR-000010" }), "Maya");
  assert.equal(displayName({ username: "rrsmoke", public_id: "RR-000011" }), "RR-000011");
  assert.equal(badgeFor(1, 4), "Reef Champion");
  assert.equal(badgeFor(3, 2), "Boss Hunter");
  assert.equal(badgeFor(9, 1), "High Mark");
  assert.equal(badgeFor(9, 3), "Sharp Shot");
  assert.equal(badgeFor(9, 9), null);
});

test("tally uses real dead catches only", () => {
  const t = tallyCatches([
    { dead: true, boss: true, mult: 31 },
    { dead: true, boss: false, mult: 12 },
    { dead: false, boss: true, mult: 37 },
  ]);
  assert.equal(t.bosses, 1);
  assert.equal(t.biggestMult, 31);
  assert.deepEqual(tallyCatches([]), { bosses: 0, biggestMult: 0 });
});

function boot() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_accounts.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../proposals/0007_weekly_catch_board.sql", import.meta.url), "utf8"));
  // node:sqlite wrapper compatible with prepare().bind().first/all used by the worker
  const wrap = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (...args) => {
        const run = () => stmt.all(...args);
        return {
          bind: (...a) => bound(...a),
          first: () => stmt.get(...args) || null,
          all: () => ({ results: stmt.all(...args) }),
        };
      };
      return {
        bind: (...a) => bound(...a),
        first: () => stmt.get() || null,
        all: () => ({ results: stmt.all() }),
      };
    },
  };
  return { db, wrap };
}

test("leaderboard lists only real visible players and empty weeks stay empty", async () => {
  const { db, wrap } = boot();
  const now = Date.parse("2026-11-09T18:00:00Z");
  const week = weekStartPt(now);
  const ins = db.prepare(
    "INSERT INTO accounts(public_id,pid,username,pass_salt,pass_hash,tg_id,balance,bonus,pt,sync_seq,created_at,last_seen) VALUES(?,?,?,?,?,?,5000,0,0,0,1,1)",
  );
  ins.run("RR-000010", "p10", "Maya", "", "", null);
  ins.run("RR-000011", "p11", "Jules", "", "", null);
  ins.run("RR-000012", "rrsmoke-qa", "rrsmoke1", "", "", null);
  ins.run("RR-000013", "p13", "Admin", "", "", PROTECTED_TG_ID);
  const id = (pub) => db.prepare("SELECT id FROM accounts WHERE public_id=?").get(pub).id;
  const rec = db.prepare(
    "INSERT INTO weekly_catch_stats(week_start,account_id,bosses,biggest_mult,updated_at) VALUES(?,?,?,?,?)",
  );
  rec.run(week, id("RR-000010"), 4, 31, now);
  rec.run(week, id("RR-000011"), 2, 37, now + 1);
  rec.run(week, id("RR-000012"), 9, 99, now);
  rec.run(week, id("RR-000013"), 8, 80, now);
  const board = await readBoard(wrap, id("RR-000010"), now);
  assert.deepEqual(board.bosses.map((r) => r.name), ["Maya", "Jules"]);
  assert.equal(board.bosses[0].bosses, 4);
  assert.deepEqual(board.multipliers.map((r) => r.name), ["Jules", "Maya"]);
  assert.equal(board.multipliers[0].biggestMult, 37);
  assert.ok(!board.bosses.some((r) => /smoke|Admin/i.test(r.name)));
  assert.equal(board.me.name, "Maya");
  assert.equal(board.me.rankBosses, 1);
  assert.equal(board.me.rankMult, 2);
  assert.equal(board.me.badge, "Reef Champion");
  const empty = await readBoard(wrap, id("RR-000010"), Date.parse("2026-11-16T18:00:00Z"));
  assert.deepEqual(empty.bosses, []);
  assert.deepEqual(empty.multipliers, []);
  assert.equal(empty.me.bosses, 0);
  assert.equal(empty.me.rankBosses, null);
});
