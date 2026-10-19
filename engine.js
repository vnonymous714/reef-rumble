/* Reef Rumble math engine: pure functions, shared by the game and the RTP simulator. */
(function (root) {
  'use strict';
  /* Target published RTP ≈ RTP_FISH + JP_RATE (jackpot long-run ≈ contribution).
     Class season week-1 / normal: 95% → RTP_FISH 0.94 + JP 0.01.
     Low Tide periods: 84% → RTP_FISH 0.83 + JP 0.01. */
  var RTP_FISH = 0.94;
  var RTP_FISH_HIGH = 0.94;   // published 95% period
  var RTP_FISH_LOW = 0.83;    // published 84% Low Tide
  var JP_RATE = 0.01;         // share of every shot that feeds the jackpot meter
  var JP_SEED = 25000;        // meter restarts at 250.00 credits (cents)
  var JP_P = 1 / 40000;       // jackpot chance per shot at max bet (scales with bet)
  var BETS = [10, 20, 50, 100, 200, 300, 500, 1000]; // cents: 0.10 .. 10.00
  var MAXBET = BETS[BETS.length - 1];
  var BOMB_BASE = 15, CHAIN_BASE = 12, VICTIM_CAP = 300;
  var BOMB_RADIUS = 170, CHAIN_RADIUS = 260, CHAIN_MAX = 7;

  var FISH = [
    { id: 'minnow', name: 'Glimmer Minnow', m: 2, w: 26, len: 34, h: 14, shape: 'fish', c1: '#9ff7ff', c2: '#1aa6d9', spd: 120 },
    { id: 'guppy', name: 'Bubble Guppy', m: 3, w: 22, len: 38, h: 20, shape: 'fish', c1: '#fff08a', c2: '#ff9a1f', spd: 110, fan: 1 },
    { id: 'darter', name: 'Zebra Darter', m: 4, w: 18, len: 46, h: 20, shape: 'fish', c1: '#ffffff', c2: '#3a7bd5', pat: 'stripes', spd: 115 },
    { id: 'pebble', name: 'Pebble Puffer', m: 5, w: 15, len: 42, h: 34, shape: 'round', c1: '#e2ff9a', c2: '#4fae35', pat: 'dots', spd: 80 },
    { id: 'tang', name: 'Sapphire Tang', m: 6, w: 13, len: 52, h: 34, shape: 'fish', c1: '#6fd2ff', c2: '#1b3fd1', pat: 'band', spd: 95 },
    { id: 'lantern', name: 'Lantern Gulper', m: 8, w: 11, len: 56, h: 34, shape: 'lantern', c1: '#a68bff', c2: '#2e1872', spd: 85 },
    { id: 'jelly', name: 'Moon Jelly', m: 10, w: 10, len: 50, h: 58, shape: 'jelly', c1: '#ffd3f4', c2: '#ff5fc8', spd: 55 },
    { id: 'turtle', name: 'Jade Turtle', m: 15, w: 7, len: 80, h: 60, shape: 'turtle', c1: '#a8f285', c2: '#2f8a4a', spd: 65 },
    { id: 'ray', name: 'Velvet Ray', m: 20, w: 6, len: 96, h: 84, shape: 'ray', c1: '#9ab9ff', c2: '#2f4590', spd: 70 },
    { id: 'sword', name: 'Silver Swordfin', m: 30, w: 4.5, len: 124, h: 40, shape: 'sword', c1: '#eef7ff', c2: '#5d7fa8', spd: 110 },
    { id: 'shark', name: 'Reef Shark', m: 40, w: 3.5, len: 140, h: 58, shape: 'shark', c1: '#d3dee9', c2: '#55708c', spd: 85 },
    { id: 'koi', name: 'Golden Koi', m: 50, w: 3, len: 110, h: 56, shape: 'fish', c1: '#fff3b0', c2: '#ffb300', pat: 'scales', spd: 70, glow: '255,214,74' },
    { id: 'whale', name: 'Star Whale', m: 80, w: 1.6, len: 200, h: 96, shape: 'whale', c1: '#a8ecff', c2: '#2a6fb0', spd: 50, glow: '160,230,255' },
    { id: 'bomb', name: 'Boom Puffer', special: 'bomb', m: BOMB_BASE, w: 2.2, len: 58, h: 54, shape: 'bomb', spd: 70, glow: '255,90,60' },
    { id: 'eel', name: 'Storm Eel', special: 'chain', m: CHAIN_BASE, w: 2.2, len: 130, h: 24, shape: 'eel', spd: 90, glow: '255,240,90' },
    { id: 'chest', name: 'Treasure Crab', special: 'wheel', m: 0, w: 1.6, len: 84, h: 66, shape: 'chest', spd: 60, glow: '255,200,60' },
    { id: 'kraken', name: 'Kraken Rex', boss: true, m: [100, 200], w: 0, len: 230, h: 200, shape: 'kraken', spd: 40, glow: '200,90,255' },
    { id: 'dragon', name: 'Abyss Leviathan', boss: true, m: [200, 350], w: 0, len: 340, h: 96, shape: 'dragon', spd: 55, glow: '80,255,200' }
  ];
  var BY_ID = {};
  FISH.forEach(function (f) { BY_ID[f.id] = f; });

  var WHEEL = [
    { m: 10, w: 20 }, { m: 25, w: 14 }, { m: 15, w: 18 }, { m: 50, w: 8 }, { m: 20, w: 16 },
    { m: 100, w: 4 }, { m: 30, w: 10 }, { m: 250, w: 1.5 }, { m: 75, w: 6 }, { m: 150, w: 2.5 }
  ];
  var WT = 0, WEV = 0;
  WHEEL.forEach(function (s) { WT += s.w; WEV += s.m * s.w; });
  WEV /= WT;

  function chance(totalMult) { return totalMult > 0 ? Math.min(1, RTP_FISH / totalMult) : 0; }
  function rollMult(def, rng) {
    if (Array.isArray(def.m)) { var a = def.m[0] / 5, b = def.m[1] / 5; return 5 * (a + Math.floor(rng() * (b - a + 1))); }
    return def.m;
  }
  function wheelPick(rng) {
    var r = rng() * WT;
    for (var i = 0; i < WHEEL.length; i++) { r -= WHEEL[i].w; if (r < 0) return i; }
    return WHEEL.length - 1;
  }
  function victimSum(mults) { var s = 0; for (var i = 0; i < mults.length; i++) s += mults[i]; return Math.min(VICTIM_CAP, s); }
  // total multiplier a hit is "worth"; capture chance = RTP_FISH / total, so every hit returns RTP_FISH * bet on average
  function hitValue(def, fishMult, victimMults) {
    if (def.special === 'bomb') return BOMB_BASE + victimSum(victimMults || []);
    if (def.special === 'chain') return CHAIN_BASE + victimSum(victimMults || []);
    if (def.special === 'wheel') return WEV;
    return fishMult;
  }
  function jpTrigger(bet, rng) { return rng() < JP_P * bet / MAXBET; }
  function spawnTable() { return FISH.filter(function (f) { return f.w > 0; }); }

  function setRtpFish(v) {
    v = +v; if (!(v > 0 && v < 2)) return RTP_FISH;
    RTP_FISH = v; api.RTP_FISH = v; return RTP_FISH;
  }
  function setRtpPeriod(period) {
    /* period 95 → high, 84 → low tide; returns active RTP_FISH */
    return setRtpFish(period === 84 || period === '84' ? RTP_FISH_LOW : RTP_FISH_HIGH);
  }
  var api = {
    RTP_FISH: RTP_FISH, RTP_FISH_HIGH: RTP_FISH_HIGH, RTP_FISH_LOW: RTP_FISH_LOW,
    JP_RATE: JP_RATE, JP_SEED: JP_SEED, JP_P: JP_P, BETS: BETS, MAXBET: MAXBET,
    BOMB_RADIUS: BOMB_RADIUS, CHAIN_RADIUS: CHAIN_RADIUS, CHAIN_MAX: CHAIN_MAX,
    FISH: FISH, BY_ID: BY_ID, WHEEL: WHEEL, WHEEL_EV: WEV,
    chance: chance, rollMult: rollMult, wheelPick: wheelPick, hitValue: hitValue, jpTrigger: jpTrigger, spawnTable: spawnTable,
    setRtpFish: setRtpFish, setRtpPeriod: setRtpPeriod
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReefEngine = api;
})(this);
