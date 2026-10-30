/* Headless check of the client in Telegram mode against local wrangler dev + stub Telegram API. */
const { chromium } = require('/workspace/pw/node_modules/playwright-core');
const { spawn, execSync } = require('child_process'); const http = require('http'); const fs = require('fs'); const path = require('path');
const TOKEN = '123456:TEST_FAKE_TOKEN', WH = 'local-webhook-secret', PORT = 8788, STUB = 8789, SITE = 8795;
(async () => {
  const { signInitData } = await import('../src/tg.js');
  let lastInvoice = null;
  http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { const m = q.url.split('/').pop(); if (m === 'createInvoiceLink') lastInvoice = JSON.parse(b); r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ ok: true, result: m === 'createInvoiceLink' ? 'https://t.me/$inv' : true })); }); }).listen(STUB);
  const root = path.resolve(__dirname, '../..');
  http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
    if (f.endsWith('config.js')) { r.setHeader('Content-Type', 'text/javascript'); return r.end(`window.RR_API='http://127.0.0.1:${PORT}';`); }
    fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'); r.end(d); }); }).listen(SITE);
  execSync('rm -rf .wrangler/state && npx wrangler d1 migrations apply reef-rumble --local', { stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--var', `TG_API:http://127.0.0.1:${STUB}`, '--var', `BOT_TOKEN:${TOKEN}`, '--var', `WEBHOOK_SECRET:${WH}`, '--var', 'ADMIN_PASS:x', '--var', `ALLOWED_ORIGIN:http://127.0.0.1:${SITE}`], { stdio: ['ignore', fs.openSync('/tmp/e2e-dev.log', 'w'), 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:' + PORT); break; } catch (e) { await new Promise(r => setTimeout(r, 1000)); } }
  const init = await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5151 }) }, TOKEN);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ok = [], bad = [];
  try {
    for (const [w, h] of [[844, 390], [667, 375], [1024, 360]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
      await page.route('https://telegram.org/js/telegram-web-app.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(init)},ready(){},expand(){},openInvoice(l,cb){window.__inv=cb;}}};` }));
      await page.goto(`http://127.0.0.1:${SITE}/#tgWebAppData=x`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      const tg = await page.evaluate(() => ({ tg: document.documentElement.classList.contains('tgmode'), bal: __reef.S.bal, pid: RRT.pid, rebuy: getComputedStyle(document.getElementById('rebuyBtn')).display, btn: document.querySelector('[data-star]') && document.querySelector('[data-star]').textContent }));
      (tg.tg && /^t[0-9a-f]{15}$/.test(tg.pid) && tg.rebuy === 'none' && /Stars/.test(tg.btn) ? ok : bad).push(`${w}x${h} boot ${JSON.stringify(tg)}`);
      const desk = await page.evaluate(() => getComputedStyle(document.getElementById('desk')).display);
      (desk === 'none' ? ok : bad).push(`${w}x${h} desk note hidden in TG: ${desk}`);
      if (w === 844) {
        // season start grant via welcome
        await page.waitForSelector('#welcomeM.open', { timeout: 8000 }); await page.tap('#wStart', { timeout: 5000 }); /* real touch tap, like a phone */
        await page.waitForTimeout(1500);
        let me = await (await fetch(`http://127.0.0.1:${PORT}/api/me`, { method: 'POST', body: JSON.stringify({ initData: init }) })).json();
        (me.balance === 20000 ? ok : bad).push('season grant on server ' + me.balance);
        // simulate play: bet 1000 lose; slots bridge
        await page.evaluate(() => { __slotsBridge.credit(-1000); __slotsBridge.addPlaythrough(1000); });
        await page.waitForTimeout(6500);
        me = await (await fetch(`http://127.0.0.1:${PORT}/api/me`, { method: 'POST', body: JSON.stringify({ initData: init }) })).json();
        (me.balance === 19000 && me.pt === 1000 ? ok : bad).push(`play synced: bal ${me.balance} pt ${me.pt}`);
        // buy pack 0 through store
        await page.evaluate(() => document.getElementById('storeBtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        console.log('ME', await page.evaluate(async (u) => { try { const r = await fetch(u + '/api/me', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ initData: Telegram.WebApp.initData }) }); return r.status + ' ' + (await r.text()).slice(0,200); } catch (e) { return String(e); } }, 'http://127.0.0.1:' + PORT)); console.log('BOOT', tg, errs, await page.evaluate(() => document.getElementById('packs').innerHTML.slice(0,200))); await page.evaluate(() => document.querySelector('[data-star="0"]').click());
        await page.waitForTimeout(800);
        await page.screenshot({ path: '/workspace/fish-game/shots/tg-store-844x390.png' });
        const sp = { update_id: 1, message: { chat: { id: 5151, type: 'private' }, from: { id: 5151 }, successful_payment: { currency: 'XTR', total_amount: lastInvoice.prices[0].amount, invoice_payload: lastInvoice.payload, telegram_payment_charge_id: 'E2E-1' } } };
        for (let i = 0; i < 2; i++) await fetch(`http://127.0.0.1:${PORT}/tg/webhook`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': WH }, body: JSON.stringify(sp) });
        await page.evaluate(() => window.__inv('paid'));
        await page.waitForTimeout(3500);
        const bal = await page.evaluate(() => __reef.S.bal);
        (bal === 119000 ? ok : bad).push('client balance after Stars pack (once) ' + bal);
      } else await page.screenshot({ path: `/workspace/fish-game/shots/tg-${w}x${h}.png` });
      (errs.length ? bad : ok).push(`${w}x${h} page errors: ${errs.length} ${errs.slice(0, 2)}`);
      await ctx.close();
    }
  } finally { await browser.close(); dev.kill('SIGINT'); }
  console.log('OK:\n ' + ok.join('\n ')); console.log('FAIL:\n ' + bad.join('\n ')); process.exit(bad.length ? 1 : 0);
})();
