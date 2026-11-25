// tg40: one build constant drives client-version, the /start Play button and
// the bot menu button URL (Telegram WebView cache-bust).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_BUILD, miniAppUrl } from "../src/build.js";
import worker, { syncMenuButton } from "../src/index.js";
import { readFileSync } from "node:fs";

const env = { MINIAPP_URL: "https://vnonymous714.github.io/reef-rumble/?tg=1", BOT_TOKEN: "x", TG_API: "https://tg.local", GAME_V2: "1", ALLOWED_ORIGIN: "https://vnonymous714.github.io" };
function fakeTg(menu) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const method = String(url).split("/").pop(), body = JSON.parse(o.body);
    calls.push([method, body]);
    if (method === "getChatMenuButton") return Response.json({ ok: true, result: menu });
    if (method === "setChatMenuButton" || method === "sendMessage") return Response.json({ ok: true, result: true });
    return Response.json({ ok: false });
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}

test("build constant: tg40, wrangler MINIAPP_URL gets &v=tg40, client-version reports it", async () => {
  assert.equal(CLIENT_BUILD, "tg40");
  assert.equal(miniAppUrl(env), "https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg40");
  assert.match(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"), /MINIAPP_URL = "https:\/\/vnonymous714\.github\.io\/reef-rumble\/\?tg=1"/);
  const f = fakeTg({ type: "default" });
  try {
    const r = await worker.fetch(new Request("https://w/api/client-version"), env, { waitUntil() {} });
    assert.equal((await r.json()).clientBuild, "tg40");
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  } finally { f.restore(); }
});

test("menu button: an old Reef web_app URL is moved to the build URL (text kept); current/foreign/default menus untouched unless forced", async () => {
  let f = fakeTg({ type: "web_app", text: "Play", web_app: { url: "https://vnonymous714.github.io/reef-rumble/?tg=1" } });
  try {
    assert.deepEqual(await syncMenuButton(env), { ok: true, url: "https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg40", changed: true });
    assert.deepEqual(f.calls[1], ["setChatMenuButton", { menu_button: { type: "web_app", text: "Play", web_app: { url: "https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg40" } } }]);
  } finally { f.restore(); }
  f = fakeTg({ type: "web_app", text: "Play", web_app: { url: "https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg40" } });
  try { assert.equal((await syncMenuButton(env)).changed, false); assert.equal(f.calls.length, 1); } finally { f.restore(); }
  f = fakeTg({ type: "web_app", text: "Shop", web_app: { url: "https://example.com/other" } });
  try { assert.match((await syncMenuButton(env)).skipped, /web_app/); assert.equal(f.calls.length, 1); } finally { f.restore(); }
  f = fakeTg({ type: "default" });
  try {
    assert.match((await syncMenuButton(env)).skipped, /default/);
    assert.equal((await syncMenuButton(env, true)).changed, true);
    assert.equal(f.calls.at(-1)[1].menu_button.text, "Play");
  } finally { f.restore(); }
});

test("/start Play button opens the versioned URL", async () => {
  const f = fakeTg({ type: "default" });
  try {
    const up = { message: { text: "/start", chat: { id: 5, type: "private" }, from: { id: 5 } } };
    const r = await worker.fetch(new Request("https://w/tg/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify(up) }), { ...env, WEBHOOK_SECRET: "s" }, { waitUntil() {} });
    assert.equal(r.status, 200);
    const send = f.calls.find(([m]) => m === "sendMessage");
    assert.equal(send[1].reply_markup.inline_keyboard[0][0].web_app.url, "https://vnonymous714.github.io/reef-rumble/?tg=1&v=tg40");
  } finally { f.restore(); }
});
