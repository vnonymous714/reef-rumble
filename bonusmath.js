/* Temple Crab bonus: proposed shared math, not enabled in the live game. */
(function (root) {
  'use strict';
  const LINES = Object.freeze([[0,0,0],[1,1,1],[2,2,2],[0,1,2],[2,1,0]].map(Object.freeze));
  const MAX_STAKE = 1200, MIN_STAKE = 10, MAX_AWARD = 40000;
  function stakeFor(balance, percent) {
    if (!Number.isSafeInteger(balance) || balance < MIN_STAKE || ![1,5,10].includes(percent)) return 0;
    const proposed = Math.min(MAX_STAKE, Math.floor(balance * percent / 100 / 5) * 5);
    return proposed >= MIN_STAKE ? proposed : 0;
  }
  function validStake(stake) { return Number.isSafeInteger(stake) && stake >= MIN_STAKE && stake <= MAX_STAKE && stake % 5 === 0; }
  function evaluate(grid, stake, period) {
    if (!validStake(stake) || ![92,88].includes(period)) throw new Error('invalid stake/period');
    if (!Array.isArray(grid) || grid.length !== 3 || grid.some(c=>!Array.isArray(c)||c.length!==3||c.some(s=>!Number.isInteger(s)||s<0||s>7))) throw new Error('invalid grid');
    let units=0; const wins=[];
    LINES.forEach((rows,line)=>{const s=grid[0][rows[0]];if(s<=1&&grid[1][rows[1]]===s&&grid[2][rows[2]]===s){const u=s===0?6:(period===88?146:166);units+=u;wins.push({line,symbol:s,units:u});}});
    // Units are fifths of TOTAL spin stake, not a separate bet on each line.
    const uncapped=stake*units/5; const pay=Math.min(MAX_AWARD,uncapped);
    return { pay, uncapped, wins, net:pay-stake };
  }
  function outcome(bucket, line, stake, period) {
    if (!Number.isInteger(bucket)||bucket<0||bucket>=200||!Number.isInteger(line)||line<0||line>=5) throw new Error('invalid selection');
    const grid=Array.from({length:3},(_,c)=>Array.from({length:3},(_,r)=>2+(c+r*2)%6));
    const kind=bucket<100?'loss':bucket<198?'pearl':'relic';
    if(kind!=='loss') for(let c=0;c<3;c++)grid[c][LINES[line][c]]=kind==='pearl'?0:1;
    const result=evaluate(grid,stake,period);
    return {grid,stake,period,kind,...result};
  }
  const api={LINES,MAX_STAKE,MIN_STAKE,MAX_AWARD,stakeFor,validStake,evaluate,outcome};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TempleBonus=api;
})(typeof globalThis!=='undefined'?globalThis:this);
