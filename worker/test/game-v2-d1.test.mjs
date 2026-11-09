import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { gameV2 as actualGameV2 } from "./protocol-client.mjs";
import { potential } from "../src/combat-math.js";
import { createHmac, webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
// Explicit synthetic Temple encounter for the older settlement-focused tests.
// Production species/cadence and real flight have separate unmodified-path tests.
async function gameV2(env, account, body, now, rng) {
  const fresh =
    body.command === "state" &&
    !(await env.DB.prepare(
      "SELECT account_id FROM economy_world WHERE account_id=?",
    )
      .bind(account)
      .first());
  const s = await actualGameV2(env, account, body, now, rng);
  if (fresh && rng && s.world.fishes.length) {
    s.world.fishes = s.world.fishes.map((f) => ({
      ...f,
      art: "chest",
      kind: "temple",
      mult: 12,
      len: 84,
      h: 66,
      boss: false,
      expires: now + 30000,
    }));
    s.world.director = {
      spawn: Number.MAX_SAFE_INTEGER,
      boss: Number.MAX_SAFE_INTEGER,
      tide: Number.MAX_SAFE_INTEGER,
      quiet: 0,
      wave: 0,
    };
    await env.DB.prepare(
      "UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=?",
    )
      .bind(JSON.stringify(s.world), account)
      .run();
  }
  return s;
}
const time = Date.parse("2026-11-10T20:10:00Z");
const id = (n) => "local_action_" + n;
async function seed(db) {
  await db
    .prepare(
      "INSERT INTO players(tg_id,pid,created_at,last_seen) VALUES(123456,'local_tg_fixture',0,0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO accounts(id,public_id,pid,tg_id,balance,bonus,pt,created_at,last_seen) VALUES(1,'RR-LOCAL1','local_one',123456,50000,10000,0,0,0),(2,'RR-LOCAL2','local_two',NULL,50000,10000,0,0,0)",
    )
    .run();
}
function tgData(userId) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: "Local fixture" }),
  });
  const text = [...fields.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  const key = createHmac("sha256", "WebAppData")
    .update("local-testing-fixture-not-a-real-bot-token")
    .digest();
  fields.set("hash", createHmac("sha256", key).update(text).digest("hex"));
  return fields.toString();
}
test("real D1 integrated combat: locks, mirror, replay, concurrency, authoritative offers, pause, exact slots and escape settlement", async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db);
    const env = { DB: db, GAME_V2: "1" };
    let s = await gameV2(
      env,
      1,
      { command: "state", id: id("start") },
      time,
      () => 0,
    );
    const fish = s.world.fishes[0];
    let tick = time;
    const run = async (command, more = {}, rng = () => 0) => {
      tick += 200;
      const body = { command, ...more, id: id(++counter), seq: s.seq };
      s = await gameV2(env, 1, body, tick, rng);
      return { s, body };
    };
    let counter = 0;
    const outcomes = () => {
      let n = 0;
      return () => (n++ % 2 === 0 ? 0 : 4000000000);
    };
    const first = await run(
      "attack",
      { target: fish.id, baseStake: 10, tier: 1 },
      outcomes(),
    );
    assert.equal(s.detail.attack.cost, 10);
    assert.equal(s.world.fishes[0].hp, 800);
    const balance = s.balance;
    const replay = await gameV2(env, 1, first.body, tick, outcomes());
    assert.equal(replay.balance, balance);
    assert.equal(replay.replayed, true);
    await assert.rejects(
      gameV2(env, 1, { ...first.body, target: "forged" }, tick),
      /id reused/,
    );
    await assert.rejects(gameV2(env, 2, first.body, tick), /stale|unavailable/);
    await run(
      "attack",
      { target: fish.id, baseStake: 1000, tier: 10 },
      outcomes(),
    );
    assert.equal(s.detail.attack.cost, 10);
    assert.equal(s.detail.attack.tier, 1);
    await run(
      "attack",
      { target: fish.id, baseStake: 1000, tier: 10 },
      outcomes(),
    );
    assert.equal(s.detail.attack.updates[0].prize, 120);
    assert.ok(s.detail.offer);
    const offer = s.detail.offer;
    const p = await db
      .prepare(
        "SELECT balance,pt,sync_seq,last_daily FROM players WHERE tg_id=123456",
      )
      .first();
    assert.equal(p.balance, s.balance);
    assert.equal(p.pt, 30);
    assert.equal(p.sync_seq, s.seq);
    await run("pause", { offer });
    const expires = s.world.fishes[1].expires;
    tick += 200000;
    await run("state");
    assert.equal(s.world.fishes[1].expires, expires);
    assert.ok(s.world.pausedAt);
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "attack",
          id: id("pausedattack"),
          seq: s.seq,
          target: s.world.fishes[1].id,
          baseStake: 10,
          tier: 1,
        },
        tick + 200,
      ),
      /bonus is open/,
    );
    let n = 0;
    await run("quote", { offer });
    await run(
      "spin",
      {
        offer,
        tier: 1,
        quoteId: s.world.offers.find((o) => o.id === offer).quotes[0].id,
      },
      () => (n++ === 0 ? 100 : 0),
    );
    assert.equal(s.detail.bonus.kind, "pearl");
    assert.equal(s.detail.bonus.pay, s.detail.bonus.stake * 1.2);
    assert.ok(s.world.pausedAt);
    await run("resume");
    assert.equal(s.world.pausedAt, 0);
    assert.ok(s.world.fishes[1].expires > expires);
    await assert.rejects(
      gameV2(
        env,
        1,
        { command: "spin", offer, tier: 1, id: id("spin_again"), seq: s.seq },
        tick + 200,
      ),
      /offer unavailable/,
    );
    await run("activate", { style: "arc" });
    assert.equal(s.world.styleUntil, tick + 6000);
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "activate",
          style: "plasma",
          seq: s.seq,
          id: id("cooldown"),
        },
        tick + 1,
      ),
      /special unavailable/,
    );
    await run(
      "attack",
      { target: s.world.fishes[1].id, baseStake: 10, tier: 1 },
      outcomes(),
    );
    assert.equal(s.detail.attack.updates.length, 3);
    const stored = potential(s.world.fishes);
    assert.ok(stored > 0);
    tick += 100000;
    await run("state");
    assert.equal(
      s.detail.escaped.reduce((v, f) => v + f.pay, 0),
      stored,
    );
    assert.equal(
      s.world.fishes.some((f) => f.lock),
      false,
    );
    const seq = s.seq,
      results = await Promise.allSettled([
        gameV2(
          env,
          1,
          { command: "daily", id: id("dailyA"), seq },
          tick + 200,
          () => 0,
        ),
        gameV2(
          env,
          1,
          { command: "daily", id: id("dailyB"), seq },
          tick + 200,
          () => 0,
        ),
      ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const acct = await db.prepare("SELECT * FROM accounts WHERE id=1").first();
    assert.equal(acct.last_daily, "2026-11-10");
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM economy_ledger WHERE kind='daily'")
          .first()
      ).n,
      1,
    );
    const ledger = await db
      .prepare(
        "SELECT SUM(payout-wager) delta FROM economy_ledger WHERE account_id=1",
      )
      .first();
    assert.equal(acct.balance, 50000 + ledger.delta);
    const before = acct.balance;
    await db
      .prepare(
        "CREATE TRIGGER local_fail BEFORE UPDATE OF status ON economy_actions WHEN NEW.status='settled' BEGIN SELECT RAISE(ABORT,'local rollback sentinel'); END",
      )
      .run();
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "activate",
          style: "plasma",
          seq: acct.sync_seq,
          id: id("rollback"),
        },
        tick + 1000,
      ),
      /local rollback sentinel/,
    );
    assert.equal(
      (await db.prepare("SELECT balance FROM accounts WHERE id=1").first())
        .balance,
      before,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM economy_actions WHERE id=?")
          .bind(id("rollback"))
          .first()
      ).n,
      0,
    );
  } finally {
    await mf.dispose();
  }
});
test("full local Worker auth/TG routing: forged outcomes ignored, isolated ownership, legacy authority disabled, protected TG rejected before insertion", async () => {
  const { mf, db } = await localV2();
  try {
    const post = async (path, body, token) => {
      const r = await mf.dispatchFetch("http://localhost" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Reef-Protocol": "2",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const signup = await post("/api/auth/signup", {
      username: "LocalReefTester",
      password: "Local-Test-Only-9000",
    });
    assert.equal(signup.status, 200, JSON.stringify(signup.body));
    const token = signup.body.token;
    for (const path of ["/api/sync", "/api/grant"])
      assert.equal(
        (
          await post(
            path,
            { d: 99999, w: 0, kind: "daily_bonus", amt: 99999 },
            token,
          )
        ).status,
        409,
      );
    assert.equal(
      (await post("/api/v2/game", { command: "state", id: id("unauth") }))
        .status,
      401,
    );
    let r = await post(
      "/api/v2/game",
      { command: "state", id: id("route_state") },
      token,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const balance = r.body.balance,
      seq = r.body.seq;
    r = await post(
      "/api/v2/game",
      {
        command: "attack",
        target: "forged_target",
        baseStake: 10,
        tier: 1,
        id: id("forged"),
        seq,
        balance: 999999,
        payout: 999999,
        dead: true,
      },
      token,
    );
    assert.equal(r.status, 400);
    r = await post(
      "/api/v2/game",
      { command: "state", id: id("route_after") },
      token,
    );
    assert.equal(r.body.balance, balance);
    const tg = await post("/api/v2/game", {
      command: "state",
      id: id("tg"),
      initData: tgData(123457),
    });
    assert.equal(tg.status, 200, JSON.stringify(tg.body));
    const a = await db
      .prepare("SELECT * FROM accounts WHERE tg_id=123457")
      .first();
    assert.ok(a);
    assert.equal(a.balance, tg.body.balance);
    const denied = await post("/api/v2/game", {
      command: "state",
      id: id("protected"),
      initData: tgData(7313143643),
    });
    assert.equal(denied.status, 403);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM players WHERE tg_id=7313143643")
          .first()
      ).n,
      0,
    );
    const bad = await post("/api/v2/game", {
      command: "state",
      id: id("badhmac"),
      initData: tgData(123458) + "tamper",
    });
    assert.equal(bad.status, 401);
  } finally {
    await mf.dispose();
  }
});

test("real D1 same-ID simultaneous RNG disagreement returns only winning receipt; server expiry and functional plasma stay budgeted", async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db);
    const env = { DB: db, GAME_V2: "1" };
    let s = await gameV2(
      env,
      1,
      { command: "state", id: id("race_initial") },
      time,
      () => 0,
    );
    const target = s.world.fishes[0].id,
      body = {
        command: "attack",
        target,
        baseStake: 10,
        tier: 1,
        seq: s.seq,
        id: id("same_race"),
      };
    const both = await Promise.all([
      gameV2(env, 1, body, time + 200, () => 0),
      gameV2(env, 1, body, time + 200, () => 4000000000),
    ]);
    assert.deepEqual(both[0].detail, both[1].detail);
    assert.deepEqual(both[0].world, both[1].world);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM economy_ledger WHERE kind='attack'")
          .first()
      ).n,
      1,
    );
    s = both[0];
    s = await gameV2(
      env,
      1,
      { command: "activate", style: "arc", id: id("timer_arc"), seq: s.seq },
      time + 400,
      () => 0,
    );
    s = await gameV2(
      env,
      1,
      {
        command: "attack",
        target: s.world.fishes[2].id,
        baseStake: 10,
        tier: 1,
        id: id("timer_expired"),
        seq: s.seq,
      },
      time + 6600,
      () => 0,
    );
    assert.equal(s.detail.attack.style, "normal");
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "activate",
          style: "plasma",
          id: id("timer_early"),
          seq: s.seq,
        },
        time + 7000,
      ),
      /special unavailable/,
    );
    s = await gameV2(
      env,
      1,
      {
        command: "activate",
        style: "plasma",
        id: id("timer_plasma"),
        seq: s.seq,
      },
      time + 18400,
      () => 0,
    );
    s = await gameV2(
      env,
      1,
      {
        command: "attack",
        target: s.world.fishes[2].id,
        baseStake: 10,
        tier: 1,
        id: id("plasma_paid"),
        seq: s.seq,
      },
      time + 18600,
      () => 0,
    );
    assert.equal(s.detail.attack.style, "plasma");
    assert.equal(s.detail.attack.cost, 10);
    assert.equal(s.detail.attack.updates[0].damage, 800);
    assert.equal(s.detail.attack.updates[0].probability, 0.91 / 8);
    // A duplicate claim on the next calendar day uses the persisted account/day,
    // not a client supplied reward, date or balance.
    s = await gameV2(
      env,
      1,
      {
        command: "daily",
        id: id("daily_server"),
        seq: s.seq,
        day: "2099-01-01",
        payout: 999999,
      },
      time + 18800,
      () => 0,
    );
    assert.equal(s.detail.daily.pay, 100);
    await assert.rejects(
      gameV2(
        env,
        1,
        { command: "daily", id: id("daily_dup"), seq: s.seq },
        time + 19000,
        () => 0,
      ),
      /already claimed/,
    );
  } finally {
    await mf.dispose();
  }
});

test("50 local devices claim once; Temple spin race settles once; actual laser capture issues paid budgeted ticks", async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db);
    const env = { DB: db, GAME_V2: "1" };
    let s = await gameV2(
      env,
      1,
      { command: "state", id: id("fifty_init") },
      time,
      () => 0,
    );
    const claims = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        gameV2(
          env,
          1,
          { command: "daily", id: id("device_" + i), seq: s.seq },
          time + 100,
          () => 0,
        ),
      ),
    );
    assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
    s = await gameV2(
      env,
      1,
      { command: "state", id: id("fifty_refresh") },
      time + 200,
      () => 0,
    );
    const target = s.world.fishes[0].id;
    for (let i = 0; i < 3; i++)
      s = await gameV2(
        env,
        1,
        {
          command: "attack",
          target,
          baseStake: 10,
          tier: 1,
          id: id("offerhit_" + i),
          seq: s.seq,
        },
        time + 400 + i * 200,
        () => 0,
      );
    const offer = s.detail.offer;
    assert.ok(offer);
    s = await gameV2(
      env,
      1,
      { command: "pause", offer, id: id("race_pause"), seq: s.seq },
      time + 1000,
      () => 0,
    );
    const spins = await Promise.allSettled(
      [0, 1].map((i) =>
        gameV2(
          env,
          1,
          {
            command: "spin",
            quoteId: s.world.offers.find((o) => o.id === offer).quotes[0].id,
            offer,
            tier: 1,
            id: id("spin_race_" + i),
            seq: s.seq,
          },
          time + 1200,
          () => 100,
        ),
      ),
    );
    assert.equal(spins.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM economy_ledger WHERE kind='spin'")
          .first()
      ).n,
      1,
    );
    s = await gameV2(
      env,
      1,
      { command: "state", id: id("after_spin_race") },
      time + 1250,
      () => 0,
    );
    s = await gameV2(
      env,
      1,
      { command: "resume", seq: s.seq, id: id("resume_spin_race") },
      time + 1300,
      () => 0,
    );
    // Explicit local test fixture only: retain a legitimate fish definition and let
    // the real attack route reduce all 1800 HP to zero before issuing laser time.
    const row = await db
      .prepare("SELECT state_json FROM economy_world WHERE account_id=1")
      .first();
    const w = JSON.parse(row.state_json);
    w.fishes[4] = {
      ...w.fishes[4],
      id: "local_laser_fixture",
      art: "laser",
      kind: "laser",
      mult: 18,
      lock: undefined,
      hp: undefined,
      maxHp: undefined,
    };
    await db
      .prepare(
        "UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1",
      )
      .bind(JSON.stringify(w))
      .run();
    s = await gameV2(
      env,
      1,
      { command: "state", id: id("laser_refresh") },
      time + 1400,
      () => 0,
    );
    for (let i = 0; i < 5; i++)
      s = await gameV2(
        env,
        1,
        {
          command: "attack",
          target: "local_laser_fixture",
          baseStake: 10,
          tier: 1,
          id: id("laserhit_" + i),
          seq: s.seq,
        },
        time + 1600 + i * 200,
        () => 0,
      );
    assert.equal(s.world.laserUntil, time + 2400 + 5000);
    assert.equal(s.detail.attack.updates[0].dead, true);
    const prev = s.balance;
    s = await gameV2(
      env,
      1,
      {
        command: "attack",
        target: s.world.fishes[1].id,
        baseStake: 10,
        tier: 1,
        id: id("laser_tick"),
        seq: s.seq,
      },
      time + 2500,
      () => 4000000000,
    );
    assert.equal(s.detail.attack.style, "laser");
    assert.equal(s.detail.attack.updates.length, 3);
    assert.equal(s.detail.attack.cost, 10);
    assert.equal(s.balance, prev - 10);
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "attack",
          target: s.world.fishes[1].id,
          baseStake: 10,
          tier: 1,
          id: id("laser_fast"),
          seq: s.seq,
        },
        time + 2501,
      ),
      /cooling down/,
    );
    s = await gameV2(
      env,
      1,
      {
        command: "attack",
        target: s.world.fishes[1].id,
        baseStake: 10,
        tier: 1,
        id: id("laser_expired"),
        seq: s.seq,
      },
      time + 8000,
      () => 4000000000,
    );
    assert.equal(s.detail.attack.style, "normal");
  } finally {
    await mf.dispose();
  }
});

test("exact server quote rejects purchase balance changes, tide changes, forged terms and expiry; refreshed quote requires new explicit spin", async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db);
    const env = { DB: db, GAME_V2: "1" };
    let tick = time,
      s = await gameV2(
        env,
        1,
        { command: "state", id: id("quote_init") },
        tick,
        () => 0,
      ),
      n = 0;
    const run = async (command, more = {}, rng = () => 0) => {
      tick += 200;
      s = await gameV2(
        env,
        1,
        { command, ...more, id: id("quote_" + ++n), seq: s.seq },
        tick,
        rng,
      );
      return s;
    };
    const target = s.world.fishes[0].id;
    for (let i = 0; i < 3; i++)
      await run("attack", { target, baseStake: 10, tier: 1 });
    const offer = s.detail.offer;
    await run("pause", { offer });
    const old = s.world.offers.find((o) => o.id === offer).quotes[0];
    const { creditPayment } = await import("../src/index.js"),
      { PACKS } = await import("../src/tg.js");
    const payment = {
      invoice_payload: "rr1:0:123456:deadbeef",
      currency: "XTR",
      total_amount: PACKS[0].stars,
      telegram_payment_charge_id: "LOCAL_QUOTE_PURCHASE",
    };
    const before = s.balance;
    assert.equal((await creditPayment(env, 123456, payment)).credited, true);
    assert.equal((await creditPayment(env, 123456, payment)).credited, false);
    let account = await db.prepare("SELECT * FROM accounts WHERE id=1").first();
    assert.equal(account.balance, before + PACKS[0].c + PACKS[0].bonus);
    assert.equal(account.sync_seq, s.seq + 1);
    const balance = account.balance;
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "spin",
          offer,
          quoteId: old.id,
          seq: account.sync_seq,
          id: id("stale_quote_purchase"),
        },
        tick + 200,
      ),
      /quote changed/,
    );
    assert.equal(
      (await db.prepare("SELECT balance FROM accounts WHERE id=1").first())
        .balance,
      balance,
    );
    s = await gameV2(
      env,
      1,
      { command: "state", id: id("quote_refresh_state") },
      tick + 400,
    );
    await run("quote", { offer });
    const q = s.world.offers.find((o) => o.id === offer).quotes[0];
    assert.notEqual(q.id, old.id);
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "spin",
          offer,
          quoteId: q.id,
          seq: s.seq,
          id: id("quote_expiry"),
        },
        q.expiresAt + 1,
      ),
      /quote changed/,
    );
    tick = Date.parse("2026-11-10T20:29:58Z");
    await run("quote", { offer });
    const normal = s.world.offers.find((o) => o.id === offer).quotes[0];
    assert.equal(normal.period, 92);
    await assert.rejects(
      gameV2(
        env,
        1,
        {
          command: "spin",
          offer,
          quoteId: normal.id,
          seq: s.seq,
          id: id("quote_tide_change"),
        },
        Date.parse("2026-11-10T20:30:01Z"),
      ),
      /quote changed/,
    );
    tick = Date.parse("2026-11-10T20:30:02Z");
    await run("quote", { offer });
    const low = s.world.offers.find((o) => o.id === offer).quotes[0];
    assert.equal(low.period, 88);
    await run(
      "spin",
      { offer, quoteId: low.id, stake: 999999, period: 92, cap: 999999 },
      () => 199,
    );
    assert.equal(s.detail.bonus.stake, low.stake);
    assert.equal(s.detail.bonus.period, 88);
    assert.equal(s.detail.bonus.pay, low.stake * 29.2);
  } finally {
    await mf.dispose();
  }
});

test("fresh TG linking is canonical and atomic under competing account links; no orphan TG account", async () => {
  const { mf, db } = await localV2();
  try {
    const post = async (path, body, token) => {
      const r = await mf.dispatchFetch("http://localhost" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Reef-Protocol": "2",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    const a = await post("/api/auth/signup", {
        username: "LinkFixtureA",
        password: "Local-Link-Fixture-9000",
      }),
      b = await post("/api/auth/signup", {
        username: "LinkFixtureB",
        password: "Local-Link-Fixture-9000",
      });
    const initData = tgData(123459),
      results = await Promise.all([
        post("/api/auth/link-tg", { initData }, a.body.token),
        post("/api/auth/link-tg", { initData }, b.body.token),
      ]);
    assert.equal(
      results.filter((r) => r.status === 200).length,
      1,
      JSON.stringify(results.map((r) => r.status)),
    );
    assert.equal(results.filter((r) => r.status === 409).length, 1);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM accounts").first()).n,
      2,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM accounts WHERE tg_id=123459")
          .first()
      ).n,
      1,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM players WHERE tg_id=123459")
          .first()
      ).n,
      1,
    );
    const owner = await db
        .prepare("SELECT balance,sync_seq FROM accounts WHERE tg_id=123459")
        .first(),
      mirror = await db
        .prepare("SELECT balance,sync_seq FROM players WHERE tg_id=123459")
        .first();
    assert.deepEqual(owner, mirror);
  } finally {
    await mf.dispose();
  }
});

test("trusted synthetic external adjustment and combat CAS cannot overwrite each other; duplicate receipts remain exactly once", async () => {
  const { mf, db } = await localV2();
  try {
    await seed(db);
    const env = { DB: db, GAME_V2: "1" },
      { adjustCanonical } = await import("../src/external-writer.js");
    let s = await gameV2(
      env,
      1,
      { command: "state", id: id("external_init") },
      time,
      () => 0,
    );
    const a = await db.prepare("SELECT * FROM accounts WHERE id=1").first();
    const change = {
      id: id("external_change"),
      op: "add",
      amount: 123,
      reason: "Synthetic local writer regression",
    };
    const results = await Promise.allSettled([
      adjustCanonical(env, a, change, time + 200),
      gameV2(
        env,
        1,
        {
          command: "attack",
          target: s.world.fishes[0].id,
          baseStake: 10,
          tier: 1,
          id: id("external_attack"),
          seq: s.seq,
        },
        time + 200,
        () => 4000000000,
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const account = await db
        .prepare("SELECT * FROM accounts WHERE id=1")
        .first(),
      ledger = await db
        .prepare(
          "SELECT SUM(payout-wager+external_delta) d FROM economy_ledger WHERE account_id=1",
        )
        .first();
    assert.equal(account.balance, 50000 + ledger.d);
    const mirror = await db
      .prepare("SELECT balance,sync_seq FROM players WHERE tg_id=123456")
      .first();
    assert.equal(mirror.balance, account.balance);
    assert.equal(mirror.sync_seq, account.sync_seq);
    const receipt = await adjustCanonical(
      env,
      account,
      { ...change, id: id("external_second") },
      time + 400,
    );
    const retry = await adjustCanonical(
      env,
      account,
      { ...change, id: id("external_second") },
      time + 600,
    );
    assert.equal(retry.balance, receipt.balance);
    assert.equal(retry.replayed, true);
  } finally {
    await mf.dispose();
  }
});
