/* NOT ROUTED. D1 atomic receipt prototype; test only until combat authority lands.
   db.batch is a single transaction. Caller must provide an authenticated canonical
   account id, flushed combat sequence, server-generated result and claim key.
   No client-supplied payout or eligibility is permitted by a future route. */
import { PROTECTED_TG_ID } from './tg.js';
export async function settleReward(db, claim) {
  const {id,accountId,kind,reference,expectedSeq,stake,payout,result,now}=claim;
  if(!/^[a-zA-Z0-9_-]{8,96}$/.test(id)||!Number.isSafeInteger(accountId)||accountId<=0||!['daily','temple_spin'].includes(kind)||typeof reference!=='string'||reference.length<1||reference.length>96||!Number.isSafeInteger(expectedSeq)||expectedSeq<0||!Number.isSafeInteger(stake)||stake<0||!Number.isSafeInteger(payout)||payout<0||payout>40000||!Number.isSafeInteger(now))throw new Error('invalid claim');
  if(!result || result.pay!==payout)throw new Error('result/payout mismatch');
  if(kind==='daily'&&(stake!==0||result.day!==reference||!Number.isInteger(result.streak)||result.streak<1||result.streak>7))throw new Error('invalid daily');
  if(kind==='temple_spin'&&(stake<10||stake>1200||stake%5))throw new Error('invalid stake');
  const account=await db.prepare('SELECT tg_id FROM accounts WHERE id=?1').bind(accountId).first();
  if(!account||account.tg_id===PROTECTED_TG_ID)throw new Error('protected or missing account');
  const existing=await db.prepare("SELECT * FROM reward_receipts WHERE account_id=?1 AND kind=?2 AND reference=?3 AND status='settled'").bind(accountId,kind,reference).first();
  if(existing)return {...JSON.parse(existing.result_json),receiptId:existing.id,replayed:true};
  const offer=kind==='temple_spin'?"AND EXISTS(SELECT 1 FROM temple_offers o WHERE o.id=?11 AND o.account_id=a.id AND o.status='available' AND o.expires_at>?10)":'';
  const args=[id,accountId,kind,reference,expectedSeq,stake,payout,JSON.stringify(result),PROTECTED_TG_ID,now];
  if(kind==='temple_spin')args.push(reference);
  const insert=db.prepare(`INSERT INTO reward_receipts(id,account_id,kind,reference,expected_seq,stake,payout,result_json,status,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,'pending',?10 FROM accounts a
    WHERE a.id=?2 AND (a.tg_id IS NULL OR a.tg_id<>?9) AND a.sync_seq=?5 AND a.balance>=?6 ${offer}
    ON CONFLICT DO NOTHING`).bind(...args);
  const guard="EXISTS(SELECT 1 FROM reward_receipts r WHERE r.id=?1 AND r.account_id=accounts.id AND r.status='pending' AND r.expected_seq=accounts.sync_seq)";
  const debit=db.prepare(`UPDATE accounts SET balance=balance-?3+?4, sync_seq=sync_seq+1 WHERE id=?2 AND ${guard} AND (tg_id IS NULL OR tg_id<>?5)`).bind(id,accountId,stake,payout,PROTECTED_TG_ID);
  const operations=[insert,debit];
  if(kind==='daily')operations.push(db.prepare("UPDATE accounts SET daily_day_v2=?3,daily_streak_v2=?4 WHERE id=?2 AND EXISTS(SELECT 1 FROM reward_receipts r WHERE r.id=?1 AND r.account_id=accounts.id AND r.status='pending' AND accounts.sync_seq=r.expected_seq+1)").bind(id,accountId,result.day,result.streak));
  else operations.push(db.prepare("UPDATE temple_offers SET status='consumed' WHERE id=?3 AND account_id=?2 AND EXISTS(SELECT 1 FROM reward_receipts r JOIN accounts a ON a.id=r.account_id WHERE r.id=?1 AND r.status='pending' AND a.sync_seq=r.expected_seq+1)").bind(id,accountId,reference));
  operations.push(db.prepare("UPDATE reward_receipts SET status='settled' WHERE id=?1 AND status='pending' AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=reward_receipts.account_id AND a.sync_seq=reward_receipts.expected_seq+1)").bind(id));
  await db.batch(operations);
  const stored=await db.prepare("SELECT * FROM reward_receipts WHERE account_id=?1 AND kind=?2 AND reference=?3 AND status='settled'").bind(accountId,kind,reference).first();
  if(!stored)throw new Error('stale sequence, insufficient balance or unavailable offer');
  return {...JSON.parse(stored.result_json),receiptId:stored.id,replayed:stored.id!==id};
}
