/* Source checks for Windows desktop play. No live-site browser automation. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const root = require('node:path').join(__dirname, '..');
const html = readFileSync(root + '/index.html', 'utf8');
const game = readFileSync(root + '/game.js', 'utf8');
const manifest = JSON.parse(readFileSync(root + '/manifest.webmanifest', 'utf8'));
const sw = readFileSync(root + '/sw.js', 'utf8');

test('desktop gate no longer hides the game', () => {
  assert.doesNotMatch(html, /html:not\(\.tgmode\) #wrap,html:not\(\.tgmode\) #preload\{display:none/);
  assert.doesNotMatch(html, /#desk\{display:flex\}/);
  assert.match(html, /#desk\{display:none!important\}/);
});

test('desktop letterboxes a 16:9 stage and keeps Telegram full-bleed', () => {
  assert.match(html, /html:not\(\.tgmode\) #wrap\{[^}]*width:min\(100vw,calc\(100vh \* 16 \/ 9\)\)/);
  assert.match(html, /html:not\(\.tgmode\) #wrap\{[^}]*height:min\(100vh,calc\(100vw \* 9 \/ 16\)\)/);
  assert.match(game, /const DESK_MQ = '\(min-width:1000px\) and \(hover:hover\) and \(pointer:fine\), \(min-width:600px\) and \(min-height:600px\)'/);
  assert.match(game, /function isDeskPlay\(\)/);
  assert.match(game, /classList\.contains\('tgmode'\)/);
  assert.match(game, /desk \? 3\.2 : 1\.5/);
  assert.match(game, /!isDeskPlay\(\) && \(Math\.max\(innerWidth, innerHeight\)/);
});

test('mouse aim, hold-to-fire, right-click lock, and desktop keyboard exist', () => {
  assert.match(game, /if \(e\.button === 2\) \{ toggleLock\(\); return; \}/);
  assert.match(game, /if \(firing \|\| isDeskPlay\(\)\) \{ const p = pt\(e\); setAim\(p\.x, p\.y\); \}/);
  assert.match(game, /e\.code === 'Space'/);
  assert.match(game, /k === 'a' \|\| k === 'A'/);
  assert.match(game, /k === 'l' \|\| k === 'L'/);
  assert.match(game, /k === 'm' \|\| k === 'M'/);
  assert.match(game, /k === '\+' \|\| k === '=' \|\| k === 'Add'/);
  assert.match(game, /typingInField\(\)/);
  assert.match(html, /id="deskHint"/);
  assert.match(html, /aria-keyshortcuts="A"/);
});

test('hover states exist for fine pointers only', () => {
  assert.match(html, /@media \(hover:hover\) and \(pointer:fine\)/);
  assert.match(html, /\.ib:hover,\.tg:hover,\.bet button:hover/);
});

test('PWA manifest and service worker remain installable', () => {
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(i => i.sizes === '192x192'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512'));
  assert.match(html, /rel="manifest"/);
  assert.match(html, /serviceWorker\.register\('\.\/sw\.js/);
  assert.match(sw, /self\.addEventListener\('fetch'/);
  assert.match(sw, /self\.addEventListener\('install'/);
  assert.match(game, /beforeinstallprompt/);
});

test('play-credits copy is unchanged', () => {
  assert.match(html, /Play credits only/);
  assert.doesNotMatch(html, /\$[0-9]/);
});
