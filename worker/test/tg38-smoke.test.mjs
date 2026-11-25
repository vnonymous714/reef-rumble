// Runs the exact post-deploy smoke script (tools/tg38-smoke.mjs) against the
// local Worker + DO (miniflare, batched on) and checks the D1 queries the deploy
// plan uses. Local only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localV2 } from "./local-v2.mjs";
import { run } from "../../tools/tg38-smoke.mjs";

test("tg38 smoke script: one signup + shots + logout leaves D1 exact (batched)", async () => {
  const { mf, db } = await localV2({ gameDoMode: "on", bindings: { GAME_BATCH: "on", GAME_DO_HINT: "enam" } });
  try {
    await db.prepare("INSERT INTO accounts(id,public_id,pid,tg_id,balance,bonus,pt,sync_seq,created_at,last_seen) VALUES(1,'RR-000001','pid_owner',7313143643,127222,10000,0,75,0,0)").run();
    const out = await run("http://localhost", (u, init) => mf.dispatchFetch(u, init), { shots: 4 });
    assert.equal(out.clientBuild, "tg41");
    assert.ok(out.lookaheadMs > 0, "server scheduled upcoming fish");
    assert.ok(out.visibleFish > 0);
    assert.equal(out.fired, 4);
    assert.equal(out.batched, 1);
    // The plan's D1 verification query:
    const a = await db.prepare("SELECT a.id,a.balance,a.sync_seq,(SELECT COUNT(*) FROM economy_ledger l WHERE l.account_id=a.id) rows_,(SELECT COALESCE(SUM(n),0) FROM economy_ledger l WHERE l.account_id=a.id) bullets,(SELECT COALESCE(SUM(payout-wager+external_delta+promo_credit),0) FROM economy_ledger l WHERE l.account_id=a.id) delta FROM accounts a WHERE a.username=?").bind(out.username).first();
    assert.equal(a.balance, out.servedBalance, "D1 == served after logout flush");
    assert.equal(a.sync_seq, out.servedSeq);
    assert.equal(a.balance, out.startBalance + a.delta, "ledger reconciles");
    assert.ok(a.bullets >= 4, JSON.stringify(a));
    const owner = await db.prepare("SELECT balance,bonus,sync_seq FROM accounts WHERE id=1").first();
    assert.deepEqual(owner, { balance: 127222, bonus: 10000, sync_seq: 75 });
  } finally { await mf.dispose(); }
});
