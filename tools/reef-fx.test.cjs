const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create, LIMITS } = require('../reef-fx.js');
const source = fs.readFileSync('game.js', 'utf8');
// Economy reference captured from 155ebb54; no git/network dependency in tests.
const original = JSON.parse(fs.readFileSync('tools/reef-economy-baseline.json', 'utf8'));
const block = (s, a, b) => typeof s === 'string' ? s.slice(s.indexOf('function '+a+'('), s.indexOf('function '+b+'(')) : s[a];
test('visual modes activate, reject overlap, expire and enforce cooldown', () => {
  const fx=create(); assert.equal(fx.activate('invalid'),false);
  assert.equal(fx.activate('arc'),true); assert.equal(fx.mode,'arc');
  assert.equal(fx.activate('plasma'),false); fx.update(6);
  assert.equal(fx.mode,'');assert.equal(fx.snapshot().cooldown,12);
  assert.equal(fx.activate('plasma'),false);fx.update(12);
  assert.equal(fx.activate('plasma'),true);fx.update(18);assert.equal(fx.snapshot().cooldown,0);
});
test('bomb terrain effects are bounded and expire completely', () => {
  const fx=create();for(let i=0;i<100;i++)fx.bomb(10,20,1,false);
  assert.equal(fx.snapshot().blasts,LIMITS.blasts);assert.equal(fx.snapshot().particles,LIMITS.particles);
  fx.update(6);assert.equal(fx.snapshot().blasts,0);assert.equal(fx.snapshot().particles,0);
});
test('reduced motion keeps temporary scar but emits no moving debris', () => {
  const fx=create();fx.bomb(10,20,1,true);assert.equal(fx.snapshot().particles,0);assert.equal(fx.snapshot().blasts,1);fx.update(6);assert.equal(fx.snapshot().blasts,0);
});
test('invalid effect coordinates and time cannot poison state', () => {
  const fx=create();fx.bomb(NaN,20,1,false);fx.bomb(0,0,-1,false);assert.equal(fx.snapshot().blasts,0);
  fx.activate('arc');fx.update(NaN);fx.update(-1);assert.equal(fx.snapshot().remaining,6);
});
test('terrain renderer executes with balanced save/restore and finite geometry', () => {
  let depth=0;const gradient={addColorStop(){}};
  const ctx=new Proxy({}, {get(_,k) {if(k==='save')return()=>depth++;if(k==='restore')return()=>depth--;if(k==='createRadialGradient')return()=>gradient;return(...args)=>{for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a));};},set(){return true;}});
  const fx=create();fx.bomb(100,100,1,false);fx.update(.1);fx.terrain(ctx,false);fx.terrain(ctx,true);assert.equal(depth,0);
});
test('legacy capture and laser math remain byte-identical behind explicit authority guards', () => {
  const clean=s=>s.replace(/^  if\(AUTH_V2\).*\n/gm,'').replace(/    reefFX.bomb\(f.x, f.y, K, motionPref.matches\);\n/g,'');
  for(const [a,b] of [['onLaserHit','setAim'],['onHit','kill'],['laserTick','onLaserHit'],['wpnDmg','wpnCol']])assert.equal(clean(block(source,a,b)),block(original,a,b));
});
test('both actual bomb detonations emit terrain only after successful capture', () => {
  assert.equal((source.match(/reefFX.bomb\(/g)||[]).length,3);assert.match(source,/if\(u.dead\).*if\(u.kind==='bomb'\)reefFX.bomb/);
  for(const [a,b] of [['onHit','kill'],['onLaserHit','setAim']]) {
    const s=block(source,a,b);assert.ok(s.indexOf('reefFX.bomb')>s.indexOf('if (rnd() >='));assert.ok(s.indexOf('reefFX.bomb')>s.indexOf('awardWin(pay)'));
  }
});
test('legacy paid-shot cost, velocity, refund basis and accounting remain identical; authority uses server launch', () => {
  function run(s, mode, dmg, bet, balance=100000) {
    const events=[];const ctx={AUTH_V2:false,inputBlocked:false,bet:()=>bet,wpnDmg:()=>dmg,S:{bal:balance},auto:false,firing:true,toast:()=>{},bullets:[],MAX_BULLETS:20,lockTarget:null,onScreen:()=>false,credit:n=>events.push(['credit',n]),stats:{shots:0,wagered:0},addPlaythrough:n=>events.push(['pt',n]),T:{shot:n=>events.push(['shot',n])},UG:false,feedJp:n=>events.push(['jp',n]),E:{JP_RATE:.01,jpTrigger:()=>false},rnd:()=>.5,K:1,cannon:{x:100,y:200,ang:-1},wpnLevel:()=>3,reefFX:{mode},Sfx:{shot(){}},toggleAuto(){}};
    vm.createContext(ctx);vm.runInContext(block(s,'fire','onScreen')+';fire(1000);',ctx);
    const bullets=ctx.bullets.map(({style,...b})=>b);return JSON.parse(JSON.stringify({events,bullets,stats:ctx.stats}));
  }
  for(const mode of ['', 'arc','plasma'])for(const dmg of [1,1.25,1.5,1.75,2])for(const bet of [10,25,100,500])assert.deepEqual(run(source,mode,dmg,bet),run(original,'',dmg,bet));
  assert.deepEqual(run(source,'arc',2,500,0),run(original,'',2,500,0));
});
test('PWA loads presentation helper before game, preserves source art and account scripts', () => {
  assert.match(block(source,'fire','onScreen'),/if\(AUTH_V2\).*ReefAuthority.fire/);
  const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('reef-fx.js?v=tg30')<html.indexOf('game.js?v=tg30'));
  assert.ok(html.includes('auth.js?v=tg30'));assert.ok(html.includes('tgbridge.js?v=tg30'));assert.ok(source.includes('const im = ART.bg.img'));assert.ok(source.includes('ctx.drawImage(fr, -sp.w / 2'));
});
