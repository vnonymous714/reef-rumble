const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  cp = require("node:child_process");
const read = (p) =>
  fs.readFileSync(new URL("../" + p, "file://" + __filename), "utf8");
test("primary candidate preserves original detailed art and actual game/account/store shell", () => {
  const js = read("authority-bridge.js"),
    game = read("game.js"),
    html = read("index.html");
  const original = cp
    .execFileSync("git", ["ls-tree", "-r", "9b0f501", "assets/"], {
      encoding: "utf8",
    })
    .trim()
    .split("\n");
  for (const row of original) {
    const [, hash, path] = row.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/) || [];
    if (!path) continue;
    assert.equal(
      cp
        .execFileSync("git", ["hash-object", path], { encoding: "utf8" })
        .trim(),
      hash,
      path,
    );
  }
  for (const name of [
    "engine.js",
    "game.js",
    "auth.js",
    "tgbridge.js",
    "slots.js",
    "authority-bridge.js",
    "reef-motion.js",
    "reef-laser-pickups.js",
  ])
    assert.match(
      html,
      new RegExp('src="' + name.replace(".", "\\.") + '\\?v=tg29"'),
    );
  for (const id of ["cv", "slotsBtn", "storeM", "rebuyBtn", "infoM", "dailyM"])
    assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /window.RR_AUTHORITATIVE=true/);
  assert.match(game, /ReefMotion.point\(f.server/);
  assert.ok(game.includes("const im = ART.bg.img"));
  assert.ok(game.includes("ctx.drawImage(fr, -sp.w / 2"));
  for (const forbidden of ["/api/sync", "/api/grant", "Math.random"])
    assert.ok(!js.includes(forbidden));
  assert.match(js, /quoteId:\s*q.id/);
  assert.match(js, /sessionStorage/);
  assert.match(js, /AbortSignal.timeout/);
  assert.match(js, /requestEpoch/);
  assert.match(
    read("slots.js"),
    /if\(window.RR_AUTHORITATIVE\).*ReefAuthority.openBonus/,
  );
  assert.match(read("candidate.html"), /index.html\?client=v2/);
});
test("primary dependencies resolve; only local server can inject synthetic QA controls", () => {
  const html = read("index.html"),
    bridge = read("authority-bridge.js");
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const path = m[1].split("?")[0];
    if (/^(https?:|data:)/.test(path)) continue;
    assert.ok(
      fs.existsSync(new URL("../" + path, "file://" + __filename)),
      path,
    );
  }
  assert.ok(!html.includes("loadLocalFixture"));
  assert.ok(!bridge.includes("/qa/fixture"));
  const server = read("tools/candidate-server.mjs");
  assert.match(server, /file === "index.html"/);
  assert.match(server, /window.RR_API=location.origin/);
  assert.match(server, /LOAD SPECIAL-FISH TEST SCENE/);
  assert.ok(!server.includes('"config.js",'));
  assert.match(read("sw.js"), /rr-static-tg29-smooth/);
  assert.match(read("sw.js"), /client.navigate/);
  assert.match(read("sw.js"), /url.pathname.startsWith\('\/api\/'\)/);
});
test('tg29 PWA cutover scopes cache cleanup and forced navigation to Reef, not sibling projects',()=>{const sw=read('sw.js');assert.ok(sw.includes("k.startsWith('rr-')"));assert.ok(sw.includes('url.pathname.startsWith(scope.pathname)'));assert.ok(sw.includes('self.registration.scope'));assert.equal(JSON.parse(read('manifest.webmanifest')).start_url,'./?client=v2&build=tg29');});
