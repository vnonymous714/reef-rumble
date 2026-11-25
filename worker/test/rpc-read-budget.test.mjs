// 2026-11-25: backoffice stats RPCs re-scanned the whole accounting_events view per tab per minute
// (~16M D1 rows in one hour; free cap 5M/day). They are now memoised per isolate for a short TTL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localV2 } from './local-v2.mjs';
import worker, { cachedRpc, rpcCacheClear, RPC_TTL_MS } from '../src/index.js';

function counting(db) {
  const c = { rowsRead: 0, queries: 0 };
  const tally = (r) => { c.queries++; c.rowsRead += (r.meta && r.meta.rows_read) || 0; return r; };
  const wrap = (st) => ({ bind: (...a) => wrap(st.bind(...a)), all: async () => tally(await st.all()), first: async () => (tally(await st.all())).results[0] ?? null, run: async () => tally(await st.run()) });
  return { c, DB: { prepare: (s) => wrap(db.prepare(s)), batch: (x) => db.batch(x) } };
}
async function seed(db) {
  const T = Date.now() - 600000, st = [];
  for (let i = 1; i <= 120; i++) st.push(db.prepare('INSERT INTO events(player_id,type,mode,bet,win,credit,n,created_at) VALUES(?,?,?,?,?,0,1,?)')
    .bind('p' + (i % 7), i % 4 ? 'shots' : 'catch', 'normal', 10 + (i % 5), i % 4 ? 0 : 25 + i, T + i * 1000));
  await db.batch(st);
}
const rpc = (env, fn, body = {}) => worker.fetch(new Request('https://w.test/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env).then(async (r) => ({ status: r.status, body: await r.json() }));

test('stats RPCs: repeated calls inside the TTL run the D1 queries once and return identical data', async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db); rpcCacheClear();
    const { c, DB } = counting(db), env = { DB, GAME_V2: '1' };
    for (const fn of ['rr_house', 'rr_live', 'rr_series', 'rr_leaders', 'rr_top']) {
      const before = c.queries;
      const first = await rpc(env, fn);
      assert.equal(first.status, 200, fn);
      const once = c.queries - before;
      assert.ok(once >= 1, fn + ' queried D1');
      for (let k = 0; k < 5; k++) assert.deepEqual(await rpc(env, fn), first, fn + ' cached copy identical');
      assert.equal(c.queries - before, once, fn + ': 6 calls, D1 queried once');
    }
    // concurrent tabs coalesce into one query set
    rpcCacheClear(); const q0 = c.queries;
    const r = await Promise.all(Array.from({ length: 8 }, () => rpc(env, 'rr_house')));
    assert.ok(r.every((x) => x.status === 200 && x.body.wagered > 0));
    assert.equal(c.queries - q0, 4, 'rr_house = 4 queries for 8 concurrent calls');
  } finally { await mf.dispose(); rpcCacheClear(); }
});

test('rr_feed: cached newest-50 filtered by after_id == the old "id > after ORDER BY id DESC LIMIT 50" result', async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db); rpcCacheClear();
    const env = { DB: db, GAME_V2: '1' };
    const ids = (await db.prepare('SELECT id FROM accounting_events ORDER BY id DESC').all()).results.map((x) => x.id);
    for (const after of [0, ids[70], ids[49], ids[50], ids[10], ids[0]]) {
      const old = (await db.prepare('SELECT id FROM accounting_events WHERE id > ?1 ORDER BY id DESC LIMIT 50').bind(after).all()).results.map((x) => x.id).reverse();
      const got = await rpc(env, 'rr_feed', { after_id: after });
      assert.equal(got.status, 200);
      assert.deepEqual(got.body.map((e) => e.id), old, 'after_id=' + after);
      assert.ok(got.body.every((e) => !('player_id' in e) && typeof e.player === 'string'));
    }
  } finally { await mf.dispose(); rpcCacheClear(); }
});

test('cachedRpc: TTL expiry recomputes, failures are not cached, clear by prefix', async () => {
  rpcCacheClear();
  let n = 0; const f = async () => ++n;
  assert.equal(await cachedRpc('k', 1000, f, 0), 1);
  assert.equal(await cachedRpc('k', 1000, f, 999), 1);
  assert.equal(await cachedRpc('k', 1000, f, 1000), 2);
  await assert.rejects(cachedRpc('e', 1000, async () => { throw new Error('D1 down'); }, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await cachedRpc('e', 1000, async () => 'ok', 1), 'ok', 'error not served from cache');
  await cachedRpc('adm:x', 1000, async () => 'old', 0);
  rpcCacheClear('adm:');
  assert.equal(await cachedRpc('adm:x', 1000, async () => 'new', 1), 'new');
  assert.ok(RPC_TTL_MS.rr_house <= 60000 && RPC_TTL_MS.rr_live <= 15000 && RPC_TTL_MS.admin_players <= 20000);
  rpcCacheClear();
});
