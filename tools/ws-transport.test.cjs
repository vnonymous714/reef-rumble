// tg39: ws-transport.js (game WebSocket client) on a fake socket + fake clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../ws-transport.js');

function rig({ refuse = false, hidden = false } = {}) {
  let t = 0; const timers = []; const sockets = []; const events = { pushes: [], opens: 0, closes: [], authEnded: 0 };
  class FakeWS {
    constructor(url, prot) { this.url = url; this.prot = prot; this.sent = []; this.readyState = 0; sockets.push(this); timers.push({ at: t, f: () => (refuse ? this.fail(1006) : this.up()) }); }
    up() { this.readyState = 1; this.onopen && this.onopen(); }
    fail(code) { this.readyState = 3; this.onclose && this.onclose({ code }); }
    send(m) { if (this.readyState !== 1) throw new Error('not open'); this.sent.push(m); }
    close(code) { this.readyState = 3; this.closed = code ?? 1005; }
    msg(o) { this.onmessage && this.onmessage({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
  }
  const h = { hidden };
  const c = RS.create({ api: 'https://reef.example/', WebSocket: FakeWS, setTimeout: (f, d) => (timers.push({ at: t + d, f }), timers.length), now: () => t, random: () => 1,
    credential: () => ({ token: 'f'.repeat(64) }), hidden: () => h.hidden,
    onPush: (d) => events.pushes.push(d), onOpen: () => events.opens++, onClose: (i) => events.closes.push(i), onAuthEnded: () => events.authEnded++ });
  const run = (ms) => { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const n = timers[0]; if (!n || n.at > end) break; timers.shift(); t = n.at; n.f(); } t = end; };
  return { c, sockets, events, run, h, last: () => sockets[sockets.length - 1] };
}

test('url + protocols: wss, rr2 + token, initData base64url; nothing without a credential', () => {
  assert.equal(RS.wsUrl('https://reef-rumble-tg.ea-vnonymous.workers.dev'), 'wss://reef-rumble-tg.ea-vnonymous.workers.dev/api/v2/ws');
  assert.equal(RS.wsUrl('http://127.0.0.1:8739'), 'ws://127.0.0.1:8739/api/v2/ws');
  assert.deepEqual(RS.protocols({ token: 'a'.repeat(64) }), ['rr2', 'rrt.' + 'a'.repeat(64)]);
  const p = RS.protocols({ initData: 'user=%7B%22id%22%3A1%7D&hash=ab' });
  assert.equal(p[0], 'rr2');
  assert.equal(Buffer.from(p[1].slice(4), 'base64url').toString(), 'user=%7B%22id%22%3A1%7D&hash=ab');
  assert.ok(/^rri\.[A-Za-z0-9_-]+$/.test(p[1]));
  assert.equal(RS.protocols(null), null);
  assert.equal(RS.protocols({ token: 'short' }), null);
});

test('requests: matched by rid; server errors keep status; a drop rejects without status (like fetch)', async () => {
  const { c, run, last } = rig();
  c.start(); run(0);
  assert.ok(c.ready());
  const ws = last();
  assert.deepEqual(ws.prot, ['rr2', 'rrt.' + 'f'.repeat(64)]);
  const a = c.request({ command: 'state', id: '0_aaaaaaaa' }), b = c.request({ command: 'launch', id: '1_bbbbbbbb' });
  const [m1, m2] = ws.sent.map(JSON.parse);
  assert.equal(m1.t, 'cmd'); assert.equal(m1.body.command, 'state');
  ws.msg({ t: 'res', rid: m2.rid, ok: false, status: 409, error: 'stale account sequence' });
  ws.msg({ t: 'res', rid: m1.rid, ok: true, data: { seq: 3 } });
  assert.deepEqual(await a, { seq: 3 });
  await assert.rejects(b, (e) => e.status === 409 && e.message === 'stale account sequence');
  const d = c.request({ command: 'state', id: '3_cccccccc' });
  ws.fail(1006);
  await assert.rejects(d, (e) => e.status === undefined && e.socket && !e.notSent);
  await assert.rejects(c.request({ command: 'state', id: '3_dddddddd' }), (e) => e.notSent, 'closed socket -> caller uses HTTP');
});

test('pushes reach onPush; hints only while open; ping every 45 s while visible, none while hidden', () => {
  const { c, run, last, events, h } = rig();
  c.start(); run(0);
  last().msg({ t: 'push', data: { seq: 9 } });
  assert.deepEqual(events.pushes, [{ seq: 9 }]);
  assert.equal(c.hint({ hidden: true }), true);
  assert.deepEqual(JSON.parse(last().sent[0]), { t: 'hint', hidden: true });
  run(45000);
  assert.equal(last().sent.filter((m) => m === 'ping').length, 1);
  h.hidden = true; run(90000);
  assert.equal(last().sent.filter((m) => m === 'ping').length, 1, 'no pings while hidden');
});

test('reconnect with backoff; 3 failed opens -> HTTP only for 5 min; then tries again', () => {
  const r = rig({ refuse: true });
  r.c.start(); r.run(0);
  assert.equal(r.sockets.length, 1);
  r.run(999); assert.equal(r.sockets.length, 1);
  r.run(1); assert.equal(r.sockets.length, 2, '1 s backoff');
  r.run(2000); assert.equal(r.sockets.length, 3, '2 s backoff');
  assert.equal(r.c.stats.fallbacks, 1);
  r.run(250000); assert.equal(r.sockets.length, 3, 'disabled: HTTP polling only');
  r.run(50000); assert.equal(r.sockets.length, 4, 'retries after 5 min');
  assert.equal(r.c.ready(), false);
});

test('close codes: 4001 session ended -> no reconnect + auth callback; 4002 -> reconnect now; drop while hidden waits for wake()', () => {
  let r = rig();
  r.c.start(); r.run(0); r.last().fail(4001); r.run(60000);
  assert.equal(r.sockets.length, 1); assert.equal(r.events.authEnded, 1);
  r = rig();
  r.c.start(); r.run(0); r.last().fail(4002); r.run(0);
  assert.equal(r.sockets.length, 2); assert.ok(r.c.ready());
  r.h.hidden = true; r.last().fail(1006); r.run(60000);
  assert.equal(r.sockets.length, 2, 'no reconnect while hidden');
  r.h.hidden = false; r.c.wake(); r.run(0);
  assert.equal(r.sockets.length, 3); assert.ok(r.c.ready());
});

test('a silent socket: request times out after 10 s and the socket is dropped', async () => {
  const { c, run, sockets } = rig();
  c.start(); run(0);
  const p = c.request({ command: 'state', id: '0_eeeeeeee' });
  run(10000);
  await assert.rejects(p, (e) => e.message === 'Request timed out');
  assert.equal(c.ready(), false);
  run(1000);
  assert.equal(sockets.length, 2, 'reconnected');
});
