// EARLY ACCESS: writes one ChanceGame definition per rating per stadium from games/penalty-kings/config/ratings.json:
//   games/penalty-kings/tiers/ratings/<tier>-gen-<n>.json          (6 per stadium)
//   games/penalty-kings/tiers/ratings/<tier>-gen-<n>-bonus.json    (6 more per stadium, only while the bonus is enabled)
// Same price, outcome names and rewards as tiers/<tier>.json; only the chances change (solved from the rating, see
// games/penalty-kings/game/ratings.ts). `npm run verify:odds` fails if these files differ from what this script writes.
//   npm run gen:ratings            write the files
//   npm run gen:ratings -- --check exit 1 if any file is missing, stale or extra (used by verify:odds)
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { ratingConfig, ratedDefinition, ratedVariants } from "../games/penalty-kings/game/ratings.ts";

export const TIERS = ["park", "pro", "champions"];
const GAME = new URL("../games/penalty-kings/", import.meta.url);
const OUT = new URL("tiers/ratings/", GAME);

/** { "park-gen-3.json": "<json text>", … } for the current config. */
export async function expectedFiles() {
  const config = ratingConfig(), files = {};
  for (const tier of TIERS) {
    const base = JSON.parse(await readFile(new URL(`tiers/${tier}.json`, GAME), "utf8"));
    for (const variant of ratedVariants(config)) files[`${tier}-${variant.file}.json`] = JSON.stringify(ratedDefinition(base, variant.label, variant.rtpBps), null, 2) + "\n";
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check"), files = await expectedFiles();
  await mkdir(OUT, { recursive: true });
  const present = (await readdir(OUT)).filter(name => name.endsWith(".json"));
  const problems = [];
  for (const [name, text] of Object.entries(files)) {
    const current = await readFile(new URL(name, OUT), "utf8").catch(() => null);
    if (current === text) continue;
    if (check) problems.push(`${name}: ${current === null ? "missing" : "stale"}`); else await writeFile(new URL(name, OUT), text);
  }
  for (const name of present) if (!(name in files)) { if (check) problems.push(`${name}: not produced by the config`); else await rm(new URL(name, OUT)); }
  if (problems.length) { console.error(`tiers/ratings is out of date (run npm run gen:ratings):\n${problems.join("\n")}`); process.exit(1); }
  console.log(check ? `PASS gen:ratings --check: ${Object.keys(files).length} rated definitions up to date` : `wrote ${Object.keys(files).length} rated definitions → games/penalty-kings/tiers/ratings/`);
}
