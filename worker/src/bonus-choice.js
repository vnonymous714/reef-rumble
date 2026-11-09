/* Server-side Temple Relic bonus choice + XP helpers (pure ESM for Worker bundle). */
export const MAX_AWARD = 40000;
export const BONUS_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const BOOST_WINDOW_MS = 72 * 60 * 60 * 1000;
export const TAP_SECONDS = 20;
export const TAP_MAX_PER_SEC = 12;
export const TAP_MAX_TOTAL = TAP_SECONDS * TAP_MAX_PER_SEC;
export const WPN_XP_OLD = Object.freeze([0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400]);
export const WPN_XP = Object.freeze([0, 44, 105, 210, 350, 560, 840, 1225, 1750, 2450]);
export const BOSS_XP = Object.freeze({ kraken: 90, dragon: 140 });
export const CHEST_MULTS = Object.freeze([2, 5, 10]);
export const CHOICE_WHEEL = Object.freeze([
  [1, 28], [1.5, 22], [2, 18], [2.5, 12], [3, 9], [4, 5], [5, 3], [8, 2], [10, 1]
].map(Object.freeze));
export const RELIC_WEIGHT_NORMAL = 0.55;
export const RELIC_WEIGHT_BOOST = 4.5;

export function clampAward(cents) {
  if (!Number.isFinite(cents) || cents < 0) return 0;
  return Math.min(MAX_AWARD, Math.floor(cents));
}
export function levelFromXp(xp) {
  let lv = 1;
  const x = Math.max(0, Math.floor(xp || 0));
  for (let i = 1; i < WPN_XP.length; i++) {
    if (x >= WPN_XP[i]) lv = i + 1;
    else break;
  }
  return Math.min(10, lv);
}
function levelFromXpOld(xp) {
  let lv = 1;
  const x = Math.max(0, Math.floor(xp || 0));
  for (let i = 1; i < WPN_XP_OLD.length; i++) {
    if (x >= WPN_XP_OLD[i]) lv = i + 1;
    else break;
  }
  return Math.min(10, lv);
}
export function migrateXpToHarderCurve(oldXp) {
  const x = Math.max(0, Math.floor(oldXp || 0));
  const lv = levelFromXpOld(x);
  if (lv >= 10) return WPN_XP[9];
  const i = lv - 1;
  const oldLo = WPN_XP_OLD[i], oldHi = WPN_XP_OLD[i + 1] || oldLo + 1;
  const t = oldHi > oldLo ? Math.min(1, Math.max(0, (x - oldLo) / (oldHi - oldLo))) : 0;
  return Math.floor(WPN_XP[i] + t * (WPN_XP[i + 1] - WPN_XP[i]));
}
export function xpFromSettlement({ wagerCents = 0, winCents = 0, bossIds = [] } = {}) {
  const wagerXp = Math.max(0, Math.floor((wagerCents || 0) / 100));
  const winXp = Math.max(0, Math.floor((winCents || 0) / 100));
  let bossXp = 0;
  for (const id of bossIds || []) bossXp += BOSS_XP[id] || 0;
  return { wagerXp, winXp, bossXp, total: wagerXp + winXp + bossXp };
}
export function onCooldown(lastPickAt, now) {
  if (!lastPickAt || !Number.isFinite(lastPickAt) || lastPickAt <= 0) return false;
  return now - lastPickAt < BONUS_COOLDOWN_MS;
}
export function cooldownRemainingMs(lastPickAt, now) {
  if (!onCooldown(lastPickAt, now)) return 0;
  return Math.max(0, BONUS_COOLDOWN_MS - (now - lastPickAt));
}
export function shuffleMults(rng) {
  const arr = CHEST_MULTS.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
export function chestPayout(lockedStake, pickIndex, layout) {
  if (!Number.isSafeInteger(lockedStake) || lockedStake < 10) throw new Error('invalid stake');
  if (![0, 1, 2].includes(pickIndex)) throw new Error('invalid chest');
  if (!Array.isArray(layout) || layout.length !== 3) throw new Error('invalid layout');
  const mult = layout[pickIndex];
  if (![2, 5, 10].includes(mult)) throw new Error('invalid mult');
  return { mult, pay: clampAward(lockedStake * mult), layout };
}
export function choiceWheelPick(rng) {
  const total = CHOICE_WHEEL.reduce((s, [, w]) => s + w, 0);
  let r = Math.floor(rng() * total);
  for (const [mult, w] of CHOICE_WHEEL) {
    if (r < w) return mult;
    r -= w;
  }
  return CHOICE_WHEEL[0][0];
}
export function choiceWheelPayout(lockedStake, mult) {
  if (!Number.isSafeInteger(lockedStake) || lockedStake < 10) throw new Error('invalid stake');
  if (!(mult > 0)) throw new Error('invalid mult');
  return { mult, pay: clampAward(Math.round(lockedStake * mult)) };
}
export function sanitizeTaps(taps, startedAt, now = startedAt + TAP_SECONDS * 1000) {
  const start = startedAt, end = start + TAP_SECONDS * 1000;
  if (!Array.isArray(taps)) return [];
  const cleaned = [];
  let last = start - 1;
  const minGap = Math.floor(1000 / TAP_MAX_PER_SEC);
  for (const raw of taps) {
    const t = Math.floor(raw);
    if (!Number.isFinite(t) || t < start || t > end || t > now) continue;
    if (t < last + minGap) continue;
    cleaned.push(t);
    last = t;
    if (cleaned.length >= TAP_MAX_TOTAL) break;
  }
  return cleaned;
}
export function tapMultiplier(validCount) {
  const n = Math.max(0, Math.min(TAP_MAX_TOTAL, validCount | 0));
  const rate = n / TAP_SECONDS;
  return Math.round((1 + Math.pow(rate / TAP_MAX_PER_SEC, 1.15) * 5) * 100) / 100;
}
export function tapPayout(lockedStake, validCount) {
  if (!Number.isSafeInteger(lockedStake) || lockedStake < 10) throw new Error('invalid stake');
  const mult = tapMultiplier(validCount);
  return { mult, taps: validCount, pay: clampAward(Math.round(lockedStake * mult)) };
}
export function choiceWheelEV() {
  const total = CHOICE_WHEEL.reduce((s, [, w]) => s + w, 0);
  return CHOICE_WHEEL.reduce((s, [m, w]) => s + (m * w) / total, 0);
}
export function ensureXpCurve(a) {
  const curve = a.xp_curve || 1;
  let xp = Number.isSafeInteger(a.w_xp) ? a.w_xp : 0;
  if (curve < 2) return { w_xp: migrateXpToHarderCurve(xp), xp_curve: 2, migrated: true };
  return { w_xp: xp, xp_curve: curve, migrated: false };
}
export function applySettlementXp(a, { wager = 0, paid = 0, bossIds = [] }) {
  const ensured = ensureXpCurve(a);
  const gain = xpFromSettlement({ wagerCents: wager, winCents: paid, bossIds });
  return { w_xp: Math.min(200000, ensured.w_xp + gain.total), xp_curve: 2, gain };
}
export function makeBonusOffer(fish, now) {
  const stake = fish.lock?.stake;
  if (!Number.isSafeInteger(stake) || stake < 10) return null;
  return {
    id: 'bonus_' + fish.id,
    kind: 'bonus_choice',
    source: fish.id,
    stake,
    expires: now + 120000,
    consumed: false,
    tapStartedAt: 0
  };
}
export function resolveChest(offer, pick, rng) {
  return chestPayout(offer.stake, pick, shuffleMults(rng));
}
export function resolveWheel(offer, rng) {
  return choiceWheelPayout(offer.stake, choiceWheelPick(rng));
}
export function resolveTap(offer, taps, now) {
  if (!offer.tapStartedAt) throw new Error('tap not started');
  return tapPayout(offer.stake, sanitizeTaps(taps, offer.tapStartedAt, now).length);
}
