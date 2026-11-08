const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  cp = require("node:child_process");
const read = (p) =>
  fs.readFileSync(new URL("../" + p, "file://" + __filename), "utf8");
test("candidate uses original detailed art unchanged and never imports legacy gameplay wheel or balance mutation", () => {
  const js = read("candidate.js"),
    html = read("candidate.html");
  assert.equal(
    cp
      .execFileSync("git", ["hash-object", "assets/bg.webp"], {
        encoding: "utf8",
      })
      .trim(),
    cp
      .execFileSync("git", ["rev-parse", "9b0f501:assets/bg.webp"], {
        encoding: "utf8",
      })
      .trim(),
  );
  for (const art of ["minnow", "guppy", "cannon", "chest", "kraken", "dragon"])
    assert.ok(js.includes('"' + art + '"'));
  for (const name of ["game.js", "engine.js", "slots.js", "tg.js"])
    assert.ok(!html.includes('src="' + name));
  assert.ok(!js.includes("/api/sync"));
  assert.ok(!js.includes("/api/grant"));
  assert.ok(!js.includes("Math.random"));
  assert.match(js, /api\/v2\/game/);
  assert.match(js, /sessionStorage/);
  assert.match(js, /rr.candidate.pending/);
  assert.match(js, /AbortSignal.timeout/);
  assert.match(html, /Play credits only/);
  assert.ok(!html.includes("$"));
});
test("candidate controls and art paths resolve, and real bomb death is the sole terrain trigger", () => {
  const js = read("candidate.js"),
    html = read("candidate.html");
  for (const m of js.matchAll(/\$\("#([A-Za-z][A-Za-z0-9]*)"\)/g)) {
    const id = m[1];
    assert.ok(
      html.includes('id="' + id + '"') ||
        js.includes('id="' + id + '"') ||
        js.includes('id=\\"' + id + '\\"'),
      id,
    );
  }
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g))
    assert.ok(
      /^https:\/\//.test(m[1]) ||
        fs.existsSync(new URL("../" + m[1], "file://" + __filename)),
      m[1],
    );
  assert.equal((js.match(/FX.bomb\(/g) || []).length, 1);
  assert.match(js, /hit.dead && hit.kind === "bomb"/);
  assert.match(js, /reduced.matches/);
});
