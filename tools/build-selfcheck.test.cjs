// tg40: Telegram WebView cache-bust self-check (index.html inline script).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const src = html.match(/<script>\s*\/\* tg40 build self-check[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');

async function load(href, workerBuild, store = new Map(), opts = {}) {
  const replaced = [];
  const fetched = [];
  const win = {
    RR_API: 'https://api.example', RR_LOCAL_QA: opts.qa,
    fetch: async (u, o) => { fetched.push([u, o]); if (opts.down) throw new Error('offline'); return { ok: true, json: async () => ({ clientBuild: workerBuild }) }; },
  };
  const ctx = {
    window: win, URL, fetch: win.fetch,
    location: { href, replace: (u) => replaced.push(u) },
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  };
  vm.runInNewContext(src, ctx);
  await new Promise((r) => setTimeout(r, 10));
  return { replaced, fetched, win, store };
}

test('page build is tg40 and every asset marker matches it', () => {
  assert.match(src, /window\.RR_BUILD='tg40'/);
  assert.ok(!/\?v=tg3[0-9]\b/.test(html), 'no stale ?v= markers');
  assert.ok(html.includes('config.js?v=tg40'));
  assert.ok(html.indexOf('tg40 build self-check') < html.indexOf('engine.js?v=tg40'), 'self-check runs before the game loads');
});

test('older page than the Worker: reloads once with ?v=<build>, keeping Telegram hash data', async () => {
  const href = 'https://vnonymous714.github.io/reef-rumble/?tg=1#tgWebAppData=abc';
  const r = await load(href, 'tg41');
  assert.equal(r.fetched[0][0], 'https://api.example/api/client-version');
  assert.equal(r.fetched[0][1].cache, 'no-store');
  assert.deepEqual(r.replaced, ['https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg41#tgWebAppData=abc']);
  // Same tab, still served the old page: no second reload (no loop).
  const again = await load(href, 'tg41', r.store);
  assert.deepEqual(again.replaced, []);
  // A fresh tab already on the busted URL never reloads either.
  const busted = await load('https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg41', 'tg41');
  assert.deepEqual(busted.replaced, []);
});

test('same, older or unknown Worker build, offline, QA: never reloads', async () => {
  for (const b of ['tg40', 'tg39', 'tg38', 'tg37', 'tg36', 'tg9', '', null, 'weird']) assert.deepEqual((await load('https://x/?tg=1', b)).replaced, [], String(b));
  assert.deepEqual((await load('https://x/?tg=1', 'tg41', new Map(), { down: true })).replaced, []);
  assert.deepEqual((await load('https://x/?tg=1', 'tg41', new Map(), { qa: true })).replaced, []);
});
