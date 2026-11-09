/* Bulk synthetic storage measurement, NOT production throughput/RTP evidence. */
import {writeFileSync} from 'node:fs';
import {localV2} from '../worker/test/local-v2.mjs';
import {seedAccount,seedRecords,drain,totals,time} from '../worker/test/retention-fixture.mjs';
const {mf,db}=await localV2();
try{
 const actors=50,rounds=3,perRound=700,records=actors*rounds*perRound,samples=[];let expected={};
 for(let id=1;id<=actors;id++){await seedAccount(db,id);expected[id]=await totals(db,id);}
 for(let round=0;round<rounds;round++){
  for(let id=1;id<=actors;id++){
   if(JSON.stringify(await totals(db,id))!==JSON.stringify(expected[id]))throw Error('another account compactor lost financial totals');
   const a=await db.prepare('SELECT sync_seq FROM accounts WHERE id=?').bind(id).first();await seedRecords(db,id,a.sync_seq,perRound,time+round*86400000);
   const before=await totals(db,id);expected[id]=before;await drain(db,id,time+round*86400000);
   if(JSON.stringify(await totals(db,id))!==JSON.stringify(before))throw Error('lost financial totals');
  }
  for(let id=1;id<=actors;id++)if(JSON.stringify(await totals(db,id))!==JSON.stringify(expected[id]))throw Error('cross-account financial totals changed');
  const stat=await db.prepare('SELECT (SELECT COUNT(*) FROM economy_actions) receipts,(SELECT COUNT(*) FROM economy_ledger) ledger,(SELECT COUNT(*) FROM economy_archive) rollups,(SELECT COUNT(*) FROM economy_top_wins) exactTopWinWitnesses,(SELECT COALESCE(SUM(length(request_json)+length(response_json)),0) FROM economy_actions) receiptPayloadBytes').all(),rows=stat.results[0];
  samples.push({round:round+1,seededGameRecords:(round+1)*perRound*actors,...rows,sqliteAllocatedBytes:stat.meta.size_after});

 }
 const max=await db.prepare('SELECT MAX(n) n FROM (SELECT COUNT(*) n FROM economy_actions GROUP BY account_id)').first();if(max.n>513)throw Error('receipt bound failed');
 const output={syntheticOnly:true,actors,bulkRecords:records,recentReceiptLimit:512,maxRetainedPerActor:max.n,samples,notes:['No production or existing hosted QA access. Bulk seeded SQL fixtures, not105000 API commands or a production RPS benchmark.','SQLite allocated bytes use documented D1Result.meta.size_after. PRAGMA page_count was not authorized; no raw DB-file workaround attempted. Includes tables/index overhead, excludes remote replication billing.','Legacy UUID-only/external/payment identities are permanently retained, not part of high-volume game compaction.','Minute rollups24h, daily90d, older lifetime totals per account/kind/tide. Aggregate financial audit retained; not indefinite per-shot forensic history.']};
 writeFileSync(new URL('../docs/retention-capacity.json',import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
}finally{await mf.dispose();}
