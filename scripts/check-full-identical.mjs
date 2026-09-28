// EARLY ACCESS guard: the default ("full") preset must publish exactly the judged site. Compares every file of site/
// (run `npm run build:site` first) with the SHA-256 manifest of the site built at d51e550, the judged head of
// claude/clever-mccarthy-ay7qv7 (tests/early-access/full-site-d51e550.sha256). Any added, missing or changed file fails.
// If the full game is changed on purpose later, regenerate the manifest from that build and say so in the commit.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const SITE = process.argv[2] ?? "site", MANIFEST = "tests/early-access/full-site-d51e550.sha256";
if (!existsSync(SITE)) { console.error(`${SITE}/ missing: run npm run build:site first`); process.exit(1); }
const expected = new Map(readFileSync(MANIFEST, "utf8").trim().split("\n").map(line => { const [hash, ...name] = line.split("  "); return [name.join("  "), hash]; }));
const actual = new Map();
const walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else actual.set(relative(SITE, path), createHash("sha256").update(readFileSync(path)).digest("hex")); } };
walk(SITE);
const problems = [];
for (const [name, hash] of expected) if (!actual.has(name)) problems.push(`missing: ${name}`); else if (actual.get(name) !== hash) problems.push(`changed: ${name}`);
for (const name of actual.keys()) if (!expected.has(name)) problems.push(`added: ${name}`);
if (problems.length) { console.error(`FAIL check-full-identical: ${SITE}/ differs from the judged build (d51e550)\n${problems.join("\n")}`); process.exit(1); }
console.log(`PASS check-full-identical: ${SITE}/ is byte-identical to the judged build at d51e550 (${expected.size} files)`);
