// tg39: the REAL controller (ws-transport + authority-bridge + poll-schedule +
// game) with a fake WebSocket whose "server" forwards each command to the
// local Worker world (same /api/v2/game handler) and lets the test push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './original-runtime-harness.mjs';
import qa from '../../tools/qa-worker.mjs';
import { localV2 } from './local-v2.mjs';

function socketServer(route, { refuse = false, push = 'server' } = {}) {
  const S = { sockets: [], cmds: [], hints: [], pings: 0, inflight: 0, refuse };
  class FakeWS {
    constructor(url, prot) {
      this.url = url; this.prot = prot; this.readyState = 0; S.sockets.push(this);
      setTimeout(() => { if (S.refuse) { this.readyState = 3; this.onclose?.({ code: 1006 }); return; } this.readyState = 1; this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ t: 'hello', push }) }); }, 0);
    }
    send(m) {
      if (this.readyState !== 1) throw new Error('not open');
      if (m === 'ping') { S.pings++; setTimeout(() => this.onmessage?.({ data: 'pong' }), 0); return; }
      const msg = JSON.parse(m);
      if (msg.t === 'hint') { S.hints.push(msg); if (msg.paused === false || msg.hidden === false || msg.input) setTimeout(() => this.push(), 0); return; }
      S.cmds.push(msg.body);
      S.inflight++;
      route('https://qa.test/api/v2/game', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reef-Protocol': '2', Authorization: 'Bearer ' + this.prot[1].slice(4) }, body: JSON.stringify(msg.body) })
        .then(async (r) => { const data = await r.json(); S.last = r.ok ? data : S.last; this.onmessage?.({ data: JSON.stringify(r.ok ? { t: 'res', rid: msg.rid, ok: true, data } : { t: 'res', rid: msg.rid, ok: false, status: r.status, error: data.error }) }); })
        .finally(() => S.inflight--);
    }
    close() { this.readyState = 3; }
    drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    async push() {
      // what the DO does on its timer: one revision-bound 'state', broadcast
      const s = S.last;
      S.inflight++;
      const body = s ? { command: 'state', seq: s.seq, id: `${s.seq}_srvpush${Date.now()}` } : { command: 'state', id: `0_srvpush${Date.now()}` };
      const H = { 'Content-Type': 'application/json', 'X-Reef-Protocol': '2', Authorization: 'Bearer ' + this.prot[1].slice(4) };
      let r = await route('https://qa.test/api/v2/game', { method: 'POST', headers: H, body: JSON.stringify(body) });
      if (r.status === 409) { // moved elsewhere: re-learn the seq (as the DO does), then push a committed tick
        const snap = await (await route('https://qa.test/api/v2/game', { method: 'POST', headers: H, body: JSON.stringify({ command: 'state', id: `0_srvlearn${Date.now()}` }) })).json();
        r = await route('https://qa.test/api/v2/game', { method: 'POST', headers: H, body: JSON.stringify({ command: 'state', seq: snap.seq, id: `${snap.seq}_srvpush${Date.now()}` }) });
      }
      S.inflight--;
      S.pushes = (S.pushes || 0) + 1;
      const data = await r.json();
      if (r.ok) { S.last = data; this.onmessage?.({ data: JSON.stringify({ t: 'push', data }) }); }
      return data;
    }
  }
  return { S, FakeWS };
}

async function boot(opts) {
  const { mf, db } = await localV2();
  const env = { DB: db, TEST_QA: '1' }, route = (url, o) => qa.fetch(new Request(url, o), env);
  const ses = await (await route('https://qa.test/qa/session', { method: 'POST' })).json();
  const { S, FakeWS } = socketServer(route, opts);
  const r = runtime(route, { webSocket: FakeWS });
  await r.ctx.ReefAuthority.session(ses.token);
  r.click('#dSpin'); await r.settle(); await r.step(5400); r.click('#dSpin'); await r.settle();
  const quiet = async () => { for (let i = 0; i < 400 && S.inflight; i++) await new Promise((x) => setTimeout(x, 5)); await r.settle(); };
  const run = async (ms) => { for (let t = 0; t < ms; t += 100) { await r.step(100); if (S.inflight) await quiet(); } await quiet(); };
  const httpGame = () => r.requests.filter((x) => x.path === '/api/v2/game').length;
  const setHidden = (v) => { Object.defineProperty(r.document, 'hidden', { value: v, configurable: true }); r.document.dispatchEvent(new r.dom.Event('visibilitychange')); };
  await run(2000);
  return { mf, r, S, run, quiet, httpGame, setHidden, token: ses.token };
}

test('socket open: zero HTTP game requests, commands ride the socket, the client plans no polls of its own', async () => {
  const { mf, r, S, run, httpGame } = await boot();
  try {
    assert.equal(S.sockets.length, 1);
    assert.deepEqual([...S.sockets[0].prot], ['rr2', 'rrt.' + S.sockets[0].prot[1].slice(4)]);
    assert.ok(r.ctx.ReefAuthority.pollStats.ws.ready, 'socket ready');
    assert.ok(S.cmds.some((b) => b.command === 'state') || S.pushes >= 1, 'resync on open (client state or server push after the daily modal)');
    assert.ok(S.hints.some((h) => h.paused === true) && S.hints.some((h) => h.paused === false), 'daily modal paused/unpaused the server schedule');
    const h0 = httpGame(), c0 = S.cmds.length;
    await run(60000);
    assert.equal(httpGame() - h0, 0, 'no HTTP /api/v2/game while the socket is open');
    // The fake server never pushes here, so only the 15 s watchdog asks (tg38 polled ~11x).
    const asked = S.cmds.length - c0;
    assert.ok(asked >= 2 && asked <= 5, 'watchdog state requests in 60 s without pushes: ' + asked);
    assert.equal(r.ctx.ReefAuthority.pollStats.due, null, 'no client poll timer');
    assert.ok(S.pings >= 1, 'keepalive ping');
  } finally { await mf.dispose(); }
});

test('server pushes are applied (seq/world advance, no request); a tapped shot goes over the socket and settles from a push', async () => {
  const { mf, r, S, run, quiet, httpGame } = await boot();
  try {
    const A = r.ctx.ReefAuthority, M = r.ctx.ReefMotion;
    const seq0 = A.snapshot.seq;
    await S.sockets[0].push(); await quiet();
    const pd = await S.sockets[0].push(); await quiet();
    assert.ok(A.snapshot.seq >= seq0 && A.snapshot.seq === pd.seq && A.snapshot.now === pd.now, 'push applied ' + JSON.stringify([seq0, A.snapshot.seq, pd.seq, pd.error]));
    const s0 = A.snapshot;
    const fish = s0.world.fishes.filter((f) => !f.dead && f.born <= s0.now && f.expires > s0.now + 3000)
      .map((f) => ({ f, p: M.point(f, s0.now, 844, 390) }))
      .filter((v) => v.p.x > 200 && v.p.x < 644 && v.p.y > 60 && v.p.y < 250).sort((a, b) => b.f.h - a.f.h)[0];
    assert.ok(fish, 'a fish to aim at');
    const h0 = httpGame();
    r.pointer(fish.p.x, fish.p.y);
    r.document.querySelector('#cv').dispatchEvent(new r.dom.Event('pointerup'));
    await run(300);
    assert.ok(S.cmds.some((b) => b.command === 'launch'), 'launch over the socket');
    assert.equal(httpGame() - h0, 0);
    let ms = 0;
    while (A.snapshot.world.projectiles.length && ms < 3000) { await run(200); await S.sockets[0].push(); await quiet(); ms += 200; }
    assert.equal(A.snapshot.world.projectiles.length, 0, 'settled from pushes only');
  } finally { await mf.dispose(); }
});

test('hidden -> hint, nothing else sent; shown -> hint (server pushes); input after quiet -> one input hint', async () => {
  const { mf, r, S, run, setHidden, httpGame } = await boot();
  try {
    const h0 = httpGame(), c0 = S.cmds.length;
    setHidden(true); await run(60000);
    assert.deepEqual(S.hints.at(-1), { t: 'hint', hidden: true }, JSON.stringify(S.hints));
    assert.equal(S.cmds.length - c0, 0, 'no commands while hidden');
    assert.equal(httpGame() - h0, 0);
    setHidden(false); await run(100);
    assert.deepEqual(S.hints.at(-1), { t: 'hint', hidden: false });
    await run(6000);
    const n = S.hints.length;
    r.document.dispatchEvent(new r.dom.Event('keydown'));
    r.document.dispatchEvent(new r.dom.Event('keydown'));
    await run(100);
    assert.equal(S.hints.length - n, 1);
    assert.deepEqual(S.hints.at(-1), { t: 'hint', input: 1 });
  } finally { await mf.dispose(); }
});

test('socket drops mid-session: HTTP polling (tg38) resumes at once; socket reconnects with backoff', async () => {
  const { mf, r, S, run, httpGame } = await boot();
  try {
    const h0 = httpGame();
    S.refuse = true;
    S.sockets[0].drop();
    await run(30000);
    const polls = r.requests.slice(0).filter((x) => x.path === '/api/v2/game' && x.body?.command === 'state').length;
    assert.ok(httpGame() - h0 >= 3, 'HTTP polls resumed: ' + (httpGame() - h0));
    assert.ok(polls >= 3);
    assert.ok(S.sockets.length >= 3, 'reconnect attempts: ' + S.sockets.length);
    S.refuse = false;
    await run(310000); // after the 5 min HTTP-only window it reconnects
    r.document.dispatchEvent(new r.dom.Event('keydown'));
    await run(2000);
    assert.ok(r.ctx.ReefAuthority.pollStats.ws.ready, 'back on the socket');
  } finally { await mf.dispose(); }
});

test('socket refused from the start: identical tg38 HTTP polling (fallback)', async () => {
  const { mf, r, run } = await boot({ refuse: true });
  try {
    const polls = () => r.requests.filter((x) => x.body?.command === 'state').length;
    await run(2000);
    const p0 = polls();
    await run(60000);
    const n = polls() - p0;
    assert.ok(n >= 5 && n <= 16, 'state polls in 60 s idle: ' + n);
    assert.equal(r.ctx.ReefAuthority.pollStats.ws.ready, false);
  } finally { await mf.dispose(); }
});

test('GAME_WS_PUSH=client: the tg38 schedule keeps running and every poll rides the socket (zero HTTP, no hints)', async () => {
  const { mf, r, S, run, httpGame } = await boot({ push: 'client' });
  try {
    assert.ok(r.ctx.ReefAuthority.pollStats.ws.ready);
    const h0 = httpGame(), c0 = S.cmds.length, n0 = S.hints.length;
    await run(60000);
    const polls = S.cmds.slice(c0).filter((b) => b.command === 'state').length;
    assert.equal(httpGame() - h0, 0, 'no HTTP');
    assert.ok(polls >= 5 && polls <= 16, 'tg38-schedule polls over the socket in 60 s idle: ' + polls);
    assert.equal(S.hints.length - n0, 0, 'no hints in client mode');
  } finally { await mf.dispose(); }
});
