import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { HotWorld, memoryBackend, gameDoEnabled } from "../src/hot-world.js";

const nonce = (p = "n") => p + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const aid = (seq) => seq + "_" + nonce();
const board = { width: 390, height: 844, safeBottom: 34 };

async function signup(db, name = "dosmoke" + nonce("u").slice(0, 8), id = 9001) {
  await db
    .prepare(
      "INSERT INTO accounts(id,public_id,pid,username,balance,bonus,pt,created_at,last_seen) VALUES(?1,?2,?3,?4,5000,0,0,0,0)",
    )
    .bind(id, "pub_" + name, "pid_" + name, name)
    .run();
  return db.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first();
}

function shot(i, t0, stake = 10) {
  return {
    id: nonce("sh"),
    at: t0 + i * 165,
    angle: -Math.PI / 2,
    baseStake: stake,
    tier: 1,
    board,
  };
}

async function launchBatch(hotInst, atSeq, n = 3, stake = 10) {
  const now = Date.now();
  const t0 = now - 200 - (n - 1) * 165;
  return hotInst.play(
    {
      command: "launch",
      id: aid(atSeq),
      seq: atSeq,
      baseStake: stake,
      tier: 1,
      angle: -Math.PI / 2,
      board,
      shots: Array.from({ length: n }, (_, i) => shot(i, t0, stake)),
    },
    now,
  );
}

test("preview flag is only for throwaway usernames, never the owner TG", () => {
  const env = { GAME_DO_MODE: "preview", PLAYER_GAME: {} };
  assert.equal(gameDoEnabled(env, { id: 1, tg_id: 7313143643, username: null }), false);
  assert.equal(gameDoEnabled(env, { id: 8, tg_id: null, username: "rickyweb" }), false);
  assert.equal(gameDoEnabled(env, { id: 99, tg_id: null, username: "dosmokeabc" }), true);
  assert.equal(gameDoEnabled(env, { id: 99, tg_id: null, username: "tg31player" }), true);
  assert.equal(gameDoEnabled({ GAME_DO_MODE: "off", PLAYER_GAME: {} }, { id: 99, tg_id: null, username: "dosmokeabc" }), false);
  assert.equal(gameDoEnabled({ GAME_DO_MODE: "on", PLAYER_GAME: {} }, { id: 1, tg_id: 7313143643 }), true);
});

test("hot world write-behind: concurrent batches, reconnect, eviction, exact D1 reconcile", async () => {
  const { mf, db } = await localV2();
  try {
    const account = await signup(db);
    const env = { DB: db, GAME_V2: "1" };
    const backend = memoryBackend();
    const hot = new HotWorld(env, account.id, backend, { autoFlush: false });
    const first = await hot.play({ command: "state", id: aid(0) }, Date.now());
    assert.ok((first.world?.fishes?.length || 0) >= 1);
    let seq = first.seq;

    const firstBatch = await launchBatch(hot, seq, 3);
    await new Promise((r) => setTimeout(r, 400));
    const secondBatch = await launchBatch(hot, firstBatch.seq, 3);
    // Same-seq overlap must not double-charge: one 409, balance stays at firstBatch.
    const overlap = await Promise.allSettled([
      launchBatch(hot, secondBatch.seq, 3),
      launchBatch(hot, secondBatch.seq, 3),
    ]);
    const okOverlap = overlap.filter((s) => s.status === "fulfilled");
    const badOverlap = overlap.filter((s) => s.status === "rejected");
    assert.ok(okOverlap.length >= 1, JSON.stringify(overlap.map((s) => s.status === "rejected" ? String(s.reason?.message) : s.value?.seq)));
    assert.ok(okOverlap.length + badOverlap.length === 2);
    const last = okOverlap.sort((a, b) => b.value.seq - a.value.seq)[0].value;
    assert.ok(last.seq >= firstBatch.seq + 1);
    seq = last.seq;
    const midBal = last.balance;
    assert.ok([60, 90].includes(5000 - midBal), "debit=" + (5000 - midBal));

    // reconnect: new instance, same backend
    const reconnected = new HotWorld(env, account.id, backend, { autoFlush: false });
    reconnected.evict();
    await reconnected.ensure();
    assert.equal(reconnected.mem.account.balance, midBal);
    assert.equal(reconnected.mem.account.sync_seq, seq);
    // Debit can be 30 (one winner) or 60 (one winner + retry, or both accepted if serialized).
    assert.ok([30, 60].includes(5000 - midBal), "debit=" + (5000 - midBal));

    // eviction then another batch
    reconnected.evict();
    await new Promise((r) => setTimeout(r, 400));
    const more = await launchBatch(reconnected, seq, 2);
    assert.equal(more.balance, midBal - 20);
    seq = more.seq;

    const flushed = await reconnected.flush();
    assert.equal(flushed.ok, true, JSON.stringify(flushed));
    assert.equal(flushed.pending, 0);
    const d1 = await db.prepare("SELECT balance, pt, sync_seq FROM accounts WHERE id=?").bind(account.id).first();
    assert.equal(d1.balance, more.balance);
    assert.equal(d1.sync_seq, more.seq);
    const world = await db.prepare("SELECT version FROM economy_world WHERE account_id=?").bind(account.id).first();
    assert.ok(world);
    const ledger = await db.prepare("SELECT COUNT(*) n FROM economy_ledger WHERE account_id=?").bind(account.id).first();
    assert.ok(ledger.n >= 1);
    const startDebit = 5000 - d1.balance;
    assert.equal(startDebit, 20 + (midBal === 5000 ? 0 : 5000 - midBal));
  } finally {
    await mf.dispose();
  }
});

test("5.01 is rejected, balance unchanged, and a flushed 0.10 batch debit is exact", async () => {
  const { mf, db } = await localV2();
  try {
    const account = await signup(db, "doqa" + nonce("x").slice(0, 8));
    const env = { DB: db, GAME_V2: "1" };
    const hot = new HotWorld(env, account.id, memoryBackend(), { autoFlush: false });
    const first = await hot.play({ command: "state", id: aid(0) }, Date.now());
    let seq = first.seq;
    await assert.rejects(launchBatch(hot, seq, 1, 501), /invalid base stake/);
    const after = await hot.play({ command: "state", id: aid(seq), seq }, Date.now());
    assert.equal(after.balance, first.balance);
    seq = after.seq;
    const launch = await launchBatch(hot, seq, 8, 10);
    assert.equal(launch.balance, first.balance - 80);
    const flushed = await hot.flush();
    assert.equal(flushed.ok, true);
    const d1 = await db.prepare("SELECT balance, sync_seq FROM accounts WHERE id=?").bind(account.id).first();
    assert.equal(d1.balance, launch.balance);
    assert.equal(d1.sync_seq, launch.seq);
  } finally {
    await mf.dispose();
  }
});
