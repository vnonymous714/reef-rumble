/* Fake DOM unit integration, NOT browser/headless automation or visual QA.
 * Executes the shipped controller against real local D1 + isolated QA routes. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';
import qa from '../../tools/qa-worker.mjs';import {localV2} from './local-v2.mjs';
function storage(){const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function element(){const classes=new Set();return{disabled:false,dataset:{},style:{},textContent:'',setAttribute(){},classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)}};}
async function setup(){
 const {mf,db}=await localV2(process.env.QA_FLOW_BUNDLE?{script:readFileSync(process.env.QA_FLOW_BUNDLE,'utf8')}:{}),env={DB:db,TEST_QA:'1'};
 const call=(path,body,token)=>(process.env.QA_FLOW_BUNDLE ? req=>mf.dispatchFetch(req.url,{method:req.method,headers:req.headers,body:req.body,duplex:'half'}) : req=>qa.fetch(req,env))(new Request('https://qa.test'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Reef-Protocol':'2',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body||{})}));
 const session=await(await call('/qa/session')).json();return{mf,db,call,token:session.token};
}
function controller(call,token){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const intervals=[],requests=[],results=[],toasts=[],ss=storage();let gate=null,balance=5000;
 const document={hidden:false,querySelector:get};
 const view={apply:s=>{balance=s.balance;},stop(){},dailyOpen(){get('#dailyM').classList.add('open');get('#dSpin').disabled=false;},dailyResult:r=>{results.push(r);get('#dSpin').disabled=false;get('#dSpin').dataset.done='1';},dailyClaimed(){get('#dSpin').disabled=false;get('#dSpin').dataset.done='1';}};
 const window={RR_AUTHORITATIVE:true,RR_LOCAL_QA:true,RR_API:'https://qa.test',__reef:{authoritativeView:view,toast:s=>toasts.push(s)}};
 const ctx={window,document,sessionStorage:ss,crypto,AbortSignal,Date,Map,Set,console,queueMicrotask,setInterval:f=>intervals.push(f),fetch:async(url,opts)=>{const b=JSON.parse(opts.body);requests.push(b);const r=await call(new URL(url).pathname,b,token);if(gate&&b.command==='state'&&b.seq!==undefined){const wait=gate;gate=null;wait.hit();await wait.promise;}return r;}};
 vm.runInNewContext(readFileSync(new URL('../../authority-bridge.js',import.meta.url),'utf8'),ctx);
 return{api:window.ReefAuthority,ctx,get,results,toasts,ss,requests,get balance(){return balance;},holdPoll(){let release,hit;const promise=new Promise(r=>release=r),started=new Promise(r=>hit=r);gate={promise,hit};return{release,started};}};
}
test('real controller queues daily behind an in-flight poll, drops stale state intent, claims/replays once and displays confirmed1000 balance',async()=>{
 const {mf,db,call,token}=await setup();try{
 const ui=controller(call,token);await ui.api.session(token);assert.equal(ui.balance,100000);assert.equal(ui.get('#dailyM').classList.contains('open'),true);
 // Old published clients persisted no-op state requests. They cannot block SPIN.
 ui.ss.setItem('reefrumble.v2.pending.'+ui.api.snapshot.owner,JSON.stringify({command:'state',id:'legacy_noop_state'}));
 ui.get('#dailyM').classList.remove('open');const hold=ui.holdPoll(),poll=ui.api.refresh();await hold.started;
 ui.get('#dailyM').classList.add('open');const spin=ui.api.dailySpin();assert.equal(ui.get('#dSpin').disabled,true);hold.release();await poll;await spin;
 assert.equal(ui.results.length,1);assert.equal(ui.get('#dSpin').dataset.done,'1');assert.ok(ui.balance>100000);
 const daily=ui.requests.find(b=>b.command==='daily'),b=ui.balance;
 const duplicate=await(await call('/api/v2/game',daily,token)).json();assert.equal(duplicate.replayed,true);assert.equal(duplicate.balance,b);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM economy_ledger WHERE kind='daily'").first()).n,1);
 assert.equal(ui.ss.getItem('reefrumble.v2.pending.'+ui.api.snapshot.owner),null);
 }finally{await mf.dispose();}
});
test('wheel-open special scene quiesces controller, commits guarded fixture, reloads and still allows one daily claim',async()=>{
 const {mf,db,call,token}=await setup();try{let ui=controller(call,token);await ui.api.session(token);
 await ui.api.suspend();const r=await call('/qa/fixture',{},token);assert.equal(r.status,200);assert.equal((await r.json()).testOnly,true);
 ui=controller(call,token);await ui.api.session(token);assert.equal(ui.balance,100000);assert.ok(ui.api.snapshot.world.fishes.some(f=>f.id.startsWith('qa_bomb')));
 await ui.api.dailySpin();assert.equal(ui.results.length,1);assert.equal(ui.get('#dSpin').dataset.done,'1');
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM economy_ledger WHERE kind='daily'").first()).n,1);
 }finally{await mf.dispose();}
});
test('isolated legacy telemetry never sends rr_pending/events or replaces canonical balances',()=>{
 const ticks=[],sent=[];const window={RR_API:'https://qa.test',RR_LOCAL_QA:true,RR_AUTHORITATIVE:true,crypto};
 const ctx={window,crypto,innerWidth:844,innerHeight:390,localStorage:storage(),document:{hidden:false,addEventListener(){}},navigator:{onLine:true},addEventListener(){},setInterval:f=>ticks.push(f),setTimeout:f=>ticks.push(f),fetch:(...args)=>{sent.push(args);throw Error('legacy route must not run');}};
 vm.runInNewContext(readFileSync(new URL('../../telemetry.js',import.meta.url),'utf8'),ctx);window.RRT.start({start:5000,bal:()=>100000,setBal:()=>{throw Error('legacy balance writer');}});for(const tick of ticks)tick();assert.equal(sent.length,0);
});
test('actual auth boot paints confirmed1000 credits even if engine bootstrap transiently rejects, without deleting valid identity',async()=>{
 const {mf,call,token}=await setup();try{
 const nodes=new Map(),get=id=>{if(!nodes.has(id)){const n=element();n.addEventListener=()=>{};n.querySelector=()=>element();nodes.set(id,n);}return nodes.get(id);};
 const local=storage(),tasks=[],toasts=[];local.setItem('reefrumble.session',JSON.stringify({token,expires_at:Date.now()+3600000}));
 const R={S:{bal:5000},updatePtHud(){},toast:s=>toasts.push(s),closeM(){}};
 const window={RR_AUTHORITATIVE:true,RR_API:'https://qa.test',__reef:R,ReefAuthority:{session:async()=>{throw Error('transient bootstrap conflict');},refresh(){},stop(){}}};
 const ctx={window,localStorage:local,document:{getElementById:get,querySelector:get,querySelectorAll:()=>[],addEventListener(){}},setTimeout:(fn,delay)=>tasks.push({fn,delay}),setInterval(){},fetch:async(url,opts)=>call(new URL(url).pathname,JSON.parse(opts.body),token)};
 vm.runInNewContext(readFileSync(new URL('../../auth.js',import.meta.url),'utf8'),ctx);for(const t of tasks.filter(t=>t.delay===0))t.fn();
 for(let i=0;i<100&&R.S.bal===5000;i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(R.S.bal,100000);assert.ok(local.getItem('reefrumble.session'));assert.equal(window.__rrAuth.token(),token);
 }finally{await mf.dispose();}
});
