import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { gameV2 } from "../src/game-v2.js";

const time = Date.parse("2026-11-10T20:10:00Z");

test("no-seq discovery ticks a fully expired world so the first paint is not an empty tank", async () => {
  const { mf, db } = await localV2();
  try {
    const env = { DB: db, GAME_V2: "1" };
    await db
      .prepare(
        "INSERT INTO accounts(id,public_id,pid,balance,bonus,pt,created_at,last_seen) VALUES(1,'RR-S1','stale_one',50000,10000,0,0,0)",
      )
      .run();
    let s = await gameV2(
      env,
      1,
      { command: "state", id: crypto.randomUUID() },
      time,
      () => 4000000000,
    );
    assert.ok(s.world.fishes.length > 0, "fresh world has fish");
    const seq = s.seq;
    for (const f of s.world.fishes) {
      f.expires = time + 1;
      f.born = time - 30000;
    }
    // Overdue director too, the way a hours-old persisted world looks.
    s.world.director = {
      spawn: time - 60000,
      boss: time - 60000,
      tide: time - 60000,
      quiet: 0,
      wave: 0,
    };
    await db
      .prepare("UPDATE economy_world SET state_json=? WHERE account_id=1")
      .bind(JSON.stringify(s.world))
      .run();
    const later = time + 60000;
    const snap = await gameV2(
      env,
      1,
      { command: "state", id: crypto.randomUUID() },
      later,
      () => 1000000000,
    );
    const live = (snap.world.fishes || []).filter(
      (f) => !f.dead && f.expires > later,
    );
    assert.ok(
      live.length > 0,
      "stale discovery must spawn a living reef, got " +
        live.length +
        " live of " +
        (snap.world.fishes || []).length,
    );
    assert.ok(snap.seq >= seq, "stale discovery may commit a tick");

    const seq2 = snap.seq;
    const again = await gameV2(
      env,
      1,
      { command: "state", id: crypto.randomUUID() },
      later + 100,
      () => {
        throw new Error("fresh discovery ran RNG");
      },
    );
    assert.equal(again.seq, seq2, "a still-living world stays read-only");
    const still = (again.world.fishes || []).filter(
      (f) => !f.dead && f.expires > later + 100,
    );
    assert.ok(still.length > 0);
  } finally {
    await mf.dispose();
  }
});
