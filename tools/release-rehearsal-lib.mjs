/* Executable SYNTHETIC-ONLY maintenance/restore primitives. No credentials,
 * Wrangler config, network or production database discovery. Restore never
 * overwrites an existing DB; an old backup cannot erase accepted tail receipts. */
import {readFileSync} from 'node:fs';
import {digest} from '../worker/src/retention.js';
const q=n=>{if(!/^[a-zA-Z0-9_]+$/.test(n))throw Error('unexpected schema identifier');return '"'+n+'"';};
export async function assertSynthetic(db){
 const a=await db.prepare("SELECT COUNT(*) n FROM accounts WHERE public_id NOT LIKE 'RR-RET-%' AND public_id NOT LIKE 'RR-REHEARSAL-%' OR tg_id=7313143643").first();
 if(a.n)throw Error('synthetic-only: refused real/protected account');
 const p=await db.prepare("SELECT COUNT(*) n FROM players WHERE (pid NOT LIKE 'ret_%' AND pid NOT LIKE 'rehearsal_%') OR tg_id=7313143643").first();if(p.n)throw Error('synthetic-only: refused real/protected player');
 const payments=await db.prepare("SELECT COUNT(*) n FROM payments WHERE charge_id NOT LIKE 'SYNTHETIC-%' OR tg_id=7313143643").first();if(payments.n)throw Error('synthetic-only: refused real/protected payment identity');
}
export async function migrateReviewed(db){
 await assertSynthetic(db);
 for(const file of ['0004_combat.sql','0005_retention.sql']){
  const text=readFileSync(new URL('../worker/proposals/'+file,import.meta.url),'utf8').replace(/^--.*$/gm,'');
  await db.batch(text.split(';').filter(s=>s.trim()).map(s=>db.prepare(s)));
 }
}
export async function backupSynthetic(db){
 await assertSynthetic(db);
 const schema=(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
 const names=schema.filter(x=>x.type==='table').map(x=>x.name);
 const values=await db.batch([...names.map(n=>db.prepare('SELECT * FROM '+q(n)+' ORDER BY rowid')),db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')]);
 const payload={format:1,syntheticOnly:true,schema,tables:Object.fromEntries(names.map((n,i)=>[n,values[i].results])),sequences:values.at(-1).results};
 return {payload,sha256:await digest(JSON.stringify(payload))};
}
export async function restoreIntoEmpty(db,backup,liveFingerprint){
 if(!backup.payload.syntheticOnly||backup.payload.format!==1||backup.sha256!==await digest(JSON.stringify(backup.payload)))throw Error('backup integrity failure');
 if(liveFingerprint!==backup.sha256)throw Error('stale backup: accepted tail must be preserved; no restore');
 if((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").first()).n)throw Error('target is not empty: NEVER overwrite accepted state');
 const {schema,tables,sequences}=backup.payload,statements=[];
 for(const s of schema.filter(s=>s.type==='table'))statements.push(db.prepare(s.sql));
 // Original creation order puts accounts before child tables. No FK disabling.
 for(const s of schema.filter(s=>s.type==='table'))for(const row of tables[s.name]){
  const keys=Object.keys(row);statements.push(db.prepare('INSERT INTO '+q(s.name)+'('+keys.map(q).join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...keys.map(k=>row[k])));
 }
 statements.push(db.prepare('DELETE FROM sqlite_sequence'));
 for(const r of sequences)statements.push(db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').bind(r.name,r.seq));
 for(const s of schema.filter(s=>s.type!=='table'))statements.push(db.prepare(s.sql));
 await db.batch(statements);
 const restored=await backupSynthetic(db);if(restored.sha256!==backup.sha256)throw Error('restore verification failed');return restored.sha256;
}
export async function reconcileSynthetic(db,opening){
 await assertSynthetic(db);const accounts=(await db.prepare('SELECT * FROM accounts ORDER BY id').all()).results;
 const result=[];
 for(const a of accounts){
  const totals=await db.prepare('SELECT COALESCE(SUM(payout-wager+external_delta),0) delta FROM (SELECT payout,wager,external_delta FROM economy_ledger WHERE account_id=?1 UNION ALL SELECT payout,wager,external_delta FROM economy_archive WHERE account_id=?1)').bind(a.id).first();
  if(opening[a.id]+totals.delta!==a.balance)throw Error('account money reconciliation mismatch');
  if(a.tg_id){const p=await db.prepare('SELECT * FROM players WHERE tg_id=?').bind(a.tg_id).first();for(const k of ['balance','bonus','pt','sync_seq','last_daily','last_refill'])if(p?.[k]!==a[k])throw Error('canonical mirror mismatch: '+k);}
  const w=await db.prepare('SELECT state_json FROM economy_world WHERE account_id=?').bind(a.id).first(),world=w?JSON.parse(w.state_json):{};
  result.push({account:a.id,balance:a.balance,seq:a.sync_seq,pendingProjectileCents:(world.projectiles||[]).reduce((s,p)=>s+p.stake,0),pendingOffers:(world.offers||[]).filter(o=>!o.consumed).length,pendingBonusResult:!!world.resultPending});
 }
 return {accounts:result,pendingPayments:(await db.prepare('SELECT COUNT(*) n FROM payments WHERE credited=0 AND refunded=0').first()).n,pendingReceipts:(await db.prepare("SELECT COUNT(*) n FROM economy_actions WHERE status<>'settled'").first()).n,pendingLegacyAdmin:(await db.prepare('SELECT COUNT(*) n FROM admin_cmds WHERE applied_at IS NULL').first()).n};
}
export function maintenanceEnvironment(DB){return {DB,GAME_V2:'1',GAME_MAINTENANCE:'1'};}

export async function assertCutoverReady(db,opening){const report=await reconcileSynthetic(db,opening);if(report.pendingPayments||report.pendingLegacyAdmin||report.pendingReceipts)throw Error('unsettled payment/admin operations: reconcile before cutover');return report;}
