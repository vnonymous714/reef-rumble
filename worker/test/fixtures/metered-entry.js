// Test-only Worker entry: the real Worker + PlayerGame with env.DB wrapped to
// sum D1 meta.rows_written, and DO storage puts/alarms counted. Never deployed.
import worker, { PlayerGame as Real } from "../../src/index.js";
const M = (globalThis.__meter ||= { d1Rows: 0, d1Batches: 0, doPuts: 0, doAlarms: 0 });
const add = (r) => { for (const x of Array.isArray(r) ? r : [r]) M.d1Rows += x?.meta?.rows_written || 0; return r; };
function wrapStmt(s) {
  return new Proxy(s, { get(t, k) { const v = t[k];
    if (k === "bind") return (...a) => wrapStmt(v.apply(t, a));
    if (k === "run" || k === "all") return async (...a) => add(await v.apply(t, a));
    return typeof v === "function" ? v.bind(t) : v; } });
}
function wrapDb(db) {
  return new Proxy(db, { get(t, k) { const v = t[k];
    if (k === "prepare") return (q) => wrapStmt(v.call(t, q));
    if (k === "batch") return async (ops) => { M.d1Batches++; return add(await v.call(t, ops)); };
    return typeof v === "function" ? v.bind(t) : v; } });
}
const wrapEnv = (env) => ({ ...env, DB: wrapDb(env.DB) });
export class PlayerGame extends Real {
  constructor(ctx, env) {
    const st = ctx.storage;
    const storage = { get: (k) => st.get(k), put: (k, v) => { M.doPuts++; return st.put(k, v); }, setAlarm: (t) => { M.doAlarms++; return st.setAlarm(t); } };
    super({ ...ctx, storage }, wrapEnv(env));
  }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/__meter") return Response.json(M);
    return super.fetch(req);
  }
}
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === "/__meter") {
      const id = Number(u.searchParams.get("acct"));
      const doM = id ? await (await env.PLAYER_GAME.get(env.PLAYER_GAME.idFromName((env.GAME_DO_HINT || "wnam") + ":" + id)).fetch("https://x/__meter")).json() : null;
      return Response.json({ worker: M, do: doM });
    }
    return worker.fetch(req, wrapEnv(env), ctx);
  },
};
