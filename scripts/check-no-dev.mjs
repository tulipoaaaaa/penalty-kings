// Fails if any dev-only code (mock wallet, Showroom) leaked into the published site/.
// Run after `npm run build:site`. Used by CI and by the Pages workflow before upload.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { brokenLinks } from "./lib/site-links.mjs";

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
  }
};
walk("site");
// BQ-P2 (/live/ 404): every internal link of every page resolves to a file in site/.
for (const link of brokenLinks("site")) hits.push(`broken internal link: ${link}`);
if (hits.length) { console.error(`NOT PUBLISHABLE: site/\n${hits.join("\n")}`); process.exit(1); }
console.log("PASS check-no-dev: site/ contains no dev-only code, and every internal link resolves");
