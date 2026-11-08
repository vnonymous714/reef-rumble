import motion from "../../reef-motion.js";
import pickups from "../../reef-laser-pickups.js";
import * as director from "./director-v2.js";
import legacy from "../../engine.js";
/* Isolated authoritative candidate. Route is feature-gated; never enable before
   migration/QA. Server owns fish, damage, offers, daily results and balances. */
import { jackpotAward, attack, profile, engage } from "./combat-math.js";
import { uniform, dayKey, dailyReward } from "./reward-math.js";
import bonus from "../../bonusmath.js";
import { PROTECTED_TG_ID } from "./tg.js";
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
    apiVersion: 2,
  };
}
function clean(w, now, rng) {
  if (w.pausedAt) return [];
  const escaped = w.fishes
    .filter((f) => !f.dead && f.expires <= now && f.lock)
    .map((f) => ({
      id: f.id,
      pay: ((f.maxHp - f.hp) / f.lock.hpUnit) * f.lock.stake,
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
  const rayIds =
    b.style === "laser"
      ? new Set(motion.ray(b, w.fishes, collision.at).map((f) => f.id))
      : null;
  const pool = w.fishes.filter((f) => {
    if (f.id === primary.id) return true;
    if (rayIds) return rayIds.has(f.id);
    const p = motion.point(f, collision.at, b.board.width, b.board.height),
      q = motion.point(primary, collision.at, b.board.width, b.board.height);
    return (
      Math.hypot(p.x - q.x, p.y - q.y) <
      (primary.kind === "bomb" ? legacy.BOMB_RADIUS : legacy.CHAIN_RADIUS)
    );
  });
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
    })),
  };
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
    if (r.target.kind === "laser") pickups.start(w, collision.at);
  }
  return { paid, refund: 0, event: events };
}
function advanceProjectiles(w, now, rng) {
  const result = { paid: 0, refunds: 0, events: [] };
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
        result.events.push({ id: b.id, kind: "refund", stake: b.stake });
      } else {
        const settled = settleCollision(w, b, event, rng);
        result.paid += settled.paid;
        result.refunds += settled.refund;
        if (settled.event) result.events.push(settled.event);
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
function apply(a, w, body, now, rng) {
  const command = body.command;
  const flight = advanceProjectiles(w, now, rng);
  const escaped = clean(w, now, rng);
  let wager = 0,
    paid = flight.paid + escaped.reduce((s, f) => s + f.pay, 0),
    detail = { escaped, motion: flight.events, refunds: flight.refunds };
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
  } else if (command === "refill") {
    if (now - (w.lastRefill || 0) < 60000)
      throw error("free-credit cooldown", 429);
    w.lastRefill = now;
    paid += 10000;
    detail.refill = 10000;
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
    if (now - w.lastShot < (now < w.laserUntil ? 90 : 165))
      throw error("weapon cooling down", 429);
    if ((w.projectiles || []).length >= 24)
      throw error("projectile limit", 429);
    const primary = body.target
      ? w.fishes.find((f) => f.id === body.target && !f.dead)
      : null;
    if (body.target && !primary) throw error("unavailable target");
    let p;
    try {
      p = primary
        ? engage(primary, body.baseStake, body.tier).lock
        : {
            ...profile(body.tier, body.baseStake),
            stake: Math.round(body.baseStake * profile(body.tier).costFactor),
          };
    } catch (e) {
      throw error(e.message);
    }
    if (
      !Number.isSafeInteger(body.baseStake) ||
      body.baseStake < 10 ||
      body.baseStake > 1000
    )
      throw error("invalid base stake");
    if (a.balance < p.stake) throw error("insufficient credits");
    const style =
      now < w.laserUntil ? "laser" : now < w.styleUntil ? w.style : "normal";
    let b;
    try {
      b = motion.launch(
        body.id,
        body.angle,
        body.target,
        body.board,
        now,
        p.stake,
        p.tier || body.tier,
        primary?.lock?.baseStake ??
          (primary?.lock ? Math.round(p.stake / p.costFactor) : body.baseStake),
        style,
        periodAt(now),
      );
    } catch (e) {
      throw error(e.message);
    }
    if (style === "laser") {
      detail.laserSeconds = pickups.collect(w, b, now);
      const along = motion
        .ray(b, w.fishes, now)
        .filter(
          (f) =>
            f.mult * p.stake <= 40000 &&
            (!f.lock || (f.lock.stake === p.stake && f.lock.tier === p.tier)),
        );
      if (!along.length) return { w, wager: 0, paid, detail };
      const target = along[0],
        pos = motion.point(target, now, b.board.width, b.board.height);
      const result = settleCollision(
        w,
        b,
        { target: target.id, at: now, x: pos.x, y: pos.y },
        rng,
      );
      paid += result.paid;
      detail.motion.push(result.event);
      w.lastShot = now;
      wager = p.stake;
      detail.beam = { ...b, target: target.id };
      return { w, wager, paid, detail };
    }
    w.projectiles ??= [];
    w.projectiles.push(b);
    w.lastShot = now;
    wager = p.stake;
    detail.launch = b;
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
      })),
    };
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
      if (r.target.kind === "laser") pickups.start(w, now);
    }
  } else throw error("unknown command");
  if (!money(wager) || !money(paid)) throw error("invalid settlement");
  return { w, wager, paid, detail };
}
export async function gameV2(
  env,
  accountId,
  body,
  now = Date.now(),
  rng = () => crypto.getRandomValues(new Uint32Array(1))[0],
) {
  if (env.GAME_V2 !== "1") throw error("candidate disabled", 404);
  const db = env.DB;
  let a = await db
    .prepare("SELECT * FROM accounts WHERE id=?1")
    .bind(accountId)
    .first();
  if (!a || a.tg_id === PROTECTED_TG_ID)
    throw error("protected or missing account", 403);
  if (
    !body ||
    ![
      "state",
      "activate",
      "launch",
      "resume",
      "refill",
      "quote",
      "pause",
      "skip",
      "spin",
      "daily",
      "attack",
    ].includes(body.command)
  )
    throw error("unknown command");
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(body.id || ""))
    throw error("invalid action id");
  const canonical = JSON.stringify({
    command: body.command,
    target: body.target,
    baseStake: body.baseStake,
    tier: body.tier,
    style: body.style,
    offer: body.offer,
    quoteId: body.quoteId,
    angle: body.angle,
    board: body.board,
  });
  const replay = await db
    .prepare(
      "SELECT request_json,response_json FROM economy_actions WHERE account_id=?1 AND id=?2",
    )
    .bind(accountId, body.id)
    .first();
  if (replay) {
    if (replay.request_json !== canonical) throw error("action id reused");
    const receipt = JSON.parse(replay.response_json);
    return {
      ...(await currentSnapshot(db, accountId, now)),
      detail: receipt.detail,
      settled: { balance: receipt.balance, seq: receipt.seq },
      replayed: true,
    };
  }
  if (body.recoverOnly)
    throw error("Action was not accepted; retry manually", 409);
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
  if (body.command !== "state" && body.seq !== a.sync_seq)
    throw error("stale account sequence", 409);
  const result = apply(a, w, body, now, rng),
    next = {
      ...a,
      balance: a.balance - result.wager + result.paid,
      pt: Math.max(
        0,
        Math.min(
          a.bonus * 10,
          a.pt + result.wager - (result.detail.refunds || 0),
        ),
      ),
      sync_seq: a.sync_seq + 1,
    };
  const response = { ...snapshot(next, result.w, now), detail: result.detail };
  if (
    body.command === "state" &&
    row &&
    !result.paid &&
    JSON.stringify(result.w) === row.state_json
  )
    return { ...snapshot(a, result.w, now), detail: result.detail };
  const receipt = {
    balance: next.balance,
    seq: next.sync_seq,
    detail: result.detail,
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
  await db.batch([
    insert,
    db
      .prepare(
        `UPDATE accounts SET balance=?3,pt=?4,last_daily=?5,last_refill=?6,sync_seq=sync_seq+1 WHERE id=?1 AND ${guard}`,
      )
      .bind(
        accountId,
        body.id,
        next.balance,
        next.pt,
        result.w.lastDaily,
        result.w.lastRefill || 0,
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
        result.wager,
        result.paid,
        next.balance,
        now,
        result.paid -
          (result.detail.daily?.pay || result.detail.refill || 0) -
          (result.detail.refunds || 0),
        result.detail.daily?.pay || result.detail.refill || 0,
        periodAt(now),
        next.sync_seq,
        result.detail.refunds || 0,
      ),
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
    detail: saved.detail,
    settled: { balance: saved.balance, seq: saved.seq },
  };
}
async function currentSnapshot(db, accountId, now) {
  const current = await db
    .prepare(
      "SELECT a.*,w.state_json FROM accounts a JOIN economy_world w ON w.account_id=a.id WHERE a.id=?1",
    )
    .bind(accountId)
    .first();
  return snapshot(current, JSON.parse(current.state_json), now);
}
