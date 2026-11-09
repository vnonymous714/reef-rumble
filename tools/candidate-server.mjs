/* Review only: in-memory local D1, fresh on every launch. NO remote config. */
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { localV2 } from "../worker/test/local-v2.mjs";
import { gameV2 } from "../worker/src/game-v2.js";
const root = new URL("../", import.meta.url),
  { mf, db } = await localV2();
const allowed = new Set([
  "index.html",
  "candidate.html",
  "engine.js",
  "telemetry.js",
  "game.js",
  "authority-bridge.js",
  "reef-motion.js",
  "reef-laser-pickups.js",
  "temple-ui.css",
  "auth.js",
  "tgbridge.js",
  "slots.js",
  "slotmath.js",
  "manifest.webmanifest",
  "bonusmath.js",
  "reef-fx.js",
  ...(await readdir(new URL("assets/", root))).map((n) => "assets/" + n),
]);
const api = new Set([
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/v2/game",
]);
const types = {
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  webp: "image/webp",
  png: "image/png",
  svg: "image/svg+xml",
};
const localControls = `<aside id="localOnlyQA" style="position:fixed;left:8px;top:92px;right:auto;width:auto;z-index:35;background:#071a28ed;border:1px solid #ffd27a;border-radius:8px;padding:5px;max-width:190px;font:10px system-ui;color:#ffe3a0"><b>LOCAL ONLY · ISOLATED QA</b><br><button type="button" id="loadLocalFixture" style="font:700 10px system-ui;min-height:30px;padding:4px 7px">LOAD SPECIAL-FISH TEST SCENE</button><span id="localFixtureStatus" role="status" style="display:block;font-size:9px">Sign in locally first. No production accounts.</span></aside>
<script>(()=>{const b=document.getElementById('loadLocalFixture'),status=document.getElementById('localFixtureStatus');b.onclick=async()=>{const token=window.__rrAuth?.token?.();if(!token){status.textContent='Create or sign in to a LOCAL test account first.';return;}b.disabled=true;status.textContent='Loading local fixture…';try{const r=await fetch('/qa/fixture',{method:'POST',headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('Local fixture status '+r.status);status.textContent='Local scene loaded. Reloading…';location.reload();}catch(e){status.textContent=e.message;b.disabled=false;}}})();</script>`;
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    let path = decodeURIComponent(u.pathname);
    if (req.method === "POST" && (api.has(path) || path === "/qa/fixture")) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32768) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      if (path === "/qa/fixture") {
        // Local-only staged scene, never included in the production Worker.
        const hash = createHash("sha256")
          .update((req.headers.authorization || "").replace(/^Bearer /, ""))
          .digest("hex");
        const session = await db
          .prepare("SELECT account_id FROM sessions WHERE token_hash=?")
          .bind(hash)
          .first();
        if (!session) {
          res.writeHead(401);
          res.end();
          return;
        }
        const account = session.account_id;
        await gameV2({ DB: db, GAME_V2: "1" }, account, {
          command: "state",
          id: crypto.randomUUID(),
        });
        const row = await db
          .prepare("SELECT state_json FROM economy_world WHERE account_id=?")
          .bind(account)
          .first();
        const w = JSON.parse(row.state_json),
          now = Date.now();
        for (const [i, art, kind, mult] of [
          [0, "chest", "temple", 12],
          [1, "bomb", "bomb", 15],
          [2, "laser", "laser", 18],
          [3, "eel", "chain", 12],
        ])
          w.fishes[i] = {
            id: "qa_" + art + "_" + now,
            art,
            mult,
            kind,
            born: now - 10000,
            expires: now + 300000,
            x: 0.24 + i * 0.17,
            y: 0.4,
            dead: false,
            len: 80,
            h: 60,
            motion: {
              p: [
                { x: -0.1, y: 0.3 + i * 0.08 },
                { x: 0.2, y: 0.3 + i * 0.08 },
                { x: 0.8, y: 0.4 + i * 0.05 },
                { x: 1.1, y: 0.4 + i * 0.05 },
              ],
              duration: 60000,
              off: 0,
            },
          };
        w.pausedAt = 0;
        w.offers = [];
        w.styleUntil = 0;
        w.cooldownUntil = 0;
        w.laserUntil = 0;
        await db.batch([
          db
            .prepare(
              "UPDATE economy_world SET state_json=?,version=version+1 WHERE account_id=?",
            )
            .bind(JSON.stringify(w), account),
          db
            .prepare(
              "UPDATE accounts SET balance=100000,sync_seq=sync_seq+1 WHERE id=?",
            )
            .bind(account),
        ]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            localFixture: true,
            info: "Local scene: 1000 credits; Temple Crab, bomb, laser ray and eel. HP and rolls remain real.",
          }),
        );
        return;
      }
      const reply = await mf.dispatchFetch("http://localhost" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Reef-Protocol": "2",
          ...(req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {}),
        },
        body,
      });
      res.writeHead(reply.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(Buffer.from(await reply.arrayBuffer()));
      return;
    }
    if (path === "/config.js") {
      const bytes = "window.RR_API=location.origin;window.RR_LOCAL_QA=true;";
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
      return;
    }
    if (path === "/") path = "/index.html";
    const file = path.slice(1);
    if (!["GET", "HEAD"].includes(req.method) || !allowed.has(file)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    let bytes = await readFile(new URL(file, root));
    // Test controls exist only in this local server response, not candidate.html,
    // game code, production Worker, or any deployable static artifact.
    if (file === "index.html")
      bytes = Buffer.from(
        bytes.toString().replace("</body>", localControls + "</body>"),
      );
    res.writeHead(200, {
      "Content-Type":
        types[file.split(".").pop()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": bytes.length,
      "X-Reef-Preview": "isolated-local",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(500);
    res.end("Local preview request failed");
  }
});
server.listen(Number(process.env.PORT || 8089), "0.0.0.0", () =>
  console.log(
    "Isolated candidate: http://localhost:" +
      server.address().port +
      "/index.html · no remote DB, no production accounts · restart clears all local data",
  ),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    server.close();
    await mf.dispose();
    process.exit();
  });
