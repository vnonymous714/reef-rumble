/* Reef Rumble Telegram worker. Telegram Stars (XTR) only. Play credits: no cash value, no cash-out, no withdrawals by players. */
import { verifyInitData, pidFor, PACKS, boundEvent, GRANTS, playDeltaOk, safeEq } from './tg.js';

const NOW = () => Date.now();
const TERMS = 'Reef Rumble terms (short):\n• Play credits are for entertainment only. They have NO cash value and can never be cashed out, withdrawn, transferred, or exchanged for money, crypto, or prizes.\n• Stars purchases buy play credits only. Telegram Stars rules apply: telegram.org/tos/stars\n• This is a student project for friends. Must be 18+.\n• Problems with a purchase: /paysupport';
const SUPPORT = 'Support: describe the problem in this chat and the developer will reply. For payment issues use /paysupport.';
const PAYSUPPORT = 'Payment support: reply here with the date and pack you bought. Credits are delivered automatically after Telegram confirms payment. If credits did not arrive or you were charged by mistake, we can refund the Stars.';

function cors(env, req) {
  const o = req.headers.get('Origin');
  const allow = o && (o === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) ? o : env.ALLOWED_ORIGIN;
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, apikey, Prefer', 'Vary': 'Origin' };
}
const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...h } });

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
  if (Math.random() < 0.02) { const d = NOW() - 86400000; await env.DB.prepare("DELETE FROM rl WHERE (k LIKE 'af:%' AND win < ?1) OR (k NOT LIKE 'af:%' AND win < ?2)").bind(Math.floor(d / 900000), Math.floor(d / 60000)).run(); } // prune counters older than a day
  return r.c <= limit;
}

async function player(env, user) {
  const pid = await pidFor(user.id), t = NOW();
  await env.DB.prepare('INSERT INTO players (tg_id, pid, created_at, last_seen) VALUES (?1, ?2, ?3, ?3) ON CONFLICT(tg_id) DO UPDATE SET last_seen = ?3').bind(user.id, pid, t).run();
  return env.DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(user.id).first();
}
const view = p => ({ pid: p.pid, balance: p.balance, bonus: p.bonus, pt: p.pt, pt_need: p.bonus * 10, season: p.season, seq: p.sync_seq });

async function auth(env, body) {
  const u = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!u) throw Object.assign(new Error('bad initData'), { status: 401 });
  return u;
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

/* Idempotent on telegram_payment_charge_id: the row is inserted once; credit happens only while credited = 0, all in one D1 batch (transaction). */
export async function creditPayment(env, fromId, sp) {
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
    DB.prepare(`UPDATE players SET balance = MIN(balance + ?3, 99999999999), bonus = bonus + ?4 WHERE tg_id = ?2 AND ${pend}`).bind(charge, fromId, amt, valid ? pk.bonus : 0),
    DB.prepare(`INSERT INTO events (player_id, type, credit, n, meta, created_at) SELECT pid, 'stars_purchase', ?3, ?4, 'pack ' || ?5, ?6 FROM players WHERE tg_id = ?2 AND ${pend}`).bind(charge, fromId, amt, sp.total_amount | 0, pk ? +m[1] : -1, t),
    DB.prepare('UPDATE payments SET credited = 1 WHERE charge_id = ?1 AND credited = 0').bind(charge)
  ]);
  return { credited: res[4].meta.changes === 1, valid };
}

/* ---------- Mini App API ---------- */
async function api(env, path, body) {
  const u = await auth(env, body);
  if (!(await rate(env, 'u:' + u.id, 120, 60000))) throw Object.assign(new Error('slow down'), { status: 429 });
  let p = await player(env, u);
  const DB = env.DB, t = NOW();
  if (path === '/api/me') return { ...view(p), packs: PACKS };
  if (path === '/api/invoice') {
    const i = body.pack | 0, pk = PACKS[i];
    if (!pk || body.pack !== i) throw Object.assign(new Error('bad pack'), { status: 400 });
    const nonce = [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');
    const link = await tg(env, 'createInvoiceLink', {
      title: 'Reef Rumble play credits', currency: 'XTR', provider_token: '',
      description: `${(pk.c / 100).toLocaleString('en-US')} play credits${pk.bonus ? ' + ' + (pk.bonus / 100).toLocaleString('en-US') + ' bonus' : ''}. No cash value, no cash-out.`,
      payload: `rr1:${i}:${u.id}:${nonce}`, prices: [{ label: 'Play credits', amount: pk.stars }]
    });
    return { link };
  }
  if (path === '/api/sync') {
    /* client reports net play result since its last sync: d = credits change from play, w = amount wagered. Grants are separate. */
    const seq = body.seq | 0, d = body.d, w = body.w;
    if (seq !== p.sync_seq + 1) return { ...view(p), stale: true };
    if (!playDeltaOk(d, w)) throw Object.assign(new Error('bad delta'), { status: 400 });
    const need = p.bonus * 10;
    await DB.batch([
      DB.prepare('UPDATE players SET balance = MAX(0, MIN(balance + ?2, 99999999999)), pt = MIN(?3, pt + ?4), sync_seq = sync_seq + 1 WHERE tg_id = ?1 AND sync_seq = ?5').bind(u.id, d, need, w, p.sync_seq),
      DB.prepare("INSERT INTO ledger (tg_id, kind, amount, ref, created_at) VALUES (?1, 'play', ?2, ?3, ?4)").bind(u.id, d, 'w=' + w, t)
    ]);
  } else if (path === '/api/grant') {
    const kind = body.kind, amt = GRANTS[kind];
    if (!amt) throw Object.assign(new Error('grant not allowed'), { status: 400 });
    const day = new Date(t).toISOString().slice(0, 10), season = String(body.season || '').slice(0, 24);
    let sql = null, args = [];
    if (kind === 'deposit_credit') { if (p.season !== season) { sql = 'UPDATE players SET balance = ?2, bonus = 10000, pt = 0, season = ?3, season_at = ?4 WHERE tg_id = ?1 AND (season IS NULL OR season_at < ?4 - 604800000)'; args = [u.id, 20000, season, t]; } }
    else if (kind === 'refill') { sql = 'UPDATE players SET balance = balance + ?2, last_refill = ?3 WHERE tg_id = ?1 AND last_refill < ?3 - 60000'; args = [u.id, amt, t]; }
    else if (kind === 'daily_bonus') { const a = Math.max(0, Math.min(amt, body.amt | 0)); sql = 'UPDATE players SET balance = balance + ?2, last_daily = ?3 WHERE tg_id = ?1 AND (last_daily IS NULL OR last_daily <> ?3)'; args = [u.id, a, day]; }
    /* bonus_credit is folded into deposit_credit (season start = 100 deposit + 100 bonus) */
    if (sql) { const r = await DB.prepare(sql).bind(...args).run(); if (r.meta.changes) await DB.prepare('INSERT INTO ledger (tg_id, kind, amount, created_at) VALUES (?1, ?2, ?3, ?4)').bind(u.id, kind, args[1], t).run(); }
  } else throw Object.assign(new Error('not found'), { status: 404 });
  p = await DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(u.id).first();
  return view(p);
}

/* ---------- events (replaces Supabase /events insert) ---------- */
async function events(env, req, body) {
  const rows = Array.isArray(body) ? body.slice(0, 60).map(boundEvent).filter(Boolean) : [];
  if (!rows.length) return json({ inserted: 0 }, 400, cors(env, req));
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  if (!(await rate(env, 'ev:' + rows[0].player_id, 40, 60000)) || !(await rate(env, 'evip:' + ip, 120, 60000))) return json({ error: 'rate' }, 429, cors(env, req));
  const t = NOW(), st = env.DB.prepare('INSERT INTO events (player_id, type, mode, rtp_period, bet, win, credit, balance_after, n, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  await env.DB.batch(rows.map(e => st.bind(e.player_id, e.type, e.mode, e.rtp_period, e.bet, e.win, e.credit, e.balance_after, e.n, e.meta, t)));
  return new Response(null, { status: 201, headers: cors(env, req) });
}

/* ---------- read RPCs used by telemetry.js / backoffice.html (same JSON shapes as the Supabase functions) ---------- */
const label = pid => 'Player-' + String(pid).slice(0, 4).toUpperCase();
const WIN_T = "('shots','catch','wheel','jackpot','boss_catch','bomb','chain','slot_spin')";
async function rpcFn(env, req, fn, a) {
  const DB = env.DB, t = NOW(), day = t - 86400000;
  const all = (s, ...b) => DB.prepare(s).bind(...b).all().then(r => r.results);
  if (fn === 'rr_live') return DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN created_at > ?1 THEN player_id END) players_now, COUNT(DISTINCT player_id) players_today,
      COALESCE(SUM(CASE WHEN mode='normal' THEN bet END),0) wagered_today, COALESCE(SUM(CASE WHEN mode='normal' AND type IN ${WIN_T} THEN win END),0) won_today,
      COUNT(DISTINCT CASE WHEN mode='underground' THEN player_id END) underground_today FROM events WHERE created_at > ?2`).bind(t - 120000, day).first();
  if (fn === 'rr_feed') return (await all('SELECT id, player_id, type, bet, win, credit, n, meta, created_at FROM events WHERE id > ?1 ORDER BY id DESC LIMIT 50', +a.after_id || 0))
    .map(e => ({ ...e, player: label(e.player_id), player_id: undefined, created_at: new Date(e.created_at).toISOString() })).reverse();
  if (fn === 'rr_series') return (await all(`SELECT (created_at/60000)*60000 m, SUM(bet) wagered, SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END) won FROM events WHERE created_at > ?1 AND mode='normal' GROUP BY m ORDER BY m`, t - 3600000))
    .map(r => ({ minute: new Date(r.m).toISOString(), wagered: r.wagered, won: r.won }));
  if (fn === 'rr_top') return (await all(`SELECT player_id, type, meta, win, created_at FROM events WHERE created_at > ?1 AND win > 0 AND type <> 'shots' ORDER BY win DESC LIMIT 10`, day))
    .map(r => ({ player: label(r.player_id), type: r.type, meta: r.meta, win: r.win, created_at: new Date(r.created_at).toISOString() }));
  if (fn === 'rr_leaders') return (await all(`SELECT player_id, SUM(bet) wagered, SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END) won FROM events WHERE created_at > ?1 GROUP BY player_id ORDER BY wagered DESC LIMIT 10`, day))
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
      FROM events WHERE mode='normal'`).first();
    const pl = await DB.prepare(`SELECT SUM(CASE WHEN w > s THEN 1 ELSE 0 END) ahead, SUM(CASE WHEN w <= s THEN 1 ELSE 0 END) behind FROM (SELECT player_id, SUM(bet) s, SUM(CASE WHEN type IN ${WIN_T} THEN win ELSE 0 END) w FROM events WHERE mode='normal' GROUP BY player_id HAVING s > 0)`).first();
    return { ...h, ahead: pl.ahead || 0, behind: pl.behind || 0, start_bal: 20000 * (h.players || 0), cashout_eligible: h.playthrough_done, broke: null, broke_before_pt: null, top10_take: null, top10_n: null, excluded_test_players: 0,
      players_today: (await DB.prepare('SELECT COUNT(DISTINCT player_id) c FROM events WHERE created_at > ?').bind(day).first()).c, players_now: (await DB.prepare('SELECT COUNT(DISTINCT player_id) c FROM events WHERE created_at > ?').bind(t - 120000).first()).c };
  }
  if (fn === 'rr_pending') { if (!/^[0-9a-f]{16}$/.test(a.pid || '')) return []; return all('SELECT id, action, amount FROM admin_cmds WHERE player_id = ?1 AND applied_at IS NULL ORDER BY id LIMIT 20', a.pid); }
  if (fn === 'rr_ack') { await DB.prepare('UPDATE admin_cmds SET applied_at = ?3 WHERE id = ?2 AND player_id = ?1 AND applied_at IS NULL').bind(String(a.pid), +a.cmd_id || 0, t).run(); return true; }
  if (fn === 'rr_admin') return admin(env, req, a);
  throw Object.assign(new Error('not found'), { status: 404 });
}

/* Admin: passcode is the ADMIN_PASS Worker secret. Lockout after 5 bad tries per IP per 15 min. */
async function admin(env, req, a) {
  const ip = req.headers.get('CF-Connecting-IP') || 'x', DB = env.DB, t = NOW();
  const fails = await DB.prepare('SELECT c, win FROM rl WHERE k = ?').bind('af:' + ip).first();
  const w = Math.floor(t / 900000);
  if (fails && fails.win === w && fails.c >= 5) return { error: 'locked, try later' };
  if (!env.ADMIN_PASS || !safeEq(String(a.pass || ''), env.ADMIN_PASS)) { await rate(env, 'af:' + ip, 5, 900000); return { error: 'denied' }; }
  const op = a.op, pid = a.pid == null ? null : String(a.pid), amt = a.amt == null ? null : Math.round(+a.amt);
  if (op === 'ping') return { ok: true };
  if (op === 'players') {
    const web = (await DB.prepare("SELECT player_id, MAX(created_at) last_seen, (SELECT balance_after FROM events e2 WHERE e2.player_id = e.player_id AND balance_after IS NOT NULL ORDER BY id DESC LIMIT 1) balance FROM events e WHERE created_at > ? AND player_id NOT LIKE 't%' GROUP BY player_id ORDER BY last_seen DESC LIMIT 100").bind(t - 7 * 86400000).all()).results;
    const tgp = (await DB.prepare('SELECT pid player_id, last_seen, balance FROM players ORDER BY last_seen DESC LIMIT 100').all()).results;
    return [...tgp, ...web].sort((x, y) => y.last_seen - x.last_seen).map(r => ({ ...r, player: label(r.player_id) + (r.player_id[0] === 't' ? ' (TG)' : ''), last_seen: new Date(r.last_seen).toISOString() }));
  }
  if (op === 'audit') return (await DB.prepare("SELECT id, player_id, action, amount, created_at, applied_at FROM admin_cmds ORDER BY id DESC LIMIT 30").all()).results
    .map(r => ({ ...r, player: label(r.player_id), created_at: new Date(r.created_at).toISOString(), applied_at: r.applied_at && new Date(r.applied_at).toISOString() }));
  if (!['reset', 'add', 'set'].includes(op) || !pid) return { error: 'bad op' };
  if (op !== 'reset' && (!Number.isSafeInteger(amt) || Math.abs(amt) > 1e10)) return { error: 'bad amount' };
  if (/^t[0-9a-f]{15}$/.test(pid)) {
    const sql = op === 'reset' ? 'UPDATE players SET balance = 20000 WHERE pid = ?1' : op === 'set' ? 'UPDATE players SET balance = MAX(0, ?2) WHERE pid = ?1' : 'UPDATE players SET balance = MAX(0, balance + ?2) WHERE pid = ?1';
    const r = await DB.prepare(sql).bind(pid, amt).run();
    if (!r.meta.changes) return { error: 'no such player' };
    await DB.batch([DB.prepare('INSERT INTO admin_cmds (player_id, action, amount, created_at, applied_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(pid, op, amt, t),
      DB.prepare("INSERT INTO ledger (tg_id, kind, amount, ref, created_at) SELECT tg_id, 'admin_' || ?2, COALESCE(?3, 0), 'admin', ?4 FROM players WHERE pid = ?1").bind(pid, op, amt, t)]);
    return { ok: true };
  }
  if (!/^[0-9a-f]{16}$/.test(pid)) return { error: 'bad player' };
  await DB.prepare('INSERT INTO admin_cmds (player_id, action, amount, created_at) VALUES (?1, ?2, ?3, ?4)').bind(pid, op, amt, t).run();
  return { ok: true };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) });
    if (req.method !== 'POST') return new Response('Reef Rumble API: play credits only, no cash value.', { status: 200 });
    try {
      if (path === '/tg/webhook') return await webhook(env, req);
      const body = await req.json().catch(() => null);
      if (path === '/events') return await events(env, req, body);
      if (path.startsWith('/rpc/')) return json(await rpcFn(env, req, path.slice(5), body || {}), 200, cors(env, req));
      if (path.startsWith('/api/')) return json(await api(env, path, body || {}), 200, cors(env, req));
      return json({ error: 'not found' }, 404, cors(env, req));
    } catch (e) {
      if (!e.status) console.error('worker error', e && e.stack || e);
      return json({ error: e.status ? e.message : 'server error' }, e.status || 500, cors(env, req));
    }
  }
};
