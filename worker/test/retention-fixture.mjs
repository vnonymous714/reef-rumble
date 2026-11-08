import {actionId} from '../src/retention.js';
import {gameV2} from '../src/game-v2.js';
export const time=Date.parse('2026-11-10T20:10:00Z');
export async function seedAccount(db,id=1){
 await db.prepare('INSERT INTO accounts(id,public_id,pid,balance,bonus,pt,created_at,last_seen) VALUES(?,?,?,1000000,0,0,0,0)').bind(id,'RR-RET-'+id,'ret_'+id).run();
 return gameV2({DB:db,GAME_V2:'1'},id,{command:'state',id:crypto.randomUUID()},time,()=>4000000000);
}
export async function seedRecords(db,id,start,count,now=time){
 const end=start+count-1;
 await db.batch([
 db.prepare(`WITH RECURSIVE nums(n) AS(SELECT ?2 UNION ALL SELECT n+1 FROM nums WHERE n<?3) INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at) SELECT ?1,CAST(n AS INTEGER)||'_synthetic_record','h3:synthetic','{"balance":1,"seq":1,"detail":{}}',n,'settled',CASE WHEN n%2=0 THEN 10 ELSE 0 END,CASE WHEN n%2=1 THEN 7 ELSE 0 END,?4+n*165 FROM nums`).bind(id,start,end,now),
 db.prepare(`INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,gaming_payout,account_seq,rtp_period) SELECT account_id,id,CASE WHEN wager>0 THEN 'launch' ELSE 'state' END,wager,payout,0,created_at,payout,expected_seq+1,CASE WHEN expected_seq%3=0 THEN 88 ELSE 92 END FROM economy_actions WHERE account_id=?1 AND expected_seq BETWEEN ?2 AND ?3`).bind(id,start,end),
 db.prepare('UPDATE accounts SET sync_seq=?,balance=balance+(SELECT SUM(payout-wager) FROM economy_actions WHERE account_id=? AND expected_seq BETWEEN ? AND ?) WHERE id=?').bind(end+1,id,start,end,id)
 ]);
}
export async function drain(db,id,now=time){
 const {compactAccount,RECEIPT_KEEP}=await import('../src/retention.js');let count=0;
 for(let i=0;i<100;i++){const a=await db.prepare('SELECT sync_seq FROM accounts WHERE id=?').bind(id).first(),r=await compactAccount(db,id,now);count+=r.compacted;if(r.floor>=a.sync_seq-RECEIPT_KEEP)break;if(i===99)throw Error('compaction did not converge');}return count;
}
export async function totals(db,id=1){
 return db.prepare(`SELECT SUM(wager) wager,SUM(payout) payout,SUM(wager_refund) refund,SUM(gaming_payout) win,SUM(promo_credit) promo,SUM(external_delta) external FROM (SELECT wager,payout,wager_refund,gaming_payout,promo_credit,external_delta FROM economy_ledger WHERE account_id=?1 UNION ALL SELECT wager,payout,wager_refund,gaming_payout,promo_credit,external_delta FROM economy_archive WHERE account_id=?1)`).bind(id).first();
}
export const body=(command,seq,more={})=>({command,seq,id:actionId(seq),...more});
