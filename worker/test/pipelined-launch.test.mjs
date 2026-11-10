import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { gameV2 } from "./protocol-client.mjs";
import { actionId } from "../src/retention.js";

const time = Date.parse("2026-11-10T20:10:00Z");
const board = { width: 844, height: 390, safeBottom: 0 };

async function setup() {
  const { mf, db } = await localV2();
  await db
    .prepare(
      "INSERT INTO accounts(id,public_id,pid,balance,bonus,pt,created_at,last_seen) VALUES(1,'RR-PIPE','synthetic_pipe',50000,0,0,0,0)",
    )
    .run();
  const env = { DB: db, GAME_V2: "1" };
  const s = await gameV2(env, 1, { command: "state", id: crypto.randomUUID() }, time, () => 4000000000);
  return { mf, db, env, s };
}
async function fixture(db, s, fishes) {
  s.world.fishes = fishes;
  s.world.director = { spawn: Number.MAX_SAFE_INTEGER, boss: Number.MAX_SAFE_INTEGER, tide: Number.MAX_SAFE_INTEGER, quiet: 0, wave: 0 };
  await db.prepare("UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1").bind(JSON.stringify(s.world)).run();
}
function fish(id = "moving", x = 0.5, y = 0.35) {
  return {
    id, art: "chest", kind: "temple", mult: 12, len: 80, h: 60, born: time - 1000, expires: time + 60000, dead: false,
    motion: { p: [{ x: x - 0.02, y }, { x, y }, { x, y }, { x: x + 0.02, y }], duration: 60000 },
  };
}
function launchBody(seq, more = {}) {
  return { command: "launch", id: actionId(seq), seq, baseStake: 10, tier: 1, angle: -0.2, board, ...more };
}

test("a follow-up launch with a projectile in flight commits in one write (seq + 1)", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(db, s, Array.from({ length: 26 }, (_, i) => fish("outside_" + i, 2, 2)));
    const first = await gameV2(env, 1, launchBody(s.seq, { target: "outside_0" }), time + 1, () => 4000000000);
    assert.equal(first.seq, s.seq + 1);
    assert.equal(first.world.projectiles.length, 1);
    assert.equal(first.balance, s.balance - 10);
    const second = await gameV2(env, 1, launchBody(first.seq, { target: "outside_1" }), time + 201, () => 4000000000);
    assert.equal(second.seq, first.seq + 1, "pre-state + launch must not take two sequences");
    assert.equal(second.balance, first.balance - 10);
    assert.equal(second.world.projectiles.length, 2);
    const launches = (await db.prepare("SELECT COUNT(*) n FROM economy_ledger WHERE account_id=1 AND kind='launch'").first()).n;
    assert.equal(launches, 2);
  } finally {
    await mf.dispose();
  }
});

test("batched shots debit once each, share one seq, and count as n shots", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(db, s, Array.from({ length: 26 }, (_, i) => fish("outside_" + i, 2, 2)));
    const at = time + 1000;
    const shots = [0, 1, 2].map((i) => ({
      id: crypto.randomUUID(),
      angle: -0.2,
      target: "outside_" + i,
      baseStake: 10,
      tier: 1,
      board,
      at: at + i * 165,
    }));
    const launched = await gameV2(env, 1, { command: "launch", id: actionId(s.seq), seq: s.seq, shots }, at + 330, () => 4000000000);
    assert.equal(launched.seq, s.seq + 1);
    assert.equal(launched.balance, s.balance - 30);
    assert.equal(launched.world.projectiles.length, 3);
    assert.equal(launched.detail.launches.length, 3);
    const rows = await db.prepare("SELECT SUM(CASE WHEN type='shots' THEN n ELSE 0 END) shots, SUM(bet) wager FROM accounting_events").first();
    assert.equal(rows.shots, 3);
    assert.equal(rows.wager, 30);
  } finally {
    await mf.dispose();
  }
});

test("5.01 is rejected and an in-flight collision is still committed, not rerolled", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(db, s, [fish()]);
    const launched = await gameV2(
      env, 1,
      launchBody(s.seq, { target: "moving", angle: -Math.PI / 2, baseStake: 10, tier: 5 }),
      time + 1, () => 4000000000,
    );
    assert.equal(launched.detail.launch.stake, 20);
    await assert.rejects(
      gameV2(env, 1, launchBody(launched.seq, { baseStake: 501, angle: -Math.PI / 2 }), time + 1000, () => 4000000000),
      /invalid base stake/,
    );
    const snap = await gameV2(env, 1, { command: "state", id: crypto.randomUUID() }, time + 1001, () => 0);
    assert.equal(snap.world.projectiles.length, 0);
    const after = snap.balance;
    const again = await gameV2(env, 1, { command: "state", id: crypto.randomUUID() }, time + 1010, () => 0);
    assert.equal(again.balance, after, "a later tick must not reroll the committed collision");
    const ledger = await db.prepare("SELECT SUM(wager) wager FROM economy_ledger WHERE account_id=1 AND kind='launch'").first();
    assert.equal(ledger.wager, 20);
  } finally {
    await mf.dispose();
  }
});

test("shots closer than 165ms are cooling down", async () => {
  const { mf, db, env, s } = await setup();
  try {
    await fixture(db, s, Array.from({ length: 26 }, (_, i) => fish("outside_" + i, 2, 2)));
    const shots = [0, 1].map((i) => ({
      id: crypto.randomUUID(), angle: -0.2, target: "outside_" + i, baseStake: 10, tier: 1, board, at: time + 1000 + i * 80,
    }));
    await assert.rejects(
      gameV2(env, 1, { command: "launch", id: actionId(s.seq), seq: s.seq, shots }, time + 1100, () => 4000000000),
      /weapon cooling down/,
    );
    const snap = await gameV2(env, 1, { command: "state", id: crypto.randomUUID() }, time + 1101, () => 0);
    assert.equal(snap.balance, s.balance);
    assert.equal((snap.world.projectiles || []).length, 0);
  } finally {
    await mf.dispose();
  }
});
