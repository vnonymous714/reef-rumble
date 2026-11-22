// tg37 hotfix: backoffice player list must not run two correlated full scans of the report view per account.
// Production 2026-11-21: that query read ~117M D1 rows / ~21 s per call -> "D1 DB is overloaded ... 10 second window".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localV2 } from './local-v2.mjs';
import { adminPlayers } from '../src/index.js';
import { seedRecords } from './retention-fixture.mjs';

const WIN_T = "('shots','catch','wheel','jackpot','boss_catch','bomb','chain','slot_spin')";
const OLD = (where) => `SELECT a.id, a.public_id, a.pid, a.username, a.tg_id, a.balance, a.created_at, a.last_seen,
  (SELECT COALESCE(SUM(bet),0) FROM accounting_events e WHERE e.player_id IN (a.pid, COALESCE((SELECT pid FROM players p WHERE p.tg_id = a.tg_id), '')) ) wagered,
  (SELECT COALESCE(SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END),0) FROM accounting_events e WHERE e.player_id IN (a.pid, COALESCE((SELECT pid FROM players p WHERE p.tg_id = a.tg_id), '')) ) won
  FROM accounts a ${where} ORDER BY a.last_seen DESC LIMIT 100`;

function counting(db) {
  const c = { rowsRead: 0, queries: 0 };
  const tally = (r) => { c.queries++; c.rowsRead += (r.meta && r.meta.rows_read) || 0; return r; };
  const wrap = (st) => ({ bind: (...a) => wrap(st.bind(...a)), all: async () => tally(await st.all()), first: async () => (tally(await st.all())).results[0] ?? null, run: async () => tally(await st.run()) });
  return { c, DB: { prepare: (s) => wrap(db.prepare(s)) } };
}

async function seed(db) {
  const N = 40, T = Date.parse('2026-11-01T00:00:00Z');
  await db.prepare("UPDATE economy_config SET value=? WHERE key='cutover_at'").bind(T + 86400000).run();
  const st = [];
  for (let i = 1; i <= N; i++) {
    const tg = i % 3 === 0 ? 7000 + i : null;
    st.push(db.prepare('INSERT INTO accounts(id,public_id,pid,username,tg_id,balance,bonus,pt,created_at,last_seen) VALUES(?,?,?,?,?,1000,0,0,?,?)')
      .bind(i, 'RR-P' + i, 'p' + i, i % 2 ? 'user' + i : null, tg, T, T + i * 1000));
    if (tg) st.push(db.prepare('INSERT INTO players(tg_id,pid,balance,created_at,last_seen) VALUES(?,?,0,?,?)').bind(tg, i % 6 === 0 ? 'p' + i : 'tgp' + i, T, T));
    for (let k = 0; k < 15; k++) {
      const pid = tg && k % 2 ? (i % 6 === 0 ? 'p' + i : 'tgp' + i) : 'p' + i;
      st.push(db.prepare('INSERT INTO events(player_id,type,mode,bet,win,credit,n,created_at) VALUES(?,?,?,?,?,0,1,?)')
        .bind(pid, k % 4 ? 'shots' : 'catch', k % 5 ? 'normal' : 'underground', 10 + k, k % 4 ? 0 : 30 + i, T + k * 1000));
    }
  }
  await db.batch(st);
  for (const id of [1, 2, 3, 6, 9]) await seedRecords(db, id, 1, 60, T + 2 * 86400000);
  await db.prepare("INSERT INTO events(player_id,type,bet,win,created_at) VALUES('nobody','shots',99,0,?)").bind(T).run(); // unlisted player
}

const norm = (r) => ({ public_id: r.public_id, player_id: r.pid ?? r.player_id, wagered: r.wagered || 0, won: r.won || 0 });

test('admin players list: same wagered/won as the old correlated query, with far fewer D1 rows read', async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db);
    for (const q of ['', 'user', 'P3', '7003']) {
      const like = '%' + q + '%';
      const oldSt = db.prepare(OLD(q ? "WHERE a.public_id LIKE ?1 OR IFNULL(a.username,'') LIKE ?1 OR CAST(IFNULL(a.tg_id,0) AS TEXT) LIKE ?1 OR a.pid LIKE ?1" : ''));
      const old = await (q ? oldSt.bind(like) : oldSt).all();
      const { c, DB } = counting(db);
      const got = await adminPlayers(DB, 'accounting_events', q);
      assert.ok(old.results.length > 0, 'fixture lists players for q=' + q);
      assert.deepEqual(got.map(norm), old.results.map(norm), 'same rows/order/sums for q=' + q);
      assert.ok(got.some((r) => r.wagered > 0 && r.won > 0));
      if (!q) {
        const oldRows = old.meta.rows_read;
        assert.ok(c.queries <= 2, 'two queries: accounts + one aggregate');
        assert.ok(c.rowsRead * 10 < oldRows, `rows read ${c.rowsRead} vs old ${oldRows}`);
        console.log(`# players list D1 rows read: old ${oldRows}, new ${c.rowsRead}`);
      }
    }
  } finally { await mf.dispose(); }
});

test('admin players list: empty accounts table -> [] with a single query', async () => {
  const { mf, db } = await localV2();
  try {
    const { c, DB } = counting(db);
    assert.deepEqual(await adminPlayers(DB, 'accounting_events', ''), []);
    assert.equal(c.queries, 1);
  } finally { await mf.dispose(); }
});
