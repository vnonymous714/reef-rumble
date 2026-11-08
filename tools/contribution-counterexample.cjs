/* Diagnostic for the approved naive weighted-contribution candidate, NOT the
   implemented game and NOT a claim that all possible real-HP designs fail.
   Same damage weight on every shot; real HP frozen to a random required unit
   count N. N is hidden here: the strategy needs no peek at HP or RNG. */
const samples=1000000, multiplier=10, high=1000, low=10;
let state=0x714c0de;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return((state>>>0)+.5)/4294967296};
const results=[];
for(const fishReturn of [.91,.87]) {
 const p=fishReturn/multiplier, meanN=1/p, reciprocalMean=-p*Math.log(p)/(1-p);
 const expectedCost=high+low*(meanN-1);
 const expectedPayout=multiplier*(low+(high-low)*reciprocalMean);
 let actualCost=0,actualPayout=0,uniformCost=0,uniformPayout=0;
 for(let i=0;i<samples;i++) {
  const n=Math.floor(Math.log1p(-random())/Math.log1p(-p))+1;
  const cost=high+low*(n-1);
  actualCost+=cost;actualPayout+=Math.round(multiplier*cost/n);
  uniformCost+=low*n;uniformPayout+=multiplier*low;
 }
 results.push({fishReturn,multiplier,firstShotCents:high,laterShotCents:low,samples,
  uniformStakeAnalyticRTP:fishReturn,uniformStakeSampleRTP:uniformPayout/uniformCost,
  mixedStakeAnalyticRTP:expectedPayout/expectedCost,mixedStakeSampleRTP:actualPayout/actualCost,
  expectedShots:meanN,expectedReciprocalShots:reciprocalMean,expectedEncounterCostCents:expectedCost,expectedEncounterPayoutCents:expectedPayout,
  capIrrelevant:true,maxPossibleAwardCents:multiplier*high});
}
console.log(JSON.stringify({scope:'Counterexample for price-independent random damage/HP and payout M times damage-weighted average actual stake. Equal damage per shot is a valid mixed-base-bet case. No production actions.',generalProof:'For random N with mean M/R, first stake A then b: E[payout] - R*E[cost] = (A-b)*(M*E[1/N]-R) > 0 whenever A>b and Var(N)>0 (strict Jensen). Thus calibrating only uniform-bet return does not preserve target for mixed bets.',results},null,2));
