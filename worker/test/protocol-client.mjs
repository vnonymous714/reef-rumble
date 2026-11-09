// Synthetic tests emulate the shipped client identity protocol. Security tests
// import the raw production function and deliberately bypass this convenience.
import {gameV2 as raw} from '../src/game-v2.js';
import {actionSequence} from '../src/retention.js';
export async function gameV2(env,account,body,now,rng){
  if(body.seq===undefined) body.seq=(await env.DB.prepare('SELECT sync_seq FROM accounts WHERE id=?').bind(account).first())?.sync_seq;
  if(actionSequence(body.id)===null) body.id=`${body.seq}_${body.id}`;
  return raw(env,account,body,now,rng);
}
