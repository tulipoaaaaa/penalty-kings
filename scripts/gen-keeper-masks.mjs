// Regenerates the engine's keeper hit masks from the keeper art (round 6 E23).
//
// packages/engine/src/keeper-rig.ts holds KEEPER_RIGS: per keeper the sprite scale, shoulder row,
// arm length and the opaque-pixel mask of each physics pose (set / launch / stretch). The masks are
// a COPY of the art in games/penalty-kings/gfx/keepers.ts (the engine is shared with the verifier and
// cannot import game code), so this script rebuilds that block from keeperRows() / keeperMask().
//
//   node scripts/gen-keeper-masks.mjs           rewrite the generated block
//   node scripts/gen-keeper-masks.mjs --check   exit 1 if the block is stale
//   node scripts/gen-keeper-masks.mjs --ascii   also print every frame of every keeper
//
// Then run `npm run sync:engine` (node_modules holds a copy of the engine).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname, out = join(root, ".dev/gen-keeper-masks");
const RIG = join(root, "packages/engine/src/keeper-rig.ts");
mkdirSync(out, { recursive: true });
await build({
  stdin: { contents: `export { KEEPER_DESIGNS, KEEPER_SHEET, keeperMask, keeperRows } from "./games/penalty-kings/gfx/keepers.ts"; export { KEEPERS, RIG_POSES } from "@penalty-kings/engine";`, resolveDir: root, loader: "ts" },
  outfile: join(out, "art.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning",
  // The art must not depend on the masks it generates: resolve the engine from the source tree.
  alias: { "@penalty-kings/engine": join(root, "packages/engine/src/index.ts") },
});
const { KEEPER_DESIGNS, KEEPER_SHEET, KEEPERS, RIG_POSES, keeperMask, keeperRows } = await import(`${pathToFileURL(join(out, "art.mjs")).href}?${Date.now()}`);

const lines = ["  // <generated:keeper-masks> by scripts/gen-keeper-masks.mjs from games/penalty-kings/gfx/keepers.ts; do not edit by hand."];
for (const { id } of KEEPERS) {
  const design = KEEPER_DESIGNS[id], masks = RIG_POSES.map(pose => keeperMask(id, pose));
  const size = `${masks[0][0].length}×${masks[0].length}`;
  for (const [i, mask] of masks.entries()) {
    if (mask.some(row => row.length !== masks[0][0].length) || mask.length !== masks[0].length) throw new Error(`${id} ${RIG_POSES[i]}: every pose must share the ${size} grid`);
  }
  lines.push(`  ${id}: { scale: ${design.scale}, shoulderY: ${design.shoulderY}, armLength: ${design.armLength}, poses: {`);
  RIG_POSES.forEach((pose, i) => lines.push(`    ${pose}: [`, ...masks[i].map(row => `      "${row}",`), "    ],"));
  lines.push("  } },");
}
lines.push("  // </generated:keeper-masks>");

const source = readFileSync(RIG, "utf8");
const start = source.indexOf("  // <generated:keeper-masks>"), endMarker = "  // </generated:keeper-masks>", end = source.indexOf(endMarker) + endMarker.length;
if (start < 0 || end < endMarker.length) throw new Error("keeper-rig.ts: generated markers not found");
const next = source.slice(0, start) + lines.join("\n") + source.slice(end);

if (process.argv.includes("--ascii")) {
  for (const { id } of KEEPERS) {
    console.log(`\n== ${id}`);
    const frames = KEEPER_SHEET.map(({ look, phase }) => keeperRows(id, look, phase).rows);
    const h = Math.max(...frames.map(f => f.length));
    for (let r = 0; r < h; r++) console.log(frames.map((f, i) => (f[r - (h - f.length)] ?? " ".repeat(f[0].length)).replace(/\./g, " ") + (KEEPER_SHEET[i].physics ? "|" : " ")).join(" "));
  }
}
if (process.argv.includes("--check")) {
  if (next !== source) { console.error("keeper masks are STALE: run node scripts/gen-keeper-masks.mjs && npm run sync:engine"); process.exit(1); }
  console.log("keeper masks match the art");
} else {
  writeFileSync(RIG, next);
  console.log(`keeper masks ${next === source ? "unchanged" : "regenerated"} (${KEEPERS.length} keepers × ${RIG_POSES.length} poses)`);
}
