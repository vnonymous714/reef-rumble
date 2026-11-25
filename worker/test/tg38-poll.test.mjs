// tg38: the REAL controller (authority-bridge + poll-schedule + game + tgbridge)
// against the local Worker world, on a simulated clock. Counts 'state' polls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './original-runtime-harness.mjs';
import qa from '../../tools/qa-worker.mjs';
import { localV2 } from './local-v2.mjs';

async function boot() {
  const { mf, db } = await localV2();
  const env = { DB: db, TEST_QA: '1' }, route = (url, opts) => qa.fetch(new Request(url, opts), env);
  const ses = await (await route('https://qa.test/qa/session', { method: 'POST' })).json();
  const r = runtime(route);
  await r.ctx.ReefAuthority.session(ses.token);
  r.click('#dSpin'); await r.settle(); await r.step(5400); r.click('#dSpin'); await r.settle();
  const polls = () => r.requests.filter((x) => x.body?.command === 'state').length;
  const run = async (ms) => { for (let t = 0; t < ms; t += 100) await r.step(100); await r.settle(); };
  const setHidden = (v) => { Object.defineProperty(r.document, 'hidden', { value: v, configurable: true }); r.document.dispatchEvent(new r.dom.Event('visibilitychange')); };
  return { mf, r, polls, run, setHidden };
}

test('idle visible tab: ~11 polls in the first minute (was ~120 + bridge refreshes), reef stays stocked', async () => {
  const { mf, r, polls, run } = await boot();
  try {
    await run(2000);
    const p0 = polls();
    await run(60000);
    const n = polls() - p0;
    assert.ok(n >= 5 && n <= 16, 'state polls in 60 s idle: ' + n);
    const s = r.ctx.ReefAuthority.snapshot, live = s.world.fishes.filter((f) => !f.dead && f.born <= s.now && f.expires > s.now).length;
    assert.ok(live >= 12, 'fish on screen after a minute idle: ' + live);
    assert.ok(s.world.director.spawn > s.now, 'server schedule ahead of the client');
  } finally { await mf.dispose(); }
});

test('hidden tab sends nothing; showing it again refreshes once immediately', async () => {
  const { mf, r, polls, run, setHidden } = await boot();
  try {
    await run(1000);
    setHidden(true);
    await r.settle();
    const p0 = r.requests.length;
    await run(60000);
    assert.equal(r.requests.length - p0, 0, 'no Worker requests while hidden');
    setHidden(false);
    await r.settle();
    assert.equal(polls() - r.requests.slice(0, p0).filter((x) => x.body?.command === 'state').length, 1, 'one refresh on return');
  } finally { await mf.dispose(); }
});

test('no input for 2 min: polling stops; the next input refreshes at once and polling resumes', async () => {
  const { mf, r, polls, run } = await boot();
  try {
    await run(125000);
    assert.equal(r.ctx.ReefAuthority.pollStats.stopped, true);
    const p0 = polls();
    await run(30000);
    assert.equal(polls() - p0, 0, 'stopped while inactive');
    r.document.dispatchEvent(new r.dom.Event('keydown'));
    await r.settle();
    assert.equal(polls() - p0, 1, 'input refreshes immediately');
    await run(3000);
    assert.ok(polls() - p0 >= 2, 'and polling resumed');
  } finally { await mf.dispose(); }
});

test('a tapped shot at a fish settles without a fixed 500 ms poll grid', async () => {
  const { mf, r, run, polls } = await boot();
  try {
    await run(1000);
    const s0 = r.ctx.ReefAuthority.snapshot, M = r.ctx.ReefMotion;
    const fish = s0.world.fishes.filter((f) => !f.dead && f.born <= s0.now && f.expires > s0.now + 3000)
      .map((f) => ({ f, p: M.point(f, s0.now, 844, 390) }))
      .filter((v) => v.p.x > 200 && v.p.x < 644 && v.p.y > 60 && v.p.y < 250)
      .sort((a, b) => b.f.h - a.f.h)[0];
    assert.ok(fish, 'a fish to aim at');
    const seq0 = s0.seq, p0 = polls();
    r.pointer(fish.p.x, fish.p.y);
    r.document.querySelector('#cv').dispatchEvent(new r.dom.Event('pointerup'));
    await r.settle();
    assert.ok(r.requests.some((x) => x.body?.command === 'launch' && x.status === 200));
    let ms = 0;
    while (r.ctx.ReefAuthority.snapshot.world.projectiles.length && ms < 3000) { await run(100); ms += 100; }
    const s = r.ctx.ReefAuthority.snapshot;
    assert.equal(s.world.projectiles.length, 0, 'flight settled within 3 s');
    assert.ok(s.seq > seq0);
    assert.ok(polls() - p0 <= 6, 'state polls while the shot flew: ' + (polls() - p0));
  } finally { await mf.dispose(); }
});
