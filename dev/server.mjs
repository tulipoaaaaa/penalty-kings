// DEV ONLY — local play + showroom on http://localhost:5199 (never part of site/ or Pages).
//   npm run play:dev          (binds 0.0.0.0 so Windows Chrome reaches it through WSL)
import { createServer } from "node:http";
import { join } from "node:path";
import { context } from "esbuild";
import { buildGame } from "@rarefriends/friendsdk/build";
import { createDevHandler } from "./handler.mjs"; // the routes (tested by scripts/test-dev-server.mjs)

const PORT = Number(process.env.PORT ?? 5199), ROOT = new URL("..", import.meta.url).pathname;
const PLAY = join(ROOT, ".dev/play"), SHOWROOM = join(ROOT, ".dev/showroom");
await buildGame(join(ROOT, "games/penalty-kings"), { outdir: PLAY, watch: true });
const showroom = await context({
  entryPoints: [join(ROOT, "dev/showroom/main.ts")], bundle: true, format: "iife", platform: "browser", target: "es2022",
  outfile: join(SHOWROOM, "app.js"), loader: { ".woff2": "file" }, assetNames: "[name]", logLevel: "warning",
});
await showroom.watch();
const randomnessDelayMs = Number(process.env.PK_RANDOMNESS_DELAY_MS ?? 0) || 0;
createServer(createDevHandler({ root: ROOT, play: PLAY, showroom: SHOWROOM, randomnessDelayMs })).listen(PORT, "0.0.0.0", () => {
  console.log(`\n  PLAY      http://localhost:${PORT}/            (real SDK runtime, read-only DEV mock wallet, simulated economy)`);
  console.log(`  SHOWROOM  http://localhost:${PORT}/showroom/   (scene engine, every moment on demand)\n  Edits rebuild automatically; refresh the browser.\n`);
});
