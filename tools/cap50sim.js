// Verify 50-player / 2k bankroll with live MAX_WIN/JP_CAP. Bust = bal < min bet.
const E = require('../engine.js');
const PLAYERS = 50, START = 10000, DOUBLE = 20000, MAX_SHOTS = 2000, FIRE_MS = 165;
const BET = E.BETS[3], MINBET = E.BETS[0], REPS = +(process.argv[2] || 5000);
const WPN_XP = [0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400];
const MAX_WIN = E.MAX_WIN, JP_CAP = E.JP_CAP, JP_SEED = E.JP_SEED;
let s = 1;
const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
const seed = (x) => { s = (x >>> 0) || 1; };
const table = E.spawnTable().concat([Object.assign({}, E.BY_ID.kraken, { w: 0.6 }), Object.assign({}, E.BY_ID.dragon, { w: 0.4 })]);
const regular = E.FISH.filter(f => !f.special && !f.boss && f.w > 0);
const TW = table.reduce((a, f) => a + f.w, 0), RW = regular.reduce((a, f) => a + f.w, 0);
const pick = (arr, tw) => { let r = rng() * tw; for (const f of arr) { r -= f.w; if (r < 0) return f; } return arr[arr.length - 1]; };
const pickR = () => pick(regular, RW).m;
function wpnDmg(xp) { let lv = 1; for (let i = 1; i < WPN_XP.length; i++) { if (xp >= WPN_XP[i]) lv = i + 1; else break; } return lv >= 5 ? 2 : 1 + (lv - 1) * 0.25; }
function pct(a, p) { const i = (a.length - 1) * p, lo = i | 0, hi = Math.ceil(i); return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo); }
function fmt(c) { return (c / 100).toFixed(2); }

function play(mode) {
  let bal = START, xp = 0, shots = 0, biggest = 0, tMs = (rng() * 30 * 60000) | 0, jp = JP_SEED, wager = 0, paid = 0;
  while (bal >= MINBET && shots < MAX_SHOTS) {
    if (mode === 'double' && bal >= DOUBLE) break;
    const mins = (tMs / 60000) | 0; E.setRtpPeriod((mins % 30) < 5 ? 88 : 92);
    const dmg = wpnDmg(xp), cost = Math.max(1, Math.round(BET * dmg));
    if (bal < cost) break;
    bal -= cost; wager += cost; jp = E.clampJp(jp + cost * E.JP_RATE); shots++; tMs += FIRE_MS;
    if (E.jpTrigger(cost, rng)) { const w = E.clampWin(Math.floor(jp)); jp = JP_SEED; bal += w; paid += w; if (w > biggest) biggest = w; }
    const f = pick(table, TW), mult = E.rollMult(f, rng); let victims = [];
    if (f.special === 'bomb') { const n = (rng() * 7) | 0; for (let k = 0; k < n; k++) victims.push(pickR()); }
    if (f.special === 'chain') { const n = 2 + ((rng() * 6) | 0); for (let k = 0; k < n; k++) victims.push(pickR()); }
    const total = E.hitValue(f, mult, victims);
    if (rng() < Math.min(1, E.chance(total / dmg))) {
      let win = f.special === 'wheel' ? E.WHEEL[E.wheelPick(rng)].m * BET : Math.round(total * BET);
      win = E.clampWin(win); bal += win; paid += win; if (win > biggest) biggest = win;
      xp = Math.min(20000, xp + Math.max(1, Math.round(Math.sqrt(Math.max(1, mult || total)) * 1.4)));
    }
  }
  return { end: bal, biggest, wager, paid, bust: bal < MINBET, ahead: bal > START };
}

function cohort(mode) {
  let house = 0, minH = 0, sumEnd = 0, maxWin = 0, maxEnd = 0, wager = 0, paid = 0, ahead = 0, bust = 0;
  for (let i = 0; i < PLAYERS; i++) {
    house += START; if (house < minH) minH = house;
    const r = play(mode);
    sumEnd += r.end; wager += r.wager; paid += r.paid;
    if (r.biggest > maxWin) maxWin = r.biggest; if (r.end > maxEnd) maxEnd = r.end;
    if (r.ahead) ahead++; if (r.bust) bust++;
    house -= r.end; if (house < minH) minH = house;
  }
  return { need: minH < 0 ? -minH : 0, profit: PLAYERS * START - sumEnd, maxWin, maxEnd, ahead, bust, rtp: wager ? 100 * paid / wager : 0 };
}

console.log(JSON.stringify({ MAX_WIN: fmt(MAX_WIN), JP_CAP: fmt(JP_CAP), PLAYERS, BET: fmt(BET), REPS, bankrollTarget: '2000.00' }));
for (const mode of ['bust2000', 'double']) {
  const needs = [], profits = [], maxWins = [], maxEnds = [], rtps = [];
  let ahead = 0, bust = 0;
  for (let rep = 0; rep < REPS; rep++) {
    seed((0x50CAFE ^ rep * 0x9E3779B9 ^ (mode === 'double' ? 9 : 2)) >>> 0);
    const r = cohort(mode);
    needs.push(r.need); profits.push(r.profit); maxWins.push(r.maxWin); maxEnds.push(r.maxEnd); rtps.push(r.rtp);
    ahead += r.ahead; bust += r.bust;
    if ((rep + 1) % 1000 === 0) process.stderr.write(mode + ' ' + (rep + 1) + '/' + REPS + '\n');
  }
  needs.sort((a, b) => a - b); profits.sort((a, b) => a - b); maxWins.sort((a, b) => a - b); maxEnds.sort((a, b) => a - b);
  const meanP = profits.reduce((a, b) => a + b, 0) / REPS;
  const meanR = rtps.reduce((a, b) => a + b, 0) / REPS;
  const maxW = maxWins[maxWins.length - 1];
  const need999 = pct(needs, 0.999);
  console.log(JSON.stringify({
    mode,
    need_p95: fmt(pct(needs, 0.95)), need_p99: fmt(pct(needs, 0.99)), need_p999: fmt(need999), need_max: fmt(needs[needs.length - 1]),
    maxWin_max: fmt(maxW), maxEnd_max: fmt(maxEnds[maxEnds.length - 1]),
    pctAhead: +(100 * ahead / (REPS * PLAYERS)).toFixed(3),
    pctBust: +(100 * bust / (REPS * PLAYERS)).toFixed(3),
    profit_mean: fmt(meanP),
    realizedRtp_mean: +meanR.toFixed(3),
    fits2000_bankroll: need999 <= 200000,
    recommended: fmt(Math.max(need999, 5 * maxW)),
  }, null, 2));
}
