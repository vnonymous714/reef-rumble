/* QA-ONLY entry. Never used by the production Worker/config. No outbound
 * Telegram/payment/admin routes or inherited environment are forwarded. */
import api from '../worker/src/index.js';
import {gameV2} from '../worker/src/game-v2.js';
import {actionId} from '../worker/src/retention.js';
import E from '../engine.js';
const release='UI5-temple-wheel-schema005-tg20';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex','X-Reef-QA-Release':release}});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const SESSION_TTL_MS=7*86400000;
const toolbar=`<aside id="qaControls" style="position:fixed;top:4px;left:8px;z-index:999999;background:#101c2fee;border:1px solid #efcf81;border-radius:8px;padding:5px;color:#ffe9a6;font:10px system-ui;max-width:330px"><b>TEST ONLY · UI5 · TEMPLE WHEEL + STAKE BONUS · schema005 · tg20 · NO REAL CREDENTIALS</b><button id="qaToggle">TOOLS</button><div id="qaTools"><br><button id="qaStart">START NEW TEST SESSION · 1000 CREDITS</button> <button id="qaScene">SPECIAL-FISH TEST SCENE</button><span id="qaStatus" role="status"></span><small id="qaError" style="display:block;max-width:320px;overflow-wrap:anywhere"></small></div></aside><script>(()=>{const status=document.getElementById('qaStatus');setInterval(()=>{const e=window.__rrQaLastError;document.getElementById('qaError').textContent=e?'Last API rejection: '+JSON.stringify(e):'';},1000);document.getElementById('qaToggle').onclick=()=>{const c=document.getElementById('qaTools');c.hidden=!c.hidden;};document.addEventListener('click',e=>{if(e.target.closest('a.tgPlay')){e.preventDefault();e.stopPropagation();status.textContent='Purchases disabled in TEST';}},true);document.querySelectorAll('#authM input').forEach(i=>i.disabled=true);async function run(path,body){const t=window.__rrAuth?.token?.();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Reef-Protocol':'2',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify(body||{})});let v={};try{v=await r.json()}catch(_){v={error:'non-json '+r.status}}if(!r.ok){const err=Error(v.error||('HTTP '+r.status));err.status=r.status;err.payload=v;throw err;}return v;}document.getElementById('qaStart').onclick=async()=>{try{status.textContent='Starting…';const s=await run('/qa/session');localStorage.setItem('reefrumble.session',JSON.stringify(s));location.reload();}catch(e){status.textContent=(e.payload&&e.payload.error)||e.message;window.__rrQaLastError={command:'qa/session',status:e.status||500,error:(e.payload&&e.payload.error)||e.message,sequence:null,idSequence:''};}};document.getElementById('qaScene').onclick=async()=>{try{status.textContent='Loading scene…';await window.ReefAuthority?.suspend?.();await run('/qa/fixture');location.reload();}catch(e){window.ReefAuthority?.resume?.();status.textContent=(e.payload&&e.payload.error)||e.message;window.__rrQaLastError={command:'qa/fixture',status:e.status||500,error:(e.payload&&e.payload.error)||e.message,sequence:null,idSequence:''};}};})();</script>`;
async function account(req,db){const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');if(!bearer)return null;const a=await db.prepare('SELECT a.*,s.expires_at session_expires_at,s.token_hash session_hash FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(bearer),Date.now()).first();return a?.public_id.startsWith('RR-QA-')&&!a.tg_id?a:null;}
export default {async fetch(req,env){
 if(env.TEST_QA!=='1')return json({error:'QA entry disabled'},503);
 const url=new URL(req.url),path=url.pathname,db=env.DB,scoped={DB:db,GAME_V2:'1',ALLOWED_ORIGIN:url.origin};
 try{
 if(path==='/qa/health')return json({release,testOnly:true,identity:'synthetic',productionBindings:false,purchases:false,freeRefills:false,stakePayoutBonus:true});
 if(req.method==='POST'&&path==='/qa/session'){
  // Reuse/refresh an existing QA bearer when still valid enough; else mint a new synthetic account.
  const existing=await account(req,db);
  const t=Date.now();
  if(existing && existing.session_expires_at-t>3600000){
   const expires_at=t+SESSION_TTL_MS;
   await db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=? AND account_id=?').bind(expires_at,existing.session_hash,existing.id).run();
   await db.prepare("UPDATE accounts SET balance=100000,bonus=0,pt=0,last_seen=? WHERE id=? AND tg_id IS NULL AND public_id LIKE 'RR-QA-%'").bind(t,existing.id).run();
   const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
   return json({token:bearer,expires_at,testOnly:true,refreshed:true,balance:100000});
  }
  const count=await db.prepare('SELECT COUNT(*) n FROM accounts').first();if(count.n>=1000)return json({error:'QA account limit'},429);
  const key=crypto.randomUUID().replaceAll('-',''),bearer=token(),expires_at=t+SESSION_TTL_MS;
  await db.batch([db.prepare('INSERT INTO accounts(public_id,pid,username,balance,bonus,pt,created_at,last_seen) VALUES(?1,?2,?3,100000,0,0,?4,?4)').bind('RR-QA-'+key,'qa_'+key,'qa_'+key,t),db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at,created_at) SELECT ?1,id,?2,?3 FROM accounts WHERE public_id=?4').bind(await hash(bearer),expires_at,t,'RR-QA-'+key)]);
  return json({token:bearer,expires_at,testOnly:true,refreshed:false,balance:100000});
 }
 if(req.method==='POST'&&path==='/qa/fixture'){
 const a=await account(req,db);if(!a)return json({error:'Start a TEST session first'},401);
 let stored=await db.prepare('SELECT state_json,version FROM economy_world WHERE account_id=?').bind(a.id).first();
 if(!stored){const boot=await db.prepare('SELECT sync_seq FROM accounts WHERE id=?').bind(a.id).first();await gameV2(scoped,a.id,{command:'state',seq:boot.sync_seq,id:actionId(boot.sync_seq)});stored=await db.prepare('SELECT state_json,version FROM economy_world WHERE account_id=?').bind(a.id).first();}
 const current=await db.prepare('SELECT sync_seq FROM accounts WHERE id=?').bind(a.id).first(),w=JSON.parse(stored.state_json),now=Date.now(),nonce=crypto.randomUUID();
 if(w.projectiles?.length)return json({error:'Wait for paid test shots to settle, then retry scene'},409);
 w.qaScene=nonce;
 for(const [i,art,kind,mult] of [[0,'chest','temple',12],[1,'bomb','bomb',15],[2,'laser','laser',18],[3,'eel','chain',12]]){const d=E.BY_ID[art];w.fishes[i]={id:'qa_'+art+'_'+now,art,kind,mult,born:now-10000,expires:now+50000,dead:false,len:d.len,h:d.h,boss:false,motion:{p:[{x:-.1,y:.24+i*.13},{x:.25,y:.24+i*.13},{x:.75,y:.24+i*.10},{x:1.1,y:.24+i*.10}],duration:60000,off:0}};}
 w.offers=[];w.pausedAt=0;w.resultPending=false;w.projectiles=[];w.styleUntil=0;w.cooldownUntil=0;w.laserUntil=0;
 const committed=await db.batch([
 db.prepare('UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=? AND version=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND sync_seq=?)').bind(JSON.stringify(w),a.id,stored.version,a.id,current.sync_seq),
 db.prepare("UPDATE accounts SET sync_seq=sync_seq+1 WHERE id=? AND sync_seq=? AND tg_id IS NULL AND public_id LIKE 'RR-QA-%' AND EXISTS(SELECT 1 FROM economy_world WHERE account_id=? AND json_extract(state_json,'$.qaScene')=?)").bind(a.id,current.sync_seq,a.id,nonce)]);
 if(committed[0].meta.changes!==1||committed[1].meta.changes!==1)return json({error:'TEST scene changed on another device; refresh and retry'},409);
 return json({testOnly:true,scene:'Real-HP Temple Crab, bomb, Prism Ray and eel; capture normally'});
 }
 if(path.startsWith('/api/')){
 const allowed=['/api/auth/me','/api/auth/logout','/api/me','/api/v2/game','/api/client-version'];
 if(!allowed.includes(path))return json({error:'TEST environment: purchases, linking, signup and other actions disabled'},403);
 if(path==='/api/client-version')return api.fetch(req,scoped);
 const a=await account(req,db);
 if(!a)return json({error:'Start a TEST session first'},401);
 // Soft-renew QA sessions on every authenticated API hit so long test passes do not expire mid-HUD.
 if(a.session_expires_at-Date.now()<SESSION_TTL_MS/2){
  await db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=? AND account_id=?').bind(Date.now()+SESSION_TTL_MS,a.session_hash,a.id).run();
 }
 return api.fetch(req,scoped);
 }
 if(path.startsWith('/qa/')||path.startsWith('/rpc/')||path==='/tg/webhook'||path==='/events')return json({error:'Disabled in isolated TEST environment'},403);
 if(!['GET','HEAD'].includes(req.method))return json({error:'Method not allowed'},405);
 if(path==='/config.js')return new Response('window.RR_API=location.origin;window.RR_LOCAL_QA=true;window.RR_AUTHORITATIVE=true;window.Telegram={WebApp:{initData:""}};',{headers:{'Content-Type':'text/javascript','Cache-Control':'no-store','X-Reef-QA-Release':release}});
 const response=await env.ASSETS.fetch(req);if((response.headers.get('Content-Type')||'').includes('text/html')&&response.ok){let html=await response.text();html=html.replace('<title>','<title>TEST · ').replace('</body>',toolbar+'</body>');
 // Bust mixed stale clients for UI4 scripts
 html=html.replace(/(src|href)="([^"]+\.(?:js|css|webmanifest))(?:\?[^"]*)?"/g,(m,attr,url)=>`${attr}="${url}?qa-ui5"`);
 return new Response(req.method==='HEAD'?null:html,{status:200,headers:{'Content-Type':'text/html','Cache-Control':'no-store','X-Robots-Tag':'noindex','X-Reef-QA-Release':release,'X-Reef-QA':'isolated-synthetic-only'}});}return response;
 }catch(e){
  const status=e.status||500;
  const message=typeof e.message==='string'&&e.message&&e.message!=='QA request failed'?e.message:(status===500?'QA request failed':String(e.message||'error'));
  return json({error:message,release,detail:status===500&&e.stack?String(e.stack).split('\n').slice(0,3):undefined},status);
 }
}};
