// 10k-player bankroll simulator for Reef Rumble (play credits; amounts in cents).
// Uses live engine.js: 92%/88% Low Tide, jackpot, specials, weapon cost scaling.
// Does not model laser beam ticks (Prism Ray pays as a special catch only).
const E = require('../engine.js');

const PLAYERS = 10000;
const START = 10000;           // 100.00 credits
const DOUBLE = 20000;          // quit-at-double target
const MAX_SHOTS = 2000;
const FIRE_MS = 165;           // game FIRE_MS — used for Low Tide clock
const WPN_XP = [0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400];

let s = 0xC0FFEE ^ 0x9e3779b9;
const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

const table = E.spawnTable().concat([{ ...E.BY_ID.kraken, w: 0.6 }, { ...E.BY_ID.dragon, w: 0.4 }]);
const regular = E.FISH.filter(f => !f.special && !f.boss && f.w > 0);
const TW = table.reduce((a, f) => a + f.w, 0), RW = regular.reduce((a, f) => a + f.w, 0);
const pick = (arr, tw) => { let r = rng() * tw; for (const f of arr) { r -= f.w; if (r < 0) return f; } return arr[arr.length - 1]; };

function wpnLevel(xp) {
  let lv = 1;
  for (let i = 1; i < WPN_XP.length; i++) { if (xp >= WPN_XP[i]) lv = i + 1; else break; }
  return Math.min(10, lv);
}
function wpnDmg(lv) { return Math.min(2, 1 + (lv - 1) * 0.25); }
function grantXp(xp, mult) {
  return Math.min(20000, xp + Math.max(1, Math.round(Math.sqrt(Math.max(1, mult || 1)) * 1.4)));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function fmt(cents) { return (cents / 100).toFixed(2); }

/** @param {{bet:number, mode:'bust2000'|'double', seed?:number}} opts */
function simulate(opts) {
  const bet = opts.bet;
  const mode = opts.mode;
  if (opts.seed != null) s = opts.seed >>> 0;
  let jp = E.JP_SEED;
  let totalWager = 0, totalPaid = 0, biggestWin = 0, jpHits = 0;
  const ends = new Float64Array(PLAYERS);
  const peaks = new Float64Array(PLAYERS);
  let ahead = 0, bust = 0, doubled = 0, timedOut = 0;

  for (let p = 0; p < PLAYERS; p++) {
    let bal = START, peak = START, xp = 0, shots = 0;
    // random offset into 30-min Low Tide cycle (ms)
    let tMs = Math.floor(rng() * 30 * 60000);
    while (bal >= bet && shots < MAX_SHOTS) {
      if (mode === 'double' && bal >= DOUBLE) { doubled++; break; }

      // Low Tide: 5 of every 30 minutes
      const mins = Math.floor(tMs / 60000);
      E.setRtpPeriod((mins % 30) < 5 ? 88 : 92);

      const lv = wpnLevel(xp);
      const dmg = wpnDmg(lv);
      const cost = Math.max(1, Math.round(bet * dmg));
      if (bal < cost) break; // can't afford this weapon level shot
      bal -= cost;
      totalWager += cost;
      jp += cost * E.JP_RATE;
      shots++;
      tMs += FIRE_MS;

      if (E.jpTrigger(cost, rng)) {
        const w = Math.floor(jp);
        bal += w; totalPaid += w; jp = E.JP_SEED; jpHits++;
        if (w > biggestWin) biggestWin = w;
        if (bal > peak) peak = bal;
      }

      const f = pick(table, TW);
      const mult = E.rollMult(f, rng);
      let victims = [];
      if (f.special === 'bomb') { const n = Math.floor(rng() * 7); for (let k = 0; k < n; k++) victims.push(pick(regular, RW).m); }
      if (f.special === 'chain') { const n = 2 + Math.floor(rng() * 6); for (let k = 0; k < n; k++) victims.push(pick(regular, RW).m); }
      const total = E.hitValue(f, mult, victims);
      if (rng() < Math.min(1, E.chance(total / dmg))) {
        const win = f.special === 'wheel' ? E.WHEEL[E.wheelPick(rng)].m * bet : Math.round(total * bet);
        bal += win; totalPaid += win;
        if (win > biggestWin) biggestWin = win;
        xp = grantXp(xp, f.special === 'wheel' ? 40 : (mult || total));
        if (bal > peak) peak = bal;
      }
    }
    if (mode === 'double' && bal >= DOUBLE) { /* already counted */ }
    else if (bal < MINBET) { bust++; }
    else if (shots >= MAX_SHOTS) timedOut++;

    ends[p] = bal;
    peaks[p] = peak;
    if (bal > START) ahead++;
  }

  const endArr = Array.from(ends).sort((a, b) => a - b);
  const peakArr = Array.from(peaks).sort((a, b) => a - b);
  const meanEnd = endArr.reduce((a, b) => a + b, 0) / PLAYERS;
  const meanPeak = peakArr.reduce((a, b) => a + b, 0) / PLAYERS;
  const deposits = PLAYERS * START;
  const houseHold = deposits - endArr.reduce((a, b) => a + b, 0);

  return {
    players: PLAYERS,
    bet: fmt(bet),
    betCents: bet,
    mode,
    start: fmt(START),
    pctAhead: (100 * ahead / PLAYERS),
    pctBust: (100 * bust / PLAYERS),
    pctDoubled: mode === 'double' ? (100 * doubled / PLAYERS) : null,
    pctTimedOut: (100 * timedOut / PLAYERS),
    medianEnd: fmt(percentile(endArr, 0.5)),
    meanEnd: fmt(meanEnd),
    p90End: fmt(percentile(endArr, 0.9)),
    p99End: fmt(percentile(endArr, 0.99)),
    maxEnd: fmt(endArr[endArr.length - 1]),
    medianPeak: fmt(percentile(peakArr, 0.5)),
    meanPeak: fmt(meanPeak),
    p90Peak: fmt(percentile(peakArr, 0.9)),
    p99Peak: fmt(percentile(peakArr, 0.99)),
    maxPeak: fmt(peakArr[peakArr.length - 1]),
    biggestWin: fmt(biggestWin),
    jpHits,
    totalWager: fmt(totalWager),
    totalPaid: fmt(totalPaid),
    deposits: fmt(deposits),
    houseHold: fmt(houseHold),
    houseHoldPctOfDeposits: (100 * houseHold / deposits),
    realizedRtpOfWager: totalWager ? (100 * totalPaid / totalWager) : 0,
  };
}

function printRow(r) {
  console.log(JSON.stringify(r, null, 2));
}

const MINBET = E.BETS[0];
const DEFAULT_BET = E.BETS[3]; // S.bi = 3 → 100 cents = 1.00
const MIN_BET = E.BETS[0];     // 10 cents = 0.10

console.log('=== Reef Rumble 10k-player bankroll sim ===');
console.log('engine BETS', E.BETS, 'default bi=3 →', DEFAULT_BET, 'min →', MIN_BET);
console.log('START', START, 'DOUBLE', DOUBLE, 'MAX_SHOTS', MAX_SHOTS);
console.log('RTP periods: 92% / Low Tide 88% (5/30 min via FIRE_MS clock)');
console.log('');

const runs = [
  { bet: DEFAULT_BET, mode: 'bust2000', seed: 0xA11CE001 },
  { bet: DEFAULT_BET, mode: 'double', seed: 0xA11CE002 },
  { bet: MIN_BET, mode: 'bust2000', seed: 0xA11CE003 },
  { bet: MIN_BET, mode: 'double', seed: 0xA11CE004 },
];

const results = [];
for (const cfg of runs) {
  console.log('---', cfg.mode, 'bet', fmt(cfg.bet), '---');
  const r = simulate(cfg);
  results.push(r);
  printRow(r);
}

// concise markdown-ish table
console.log('\n=== SUMMARY TABLE (credits) ===');
console.log(['scenario', 'bet', '%ahead', '%bust', '%doubled', 'medianEnd', 'meanEnd', 'p90End', 'p99End', 'maxEnd', 'maxPeak', 'biggestWin', 'houseHold%', 'RTP_wager'].join('\t'));
for (const r of results) {
  const label = r.mode === 'bust2000' ? 'bust|2000shots' : 'bust|double200';
  console.log([
    label, r.bet,
    r.pctAhead.toFixed(2) + '%',
    r.pctBust.toFixed(2) + '%',
    r.pctDoubled == null ? '—' : r.pctDoubled.toFixed(2) + '%',
    r.medianEnd, r.meanEnd, r.p90End, r.p99End, r.maxEnd,
    r.maxPeak, r.biggestWin,
    r.houseHoldPctOfDeposits.toFixed(2) + '%',
    r.realizedRtpOfWager.toFixed(2) + '%',
  ].join('\t'));
}
