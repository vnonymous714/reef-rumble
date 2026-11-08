/* QA-ONLY entry. Never used by the production Worker/config. No outbound
 * Telegram/payment/admin routes or inherited environment are forwarded. */
import api from '../worker/src/index.js';
import {gameV2} from '../worker/src/game-v2.js';
import E from '../engine.js';
const release='7bfd047-schema005-tg20-UI2';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex','X-Reef-QA-Release':release}});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const toolbar=`<aside id="qaControls" style="position:fixed;top:4px;left:8px;z-index:999999;background:#101c2fee;border:1px solid #efcf81;border-radius:8px;padding:5px;color:#ffe9a6;font:10px system-ui;max-width:310px"><b>TEST ONLY · 7bfd047 · schema005 · tg20 · UI2 · NO REAL CREDENTIALS</b><button id="qaToggle">TOOLS</button><div id="qaTools"><br><button id="qaStart">START NEW TEST SESSION · 1000 CREDITS</button> <button id="qaScene">SPECIAL-FISH TEST SCENE</button><span id="qaStatus" role="status"></span></div></aside><script>(()=>{const status=document.getElementById('qaStatus');document.getElementById('qaToggle').onclick=()=>{const c=document.getElementById('qaTools');c.hidden=!c.hidden;};document.addEventListener('click',e=>{if(e.target.closest('a.tgPlay')){e.preventDefault();e.stopPropagation();status.textContent='Purchases disabled in TEST';}},true);document.querySelectorAll('#authM input').forEach(i=>i.disabled=true);async function run(path,body){const t=window.__rrAuth?.token?.();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify(body||{})});const v=await r.json();if(!r.ok)throw Error(v.error||r.status);return v;}document.getElementById('qaStart').onclick=async()=>{try{const s=await run('/qa/session');localStorage.setItem('reefrumble.session',JSON.stringify(s));location.reload();}catch(e){status.textContent=e.message;}};document.getElementById('qaScene').onclick=async()=>{try{await window.ReefAuthority?.suspend?.();await run('/qa/fixture');location.reload();}catch(e){window.ReefAuthority?.resume?.();status.textContent=e.message;}};})();</script>`;
async function account(req,db){const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');if(!bearer)return null;const a=await db.prepare('SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(bearer),Date.now()).first();return a?.public_id.startsWith('RR-QA-')&&!a.tg_id?a:null;}
export default {async fetch(req,env){
 if(env.TEST_QA!=='1')return json({error:'QA entry disabled'},503);
 const url=new URL(req.url),path=url.pathname,db=env.DB,scoped={DB:db,GAME_V2:'1',ALLOWED_ORIGIN:url.origin};
 try{
 if(path==='/qa/health')return json({release,testOnly:true,identity:'synthetic',productionBindings:false,purchases:false,freeRefills:false});
 if(req.method==='POST'&&path==='/qa/session'){
 const count=await db.prepare('SELECT COUNT(*) n FROM accounts').first();if(count.n>=1000)return json({error:'QA account limit'},429);
 const t=Date.now(),key=crypto.randomUUID().replaceAll('-',''),bearer=token(),expires_at=t+86400000;
 await db.batch([db.prepare('INSERT INTO accounts(public_id,pid,username,balance,bonus,pt,created_at,last_seen) VALUES(?1,?2,?3,100000,0,0,?4,?4)').bind('RR-QA-'+key,'qa_'+key,'qa_'+key,t),db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at,created_at) SELECT ?1,id,?2,?3 FROM accounts WHERE public_id=?4').bind(await hash(bearer),expires_at,t,'RR-QA-'+key)]);
 return json({token:bearer,expires_at,testOnly:true});
 }
 if(req.method==='POST'&&path==='/qa/fixture'){
 const a=await account(req,db);if(!a)return json({error:'Start a TEST session first'},401);
 let stored=await db.prepare('SELECT state_json,version FROM economy_world WHERE account_id=?').bind(a.id).first();
 if(!stored){await gameV2(scoped,a.id,{command:'state',id:crypto.randomUUID()});stored=await db.prepare('SELECT state_json,version FROM economy_world WHERE account_id=?').bind(a.id).first();}
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
 if(path!=='/api/client-version'&&!(await account(req,db)))return json({error:'Start a TEST session first'},401);
 return api.fetch(req,scoped);
 }
 if(path.startsWith('/qa/')||path.startsWith('/rpc/')||path==='/tg/webhook'||path==='/events')return json({error:'Disabled in isolated TEST environment'},403);
 if(!['GET','HEAD'].includes(req.method))return json({error:'Method not allowed'},405);
 if(path==='/config.js')return new Response('window.RR_API=location.origin;window.RR_LOCAL_QA=true;window.Telegram={WebApp:{initData:""}};',{headers:{'Content-Type':'text/javascript','Cache-Control':'no-store'}});
 const response=await env.ASSETS.fetch(req);if((response.headers.get('Content-Type')||'').includes('text/html')&&response.ok){let html=await response.text();html=html.replace('<title>','<title>TEST · ').replace('</body>',toolbar+'</body>');return new Response(req.method==='HEAD'?null:html,{status:200,headers:{'Content-Type':'text/html','Cache-Control':'no-store','X-Robots-Tag':'noindex','X-Reef-QA-Release':release,'X-Reef-QA':'isolated-synthetic-only'}});}return response;
 }catch(e){return json({error:e.status?e.message:'QA request failed'},e.status||500);}
}};
