/* Isolated authoritative candidate. Route is feature-gated; never enable before
   migration/QA. Server owns fish, damage, offers, daily results and balances. */
import { attack, profile } from "./combat-math.js";
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
function spawn(now, serial, rng) {
  const index =
    uniform(100, rng) < 2
      ? 15
      : uniform(100, rng) < 12
        ? uniform(defs.length, rng)
        : uniform(9, rng);
  const boss = uniform(400, rng) === 399;
  const selected = boss ? 17 + uniform(2, rng) : index;
  const [art, baseMult] = defs[selected],
    mult =
      art === "kraken"
        ? 100 + uniform(101, rng)
        : art === "dragon"
          ? 200 + uniform(151, rng)
          : baseMult;
  return {
    id: "f" + serial,
    art,
    mult,
    kind:
      art === "bomb"
        ? "bomb"
        : art === "eel"
          ? "chain"
          : art === "chest"
            ? "temple"
            : art === "laser"
              ? "laser"
              : "normal",
    born: now,
    expires: now + 45000 + uniform(30000, rng),
    x: (10 + uniform(80, rng)) / 100,
    y: (20 + uniform(50, rng)) / 100,
    dead: false,
  };
}
function fresh(now, rng) {
  const fishes = [];
  for (let i = 1; i <= 16; i++) fishes.push(spawn(now, i, rng));
  return {
    fishes,
    serial: 16,
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
  while (w.fishes.length < 16) w.fishes.push(spawn(now, ++w.serial, rng));
  w.offers = w.offers.filter((o) => o.expires > now && !o.consumed);
  return escaped;
}
function apply(a, w, body, now, rng) {
  const command = body.command;
  const escaped = clean(w, now, rng);
  let wager = 0,
    paid = escaped.reduce((s, f) => s + f.pay, 0),
    detail = { escaped };
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
  } else if (command === "skip" || command === "spin") {
    const offer = w.offers.find(
      (o) =>
        o.id === body.offer && !o.consumed && o.expires > (w.pausedAt || now),
    );
    if (!offer) throw error("offer unavailable");
    if (command === "spin") {
      const stake = bonus.stakeFor(a.balance, body.tier);
      if (!stake) throw error("stake unavailable");
      const result = bonus.outcome(
        uniform(200, rng),
        uniform(5, rng),
        stake,
        periodAt(now),
      );
      wager = stake;
      paid += result.pay;
      detail.bonus = result;
    }
    offer.consumed = true;
    const paused = w.pausedAt ? now - w.pausedAt : 0;
    for (const f of w.fishes) {
      f.expires += paused;
      f.born += paused;
    }
    w.laserUntil += paused;
    if (w.styleUntil) w.styleUntil += paused;
    if (w.cooldownUntil) w.cooldownUntil += paused;
    w.pausedAt = 0;
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
    if (uniform(4294967296, rng) / 4294967296 < (0.01 * wager) / w.jp) {
      paid += w.jp;
      detail.jackpot = w.jp;
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
      if (r.target.kind === "laser") w.laserUntil = now + 5000;
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
    !["state", "activate", "pause", "skip", "spin", "daily", "attack"].includes(
      body.command,
    )
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
  let row = await db
    .prepare("SELECT * FROM economy_world WHERE account_id=?1")
    .bind(accountId)
    .first();
  const w = row ? JSON.parse(row.state_json) : fresh(now, rng),
    version = row ? row.version : 0;
  if (!row) {
    const day = dayKey(now);
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
      pt: Math.min(a.bonus * 10, a.pt + result.wager),
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
        `UPDATE accounts SET balance=?3,pt=?4,last_daily=?5,sync_seq=sync_seq+1 WHERE id=?1 AND ${guard}`,
      )
      .bind(accountId, body.id, next.balance, next.pt, result.w.lastDaily),
    db
      .prepare(
        `INSERT INTO economy_world(account_id,state_json,version) SELECT ?1,?3,?4 WHERE ${pending} ON CONFLICT(account_id) DO UPDATE SET state_json=excluded.state_json,version=excluded.version`,
      )
      .bind(accountId, body.id, JSON.stringify(result.w), version + 1),
    db
      .prepare(
        `UPDATE players SET balance=?3,pt=?4,sync_seq=?5,last_daily=?6 WHERE tg_id=(SELECT tg_id FROM accounts WHERE id=?1) AND ${pending}`,
      )
      .bind(
        accountId,
        body.id,
        next.balance,
        next.pt,
        next.sync_seq,
        result.w.lastDaily,
      ),
    db
      .prepare(
        `INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE ${pending}`,
      )
      .bind(
        accountId,
        body.id,
        body.command,
        result.wager,
        result.paid,
        next.balance,
        now,
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
