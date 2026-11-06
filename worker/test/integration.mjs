/* Runs wrangler dev locally (fake token, local D1) against a stub Telegram API. Nothing leaves the box. */
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { signInitData } from '../src/tg.js';
const TOKEN = '123456:TEST_FAKE_TOKEN', WH = 'local-webhook-secret', PASS = 'local-admin-pass', PORT = 8788, STUB = 8789;
const calls = [];
http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
  const m = q.url.split('/').pop(); calls.push({ m, body: JSON.parse(b || '{}'), path: q.url });
  r.setHeader('Content-Type', 'application/json');
  r.end(JSON.stringify({ ok: true, result: m === 'createInvoiceLink' ? 'https://t.me/$fakeinvoice' : true }));
}); }).listen(STUB);
execSync('rm -rf .wrangler/state && npx wrangler d1 migrations apply reef-rumble --local', { stdio: 'ignore', env: { ...process.env, CI: '1' } });
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--var', `TG_API:http://127.0.0.1:${STUB}`, '--var', `BOT_TOKEN:${TOKEN}`, '--var', `WEBHOOK_SECRET:${WH}`, '--var', `ADMIN_PASS:${PASS}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; dev.stdout.on('data', d => log += d); dev.stderr.on('data', d => log += d);
const B = `http://127.0.0.1:${PORT}`;
const post = (p, b, h = {}) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
const pj = async (p, b, h) => { const r = await post(p, b, h); return { s: r.status, j: await r.json().catch(() => null) }; };
try {
  for (let i = 0; i < 60; i++) { try { await fetch(B); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  const init = await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 4242 }) }, TOKEN);
  // initData
  assert.equal((await pj('/api/me', { initData: init.replace(/hash=./, 'hash=0') })).s, 401, 'tampered initData must be 401');
  let me = (await pj('/api/me', { initData: init })).j; assert.equal(me.balance, 0); console.log('✔ initData accepted/rejected');
  // season grant once
  await pj('/api/grant', { initData: init, kind: 'deposit_credit', season: 'S1' });
  me = (await pj('/api/grant', { initData: init, kind: 'deposit_credit', season: 'S2' })).j; assert.equal(me.balance, 5000); assert.equal(me.bonus, 2500); console.log('✔ season grant once');
  // play sync + play-through
  me = (await pj('/api/sync', { initData: init, seq: 1, d: -500, w: 1000 })).j; assert.equal(me.balance, 4500); assert.equal(me.pt, 1000);
  assert.equal((await pj('/api/sync', { initData: init, seq: 1, d: -500, w: 1000 })).j.stale, true, 'replayed seq ignored');
  assert.equal((await pj('/api/sync', { initData: init, seq: 2, d: 99999999, w: 0 })).s, 400); console.log('✔ sync bounds + replay');
  // invoice
  const inv = await pj('/api/invoice', { initData: init, pack: 2 }); assert.equal(inv.j.link, 'https://t.me/$fakeinvoice');
  const c = calls.find(x => x.m === 'createInvoiceLink').body; assert.equal(c.currency, 'XTR'); assert.equal(c.provider_token, ''); assert.equal(c.prices[0].amount, 200);
  assert.ok(calls.find(x => x.m === 'createInvoiceLink').path.includes(TOKEN)); console.log('✔ createInvoiceLink XTR, empty provider_token');
  // webhook auth
  assert.equal((await post('/tg/webhook', {}, { 'X-Telegram-Bot-Api-Secret-Token': 'nope' })).status, 403);
  const H = { 'X-Telegram-Bot-Api-Secret-Token': WH };
  await pj('/tg/webhook', { update_id: 1, pre_checkout_query: { id: 'q1', from: { id: 4242 }, currency: 'XTR', total_amount: 200, invoice_payload: c.payload } }, H);
  await pj('/tg/webhook', { update_id: 2, pre_checkout_query: { id: 'q2', from: { id: 4242 }, currency: 'XTR', total_amount: 1, invoice_payload: c.payload } }, H);
  const pc = calls.filter(x => x.m === 'answerPreCheckoutQuery').map(x => x.body);
  assert.equal(pc[0].ok, true); assert.equal(pc[1].ok, false); console.log('✔ pre_checkout_query ok / wrong amount rejected');
  // successful_payment x3 (Telegram retries) -> credited once
  const sp = { update_id: 3, message: { chat: { id: 4242, type: 'private' }, from: { id: 4242 }, successful_payment: { currency: 'XTR', total_amount: 200, invoice_payload: c.payload, telegram_payment_charge_id: 'CHG-1', provider_payment_charge_id: '' } } };
  await Promise.all([pj('/tg/webhook', sp, H), pj('/tg/webhook', sp, H), pj('/tg/webhook', sp, H)]);
  me = (await pj('/api/me', { initData: init })).j; assert.equal(me.balance, 4500 + 1500000, 'credited exactly once'); assert.equal(me.bonus, 2500 + 750000);
  // forged payload for another user -> not credited
  await pj('/tg/webhook', { ...sp, message: { ...sp.message, successful_payment: { ...sp.message.successful_payment, telegram_payment_charge_id: 'CHG-2', total_amount: 50 } } }, H);
  assert.equal((await pj('/api/me', { initData: init })).j.balance, 1519500); console.log('✔ successful_payment idempotent on charge id; mismatched amount not credited');
  // commands
  for (const t of ['/start', '/terms', '/support', '/paysupport']) await pj('/tg/webhook', { update_id: 9, message: { chat: { id: 4242, type: 'private' }, from: { id: 4242 }, text: t } }, H);
  const sm = calls.filter(x => x.m === 'sendMessage').map(x => x.body.text); assert.equal(sm.length, 4); assert.ok(/no cash value/i.test(sm[1])); console.log('✔ /start /terms /support /paysupport');
  // events + rpc + admin
  const ev = r => ({ player_id: '0123456789abcdef', type: 'slot_spin', bet: 100, win: 50, n: 1, ...r });
  assert.equal((await post('/events', [ev(), ev({ type: 'shots', n: 10, bet: 1000 }), ev({ type: 'bad' })])).status, 201);
  const live = (await pj('/rpc/rr_live', {})).j; assert.equal(live.wagered_today, 1100);
  assert.equal((await pj('/rpc/rr_feed', { after_id: 0 })).j.length, 3);   // 2 events + stars_purchase
  assert.ok((await pj('/rpc/rr_house', {})).j.bets >= 11);
  assert.equal((await pj('/rpc/rr_admin', { pass: 'x', op: 'ping' })).j.error, 'denied');
  assert.equal((await pj('/rpc/rr_admin', { pass: PASS, op: 'ping' })).j.ok, true);
  const pl = (await pj('/rpc/rr_admin', { pass: PASS, op: 'players' })).j; const tgp = pl.find(p => p.player_id[0] === 't');
  await pj('/rpc/rr_admin', { pass: PASS, op: 'set', pid: tgp.player_id, amt: 5000 });
  assert.equal((await pj('/api/me', { initData: init })).j.balance, 5000);
  await pj('/rpc/rr_admin', { pass: PASS, op: 'add', pid: '0123456789abcdef', amt: 300 });
  assert.equal((await pj('/rpc/rr_pending', { pid: '0123456789abcdef' })).j.length, 1); console.log('✔ events bounds, rr_* rpcs, admin passcode, TG + web admin');
  let rl = 0; for (let i = 0; i < 45; i++) if ((await post('/events', [ev()])).status === 429) rl++;
  assert.ok(rl > 0); console.log('✔ events rate limit (' + rl + ' rejected)');
  console.log('ALL INTEGRATION TESTS PASSED');
} catch (e) { console.error('FAIL', e, '\n--- wrangler log tail ---\n', log.slice(-3000)); process.exitCode = 1; }
finally { dev.kill('SIGINT'); setTimeout(() => process.exit(), 1500); }
