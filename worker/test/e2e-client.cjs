/* Headless check of the client in Telegram mode against local wrangler dev + stub Telegram API. */
const { chromium } = require('/workspace/pw/node_modules/playwright-core');
const { spawn, execSync } = require('child_process'); const http = require('http'); const fs = require('fs'); const path = require('path');
const TOKEN = '123456:TEST_FAKE_TOKEN', WH = 'local-webhook-secret', PORT = 8788, STUB = 8789, SITE = 8795;
(async () => {
  const { signInitData } = await import('../src/tg.js');
  let lastInvoice = null; const invoices = {};
  http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { const m = q.url.split('/').pop(); if (m === 'createInvoiceLink') { lastInvoice = JSON.parse(b); lastInvoice._link = 'https://t.me/$inv-' + (lastInvoice.payload || Date.now()); invoices[lastInvoice._link] = lastInvoice; } r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ ok: true, result: m === 'createInvoiceLink' ? lastInvoice._link : true })); }); }).listen(STUB);
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
      const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); const evPids = new Set(); page.on('request', r => { if (r.url().endsWith('/events')) try { JSON.parse(r.postData()).forEach(e => evPids.add(e.player_id)); } catch (_) {} });
      await page.route('https://telegram.org/js/telegram-web-app.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(init)},ready(){},expand(){},openInvoice(l,cb){window.__invLink=l;window.__inv=cb;}}};` }));
      await page.goto(`http://127.0.0.1:${SITE}/#tgWebAppData=x`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      const tg = await page.evaluate(() => ({ tg: document.documentElement.classList.contains('tgmode'), bal: __reef.S.bal, pid: RRT.pid, rebuy: getComputedStyle(document.getElementById('rebuyBtn')).display, btn: document.querySelector('[data-star]') && document.querySelector('[data-star]').textContent }));
      (tg.tg && /^t[0-9a-f]{15}$/.test(tg.pid) && tg.rebuy !== 'none' && /Stars/.test(tg.btn) ? ok : bad).push(`${w}x${h} boot ${JSON.stringify(tg)}`);
      const tide = await page.evaluate(() => { const n = document.getElementById('tideBan'); n.classList.add('on'); n.textContent = 'LOW TIDE — published payout 84% · 3 min left'; const r = n.getBoundingClientRect(); const hit = ['#balPill','#freeBtn','#slotsBtn','#storeBtn','#infoBtn','#muteBtn','#jpPill','#ptMeter','#cashBtn'].filter(s => { const e = document.querySelector(s); if (!e) return 0; const q = e.getBoundingClientRect(); return q.width && !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom); }); n.classList.remove('on'); return hit; });
      (tide.length ? bad : ok).push(`${w}x${h} low tide banner covers: ${tide.join(',') || 'nothing'}`);
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
        // late win (bullet landed after its bet synced): must not be rejected or wiped, plus a FREE refill in the same window
        const s400 = []; page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) s400.push(r.status() + ' ' + r.url()); });
        await page.evaluate(() => { __slotsBridge.credit(500); }); await page.waitForTimeout(6500);
        await page.evaluate(() => { __slotsBridge.credit(-100); __slotsBridge.addPlaythrough(100); }); await page.waitForTimeout(6500);
        me = await (await fetch(`http://127.0.0.1:${PORT}/api/me`, { method: 'POST', body: JSON.stringify({ initData: init }) })).json();
        const lb = await page.evaluate(() => __reef.S.bal);
        (me.balance === 19400 && lb === 19400 && !s400.length ? ok : bad).push(`late win kept: server ${me.balance} client ${lb} errors ${s400.join(',') || 'none'}`);
        // buy pack 0 through store
        // Rebuy panel: warm on open, then pointerup must open invoice from cache (no extra create after warm)
        const invBefore = lastInvoice && lastInvoice.payload;
        await page.evaluate(() => document.getElementById('rebuyBtn').click());
        await page.waitForTimeout(600);
        const warmed = lastInvoice && lastInvoice.payload !== invBefore;
        await page.evaluate(() => {
          const b = document.querySelector('#rebuyPresets [data-star="0"]');
          b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
          b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
        });
        await page.waitForTimeout(200);
        const rebuyFast = await page.evaluate(() => ({ link: window.__invLink || null, busy: !!document.querySelector('#rebuyPresets [data-star="0"].busy') }));
        (warmed && rebuyFast.link && rebuyFast.busy ? ok : bad).push('rebuy tap instant invoice ' + JSON.stringify({ warmed, ...rebuyFast }));
        await page.evaluate(() => { if (window.__inv) window.__inv('cancelled'); });
        await page.waitForTimeout(200);
        // Store pack 0 purchase (server-confirmed grant)
        await page.evaluate(() => document.getElementById('storeBtn').click());
        await page.waitForTimeout(500);
        console.log('ME', await page.evaluate(async (u) => { try { const r = await fetch(u + '/api/me', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ initData: Telegram.WebApp.initData }) }); return r.status + ' ' + (await r.text()).slice(0,200); } catch (e) { return String(e); } }, 'http://127.0.0.1:' + PORT)); console.log('BOOT', tg, errs, await page.evaluate(() => document.getElementById('packs').innerHTML.slice(0,200)));
        await page.evaluate(() => document.querySelector('#packs [data-star="0"]').click());
        await page.waitForTimeout(800);
        await page.screenshot({ path: '/workspace/fish-game/shots/tg-store-844x390.png' });
        const opened = await page.evaluate(() => window.__invLink);
        const useInv = invoices[opened] || lastInvoice;
        if (!invoices[opened]) bad.push('could not match opened invoice link ' + opened);
        const sp = { update_id: 1, message: { chat: { id: 5151, type: 'private' }, from: { id: 5151 }, successful_payment: { currency: 'XTR', total_amount: useInv.prices[0].amount, invoice_payload: useInv.payload, telegram_payment_charge_id: 'E2E-1' } } };
        for (let i = 0; i < 2; i++) await fetch(`http://127.0.0.1:${PORT}/tg/webhook`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': WH }, body: JSON.stringify(sp) });
        await page.evaluate(() => window.__inv('paid'));
        await page.waitForTimeout(3500);
        const bal = await page.evaluate(() => __reef.S.bal);
        (bal === 119400 ? ok : bad).push('client balance after Stars pack (once) ' + bal);
        await page.waitForTimeout(2500); const pids = [...evPids]; (pids.length && pids.every(x => /^t[0-9a-f]{15}$/.test(x)) ? ok : bad).push('TG telemetry uses server pid only: ' + pids.join(','));
      } else await page.screenshot({ path: `/workspace/fish-game/shots/tg-${w}x${h}.png` });
      (errs.length ? bad : ok).push(`${w}x${h} page errors: ${errs.length} ${errs.slice(0, 2)}`);
      await ctx.close();
    }
  } finally { await browser.close(); dev.kill('SIGINT'); }
  console.log('OK:\n ' + ok.join('\n ')); console.log('FAIL:\n ' + bad.join('\n ')); process.exit(bad.length ? 1 : 0);
})();
