/* No project Wrangler config, credentials, remote bindings or persistence. */
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
export async function localV2() {
  const bundle = await build({
    entryPoints: [new URL("../src/index.js", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-10-01",
      bindings: {
        GAME_V2: "1",
        ALLOWED_ORIGIN: "http://localhost:8089",
        BOT_TOKEN: "local-testing-fixture-not-a-real-bot-token",
      },
      d1Databases: { DB: "isolated-reef-v2" },
      d1Persist: false,
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const path of [
    "../migrations/0001_init.sql",
    "../migrations/0002_accounts.sql",
    "../proposals/0004_combat.sql",
  ]) {
    const sql = readFileSync(new URL(path, import.meta.url), "utf8").replace(
      /^--.*$/gm,
      "",
    );
    for (const statement of sql.split(";").filter((s) => s.trim()))
      await db.prepare(statement).run();
  }
  return { mf, db };
}
