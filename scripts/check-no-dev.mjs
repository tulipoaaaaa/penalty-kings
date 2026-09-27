// Fails if any dev-only code (mock wallet, Showroom, the game's QA hooks) leaked into the published site/,
// or if any internal link in site/ does not resolve to a file.
// Run after `npm run build:site`. Used by CI and by the Pages workflow before upload.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks } from "./lib/site-links.mjs";
import { exposedQaHooks } from "./lib/qa-hooks.mjs";
import { TIERS, tierDir } from "./lib/stadium-nav.mjs";

const MARKERS = ["isPenaltyKingsDevWallet", "DEV mock wallet", "DEV SHOWROOM", "dev/showroom", "mock-wallet"];
if (!existsSync("site")) { console.error("site/ missing: run npm run build:site first"); process.exit(1); }
const hits = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name === "showroom") hits.push(`${path}: showroom directory`); walk(path); continue; }
    if (!/\.(html|js|mjs|css|json|map)$/.test(name)) continue;
    const text = readFileSync(path, "utf8");
    for (const marker of MARKERS) if (text.includes(marker)) hits.push(`${path}: contains "${marker}"`);
    // BQ-P2: no QA hooks on the public site (a PK_QA_HOOKS=1 build is for local QA only).
    for (const hook of exposedQaHooks(text)) hits.push(`${path}: exposes the QA hook window.${hook}`);
  }
};
walk("site");
// BQ-P2 (/live/ 404): every internal link of every page resolves to a file in site/.
for (const link of brokenLinks("site")) hits.push(`broken internal link: ${link}`);
// BQ-P2 (runtime.js dedupe): each stadium page has its own runtime.js because the SDK build bakes that tier's
// ChanceGame (name, price, odds) into it; one shared copy would sell every stadium at one price. So each
// runtime.js must carry its own tier's price (docs/HANDOFF-RF.md, "Hosting notes").
for (const [tier] of TIERS) for (const live of [false, true]) {
  const runtime = join("site", tierDir(tier, live), "runtime.js");
  if (!existsSync(runtime)) { if (!live) hits.push(`${runtime}: missing`); continue; }
  const { price } = JSON.parse(readFileSync(`games/penalty-kings/tiers/${tier}.json`, "utf8"));
  if (!readFileSync(runtime, "utf8").includes(`consumable:"Ball",price:"${price}"`)) hits.push(`${runtime}: does not carry the ${tier} ChanceGame (price ${price})`);
}
if (hits.length) { console.error(`NOT PUBLISHABLE: site/\n${hits.join("\n")}`); process.exit(1); }
console.log("PASS check-no-dev: site/ contains no dev-only code or QA hooks, and every internal link resolves");
