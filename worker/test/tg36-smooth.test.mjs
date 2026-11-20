// tg36 smoothness regressions: one game loop per displayed frame after hide/show, smoothed render clock,
// no per-frame laser-HUD DOM writes, and the original game still renders through the authority.
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runtime} from './original-runtime-harness.mjs';import qa from '../../tools/qa-worker.mjs';import {localV2} from './local-v2.mjs';
const src=f=>readFileSync(new URL('../../'+f,import.meta.url),'utf8');

test('minimise/restore (visibilitychange) never stacks a second game loop: exactly one update+render per frame',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,TEST_QA:'1'},route=(url,opts)=>qa.fetch(new Request(url,opts),env);
  const ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json(),r=runtime(route);await r.ctx.ReefAuthority.session(ses.token);
  for(let i=0;i<10;i++)await r.step(16);
  let hidden=false;Object.defineProperty(r.document,'hidden',{configurable:true,get:()=>hidden});
  for(let i=0;i<5;i++){hidden=true;r.document.dispatchEvent(new r.dom.Event('visibilitychange'));hidden=false;r.document.dispatchEvent(new r.dom.Event('visibilitychange'));}
  const f0=r.ctx.__reef.frames;for(let i=0;i<20;i++)await r.step(16);
  assert.equal(r.ctx.__reef.frames-f0,20,'20 displayed frames -> 20 loop runs (was 6 per frame after 5 hide/show)');
  assert.ok(r.pendingFrames()<=1,'at most one queued game-loop frame');
  // hidden for a while, then restored: still one chain
  hidden=true;r.document.dispatchEvent(new r.dom.Event('visibilitychange'));await r.step(16);await r.step(16);
  hidden=false;r.document.dispatchEvent(new r.dom.Event('visibilitychange'));
  const f1=r.ctx.__reef.frames;for(let i=0;i<10;i++)await r.step(16);assert.equal(r.ctx.__reef.frames-f1,10);
 }finally{await mf.dispose();}
});

test('render clock is exported, starts on the server clock and fish motion reads it (logic clock unchanged)',async()=>{
 const {mf,db}=await localV2();try{const env={DB:db,TEST_QA:'1'},route=(url,opts)=>qa.fetch(new Request(url,opts),env);
  const ses=await(await route('https://qa.test/qa/session',{method:'POST'})).json(),r=runtime(route);await r.ctx.ReefAuthority.session(ses.token);
  const A=r.ctx.ReefAuthority;assert.equal(typeof A.renderNow,'function');
  assert.ok(Math.abs(A.renderNow()-A.now())<1000,'first snapshot snaps the render clock onto the server clock');
  // within one frame the render clock never runs backwards
  let prev=A.renderNow();for(let i=0;i<30;i++){await r.step(16);const n=A.renderNow();assert.ok(n>=prev-1000,'no backwards jump below the 1s snap threshold');prev=n;}
  assert.match(src('game.js'),/ReefMotion\.point\(f\.server,fNow,W,H\)/,'fish positions use the smoothed per-frame clock');
  assert.match(src('authority-bridge.js'),/now = \(\) => Date\.now\(\) \+ offset,/,'logic clock (cooldowns, shot.at) keeps exact server offset');
 }finally{await mf.dispose();}
});

test('laser HUD is not rewritten every frame and the frame shimmer fills only its band',()=>{
 const g=src('game.js');
 assert.match(g,/if \(updateLaserHud\.txt === txt && updateLaserHud\.el === el\) return;/);
 assert.doesNotMatch(g,/if \(!laser\.on\) \{ el\.classList\.remove\('on'\); el\.textContent = ''; return; \}/);
 assert.match(g,/const bx0 = Math\.max\(0, x - 80 - H \/ 2\), bx1 = Math\.min\(W, x \+ 80\)/);
});
