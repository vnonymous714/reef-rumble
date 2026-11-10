import {test} from 'node:test';import assert from 'node:assert/strict';
import {runtime} from './original-runtime-harness.mjs';import qa from '../../tools/qa-worker.mjs';import {localV2} from './local-v2.mjs';
test('actual original renderer/controller daily close, canonical HUD and manual paid projectile work together',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,TEST_QA:'1'},route=(url,opts)=>qa.fetch(new Request(url,opts),env);
 const ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json();
 const r=runtime(route);await r.ctx.ReefAuthority.session(ses.token);
 for(let i=0;i<180;i++)await r.step(16);
 assert.equal(r.document.querySelector('#bal').textContent,'1,000.00');
 r.click('#dSpin');await r.settle();assert.equal(r.document.querySelector('#dSpin').dataset.done,'1');
 r.click('#dSpin');assert.equal(r.document.querySelector('#dailyM').classList.contains('open'),false);
 r.pointer(422,120);await r.settle();
 assert.ok(r.requests.some(x=>x.body?.command==='launch'));
 assert.ok(r.ctx.ReefAuthority.snapshot.world.projectiles.length>0);
 }finally{await mf.dispose();}
});


test('actual pointer tap survives a slow poll once, modes remain actionable during polling, and activation queues behind a poll',async()=>{
 const {mf,db}=await localV2();try{
  const env={DB:db,TEST_QA:'1'};let hold=null;
  const route=async(url,opts)=>{const body=opts?.body?JSON.parse(opts.body):{};const response=await qa.fetch(new Request(url,opts),env);if(hold&&body.command==='state'&&body.seq!==undefined){const h=hold;hold=null;h.hit();await h.promise;}return response;};
  const ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json(),r=runtime(route);await r.ctx.ReefAuthority.session(ses.token);
  r.click('#dSpin');await r.settle();r.click('#dSpin');
  const gate=()=>{let release,hit;const promise=new Promise(x=>release=x),started=new Promise(x=>hit=x);hold={promise,hit};return{release,started};};
  let h=gate(),poll=r.ctx.ReefAuthority.refresh();await h.started;
  r.ctx.ReefAuthority.paintModes();assert.equal(r.document.querySelector('#arcMode').disabled,false,'background poll is not weapon cooldown');
  const before=r.requests.filter(x=>x.body?.command==='launch').length;r.pointer(422,120);r.pointer(422,120);
  h.release();await poll;await r.settle();
  assert.equal(r.requests.filter(x=>x.body?.command==='launch').length-before,1,'one bounded manual intent, no dropped or doubled charge');
  await r.ctx.ReefAuthority.refresh();h=gate();poll=r.ctx.ReefAuthority.refresh();await h.started;
  r.click('#arcMode');h.release();await poll;await r.settle();
  assert.equal(r.ctx.ReefAuthority.snapshot.world.style,'arc');assert.ok(r.ctx.ReefAuthority.snapshot.world.styleUntil>r.ctx.ReefAuthority.now());
  assert.equal(r.document.querySelector('#plasmaMode').disabled,true,'real shared cooldown disables modes');
 }finally{await mf.dispose();}
});


test('queued manual shot cancels on suspension; real mode cooldown survives reload and server expiry restores activation',async()=>{
 const {mf,db}=await localV2();try{
  const env={DB:db,TEST_QA:'1'};let hold=null;
  const route=async(url,opts)=>{const b=opts?.body?JSON.parse(opts.body):{},res=await qa.fetch(new Request(url,opts),env);if(hold&&b.command==='state'&&b.seq!==undefined){const h=hold;hold=null;h.hit();await h.promise;}return res;};
  const ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json(),r=runtime(route);await r.ctx.ReefAuthority.session(ses.token);r.click('#dSpin');await r.settle();r.click('#dSpin');
  let release,hit;const promise=new Promise(x=>release=x),started=new Promise(x=>hit=x);hold={promise,hit};
  const poll=r.ctx.ReefAuthority.refresh();await started;
  const before=r.requests.filter(x=>x.body?.command==='launch').length;
  const tap=r.ctx.ReefAuthority.fire(r.ctx.__reef.authoritativeView.geometry,{manual:true}),stop=r.ctx.ReefAuthority.suspend();
  release();await poll;await tap;await stop;assert.equal(r.requests.filter(x=>x.body?.command==='launch').length,before);
  await r.ctx.ReefAuthority.resume();await r.ctx.ReefAuthority.activate('arc');
  const reloaded=runtime(route);await reloaded.ctx.ReefAuthority.session(ses.token);
  assert.equal(reloaded.ctx.ReefAuthority.snapshot.world.style,'arc');assert.equal(reloaded.document.querySelector('#plasmaMode').disabled,true);assert.match(reloaded.document.querySelector('#arcMode').textContent,/s/);
  // Deterministic local-only server expiry fixture, not a browser-clock override.
  const row=await db.prepare('SELECT account_id,state_json FROM economy_world').first(),w=JSON.parse(row.state_json);w.styleUntil=Date.now()-1;w.cooldownUntil=Date.now()-1;
  await db.prepare('UPDATE economy_world SET state_json=? WHERE account_id=?').bind(JSON.stringify(w),row.account_id).run();
  await reloaded.ctx.ReefAuthority.refresh();assert.equal(reloaded.document.querySelector('#plasmaMode').disabled,false);
  reloaded.click('#plasmaMode');await reloaded.settle();assert.equal(reloaded.ctx.ReefAuthority.snapshot.world.style,'plasma');
 }finally{await mf.dispose();}
});


test('real first RAF runs before authority script download and continues through missing snapshot/world into canonical HUD',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,TEST_QA:'1'},route=(url,opts)=>qa.fetch(new Request(url,opts),env),r=runtime(route,{deferAuthority:true});
 await r.step();await r.step();assert.equal(r.ctx.__reef.frames,2);
 r.ctx.ReefAuthority={snapshot:{},now:()=>Date.now(),paintModes(){}};await r.step();assert.equal(r.ctx.__reef.frames,3);
 r.bootController();const ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json();await r.ctx.ReefAuthority.session(ses.token);
 for(let i=0;i<180;i++)await r.step(16);await r.settle();assert.equal(r.document.querySelector('#bal').textContent,'1,000.00');assert.ok(r.ctx.__reef.frames>180);
 }finally{await mf.dispose();}
});


test('complete original shell/auth/telemetry graph has no malformed commands or legacy RPC after early RAF and daily close',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,TEST_QA:'1'},route=(url,opts)=>qa.fetch(new Request(url,opts),env),r=runtime(route,{deferAuthority:true}),ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json();
 await r.step();r.bootController();r.bootAuth(ses);await r.step();await r.settle();
 for(let i=0;i<180;i++)await r.step(16);await r.settle();
 assert.equal(r.document.querySelector('#bal').textContent,'1,000.00');assert.equal(r.ctx.__rrAuth.token(),ses.token);
 r.click('#dSpin');await r.settle();r.click('#dSpin');r.pointer(422,120);await r.settle();
 assert.ok(r.requests.some(x=>x.body?.command==='launch'&&x.status===200));
 assert.deepEqual(r.requests.filter(x=>x.status>=400),[]);assert.equal(r.requests.some(x=>x.path.startsWith('/rpc/')||x.path==='/events'),false);
 }finally{await mf.dispose();}
});

test('autofire returns null and does not launch while a poll is in flight, then submits once the poll completes', async () => {
  const {mf, db} = await localV2();
  try {
    const env = {DB: db, TEST_QA: '1'};
    let hold = null;
    const route = async (url, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      const response = await qa.fetch(new Request(url, opts), env);
      if (hold && body.command === 'state' && body.seq !== undefined) {
        const h = hold;
        hold = null;
        h.hit();
        await h.promise;
      }
      return response;
    };
    const ses = await (await route('https://qa.test/qa/session', {method: 'POST'})).json();
    const r = runtime(route);
    await r.ctx.ReefAuthority.session(ses.token);
    r.click('#dSpin');
    await r.settle();
    r.click('#dSpin');
    const gate = () => {
      let release, hit;
      const promise = new Promise((x) => (release = x)),
        started = new Promise((x) => (hit = x));
      hold = {promise, hit};
      return {release, started};
    };
    const before = r.requests.filter((x) => x.body?.command === 'launch').length;
    const h = gate();
    const poll = r.ctx.ReefAuthority.refresh();
    await h.started;
    const dropped = r.ctx.ReefAuthority.fire(r.ctx.__reef.authoritativeView.geometry, {manual: false});
    assert.equal(dropped, null);
    assert.equal(r.ctx.__reef.shooting, false);
    h.release();
    await poll;
    await r.settle();
    assert.equal(r.requests.filter((x) => x.body?.command === 'launch').length, before);
    const sent = r.ctx.ReefAuthority.fire(r.ctx.__reef.authoritativeView.geometry, {manual: false});
    assert.ok(sent);
    await sent;
    await r.settle();
    assert.equal(r.requests.filter((x) => x.body?.command === 'launch').length, before + 1);
  } finally {
    await mf.dispose();
  }
});

test('renderer only advances lastShot when ReefAuthority actually accepts the launch', async () => {
  const fs = await import('node:fs');
  const game = fs.readFileSync(new URL('../../game.js', import.meta.url), 'utf8');
  assert.match(game, /const sent=window.ReefAuthority.fire/);
  assert.match(game, /if\(sent\)lastShot=now/);
  assert.equal(game.includes('lastShot=now;return window.ReefAuthority.fire'), false);
});
