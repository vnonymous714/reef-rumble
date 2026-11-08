/* Trusted server-side adjustments only; no client-facing raw balance authority. */
import { PROTECTED_TG_ID } from "./tg.js";
const error = (message, status = 409) =>
  Object.assign(new Error(message), { status });
export async function adjustCanonical(env, account, change, now = Date.now()) {
  if (account.tg_id === PROTECTED_TG_ID) throw error("protected", 403);
  const { id, op, amount, reason } = change;
  if (
    !/^[a-zA-Z0-9_-]{8,96}$/.test(id || "") ||
    !["add", "set", "reset"].includes(op)
  )
    throw error("invalid adjustment", 400);
  const before = account.balance,
    after =
      op === "add"
        ? Math.max(0, before + amount)
        : op === "reset"
          ? 5000
          : Math.max(0, amount);
  if (!Number.isSafeInteger(after) || after > 99999999999)
    throw error("invalid balance", 400);
  const db = env.DB,
    canonical = JSON.stringify({ op, amount, reason }),
    seq = account.sync_seq;
  const prior = await db
    .prepare(
      "SELECT request_json,response_json FROM economy_actions WHERE account_id=?1 AND id=?2",
    )
    .bind(account.id, id)
    .first();
  if (prior) {
    if (prior.request_json !== canonical)
      throw error("adjustment id reused", 400);
    return { ...JSON.parse(prior.response_json), replayed: true };
  }
  const pending =
    "EXISTS(SELECT 1 FROM economy_actions e WHERE e.account_id=?1 AND e.id=?2 AND e.status='pending')";
  const receipt = { before, balance: after, seq: seq + 1 };
  await db.batch([
    db
      .prepare(
        "INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at) SELECT ?1,?2,?3,?4,?5,'pending',0,0,?6 FROM accounts WHERE id=?1 AND sync_seq=?5 AND balance=?7 AND (tg_id IS NULL OR tg_id<>?8) ON CONFLICT DO NOTHING",
      )
      .bind(
        account.id,
        id,
        canonical,
        JSON.stringify(receipt),
        seq,
        now,
        before,
        PROTECTED_TG_ID,
      ),
    db
      .prepare(
        `UPDATE accounts SET balance=?3,sync_seq=sync_seq+1,last_seen=?4 WHERE id=?1 AND sync_seq=?5 AND ${pending}`,
      )
      .bind(account.id, id, after, now, seq),
    db
      .prepare(
        `UPDATE players SET balance=?3,sync_seq=?4 WHERE tg_id=(SELECT tg_id FROM accounts WHERE id=?1) AND ${pending}`,
      )
      .bind(account.id, id, after, seq + 1),
    db
      .prepare(
        `INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,external_delta,account_seq) SELECT ?1,?2,?3,0,0,?4,?5,?6,?7 WHERE ${pending}`,
      )
      .bind(account.id, id, "admin_" + op, after, now, after - before, seq + 1),
    db
      .prepare(
        `INSERT INTO audit_log(account_id,pid,public_id,username,action,amount,reason,bal_before,bal_after,created_at) SELECT id,pid,public_id,username,?3,?4,?5,?6,?7,?8 FROM accounts WHERE id=?1 AND ${pending}`,
      )
      .bind(account.id, id, op, amount, reason, before, after, now),
    db
      .prepare(
        "UPDATE economy_actions SET status='settled' WHERE account_id=?1 AND id=?2 AND status='pending'",
      )
      .bind(account.id, id),
  ]);
  const settled = await db
    .prepare(
      "SELECT response_json FROM economy_actions WHERE account_id=?1 AND id=?2 AND status='settled'",
    )
    .bind(account.id, id)
    .first();
  if (!settled)
    throw error("account changed concurrently; refresh before adjustment");
  return JSON.parse(settled.response_json);
}
