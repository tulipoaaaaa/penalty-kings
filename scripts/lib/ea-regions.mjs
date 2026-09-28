// EARLY ACCESS regions: build-time conditional code in the game's shared files (docs/EARLY-ACCESS.md).
//
//   /*EA{ <early access code> }*/ <full code> /*}EA*/     early access: the first part; full: the second
//   /*EA+ <early access code> +EA*/                       early access: the code; full: nothing
//
// In the full preset these are plain comments, which esbuild drops and its minifier leaves out of the name statistics,
// so the full build stays byte-identical to the judged one (scripts/check-full-identical.mjs). The early access preset
// runs every game .ts/.tsx file through applyEarlyAccess() (an esbuild onLoad plugin, installed by preset-hooks.mjs).
// Keep region code small: calls into game/features.ts and earlyaccess.tsx, which are ordinary, type-checked modules.
// `npm run typecheck:ea` type-checks the game as the early access preset sees it.
import { readFile } from "node:fs/promises";

const REPLACE = /\/\*EA\{([\s\S]*?)\}\*\/[\s\S]*?\/\*\}EA\*\//g;
const ADD = /\/\*EA\+([\s\S]*?)\+EA\*\//g;
const LEFTOVER = /\/\*EA[{+]|\/\*\}EA\*\/|\+EA\*\//;

/** The source as the early access preset compiles it. Throws on an unbalanced or nested marker. */
export function applyEarlyAccess(source, file = "source") {
  const out = source.replace(REPLACE, (_, code) => code).replace(ADD, (_, code) => code);
  const left = out.match(LEFTOVER);
  if (left) throw new Error(`${file}: unbalanced early access marker "${left[0]}" (see scripts/lib/ea-regions.mjs)`);
  return out;
}

/** Number of early access regions in a source file. */
export const regionCount = source => (source.match(/\/\*EA[{+]/g) ?? []).length;

/** esbuild plugin: compile the game's own .ts/.tsx files (never node_modules) with their early access regions applied. */
export function earlyAccessPlugin() {
  return {
    name: "pk-early-access",
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async args => {
        if (args.path.includes(`${"/"}node_modules${"/"}`)) return undefined;
        const source = await readFile(args.path, "utf8");
        if (!regionCount(source)) return undefined;
        return { contents: applyEarlyAccess(source, args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
      });
    },
  };
}
