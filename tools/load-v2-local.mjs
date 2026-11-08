/* Synthetic in-memory D1 command-load sample, NOT production throughput/RTP. */
import { writeFile } from "node:fs/promises";
import { localV2 } from "../worker/test/local-v2.mjs";
import { gameV2 } from "../worker/src/game-v2.js";
import {actionId,RECEIPT_KEEP} from "../worker/src/retention.js";
const { mf, db } = await localV2(),
  env = { DB: db, GAME_V2: "1" },
  time = Date.parse("2026-11-10T20:10:00Z"),
  started = performance.now(),
  players = process.argv.includes("--quick")?10:50,
  shots = process.argv.includes("--quick")?5:20;
try {
  await db.batch(
    Array.from({ length: players }, (_, i) =>
      db
        .prepare(
          "INSERT INTO accounts(id,public_id,pid,balance,created_at,last_seen) VALUES(?1,?2,?3,50000,0,0)",
        )
        .bind(i + 1, "RR-LOAD" + i, "local_load_" + i),
    ),
  );
  await Promise.all(
    Array.from({ length: players }, async (_, i) => {
      const id = i + 1;
      let s = await gameV2(
        env,
        id,
        { command: "state", id: crypto.randomUUID() },
        time,
        () => 4000000000,
      );
      s.world.fishes = Array.from({ length: 26 }, (_, j) => ({
        id: "outside_" + j,
        art: "minnow",
        mult: 2,
        kind: "normal",
        len: 34,
        h: 14,
        born: time,
        expires: time + 60000,
        motion: {
          p: Array.from({ length: 4 }, () => ({ x: 2, y: 2 })),
          duration: 60000,
          off: 0,
        },
      }));
      s.world.director = {
        spawn: Number.MAX_SAFE_INTEGER,
        boss: Number.MAX_SAFE_INTEGER,
        tide: Number.MAX_SAFE_INTEGER,
        quiet: 0,
        wave: 0,
      };
      await db
        .prepare(
          "UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=?",
        )
        .bind(JSON.stringify(s.world), id)
        .run();
      for (let n = 1; n <= shots; n++)
        s = await gameV2(
          env,
          id,
          {
            command: "launch",
            id: actionId(s.seq),
            seq: s.seq,
            baseStake: 10,
            tier: 1,
            angle: -Math.PI / 2,
            board: { width: 844, height: 390 },
          },
          time + n * 200,
          () => 4000000000,
        );
      s = await gameV2(
        env,
        id,
        { command: "state", id: actionId(s.seq),seq:s.seq },
        time + 13000,
        () => 4000000000,
      );
      if (s.balance !== 50000 || s.world.projectiles.length)
        throw Error("Refund/conservation failed for synthetic actor " + id);
    }),
  );
  const actions = await db
      .prepare(
        "SELECT COUNT(*) actions,SUM(length(request_json)+length(response_json)) payloadBytes,AVG(length(request_json)+length(response_json)) averagePayloadBytes,MAX(length(request_json)+length(response_json)) maxPayloadBytes FROM economy_actions",
      )
      .first(),
    worlds = await db
      .prepare(
        "SELECT COUNT(*) worlds,SUM(length(state_json)) payloadBytes FROM economy_world",
      )
      .first(),
    ledger = await db
      .prepare(
        "SELECT COUNT(*) records,SUM(wager) reserved,SUM(wager_refund) refunded,SUM(gaming_payout) gamingPayout FROM economy_ledger",
      )
      .first();
  const report = {
    kind: "LOCAL_SYNTHETIC_COMMAND_LOAD_NOT_PRODUCTION",
    players,
    shotsPerPlayer: shots,
    acceptedCommands: players * (shots + 2),
    wallSeconds: (performance.now() - started) / 1000,
    actions,
    worlds,
    ledger,
    receiptWindowPerActor:RECEIPT_KEEP,
    sampledReceiptPayloadAt50Actors:50*RECEIPT_KEEP*actions.averagePayloadBytes,
    counterfactualUncompactedPayloadPerHourAt50Players5ShotsPerSecond:900000*(actions.actions/(players*shots))*actions.averagePayloadBytes,
    limits: [
      "Direct module+D1, not HTTP/TG/mobile end-to-end or production D1 throughput.",
      "All shots deliberately miss and refund; this is concurrency/conservation, NOT an RTP simulation.",
      "Logical payload excludes SQL/index/page overhead and additional state receipts.",
      "This small run does not reach retirement threshold; separate105000-record storage test measures compaction. Sample-based payload estimates are not hard bounds or production throughput guarantees.",
    ],
  };
  await writeFile(
    new URL("../docs/local-v3-load.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mf.dispose();
}
