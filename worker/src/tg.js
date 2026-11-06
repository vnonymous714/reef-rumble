/* Pure helpers (unit-tested in Node). */
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
export function safeEq(a, b) {
  a = String(a); b = String(b); let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
/* https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
   secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = hex(HMAC_SHA256(secret_key, data_check_string)) */
export async function verifyInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
  if (typeof initData !== 'string' || initData.length > 4096 || !botToken) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs = [];
  for (const [k, v] of p) if (k !== 'hash') pairs.push(k + '=' + v);
  pairs.sort();
  const secret = await hmac('WebAppData', botToken);
  const calc = hex(await hmac(secret, pairs.join('\n')));
  if (!safeEq(calc, hash)) return null;
  const auth = +p.get('auth_date');
  if (!Number.isFinite(auth) || now / 1000 - auth > maxAgeSec || auth - now / 1000 > 300) return null;
  let user; try { user = JSON.parse(p.get('user') || 'null'); } catch (e) { return null; }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return { id: user.id, auth_date: auth };       // names deliberately dropped
}
/* test helper: build a valid initData string for a fake token */
export async function signInitData(fields, botToken) {
  const pairs = Object.entries(fields).map(([k, v]) => k + '=' + v).sort();
  const secret = await hmac('WebAppData', botToken);
  const p = new URLSearchParams(fields); p.set('hash', hex(await hmac(secret, pairs.join('\n'))));
  return p.toString();
}
export async function pidFor(tgId) { return 't' + hex(await crypto.subtle.digest('SHA-256', enc.encode('rr-tg:' + tgId))).slice(0, 15); }
/* Stars packs. credits in credit-cents. Play credits only: no cash value, no cash-out. */
export const PACKS = [
  { stars: 50, c: 100000, bonus: 0 },
  { stars: 100, c: 250000, bonus: 0 },
  { stars: 200, c: 750000, bonus: 750000 },
  { stars: 500, c: 2000000, bonus: 0 }
];
export const EVENT_TYPES = ['shots', 'catch', 'wheel', 'jackpot', 'boss_catch', 'bomb', 'chain', 'slot_spin', 'session_start', 'session_end', 'admin_adjust',
  'playthrough_progress', 'playthrough_complete', 'refill', 'purchase', 'deposit_credit', 'bonus_credit', 'rebuy', 'rebuy_bonus', 'daily_bonus', 'cashout_request', 'stars_purchase'];
const cl = (v, lo, hi) => { v = Math.round(+v || 0); return v < lo ? lo : v > hi ? hi : v; };
/* Same bounds the client applies (telemetry.js push()). Returns null if the row is rejected. */
export function boundEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const pid = String(e.player_id || '');
  if (!/^(?:[0-9a-f]{16}|t[0-9a-f]{15})$/.test(pid)) return null;
  if (!EVENT_TYPES.includes(e.type)) return null;
  return { player_id: pid, type: e.type, mode: e.mode === 'underground' ? 'underground' : 'normal', rtp_period: (e.rtp_period === 88 || e.rtp_period === 84) ? (+e.rtp_period === 84 ? 84 : 88) : (e.rtp_period === 95 ? 95 : 92),
    bet: cl(e.bet, 0, 1e6), win: cl(e.win, 0, 1e10), credit: cl(e.credit, -1e11, 1e11),
    balance_after: e.balance_after == null ? null : cl(e.balance_after, 0, 1e11), n: cl(e.n, 0, 2000), meta: e.meta == null ? null : String(e.meta).slice(0, 24) };
}
/* Free grants the server accepts in Telegram mode (cooldowns enforced in index.js). */
export const GRANTS = { deposit_credit: 10000, bonus_credit: 10000, refill: 10000, daily_bonus: 16000 };
export const MAX_MULT = 1000, MAX_SYNC_EXTRA = 2000000; // play delta bound: -wagered <= d <= wagered*MAX_MULT + jackpot room
export function playDeltaOk(d, w) {
  return Number.isSafeInteger(d) && Number.isSafeInteger(w) && w >= 0 && w <= 5e7 && d >= -w && d <= w * MAX_MULT + (w > 0 ? MAX_SYNC_EXTRA : 0);
}
