import {writeFileSync,mkdirSync} from 'node:fs';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {localV2} from '../worker/test/local-v2.mjs';
import {seedAccount,body,time} from '../worker/test/retention-fixture.mjs';
import {gameV2} from '../worker/src/game-v2.js';
import {adjustCanonical} from '../worker/src/external-writer.js';
import api from '../worker/src/index.js';
import {migrateReviewed,backupSynthetic,restoreIntoEmpty,reconcileSynthetic,maintenanceEnvironment} from './release-rehearsal-lib.mjs';
export async function rehearse(){
 const {mf,db}=await localV2();try{
 let s=await seedAccount(db);const env={DB:db,GAME_V2:'1'},opening={1:s.balance};
 const marker=await db.prepare("SELECT value FROM economy_config WHERE key='cutover_at'").first();
 await migrateReviewed(db);await migrateReviewed(db);assert.deepEqual(await db.prepare("SELECT value FROM economy_config WHERE key='cutover_at'").first(),marker);
 const early=await backupSynthetic(db),claim=body('daily',s.seq);s=await gameV2(env,1,claim,time+1,()=>199);
 let a=await db.prepare('SELECT * FROM accounts WHERE id=1').first();
 const adjustment={id:'synthetic_external_once',op:'add',amount:123,reason:'SYNTHETIC-only reconciliation'};
 await adjustCanonical(env,a,adjustment,time+2);a=await db.prepare('SELECT * FROM accounts WHERE id=1').first();
 await adjustCanonical(env,a,adjustment,time+3); // replay, not another external credit
 await db.prepare("INSERT INTO payments(charge_id,tg_id,pack,stars,credits,bonus,payload,credited,created_at) VALUES('SYNTHETIC-CHARGE-ONLY',123456,0,1,123,0,'synthetic audit fixture; no provider call',1,?)").bind(time).run();
 s=await gameV2(env,1,{command:'state'},time+4);
 for(const f of s.world.fishes){f.motion.p=Array.from({length:4},()=>({x:2,y:2}));f.born=time;f.expires=time+60000;}
 s.world.director={spawn:Number.MAX_SAFE_INTEGER,boss:Number.MAX_SAFE_INTEGER,tide:Number.MAX_SAFE_INTEGER,quiet:0,wave:0};
 await db.prepare('UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1').bind(JSON.stringify(s.world)).run();
 const shot=body('launch',s.seq,{target:s.world.fishes[0].id,baseStake:10,tier:1,angle:-.2,board:{width:844,height:390}});
 s=await gameV2(env,1,shot,time+5,()=>4000000000);assert.equal(s.world.projectiles.length,1);
 s.world.offers=[{id:'synthetic_restore_offer',source:'synthetic_fixture_only',expires:time+60000,consumed:false}];
 await db.prepare('UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=1').bind(JSON.stringify(s.world)).run();
 s=await gameV2(env,1,body('pause',s.seq,{offer:'synthetic_restore_offer'}),time+6,()=>4000000000);
 const before=await reconcileSynthetic(db,opening),latest=await backupSynthetic(db);
 assert.equal(before.accounts[0].pendingProjectileCents,10);assert.equal(before.accounts[0].pendingOffers,1);
 // Rollback is a SAME-DB maintenance gate, never an old backend/DB restore.
 for(const path of ['/api/v2/game','/api/sync','/api/grant','/api/invoice']){
 const r=await api.fetch(new Request('http://isolated.test'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Reef-Protocol':'2'},body:JSON.stringify(body('launch',s.seq))}),maintenanceEnvironment(db));assert.equal(r.status,503);
 }
 assert.equal((await backupSynthetic(db)).sha256,latest.sha256);
 const target=await mf.getD1Database('RESTORE');
 await assert.rejects(restoreIntoEmpty(target,early,latest.sha256),/stale backup/);
 assert.equal(await restoreIntoEmpty(target,latest,latest.sha256),latest.sha256);
 await assert.rejects(restoreIntoEmpty(target,latest,latest.sha256),/not empty/);
 assert.deepEqual(await reconcileSynthetic(target,opening),before);
 const restoredEnv={DB:target,GAME_V2:'1'},replay=await gameV2(restoredEnv,1,{...claim,recoverOnly:true},time+6,()=>{throw Error('replay drew again');});assert.equal(replay.replayed,true);assert.equal(replay.balance,s.balance);
 const skipped=await gameV2(restoredEnv,1,body('skip',replay.seq,{offer:'synthetic_restore_offer'}),time+7,()=>4000000000);
 const settle=body('state',skipped.seq),finished=await gameV2(restoredEnv,1,settle,time+9000,()=>4000000000);
 assert.equal(finished.world.projectiles.length,0);assert.equal(finished.balance,s.balance+10);
 const recovered=await gameV2(restoredEnv,1,{...settle,recoverOnly:true},time+9001);assert.equal(recovered.balance,finished.balance);
 assert.equal((await target.prepare('SELECT COUNT(*) n FROM payments WHERE charge_id=?').bind('SYNTHETIC-CHARGE-ONLY').first()).n,1);
 await reconcileSynthetic(target,opening);
 return {syntheticOnly:true,productionAccess:false,migrationsRepeated:2,backupTables:Object.keys(latest.payload.tables).length,backupSha256:latest.sha256,verifiedRestoredSha256:latest.sha256,staleBackupRejected:true,nonemptyRestoreRejected:true,maintenanceRoutesDenied:4,acceptedDailyReplayedWithoutReward:true,externalAdjustmentExactlyOnce:true,paymentIdentityPreserved:true,pendingFlightCents:10,pendingOfferAndQuotesPreserved:true,restoredFlightRefundedExactlyOnce:true,rawAuthorityNeverReenabled:true};
 }finally{await mf.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await rehearse();writeFileSync(new URL('../docs/cutover-rehearsal.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
