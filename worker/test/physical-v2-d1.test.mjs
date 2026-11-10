import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { gameV2 } from "./protocol-client.mjs";
import motion from "../../reef-motion.js";
import * as director from "../src/director-v2.js";
import pickups from "../../reef-laser-pickups.js";
import { engage, jackpotAward, attack } from "../src/combat-math.js";
const time = Date.parse("2026-11-10T20:10:00Z");
async function setup() {
  const { mf, db } = await localV2();
  await db
    .prepare(
      "INSERT INTO accounts(id,public_id,pid,balance,bonus,pt,created_at,last_seen) VALUES(1,'RR-PHYSICS','synthetic_physics',50000,0,0,0,0)",
    )
    .run();
  const env = { DB: db, GAME_V2: "1" };
  let s = await gameV2(
    env,
    1,
    { command: "state", id: crypto.randomUUID() },
    time,
    () => 4000000000,
  );
  return { mf, db, env, s };
}
async function fixture(db, s, fishes) {
  s.world.fishes = fishes;
  s.world.director = {
    spawn: Number.MAX_SAFE_INTEGER,
    boss: Number.MAX_SAFE_INTEGER,
    tide: Number.MAX_SAFE_INTEGER,
    quiet: 0,
    wave: 0,
  };
  await db
    .prepare(
      "UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1",
    )
    .bind(JSON.stringify(s.world))
    .run();
}
function fish(id = "moving", x = 0.5, y = 0.35) {
  return {
    id,
    art: "chest",
    kind: "temple",
    mult: 12,
    len: 80,
    h: 60,
    born: time - 1000,
    expires: time + 60000,
    dead: false,
    motion: {
      p: [
        { x: x - 0.02, y },
        { x, y },
        { x, y },
        { x: x + 0.02, y },
      ],
      duration: 60000,
    },
  };
}
test("physical shot reserves once, flies before collision, preserves locked paid pricing and replays once", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(db, s, [fish()]);
    const body = {
      command: "launch",
      id: crypto.randomUUID(),
      seq: s.seq,
      target: "moving",
      baseStake: 10,
      tier: 1,
      angle: -Math.PI / 2,
      board: { width: 844, height: 390, safeBottom: 0 },
    };
    let launched = await gameV2(env, 1, body, time + 1, () => 4000000000);
    assert.equal(launched.balance, s.balance - 10);
    assert.equal(launched.world.projectiles.length, 1);
    assert.equal(
      launched.world.fishes.find((f) => f.id === "moving").lock,
      undefined,
    );
    let same = await gameV2(env, 1, body, time + 2);
    assert.equal(same.balance, launched.balance);
    assert.equal(same.replayed, true);
    let collided = await gameV2(
      env,
      1,
      { command: "state", id: crypto.randomUUID() },
      time + 1000,
      () => 0,
    );
    const f = collided.world.fishes.find((f) => f.id === "moving");
    assert.equal(f.lock.stake, 10);
    assert.equal(f.hp, 800);
    assert.equal(collided.detail.motion[0].kind, "collision");
    assert.equal(collided.world.projectiles.length, 0);
    const mirror = await db
      .prepare("SELECT balance,sync_seq FROM accounts WHERE id=1")
      .first();
    assert.equal(mirror.balance, collided.balance);
    assert.equal(mirror.sync_seq, collided.seq);
    // A different selected price/tier cannot change an engaged fish or a ricochet's reserved price.
    const switched = await gameV2(
      env,
      1,
      {
        ...body,
        id: crypto.randomUUID(),
        seq: collided.seq,
        baseStake: 50,
        tier: 10,
      },
      time + 1200,
      () => 4000000000,
    );
    assert.equal(switched.detail.launch.stake, 10);
    assert.equal(switched.detail.launch.base, 10);
    assert.equal(switched.detail.launch.tier, 1);
  } finally {
    await mf.dispose();
  }
});
test("unconsumed ricochets refund exactly once; reporting removes wager without classifying refund as winnings", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(
      db,
      s,
      Array.from({ length: 26 }, (_, i) => fish("offscreen_" + i, 2, 2)),
    );
    const body = {
      command: "launch",
      id: crypto.randomUUID(),
      seq: s.seq,
      baseStake: 25,
      tier: 2,
      angle: -Math.PI / 2,
      board: { width: 844, height: 390 },
    };
    const a = await gameV2(env, 1, body, time + 1, () => 4000000000);
    assert.equal(a.balance, s.balance - 31);
    const refunded = await gameV2(
      env,
      1,
      { command: "state", id: crypto.randomUUID() },
      time + 8000,
      () => 4000000000,
    );
    assert.equal(refunded.balance, s.balance);
    assert.equal(refunded.detail.refunds, 31);
    assert.equal(refunded.pt, 0);
    assert.equal(refunded.world.projectiles.length, 0);
    const sums = await db
      .prepare(
        "SELECT SUM(bet) wager,SUM(win) winnings FROM accounting_events WHERE player_id=?",
      )
      .bind("synthetic_physics")
      .first();
    assert.equal(sums.wager, 0);
    assert.equal(sums.winnings, 0);
    const again = await gameV2(
      env,
      1,
      { command: "state", id: crypto.randomUUID() },
      time + 8100,
      () => 4000000000,
    );
    assert.equal(again.balance, s.balance);
    assert.equal(again.detail.refunds, 0);
  } finally {
    await mf.dispose();
  }
});
test("laser uses actual beam geometry: empty aim free, intersecting ray paid once and no projectile pretense", async () => {
  const { mf, db, env, s } = await setup();
  try {
    s.world.laserUntil = time + 5000;
    await fixture(db, s, [fish("beam_target")]);
    const body = {
      command: "launch",
      id: crypto.randomUUID(),
      seq: s.seq,
      baseStake: 10,
      tier: 1,
      angle: -0.2,
      board: { width: 844, height: 390 },
    };
    const empty = await gameV2(env, 1, body, time + 1, () => 4000000000);
    assert.equal(empty.balance, s.balance);
    assert.equal(empty.detail.beam, undefined);
    const hit = await gameV2(
      env,
      1,
      { ...body, id: crypto.randomUUID(), seq: empty.seq, angle: -Math.PI / 2 },
      time + 200,
      () => 0,
    );
    assert.equal(hit.detail.beam.style, "laser");
    assert.equal(hit.detail.beam.stake, 10);
    assert.equal(hit.world.projectiles.length, 0);
    assert.equal(hit.detail.motion[0].updates[0].damage, 400);
  } finally {
    await mf.dispose();
  }
});
test("authoritative accounting excludes post-cutover fake/anonymous events and duplicate purchase events, retains historical events", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await db
      .prepare("UPDATE economy_config SET value=? WHERE key='cutover_at'")
      .bind(time)
      .run();
    await db
      .prepare(
        "INSERT INTO events(player_id,type,bet,win,credit,created_at) VALUES('historic','shots',100,20,0,?1),('unknown','catch',0,999999,0,?2),('synthetic_physics','stars_purchase',0,0,500,?2)",
      )
      .bind(time - 1, time + 1)
      .run();
    await db
      .prepare(
        "INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,external_delta,account_seq) VALUES(1,'purchase_test','stars_purchase',0,0,50500,?1,500,2)",
      )
      .bind(time + 1)
      .run();
    const totals = await db
      .prepare(
        "SELECT SUM(bet) bet,SUM(win) win,SUM(credit) credit FROM accounting_events",
      )
      .first();
    assert.deepEqual(totals, { bet: 100, win: 20, credit: 500 });
    const daily = await gameV2(
      env,
      1,
      { command: "daily", id: crypto.randomUUID(), seq: s.seq },
      time + 200,
      () => 0,
    );
    await assert.rejects(gameV2(env,1,{command:'refill',id:crypto.randomUUID(),seq:daily.seq},time+400),/invalid|unknown/);
    const promos=await db.prepare("SELECT type,SUM(credit) credit FROM accounting_events WHERE type IN('daily_bonus','refill') GROUP BY type ORDER BY type").all();
    assert.deepEqual(promos.results,[{type:'daily_bonus',credit:daily.detail.daily.pay}]);
    assert.equal((await db.prepare('SELECT balance FROM accounts WHERE id=1').first()).balance,daily.balance);
  } finally {
    await mf.dispose();
  }
});
test("protocol/maintenance gate rejects legacy clients before auth or balance mutation", async () => {
  const { mf } = await localV2();
  try {
    const r = await mf.dispatchFetch("http://localhost/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 426);
    const info = await mf.dispatchFetch("http://localhost/api/client-version");
    assert.deepEqual(await info.json(), {
      minimumClient: 2,
      protocol: 2,
      receiptProtocol:3,
      clientBuild:"tg25",
      enabled: true,
    });
  } finally {
    await mf.dispose();
  }
});
test("shared ellipse motion moves along a Bezier, refuses over-cap free collisions and bounds ricochets", () => {
  const f = fish();
  const a = motion.point(f, time, 844, 390),
    b = motion.point(f, time + 10000, 844, 390);
  assert.notEqual(a.x, b.x);
  assert.ok(motion.hit(f, a.x, a.y, time, { width: 844, height: 390 }));
  const shot = motion.launch(
    "synthetic",
    -Math.PI / 2,
    null,
    { width: 844, height: 390 },
    time,
    2000,
    10,
    1000,
    "normal",
    92,
  );
  let result;
  for (let i = 1; i <= 430 && !result; i++)
    result = motion.step(shot, [{ ...f, mult: 350 }], time + (i * 1000) / 60);
  assert.equal(result.kind, "refund");
});
test("joint fish/jackpot cap has exact one-percent jackpot EV even when fish capture can fill the cap", () => {
  // Pre-locked encounter whose prize fills MAX_AWARD so a winning capture leaves no jackpot room.
  const target = {
    ...fish(),
    mult: 40,
    lock: {
      stake: 1000,
      tier: 1,
      baseStake: 50,
      payoutFactor: 1,
      fishReturn: 0.91,
      costFactor: 1,
      healthFactor: 1,
      hpUnit: 100,
      packet: 4,
      actualPacketDamage: 400,
    },
    hp: 100,
    maxHp: 4000,
    dead: false,
  };
  const wins = attack([target], target.id, 50, 1, "normal", 0.91, () => 0),
    loss = attack([target], target.id, 50, 1, "normal", 0.91, () => 0.999);
  assert.equal(wins.payout, 40000);
  assert.equal(jackpotAward(wins.updates, "normal", 1000, 25000, 0), 0);
  const q = (0.01 * 1000) / ((1 - 0.91) * 25000);
  const award = jackpotAward(loss.updates, "normal", 1000, 25000, q / 2);
  assert.equal(award, 25000);
  assert.ok(Math.abs((1 - 0.91) * q * award - 10) < 1e-10);
  assert.equal(jackpotAward(loss.updates, "normal", 1000, 25000, q + 1e-8), 0);
});

test("original director retains weighted art, schools, boss and surge cadence with bounded waves", () => {
  const random = () => 0.2,
    w = {
      fishes: director.initial(time, random),
      serial: 12,
      laserUntil: 0,
      director: {
        spawn: time,
        boss: time + 35000,
        tide: time + 80000,
        quiet: 0,
        wave: 0,
      },
    };
  assert.equal(w.fishes.length, 12);
  assert.ok(w.fishes.every((f) => f.motion.p.length === 4 && f.born < time));
  for (let n = 0; n <= 82; n++) {
    const now = time + n * 1000;
    w.fishes = w.fishes.filter((f) => f.expires > now);
    director.tick(w, now, random);
    assert.ok(w.fishes.length <= 43);
    if (n === 35) {
      assert.ok(w.fishes.some((f) => f.boss));
      assert.equal(w.directorEvent.kind, "boss");
    }
    if (n === 80) assert.equal(w.directorEvent.kind, "surge");
  }
  assert.ok(
    w.fishes.some((f) => f.born > time + 82000),
    "school trailing members enter later along shared paths",
  );
});
test("Prism +1-second pickups are real, capped at five extensions, paused safely and expire", () => {
  const w = {};
  pickups.start(w, time);
  const b = motion.launch(
    "beam",
    -Math.PI / 2,
    null,
    { width: 844, height: 390 },
    time,
    10,
    1,
    10,
    "laser",
    92,
  );
  for (let i = 0; i < 8; i++) {
    w.laserPickups = [
      {
        id: "pickup_" + i,
        born: time,
        x: 0.5,
        y: 0.1,
        vx: 0,
        vy: 0,
        dead: false,
      },
    ];
    assert.equal(pickups.collect(w, b, time + 100), i < 5 ? 1 : 0);
    assert.equal(pickups.collect(w, b, time + 100), 0);
  }
  assert.equal(w.laserUntil, time + 10000);
  assert.equal(w.laserExtended, 5);
  pickups.shift(w, 1000);
  assert.equal(w.laserPickups[0].born, time + 1000);
  pickups.tick(w, time + 11000, () => 0.5);
  assert.deepEqual(w.laserPickups, []);
});

test("recovery is receipt-only: unknown/declined commands cannot silently debit on reconnect", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(db, s, [fish()]);
    const body = {
      command: "launch",
      id: crypto.randomUUID(),
      seq: s.seq,
      target: "moving",
      baseStake: 10,
      tier: 1,
      angle: -Math.PI / 2,
      board: { width: 844, height: 390 },
    };
    await assert.rejects(
      gameV2(env, 1, { ...body, recoverOnly: true }, time + 1),
      /not accepted/,
    );
    assert.equal(
      (await db.prepare("SELECT balance FROM accounts WHERE id=1").first())
        .balance,
      s.balance,
    );
    const accepted = await gameV2(env, 1, body, time + 1, () => 4000000000);
    const recovered = await gameV2(
      env,
      1,
      { ...body, recoverOnly: true },
      time + 2,
    );
    assert.equal(recovered.replayed, true);
    assert.equal(recovered.balance, accepted.balance);
  } finally {
    await mf.dispose();
  }
});

test('paid collision is irrevocable even when invalid outcome-dependent pause probes reject',async()=>{const {mf,db,env,s}=await setup();try{s.world.style='plasma';s.world.styleUntil=time+6000;await fixture(db,s,[fish()]);const launched=await gameV2(env,1,{command:'launch',id:crypto.randomUUID(),seq:s.seq,target:'moving',baseStake:10,tier:5,angle:-Math.PI/2,board:{width:844,height:390}},time+1,()=>4000000000);assert.equal(launched.detail.launch.stake,20);await assert.rejects(gameV2(env,1,{command:'pause',offer:'offer_moving',seq:launched.seq,id:crypto.randomUUID()},time+1000,()=>4000000000),/offer unavailable/);let snapshot=await gameV2(env,1,{command:'state',id:crypto.randomUUID()},time+1001,()=>0);assert.equal(snapshot.world.projectiles.length,0);assert.equal(snapshot.balance,s.balance-20);for(let i=0;i<3;i++)await assert.rejects(gameV2(env,1,{command:'pause',offer:'offer_moving',seq:snapshot.seq,id:crypto.randomUUID()},time+1002+i,()=>0),/offer unavailable/);snapshot=await gameV2(env,1,{command:'state',id:crypto.randomUUID()},time+1010,()=>0);assert.equal(snapshot.balance,s.balance-20);assert.equal(snapshot.world.offers.length,0);assert.equal((await db.prepare('SELECT SUM(wager) wager,SUM(gaming_payout) win FROM economy_ledger WHERE account_id=1').first()).wager,20);}finally{await mf.dispose();}});
test('unknown and stale followups cannot roll back or reroll accepted physical outcomes',async()=>{for(const variant of ['unknown','stale']){const {mf,db,env,s}=await setup();try{s.world.style='plasma';s.world.styleUntil=time+6000;await fixture(db,s,[fish()]);const launched=await gameV2(env,1,{command:'launch',id:crypto.randomUUID(),seq:s.seq,target:'moving',baseStake:10,tier:5,angle:-Math.PI/2,board:{width:844,height:390}},time+1,()=>4000000000);await assert.rejects(gameV2(env,1,{command:variant==='unknown'?'unknown_probe':'pause',offer:'offer_moving',seq:variant==='stale'?0:launched.seq,id:crypto.randomUUID()},time+1000,()=>4000000000),/unknown|stale/);const snapshot=await gameV2(env,1,{command:'state',id:crypto.randomUUID()},time+1001,()=>0);assert.equal(snapshot.world.projectiles.length,0);assert.equal(snapshot.balance,s.balance-20);assert.equal(snapshot.world.offers.length,0);}finally{await mf.dispose();}}});
test('unused reservations preserve capped earned playthrough, including concurrent consumed spending',async()=>{for(const spend of [false,true]){const {mf,db,env,s}=await setup();try{await db.prepare('UPDATE accounts SET bonus=100,pt=999 WHERE id=1').run();await fixture(db,s,Array.from({length:26},(_,i)=>fish('outside_'+i,2,2)));let a=await gameV2(env,1,{command:'launch',id:crypto.randomUUID(),seq:s.seq,target:'outside_0',baseStake:50,tier:1,angle:-.2,board:{width:844,height:390}},time+1,()=>4000000000);assert.equal(a.pt,999);if(spend){const w=JSON.parse((await db.prepare('SELECT state_json FROM economy_world WHERE account_id=1').first()).state_json);w.fishes.push(fish('consumed'));await db.prepare('UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1').bind(JSON.stringify(w)).run();a=await gameV2(env,1,{command:'launch',id:crypto.randomUUID(),seq:a.seq,target:'consumed',baseStake:10,tier:1,angle:-Math.PI/2,board:{width:844,height:390}},time+201,()=>4000000000);a=await gameV2(env,1,{command:'state',id:crypto.randomUUID()},time+1000,()=>4000000000);assert.equal(a.pt,1000);}a=await gameV2(env,1,{command:'state',id:crypto.randomUUID()},time+9000,()=>4000000000);assert.equal(a.pt,spend?1000:999);}finally{await mf.dispose();}}});
test('launch counts once as a shot and refunded turnover returns to its original tide period',async()=>{const {mf,db,env,s}=await setup();try{await fixture(db,s,Array.from({length:26},(_,i)=>fish('outside_'+i,2,2)));const near=Date.parse('2026-11-10T20:29:58Z');const w=JSON.parse((await db.prepare('SELECT state_json FROM economy_world WHERE account_id=1').first()).state_json);for(const f of w.fishes){f.born=near;f.expires=near+60000;}await db.prepare('UPDATE economy_world SET state_json=? WHERE account_id=1').bind(JSON.stringify(w)).run();await gameV2(env,1,{command:'launch',id:crypto.randomUUID(),seq:s.seq,target:'outside_0',baseStake:20,tier:1,angle:-.2,board:{width:844,height:390}},near,()=>4000000000);let rows=await db.prepare("SELECT rtp_period,SUM(bet) wager,SUM(CASE WHEN type='shots' THEN n ELSE 0 END) shots FROM accounting_events GROUP BY rtp_period").all();assert.deepEqual(rows.results,[{rtp_period:92,wager:20,shots:1}]);await gameV2(env,1,{command:'state',id:crypto.randomUUID()},near+8000,()=>4000000000);rows=await db.prepare("SELECT rtp_period,SUM(bet) wager,SUM(CASE WHEN type='shots' THEN n ELSE 0 END) shots FROM accounting_events GROUP BY rtp_period").all();assert.deepEqual(rows.results,[{rtp_period:92,wager:0,shots:1}]);}finally{await mf.dispose();}});
