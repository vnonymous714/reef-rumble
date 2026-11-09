/* Local e2e: signup → login → admin +50 → me balance → delete test rows. Never prints secrets. */
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8792;
const ADMIN = 'test-admin-token-local-only';
const USER = 'E2eTestUser' + String(Date.now()).slice(-5);
const PASS = 'testpass99';

execSync('npx wrangler d1 migrations apply reef-rumble --local', { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, CI: '1' } });

const log = '/tmp/rr-auth-e2e.log';
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT),
  '--var', 'BOT_TOKEN:123456:TEST',
  '--var', 'WEBHOOK_SECRET:x',
  '--var', `ADMIN_PASS:${ADMIN}`,
  '--var', `ADMIN_TOKEN:${ADMIN}`,
  '--var', 'ALLOWED_ORIGIN:http://127.0.0.1:8795',
  '--var', 'TG_API:http://127.0.0.1:9'], {
  cwd: path.join(__dirname, '..'),
  stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')],
  env: { ...process.env, CI: '1' }
});

async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT); if (r.ok || r.status === 200) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('worker not up');
}
const post = (p, body, tok) => fetch('http://127.0.0.1:' + PORT + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Reef-Protocol': '2', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: JSON.stringify(body || {})
}).then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));

const out = [];
try {
  await waitUp();
  let r = await post('/api/auth/signup', { username: USER, password: PASS });
  if (r.status !== 200 || !r.j.token || !/^RR-\d{6}$/.test(r.j.public_id)) throw new Error('signup fail ' + JSON.stringify({ status: r.status, err: r.j.error, pid: r.j.public_id && 'set' }));
  out.push('signup ' + r.j.public_id + ' bal=' + r.j.balance);
  const publicId = r.j.public_id;
  const tok = r.j.token;
  const startBal = r.j.balance;

  r = await post('/api/auth/login', { username: USER, password: PASS });
  if (r.status !== 200 || !r.j.token) throw new Error('login fail');
  out.push('login ok');

  r = await post('/api/auth/login', { username: USER, password: 'wrongpass1' });
  if (r.status !== 401) throw new Error('bad login should 401 got ' + r.status);
  out.push('bad login rejected');

  r = await post('/rpc/rr_admin', { token: ADMIN, op: 'add', pid: publicId, amt: 7777, reason: 'pre-reset bump' });
  if (!r.j.ok) throw new Error('bump fail');
  r = await post('/rpc/rr_admin', { token: ADMIN, op: 'reset', pid: publicId, reason: '' });
  if (r.status !== 200 || !r.j.ok || r.j.balance !== 5000) throw new Error('reset no-reason fail ' + JSON.stringify(r.j));
  out.push('reset empty reason → ' + r.j.balance);

  r = await post('/rpc/rr_admin', { token: ADMIN, op: 'add', pid: publicId, amt: 5000, reason: 'e2e +50 credits' });
  if (r.status !== 200 || !r.j.ok) throw new Error('adjust fail ' + JSON.stringify(r.j));
  out.push('admin +50 → bal ' + r.j.balance);
  if (r.j.balance !== startBal + 5000) throw new Error('balance mismatch after adjust');

  r = await post('/api/me', {}, tok);
  if (r.status !== 200 || r.j.balance !== startBal + 5000) throw new Error('me bal ' + r.j.balance);
  out.push('me confirms ' + r.j.balance);

  r = await post('/rpc/rr_admin', { token: ADMIN, op: 'audit' });
  const hit = (r.j || []).find(a => a.public_id === publicId && a.action === 'add');
  if (!hit || hit.reason !== 'e2e +50 credits' || hit.bal_after !== startBal + 5000) throw new Error('audit missing');
  out.push('audit ok');

  /* cleanup test user */
  execSync(`npx wrangler d1 execute reef-rumble --local --command "DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE username='${USER}'); DELETE FROM audit_log WHERE username='${USER}'; DELETE FROM accounts WHERE username='${USER}';"`, {
    cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, CI: '1' }
  });
  out.push('cleanup ok');
  console.log(out.join('\n'));
  console.log('AUTH_E2E_PASS');
} catch (e) {
  console.error('AUTH_E2E_FAIL', e.message);
  try { console.error(fs.readFileSync(log, 'utf8').slice(-2000)); } catch {}
  process.exitCode = 1;
} finally {
  try { process.kill(-dev.pid, 'SIGTERM'); } catch { try { dev.kill('SIGTERM'); } catch {} }
}
