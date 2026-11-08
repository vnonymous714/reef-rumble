/* Nonbrowser JS/DOM integration. Actual game/controller; only canvas pixels,
   image decoding and clock scheduling are simulated. No browser automation. */
import {parseHTML} from 'linkedom';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
export function runtime(fetcher){
 const {window:dom,document}=parseHTML(readFileSync(new URL('../../index.html',import.meta.url),'utf8'));
 const timers=[],rafs=[],storage=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
 let networkActive=0;let time=Date.now();const RealDate=Date;class Clock extends RealDate{constructor(...a){super(...(a.length?a:[time]));}static now(){return time;}}
 const gradient={addColorStop(){}};const canvas=new Proxy({measureText:t=>({width:String(t).length*7}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 dom.HTMLCanvasElement.prototype.getContext=()=>canvas;dom.HTMLCanvasElement.prototype.toDataURL=()=>'';
 dom.Element.prototype.getBoundingClientRect=function(){return{x:0,y:0,left:0,top:0,bottom:this.id==='sb'?390:30,width:844,height:30,right:844};};
 const errors=[],requests=[];const ctx={document,console,Date:Clock,Intl,Map,Set,Promise,crypto,AbortSignal,Uint32Array,Math,innerWidth:844,innerHeight:390,devicePixelRatio:1,navigator:{onLine:true},location:{origin:'https://qa.test'},performance:{now:()=>time},localStorage:storage(),sessionStorage:storage(),matchMedia:()=>({matches:false,addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>0}),Image:class{},requestAnimationFrame:f=>(rafs.push(f),rafs.length),cancelAnimationFrame(){},setTimeout:(f,d=0)=>(timers.push({f,d,at:time+d,repeat:false}),timers.length),clearTimeout(){},setInterval:(f,d)=>(timers.push({f,d,at:time+d,repeat:true}),timers.length),clearInterval(){},queueMicrotask,addEventListener:dom.addEventListener.bind(dom),RR_AUTHORITATIVE:true,RR_LOCAL_QA:true,RR_API:'https://qa.test',fetch:async(url,options)=>{requests.push({path:new URL(url).pathname,body:options?.body?JSON.parse(options.body):null});networkActive++;try{return await fetcher(url,options);}finally{networkActive--;}}};
 ctx.window=ctx;ctx.globalThis=ctx;const context=vm.createContext(ctx);
 for(const file of ['engine.js','reef-fx.js','reef-motion.js','reef-laser-pickups.js','bonusmath.js','game.js','authority-bridge.js','slots.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),context,{filename:file});
 const step=async(ms=16)=>{time+=ms;const batch=rafs.splice(0);for(const f of batch)try{f(time);}catch(e){errors.push(e);throw e;}for(const t of [...timers])if(t.at<=time){if(t.repeat)t.at=time+t.d;else timers.splice(timers.indexOf(t),1);t.f();}await new Promise(r=>setTimeout(r,0));};
 return{ctx,document,errors,requests,step,click:id=>document.querySelector(id).click(),pointer:(x,y)=>{const e=new dom.Event('pointerdown',{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1});document.querySelector('#cv').dispatchEvent(e);},async settle(){let stable=0;for(let i=0;i<1000;i++){await new Promise(r=>setTimeout(r,networkActive?5:0));stable=networkActive?0:stable+1;if(stable>=3)return;}throw Error('original UI network did not quiesce');}};
}
