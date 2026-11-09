import {adjustCanonical} from './external-writer.js';
import { gameV2 } from './game-v2.js';
/* Reef Rumble Telegram worker. Telegram Stars (XTR) only. Play credits: no cash value, no cash-out, no withdrawals by players. */
import {
  verifyInitData, pidFor, PACKS, boundEvent, GRANTS, START_BAL, START_BONUS, playDeltaOk, safeEq,
  validUsername, validPassword, publicIdFrom, pidForAccount, hashPassword, verifyPassword,
  sha256Hex, newToken, SESSION_TTL_MS, PROTECTED_TG_ID
} from './tg.js';

const NOW = () => Date.now();
const TERMS = 'Reef Rumble terms (short):\n• Play credits are for entertainment only. They have NO cash value and can never be cashed out, withdrawn, transferred, or exchanged for money, crypto, or prizes.\n• Stars purchases buy play credits only. Telegram Stars rules apply: telegram.org/tos/stars\n• This is a student project for friends. Must be 18+.\n• Problems with a purchase: /paysupport';
const SUPPORT = 'Support: describe the problem in this chat and the developer will reply. For payment issues use /paysupport.';
const PAYSUPPORT = 'Payment support: reply here with the date and pack you bought. Credits are delivered automatically after Telegram confirms payment. If credits did not arrive or you were charged by mistake, we can refund the Stars.';

function cors(env, req) {
  const o = req.headers.get('Origin');
  const allow = o && (o === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) ? o : env.ALLOWED_ORIGIN;
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Prefer, X-Reef-Protocol', 'Vary': 'Origin' };
}
const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function tg(env, method, body) {
  const r = await fetch(`${env.TG_API}/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('tg ' + method + ' failed: ' + (j.description || r.status));
  return j.result;
}

async function rate(env, key, limit, windowMs) {
  const w = Math.floor(NOW() / windowMs);
  const r = await env.DB.prepare('INSERT INTO rl (k, win, c) VALUES (?1, ?2, 1) ON CONFLICT(k) DO UPDATE SET c = CASE WHEN win = ?2 THEN c + 1 ELSE 1 END, win = ?2 RETURNING c')
    .bind(key, w).first();
  if (Math.random() < 0.02) { const d = NOW() - 86400000; await env.DB.prepare("DELETE FROM rl WHERE (k LIKE 'af:%' AND win < ?1) OR (k NOT LIKE 'af:%' AND win < ?2)").bind(Math.floor(d / 900000), Math.floor(d / 60000)).run(); }
  return r.c <= limit;
}

async function player(env, user) {
  const pid = await pidFor(user.id), t = NOW();
  await env.DB.prepare('INSERT INTO players (tg_id, pid, created_at, last_seen) VALUES (?1, ?2, ?3, ?3) ON CONFLICT(tg_id) DO UPDATE SET last_seen = ?3').bind(user.id, pid, t).run();
  const p = await env.DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(user.id).first();
  /* Keep a linked accounts row so admin Players tab / credit adjust work for TG users too. */
  await ensureTgAccount(env, p);
  return p;
}

async function ensureTgAccount(env, p) {
  if (!p || !p.tg_id) return null;
  const existing = await env.DB.prepare('SELECT * FROM accounts WHERE tg_id = ?').bind(p.tg_id).first();
  if(existing) return finalizeTgIdentity(env,existing);
  const t = NOW();
  const tmp = 'TMP-' + p.pid;
  const r = await env.DB.prepare('INSERT INTO accounts (public_id, pid, username, pass_salt, pass_hash, tg_id, balance, bonus, pt, season, season_at, last_refill, last_daily, sync_seq, created_at, last_seen) VALUES (?1, ?2, NULL, \'\', \'\', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT DO NOTHING')
    .bind(tmp, tmp, p.tg_id, p.balance, p.bonus, p.pt, p.season, p.season_at, p.last_refill, p.last_daily, p.sync_seq, p.created_at || t, p.last_seen || t).run();
  const created=await env.DB.prepare('SELECT * FROM accounts WHERE tg_id=?').bind(p.tg_id).first();
  if(!created)throw bad('Telegram identity contention; retry',409);
  return finalizeTgIdentity(env,created);
}

async function finalizeTgIdentity(env,account){
 if(!account.public_id.startsWith('TMP-'))return account;
 const pub=publicIdFrom(account.id),pid=await pidForAccount(account.id);
 await env.DB.prepare('UPDATE accounts SET public_id=?2,pid=?3 WHERE id=?1 AND public_id=?4').bind(account.id,pub,pid,account.public_id).run();
 return env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(account.id).first();
}

const viewAcct = a => ({
  pid: a.pid, public_id: a.public_id, username: a.username || null, tg_linked: !!a.tg_id,
  balance: a.balance, bonus: a.bonus, pt: a.pt, pt_need: a.bonus * 10, season: a.season, seq: a.sync_seq
});
const view = p => ({ pid: p.pid, balance: p.balance, bonus: p.bonus, pt: p.pt, pt_need: p.bonus * 10, season: p.season, seq: p.sync_seq });

async function authTg(env, body) {
  const u = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!u) throw bad('bad initData', 401);
  return u;
}

function bearerFrom(req, body) {
  const h = req.headers.get('Authorization') || '';
  if (h.startsWith('Bearer ') && h.length > 7) return h.slice(7).trim();
  if (body && typeof body.token === 'string') return body.token.trim();
  return '';
}

async function issueSession(env, accountId) {
  const token = newToken(), th = await sha256Hex(token), t = NOW(), exp = t + SESSION_TTL_MS;
  await env.DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)').bind(th, accountId, exp, t).run();
  return { token, expires_at: exp };
}

async function resolveAccount(env, req, body) {
  const tok = bearerFrom(req, body);
  if (!tok || tok.length < 32 || tok.length > 128) return null;
  const th = await sha256Hex(tok);
  const row = await env.DB.prepare('SELECT s.expires_at, a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?1').bind(th).first();
  if (!row || row.expires_at < NOW()) {
    if (row) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run();
    return null;
  }
  return { account: row, token_hash: th };
}

async function refreshSession(env, tokenHash, accountId) {
  const exp = NOW() + SESSION_TTL_MS;
  await env.DB.prepare('UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1').bind(tokenHash, exp).run();
  return exp;
}

/* ---------- Telegram webhook ---------- */
async function webhook(env, req) {
  if (!env.WEBHOOK_SECRET || !safeEq(req.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.WEBHOOK_SECRET)) return new Response('forbidden', { status: 403 });
  const up = await req.json().catch(() => null);
  if (!up) return new Response('bad', { status: 400 });
  if (up.pre_checkout_query) {
    const q = up.pre_checkout_query, m = /^rr1:(\d):(\d+):[0-9a-f]{8}$/.exec(q.invoice_payload || ''), pk = m && PACKS[+m[1]];
    const ok = !!(pk && q.currency === 'XTR' && q.total_amount === pk.stars && +m[2] === q.from.id);
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'This pack is no longer available. No Stars were charged.' });
    return json({ ok: true });
  }
  const msg = up.message;
  if (msg && msg.successful_payment) { await creditPayment(env, msg.from.id, msg.successful_payment); return json({ ok: true }); }
  if (msg && typeof msg.text === 'string' && msg.chat && msg.chat.type === 'private') {
    const cmd = msg.text.split(/[\s@]/)[0];
    const text = cmd === '/terms' ? TERMS : cmd === '/support' ? SUPPORT : cmd === '/paysupport' ? PAYSUPPORT : cmd === '/start'
      ? 'Welcome to Reef Rumble.\nPlay credits only: no cash value, no cash-out, no withdrawals. Stars buy play credits only (digital goods).\nTap Play below. Commands: /terms /support /paysupport' : null;
    if (text) {
      const extra = cmd === '/start' && env.MINIAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: 'Play Reef Rumble', web_app: { url: env.MINIAPP_URL } }]] } } : {};
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text, ...extra });
    }
  }
  return json({ ok: true });
}

export async function creditPayment(env, fromId, sp) {
  if(env.GAME_V2!=='1')throw bad('Canonical payment ledger unavailable',503);
  if(fromId===PROTECTED_TG_ID)return {credited:false,reason:'protected'};
  const m = /^rr1:(\d):(\d+):[0-9a-f]{8}$/.exec(sp.invoice_payload || ''), pk = m && PACKS[+m[1]];
  const charge = String(sp.telegram_payment_charge_id || '');
  if (!charge || charge.length > 200) return { credited: false, reason: 'no charge id' };
  const valid = !!(pk && sp.currency === 'XTR' && sp.total_amount === pk.stars && +m[2] === fromId);
  const t = NOW(), amt = valid ? pk.c + pk.bonus : 0;
  await player(env, { id: fromId });
  const DB = env.DB, pend = 'EXISTS (SELECT 1 FROM payments WHERE charge_id = ?1 AND credited = 0)';
  const res = await DB.batch([
    DB.prepare('INSERT INTO payments (charge_id, tg_id, pack, stars, credits, bonus, payload, credited, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(charge_id) DO NOTHING')
      .bind(charge, fromId, pk ? +m[1] : -1, sp.total_amount | 0, valid ? pk.c : 0, valid ? pk.bonus : 0, String(sp.invoice_payload).slice(0, 64), valid ? 0 : 2, t),
    DB.prepare(`INSERT INTO ledger (tg_id, kind, amount, ref, created_at) SELECT ?2, 'stars_purchase', ?3, ?1, ?4 WHERE ${pend}`).bind(charge, fromId, amt, t),

    ...(env.GAME_V2==='1'?[DB.prepare(`INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,external_delta,account_seq) SELECT id,'payment_'||?1,'stars_purchase',0,0,MIN(balance+?3,99999999999),?4,MIN(balance+?3,99999999999)-balance,sync_seq+1 FROM accounts WHERE tg_id=?2 AND ${pend}`).bind(charge,fromId,amt,t)]:[]),
    DB.prepare(`UPDATE accounts SET balance = MIN(balance + ?3, 99999999999), bonus = bonus + ?4, sync_seq=sync_seq+1 WHERE tg_id = ?2 AND ${pend}`).bind(charge, fromId, amt, valid ? pk.bonus : 0),
    DB.prepare(`UPDATE players SET balance=(SELECT balance FROM accounts WHERE tg_id=?2),bonus=(SELECT bonus FROM accounts WHERE tg_id=?2),sync_seq=(SELECT sync_seq FROM accounts WHERE tg_id=?2) WHERE tg_id=?2 AND ${pend}`).bind(charge,fromId),
    DB.prepare(`INSERT INTO events (player_id, type, credit, n, meta, created_at) SELECT pid, 'stars_purchase', ?3, ?4, 'pack ' || ?5, ?6 FROM players WHERE tg_id = ?2 AND ${pend}`).bind(charge, fromId, amt, sp.total_amount | 0, pk ? +m[1] : -1, t),
    DB.prepare('UPDATE payments SET credited = 1 WHERE charge_id = ?1 AND credited = 0').bind(charge)
  ]);
  return { credited: res[res.length-1].meta.changes === 1, valid };
}

/* ---------- Auth API (username / password) ---------- */
async function authApi(env, req, path, body) {
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const DB = env.DB, t = NOW();

  if (path === '/api/auth/signup') {
    if (!(await rate(env, 'su:' + ip, 10, 3600000))) throw bad('slow down', 429);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!validUsername(username)) throw bad('bad username');
    if (!validPassword(password)) throw bad('bad password');
    const taken = await DB.prepare('SELECT id FROM accounts WHERE username = ? COLLATE NOCASE').bind(username).first();
    if (taken) throw bad('username taken', 409);
    const { salt, hash } = await hashPassword(password);
    const tmp = 'TMP-' + username.toLowerCase() + '-' + t;
    const r = await DB.prepare('INSERT INTO accounts (public_id, pid, username, pass_salt, pass_hash, tg_id, balance, bonus, pt, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?7, ?8, 0, ?6, ?6)')
      .bind(tmp, tmp, username, salt, hash, t, START_BAL, START_BONUS).run();
    const id = r.meta.last_row_id;
    const pub = publicIdFrom(id), apid = await pidForAccount(id);
    await DB.prepare('UPDATE accounts SET public_id = ?2, pid = ?3 WHERE id = ?1').bind(id, pub, apid).run();
    const sess = await issueSession(env, id);
    const a = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
    return { ...viewAcct(a), token: sess.token, expires_at: sess.expires_at, packs: PACKS };
  }

  if (path === '/api/auth/login') {
    if (!(await rate(env, 'li:' + ip, 20, 900000))) throw bad('slow down', 429);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) throw bad('bad credentials', 401);
    const a = await DB.prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE').bind(username).first();
    if (!a || !a.pass_hash) {
      await rate(env, 'lif:' + ip, 10, 900000);
      throw bad('bad credentials', 401);
    }
    if (!(await verifyPassword(password, a.pass_salt, a.pass_hash))) {
      await rate(env, 'lif:' + ip, 10, 900000);
      throw bad('bad credentials', 401);
    }
    await DB.prepare('UPDATE accounts SET last_seen = ?2 WHERE id = ?1').bind(a.id, t).run();
    const sess = await issueSession(env, a.id);
    return { ...viewAcct(a), token: sess.token, expires_at: sess.expires_at, packs: PACKS };
  }

  if (path === '/api/auth/logout') {
    const tok = bearerFrom(req, body);
    if (tok) await DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(tok)).run();
    return { ok: true };
  }

  if (path === '/api/auth/me' || path === '/api/auth/refresh') {
    const sess = await resolveAccount(env, req, body);
    if (!sess) throw bad('unauthorized', 401);
    const exp = await refreshSession(env, sess.token_hash, sess.account.id);
    await DB.prepare('UPDATE accounts SET last_seen = ?2 WHERE id = ?1').bind(sess.account.id, t).run();
    const a = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(sess.account.id).first();
    return { ...viewAcct(a), expires_at: exp, packs: PACKS };
  }

  /* TG user sets username+password (or logged-in account links TG). */
  if (path === '/api/auth/set-creds') {
    if (!(await rate(env, 'sc:' + ip, 20, 3600000))) throw bad('slow down', 429);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!validUsername(username) || !validPassword(password)) throw bad('bad username or password');
    const taken = await DB.prepare('SELECT id, tg_id FROM accounts WHERE username = ? COLLATE NOCASE').bind(username).first();
    const { salt, hash } = await hashPassword(password);

    if (body.initData) {
      const u = await authTg(env, body);
      if (u.id === PROTECTED_TG_ID) throw bad('protected', 403);
      const p = await player(env, u);
      let a = await DB.prepare('SELECT * FROM accounts WHERE tg_id = ?').bind(u.id).first();
      if (!a) a = await ensureTgAccount(env, p);
      if (taken && taken.id !== a.id) throw bad('username taken', 409);
      await DB.prepare('UPDATE accounts SET username = ?2, pass_salt = ?3, pass_hash = ?4, last_seen = ?5 WHERE id = ?1')
        .bind(a.id, username, salt, hash, t).run();
      const sess = await issueSession(env, a.id);
      a = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(a.id).first();
      return { ...viewAcct(a), token: sess.token, expires_at: sess.expires_at, packs: PACKS };
    }

    const sess = await resolveAccount(env, req, body);
    if (!sess) throw bad('unauthorized', 401);
    if (taken && taken.id !== sess.account.id) throw bad('username taken', 409);
    await DB.prepare('UPDATE accounts SET username = ?2, pass_salt = ?3, pass_hash = ?4, last_seen = ?5 WHERE id = ?1')
      .bind(sess.account.id, username, salt, hash, t).run();
    const a = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(sess.account.id).first();
    return { ...viewAcct(a), packs: PACKS };
  }

  if (path === '/api/auth/link-tg') {
    const sess = await resolveAccount(env, req, body);
    if (!sess) throw bad('unauthorized', 401);
    const u = await authTg(env, body);
    if (u.id === PROTECTED_TG_ID) throw bad('protected', 403);
    const other = await DB.prepare('SELECT id FROM accounts WHERE tg_id = ?').bind(u.id).first();
    if (other && other.id !== sess.account.id) throw bad('tg already linked', 409);
    if(sess.account.tg_id && sess.account.tg_id!==u.id)throw bad('account already linked',409);
    const expected=sess.account.sync_seq,pid=await pidFor(u.id);
    const linked="EXISTS(SELECT 1 FROM accounts WHERE id=?1 AND tg_id=?2 AND sync_seq=?3)";
    const results=await DB.batch([
      DB.prepare('UPDATE accounts SET tg_id=?2,sync_seq=sync_seq+1,last_seen=?4 WHERE id=?1 AND sync_seq=?3 AND (tg_id IS NULL OR tg_id=?2) AND NOT EXISTS(SELECT 1 FROM accounts WHERE tg_id=?2 AND id<>?1)').bind(sess.account.id,u.id,expected,t),
      DB.prepare(`INSERT INTO players(tg_id,pid,balance,bonus,pt,sync_seq,last_daily,last_refill,created_at,last_seen) SELECT ?2,?4,balance,bonus,pt,sync_seq,last_daily,last_refill,?5,?5 FROM accounts WHERE id=?1 AND ${linked} ON CONFLICT(tg_id) DO UPDATE SET balance=excluded.balance,bonus=excluded.bonus,pt=excluded.pt,sync_seq=excluded.sync_seq,last_daily=excluded.last_daily,last_refill=excluded.last_refill,last_seen=excluded.last_seen`).bind(sess.account.id,u.id,expected+1,pid,t)
    ]);
    const a=await DB.prepare('SELECT * FROM accounts WHERE id=?').bind(sess.account.id).first();
    if(a.tg_id!==u.id)throw bad('link changed concurrently; refresh',409);
    return { ...viewAcct(a), packs: PACKS };
  }

  throw bad('not found', 404);
}

/* ---------- Mini App / account play API ---------- */
async function api(env, req, path, body) {
  /* Prefer bearer account session; fall back to Telegram initData. */
  const sess = await resolveAccount(env, req, body);
  if (sess) {
    if (!(await rate(env, 'a:' + sess.account.id, path==='/api/v2/game'?1200:120, 60000))) throw bad('slow down', 429);
    if(path === '/api/v2/game' && body.command==='attack')throw bad('use authoritative projectile launch',400);
    if(path === '/api/v2/game') return gameV2(env,sess.account.id,body);
    return apiAccount(env, path, body, sess);
  }
  const u = await authTg(env, body);
  if (!(await rate(env, 'u:' + u.id, path==='/api/v2/game'?1200:120, 60000))) throw bad('slow down', 429);
  if(path === '/api/v2/game' && u.id === PROTECTED_TG_ID) throw bad('protected',403);
  let p = await player(env, u);
  if(path === '/api/v2/game' && body.command==='attack')throw bad('use authoritative projectile launch',400);
  if(path === '/api/v2/game') { const a=await env.DB.prepare('SELECT id FROM accounts WHERE tg_id=?').bind(u.id).first();return gameV2(env,a.id,body); }
  const DB = env.DB, t = NOW();
  if (path === '/api/me') {
    const a = await DB.prepare('SELECT public_id, username FROM accounts WHERE tg_id = ?').bind(u.id).first();
    return { ...view(p), public_id: a && a.public_id, username: a && a.username, packs: PACKS };
  }
  if (path === '/api/invoice') {
    const i = body.pack | 0, pk = PACKS[i];
    if (!pk || body.pack !== i) throw bad('bad pack');
    const nonce = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
    const link = await tg(env, 'createInvoiceLink', {
      title: 'Reef Rumble play credits', currency: 'XTR', provider_token: '',
      description: `${(pk.c / 100).toLocaleString('en-US')} play credits${pk.bonus ? ' + ' + (pk.bonus / 100).toLocaleString('en-US') + ' bonus' : ''}. No cash value, no cash-out.`,
      payload: `rr1:${i}:${u.id}:${nonce}`, prices: [{ label: 'Play credits', amount: pk.stars }]
    });
    return { link };
  }
  if(path === '/api/sync'||path === '/api/grant') throw bad('authoritative client required',409);
  if (path === '/api/sync') {
    const seq = body.seq | 0, d = body.d, w = body.w;
    if (seq !== p.sync_seq + 1) return { ...view(p), stale: true };
    if (!playDeltaOk(d, w)) throw bad('bad delta');
    const need = p.bonus * 10;
    await DB.batch([
      DB.prepare('UPDATE players SET balance = MAX(0, MIN(balance + ?2, 99999999999)), pt = MIN(?3, pt + ?4), sync_seq = sync_seq + 1 WHERE tg_id = ?1 AND sync_seq = ?5').bind(u.id, d, need, w, p.sync_seq),
      DB.prepare("INSERT INTO ledger (tg_id, kind, amount, ref, created_at) VALUES (?1, 'play', ?2, ?3, ?4)").bind(u.id, d, 'w=' + w, t),
      DB.prepare('UPDATE accounts SET balance = MAX(0, MIN(balance + ?2, 99999999999)), pt = MIN(?3, pt + ?4), sync_seq = sync_seq + 1, last_seen = ?5 WHERE tg_id = ?1').bind(u.id, d, need, w, t)
    ]);
  } else if (path === '/api/grant') {
    const kind = body.kind, amt = GRANTS[kind];
    if (!amt) throw bad('grant not allowed');
    const day = new Date(t).toISOString().slice(0, 10), season = String(body.season || '').slice(0, 24);
    let sql = null, args = [];
    if (kind === 'deposit_credit') { if (p.season !== season) { sql = 'UPDATE players SET balance = ?2, bonus = ?5, pt = 0, season = ?3, season_at = ?4 WHERE tg_id = ?1 AND (season IS NULL OR season_at < ?4 - 604800000)'; args = [u.id, START_BAL, season, t, START_BONUS]; } }
    else if (kind === 'daily_bonus') { const a = Math.max(0, Math.min(amt, body.amt | 0)); sql = 'UPDATE players SET balance = balance + ?2, last_daily = ?3 WHERE tg_id = ?1 AND (last_daily IS NULL OR last_daily <> ?3)'; args = [u.id, a, day]; }
    if (sql) {
      const r = await DB.prepare(sql).bind(...args).run();
      if (r.meta.changes) {
        await DB.prepare('INSERT INTO ledger (tg_id, kind, amount, created_at) VALUES (?1, ?2, ?3, ?4)').bind(u.id, kind, args[1], t).run();
        const p2 = await DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(u.id).first();
        await DB.prepare('UPDATE accounts SET balance = ?2, bonus = ?3, pt = ?4, season = ?5, season_at = ?6, last_refill = ?7, last_daily = ?8, last_seen = ?9 WHERE tg_id = ?1')
          .bind(u.id, p2.balance, p2.bonus, p2.pt, p2.season, p2.season_at, p2.last_refill, p2.last_daily, t).run();
      }
    }
  } else throw bad('not found', 404);
  p = await DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(u.id).first();
  return view(p);
}

async function apiAccount(env, path, body, sess) {
  const DB = env.DB, t = NOW();
  let a = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(sess.account.id).first();
  await refreshSession(env, sess.token_hash, a.id);
  if (path === '/api/me') return { ...viewAcct(a), packs: PACKS };
  if(path === '/api/sync'||path === '/api/grant') throw bad('authoritative client required',409);
  if (path === '/api/invoice') throw bad('stars only in telegram', 400);
  if (path === '/api/sync') {
    const seq = body.seq | 0, d = body.d, w = body.w;
    if (seq !== a.sync_seq + 1) return { ...viewAcct(a), stale: true };
    if (!playDeltaOk(d, w)) throw bad('bad delta');
    const need = a.bonus * 10;
    await DB.prepare('UPDATE accounts SET balance = MAX(0, MIN(balance + ?2, 99999999999)), pt = MIN(?3, pt + ?4), sync_seq = sync_seq + 1, last_seen = ?5 WHERE id = ?1 AND sync_seq = ?6')
      .bind(a.id, d, need, w, t, a.sync_seq).run();
    if (a.tg_id) {
      await DB.batch([
        DB.prepare('UPDATE players SET balance = MAX(0, MIN(balance + ?2, 99999999999)), pt = MIN(?3, pt + ?4), sync_seq = sync_seq + 1 WHERE tg_id = ?1').bind(a.tg_id, d, need, w),
        DB.prepare("INSERT INTO ledger (tg_id, kind, amount, ref, created_at) VALUES (?1, 'play', ?2, ?3, ?4)").bind(a.tg_id, d, 'w=' + w, t)
      ]);
    }
  } else if (path === '/api/grant') {
    const kind = body.kind, amt = GRANTS[kind];
    if (!amt) throw bad('grant not allowed');
    const day = new Date(t).toISOString().slice(0, 10), season = String(body.season || '').slice(0, 24);
    let sql = null, args = [];
    if (kind === 'deposit_credit') { if (a.season !== season) { sql = 'UPDATE accounts SET balance = ?2, bonus = ?5, pt = 0, season = ?3, season_at = ?4, last_seen = ?4 WHERE id = ?1 AND (season IS NULL OR season_at < ?4 - 604800000)'; args = [a.id, START_BAL, season, t, START_BONUS]; } }
    else if (kind === 'daily_bonus') { const x = Math.max(0, Math.min(amt, body.amt | 0)); sql = 'UPDATE accounts SET balance = balance + ?2, last_daily = ?3, last_seen = ?4 WHERE id = ?1 AND (last_daily IS NULL OR last_daily <> ?3)'; args = [a.id, x, day, t]; }
    if (sql) {
      const r = await DB.prepare(sql).bind(...args).run();
      if (r.meta.changes && a.tg_id) {
        const a2 = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(a.id).first();
        await DB.prepare('UPDATE players SET balance = ?2, bonus = ?3, pt = ?4, season = ?5, season_at = ?6, last_refill = ?7, last_daily = ?8 WHERE tg_id = ?1')
          .bind(a.tg_id, a2.balance, a2.bonus, a2.pt, a2.season, a2.season_at, a2.last_refill, a2.last_daily).run();
        await DB.prepare('INSERT INTO ledger (tg_id, kind, amount, created_at) VALUES (?1, ?2, ?3, ?4)').bind(a.tg_id, kind, args[1], t).run();
      }
    }
  } else throw bad('not found', 404);
  a = await DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(sess.account.id).first();
  return viewAcct(a);
}

/* ---------- events ---------- */
async function events(env, req, body) {
  const rows = Array.isArray(body) ? body.slice(0, 60).map(boundEvent).filter(Boolean) : [];
  if (!rows.length) return json({ inserted: 0 }, 400, cors(env, req));
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  if (!(await rate(env, 'ev:' + rows[0].player_id, 40, 60000)) || !(await rate(env, 'evip:' + ip, 120, 60000))) return json({ error: 'rate' }, 429, cors(env, req));
  const t = NOW(), st = env.DB.prepare('INSERT INTO events (player_id, type, mode, rtp_period, bet, win, credit, balance_after, n, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  await env.DB.batch(rows.map(e => st.bind(e.player_id, e.type, e.mode, e.rtp_period, e.bet, e.win, e.credit, e.balance_after, e.n, e.meta, t)));
  return new Response(null, { status: 201, headers: cors(env, req) });
}

/* ---------- RPCs ---------- */
const label = pid => 'Player-' + String(pid).slice(0, 4).toUpperCase();
const WIN_T = "('shots','catch','wheel','jackpot','boss_catch','bomb','chain','slot_spin')";
async function rpcFn(env, req, fn, a) {
  const DB = env.DB, t = NOW(), day = Math.floor((t - 86400000)/60000)*60000,report=env.GAME_V2==='1'?'accounting_events':'events';
  const all = (s, ...b) => DB.prepare(s).bind(...b).all().then(r => r.results);
  if (fn === 'rr_live') return DB.prepare(`SELECT 'whole-minute' window_resolution,COUNT(DISTINCT CASE WHEN created_at >= ?1 THEN player_id END) players_now, COUNT(DISTINCT player_id) players_today,
      COALESCE(SUM(CASE WHEN mode='normal' THEN bet END),0) wagered_today, COALESCE(SUM(CASE WHEN mode='normal' AND type IN ${WIN_T} THEN win END),0) won_today,
      COUNT(DISTINCT CASE WHEN mode='underground' THEN player_id END) underground_today FROM ${report} WHERE created_at >= ?2`).bind(Math.floor((t - 120000)/60000)*60000, day).first();
  if (fn === 'rr_feed') return (await all(`SELECT id, player_id, type, bet, win, credit, n, meta, created_at FROM ${report} WHERE id > ?1 ORDER BY id DESC LIMIT 50`, +a.after_id || 0))
    .map(e => ({ ...e, player: label(e.player_id), player_id: undefined, created_at: new Date(e.created_at).toISOString() })).reverse();
  if (fn === 'rr_series') return (await all(`SELECT (created_at/60000)*60000 m, SUM(bet) wagered, SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END) won FROM ${report} WHERE created_at >= ?1 AND mode='normal' GROUP BY m ORDER BY m`, Math.floor((t - 3600000)/60000)*60000))
    .map(r => ({ minute: new Date(r.m).toISOString(), wagered: r.wagered, won: r.won }));
  if(fn==='rr_top'&&env.GAME_V2==='1')return (await all(`SELECT player_id,type,meta,win,created_at FROM (
    SELECT player_id,type,meta,win,created_at,id tie FROM accounting_events_live WHERE id<1000000000000 AND win>0 AND type<>'shots'
    UNION ALL SELECT a.pid,CASE WHEN l.kind='spin' THEN 'slot_spin' ELSE 'catch' END,'authoritative '||l.kind||' settlement',l.gaming_payout,l.created_at,l.id FROM economy_ledger l JOIN accounts a ON a.id=l.account_id WHERE l.gaming_payout>0
    UNION ALL SELECT a.pid,CASE WHEN w.kind='spin' THEN 'slot_spin' ELSE 'catch' END,'archived exact '||w.kind||' settlement',w.win,w.created_at,w.ledger_id FROM economy_top_wins w JOIN accounts a ON a.id=w.account_id
  ) WHERE created_at>=?1 ORDER BY win DESC,created_at DESC,tie DESC LIMIT 10`,day)).map(r=>({player:label(r.player_id),type:r.type,meta:r.meta,win:r.win,created_at:new Date(r.created_at).toISOString(),windowResolution:'minute'}));
  if (fn === 'rr_top') return (await all(`SELECT player_id, type, meta, win, created_at FROM ${report} WHERE created_at > ?1 AND win > 0 AND type <> 'shots' ORDER BY win DESC LIMIT 10`, day))
    .map(r => ({ player: label(r.player_id), type: r.type, meta: r.meta, win: r.win, created_at: new Date(r.created_at).toISOString() }));
  if (fn === 'rr_leaders') return (await all(`SELECT player_id, SUM(bet) wagered, SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END) won FROM ${report} WHERE created_at >= ?1 GROUP BY player_id ORDER BY wagered DESC LIMIT 10`, day))
    .map(r => ({ player: label(r.player_id), wagered: r.wagered, won: r.won }));
  if (fn === 'rr_house') {
    const h = await DB.prepare(`SELECT COUNT(DISTINCT player_id) players, COALESCE(SUM(bet),0) wagered, COALESCE(SUM(CASE WHEN type IN ${WIN_T} THEN win END),0) won,
      COALESCE(SUM(CASE WHEN type IN ('shots','slot_spin') THEN n END),0) bets,
      COALESCE(SUM(CASE WHEN type='deposit_credit' THEN credit END),0) deposits, COALESCE(SUM(CASE WHEN type='bonus_credit' THEN credit END),0) bonuses,
      COALESCE(SUM(CASE WHEN type='rebuy' THEN credit END),0) rebuys, COALESCE(SUM(CASE WHEN type='rebuy_bonus' THEN credit END),0) rebuy_bonuses,
      COALESCE(SUM(CASE WHEN type='daily_bonus' THEN credit END),0) daily, COALESCE(SUM(CASE WHEN type='admin_adjust' THEN credit END),0) admin,
      COALESCE(SUM(CASE WHEN type='refill' THEN credit END),0) refill, COALESCE(SUM(CASE WHEN type IN ('purchase','stars_purchase') THEN credit END),0) purchase,
      COUNT(DISTINCT CASE WHEN type='playthrough_complete' THEN player_id END) playthrough_done, COUNT(DISTINCT CASE WHEN type='cashout_request' THEN player_id END) cashout_requests,
      COALESCE(SUM(CASE WHEN rtp_period IN (95,92) THEN bet END),0) rtp95_wagered, COALESCE(SUM(CASE WHEN rtp_period IN (95,92) AND type IN ${WIN_T} THEN win END),0) rtp95_won, COALESCE(SUM(CASE WHEN rtp_period IN (95,92) AND type IN ('shots','slot_spin') THEN n END),0) rtp95_bets,
      COALESCE(SUM(CASE WHEN rtp_period IN (84,88) THEN bet END),0) rtp84_wagered, COALESCE(SUM(CASE WHEN rtp_period IN (84,88) AND type IN ${WIN_T} THEN win END),0) rtp84_won, COALESCE(SUM(CASE WHEN rtp_period IN (84,88) AND type IN ('shots','slot_spin') THEN n END),0) rtp84_bets
      FROM ${report} WHERE mode='normal'`).first();
    const pl = await DB.prepare(`SELECT SUM(CASE WHEN w > s THEN 1 ELSE 0 END) ahead, SUM(CASE WHEN w <= s THEN 1 ELSE 0 END) behind FROM (SELECT player_id, SUM(bet) s, SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END) w FROM ${report} WHERE mode='normal' GROUP BY player_id HAVING s > 0)`).first();
    return { ...h, reportingResolution:'whole-minute windows; daily rollups after24h; lifetime after90d', ahead: pl.ahead || 0, behind: pl.behind || 0, start_bal: START_BAL * (h.players || 0), cashout_eligible: h.playthrough_done, broke: null, broke_before_pt: null, top10_take: null, top10_n: null, excluded_test_players: 0,
      players_today: (await DB.prepare(`SELECT COUNT(DISTINCT player_id) c FROM ${report} WHERE created_at >= ?`).bind(day).first()).c, players_now: (await DB.prepare(`SELECT COUNT(DISTINCT player_id) c FROM ${report} WHERE created_at >= ?`).bind(Math.floor((t - 120000)/60000)*60000).first()).c };
  }
  if (fn === 'rr_pending') { if (!/^[0-9a-f]{16}$/.test(a.pid || '')) return []; return all('SELECT id, action, amount FROM admin_cmds WHERE player_id = ?1 AND applied_at IS NULL ORDER BY id LIMIT 20', a.pid); }
  if (fn === 'rr_ack') { await DB.prepare('UPDATE admin_cmds SET applied_at = ?3 WHERE id = ?2 AND player_id = ?1 AND applied_at IS NULL').bind(String(a.pid), +a.cmd_id || 0, t).run(); return true; }
  if (fn === 'rr_admin') return admin(env, req, a);
  throw bad('not found', 404);
}

function adminAuthed(env, a) {
  const pass = String(a.pass || a.token || '');
  if (env.ADMIN_TOKEN && safeEq(pass, env.ADMIN_TOKEN)) return true;
  if (env.ADMIN_PASS && safeEq(pass, env.ADMIN_PASS)) return true;
  return false;
}

async function admin(env, req, a) {
  const ip = req.headers.get('CF-Connecting-IP') || 'x', DB = env.DB, t = NOW(),report=env.GAME_V2==='1'?'accounting_events':'events';
  const fails = await DB.prepare('SELECT c, win FROM rl WHERE k = ?').bind('af:' + ip).first();
  const w = Math.floor(t / 900000);
  if (fails && fails.win === w && fails.c >= 5) return { error: 'locked, try later' };
  if (!adminAuthed(env, a)) { await rate(env, 'af:' + ip, 5, 900000); return { error: 'denied' }; }
  const op = a.op, pid = a.pid == null ? null : String(a.pid), amt = a.amt == null ? null : Math.round(+a.amt);
  let reason = a.reason == null ? '' : String(a.reason).slice(0, 200);
  const q = a.q == null ? '' : String(a.q).trim().slice(0, 64);

  if (op === 'ping') return { ok: true };
  if (op === 'players') {
    let rows;
    if (q) {
      const like = '%' + q.replace(/%/g, '') + '%';
      rows = (await DB.prepare(`SELECT a.id, a.public_id, a.pid, a.username, a.tg_id, a.balance, a.created_at, a.last_seen,
        (SELECT COALESCE(SUM(bet),0) FROM ${report} e WHERE e.player_id IN (a.pid, COALESCE((SELECT pid FROM players p WHERE p.tg_id = a.tg_id), '')) ) wagered,
        (SELECT COALESCE(SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END),0) FROM ${report} e WHERE e.player_id IN (a.pid, COALESCE((SELECT pid FROM players p WHERE p.tg_id = a.tg_id), '')) ) won
        FROM accounts a WHERE a.public_id LIKE ?1 OR IFNULL(a.username,'') LIKE ?1 OR CAST(IFNULL(a.tg_id,0) AS TEXT) LIKE ?1 OR a.pid LIKE ?1
        ORDER BY a.last_seen DESC LIMIT 100`).bind(like).all()).results;
    } else {
      rows = (await DB.prepare(`SELECT a.id, a.public_id, a.pid, a.username, a.tg_id, a.balance, a.created_at, a.last_seen,
        (SELECT COALESCE(SUM(bet),0) FROM ${report} e WHERE e.player_id IN (a.pid, COALESCE((SELECT pid FROM players p WHERE p.tg_id = a.tg_id), '')) ) wagered,
        (SELECT COALESCE(SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END),0) FROM ${report} e WHERE e.player_id IN (a.pid, COALESCE((SELECT pid FROM players p WHERE p.tg_id = a.tg_id), '')) ) won
        FROM accounts a ORDER BY a.last_seen DESC LIMIT 100`).all()).results;
    }
    return rows.map(r => ({
      public_id: r.public_id, player_id: r.pid, username: r.username || null, tg_id: r.tg_id || null,
      balance: r.balance, wagered: r.wagered || 0, won: r.won || 0,
      player: (r.username || r.public_id) + (r.tg_id ? ' (TG)' : ''),
      last_seen: new Date(r.last_seen).toISOString(), created_at: new Date(r.created_at).toISOString()
    }));
  }
  if (op === 'audit') {
    const fromAudit = (await DB.prepare('SELECT id, public_id, username, pid player_id, action, amount, reason, bal_before, bal_after, created_at FROM audit_log ORDER BY id DESC LIMIT 40').all()).results
      .map(r => ({ ...r, player: r.username || r.public_id || label(r.player_id), created_at: new Date(r.created_at).toISOString(), applied_at: new Date(r.created_at).toISOString() }));
    const fromCmds = (await DB.prepare('SELECT id, player_id, action, amount, created_at, applied_at FROM admin_cmds ORDER BY id DESC LIMIT 20').all()).results
      .map(r => ({ ...r, player: label(r.player_id), reason: '', bal_before: null, bal_after: null, created_at: new Date(r.created_at).toISOString(), applied_at: r.applied_at && new Date(r.applied_at).toISOString() }));
    return [...fromAudit, ...fromCmds].sort((x, y) => (y.id || 0) - (x.id || 0)).slice(0, 40);
  }

  if (!['reset', 'add', 'set'].includes(op) || !pid) return { error: 'bad op' };
  if (op !== 'reset' && (!Number.isSafeInteger(amt) || Math.abs(amt) > 1e10)) return { error: 'bad amount' };
  if (op === 'reset' && (!reason || reason.length < 2)) reason = 'reset to starting balance';
  if (!reason || reason.length < 2) return { error: 'reason required' };

  /* Resolve account by public_id, account pid, or TG players.pid */
  let acct = await DB.prepare('SELECT * FROM accounts WHERE public_id = ?1 OR pid = ?1').bind(pid).first();
  if (!acct && /^t[0-9a-f]{15}$/.test(pid)) {
    const pl = await DB.prepare('SELECT * FROM players WHERE pid = ?').bind(pid).first();
    if (pl) acct = await ensureTgAccount(env, pl);
  }
  if (acct) {
    if (acct.tg_id === PROTECTED_TG_ID) return { error: 'protected' };
    if(env.GAME_V2!=='1')throw bad('Canonical adjustments unavailable',503);
    if(env.GAME_V2==='1'){
      const receipt=await adjustCanonical(env,acct,{id:String(a.operation_id||''),op,amount:op==='reset'?0:amt,reason},t);
      return {ok:true,balance:receipt.balance,seq:receipt.seq,public_id:acct.public_id,replayed:receipt.replayed||false};
    }
    const before = acct.balance;
    let after = before;
    if (op === 'reset') after = START_BAL;
    else if (op === 'set') after = Math.max(0, amt);
    else after = Math.max(0, before + amt);
    await DB.prepare('UPDATE accounts SET balance = ?2, last_seen = ?3 WHERE id = ?1').bind(acct.id, after, t).run();
    if (acct.tg_id) {
      await DB.prepare('UPDATE players SET balance = ?2 WHERE tg_id = ?1').bind(acct.tg_id, after).run();
      await DB.prepare("INSERT INTO ledger (tg_id, kind, amount, ref, created_at) VALUES (?1, 'admin_' || ?2, ?3, ?4, ?5)").bind(acct.tg_id, op, after - before, reason, t).run();
    }
    await DB.prepare('INSERT INTO audit_log (account_id, pid, public_id, username, action, amount, reason, bal_before, bal_after, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
      .bind(acct.id, acct.pid, acct.public_id, acct.username, op, op === 'reset' ? null : amt, reason, before, after, t).run();
    await DB.prepare('INSERT INTO admin_cmds (player_id, action, amount, created_at, applied_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(acct.pid, op, amt, t).run();
    await DB.prepare("INSERT INTO events (player_id, type, credit, balance_after, meta, created_at) VALUES (?1, 'admin_adjust', ?2, ?3, ?4, ?5)")
      .bind(acct.pid, after - before, after, op, t).run();
    return { ok: true, balance: after, public_id: acct.public_id };
  }

  /* Legacy web hex pid → pending client apply */
  if (!/^[0-9a-f]{16}$/.test(pid)) return { error: 'no such player' };
  await DB.prepare('INSERT INTO admin_cmds (player_id, action, amount, created_at) VALUES (?1, ?2, ?3, ?4)').bind(pid, op, amt, t).run();
  return { ok: true };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });
    if(path==='/api/client-version')return json({minimumClient:2,protocol:2,receiptProtocol:3,clientBuild:'tg20',enabled:env.GAME_V2==='1'},200,{...cors(env,req),'Cache-Control':'no-store'});
    if(path.startsWith('/api/')&&req.headers.get('X-Reef-Protocol')!=='2')return json({error:'Client upgrade required; reload Reef Rumble',minimumClient:2},426,cors(env,req));
    if((env.GAME_MAINTENANCE==='1'||env.GAME_V2!=='1')&&['/api/v2/game','/api/sync','/api/grant','/api/invoice'].includes(path))return json({error:'Economy paused; no new game action accepted'},503,cors(env,req));
    if (req.method !== 'POST') return new Response('Reef Rumble API: play credits only, no cash value.', { status: 200 });
    try {
      if (path === '/tg/webhook') return await webhook(env, req);
      const body = await req.json().catch(() => null);
      if (path === '/events') return await events(env, req, body);
      if (path.startsWith('/rpc/')) return json(await rpcFn(env, req, path.slice(5), body || {}), 200, cors(env, req));
      if (path.startsWith('/api/auth/')) return json(await authApi(env, req, path, body || {}), 200, cors(env, req));
      if (path.startsWith('/api/')) return json(await api(env, req, path, body || {}), 200, cors(env, req));
      return json({ error: 'not found' }, 404, cors(env, req));
    } catch (e) {
      if (!e.status) console.error('worker error', e && e.stack || e);
      return json({ error: e.status ? e.message : 'server error', ...(e.code?{code:e.code}:{}) }, e.status || 500, cors(env, req));
    }
  }
};
