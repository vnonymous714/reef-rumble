// House bankroll Monte Carlo — live engine, sim-only RTP overrides. No game deploy.
const E = require('../engine.js');

const WPN_XP = [0, 25, 60, 120, 200, 320, 480, 700, 1000, 1400];
const START = 10000, DOUBLE = 20000, MAX_SHOTS = 2000, FIRE_MS = 165, BET = E.BETS[3];
const JP_RATE = E.JP_RATE, JP_SEED = E.JP_SEED, JP_P = E.JP_P, MAXBET = E.MAXBET;

let s = 1;
const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
const seed = (x) => { s = (x >>> 0) || 1; };

const table = E.spawnTable().concat([
  Object.assign({}, E.BY_ID.kraken, { w: 0.6 }),
  Object.assign({}, E.BY_ID.dragon, { w: 0.4 }),
]);
const regular = E.FISH.filter(f => !f.special && !f.boss && f.w > 0);
const TW = table.reduce((a, f) => a + f.w, 0);
const RW = regular.reduce((a, f) => a + f.w, 0);
const nT = table.length, nR = regular.length;
const tW = table.map(f => f.w), rM = regular.map(f => f.m), rW = regular.map(f => f.w);

function pickT() { let r = rng() * TW; for (let i = 0; i < nT; i++) { r -= tW[i]; if (r < 0) return table[i]; } return table[nT - 1]; }
function pickRm() { let r = rng() * RW; for (let i = 0; i < nR; i++) { r -= rW[i]; if (r < 0) return rM[i]; } return rM[nR - 1]; }
function wpnDmgFromXp(xp) {
  let lv = 1;
  for (let i = 1; i < WPN_XP.length; i++) { if (xp >= WPN_XP[i]) lv = i + 1; else break; }
  return lv >= 5 ? 2 : 1 + (lv - 1) * 0.25;
}
function pct(a, p) { const i = (a.length - 1) * p, lo = i | 0, hi = Math.ceil(i); return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo); }
function fmt(c) { return (c / 100).toFixed(2); }

/**
 * @param {{mode:string, players:number, lowTide:boolean, rtpFish:number}} cfg
 * @returns {{ends:Float64Array, shots:Float64Array, maxWin:number, maxEnd:number, sumEnd:number}}
 */
function simulateEnds(cfg) {
  const { mode, players, lowTide, rtpFish } = cfg;
  E.setRtpFish(rtpFish);
  let jp = JP_SEED;
  const ends = new Float64Array(players);
  const shotsA = new Float64Array(players);
  let maxWin = 0, maxEnd = 0, sumEnd = 0;

  for (let p = 0; p < players; p++) {
    let bal = START, xp = 0, shots = 0, biggest = 0;
    let tMs = lowTide ? ((rng() * 30 * 60000) | 0) : 0;
    let curFish = rtpFish;
    if (!lowTide) E.setRtpFish(rtpFish);

    while (bal >= BET && shots < MAX_SHOTS) {
      if (mode === 'double' && bal >= DOUBLE) break;
      if (lowTide) {
        const mins = (tMs / 60000) | 0;
        const want = (mins % 30) < 5 ? 0.87 : 0.91;
        if (want !== curFish) { E.setRtpFish(want); curFish = want; }
      }
      const dmg = wpnDmgFromXp(xp);
      const cost = (BET * dmg + 0.5) | 0;
      if (bal < cost) break;
      bal -= cost;
      jp += cost * JP_RATE;
      shots++;
      tMs += FIRE_MS;

      if (rng() < JP_P * cost / MAXBET) {
        const w = jp | 0;
        bal += w; jp = JP_SEED;
        if (w > biggest) biggest = w;
      }

      const f = pickT();
      const mult = E.rollMult(f, rng);
      let victims = null;
      if (f.special === 'bomb') {
        victims = []; const n = (rng() * 7) | 0;
        for (let k = 0; k < n; k++) victims.push(pickRm());
      } else if (f.special === 'chain') {
        victims = []; const n = 2 + ((rng() * 6) | 0);
        for (let k = 0; k < n; k++) victims.push(pickRm());
      }
      const total = E.hitValue(f, mult, victims);
      if (rng() < Math.min(1, E.chance(total / dmg))) {
        const win = f.special === 'wheel' ? E.WHEEL[E.wheelPick(rng)].m * BET : Math.round(total * BET);
        bal += win;
        if (win > biggest) biggest = win;
        const g = f.special === 'wheel' ? 40 : (mult || total);
        xp += Math.max(1, (Math.sqrt(Math.max(1, g)) * 1.4 + 0.5) | 0);
        if (xp > 20000) xp = 20000;
      }
    }
    ends[p] = bal; shotsA[p] = shots; sumEnd += bal;
    if (biggest > maxWin) maxWin = biggest;
    if (bal > maxEnd) maxEnd = bal;
  }
  return { ends, shots: shotsA, maxWin, maxEnd, sumEnd };
}

function cashflowSequential(ends) {
  let house = 0, minH = 0;
  for (let i = 0; i < ends.length; i++) {
    house += START;
    if (house < minH) minH = house;
    house -= ends[i];
    if (house < minH) minH = house;
  }
  return { need: minH < 0 ? -minH : 0, minH, profit: ends.length * START - ends.reduce((a, b) => a + b, 0) };
}

function cashflowConcurrent(ends, shots) {
  const n = ends.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (shots[a] - shots[b]) || (a - b));
  let house = n * START, minH = house;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ends[i];
    house -= ends[order[i]];
    if (house < minH) minH = house;
  }
  return {
    need: minH < 0 ? -minH : 0,
    minH,
    peakDD: n * START - minH,
    profit: n * START - sum,
  };
}

function summarizePlayerStats(ends, start) {
  const a = Array.from(ends).sort((x, y) => x - y);
  let ahead = 0, bust = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > start) ahead++;
    if (a[i] < BET) bust++;
  }
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return {
    pctAhead: 100 * ahead / a.length,
    pctBust: 100 * bust / a.length,
    medianEnd: fmt(pct(a, 0.5)),
    meanEnd: fmt(mean),
    maxEnd: fmt(a[a.length - 1]),
  };
}

function runBlock(label, cfg, reps, arrivals) {
  const rows = [];
  for (const arrival of arrivals) {
    const needs = [], profits = [], maxWins = [], maxEnds = [], peakDDs = [];
    let lastEnds = null;
    for (let rep = 0; rep < reps; rep++) {
      seed((0x51F0 ^ (rep * 0x9E3779B9) ^ label.length * 0x85EB ^ (arrival === 'c' ? 7 : 3) ^ (cfg.mode === 'double' ? 99 : 1)) >>> 0);
      const sim = simulateEnds(cfg);
      lastEnds = sim;
      const cf = arrival === 'sequential' ? cashflowSequential(sim.ends) : cashflowConcurrent(sim.ends, sim.shots);
      needs.push(cf.need);
      profits.push(cf.profit);
      maxWins.push(sim.maxWin);
      maxEnds.push(sim.maxEnd);
      peakDDs.push(arrival === 'concurrent' ? cf.peakDD : cf.need);
      if ((rep + 1) % 100 === 0) process.stderr.write(`${label}/${arrival}/${cfg.mode} ${rep + 1}/${reps}\n`);
    }
    needs.sort((a, b) => a - b);
    profits.sort((a, b) => a - b);
    maxWins.sort((a, b) => a - b);
    maxEnds.sort((a, b) => a - b);
    peakDDs.sort((a, b) => a - b);
    const meanP = profits.reduce((a, b) => a + b, 0) / reps;
    const ps = summarizePlayerStats(lastEnds.ends, START); // last rep snapshot; also aggregate below
    // better: re-sim one more for display stats from median? Use mean of maxWins etc.
    const maxWin = maxWins[maxWins.length - 1];
    const need999 = pct(needs, 0.999);
    const rec5 = 5 * maxWin;
    const rec = Math.max(need999, rec5);
    rows.push({
      label, arrival, mode: cfg.mode, players: cfg.players, reps,
      rtp: ((cfg.rtpFish + JP_RATE) * 100).toFixed(0) + '%',
      need_p95: fmt(pct(needs, 0.95)),
      need_p99: fmt(pct(needs, 0.99)),
      need_p999: fmt(need999),
      need_max: fmt(needs[needs.length - 1]),
      peakDD_p999: fmt(pct(peakDDs, 0.999)),
      maxWin_max: fmt(maxWin),
      maxEnd_max: fmt(maxEnds[maxEnds.length - 1]),
      rec_5xWin: fmt(rec5),
      recommended: fmt(rec),
      profit_mean: fmt(meanP),
      profit_p05: fmt(pct(profits, 0.05)),
      profit_p50: fmt(pct(profits, 0.5)),
      // player outcome from pooled? use last rep only for % — instead average over reps by storing
      lastRep: ps,
    });
  }
  return rows;
}

// Separate: player outcome stats averaged over reps (for 100p 82% and sample for 10k)
function playerOutcomeBlock(cfg, reps) {
  let ahead = 0, bust = 0, n = 0;
  const medians = [], maxes = [], biggest = [], profits = [];
  for (let rep = 0; rep < reps; rep++) {
    seed((0xBEEF ^ rep * 0x1000193 ^ cfg.mode.length) >>> 0);
    const sim = simulateEnds(cfg);
    const a = Array.from(sim.ends).sort((x, y) => x - y);
    medians.push(pct(a, 0.5));
    maxes.push(a[a.length - 1]);
    biggest.push(sim.maxWin);
    profits.push(cfg.players * START - sim.sumEnd);
    for (let i = 0; i < a.length; i++) {
      n++;
      if (a[i] > START) ahead++;
      if (a[i] < BET) bust++;
    }
    if ((rep + 1) % 500 === 0) process.stderr.write(`outcomes/${cfg.mode} ${rep + 1}/${reps}\n`);
  }
  medians.sort((a, b) => a - b);
  maxes.sort((a, b) => a - b);
  biggest.sort((a, b) => a - b);
  profits.sort((a, b) => a - b);
  return {
    pctAhead: (100 * ahead / n),
    pctBust: (100 * bust / n),
    medianEnd_meanOfRepMedians: fmt(medians.reduce((a, b) => a + b, 0) / medians.length),
    maxEnd_acrossReps: fmt(maxes[maxes.length - 1]),
    biggestWin_acrossReps: fmt(biggest[biggest.length - 1]),
    profit_mean: fmt(profits.reduce((a, b) => a + b, 0) / profits.length),
  };
}

const out = { bet: fmt(BET), start: fmt(START) };

// --- 100 players @ 82% (RTP_FISH 0.81), no Low Tide, 2000 reps ---
process.stderr.write('=== 100p @ 82% ===\n');
const cfg100a = { mode: 'bust2000', players: 100, lowTide: false, rtpFish: 0.81 };
const cfg100b = { mode: 'double', players: 100, lowTide: false, rtpFish: 0.81 };
out.p100_82_outcomes_a = playerOutcomeBlock(cfg100a, 2000);
out.p100_82_outcomes_b = playerOutcomeBlock(cfg100b, 2000);
out.p100_82_bankroll = [
  ...runBlock('100p82', cfg100a, 2000, ['sequential', 'concurrent']),
  ...runBlock('100p82', cfg100b, 2000, ['sequential', 'concurrent']),
];

// --- 10k @ live 92/88, 200 reps ---
process.stderr.write('=== 10k @ 92/88 ===\n');
const cfg10ka = { mode: 'bust2000', players: 10000, lowTide: true, rtpFish: 0.91 };
const cfg10kb = { mode: 'double', players: 10000, lowTide: true, rtpFish: 0.91 };
// outcomes: 20 reps enough for stable % (full 200 for bankroll)
out.p10k_outcomes_a = playerOutcomeBlock(cfg10ka, 40);
out.p10k_outcomes_b = playerOutcomeBlock(cfg10kb, 40);
out.p10k_bankroll = [
  ...runBlock('10k92', cfg10ka, 200, ['sequential', 'concurrent']),
  ...runBlock('10k92', cfg10kb, 200, ['sequential', 'concurrent']),
];

console.log(JSON.stringify(out, null, 2));

console.log('\n=== TABLE ===');
console.log(['cohort', 'arrival', 'scenario', 'need95', 'need99', 'need99.9', 'needMax', 'maxWin', 'rec=max(99.9need,5xWin)', 'E[profit]'].join('\t'));
for (const r of [...out.p100_82_bankroll, ...out.p10k_bankroll]) {
  console.log([
    `${r.players}@${r.rtp}`, r.arrival, r.mode === 'bust2000' ? 'bust|2000' : 'quit@200',
    r.need_p95, r.need_p99, r.need_p999, r.need_max,
    r.maxWin_max, r.recommended, r.profit_mean,
  ].join('\t'));
}
console.log('\n=== PLAYER OUTCOMES ===');
console.log('100@82 bust|2000', JSON.stringify(out.p100_82_outcomes_a));
console.log('100@82 quit@200', JSON.stringify(out.p100_82_outcomes_b));
console.log('10k@92 bust|2000 (40 reps)', JSON.stringify(out.p10k_outcomes_a));
console.log('10k@92 quit@200 (40 reps)', JSON.stringify(out.p10k_outcomes_b));
