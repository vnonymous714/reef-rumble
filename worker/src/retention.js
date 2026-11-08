/* Revision-bound action identities + atomic range tombstones. No clock TTL can
 * make an old command executable. External/payment identities are NEVER pruned. */
export const RECEIPT_KEEP = 512;
export const RETIRE_BATCH = 128;
export const actionSequence = id => {
  const m = /^(0|[1-9][0-9]*)_[a-zA-Z0-9_-]{8,70}$/.exec(id || '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};
export const actionId = seq => `${seq}_${crypto.randomUUID()}`;
export async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
export const compactDetail = detail => {
  // Motion, beam and launch geometry are in the canonical current world. Replay
  // does not replay visual/audio effects. Keep exact daily/slot financial results.
  const {motion, escaped, launch, beam, ...financial} = detail;
  return {...financial, motion:[], escaped: escaped?.map(f => ({id:f.id,pay:f.pay})),
    ...(launch ? {launch:{id:launch.id,stake:launch.stake}} : {}),
    ...(beam ? {beam:{id:beam.id,stake:beam.stake}} : {})};
};
const fields = ['wager','payout','wager_refund','gaming_payout','promo_credit','external_delta','n','operations'];
const belongs = "(l.action_id=e.id OR substr(l.action_id,1,length(e.id)+8)=e.id||':refund:')";
const eligible = "e.account_id=?1 AND e.expected_seq<?2 AND e.status='settled' AND e.request_json LIKE 'h3:%'";
export async function compactAccount(db, accountId, now=Date.now()) {
  const a = await db.prepare('SELECT sync_seq,tg_id FROM accounts WHERE id=?').bind(accountId).first();
  if (!a || a.tg_id === 7313143643) throw Error('protected or missing account');
  const desired = Math.max(0,a.sync_seq-RECEIPT_KEEP);
  await db.prepare('INSERT INTO economy_retention(account_id) VALUES(?) ON CONFLICT DO NOTHING').bind(accountId).run();
  const before = await db.prepare('SELECT * FROM economy_retention WHERE account_id=?').bind(accountId).first();
  if(desired<=before.floor_seq) return {compacted:0,floor:before.floor_seq};
  const receipts=(await db.prepare(`SELECT * FROM economy_actions e WHERE ${eligible} ORDER BY expected_seq LIMIT ${RETIRE_BATCH}`).bind(accountId,desired).all()).results;
  const floor=receipts.length===RETIRE_BATCH ? Math.min(desired,receipts.at(-1).expected_seq+1):desired;
  const ledgers=(await db.prepare(`SELECT l.* FROM economy_ledger l JOIN economy_actions e ON e.account_id=l.account_id AND ${belongs} WHERE ${eligible}`).bind(accountId,floor).all()).results;
  const groups=new Map();
  for(const l of ledgers){
    const bucket=Math.floor(l.created_at/60000)*60000,key=JSON.stringify([l.kind,l.rtp_period,bucket]);
    const g=groups.get(key)||{kind:l.kind,period:l.rtp_period,bucket,...Object.fromEntries(fields.map(f=>[f,0]))};
    for(const f of fields)g[f]+=f==='n' ? Number(l.wager>0) : f==='operations'?1:l[f];
    groups.set(key,g);
  }
  const token=crypto.randomUUID(),head=await digest(JSON.stringify([before.head_hash,floor,receipts,ledgers]));
  const guard='EXISTS(SELECT 1 FROM economy_retention WHERE account_id=?1 AND compact_token=?2)';
  const args=[accountId,token];
  const sql=[db.prepare(`UPDATE economy_retention SET floor_seq=?,head_hash=?,compact_token=? WHERE account_id=? AND floor_seq=? AND head_hash=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_seq=?)`).bind(floor,head,token,accountId,before.floor_seq,before.head_hash,accountId,a.sync_seq)];
  for(const g of groups.values())sql.push(db.prepare(`INSERT INTO economy_archive(account_id,kind,rtp_period,bucket,${fields.join(',')}) SELECT ?1,?3,?4,?5,${fields.map((_,i)=>'?'+(i+6)).join(',')} WHERE ${guard} ON CONFLICT(account_id,kind,rtp_period,bucket) DO UPDATE SET ${fields.map(f=>`${f}=${f}+excluded.${f}`).join(',')}`).bind(...args,g.kind,g.period,g.bucket,...fields.map(f=>g[f])));
  // Preserve true largest settlements, NOT sums misrepresented as single wins.
  // Ten exact witnesses per minute suffice for whole-minute top-ten windows.
  const winBuckets=[...new Set(ledgers.filter(l=>l.gaming_payout>0).map(l=>Math.floor(l.created_at/60000)*60000))];
  if(winBuckets.some(n=>!Number.isSafeInteger(n)))throw Error('invalid archive timestamp');
  sql.push(db.prepare(`INSERT INTO economy_top_wins(ledger_id,account_id,kind,win,created_at,bucket) SELECT l.id,l.account_id,l.kind,l.gaming_payout,l.created_at,CAST(l.created_at/60000 AS INTEGER)*60000 FROM economy_ledger l JOIN economy_actions e ON e.account_id=l.account_id AND ${belongs} WHERE e.account_id=?1 AND e.expected_seq<?3 AND e.status='settled' AND e.request_json LIKE 'h3:%' AND l.gaming_payout>0 AND ${guard} ON CONFLICT(ledger_id) DO NOTHING`).bind(...args,floor));
  if(winBuckets.length)sql.push(db.prepare(`DELETE FROM economy_top_wins WHERE ledger_id IN(SELECT ledger_id FROM (SELECT ledger_id,ROW_NUMBER() OVER(PARTITION BY bucket ORDER BY win DESC,created_at DESC,ledger_id DESC) rank FROM economy_top_wins WHERE bucket IN(${winBuckets.join(',')})) WHERE rank>10) AND ${guard}`).bind(...args));
  sql.push(db.prepare(`DELETE FROM economy_top_wins WHERE bucket<?3 AND ${guard}`).bind(...args,Math.floor((now-86400000)/60000)*60000));
  sql.push(db.prepare(`DELETE FROM economy_ledger AS l WHERE l.account_id=?1 AND ${guard} AND EXISTS(SELECT 1 FROM economy_actions e WHERE e.account_id=l.account_id AND ${belongs} AND e.expected_seq<?3 AND e.status='settled' AND e.request_json LIKE 'h3:%')`).bind(...args,floor));
  sql.push(db.prepare(`DELETE FROM economy_actions WHERE account_id=?1 AND expected_seq<?3 AND status='settled' AND request_json LIKE 'h3:%' AND ${guard}`).bind(...args,floor));
  // Rollups preserve ALL financial totals, counts and original tide. Minute
  // detail24h, daily90d, then lifetime totals per kind/tide. Not per-shot audit.
  const bucket=`CASE WHEN bucket<${Math.floor(now-90*86400000)} THEN 0 WHEN bucket<${Math.floor((now-86400000)/60000)*60000} THEN CAST(bucket/86400000 AS INTEGER)*86400000 ELSE bucket END`;
  sql.push(db.prepare(`INSERT INTO economy_archive(account_id,kind,rtp_period,bucket,${fields.join(',')}) SELECT account_id,kind,rtp_period,${bucket},${fields.map(f=>'SUM('+f+')').join(',')} FROM economy_archive WHERE account_id=?1 AND bucket<>(${bucket}) AND ${guard} GROUP BY account_id,kind,rtp_period,${bucket} ON CONFLICT(account_id,kind,rtp_period,bucket) DO UPDATE SET ${fields.map(f=>`${f}=${f}+excluded.${f}`).join(',')}`).bind(...args));
  sql.push(db.prepare(`DELETE FROM economy_archive WHERE account_id=?1 AND bucket<>(${bucket}) AND ${guard}`).bind(...args));
  await db.batch(sql); // An archive error rolls back tombstone AND every delete.
  const after=await db.prepare('SELECT * FROM economy_retention WHERE account_id=?').bind(accountId).first();
  return {compacted:after.compact_token===token?receipts.length:0,floor:after.floor_seq,head:after.head_hash};
}
