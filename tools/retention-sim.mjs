/* Seeded retention simulator for payout policies (play credits only).
 * Uses the real combat math (attack/engage/jackpotAward), the real spawn table,
 * fish route lengths and speeds, Low Tide timing, the 400.00 cap, relic bonus
 * chest and escape progress payouts. Player behaviour calibrated to the real
 * Nov 9 - Nov 25 ledger (0.97 shots/s, base 0.10 at weapon LV5 => 0.20 a shot).
 * Usage: node tools/retention-sim.mjs <candidate|all> [sessions] [seed] */
import { writeFileSync } from "node:fs";
import * as Branch from "../worker/src/combat-math.js";
import { effectiveReturn, LIVE_TG35, STEADY_TIDE } from "../worker/src/payout-policy.js";
import E from "../engine.js";
import motion from "../reef-motion.js";

const LIVE_PATH = process.env.LIVE_COMBAT || "/workspace/rr-tg35-hotfix/worker/src/combat-math.js";
const Live = await import(LIVE_PATH);

export function rng32(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const table = E.spawnTable(), total = table.reduce((n, f) => n + f.w, 0);
function pickDef(r) { let n = r() * total; for (const d of table) { n -= d.w; if (n < 0) return d; } return table[0]; }

export const CANDIDATES = {
  A_live:        { label: "Live tg35 (91/87)", combat: "live", policy: LIVE_TG35 },
  B_chip:        { label: "Chip pay (same RTP, pay each hit's share now)", combat: "live", policy: LIVE_TG35, chip: true },
  C_band93:      { label: "RTP band 93/89", policy: { ...LIVE_TG35, normal: 0.93, lowTide: 0.89 } },
  D_cushion:     { label: "91/87 + Lifeline +3 under 15.00", policy: { ...LIVE_TG35, cushion: { below: 1500, add: 0.03 } } },
  E_streak:      { label: "91/87 + Second Wind +5 after 10 misses", policy: { ...LIVE_TG35, streak: { after: 10, add: 0.05 } } },
  F_newplayer:   { label: "91/87 + Welcome +2 first 7 days", policy: { ...LIVE_TG35, newPlayer: { days: 7, add: 0.02 } }, newAccount: true },
  G_pity:        { label: "91/87 + relic pity at 150 shots", policy: LIVE_TG35, pity: 150 },
  H_steady:      { label: "Steady Tide (93/89 + Lifeline + Second Wind)", policy: { ...STEADY_TIDE, newPlayer: null } },
  H_steady_new:  { label: "Steady Tide, new account (adds Welcome +2)", policy: STEADY_TIDE, newAccount: true },
  J_double:      { label: "Double-shot (2 half bullets / trigger), live 91/87", policy: LIVE_TG35, double: true },
  K_steady_double: { label: "Steady Tide + Double-shot", policy: { ...STEADY_TIDE, newPlayer: null }, double: true },
  L_steady92:    { label: "Steady Tide 92/88 + Lifeline + Second Wind", policy: { ...STEADY_TIDE, normal: 0.92, lowTide: 0.88, newPlayer: null } },
  L_steady92_new: { label: "Steady Tide 92/88, new account (+Welcome 2)", policy: { ...STEADY_TIDE, normal: 0.92, lowTide: 0.88 }, newAccount: true },
  M_steady92_double: { label: "Steady Tide 92/88 + Double-shot", policy: { ...STEADY_TIDE, normal: 0.92, lowTide: 0.88, newPlayer: null }, double: true },
  I_band95:      { label: "RTP band 95/91 (upper bound probe)", policy: { ...LIVE_TG35, normal: 0.95, lowTide: 0.91 } },
};
const RATE = 0.97;                  // shots per second (real median)
const DT = 1000 / RATE;
const POOL = 18;                    // live fish on screen
const H0 = 1 / 155;                 // per-shot voluntary quit (real mean of >1-shot sessions)
const STREAK_QUIT = 15, STREAK_MULT = 2; // ASSUMPTION: quit hazard x2 inside a no-pay streak >= 15 (real p90 gap)

function newFish(def, now, r, serial) {
  const route = motion.path(r, r() < 0.5 ? 0 : 1, def.len * 0.8 + 20);
  const dur = (route.length / (def.spd * (0.85 + r() * 0.3))) * 1000;
  const born = now - r() * 0.3 * dur;
  return { id: "f" + serial, art: def.id, mult: def.id === "chest" ? 12 : def.id === "relic" ? 10 : E.rollMult(def, r),
    kind: def.id === "chest" ? "temple" : def.id === "relic" ? "bonuspick" : def.special || "normal",
    boss: !!def.boss, dead: false, expires: born + dur, paidUnits: 0 };
}

/** One session. mode 'session' => voluntary quit hazard; 'bankroll' => play to bust (cap). */
export function session(cand, r, { mode = "session", start = 5000, base = 10, tier = 5, cap = 20000, t0 = 0 } = {}) {
  const C = cand.combat === "live" ? Live : Branch;
  let maxShotPay = 0, now = t0, serial = 0, bal = start, wager = 0, paid = 0, shots = 0, miss = 0, events = 0, wins = [], bulletHits = 0;
  let fishes = [], target = null, nextBoss = now + 35000, jp = 25000, jpCarry = 0, relicUsed = false, sinceRelic = 0, peak = start, low = start;
  const createdAt = cand.newAccount ? t0 - 3600000 : t0 - 30 * 86400000;
  const add = (def) => fishes.push(newFish(def, now, r, ++serial));
  for (let i = 0; i < POOL; i++) add(pickDef(r));
  const progressPay = (f) => f.lock ? Math.round(((f.maxHp - f.hp) / f.lock.hpUnit) * f.lock.stake * (f.lock.payoutFactor || 1)) : 0;
  const settleEscapes = () => {
    let p = 0;
    for (const f of fishes) if (!f.dead && f.expires <= now && f.lock) p += Math.max(0, progressPay(f) - (f.paidUnits || 0));
    fishes = fishes.filter((f) => !f.dead && f.expires > now);
    return p;
  };
  const stake = Math.round(base * Branch.profile(tier, base).costFactor);
  let quit = false, bust = false;
  while (shots < cap) {
    now += DT;
    let tickPay = settleEscapes();
    while (fishes.filter((f) => !f.boss).length < POOL) add(pickDef(r));
    if (now >= nextBoss) { if (!fishes.some((f) => f.boss)) add(r() < 0.6 ? E.BY_ID.kraken : E.BY_ID.dragon); nextBoss = now + 55000 + r() * 20000; }
    if (cand.pity && !relicUsed && sinceRelic >= cand.pity && !fishes.some((f) => f.kind === "bonuspick")) { add(E.BY_ID.relic); sinceRelic = 0; }
    if (bal + tickPay < stake) {
      // can't afford: wait for locked progress to escape and pay, else bust
      bal += tickPay; paid += tickPay; if (tickPay > 0) { events++; wins.push(tickPay / stake); }
      if (!fishes.some((f) => f.lock && !f.dead && f.hp < f.maxHp)) { bust = true; break; }
      continue;
    }
    if (!target || target.dead || target.expires <= now + 800 || (cand.double && !Branch.canDouble(target))) {
      const live = fishes.filter((f) => !f.dead && f.expires > now + 1500 && (!cand.double || Branch.canDouble(f)));
      target = live[Math.floor(r() * live.length)];
      if (!target) continue;
    }
    const period = Math.floor(now / 60000) % 30 < 5 ? 88 : 92;
    const R = cand.combat === "live" ? (period === 88 ? 0.87 : 0.91)
      : effectiveReturn(period, { balance: bal, missStreak: miss, createdAt, now }, cand.policy);
    const others = fishes.filter((f) => f !== target && !f.dead);
    const pool = [target];
    for (let i = 0; i < 2 && others.length; i++) pool.push(others.splice(Math.floor(r() * others.length), 1)[0]);
    let res;
    try {
      if (cand.double) {
        const alt = pool.length > 1 && r() < 0.5 ? pool[1].id : target.id;
        res = Branch.doubleShot(pool, [target.id, alt], base, tier, "normal", R, r);
      } else res = C.attack(pool, target.id, base, tier, "normal", R, r);
    }
    catch (e) { if (/lower stake/.test(e.message)) { target = null; continue; } throw e; }
    const byId = new Map(res.fishes.map((f) => [f.id, f]));
    fishes = fishes.map((f) => byId.get(f.id) || f);
    target = byId.get(target.id);
    bal -= res.cost; wager += res.cost; shots++; sinceRelic++;
    let p = 0;
    for (const u of res.updates) {
      const f = byId.get(u.target.id);
      if (cand.chip) {
        if (u.damage > 0) { const due = u.target.dead ? u.prize : progressPay(f); p += Math.max(0, due - (f.paidUnits || 0)); f.paidUnits = due; }
      } else p += u.prize;
      if (u.target.dead && u.target.kind === "bonuspick" && !relicUsed) { relicUsed = true; p += [2, 5, 10][Math.floor(r() * 3)] * u.target.lock.stake; }
    }
    jpCarry += res.cost; jp = Math.min(40000, jp + Math.floor(jpCarry / 100)); jpCarry %= 100;
    if (res.hits) p = Math.min(40000, p); // double-shot trigger cap
    let jpPaid = 0;
    for (const h of res.hits || [res]) {
      const j = jpPaid ? 0 : Math.min(C.jackpotAward(h.updates, "normal", h.cost, jp, r()), 40000 - p);
      if (j > 0) { p += j; jpPaid = j; jp = 25000; }
      if (h.payout > 0 || j) bulletHits++;
    }
    if (res.refund) { bal += res.refund; wager -= res.refund; }
    if (tickPay > 0) bulletHits++;
    if (p > 40000) throw new Error("400.00 cap invariant");
    maxShotPay = Math.max(maxShotPay, p);
    p += tickPay;
    bal += p; paid += p;
    if (p > 0) { events++; wins.push(p / res.cost); miss = 0; } else miss++;
    peak = Math.max(peak, bal); low = Math.min(low, bal);
    if (mode === "session") {
      const h = miss >= STREAK_QUIT ? H0 * STREAK_MULT : H0;
      if (r() < h) { quit = true; break; }
    }
  }
  // leaving: locked progress escapes and pays (player sees it on return)
  for (const f of fishes) if (f.lock && !f.dead && !cand.chip) { const q = progressPay(f); bal += q; paid += q; }
  return { shots, wager, paid, bal, bust, quit, events, wins, bulletHits, maxShotPay, secs: shots / RATE, maxBal: peak };
}

const pct = (v, q) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
export function run(name, n = 10000, seed = 20261125, opts = {}) {
  const cand = CANDIDATES[name], r = rng32(seed);
  const S = [], B = [];
  let house = 0, housePeak = 0, houseDD = 0, W = 0, P = 0, ev = 0, ws = [], bh = 0;
  for (let i = 0; i < n; i++) {
    const s = session(cand, r, { mode: "session", t0: i * 7919 * 1000, ...opts });
    S.push(s); W += s.wager; P += s.paid; ev += s.events; bh += s.bulletHits;
    house += s.wager - s.paid; housePeak = Math.max(housePeak, house); houseDD = Math.max(houseDD, housePeak - house);
    if (ws.length < 400000) ws.push(...s.wins);
  }
  let BW = 0, BP = 0;
  for (let i = 0; i < n; i++) { const b = session(cand, r, { mode: "bankroll", t0: i * 7919 * 1000, ...opts }); B.push(b); BW += b.wager; BP += b.paid; }
  const shots = S.map((s) => s.shots), bust = B.map((b) => b.shots);
  const worstSession = Math.max(...S.map((s) => s.paid - s.wager));
  return {
    name, label: cand.label, n, seed,
    sessShotsMed: pct(shots, 0.5), sessShotsP90: pct(shots, 0.9), sessMinMed: +(pct(shots, 0.5) / RATE / 60).toFixed(1),
    bustShotsMed: pct(bust, 0.5), bustShotsP90: pct(bust, 0.9), bustMinMed: +(pct(bust, 0.5) / RATE / 60).toFixed(1),
    bustCapped: B.filter((b) => !b.bust).length / n,
    rtp: +(P / W).toFixed(4), rtpBankroll: +(BP / BW).toFixed(4),
    edgePer1000: +((1 - P / W) * 1000).toFixed(1),
    houseMaxDrawdownCredits: +(houseDD / 100).toFixed(2), worstSessionPlayerProfit: +(worstSession / 100).toFixed(2),
    endAhead: +(S.filter((s) => s.bal > 5000).length / n).toFixed(4),
    bustInSession: +(S.filter((s) => s.bust).length / n).toFixed(4),
    hitRate: +(ev / shots.reduce((a, b) => a + b, 0)).toFixed(4),
    winMultMed: pct(ws, 0.5), winMultP90: pct(ws, 0.9),
    perceivedHitsPerCredit: +(bh / (W / 100)).toFixed(3),
    serverShotsPerMin: RATE * 60, // one settle per trigger in every candidate
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] || "all", n = +(process.argv[3] || 10000), seed = +(process.argv[4] || 20261125);
  const names = which === "all" ? Object.keys(CANDIDATES) : which.split(",");
  const opts = { base: +(process.env.BASE || 10), tier: +(process.env.TIER || 5) };
  const out = names.map((k) => { const t = Date.now(); const r = run(k, n, seed, opts); r.base = opts.base; r.tier = opts.tier; r.ms = Date.now() - t; console.log(JSON.stringify(r)); return r; });
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
}
