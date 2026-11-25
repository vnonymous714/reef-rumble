// tg40 end to end on in-memory D1: a page that sends motion:2 gets tg40 fish
// and its aimed shots at wobbling / darting / U-turning fish settle as normal
// hits with conserved credits; a page that doesn't send it keeps plain fish.
import assert from "node:assert/strict";
import test from "node:test";
import { localV2 } from "./local-v2.mjs";
import { gameV2 } from "../src/game-v2.js";
import { actionId } from "../src/retention.js";
import motion from "../../reef-motion.js";

const T0 = Date.parse("2026-11-10T20:10:00Z"), board = { width: 844, height: 390 };
function xs(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; }; }
const tg40 = (f) => !!(f.motion.s || f.motion.w || f.motion.sp);

async function play(db, env, id, flag, shots) {
  await db.prepare("INSERT INTO accounts(id,public_id,pid,balance,created_at,last_seen) VALUES(?1,?2,?3,1000000,0,0)").bind(id, "RR-T40-" + id, "t40_" + id).run();
  const rng = xs(id * 99), extra = flag ? { motion: 2 } : {};
  let now = T0, s = await gameV2(env, id, { command: "state", id: crypto.randomUUID(), ...extra }, now, rng), launched = 0, spawned = new Map();
  for (let n = 0; n < shots; n++) {
    now += 900;
    for (const f of s.world.fishes) spawned.set(f.id, f);
    const v = s.world.fishes.filter((f) => !f.dead && f.born <= now && f.expires > now && f.kind !== "laser")
      .map((f) => ({ f, p: motion.point(f, now, 844, 390) }))
      .map((v) => ({ ...v, a: Math.atan2(v.p.y - 372, v.p.x - 422) }))
      .find((v) => v.p.x > 40 && v.p.x < 804 && v.p.y > 20 && v.p.y < 320 && v.a > -Math.PI + 0.12 && v.a < -0.12);
    if (!v) { s = await gameV2(env, id, { command: "state", id: actionId(s.seq), seq: s.seq, ...extra }, now, rng); continue; }
    s = await gameV2(env, id, { command: "launch", id: actionId(s.seq), seq: s.seq, baseStake: 10, tier: 1, angle: v.a, target: v.f.id, board, ...extra }, now, rng);
    launched++;
  }
  s = await gameV2(env, id, { command: "state", id: actionId(s.seq), seq: s.seq, ...extra }, now + 15000, rng);
  const l = await db.prepare("SELECT SUM(wager) w,SUM(wager_refund) r,SUM(gaming_payout) g FROM economy_ledger WHERE account_id=?").bind(id).first();
  const a = await db.prepare("SELECT balance FROM accounts WHERE id=?").bind(id).first();
  return { s, launched, fish: [...spawned.values()], l, balance: a.balance };
}

test("motion:2 page: tg40 fish spawn, aimed shots hit and settle, credits conserved", async () => {
  const { mf, db } = await localV2(), env = { DB: db, GAME_V2: "1" };
  try {
    const r = await play(db, env, 1, true, 120);
    assert.equal(r.s.world.motionV, 2);
    assert.ok(r.fish.filter(tg40).length > 20, "tg40 fish spawned: " + r.fish.filter(tg40).length);
    assert.ok(r.launched > 100);
    assert.equal(r.s.world.projectiles.length, 0);
    assert.ok(r.l.r / r.l.w < 0.05, "aimed shots at moving fish land (refund share " + (r.l.r / r.l.w).toFixed(3) + ")");
    assert.equal(r.balance, 1000000 - r.l.w + r.l.r + r.l.g, "ledger reconciles balance");
  } finally { await mf.dispose(); }
});

test("page without motion:2 keeps pre-tg40 fish only", async () => {
  const { mf, db } = await localV2(), env = { DB: db, GAME_V2: "1" };
  try {
    const r = await play(db, env, 2, false, 40);
    assert.ok(!r.s.world.motionV);
    assert.equal(r.fish.filter(tg40).length, 0);
    assert.equal(r.s.world.projectiles.length, 0);
  } finally { await mf.dispose(); }
});
