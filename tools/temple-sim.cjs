/* Offline bonus-only simulation. Not a combat RTP or complete bankroll model. */
const B=require('../bonusmath.js');
let seed=0x51ee714;const rng=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296};
const out={seed:'0x51ee714',scope:'Bonus only; excludes trigger captures, combat, daily gifts and purchases',runs:[]};
for(const period of [92,88])for(const stake of [10,50,250,500,1200]) {
 const n=200000;let total=0,square=0,profits=0;
 for(let i=0;i<n;i++){const r=B.outcome(Math.floor(rng()*200),Math.floor(rng()*5),stake,period);total+=r.pay;square+=(r.pay/stake)**2;profits+=r.net>0;}
 const mean=total/n/stake,se=Math.sqrt((square/n-mean*mean)/n);
 out.runs.push({period,stakeCents:stake,spins:n,rtp:mean,rtp95CI:[mean-1.96*se,mean+1.96*se],netProfitFrequency:profits/n});
}
const houseEnd=[];
for(let trial=0;trial<1000;trial++) {
 let house=200000;
 for(let player=0;player<50;player++) {
  let balance=5000;
  for(let i=0;i<100;i++){const stake=B.stakeFor(balance,10);if(!stake)break;const r=B.outcome(Math.floor(rng()*200),Math.floor(rng()*5),stake,92);balance+=r.net;house-=r.net;}
 }
 houseEnd.push(house);
}
houseEnd.sort((a,b)=>a-b);out.bonusOnly50PlayerScenarios={trials:1000,startingHouseCents:200000,startingCreditsPerPlayer:5000,maximumSpinsPerPlayer:100,wagerTierPercent:10,houseFinalCents:{min:houseEnd[0],p01:houseEnd[9],p05:houseEnd[49],median:houseEnd[499]},negativeFinalCount:houseEnd.filter(x=>x<0).length,caveat:'Synthetic bonus-only final balances, not maximum drawdown or whole-game liability. Every player is artificially given repeated offers; no production safety inference.'};
console.log(JSON.stringify(out,null,2));
