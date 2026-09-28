// Build presets (docs/EARLY-ACCESS.md).
//   full          (default) the judged game. Nothing is added to the build: the early access regions in the game's
//                 source are comments, so site/ stays byte-identical to the judged build (check:full-identical).
//   early-access  only real-money balls, Practice, Daily Challenge and the Scouting Book (game/features.ts): the
//                 SDK build compiles the game with its early access regions applied (scripts/lib/ea-regions.mjs).
// The SDK's buildGame (@rarefriends/friendsdk/build, also used by /testing) takes no esbuild options, so
// installPreset("early-access") adds the plugin through a Node module hook around the SDK build script's `esbuild`
// import (preset-hooks.mjs). A build without the hook (the SDK's own CLI: `friendsdk test/dev/check`) is the full game.
import { register } from "node:module";

export const PRESETS = ["full", "early-access"];

export function presetFromEnv(env = process.env) {
  const preset = env.PK_PRESET || "full";
  if (!PRESETS.includes(preset)) throw new Error(`PK_PRESET must be one of ${PRESETS.join(", ")} (got "${preset}")`);
  return preset;
}

let installed = null;
/** Call BEFORE the first import of @rarefriends/friendsdk/build (or /testing): that import must go through the hook. */
export function installPreset(preset) {
  if (!PRESETS.includes(preset)) throw new Error(`unknown preset ${preset}`);
  if (installed !== null) { if (installed !== preset) throw new Error(`preset already installed as ${installed}`); return; }
  installed = preset;
  if (preset === "full") return; // the full game needs nothing: its build is exactly the SDK's
  register("./preset-hooks.mjs", import.meta.url, { data: { plugin: new URL("./ea-regions.mjs", import.meta.url).href } });
}
