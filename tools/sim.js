// Monte Carlo RTP check for Reef Rumble.
// Models shots hitting fish from the live spawn mix (bosses/specials), bomb/chain victims,
// bonus wheel, progressive jackpot, and weapon/laser damage with cost scaling.
const E = require('../engine.js');
let s = 0x9e3779b9; const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
const table = E.spawnTable().concat([{ ...E.BY_ID.kraken, w: 0.6 }, { ...E.BY_ID.dragon, w: 0.4 }]);
const regular = E.FISH.filter(f => !f.special && !f.boss && f.w > 0);
const TW = table.reduce((a, f) => a + f.w, 0), RW = regular.reduce((a, f) => a + f.w, 0);
const pick = (arr, tw) => { let r = rng() * tw; for (const f of arr) { r -= f.w; if (r < 0) return f; } return arr[arr.length - 1]; };

function wpnDmg(lv) { return Math.min(2, 1 + (lv - 1) * 0.25); }

/** @param {{bet:number,shots:number,dmg?:number,laserBoost?:number}} opts */
function run(opts) {
  const bet = opts.bet, shots = opts.shots;
  const dmg = opts.dmg || 1;
  const boost = opts.laserBoost || 1; // extra factor on top of dmg for laser ticks
  const factor = dmg * boost;
  let wager = 0, paid = 0, jp = E.JP_SEED, jpHits = 0, caps = 0, fishPaid = 0, jpPaid = 0;
  for (let i = 0; i < shots; i++) {
    const cost = Math.max(1, Math.round(bet * factor));
    wager += cost; jp += cost * E.JP_RATE;
    if (E.jpTrigger(cost, rng)) { const w = Math.floor(jp); paid += w; jpPaid += w; jp = E.JP_SEED; jpHits++; }
    const f = pick(table, TW);
    const mult = E.rollMult(f, rng);
    let victims = [];
    if (f.special === 'bomb') { const n = Math.floor(rng() * 7); for (let k = 0; k < n; k++) victims.push(pick(regular, RW).m); }
    if (f.special === 'chain') { const n = 2 + Math.floor(rng() * 6); for (let k = 0; k < n; k++) victims.push(pick(regular, RW).m); }
    const total = E.hitValue(f, mult, victims);
    // capture chance uses factor the same way live game does: chance(total / factor)
    if (rng() < Math.min(1, E.chance(total / factor))) {
      caps++;
      const win = f.special === 'wheel' ? E.WHEEL[E.wheelPick(rng)].m * bet : Math.round(total * bet);
      paid += win; fishPaid += win;
    }
  }
  return { bet: (bet / 100).toFixed(2), shots, factor, rtp: (100 * paid / wager), fish: (100 * fishPaid / wager), jackpot: (100 * jpPaid / wager), jpHits, hitRate: (100 * caps / shots) };
}

const N = +process.argv[2] || 2000000;
function show(label, period, extra) {
  E.setRtpPeriod(period);
  s = 0x9e3779b9;
  const target = (E.RTP_FISH + E.JP_RATE) * 100;
  console.log('===', label, 'RTP_FISH=' + E.RTP_FISH, 'JP_RATE=' + E.JP_RATE, 'target≈' + target.toFixed(1) + '%', extra || '', '===');
  const r = run(Object.assign({ bet: 100, shots: N }, extra || {}));
  console.log({ bet: r.bet, shots: r.shots, factor: r.factor, rtp: r.rtp.toFixed(2) + '%', fish: r.fish.toFixed(2) + '%', jackpot: r.jackpot.toFixed(2) + '%', jpHits: r.jpHits, hitRate: r.hitRate.toFixed(1) + '%', delta_pp: (r.rtp - target).toFixed(2) });
  return r;
}

console.log('weapon dmg curve', [1,2,3,4,5,6,7,8,9,10].map(lv => ({ lv, dmg: wpnDmg(lv) })));

const r92 = show('HIGH 92% LV1', 92, { dmg: wpnDmg(1) });
show('HIGH 92% LV5 (2x cap)', 92, { dmg: wpnDmg(5) });
show('HIGH 92% LV10 (2x cap)', 92, { dmg: wpnDmg(10) });
show('HIGH 92% LV10 + laser 1.2x', 92, { dmg: wpnDmg(10), laserBoost: 1.2 });
const r88 = show('LOW TIDE 88% LV1', 88, { dmg: wpnDmg(1) });
show('LOW TIDE 88% LV10', 88, { dmg: wpnDmg(10) });

const blend = (25 / 30) * r92.rtp + (5 / 30) * r88.rtp;
console.log('=== BLENDED (5/30 Low Tide @88, 25/30 @92) LV1 ===');
console.log('blend_rtp', blend.toFixed(2) + '%', 'weights 25:5 of', r92.rtp.toFixed(2) + '% /', r88.rtp.toFixed(2) + '%');
