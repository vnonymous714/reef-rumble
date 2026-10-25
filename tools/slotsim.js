// node tools/slotsim.js [spins]  — Monte Carlo RTP check for Neon Tide Slots
const m = require('../slotmath.js');
const N = +process.argv[2] || 2000000;
const rng = Math.random;
for (const [t, ug] of [[0.95, false], [0.84, false], [0.95, true], [0.84, true]]) {
  let bet = 0, win = 0, hits = 0, big = 0;
  for (let i = 0; i < N; i++) { const r = m.spin(t, rng, ug); bet += 1; win += r.mult; if (r.mult > 0) hits++; if (r.mult >= 10) big++; }
  console.log(`target ${t} ug=${ug} spins ${N} RTP ${(win / bet * 100).toFixed(3)}% hit ${(hits / N * 100).toFixed(1)}% bigwin(>=10x) 1/${Math.round(N / Math.max(1, big))}`);
}
console.log('exact natural-spin RTP', (m.BASE * 100).toFixed(4) + '%');
