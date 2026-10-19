// Monte Carlo RTP check for Reef Rumble. Models every shot hitting a fish drawn from the live spawn mix
// (bosses and specials included), bomb/chain victims, the bonus wheel, and the progressive jackpot.
const E = require('../engine.js');
let s = 0x9e3779b9; const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
const table = E.spawnTable().concat([{ ...E.BY_ID.kraken, w: 0.6 }, { ...E.BY_ID.dragon, w: 0.4 }]);
const regular = E.FISH.filter(f => !f.special && !f.boss && f.w > 0);
const TW = table.reduce((a, f) => a + f.w, 0), RW = regular.reduce((a, f) => a + f.w, 0);
const pick = (arr, tw) => { let r = rng() * tw; for (const f of arr) { r -= f.w; if (r < 0) return f; } return arr[arr.length - 1]; };
function run(bet, shots) {
  let wager = 0, paid = 0, jp = E.JP_SEED, jpHits = 0, caps = 0, fishPaid = 0, jpPaid = 0;
  for (let i = 0; i < shots; i++) {
    wager += bet; jp += bet * E.JP_RATE;
    if (E.jpTrigger(bet, rng)) { const w = Math.floor(jp); paid += w; jpPaid += w; jp = E.JP_SEED; jpHits++; }
    const f = pick(table, TW);
    const mult = E.rollMult(f, rng);
    let victims = [];
    if (f.special === 'bomb') { const n = Math.floor(rng() * 7); for (let k = 0; k < n; k++) victims.push(pick(regular, RW).m); }
    if (f.special === 'chain') { const n = 2 + Math.floor(rng() * 6); for (let k = 0; k < n; k++) victims.push(pick(regular, RW).m); }
    const total = E.hitValue(f, mult, victims);
    if (rng() < E.chance(total)) {
      caps++;
      const win = f.special === 'wheel' ? E.WHEEL[E.wheelPick(rng)].m * bet : Math.round(total * bet);
      paid += win; fishPaid += win;
    }
  }
  return { bet: (bet / 100).toFixed(2), shots, rtp: (100 * paid / wager), fish: (100 * fishPaid / wager), jackpot: (100 * jpPaid / wager), jpHits, hitRate: (100 * caps / shots) };
}
const N = +process.argv[2] || 5000000;
function show(label, period) {
  E.setRtpPeriod(period);
  s = 0x9e3779b9; // reset seed for comparable runs
  console.log('===', label, 'RTP_FISH=' + E.RTP_FISH, 'JP_RATE=' + E.JP_RATE, 'target≈' + ((E.RTP_FISH + E.JP_RATE) * 100).toFixed(1) + '% ===');
  console.log('wheel EV', E.WHEEL_EV.toFixed(2) + 'x');
  for (const b of [10, 100, 1000]) {
    const r = run(b, N);
    console.log({ bet: r.bet, shots: r.shots, rtp: r.rtp.toFixed(2) + '%', fish: r.fish.toFixed(2) + '%', jackpot: r.jackpot.toFixed(2) + '%', jpHits: r.jpHits, hitRate: r.hitRate.toFixed(1) + '%' });
  }
  // return last max-bet rtp for blend
  s = 0x9e3779b9;
  return run(100, N).rtp;
}
const r95 = show('HIGH 95%', 95);
const r84 = show('LOW TIDE 84%', 84);
// Blended after week 1: 5 min low / 25 min high per 30 min → 5/30 low, 25/30 high
const blend = (25 / 30) * r95 + (5 / 30) * r84;
console.log('=== BLENDED (5/30 Low Tide @84, 25/30 @95) ===');
console.log('blend_rtp', blend.toFixed(2) + '%', 'weights 25:5 of', r95.toFixed(2) + '% /', r84.toFixed(2) + '%');
