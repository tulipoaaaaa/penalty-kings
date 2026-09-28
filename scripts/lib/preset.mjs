// Build presets (docs/EARLY-ACCESS.md). The game reads ONE build-time constant, `globalThis.PK_EARLY_ACCESS`, and
// esbuild folds every `globalThis.PK_EARLY_ACCESS ? earlyAccess : full` at build time, so each preset ships only its
// own code. The SDK's buildGame (@rarefriends/friendsdk/build) takes no esbuild options, so installPreset() adds the
// define through a Node module hook around the `esbuild` import of the SDK's build script (preset-hooks.mjs).
//   full          (default) the judged game, byte-identical to a build without this hook
//   early-access  only real-money balls, Practice, Daily Challenge and the Scouting Book (game/features.ts)
// A build WITHOUT the hook (the SDK's own CLI: `friendsdk test/dev/check`) leaves the constant undefined: the full game.
import { register } from "node:module";

export const PRESETS = ["full", "early-access"];

export function presetFromEnv(env = process.env) {
  const preset = env.PK_PRESET || "full";
  if (!PRESETS.includes(preset)) throw new Error(`PK_PRESET must be one of ${PRESETS.join(", ")} (got "${preset}")`);
  return preset;
}

export const presetDefines = preset => ({ "globalThis.PK_EARLY_ACCESS": preset === "early-access" ? "true" : "false" });

let installed = null;
/** Call BEFORE the first import of @rarefriends/friendsdk/build (or /testing): that import must go through the hook. */
export function installPreset(preset) {
  if (installed !== null) { if (installed !== preset) throw new Error(`preset already installed as ${installed}`); return; }
  register("./preset-hooks.mjs", import.meta.url, { data: { define: presetDefines(preset) } });
  installed = preset;
}
