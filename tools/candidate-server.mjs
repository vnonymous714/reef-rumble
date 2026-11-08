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
  "candidate.html",
  "candidate.css",
  "candidate.js",
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
            born: now,
            expires: now + 300000,
            x: 0.24 + i * 0.17,
            y: 0.4,
            dead: false,
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
    if (path === "/") path = "/candidate.html";
    const file = path.slice(1);
    if (req.method !== "GET" || !allowed.has(file)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const bytes = await readFile(new URL(file, root));
    res.writeHead(200, {
      "Content-Type":
        types[file.split(".").pop()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(bytes);
  } catch {
    res.writeHead(500);
    res.end("Local preview request failed");
  }
});
server.listen(Number(process.env.PORT || 8089), "0.0.0.0", () =>
  console.log(
    "Isolated candidate: http://localhost:" +
      server.address().port +
      "/candidate.html · no remote DB, no production accounts · restart clears all local data",
  ),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    server.close();
    await mf.dispose();
    process.exit();
  });
