// Type-checks the game as the EARLY ACCESS preset compiles it: copies games/penalty-kings with its early access regions
// applied (scripts/lib/ea-regions.mjs) to .build-ea-types/ and runs tsc on it. (`npm run typecheck` sees the regions
// as comments, so it checks only the full game plus the early access modules themselves.)
import { cp, readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { applyEarlyAccess, regionCount } from "./lib/ea-regions.mjs";

const ROOT = new URL("..", import.meta.url).pathname, OUT = join(ROOT, ".build-ea-types");
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(ROOT, "games/penalty-kings"), join(OUT, "games/penalty-kings"), { recursive: true, filter: source => !source.includes(".friendsdk") });
let files = 0, regions = 0;
const walk = async dir => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const source = await readFile(path, "utf8"), count = regionCount(source);
    if (!count) continue;
    await writeFile(path, applyEarlyAccess(source, path)); files++; regions += count;
  }
};
await walk(join(OUT, "games"));
await writeFile(join(OUT, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["games/**/*.ts", "games/**/*.tsx", "games/**/*.d.ts"], exclude: ["**/.friendsdk/**"] }, null, 2));
try { execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(OUT, "tsconfig.json")], { stdio: "inherit", cwd: ROOT }); }
catch { console.error("FAIL typecheck:ea (paths above are under .build-ea-types/)"); process.exit(1); }
await rm(OUT, { recursive: true, force: true });
console.log(`PASS typecheck:ea: ${regions} early access regions in ${files} files type-check`);
