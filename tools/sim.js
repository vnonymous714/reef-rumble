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
  return { bet: (bet / 100).toFixed(2), shots, rtp: (100 * paid / wager).toFixed(2) + '%', fish: (100 * fishPaid / wager).toFixed(2) + '%', jackpot: (100 * jpPaid / wager).toFixed(2) + '%', jpHits, hitRate: (100 * caps / shots).toFixed(1) + '%' };
}
const N = +process.argv[2] || 20000000;
console.log('wheel EV', E.WHEEL_EV.toFixed(2) + 'x');
for (const b of [10, 100, 1000]) console.log(run(b, N));
