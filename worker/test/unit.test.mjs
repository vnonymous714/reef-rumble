import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInitData, signInitData, boundEvent, playDeltaOk, PACKS } from '../src/tg.js';
const TOKEN = '123456:TEST_FAKE_TOKEN';
const now = Date.now(), auth = Math.floor(now / 1000);
const fields = { auth_date: String(auth), query_id: 'AAE', user: JSON.stringify({ id: 777, first_name: 'X' }) };

test('valid initData verifies and drops names', async () => {
  const d = await signInitData(fields, TOKEN);
  assert.deepEqual(await verifyInitData(d, TOKEN), { id: 777, auth_date: auth });
});
test('wrong token rejected', async () => { assert.equal(await verifyInitData(await signInitData(fields, TOKEN), '999:OTHER'), null); });
test('tampered user rejected', async () => {
  const p = new URLSearchParams(await signInitData(fields, TOKEN)); p.set('user', JSON.stringify({ id: 1 }));
  assert.equal(await verifyInitData(p.toString(), TOKEN), null);
});
test('stale auth_date rejected', async () => {
  const d = await signInitData({ ...fields, auth_date: String(auth - 90000) }, TOKEN);
  assert.equal(await verifyInitData(d, TOKEN), null);
});
test('missing/garbage hash rejected', async () => {
  assert.equal(await verifyInitData('user=%7B%22id%22%3A1%7D&auth_date=1', TOKEN), null);
  assert.equal(await verifyInitData('', TOKEN), null);
  assert.equal(await verifyInitData(null, TOKEN), null);
});
test('known vector: independent HMAC (node:crypto) matches', async () => {
  const { createHmac } = await import('node:crypto');
  const dcs = Object.entries(fields).map(([k, v]) => k + '=' + v).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields); p.set('hash', hash);
  assert.equal((await verifyInitData(p.toString(), TOKEN)).id, 777);
});
test('event bounds', () => {
  assert.equal(boundEvent({ player_id: 'zz', type: 'shots' }), null);
  assert.equal(boundEvent({ player_id: '0123456789abcdef', type: 'evil' }), null);
  const e = boundEvent({ player_id: '0123456789abcdef', type: 'slot_spin', bet: 9e9, n: 99999, meta: 'x'.repeat(99) });
  assert.equal(e.bet, 1e6); assert.equal(e.n, 2000); assert.equal(e.meta.length, 24);
});
test('play delta bounds', () => {
  assert.ok(playDeltaOk(-100, 100)); assert.ok(!playDeltaOk(-101, 100)); assert.ok(!playDeltaOk(5, 0)); assert.ok(!playDeltaOk(1.5, 10));
});
test('packs priced in Stars only', () => { for (const p of PACKS) assert.ok(Number.isInteger(p.stars) && p.stars > 0); });
