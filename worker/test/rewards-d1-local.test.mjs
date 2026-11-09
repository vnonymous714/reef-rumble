/* Explicitly local Miniflare D1 only. No Wrangler config/env credentials loaded. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {settleReward} from '../src/reward-store.js';
const base={id:'receipt_local_1',accountId:1,kind:'daily',reference:'2026-11-07',expectedSeq:0,stake:0,payout:500,result:{day:'2026-11-07',streak:1,pay:500},now:100};
test('real local D1: concurrent daily/spin receipts, replay, sequence and transaction rollback',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("local test only")}}',compatibilityDate:'2026-10-01',d1Databases:{DB:'reward-tests-local-only'},d1Persist:false}));
 try {
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE accounts(id INTEGER PRIMARY KEY,tg_id INTEGER,balance INTEGER,sync_seq INTEGER)').run();
  await db.prepare('INSERT INTO accounts VALUES(1,NULL,5000,0),(2,NULL,5000,0)').run();
  const schema=readFileSync(new URL('../proposals/0003_rewards.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');
  for(const statement of schema.split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  const same=await Promise.all([settleReward(db,base),settleReward(db,{...base,id:'receipt_local_2'})]);
  assert.equal(same[0].receiptId,same[1].receiptId);assert.equal((await db.prepare('SELECT balance FROM accounts WHERE id=1').first()).balance,5500);
  await db.prepare("INSERT INTO temple_offers VALUES('offer_local_1',1,'verified_dummy_local_capture','available',1000)").run();
  const spin={...base,id:'receipt_spin_1',kind:'temple_spin',reference:'offer_local_1',expectedSeq:1,stake:100,payout:120,result:{pay:120}};
  await settleReward(db,spin);await settleReward(db,{...spin,id:'receipt_spin_2'});
  assert.equal((await db.prepare('SELECT balance FROM accounts WHERE id=1').first()).balance,5520);
  assert.equal((await db.prepare('SELECT sync_seq FROM accounts WHERE id=1').first()).sync_seq,2);
  assert.equal((await db.prepare('SELECT status FROM temple_offers').first()).status,'consumed');
  await assert.rejects(settleReward(db,{...base,id:'receipt_stale',reference:'2026-11-08',result:{day:'2026-11-08',streak:2,pay:500}}));
  await db.prepare("CREATE TRIGGER reject_final_receipt BEFORE UPDATE OF status ON reward_receipts WHEN NEW.status='settled' BEGIN SELECT RAISE(ABORT,'local rollback sentinel'); END").run();
  await assert.rejects(settleReward(db,{...base,id:'receipt_rollback',accountId:2}),/local rollback sentinel/);
  assert.equal((await db.prepare('SELECT balance FROM accounts WHERE id=2').first()).balance,5000);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM reward_receipts WHERE account_id=2').first()).n,0);
 }finally{await mf.dispose();}
});
