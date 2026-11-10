import {RECEIPT_KEEP, actionId, actionSequence, digest, compactDetail, compactAccount} from "./retention.js";
import motion from "../../reef-motion.js";
import pickups from "../../reef-laser-pickups.js";
import * as director from "./director-v2.js";
import legacy from "../../engine.js";
/* Isolated authoritative candidate. Route is feature-gated; never enable before
   migration/QA. Server owns fish, damage, offers, daily results and balances. */
import { jackpotAward, attack, profile, engage, MAX_BASE_STAKE, MIN_BASE_STAKE, MAX_AWARD } from "./combat-math.js";
import { uniform, dayKey, dailyReward } from "./reward-math.js";
import * as BonusChoice from "./bonus-choice.js";
import bonus from "../../bonusmath.js";
import { PROTECTED_TG_ID } from "./tg.js";
import * as WeeklyBoard from "./weekly-board.js";
const error = (s, status = 400) => Object.assign(new Error(s), { status });
const defs = [
  ["minnow", 2],
  ["guppy", 3],
  ["darter", 4],
  ["pebble", 5],
  ["tang", 6],
  ["lantern", 8],
  ["jelly", 10],
  ["turtle", 15],
  ["ray", 20],
  ["sword", 30],
  ["shark", 40],
  ["koi", 50],
  ["whale", 80],
  ["bomb", 15],
  ["eel", 12],
  ["chest", 12],
  ["laser", 18],
  ["kraken", 100],
  ["dragon", 200],
];
const money = (n) => Number.isSafeInteger(n) && n >= 0;
export function periodAt(now) {
  return Math.floor(now / 60000) % 30 < 5 ? 88 : 92;
}
function fresh(now, rng) {
  const fishes = director.initial(
    now,
    () => uniform(4294967296, rng) / 4294967296,
  );
  return {
    fishes,
    serial: 12,
    director: {
      spawn: now,
      boss: now + 35000,
      tide: now + 80000,
      quiet: 0,
      wave: 0,
    },
    jp: 25000,
    style: "normal",
    styleUntil: 0,
    cooldownUntil: 0,
    laserUntil: 0,
    lastShot: 0,
    lastDaily: null,
    streak: 0,
    offers: [],
    bonusFishBoostUntil: 0,
    _lastBonusPick: 0,
    pausedAt: 0,
    projectiles: [],
    lastRefill: 0,
    resultPending: false,
  };
}
function snapshot(a, w, now) {
  return {
    owner: a.public_id,
    balance: a.balance,
    bonus: a.bonus,
    pt: a.pt,
    seq: a.sync_seq,
    world: w,
    period: periodAt(now),
    now,
    profiles: Array.from({ length: 10 }, (_, i) => profile(i + 1)),
    daily: { due: w.lastDaily !== dayKey(now), day: dayKey(now) },
    wXp: a.w_xp || 0,
    weaponLevel: BonusChoice.levelFromXp(a.w_xp || 0),
    bonusCooldownMs: BonusChoice.cooldownRemainingMs(a.last_bonus_pick || 0, now),
    bonusFishBoostUntil: w.bonusFishBoostUntil || 0,
    apiVersion: 2,
    receiptProtocol: 3,
    receiptWindow: RECEIPT_KEEP,
    receiptFloor: a.receipt_floor || 0,
  };
}
function clean(w, now, rng) {
  if (w.pausedAt) return [];
  const escaped = w.fishes
    .filter((f) => !f.dead && f.expires <= now && f.lock)
    .map((f) => ({
      id: f.id,
      pay: Math.round(((f.maxHp - f.hp) / f.lock.hpUnit) * f.lock.stake * (f.lock.payoutFactor || 1)),
    }));
  w.fishes = w.fishes.filter((f) => !f.dead && f.expires > now);
  pickups.tick(w, now, () => uniform(4294967296, rng) / 4294967296);
  director.tick(w, now, () => uniform(4294967296, rng) / 4294967296);
  w.offers = w.offers.filter((o) => o.expires > now && !o.consumed);
  return escaped;
}
function resumeWorld(w, now) {
  const paused = w.pausedAt ? now - w.pausedAt : 0;
  director.shift(w, paused);
  pickups.shift(w, paused);
  for (const f of w.fishes) {
    f.expires += paused;
    f.born += paused;
  }
  for (const b of w.projectiles || []) {
    b.born += paused;
    b.at += paused;
  }
  if (w.laserUntil) w.laserUntil += paused;
  if (w.styleUntil) w.styleUntil += paused;
  if (w.cooldownUntil) w.cooldownUntil += paused;
  w.pausedAt = 0;
}
function settleCollision(w, b, collision, rng) {
  const R = b.period === 88 ? 0.87 : 0.91,
    primary = w.fishes.find((f) => f.id === collision.target && !f.dead);
  if (!primary) return { paid: b.stake, refund: b.stake };
  let drill = null;
  const pool = (() => {
    if (b.style === "laser") {
      const ids = new Set(motion.ray(b, w.fishes, collision.at).map((f) => f.id));
      return w.fishes.filter((f) => f.id === primary.id || ids.has(f.id));
    }
    if (primary.kind === "drill") {
      drill = motion.drillCorridor(primary, w.fishes, collision.at, b.board, {
        range: legacy.DRILL_RANGE,
        width: legacy.DRILL_WIDTH,
        blast: legacy.DRILL_BLAST,
      });
      return [primary, ...drill.pierced, ...drill.blasted];
    }
    return w.fishes.filter((f) => {
      if (f.id === primary.id) return true;
      const p = motion.point(f, collision.at, b.board.width, b.board.height),
        q = motion.point(primary, collision.at, b.board.width, b.board.height);
      return (
        Math.hypot(p.x - q.x, p.y - q.y) <
        (primary.kind === "bomb" ? legacy.BOMB_RADIUS : legacy.CHAIN_RADIUS)
      );
    });
  })();
  const result = attack(
      pool,
      primary.id,
      b.base,
      b.tier,
      b.style,
      R,
      () => uniform(4294967296, rng) / 4294967296,
    ),
    byId = new Map(result.fishes.map((f) => [f.id, f]));
  w.fishes = w.fishes.map((f) => byId.get(f.id) || f);
  let paid = result.payout;
  w.jpCarry = (w.jpCarry || 0) + b.stake;
  w.jp = Math.min(40000, w.jp + Math.floor(w.jpCarry / 100));
  w.jpCarry %= 100;
  const jackpot = jackpotAward(
    result.updates,
    b.style,
    b.stake,
    w.jp,
    uniform(4294967296, rng) / 4294967296,
  );
  if (jackpot) {
    paid += jackpot;
    w.jp = 25000;
  }
  const events = {
    id: b.id,
    kind: "collision",
    at: collision.at,
    x: collision.x / b.board.width,
    y: collision.y / b.board.height,
    style: b.style,
    stake: b.stake,
    jackpot,
    updates: result.updates.map((r) => ({
      id: r.target.id,
      damage: r.damage,
      hp: r.target.hp,
      maxHp: r.target.maxHp,
      prize: r.prize,
      dead: r.target.dead,
      kind: r.target.kind,
      art: r.target.art,
      boss: !!r.target.boss,
      mult: r.target.mult,
      spent: r.spent || r.target.spent || 0,
    })),
  };
  if (drill) events.drill = {
    end: { x: drill.end.x / b.board.width, y: drill.end.y / b.board.height },
    pierced: drill.pierced.map((f) => f.id),
    blasted: drill.blasted.map((f) => f.id),
  };
  events.bossIds = result.updates.filter((r) => r.target.dead && r.target.boss).map((r) => r.target.art);
  for (const r of result.updates.filter((r) => r.target.dead)) {
    if (r.target.kind === "temple") {
      const id = "offer_" + r.target.id;
      w.offers.push({
        id,
        source: r.target.id,
        expires: collision.at + 120000,
        consumed: false,
      });
      events.offer = id;
    }
    if (r.target.kind === "bonuspick") {
      if (BonusChoice.onCooldown(w._lastBonusPick || 0, collision.at)) {
        events.bonusCooldownMs = BonusChoice.cooldownRemainingMs(w._lastBonusPick || 0, collision.at);
      } else {
        const offer = BonusChoice.makeBonusOffer(r.target, collision.at);
        if (offer) { w.offers.push(offer); events.bonusOffer = offer.id; events.bonusStake = offer.stake; }
      }
    }
    if (r.target.kind === "laser") pickups.start(w, collision.at);
  }
  return { paid, refund: 0, event: events };
}
function advanceProjectiles(w, now, rng) {
  const result = { paid: 0, refunds: 0, consumed:0,refundsByPeriod:{}, events: [] };
  if (w.pausedAt) return result;
  w.projectiles ??= [];
  for (const b of w.projectiles) {
    let steps = 0;
    while (b.at < now && !b.done && steps++ < 430) {
      const event = motion.step(b, w.fishes, Math.min(now, b.at + 1000 / 60));
      if (!event) continue;
      b.done = true;
      if (event.kind === "refund") {
        result.paid += b.stake;
        result.refunds += b.stake;
        result.refundsByPeriod[b.period]=(result.refundsByPeriod[b.period]||0)+b.stake;
        result.events.push({ id: b.id, kind: "refund", stake: b.stake,period:b.period });
      } else {
        const settled = settleCollision(w, b, event, rng);
        result.paid += settled.paid;
        result.refunds += settled.refund;if(settled.refund)result.refundsByPeriod[b.period]=(result.refundsByPeriod[b.period]||0)+settled.refund;
        if (settled.event){result.consumed+=b.stake;result.events.push(settled.event);}
      }
    }
  }
  w.projectiles = w.projectiles.filter((b) => !b.done);
  return result;
}
function issueQuotes(a, offer, now) {
  const period = periodAt(now);
  offer.quotes = [1, 5, 10].map((tier) => ({
    id: crypto.randomUUID(),
    offerId: offer.id,
    source: offer.source,
    tier,
    stake: bonus.stakeFor(a.balance, tier),
    balance: a.balance,
    accountSeq: a.sync_seq + 1,
    period,
    paytable: "temple-v1",
    cap: 40000,
    expiresAt: now + 30000,
  }));
}
const MAX_LAUNCH_BATCH = 8;
const LAUNCH_AT_SKEW = 80;
const LAUNCH_AT_PAST = 2500;
function replayRng(recorded, rng) {
  let i = 0;
  return () => (i < recorded.length ? recorded[i++] : rng());
}
function recordRng(rng) {
  const recorded = [];
  const play = () => {
    const n = rng();
    recorded.push(n);
    return n;
  };
  play.recorded = recorded;
  return play;
}
function normalizeShots(body) {
  if (Array.isArray(body.shots)) {
    if (!body.shots.length || body.shots.length > MAX_LAUNCH_BATCH)
      throw error("invalid launch");
    return body.shots.map((s, i) => ({
      id: s.id || (i === 0 ? body.id : null),
      angle: s.angle ?? body.angle,
      target: s.target ?? body.target,
      baseStake: s.baseStake ?? body.baseStake,
      tier: s.tier ?? body.tier,
      board: s.board ?? body.board,
      at: s.at,
    }));
  }
  return [
    {
      id: body.id,
      angle: body.angle,
      target: body.target,
      baseStake: body.baseStake,
      tier: body.tier,
      board: body.board,
      at: body.at,
    },
  ];
}
function resolvedShotAt(shot, now, lastShot, laserUntil) {
  const at = shot.at == null ? now : shot.at;
  if (!Number.isSafeInteger(at)) throw error("invalid shot time");
  if (at > now + LAUNCH_AT_SKEW || at < now - LAUNCH_AT_PAST)
    throw error("invalid shot time");
  const cool = at < (laserUntil || 0) ? 90 : 165;
  if (at - lastShot < cool) throw error("weapon cooling down", 429);
  return at;
}
function launchProfile(w, shot, at) {
  const primary = shot.target
    ? w.fishes.find((f) => f.id === shot.target && !f.dead)
    : null;
  if (shot.target && !primary) throw error("unavailable target");
  let p;
  try {
    p = primary
      ? engage(primary, shot.baseStake, shot.tier, periodAt(at) === 88 ? 0.87 : 0.91).lock
      : {
          ...profile(shot.tier, shot.baseStake),
          stake: Math.round(shot.baseStake * profile(shot.tier).costFactor),
          payoutFactor: 1,
        };
  } catch (e) {
    throw error(e.message);
  }
  if (
    !Number.isSafeInteger(shot.baseStake) ||
    shot.baseStake < MIN_BASE_STAKE ||
    shot.baseStake > MAX_BASE_STAKE
  )
    throw error("invalid base stake");
  return { primary, p };
}
function appendLaunch(w, shot, now, spendable, rng) {
  const at = resolvedShotAt(shot, now, w.lastShot, w.laserUntil);
  if ((w.projectiles || []).length >= 24) throw error("projectile limit", 429);
  const { primary, p } = launchProfile(w, shot, at);
  if (spendable < p.stake) throw error("insufficient credits");
  const style =
    at < w.laserUntil ? "laser" : at < w.styleUntil ? w.style : "normal";
  const id = shot.id;
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(id || "")) throw error("invalid action id");
  let b;
  try {
    b = motion.launch(
      id,
      shot.angle,
      shot.target,
      shot.board,
      at,
      p.stake,
      p.tier || shot.tier,
      primary?.lock?.baseStake ??
        (primary?.lock ? Math.round(p.stake / p.costFactor) : shot.baseStake),
      style,
      periodAt(at),
    );
  } catch (e) {
    throw error(e.message);
  }
  if (style === "laser") {
    const along = motion
      .ray(b, w.fishes, at)
      .filter(
        (f) =>
          f.mult * p.stake <= 40000 &&
          (!f.lock || (f.lock.stake === p.stake && f.lock.tier === p.tier)),
      );
    w.lastShot = at;
    if (!along.length) {
      return { stake: 0, launch: null, beam: null, paid: 0, spendable, laserSeconds: pickups.collect(w, b, at) };
    }
    const target = along[0],
      pos = motion.point(target, at, b.board.width, b.board.height);
    const result = settleCollision(
      w,
      b,
      { target: target.id, at, x: pos.x, y: pos.y },
      rng,
    );
    w.lastShot = at;
    return {
      stake: p.stake,
      launch: null,
      beam: { ...b, target: target.id },
      paid: result.paid,
      spendable: spendable - p.stake + result.paid,
      event: result.event,
      laserSeconds: pickups.collect(w, b, at),
    };
  }
  w.projectiles ??= [];
  w.projectiles.push(b);
  w.lastShot = at;
  return { stake: p.stake, launch: b, beam: null, paid: 0, spendable: spendable - p.stake };
}

function assertLaunchable(w, shot, now, spendable) {
  const at = resolvedShotAt(shot, now, w.lastShot, w.laserUntil);
  if ((w.projectiles || []).length >= 24) throw error("projectile limit", 429);
  const { p } = launchProfile(w, shot, at);
  if (spendable < p.stake) throw error("insufficient credits");
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(shot.id || "")) throw error("invalid action id");
  const style =
    at < w.laserUntil ? "laser" : at < w.styleUntil ? w.style : "normal";
  motion.launch(
    shot.id,
    shot.angle,
    shot.target,
    shot.board,
    at,
    p.stake,
    p.tier || shot.tier,
    shot.baseStake,
    style,
    periodAt(at),
  );
  w.lastShot = at;
  if (style !== "laser") (w.projectiles ??= []).push({ id: shot.id });
  return spendable - p.stake;
}

function apply(a, w, body, now, rng, skipFlight=false) {
  const command = body.command;
  const flight = skipFlight?{paid:0,refunds:0,consumed:0,events:[]}:advanceProjectiles(w, now, rng);
  const escaped = clean(w, now, rng);
  let wager = 0,
    paid = flight.paid + escaped.reduce((s, f) => s + f.pay, 0),
    detail = { escaped, motion: flight.events, refunds: flight.refunds,consumed:flight.consumed,refundsByPeriod:flight.refundsByPeriod||{},flightPaid:flight.paid };
  if (command === "state") {
    if (!money(paid)) throw error("invalid escape settlement");
    return { w, wager, paid, detail };
  }
  if (command === "activate") {
    if (
      !["arc", "plasma"].includes(body.style) ||
      now < w.cooldownUntil ||
      w.pausedAt ||
      now < w.laserUntil
    )
      throw error("special unavailable");
    w.style = body.style;
    w.styleUntil = now + 6000;
    w.cooldownUntil = now + 18000;
  } else if (command === "pause") {
    if (w.pausedAt) throw error("already paused");
    if (!w.offers.some((o) => o.id === body.offer && !o.consumed))
      throw error("offer unavailable");
    w.pausedAt = now;
    issueQuotes(
      a,
      w.offers.find((o) => o.id === body.offer),
      now,
    );
  } else if (command === "quote") {
    const offer = w.offers.find(
      (o) =>
        o.id === body.offer && !o.consumed && o.expires > (w.pausedAt || now),
    );
    if (!offer || !w.pausedAt) throw error("open an eligible offer first");
    issueQuotes(a, offer, now);
  } else if (command === "skip" || command === "spin") {
    const offer = w.offers.find(
      (o) =>
        o.id === body.offer && !o.consumed && o.expires > (w.pausedAt || now),
    );
    if (!offer) throw error("offer unavailable");
    if (command === "spin") {
      const quote = offer.quotes?.find((q) => q.id === body.quoteId);
      if (
        !quote ||
        quote.expiresAt <= now ||
        quote.balance !== a.balance ||
        quote.accountSeq !== a.sync_seq ||
        quote.period !== periodAt(now) ||
        quote.paytable !== "temple-v1" ||
        quote.cap !== 40000 ||
        quote.offerId !== offer.id ||
        quote.source !== offer.source
      )
        throw error("quote changed or expired: refresh and reconfirm", 409);
      const stake = quote.stake;
      if (!bonus.validStake(stake) || stake > a.balance)
        throw error("quoted stake unavailable", 409);
      const result = bonus.outcome(
        uniform(200, rng),
        uniform(5, rng),
        stake,
        quote.period,
      );
      result.quoteId = quote.id;
      result.paytable = quote.paytable;
      wager = stake;
      paid += result.pay;
      detail.bonus = result;
    }
    offer.consumed = true;
    if (command === "spin") {
      w.resultPending = true;
      w.lastBonus = detail.bonus;
    } else resumeWorld(w, now);
  } else if (command === "resume") {
    if (!w.resultPending || !w.pausedAt)
      throw error("no settled bonus to acknowledge");
    w.resultPending = false;
    resumeWorld(w, now);
  } else if (command === "daily") {
    if (w.lastDaily === dayKey(now)) throw error("already claimed", 409);
    const reward = dailyReward(
      dayKey(now),
      w.lastDaily,
      w.streak,
      uniform(200, rng),
    );
    w.lastDaily = reward.day;
    w.streak = reward.streak;
    paid += reward.pay;
    detail.daily = reward;
  } else if (command === "launch") {
    if (w.pausedAt) throw error("bonus is open");
    const shots = normalizeShots(body);
    let spendable = a.balance + paid;
    const launches = [];
    let launchPaid = 0;
    for (const shot of shots) {
      const one = appendLaunch(w, shot, now, spendable, rng);
      spendable = one.spendable;
      wager += one.stake;
      launchPaid += one.paid;
      paid += one.paid;
      if (one.event) detail.motion.push(one.event);
      if (one.laserSeconds) detail.laserSeconds = (detail.laserSeconds || 0) + one.laserSeconds;
      if (one.beam) detail.beam = one.beam;
      if (one.launch) {
        launches.push(one.launch);
        detail.launch = one.launch;
      }
    }
    detail.launches = launches;
    detail.launchPaid = launchPaid;
  } else if (command === "attack") {
    if (w.pausedAt) throw error("bonus is open");
    const laser = now < w.laserUntil;
    if (now - w.lastShot < (laser ? 90 : 160))
      throw error("weapon cooling down", 429);
    const style = laser ? "laser" : now < w.styleUntil ? w.style : "normal";
    let result;
    try {
      result = attack(
        w.fishes,
        body.target,
        body.baseStake,
        body.tier,
        style,
        periodAt(now) === 88 ? 0.87 : 0.91,
        () => uniform(4294967296, rng) / 4294967296,
      );
    } catch (e) {
      if (
        /invalid base stake|invalid tier|unavailable target|lower stake/.test(
          e.message,
        )
      )
        throw error(e.message);
      throw e;
    }
    if (a.balance < result.cost) throw error("insufficient credits");
    wager = result.cost;
    paid += result.payout;
    w.fishes = result.fishes;
    w.lastShot = now;
    w.jpCarry = (w.jpCarry || 0) + wager;
    w.jp = Math.min(40000, w.jp + Math.floor(w.jpCarry / 100));
    w.jpCarry %= 100;
    const jackpot = jackpotAward(
      result.updates,
      style,
      wager,
      w.jp,
      uniform(4294967296, rng) / 4294967296,
    );
    if (jackpot) {
      paid += jackpot;
      detail.jackpot = jackpot;
      w.jp = 25000;
    }
    detail.attack = {
      style,
      cost: wager,
      stake: result.lockedStake,
      tier: result.lockedTier,
      updates: result.updates.map((x) => ({
        id: x.target.id,
        damage: x.damage,
        probability: x.probability,
        hp: x.target.hp,
        maxHp: x.target.maxHp,
        prize: x.prize,
        dead: x.target.dead,
        kind: x.target.kind,
        art: x.target.art,
        boss: !!x.target.boss,
        mult: x.target.mult,
        spent: x.spent || x.target.spent || 0,
      })),
    };
    detail.bossIds = result.updates.filter((r) => r.target.dead && r.target.boss).map((r) => r.target.art);
    for (const r of result.updates.filter((r) => r.target.dead)) {
      if (r.target.kind === "temple") {
        const id = "offer_" + r.target.id;
        w.offers.push({
          id,
          source: r.target.id,
          expires: now + 120000,
          consumed: false,
        });
        detail.offer = id;
      }
      if (r.target.kind === "bonuspick") {
        if (BonusChoice.onCooldown(w._lastBonusPick || 0, now)) {
          detail.bonusCooldownMs = BonusChoice.cooldownRemainingMs(w._lastBonusPick || 0, now);
        } else {
          const offer = BonusChoice.makeBonusOffer(r.target, now);
          if (offer) { w.offers.push(offer); detail.bonusOffer = offer.id; detail.bonusStake = offer.stake; }
        }
      }
      if (r.target.kind === "laser") pickups.start(w, now);
    }
  } else if (command === "bonus_chest" || command === "bonus_wheel" || command === "bonus_tap_start" || command === "bonus_tap_finish") {
    const offer = w.offers.find((o) => o.id === body.offer && o.kind === "bonus_choice" && !o.consumed && o.expires > now);
    if (!offer) throw error("bonus offer unavailable");
    if (BonusChoice.onCooldown(w._lastBonusPick || 0, now) && command !== "bonus_tap_finish") throw error("bonus cooling down");
    if (command === "bonus_tap_start") {
      offer.tapStartedAt = now;
      detail.tap = { startedAt: now, seconds: BonusChoice.TAP_SECONDS, stake: offer.stake };
    } else if (command === "bonus_tap_finish") {
      if (!offer.tapStartedAt) throw error("tap not started");
      const tap = BonusChoice.resolveTap(offer, body.taps || [], now);
      offer.consumed = true;
      w._lastBonusPick = now;
      paid += tap.pay;
      detail.tap = { ...tap, pick: "tap" };
      detail.bonusPick = "tap";
    } else if (command === "bonus_chest") {
      const rng01 = () => uniform(4294967296, rng) / 4294967296;
      const chest = BonusChoice.resolveChest(offer, body.pick, rng01);
      offer.consumed = true;
      w._lastBonusPick = now;
      paid += chest.pay;
      detail.chest = { ...chest, pick: body.pick };
      detail.bonusPick = "chest";
    } else if (command === "bonus_wheel") {
      const rng01 = () => uniform(4294967296, rng) / 4294967296;
      const bonusWheel = BonusChoice.resolveWheel(offer, rng01);
      offer.consumed = true;
      w._lastBonusPick = now;
      paid += bonusWheel.pay;
      detail.bonusWheel = bonusWheel;
      detail.bonusPick = "wheel";
    }
  } else throw error("unknown command");
  if (!money(wager) || !money(paid)) throw error("invalid settlement");
  return { w, wager, paid, detail };
}
async function gameV2Core(
  env,
  accountId,
  body,
  now = Date.now(),
  rng = () => crypto.getRandomValues(new Uint32Array(1))[0],
  options={},
) {
  if (env.GAME_V2 !== "1") throw error("candidate disabled", 404);
  const db = env.DB;
  let a = await db
    .prepare("SELECT * FROM accounts WHERE id=?1")
    .bind(accountId)
    .first();
  if (!a || a.tg_id === PROTECTED_TG_ID)
    throw error("protected or missing account", 403);
  if(options.expectedSequence!==undefined&&a.sync_seq!==options.expectedSequence)throw error("stale account sequence",409);
  if (
    !body ||
    ![
      "state",
      "activate",
      "launch",
      "resume",
      "quote",
      "pause",
      "skip",
      "spin",
      "daily",
      "attack",
      "bonus_chest",
      "bonus_tap_start",
      "bonus_tap_finish",
      "bonus_wheel",
    ].includes(body.command)
  )
    throw error("unknown command");
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(body.id || ""))
    throw error("invalid action id");
  const legacyCanonical = JSON.stringify({
    command: body.command,
    target: body.target,
    baseStake: body.baseStake,
    tier: body.tier,
    style: body.style,
    offer: body.offer,
    quoteId: body.quoteId,
    angle: body.angle,
    board: body.board,
    ...(body.shots ? { shots: body.shots } : {}),
    ...(body.at != null ? { at: body.at } : {}),
  });
  const canonical = "h3:" + await digest(JSON.stringify([options.intentSeq ?? body.seq,legacyCanonical]));
  const replay = await db
    .prepare(
      "SELECT request_json,response_json,status FROM economy_actions WHERE account_id=?1 AND id=?2",
    )
    .bind(accountId, body.id)
    .first();
  if (replay) {
    if(replay.status!=='settled') throw error('receipt_pending: reconciliation required',409);
    if (replay.request_json !== canonical && replay.request_json !== legacyCanonical) throw error("action id reused");
    const receipt = JSON.parse(replay.response_json);
    return {
      ...(await currentSnapshot(db, accountId, now)),
      detail: receipt.detail,
      settled: { balance: receipt.balance, seq: receipt.seq },
      replayed: true,
    };
  }
  const origin = actionSequence(body.id);
  const intentSeq = options.intentSeq ?? body.seq;
  const retired = await db.prepare('SELECT floor_seq FROM economy_retention WHERE account_id=?').bind(accountId).first();
  if (origin !== null && origin < (retired?.floor_seq || 0))
    throw Object.assign(error('receipt_expired: no action reapplied; refresh confirmed state',410),{code:'receipt_expired'});
  if (origin === null || origin !== intentSeq) throw error('invalid action sequence; reload upgraded client');
  if (body.recoverOnly)
    throw error("Action was not accepted; retry manually", 409);
  a.receipt_floor=retired?.floor_seq||0;
  if (body.seq !== a.sync_seq) throw error('stale account sequence',409);
  let row = await db
    .prepare("SELECT * FROM economy_world WHERE account_id=?1")
    .bind(accountId)
    .first();
  const w = row ? JSON.parse(row.state_json) : fresh(now, rng),
    version = row ? row.version : 0;
  if (!row) {
    const day = dayKey(now);
    w.lastRefill = a.last_refill || 0;
    w.lastDaily = [day, new Date(now).toISOString().slice(0, 10)].includes(
      a.last_daily,
    )
      ? day
      : a.last_daily || null;
  }
  w._lastBonusPick = a.last_bonus_pick || w._lastBonusPick || 0;
  const boostRow = await db.prepare("SELECT value FROM economy_config WHERE key='bonus_fish_boost_until'").first();
  w.bonusFishBoostUntil = Number(boostRow?.value) || w.bonusFishBoostUntil || 0;
  const xpState = BonusChoice.ensureXpCurve(a);
  a.w_xp = xpState.w_xp;
  a.xp_curve = xpState.xp_curve;
  const result = apply(a, w, body, now, rng,options.skipFlight);
  const bossIds = [
    ...(result.detail?.bossIds || []),
    ...((result.detail?.motion || []).flatMap((ev) =>
      (ev.updates || [])
        .filter((u) => u.dead && u.boss)
        .map((u) => u.art)
        .filter(Boolean),
    )),
  ];
  const xp = BonusChoice.applySettlementXp(a, { wager: result.wager, paid: result.paid, bossIds });
  const catchUpdates = [
    ...(result.detail?.attack?.updates || []),
    ...((result.detail?.motion || []).flatMap((ev) => ev.updates || [])),
  ];
  const catchTally = WeeklyBoard.tallyCatches(catchUpdates);
  const next = {
      ...a,
      balance: a.balance - result.wager + result.paid,
      pt: Math.max(
        0,
        Math.min(
          a.bonus * 10,
          a.pt + (result.detail.consumed||0) + (["attack","spin"].includes(body.command)?result.wager:result.detail.beam?result.wager:0),
        ),
      ),
      w_xp: xp.w_xp,
      xp_curve: 2,
      last_bonus_pick: result.w._lastBonusPick || a.last_bonus_pick || 0,
      sync_seq: a.sync_seq + 1,
    };
  result.detail.xpGain = xp.gain;
  const response = { ...snapshot(next, result.w, now), detail: result.detail };
  if (
    body.command === "state" &&
    row &&
    !result.paid &&
    JSON.stringify(result.w) === row.state_json
  )
    return { ...snapshot(a, result.w, now), detail: result.detail };
  const attempt = crypto.randomUUID();
  const receipt = {
    attempt,
    balance: next.balance,
    seq: next.sync_seq,
    detail: compactDetail(result.detail),
  };
  // CAS on BOTH account balance sequence and authoritative world version.
  const insert = db
    .prepare(
      `INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at)
  SELECT ?1,?2,?3,?4,?5,'pending',?6,?7,?8 FROM accounts a WHERE a.id=?1 AND a.sync_seq=?5 AND a.balance=?11 AND a.bonus=?12 AND a.pt=?13 AND (a.tg_id IS NULL OR a.tg_id<>?9)
  AND COALESCE((SELECT version FROM economy_world WHERE account_id=?1),0)=?10 ON CONFLICT DO NOTHING`,
    )
    .bind(
      accountId,
      body.id,
      canonical,
      JSON.stringify(receipt),
      a.sync_seq,
      result.wager,
      result.paid,
      now,
      PROTECTED_TG_ID,
      version,
      a.balance,
      a.bonus,
      a.pt,
    );
  const guard =
    "EXISTS(SELECT 1 FROM economy_actions e WHERE e.account_id=?1 AND e.id=?2 AND e.status='pending' AND e.expected_seq=accounts.sync_seq)";
  const pending =
    "EXISTS(SELECT 1 FROM economy_actions e JOIN accounts a ON a.id=e.account_id WHERE e.account_id=?1 AND e.id=?2 AND e.status='pending' AND a.sync_seq=e.expected_seq+1)";
  const refundRows=Object.entries(result.detail.refundsByPeriod||{}).filter(([,amount])=>amount>0).map(([period,amount])=>db.prepare(`INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,wager_refund,rtp_period,account_seq) SELECT ?1,?3,'wager_refund',0,0,?4,?5,?6,?7,?8 WHERE ${pending}`).bind(accountId,body.id,body.id+':refund:'+period,next.balance,now,amount,Number(period),next.sync_seq));
  const shotRows=[];
  const launches=result.detail.launches||[];
  if(body.command==='launch' && launches.length>1){
    // Shot 0 stays on the primary action_id row. Extra shots get :shot:N so
    // accounting_events counts n=1 per projectile without double-charging the parent.
    let running=a.balance + (result.detail.flightPaid||0) + (result.detail.escaped||[]).reduce((s,f)=>s+f.pay,0) - (result.detail.refunds||0) - launches[0].stake + (result.detail.launchPaid||0);
    for(let i=1;i<launches.length;i++){
      running -= launches[i].stake;
      shotRows.push(db.prepare(`INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,gaming_payout,promo_credit,rtp_period,account_seq,wager_refund) SELECT ?1,?3,'launch',?4,0,?5,?6,0,0,?7,?8,0 WHERE ${pending}`).bind(accountId,body.id,body.id+':shot:'+i,launches[i].stake,running,now,launches[i].period||periodAt(now),next.sync_seq));
    }
  }
  const flightPay=(result.detail.flightPaid||0)+(result.detail.escaped||[]).reduce((s,f)=>s+f.pay,0);
  const flightRow=body.command==='launch' && flightPay
    ? [db.prepare(`INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,gaming_payout,promo_credit,rtp_period,account_seq,wager_refund) SELECT ?1,?3,'state',0,?4,?5,?6,?7,0,?8,?9,0 WHERE ${pending}`).bind(accountId,body.id,body.id+':flight',flightPay,next.balance,now,flightPay-(result.detail.refunds||0),periodAt(now),next.sync_seq)]
    : [];
  await db.batch([
    insert,
    db
      .prepare(
        `UPDATE accounts SET balance=?3,pt=?4,last_daily=?5,last_refill=?6,w_xp=?7,last_bonus_pick=?8,xp_curve=?9,sync_seq=sync_seq+1 WHERE id=?1 AND ${guard}`,
      )
      .bind(
        accountId,
        body.id,
        next.balance,
        next.pt,
        result.w.lastDaily,
        result.w.lastRefill || 0,
        next.w_xp || 0,
        next.last_bonus_pick || 0,
        next.xp_curve || 2,
      ),
    db
      .prepare(
        `INSERT INTO economy_world(account_id,state_json,version,enrolled_at) SELECT ?1,?3,?4,?5 WHERE ${pending} ON CONFLICT(account_id) DO UPDATE SET state_json=excluded.state_json,version=excluded.version`,
      )
      .bind(accountId, body.id, JSON.stringify(result.w), version + 1, now),
    db
      .prepare(
        `UPDATE players SET balance=?3,pt=?4,sync_seq=?5,last_daily=?6,last_refill=?7 WHERE tg_id=(SELECT tg_id FROM accounts WHERE id=?1) AND ${pending}`,
      )
      .bind(
        accountId,
        body.id,
        next.balance,
        next.pt,
        next.sync_seq,
        result.w.lastDaily,
        result.w.lastRefill || 0,
      ),
    db
      .prepare(
        `INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,gaming_payout,promo_credit,rtp_period,account_seq,wager_refund) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12 WHERE ${pending}`,
      )
      .bind(
        accountId,
        body.id,
        body.command,
        body.command==='launch' && (result.detail.launches||[]).length
          ? result.detail.launches[0].stake
          : result.wager,
        body.command==='launch'
          ? (result.detail.launchPaid||0)
          : result.paid,
        body.command==='launch' && (result.detail.launches||[]).length>1
          ? a.balance + (result.detail.flightPaid||0) + (result.detail.escaped||[]).reduce((s,f)=>s+f.pay,0) - (result.detail.refunds||0) - result.detail.launches[0].stake + (result.detail.launchPaid||0)
          : next.balance,
        now,
        (body.command==='launch' ? (result.detail.launchPaid||0) : result.paid) -
          (result.detail.daily?.pay || 0) -
          (body.command==='launch' ? 0 : (result.detail.refunds || 0)),
        result.detail.daily?.pay || 0,
        periodAt(now),
        next.sync_seq,
        0,
      ),
    ...refundRows,
    ...shotRows,
    ...flightRow,
    ...((catchTally.bosses > 0 || catchTally.biggestMult > 0)
      ? [db.prepare(
          `INSERT INTO weekly_catch_stats(week_start, account_id, bosses, biggest_mult, updated_at)
           SELECT ?3, ?1, ?4, ?5, ?6 WHERE ${pending}
             AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=?1 AND IFNULL(a.tg_id,0)<>?7)
             AND lower(IFNULL((SELECT username FROM accounts WHERE id=?1),'')) NOT LIKE 'rrsmoke%'
             AND lower(IFNULL((SELECT username FROM accounts WHERE id=?1),'')) NOT LIKE 'rrdiag%'
             AND lower(IFNULL((SELECT public_id FROM accounts WHERE id=?1),'')) NOT LIKE 'rrsmoke%'
             AND lower(IFNULL((SELECT public_id FROM accounts WHERE id=?1),'')) NOT LIKE 'rrdiag%'
             AND lower(IFNULL((SELECT pid FROM accounts WHERE id=?1),'')) NOT LIKE 'rrsmoke%'
             AND lower(IFNULL((SELECT pid FROM accounts WHERE id=?1),'')) NOT LIKE 'rrdiag%'
           ON CONFLICT(week_start, account_id) DO UPDATE SET
             bosses = weekly_catch_stats.bosses + excluded.bosses,
             biggest_mult = MAX(weekly_catch_stats.biggest_mult, excluded.biggest_mult),
             updated_at = excluded.updated_at`,
        ).bind(accountId, body.id, WeeklyBoard.weekStartPt(now), catchTally.bosses, catchTally.biggestMult, now, PROTECTED_TG_ID)]
      : []),
    db
      .prepare(
        "UPDATE economy_actions SET status='settled' WHERE account_id=?1 AND id=?2 AND status='pending' AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=?1 AND a.sync_seq=economy_actions.expected_seq+1)",
      )
      .bind(accountId, body.id),
  ]);
  const committed = await db
    .prepare(
      "SELECT request_json,response_json FROM economy_actions WHERE account_id=?1 AND id=?2 AND status='settled'",
    )
    .bind(accountId, body.id)
    .first();
  if (!committed) throw error("concurrent account update; refresh", 409);
  if (committed.request_json !== canonical) throw error("action id reused");
  const saved = JSON.parse(committed.response_json);
  // The winning receipt (not this request's speculative RNG) is authoritative,
  // even when two devices concurrently submit the exact same action ID.
  return {
    ...(await currentSnapshot(db, accountId, now)),
    detail: saved.attempt===attempt ? result.detail : saved.detail,
    replayed: saved.attempt!==attempt,
    settled: { balance: saved.balance, seq: saved.seq },
  };
}
async function currentSnapshot(db, accountId, now) {
  const current = await db
    .prepare(
      "SELECT a.*,w.state_json,COALESCE(r.floor_seq,0) receipt_floor FROM accounts a JOIN economy_world w ON w.account_id=a.id LEFT JOIN economy_retention r ON r.account_id=a.id WHERE a.id=?1",
    )
    .bind(accountId)
    .first();
  return snapshot(current, JSON.parse(current.state_json), now);
}

// Reconcile already-paid physical outcomes in their OWN committed transaction.
// A losing collision must never be rolled back by invalid follow-up arguments.
async function gameV2Impl(env,accountId,body,now=Date.now(),rng=()=>crypto.getRandomValues(new Uint32Array(1))[0]) {
  if(env.GAME_V2!=='1'||!body) return gameV2Core(env,accountId,body,now,rng);
  const db=env.DB,a=await db.prepare('SELECT sync_seq,tg_id,balance FROM accounts WHERE id=?').bind(accountId).first();
  if(!a||a.tg_id===PROTECTED_TG_ID) throw error('protected or missing account',403);
  if(!Number.isSafeInteger(a.sync_seq)||a.sync_seq>=Number.MAX_SAFE_INTEGER-8)throw error('Sequence maintenance required',503);
  const row=await db.prepare('SELECT state_json FROM economy_world WHERE account_id=?').bind(accountId).first();
  // Bootstrap/reload discovery is read-only, including physical outcomes. The
  // next revision-bound state command commits any already-paid pending flight.
  if(body.command==='state' && body.seq===undefined && !body.recoverOnly) {
    // First paint used to be read-only. A world whose fish have all already
    // expired then reached the client empty and stayed empty if the follow-up
    // tick never ran (hidden tab, Telegram visibility, dropped refresh).
    const w = row ? JSON.parse(row.state_json) : null;
    const live = w?.fishes?.some((f) => !f.dead && f.expires > now);
    if (w && live) return currentSnapshot(db, accountId, now);
    return gameV2Core(env,accountId,{command:'state',seq:a.sync_seq,id:actionId(a.sync_seq)},now,rng);
  }
  const prior=await db.prepare('SELECT id FROM economy_actions WHERE account_id=? AND id=?').bind(accountId,String(body.id||'')).first();
  if(prior) return gameV2Core(env,accountId,body,now,rng);
  let retired=await db.prepare('SELECT floor_seq FROM economy_retention WHERE account_id=?').bind(accountId).first();
  const origin=actionSequence(body.id);
  if(origin!==null && origin<(retired?.floor_seq||0))
    throw Object.assign(error('receipt_expired: no action reapplied; refresh confirmed state',410),{code:'receipt_expired'});
  if(origin===null) throw error('invalid action sequence; reload upgraded client');
  if(a.sync_seq-(retired?.floor_seq||0)>RECEIPT_KEEP+32) {
    try { await compactAccount(db,accountId,now); }
    catch(e) {
      // Fail closed for new intent. Existing escrow can drain; idle polling
      // freezes read-only, so archive failure cannot create unbounded receipts.
      const w=row?JSON.parse(row.state_json):null;
      const due=w?.projectiles?.length || w?.fishes?.some(f=>!f.dead && f.hp<f.maxHp && f.expires<=now);
      if(body.command==='state' && !body.recoverOnly && w) {
        if(due) return gameV2Core(env,accountId,body,now,rng);
        return {...await currentSnapshot(db,accountId,now),storagePaused:true};
      }
      throw error('Storage maintenance; no new action accepted',503);
    }
  }
  if(body.command==='state'||body.recoverOnly) return gameV2Core(env,accountId,body,now,rng);
  const world=row?JSON.parse(row.state_json):null;
  if(body.command==='launch'){
    // Dry-run the tick, then validate every shot. A bad launch must not roll
    // back already-rolled collisions, so only a valid batch shares one write
    // with that tick. An invalid batch still commits the tick as state.
    if(!world?.projectiles?.length||world.pausedAt) return gameV2Core(env,accountId,body,now,rng);
    const rec=recordRng(rng);
    const preview=JSON.parse(JSON.stringify(world));
    const flight=advanceProjectiles(preview,now,rec);
    const escaped=clean(preview,now,rec);
    const previewPaid=flight.paid+escaped.reduce((s,f)=>s+f.pay,0);
    let spendable=a.balance+previewPaid;
    try {
      for(const shot of normalizeShots(body))
        spendable=assertLaunchable(preview,shot,now,spendable);
    } catch(e) {
      await gameV2Core(env,accountId,{command:'state',seq:a.sync_seq,id:actionId(a.sync_seq)},now,replayRng(rec.recorded,rng),{expectedSequence:a.sync_seq});
      throw e;
    }
    try {
      return await gameV2Core(env,accountId,body,now,replayRng(rec.recorded,rng));
    } catch(e) {
      try {
        await gameV2Core(env,accountId,{command:'state',seq:a.sync_seq,id:actionId(a.sync_seq)},now,replayRng(rec.recorded,rng),{expectedSequence:a.sync_seq});
      } catch {}
      throw e;
    }
  }
  if(!world?.projectiles?.length||world.pausedAt) return gameV2Core(env,accountId,body,now,rng);
  const advanced=await gameV2Core(env,accountId,{command:'state',seq:a.sync_seq,id:actionId(a.sync_seq)},now,rng,{expectedSequence:a.sync_seq});
  if(body.seq!==a.sync_seq || origin!==body.seq) throw error('stale account sequence',409);
  const response=await gameV2Core(env,accountId,{...body,seq:advanced.seq},now,rng,{skipFlight:true,intentSeq:body.seq});
  return {...response,detail:{...response.detail,motion:[...(advanced.detail?.motion||[]),...(response.detail?.motion||[])]},reconciledSequence:advanced.seq};
}

// A same-ID winner may commit between this attempt's read and validation. Only
// recover its immutable receipt; NEVER rerun a rejected command or speculative RNG.
export async function gameV2(env,accountId,body,now=Date.now(),rng=()=>crypto.getRandomValues(new Uint32Array(1))[0]) {
  try { return await gameV2Impl(env,accountId,body,now,rng); }
  catch(e) {
    if(env.GAME_V2==='1' && body?.id && !body.recoverOnly) {
      const winner=await env.DB.prepare(`SELECT id FROM economy_actions WHERE account_id=? AND id=? AND status='settled'`).bind(accountId,body.id).first();
      if(winner) return gameV2Core(env,accountId,{...body,recoverOnly:true},now,rng);
    }
    throw e;
  }
}
