import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import qa from '../../tools/qa-worker.mjs';
import {localV2} from './local-v2.mjs';

const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/qa-high-seq-world.json'), 'utf8'),
);

test('QA wrapper state after high-seq world and fresh session after expiry', async () => {
  const {mf, db} = await localV2();
  try {
    const env = {
      DB: db,
      TEST_QA: '1',
      ASSETS: {fetch: async () => new Response('<html><body></body></html>', {headers: {'Content-Type': 'text/html'}})},
    };
    let r = await qa.fetch(
      new Request('https://qa.test/qa/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}),
      env,
    );
    assert.equal(r.status, 200);
    const {token} = await r.json();
    const a = await db.prepare("SELECT id FROM accounts WHERE public_id LIKE 'RR-QA-%' ORDER BY id DESC LIMIT 1").first();
    await db.prepare('UPDATE accounts SET sync_seq=866,balance=101000 WHERE id=?').bind(a.id).run();
    await db
      .prepare(
        'INSERT INTO economy_world(account_id,state_json,version,enrolled_at) VALUES(?,?,866,0) ON CONFLICT(account_id) DO UPDATE SET state_json=excluded.state_json,version=866',
      )
      .bind(a.id, JSON.stringify(fixture))
      .run();
    await db
      .prepare(
        'INSERT INTO economy_retention(account_id,floor_seq,head_hash,compact_token) VALUES(?,330,?,?) ON CONFLICT(account_id) DO UPDATE SET floor_seq=330',
      )
      .bind(a.id, 'a'.repeat(64), 'tok')
      .run();
    const rows = [];
    for (let n = 330; n < 866; n++)
      rows.push(
        db
          .prepare(
            "INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at) VALUES(?,?,?,'{}',?,'settled',0,0,?)",
          )
          .bind(a.id, String(n) + '_x', 'h3:x', n, 1e12 + n),
      );
    for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50));
    r = await qa.fetch(
      new Request('https://qa.test/api/v2/game', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Reef-Protocol': '2'},
        body: JSON.stringify({command: 'state', seq: 866, id: '866_' + crypto.randomUUID()}),
      }),
      env,
    );
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.balance, 101000);
    await db.prepare('UPDATE sessions SET expires_at=1').run();
    r = await qa.fetch(
      new Request('https://qa.test/api/v2/game', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Reef-Protocol': '2'},
        body: JSON.stringify({command: 'state', seq: 866, id: '866_' + crypto.randomUUID()}),
      }),
      env,
    );
    assert.equal(r.status, 401);
    r = await qa.fetch(
      new Request('https://qa.test/qa/session', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
        body: '{}',
      }),
      env,
    );
    assert.equal(r.status, 200, await r.clone().text());
    const next = await r.json();
    assert.ok(next.token);
    r = await qa.fetch(
      new Request('https://qa.test/api/auth/me', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + next.token, 'X-Reef-Protocol': '2'},
        body: '{}',
      }),
      env,
    );
    assert.equal(r.status, 200, await r.clone().text());
  } finally {
    await mf.dispose();
  }
});
