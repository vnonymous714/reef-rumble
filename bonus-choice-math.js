/* Pure bonus-choice + weapon XP math. Shared by Worker and client. No I/O. */
(function (root) {
  'use strict';

  const MAX_AWARD = 40000; // 400.00 credits
  const BONUS_COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const BOOST_WINDOW_MS = 72 * 60 * 60 * 1000;
  const TAP_SECONDS = 20;
  const TAP_MAX_PER_SEC = 12;
  const TAP_MAX_TOTAL = TAP_SECONDS * TAP_MAX_PER_SEC; // 240

  // Old client curve (kept for migration / reporting)
  const WPN_XP_OLD = Object.freeze([0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400]);
  // ~1.75× harder thresholds to REACH each level (index = level-1)
  const WPN_XP = Object.freeze([0, 44, 105, 210, 350, 560, 840, 1225, 1750, 2450]);

  const BOSS_XP = Object.freeze({ kraken: 90, dragon: 140 });

  // Chest: shuffle 2x/5x/10x onto three lids. Fair pick → E[mult]=17/3≈5.667
  const CHEST_MULTS = Object.freeze([2, 5, 10]);

  // Choice-wheel sectors: stake multipliers (weighted). EV ≈ 2.05× stake (house-safe at 12h cadence)
  const CHOICE_WHEEL = Object.freeze([
    [1, 28], [1.5, 22], [2, 18], [2.5, 12], [3, 9], [4, 5], [5, 3], [8, 2], [10, 1]
  ].map(Object.freeze));

  function clampAward(cents) {
    if (!Number.isFinite(cents) || cents < 0) return 0;
    return Math.min(MAX_AWARD, Math.floor(cents));
  }

  function levelFromXp(xp) {
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

  /** Preserve level across curve bump: map old XP → new XP at same level progress. */
  function migrateXpToHarderCurve(oldXp) {
    const x = Math.max(0, Math.floor(oldXp || 0));
    const lv = levelFromXpOld(x);
    if (lv >= 10) return WPN_XP[9];
    const i = lv - 1;
    const oldLo = WPN_XP_OLD[i], oldHi = WPN_XP_OLD[i + 1] || oldLo + 1;
    const t = oldHi > oldLo ? Math.min(1, Math.max(0, (x - oldLo) / (oldHi - oldLo))) : 0;
    const newLo = WPN_XP[i], newHi = WPN_XP[i + 1];
    return Math.floor(newLo + t * (newHi - newLo));
  }

  /**
   * Server XP grant. Credits are in cents.
   * wagerXp: 1 XP per 100¢ wagered (1.00 played)
   * winXp:   1 XP per 100¢ won
   * bossXp:  fixed chunk for boss fish ids
   */
  function xpFromSettlement({ wagerCents = 0, winCents = 0, bossIds = [] } = {}) {
    const wagerXp = Math.max(0, Math.floor((wagerCents || 0) / 100));
    const winXp = Math.max(0, Math.floor((winCents || 0) / 100));
    let bossXp = 0;
    for (const id of bossIds || []) bossXp += BOSS_XP[id] || 0;
    return { wagerXp, winXp, bossXp, total: wagerXp + winXp + bossXp };
  }

  function onCooldown(lastPickAt, now) {
    if (!lastPickAt || !Number.isFinite(lastPickAt) || lastPickAt <= 0) return false;
    return now - lastPickAt < BONUS_COOLDOWN_MS;
  }

  function cooldownRemainingMs(lastPickAt, now) {
    if (!onCooldown(lastPickAt, now)) return 0;
    return Math.max(0, BONUS_COOLDOWN_MS - (now - lastPickAt));
  }

  function boostActive(boostUntil, now) {
    return Number.isFinite(boostUntil) && boostUntil > now;
  }

  /** Semi-rare base weight among specials; boost multiplies spawn chance. */
  const RELIC_WEIGHT_NORMAL = 0.55;
  const RELIC_WEIGHT_BOOST = 4.5;

  function relicSpawnWeight(boostUntil, now) {
    return boostActive(boostUntil, now) ? RELIC_WEIGHT_BOOST : RELIC_WEIGHT_NORMAL;
  }

  function shuffleMults(rng) {
    const arr = CHEST_MULTS.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function chestPayout(lockedStake, pickIndex, layout) {
    if (!Number.isSafeInteger(lockedStake) || lockedStake < 10) throw new Error('invalid stake');
    if (![0, 1, 2].includes(pickIndex)) throw new Error('invalid chest');
    if (!Array.isArray(layout) || layout.length !== 3) throw new Error('invalid layout');
    const mult = layout[pickIndex];
    if (![2, 5, 10].includes(mult)) throw new Error('invalid mult');
    return { mult, pay: clampAward(lockedStake * mult), layout };
  }

  function choiceWheelPick(rng) {
    const total = CHOICE_WHEEL.reduce((s, [, w]) => s + w, 0);
    let r = Math.floor(rng() * total);
    for (const [mult, w] of CHOICE_WHEEL) {
      if (r < w) return mult;
      r -= w;
    }
    return CHOICE_WHEEL[0][0];
  }

  function choiceWheelPayout(lockedStake, mult) {
    if (!Number.isSafeInteger(lockedStake) || lockedStake < 10) throw new Error('invalid stake');
    if (!(mult > 0)) throw new Error('invalid mult');
    return { mult, pay: clampAward(Math.round(lockedStake * mult)) };
  }

  /**
   * Tap frenzy: client sends timestamps (ms). Server clamps to human max.
   * Rate (valid taps / 20s) → multiplier 1.0 .. 6.0, pay = stake * mult.
   */
  function sanitizeTaps(taps, startedAt, now = startedAt + TAP_SECONDS * 1000) {
    const start = startedAt;
    const end = start + TAP_SECONDS * 1000;
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

  function tapMultiplier(validCount) {
    const n = Math.max(0, Math.min(TAP_MAX_TOTAL, validCount | 0));
    const rate = n / TAP_SECONDS; // 0..12
    // smooth curve: 1.0 at 0, ~2.2 at 4/s, ~3.8 at 8/s, 6.0 at 12/s
    const mult = 1 + Math.pow(rate / TAP_MAX_PER_SEC, 1.15) * 5;
    return Math.round(mult * 100) / 100;
  }

  function tapPayout(lockedStake, validCount) {
    if (!Number.isSafeInteger(lockedStake) || lockedStake < 10) throw new Error('invalid stake');
    const mult = tapMultiplier(validCount);
    return { mult, taps: validCount, pay: clampAward(Math.round(lockedStake * mult)) };
  }

  function choiceWheelEV() {
    const total = CHOICE_WHEEL.reduce((s, [, w]) => s + w, 0);
    return CHOICE_WHEEL.reduce((s, [m, w]) => s + (m * w) / total, 0);
  }

  const api = {
    MAX_AWARD,
    BONUS_COOLDOWN_MS,
    BOOST_WINDOW_MS,
    TAP_SECONDS,
    TAP_MAX_PER_SEC,
    TAP_MAX_TOTAL,
    WPN_XP,
    WPN_XP_OLD,
    BOSS_XP,
    CHEST_MULTS,
    CHOICE_WHEEL,
    RELIC_WEIGHT_NORMAL,
    RELIC_WEIGHT_BOOST,
    clampAward,
    levelFromXp,
    levelFromXpOld,
    migrateXpToHarderCurve,
    xpFromSettlement,
    onCooldown,
    cooldownRemainingMs,
    boostActive,
    relicSpawnWeight,
    shuffleMults,
    chestPayout,
    choiceWheelPick,
    choiceWheelPayout,
    sanitizeTaps,
    tapMultiplier,
    tapPayout,
    choiceWheelEV
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReefBonusChoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
