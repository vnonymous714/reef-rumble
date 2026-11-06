import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyInitData, signInitData, boundEvent, playDeltaOk, PACKS,
  hashPassword, verifyPassword, validUsername, validPassword, publicIdFrom,
  sha256Hex, newToken, PROTECTED_TG_ID, PBKDF2_ITERS
} from '../src/tg.js';
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
  assert.ok(boundEvent({ player_id: 'a' + '0'.repeat(15), type: 'shots' }));
});
test('play delta bounds', () => {
  assert.ok(playDeltaOk(-100, 100)); assert.ok(!playDeltaOk(-101, 100)); assert.ok(!playDeltaOk(5, 0)); assert.ok(!playDeltaOk(1.5, 10));
});
test('packs priced in Stars only', () => { for (const p of PACKS) assert.ok(Number.isInteger(p.stars) && p.stars > 0); });

test('username validation', () => {
  assert.ok(validUsername('Bob')); assert.ok(validUsername('player_01'));
  assert.ok(!validUsername('ab')); assert.ok(!validUsername('1bob')); assert.ok(!validUsername('has-dash'));
});
test('password validation', () => {
  assert.ok(validPassword('abcdefgh')); assert.ok(!validPassword('short')); assert.ok(!validPassword('x'.repeat(73)));
});
test('publicIdFrom pads', () => {
  assert.equal(publicIdFrom(1), 'RR-000001');
  assert.equal(publicIdFrom(123), 'RR-000123');
});
test('PBKDF2 hash+verify roundtrip', async () => {
  const { salt, hash } = await hashPassword('correct-horse');
  assert.equal(salt.length, 32); assert.equal(hash.length, 64);
  assert.ok(await verifyPassword('correct-horse', salt, hash));
  assert.ok(!(await verifyPassword('wrong-password', salt, hash)));
  assert.ok(PBKDF2_ITERS >= 100000);
});
test('PBKDF2 uses provided salt', async () => {
  const { salt, hash } = await hashPassword('abc12345');
  const again = await hashPassword('abc12345', salt);
  assert.equal(again.hash, hash);
});
test('token + sha256 helpers', async () => {
  const t = newToken();
  assert.equal(t.length, 64);
  const h = await sha256Hex(t);
  assert.equal(h.length, 64);
  assert.notEqual(h, await sha256Hex(t + 'x'));
});
test('protected tg id constant set', () => {
  assert.equal(PROTECTED_TG_ID, 7313143643);
});
