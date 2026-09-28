// DEV ONLY — local play + showroom on http://localhost:5199 (never part of site/ or Pages).
//   npm run play:dev          (binds 0.0.0.0 so Windows Chrome reaches it through WSL)
//   npm run play:ea           the EARLY ACCESS preset (docs/EARLY-ACCESS.md): a copy of the game with the preview
//                             Friend's rated odds, compiled with its early access regions (no watch: rerun after edits)
import { createServer } from "node:http";
import { join } from "node:path";
import { cp, copyFile, readFile, rm } from "node:fs/promises";
import { context } from "esbuild";
import { installPreset, presetFromEnv } from "../scripts/lib/preset.mjs";
import { createDevHandler } from "./handler.mjs"; // the routes (tested by scripts/test-dev-server.mjs)

const PRESET = presetFromEnv(), EA = PRESET === "early-access";
installPreset(PRESET); // before the SDK build is imported (the early access preset hooks its esbuild)
const { buildGame } = await import("@rarefriends/friendsdk/build");
const PORT = Number(process.env.PORT ?? 5199), ROOT = new URL("..", import.meta.url).pathname;
const PLAY = join(ROOT, ".dev/play"), SHOWROOM = join(ROOT, ".dev/showroom");
let GAME = join(ROOT, "games/penalty-kings");
if (EA) {
  const { previewGeneration } = JSON.parse(await readFile(join(GAME, "config/ratings.json"), "utf8"));
  const copy = join(ROOT, ".dev/ea-game/penalty-kings");
  await rm(join(ROOT, ".dev/ea-game"), { recursive: true, force: true });
  await cp(GAME, copy, { recursive: true, filter: source => !source.includes(".friendsdk") });
  await copyFile(join(GAME, `tiers/ratings/park-gen-${previewGeneration}.json`), join(copy, "game.json"));
  GAME = copy;
}
await buildGame(GAME, { outdir: PLAY, watch: !EA });
const showroom = await context({
  entryPoints: [join(ROOT, "dev/showroom/main.ts")], bundle: true, format: "iife", platform: "browser", target: "es2022",
  outfile: join(SHOWROOM, "app.js"), loader: { ".woff2": "file" }, assetNames: "[name]", logLevel: "warning",
});
await showroom.watch();
const randomnessDelayMs = Number(process.env.PK_RANDOMNESS_DELAY_MS ?? 0) || 0;
createServer(createDevHandler({ root: ROOT, play: PLAY, showroom: SHOWROOM, randomnessDelayMs })).listen(PORT, "0.0.0.0", () => {
  console.log(`\n  PLAY      http://localhost:${PORT}/            (real SDK runtime, read-only DEV mock wallet, simulated economy${EA ? "; EARLY ACCESS preset" : ""})`);
  console.log(`  SHOWROOM  http://localhost:${PORT}/showroom/   (scene engine, every moment on demand)\n  Edits rebuild automatically; refresh the browser.\n`);
});
