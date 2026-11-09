import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const src=fs.readFileSync(new URL('../../game.js',import.meta.url),'utf8');
const fn=src.slice(src.indexOf('function v2ShotReady'),src.indexOf('function fire('));
function ctx(bal,bi,tier){const c={S:{bal,bi},E:{BETS:[10,20,50]},auto:true,firing:true,lockTarget:{},toasts:[],wpnLevel:()=>tier,showBet(){},toast(t){c.toasts.push(t)},toggleAuto(v){c.auto=v},fmt:x=>(Math.floor(x)/100).toFixed(2),bet(){return c.E.BETS[c.S.bi]}};vm.createContext(c);vm.runInContext(fn,c);return c;}
test('max bet at LV10 with 0.75 steps bet down instead of rejecting',()=>{const c=ctx(75,2,10);assert.equal(c.v2ShotReady(null),true);assert.equal(c.S.bi,1);assert.match(c.toasts[0],/Bet lowered to 0\.20: LV10 shots cost 0\.40/);});
test('broke player gets a clear message and AUTO stops',()=>{const c=ctx(10,0,10);assert.equal(c.v2ShotReady(null),false);assert.equal(c.auto,false);assert.match(c.toasts[0],/Not enough credits/);});
test('big fish over the 400 cap lowers the bet',()=>{const c=ctx(100000,2,10);assert.equal(c.v2ShotReady({mult:450}),true);assert.ok(Math.round(c.E.BETS[c.S.bi]*2)*450<=40000);assert.match(c.toasts[0],/x450 fish|max win|Bet lowered/);});
test('affordable normal shot is untouched',()=>{const c=ctx(5000,0,1);assert.equal(c.v2ShotReady({mult:6}),true);assert.equal(c.toasts.length,0);});
test('locked fish uses its locked stake',()=>{const c=ctx(15,2,10);assert.equal(c.v2ShotReady({mult:150,server:{lock:{stake:20}}}),false);const d=ctx(25,2,10);assert.equal(d.v2ShotReady({mult:150,server:{lock:{stake:20}}}),true);});
