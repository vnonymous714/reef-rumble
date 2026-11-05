/* Neon Tide Slots: pure math, shared by the game and tools/slotsim.js. Original design, play credits only. */
(function (root) {
  'use strict';
  /* symbols: id, pays for 3/4/5 of a kind (x line bet) */
  var SYM = [
    { id: 'wild', pay: [0, 0, 300, 1200, 6000] },
    { id: 'seven', pay: [0, 0, 150, 600, 3000] },
    { id: 'crown', pay: [0, 0, 90, 300, 1200] },
    { id: 'diamond', pay: [0, 0, 60, 180, 720] },
    { id: 'bell', pay: [0, 0, 36, 120, 480] },
    { id: 'star', pay: [0, 0, 30, 90, 300] },
    { id: 'cherry', pay: [0, 0, 18, 60, 180] },
    { id: 'lemon', pay: [0, 0, 12, 36, 120] },
    { id: 'shell', pay: [0, 0, 12, 30, 90] }
  ];
  /* per-reel symbol weights (virtual reel); wild never on reel 1 */
  var W = [
    [0, 2, 3, 4, 6, 7, 9, 11, 12],
    [2, 2, 3, 4, 6, 7, 9, 11, 12],
    [2, 2, 3, 4, 6, 7, 9, 11, 12],
    [2, 2, 3, 4, 6, 7, 9, 11, 12],
    [1, 2, 3, 4, 6, 7, 9, 11, 12]
  ];
  /* 20 paylines: row index (0 top,1 mid,2 bottom) per reel */
  var LINES = [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
    [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1],
    [1,2,1,0,1],[0,1,1,1,0],[2,1,1,1,2],[0,1,0,1,0],[2,1,2,1,2],
    [1,1,0,1,1],[1,1,2,1,1],[0,0,2,0,0],[2,2,0,2,2],[0,2,0,2,0]
  ];
  var BETS = [20, 40, 100, 200, 400, 1000]; /* total bet per spin, cents (0.20..10.00); line bet = bet/20 */
  var TOT = W.map(function (r) { return r.reduce(function (a, b) { return a + b; }, 0); });
  function pick(reel, rng) { var r = rng() * TOT[reel], w = W[reel]; for (var i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; }
  function lineWin(syms) { /* syms: 5 symbol indices; left-to-right, wild(0) substitutes */
    var base = -1, n = 0;
    for (var i = 0; i < 5; i++) { var s = syms[i]; if (s === 0) { n++; continue; } if (base < 0) { base = s; n++; continue; } if (s === base) { n++; continue; } break; }
    var best = 0, bn = 0;
    /* pure-wild prefix value */
    var wn = 0; while (wn < 5 && syms[wn] === 0) wn++;
    if (wn >= 3) { best = SYM[0].pay[wn - 1]; bn = wn; }
    if (base >= 0 && n >= 3 && SYM[base].pay[n - 1] > best) { best = SYM[base].pay[n - 1]; bn = n; }
    return { m: best, n: bn };
  }
  function evaluate(grid) { /* grid[reel][row] */
    var total = 0, wins = [];
    for (var l = 0; l < LINES.length; l++) {
      var s = [], L = LINES[l];
      for (var r = 0; r < 5; r++) s.push(grid[r][L[r]]);
      var w = lineWin(s); if (w.m > 0) { total += w.m; wins.push({ line: l, n: w.n, m: w.m }); }
    }
    return { mult: total / LINES.length, wins: wins }; /* mult = x total bet */
  }
  function natural(rng) { var g = []; for (var r = 0; r < 5; r++) g.push([pick(r, rng), pick(r, rng), pick(r, rng)]); return g; }
  /* exact base RTP of natural spins (each cell independent with reel marginal) */
  function exactLineEV() {
    var p = W.map(function (w, r) { return w.map(function (x) { return x / TOT[r]; }); }), ev = 0, s = [0,0,0,0,0];
    (function rec(i, pr) { if (i === 5) { ev += pr * lineWin(s).m; return; } for (var k = 0; k < SYM.length; k++) { if (!p[i][k]) continue; s[i] = k; rec(i + 1, pr * p[i][k]); } })(0, 1);
    return ev;
  }
  var BASE = exactLineEV(); /* = RTP of natural spins (x total bet) */
  /* published RTP is reached by a fixed share of pre-decided losing spins:
     RTP = (1 - dead) * BASE  →  dead = 1 - target / BASE */
  function deadRate(target) { return Math.max(0, 1 - target / BASE); }
  function losing(rng, nearMiss) {
    for (var t = 0; t < 200; t++) {
      var g = natural(rng);
      if (nearMiss) { /* underground near-miss visuals (disabled in player UI) */
        g[0][1] = 1; g[1][1] = rng() < .5 ? 1 : 0; g[2][1] = 1 + 1 + Math.floor(rng() * 7);
      }
      if (evaluate(g).mult === 0) return g;
    }
    return [[8,7,6],[7,6,8],[6,8,7],[8,7,6],[7,6,8]];
  }
  /* one spin: target = 0.95 or 0.84; ug = underground near-miss visuals only (same payouts) */
  function spin(target, rng, ug) {
    var dead = rng() < deadRate(target);
    var g = dead ? losing(rng, ug && rng() < .35) : natural(rng);
    if (!dead && ug && rng() < .1) { var e0 = evaluate(g); if (e0.mult === 0) g = losing(rng, true); }
    var e = evaluate(g);
    return { grid: g, mult: e.mult, wins: e.wins };
  }
  var api = { SYM: SYM, W: W, LINES: LINES, BETS: BETS, BASE: BASE, evaluate: evaluate, spin: spin, deadRate: deadRate, natural: natural };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NeonSlots = api;
})(this);
