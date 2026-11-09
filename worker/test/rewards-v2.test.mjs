import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import bonus from '../../bonusmath.js';
import {dayKey,previousDay,dailyReward,uniform} from '../src/reward-math.js';
import {settleReward} from '../src/reward-store.js';
function database() {
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,tg_id INTEGER,balance INTEGER,sync_seq INTEGER);INSERT INTO accounts VALUES(1,NULL,5000,0),(2,NULL,5000,0),(3,7313143643,5000,0);');
 sql.exec(readFileSync(new URL('../proposals/0003_rewards.sql',import.meta.url),'utf8'));
 const wrap=(query,values=[])=>({bind(...v){return wrap(query,v)},async first(){return sql.prepare(query).get(...values)||null},run(){return sql.prepare(query).run(...values)}});
 return {sql,prepare:q=>wrap(q),async batch(ops){sql.exec('BEGIN');try{const out=ops.map(s=>s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
}
const claim=(extra={})=>({id:'receipt_0001',accountId:1,kind:'daily',reference:'2026-11-07',expectedSeq:0,stake:0,payout:500,result:{day:'2026-11-07',streak:1,pay:500},now:100,...extra});
test('every allowed stake/period/grid gives exactly 50% net profit and proposed RTP',()=>{
 for(let stake=10;stake<=1200;stake+=5)for(const period of [92,88]) {
  let pay=0,positive=0;
  for(let bucket=0;bucket<200;bucket++)for(let line=0;line<5;line++) {
   const result=bonus.outcome(bucket,line,stake,period);
   assert.equal(result.wins.length,bucket<100?0:1);assert.ok(Number.isInteger(result.pay));assert.ok(result.pay<=40000);pay+=result.pay;positive+=result.net>0;
   assert.deepEqual(bonus.evaluate(result.grid,stake,period).wins,result.wins);
  }
  assert.equal(positive,500);assert.equal(pay*100,1000*stake*period);
 }
});
test('fractional stake tiers round down, do not silently round up and cap at 12',()=>{
 assert.equal(bonus.stakeFor(5000,1),50);assert.equal(bonus.stakeFor(5000,5),250);assert.equal(bonus.stakeFor(5000,10),500);
 assert.equal(bonus.stakeFor(50,10),0);assert.equal(bonus.stakeFor(199,10),15);assert.equal(bonus.stakeFor(100000,10),1200);
 assert.throws(()=>bonus.outcome(200,0,10,92));assert.throws(()=>bonus.outcome(1,0,11,92));
});
test('LA daily keys handle local midnight and daylight saving transitions',()=>{
 assert.equal(dayKey('2026-11-08T07:59:59Z'),'2026-11-07');assert.equal(dayKey('2026-11-08T08:00:00Z'),'2026-11-08');
 assert.equal(dayKey('2026-11-08T09:30:00Z'),'2026-11-08');assert.equal(dayKey('2026-11-08T10:30:00Z'),'2026-11-08');
 assert.equal(previousDay('2026-03-09'),'2026-03-08');assert.equal(previousDay('2028-03-01'),'2028-02-29');
});
test('daily rewards preserve distribution, streak cap and same-day refusal',()=>{
 let sum=0;for(let i=0;i<200;i++)sum+=dailyReward('2026-11-07',null,0,i).pay;
 assert.equal(sum/200,499.5);assert.equal(dailyReward('2026-11-07','2026-11-06',7,199).pay,16000);
 assert.equal(dailyReward('2026-11-07','2026-11-01',7,0).streak,1);assert.throws(()=>dailyReward('2026-11-07','2026-11-07',1,0));
});
test('secure integer selector rejects out-of-range tail instead of modulo bias',()=>{
 let n=0;assert.equal(uniform(200,()=>n++?201:4294967295),1);assert.throws(()=>uniform(200,()=>-1));assert.throws(()=>uniform(200,()=>4294967295));
});
test('daily receipt retry and concurrent duplicate do not pay twice',async()=>{
 const db=database();const results=await Promise.all([settleReward(db,claim()),settleReward(db,claim({id:'receipt_0002'}))]);
 assert.equal(results[0].receiptId,results[1].receiptId);assert.equal(db.sql.prepare('SELECT balance FROM accounts WHERE id=1').get().balance,5500);
 const replay=await settleReward(db,claim({id:'receipt_0003',payout:10000,result:{day:'2026-11-07',streak:1,pay:10000}}));assert.equal(replay.pay,500);assert.equal(replay.replayed,true);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM reward_receipts').get().n,1);db.sql.close();
});
test('stale combat sequence, missing eligibility, overspend and protected actor fail closed',async()=>{
 const db=database();
 await assert.rejects(settleReward(db,claim({expectedSeq:1})));await assert.rejects(settleReward(db,claim({accountId:3})),/protected/);
 const spin=claim({kind:'temple_spin',reference:'offer_0001',stake:100,payout:120,result:{pay:120}});
 await assert.rejects(settleReward(db,spin));
 db.sql.exec("INSERT INTO temple_offers VALUES('offer_0001',1,'verified_capture_0001','available',1000);UPDATE accounts SET balance=50 WHERE id=1;");
 await assert.rejects(settleReward(db,spin));assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM reward_receipts').get().n,0);db.sql.close();
});
test('one offer pays once and foreign-account use fails',async()=>{
 const db=database();db.sql.exec("INSERT INTO temple_offers VALUES('offer_0001',1,'verified_capture_0001','available',1000)");
 const spin=claim({kind:'temple_spin',reference:'offer_0001',stake:100,payout:120,result:{pay:120}});
 await assert.rejects(settleReward(db,{...spin,accountId:2}));await settleReward(db,spin);
 await settleReward(db,{...spin,id:'receipt_0002'});assert.equal(db.sql.prepare('SELECT balance FROM accounts WHERE id=1').get().balance,5020);
 assert.equal(db.sql.prepare('SELECT status FROM temple_offers').get().status,'consumed');db.sql.close();
});
test('concurrent different rewards with same combat sequence cannot both debit/credit',async()=>{
 const db=database();db.sql.exec("INSERT INTO temple_offers VALUES('offer_0001',1,'verified_capture_0001','available',1000)");
 const spin=claim({id:'receipt_spin',kind:'temple_spin',reference:'offer_0001',stake:100,payout:120,result:{pay:120}});
 const results=await Promise.allSettled([settleReward(db,claim()),settleReward(db,spin)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.sql.prepare('SELECT sync_seq FROM accounts WHERE id=1').get().sync_seq,1);db.sql.close();
});
test('mismatched receipt result fails validation and transaction failures roll back debit',async()=>{
 const db=database();await assert.rejects(settleReward(db,claim({payout:1000})),/mismatch/);
 db.sql.exec("CREATE TRIGGER reject_final_receipt BEFORE UPDATE OF status ON reward_receipts WHEN NEW.status='settled' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
 await assert.rejects(settleReward(db,claim()),/injected failure/);
 assert.equal(db.sql.prepare('SELECT balance FROM accounts WHERE id=1').get().balance,5000);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM reward_receipts').get().n,0);db.sql.close();
});
