import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localV2} from './local-v2.mjs';
import {gameV2} from '../src/game-v2.js';
import {actionId,compactAccount,RECEIPT_KEEP} from '../src/retention.js';
import {seedAccount,seedRecords,drain,totals,body,time} from './retention-fixture.mjs';

test('expired daily/slot receipts never replay money; exact bonus grid and pending result survive reload/compaction',async()=>{
 const {mf,db}=await localV2();try{
 const env={DB:db,GAME_V2:'1'};let s=await seedAccount(db);
 const claim=body('daily',s.seq);s=await gameV2(env,1,claim,time+1,()=>199);
 const daily=s.detail.daily,afterDaily=s.balance;
 assert.equal((await gameV2(env,1,claim,time+2,()=>0)).balance,afterDaily);
 s.world.offers=[{id:'synthetic_capture_offer',source:'synthetic_capture',expires:time+60000,consumed:false}];
 await db.prepare('UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1').bind(JSON.stringify(s.world)).run();
 s=await gameV2(env,1,body('pause',s.seq,{offer:'synthetic_capture_offer'}),time+3,()=>199);
 const spin=body('spin',s.seq,{offer:'synthetic_capture_offer',quoteId:s.world.offers[0].quotes[0].id});
 s=await gameV2(env,1,spin,time+4,()=>199);assert.ok(s.detail.bonus.pay>0);
 const grid=s.detail.bonus,balance=s.balance;
 const replay=await gameV2(env,1,{...spin,recoverOnly:true},time+5,()=>0);
 assert.equal(replay.replayed,true);assert.equal(replay.balance,balance);assert.deepEqual(replay.detail.bonus,grid);
 await seedRecords(db,1,s.seq,700);const before=await totals(db);await drain(db,1);
 assert.deepEqual(await totals(db),before);
 for(const old of [claim,spin])for(const variant of [old,{...old,recoverOnly:true},{...old,seq:s.seq+700}])
   await assert.rejects(gameV2(env,1,variant,time+10,()=>{throw Error('expired command ran RNG');}),e=>e.status===410&&e.code==='receipt_expired');
 const reloaded=await gameV2(env,1,{command:'state',id:crypto.randomUUID()},time+11,()=>{throw Error('bootstrap ran RNG');});
 assert.deepEqual(reloaded.world.lastBonus,grid);assert.equal(reloaded.world.resultPending,true);
 await assert.rejects(gameV2(env,1,body('spin',reloaded.seq,{offer:spin.offer,quoteId:spin.quoteId}),time+12),/unavailable/);
 await assert.rejects(gameV2(env,1,body('daily',reloaded.seq),time+12),/already claimed/);
 assert.deepEqual((await gameV2(env,1,{command:'state'},time+13)).balance,reloaded.balance);
 assert.equal(daily.day,reloaded.daily.day);
 }finally{await mf.dispose();}
});

test('arbitrary stale IDs, sequence substitution, future sequences and unknown recoveries fail without RNG or money',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,GAME_V2:'1'};let s=await seedAccount(db);await seedRecords(db,1,s.seq,700);await drain(db,1);s=await gameV2(env,1,{command:'state'},time);
 const before=await db.prepare('SELECT balance,sync_seq FROM accounts WHERE id=1').first();
 for(const b of [
 {command:'daily',id:crypto.randomUUID(),seq:s.seq},
 {command:'daily',id:actionId(s.seq),seq:s.seq-1},
 {command:'daily',id:actionId(s.seq+1),seq:s.seq+1},
 {command:'daily',id:actionId(s.seq-1),seq:s.seq},
 {...body('daily',s.seq),recoverOnly:true},
 {command:'unknown',id:actionId(0),seq:s.seq},
 ])await assert.rejects(gameV2(env,1,b,time,()=>{throw Error('invalid command RNG');}),e=>e.status===400||e.status===409||e.code==='receipt_expired');
 assert.deepEqual(await db.prepare('SELECT balance,sync_seq FROM accounts WHERE id=1').first(),before);
 // A genuinely new accepted daily intent races across devices; only one prize.
 const b=body('daily',s.seq);const r=await Promise.all([gameV2(env,1,b,time,()=>0),gameV2(env,1,b,time,()=>199)]);
 assert.equal(r[0].balance,r[1].balance);assert.deepEqual(r[0].detail.daily,r[1].detail.daily);
 }finally{await mf.dispose();}
});

test('archive failure is atomic and freezes new intent/idle polls; repair and simultaneous compactors conserve every total',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,GAME_V2:'1'},s=await seedAccount(db);await seedRecords(db,1,s.seq,700);
 const before=await totals(db),counts=await db.prepare('SELECT (SELECT COUNT(*) FROM economy_actions) actions,(SELECT COUNT(*) FROM economy_ledger) ledger').first();
 await db.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON economy_archive BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();
 await assert.rejects(compactAccount(db,1,time),/archive unavailable/);
 assert.deepEqual(await totals(db),before);assert.deepEqual(await db.prepare('SELECT (SELECT COUNT(*) FROM economy_actions) actions,(SELECT COUNT(*) FROM economy_ledger) ledger').first(),counts);
 assert.equal((await db.prepare('SELECT floor_seq FROM economy_retention WHERE account_id=1').first()).floor_seq,0);
 const a=await db.prepare('SELECT sync_seq,balance FROM accounts WHERE id=1').first();
 await assert.rejects(gameV2(env,1,body('daily',a.sync_seq),time),e=>e.status===503);
 for(let i=0;i<3;i++)assert.equal((await gameV2(env,1,body('state',a.sync_seq),time+i)).storagePaused,true);
 assert.deepEqual(await db.prepare('SELECT (SELECT COUNT(*) FROM economy_actions) actions,(SELECT COUNT(*) FROM economy_ledger) ledger').first(),counts);
 await db.prepare('DROP TRIGGER fail_archive').run();
 await Promise.all([compactAccount(db,1,time),compactAccount(db,1,time)]);await drain(db,1,time);
 assert.deepEqual(await totals(db),before);
 assert.ok((await db.prepare('SELECT COUNT(*) n FROM economy_actions').first()).n<=RECEIPT_KEEP+1);
 assert.equal((await db.prepare('SELECT balance FROM accounts WHERE id=1').first()).balance,a.balance);
 }finally{await mf.dispose();}
});

test('archive preserves original-tide refunds, shot counts, lifetime totals and external dedupe; schema reruns without data loss',async()=>{
 const {mf,db}=await localV2();try{const s=await seedAccount(db);await seedRecords(db,1,s.seq,700,time-100*86400000);
 await db.prepare("INSERT INTO economy_ledger(account_id,action_id,kind,wager,payout,balance_after,created_at,wager_refund,rtp_period,account_seq) VALUES(1,?,'wager_refund',0,0,0,?,10,92,2)").bind(s.seq+'_synthetic_record:refund:92',time).run();
 await db.prepare("INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at) VALUES(1,'external_permanent','external-proof','{}',0,'settled',0,100,0)").run();
 const before=await totals(db),report=await db.prepare('SELECT rtp_period,SUM(bet) wager,SUM(win) win,SUM(credit) credit,SUM(n) n FROM accounting_events GROUP BY rtp_period').all();
 await drain(db,1,time);assert.deepEqual(await totals(db),before);
 assert.deepEqual((await db.prepare('SELECT rtp_period,SUM(bet) wager,SUM(win) win,SUM(credit) credit,SUM(n) n FROM accounting_events GROUP BY rtp_period').all()).results,report.results);
 assert.ok(await db.prepare("SELECT id FROM economy_actions WHERE id='external_permanent'").first());
 assert.equal((await db.prepare('SELECT SUM(wager_refund) n FROM economy_archive WHERE rtp_period=92').first()).n,10);
 assert.ok((await db.prepare('SELECT COUNT(*) n FROM economy_archive WHERE bucket=0').first()).n>0);
 // Negative archived IDs never advance the positive live-feed cursor.
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM accounting_events WHERE id<0').first()).n>0,true);
 const sql=readFileSync(new URL('../proposals/0005_retention.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');
 for(const statement of sql.split(';').filter(x=>x.trim()))await db.prepare(statement).run();
 assert.deepEqual(await totals(db),before);
 }finally{await mf.dispose();}
});
test('archive outage still drains an accepted flight and earned escape once, then freezes idle revisions',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,GAME_V2:'1'};let s=await seedAccount(db);
 const {engage}=await import('../src/combat-math.js');
 for(const f of s.world.fishes){f.motion.p=Array.from({length:4},()=>({x:2,y:2}));f.expires=time+60000;}
 s.world.fishes[0]=engage({...s.world.fishes[0],mult:4},10,1);s.world.fishes[0].hp-=s.world.fishes[0].lock.hpUnit;s.world.fishes[0].expires=time+8000;
 s.world.director={spawn:Number.MAX_SAFE_INTEGER,boss:Number.MAX_SAFE_INTEGER,tide:Number.MAX_SAFE_INTEGER,quiet:0,wave:0};
 await db.prepare('UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1').bind(JSON.stringify(s.world)).run();
 s=await gameV2(env,1,body('launch',s.seq,{target:s.world.fishes[1].id,baseStake:10,tier:1,angle:-.2,board:{width:844,height:390}}),time+1,()=>4000000000);
 await seedRecords(db,1,s.seq,700);await db.prepare("CREATE TRIGGER fail_archive BEFORE INSERT ON economy_archive BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();
 let a=await db.prepare('SELECT sync_seq,balance FROM accounts WHERE id=1').first();
 s=await gameV2(env,1,body('state',a.sync_seq),time+9000,()=>4000000000);assert.equal(s.world.projectiles.length,0);assert.equal(s.balance,a.balance+20);
 const counts=await db.prepare('SELECT COUNT(*) n FROM economy_actions').first();
 for(let i=0;i<3;i++)assert.equal((await gameV2(env,1,body('state',s.seq),time+9001+i)).storagePaused,true);
 assert.deepEqual(await db.prepare('SELECT COUNT(*) n FROM economy_actions').first(),counts);assert.equal((await db.prepare('SELECT balance FROM accounts WHERE id=1').first()).balance,s.balance);
 }finally{await mf.dispose();}
});
test('pre-protocol settled identities remain durable; pending imports are quarantined and cannot become new paid intent',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,GAME_V2:'1'},s=await seedAccount(db);
 const legacy={command:'daily',id:'legacy_uuid_fixture',seq:s.seq},canonical=JSON.stringify({command:'daily'});
 await db.prepare("INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at) VALUES(1,?,?,?,0,'settled',0,0,0)").bind(legacy.id,canonical,JSON.stringify({balance:s.balance,seq:0,detail:{daily:{day:'historical',pay:0}}})).run();
 await seedRecords(db,1,s.seq,700);await drain(db,1);
 const r=await gameV2(env,1,{...legacy,recoverOnly:true},time,()=>{throw Error('legacy receipt reran');});assert.equal(r.replayed,true);assert.equal(r.detail.daily.day,'historical');
 const a=await db.prepare('SELECT sync_seq,balance FROM accounts WHERE id=1').first(),pending=body('daily',a.sync_seq);
 await db.prepare("INSERT INTO economy_actions(account_id,id,request_json,response_json,expected_seq,status,wager,payout,created_at) VALUES(1,?,'orphan-import','{}',?,'pending',0,10000,0)").bind(pending.id,a.sync_seq).run();
 await assert.rejects(gameV2(env,1,pending,time,()=>{throw Error('pending import RNG');}),/receipt_pending/);
 assert.deepEqual(await db.prepare('SELECT sync_seq,balance FROM accounts WHERE id=1').first(),a);
 }finally{await mf.dispose();}
});
test('minute rollups retain exact bounded top-ten settlements, never present aggregate sums as individual wins',async()=>{
 const {mf,db}=await localV2();try{const s=await seedAccount(db),now=Date.now();await seedRecords(db,1,s.seq,700,now-3600000);
 await db.prepare('UPDATE economy_ledger SET gaming_payout=10000-account_seq*10,payout=10000-account_seq*10 WHERE account_seq<32 AND account_seq>1').run();
 await db.prepare('UPDATE accounts SET balance=1000000+(SELECT SUM(payout-wager) FROM economy_ledger WHERE account_id=1) WHERE id=1').run();
 const api=(await import('../src/index.js')).default;
 const top=async()=>{const r=await api.fetch(new Request('http://synthetic.test/rpc/rr_top',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),{DB:db,GAME_V2:'1'});assert.equal(r.status,200);return(await r.json()).map(({player,win,created_at})=>({player,win,created_at}));};
 const before=await top();assert.equal(before.length,10);await drain(db,1,now);assert.deepEqual(await top(),before);
 assert.ok((await db.prepare('SELECT MAX(n) n FROM (SELECT COUNT(*) n FROM economy_top_wins GROUP BY bucket)').first()).n<=10);
 assert.ok((await db.prepare('SELECT MAX(gaming_payout) n FROM economy_archive').first()).n>before[0].win);
 }finally{await mf.dispose();}
});


test('one account retirement never deletes another account ledger at a different sequence floor',async()=>{
 const {mf,db}=await localV2();try{
  const a=await seedAccount(db,1),b=await seedAccount(db,2);
  await seedRecords(db,2,b.seq,700);await drain(db,2,time);
  const beforeB=await totals(db,2),ledgerB=await db.prepare('SELECT * FROM economy_ledger WHERE account_id=2 ORDER BY id').all();
  await seedRecords(db,1,a.seq,2100);const beforeA=await totals(db,1);
  await drain(db,1,time);
  assert.deepEqual(await totals(db,1),beforeA);assert.deepEqual(await totals(db,2),beforeB);
  assert.deepEqual((await db.prepare('SELECT * FROM economy_ledger WHERE account_id=2 ORDER BY id').all()).results,ledgerB.results);
  assert.equal((await db.prepare('SELECT floor_seq FROM economy_retention WHERE account_id=2').first()).floor_seq,b.seq+700-RECEIPT_KEEP);
 }finally{await mf.dispose();}
});
