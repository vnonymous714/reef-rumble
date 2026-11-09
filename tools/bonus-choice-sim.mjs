import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../bonus-choice-math.js');

const HOUSE0 = 200000; // 2000.00
const PLAYERS = 50;
const REPS = 100;
const SHOTS = 1000;
const STAKE = 100; // 1.00
const fishR = 0.91;

function run(boost) {
  let neg = 0, minEnd = Infinity, maxDd = 0;
  const ends = [];
  for (let r = 0; r < REPS; r++) {
    let house = HOUSE0, peak = HOUSE0;
    for (let p = 0; p < PLAYERS; p++) {
      let lastBonus = -1e20;
      for (let s = 0; s < SHOTS; s++) {
        house += STAKE; // player wager
        const win = Math.random() < fishR ? Math.round(STAKE * (0.5 + Math.random())) : 0;
        // crude fish return sample; real combat sim remains source of stake RTP
        house -= Math.min(40000, win);
        const relicChance = boost ? 0.02 : 0.002; // semi-rare vs boost
        if (Math.random() < relicChance && s * 1000 - lastBonus >= M.BONUS_COOLDOWN_MS) {
          lastBonus = s * 1000;
          // pick game uniformly; EV approx
          const pick = Math.floor(Math.random() * 3);
          let pay = 0;
          if (pick === 0) pay = M.choiceWheelPayout(STAKE, M.choiceWheelPick(Math.random)).pay;
          else if (pick === 1) {
            const layout = M.shuffleMults(Math.random);
            pay = M.chestPayout(STAKE, Math.floor(Math.random() * 3), layout).pay;
          } else pay = M.tapPayout(STAKE, 80 + Math.floor(Math.random() * 80)).pay;
          house -= pay;
        }
      }
    }
    ends.push(house);
    if (house < HOUSE0) neg++;
    minEnd = Math.min(minEnd, house);
    maxDd = Math.max(maxDd, HOUSE0 - house);
  }
  ends.sort((a, b) => a - b);
  return {
    boost,
    reps: REPS,
    players: PLAYERS,
    shots: SHOTS,
    stake: STAKE,
    negativeBatches: neg,
    minEndingHouse: minEnd / 100,
    maxDrawdown: maxDd / 100,
    medianEndingHouse: ends[Math.floor(ends.length / 2)] / 100,
    choiceWheelEV: M.choiceWheelEV(),
    chestEV: (2 + 5 + 10) / 3,
    tapEV_at_8tps: M.tapMultiplier(160)
  };
}

const out = {
  notes: [
    'Addon stress on top of fish RTP≈91%: one Relic pick / 12h max; chest EV 5.667× stake, wheel EV≈2.15×, tap ~3–5× at human rates.',
    'Normal spawn ~0.2%/shot; 72h boost ~2%/shot in this synthetic model (not live director frequency).',
    'Existing combat-v2-simulation.json remains the stake/tier RTP source; this isolates bonus-choice bankroll pressure.'
  ],
  normal: run(false),
  boost72h: run(true),
  xp: {
    old: M.WPN_XP_OLD,
    neu: M.WPN_XP,
    playMinutesAt1CreditPerSec: {
      lv2: M.WPN_XP[1] / 1.91 / 60,
      lv5: M.WPN_XP[4] / 1.91 / 60,
      lv10: M.WPN_XP[9] / 1.91 / 60
    }
  }
};
console.log(JSON.stringify(out, null, 2));
