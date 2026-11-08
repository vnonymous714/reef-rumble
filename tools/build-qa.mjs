/* Explicit public-file allowlist. Never copy project config/secrets/source. */
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from '../worker/node_modules/esbuild/lib/main.js';
const stage='/workspace/rr-tg-qa-stage',root=new URL('../',import.meta.url);await mkdir(stage+'/public/assets',{recursive:true});
const files=['index.html','engine.js','telemetry.js','reef-fx.js','reef-motion.js','reef-laser-pickups.js','bonusmath.js','game.js','authority-bridge.js','slotmath.js','slots.js','tgbridge.js','auth.js','temple-ui.css','manifest.webmanifest'];
for(const file of files){let data=await readFile(new URL(file,root));if(file==='game.js')data=Buffer.from(data.toString().replace("https://t.me/Reef_casino_bot",'#qa-purchases-disabled'));if(file==='index.html')data=Buffer.from(data.toString().replace(/<script[^>]+src="https:\/\/telegram[^"]*"[^>]*><\/script>/g,''));await writeFile(stage+'/public/'+file,data);}
const assets=execFileSync('git',['ls-files','assets/'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>/\.(webp|png|svg|jpg|jpeg|ico)$/.test(p));for(const asset of assets)await copyFile(new URL(asset,root),stage+'/public/'+asset);
await writeFile(stage+'/public/config.js','window.RR_API=location.origin;window.RR_LOCAL_QA=true;window.Telegram={WebApp:{initData:""}};');
await build({entryPoints:[new URL('qa-worker.mjs',import.meta.url).pathname],outfile:stage+'/qa-worker.js',bundle:true,format:'esm',platform:'browser'});
const binding={binding:'DB',database_name:'reef-rumble-pr2-qa-db',database_id:'c78bb817-3eba-4620-a9a1-fb9807f20465'};
const config={name:'reef-rumble-pr2-qa',account_id:'ad444d1dcfb357861f9157b5bc226576',main:'qa-worker.js',compatibility_date:'2026-11-07',workers_dev:true,assets:{directory:'./public',binding:'ASSETS',run_worker_first:true},previews:{vars:{TEST_QA:'1'},d1_databases:[binding]},d1_databases:[binding],vars:{TEST_QA:'1'}};
await writeFile(stage+'/wrangler.json',JSON.stringify(config,null,2));
let sql='';for(const name of ['worker/migrations/0001_init.sql','worker/migrations/0002_accounts.sql','worker/proposals/0004_combat.sql'])sql+='\n'+await readFile(new URL(name,root),'utf8');await writeFile(stage+'/qa-schema.sql',sql);
console.log(JSON.stringify({stage,publicFiles:files.length+assets.length,onlyD1:binding.database_name,productionBindings:false}));
