/* Pure server reward helpers. No endpoint is enabled by this module. */
export const DAILY = Object.freeze([[100,39],[200,40],[300,32],[400,24],[500,24],[800,16],[1000,12],[1500,8],[2500,4],[10000,1]].map(Object.freeze));
export function dayKey(time) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  const val=t=>parts.find(p=>p.type===t).value;
  return `${val('year')}-${val('month')}-${val('day')}`;
}
export function previousDay(day) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('invalid day');
  return new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10);
}
export function uniform(total, nextUint=()=>crypto.getRandomValues(new Uint32Array(1))[0]) {
  if(!Number.isSafeInteger(total)||total<1||total>4294967296)throw new Error('invalid range');
  const limit=Math.floor(4294967296/total)*total;
  for(let i=0;i<1024;i++) {const n=nextUint();if(!Number.isInteger(n)||n<0||n>4294967295)throw new Error('invalid rng');if(n<limit)return n%total;}
  throw new Error('rng rejection limit'); // Never substitute a biased fallback.
}
export function dailyReward(today, lastDay, priorStreak, pick) {
  if(today===lastDay)throw new Error('already claimed');
  if(!Number.isInteger(pick)||pick<0||pick>=200)throw new Error('invalid selection');
  const safeStreak=Number.isInteger(priorStreak)?Math.max(0,Math.min(7,priorStreak)):0;
  const streak=lastDay===previousDay(today)?Math.min(7,safeStreak+1):1;
  let remaining=pick, base;
  for(const [pay,weight] of DAILY) {if(remaining<weight){base=pay;break;}remaining-=weight;}
  const pay=base*(9+streak)/10;
  return {day:today,streak,pay};
}
