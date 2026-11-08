const {test}=require('node:test');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');
test('reject naive mixed-stake weighted-average candidate despite uniform-bet calibration',()=>{
 const data=JSON.parse(execFileSync(process.execPath,['tools/contribution-counterexample.cjs'],{encoding:'utf8'}));
 for(const row of data.results){assert.ok(Math.abs(row.uniformStakeSampleRTP-row.fishReturn)<.005);assert.ok(row.mixedStakeAnalyticRTP>2);assert.ok(Math.abs(row.mixedStakeSampleRTP-row.mixedStakeAnalyticRTP)<.01);assert.ok(row.maxPossibleAwardCents<40000);}
});
