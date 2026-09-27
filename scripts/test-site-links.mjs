// BQ-P2 (/live/ 404): no stadium page links to a page the site build did not make.
//   1. Every combination of LIVE deployments (deployments/<tier>.json, any subset) and Clubhouse
//      (deployments/live.json): each built stadium page's links and opener map resolve to a built page.
//   2. The built site/ (if present): every internal href/src of every page resolves to a file.
// Usage: node scripts/test-site-links.mjs   (run `npm run build:site` first for part 2)
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { posix } from "node:path";
import { TIERS, stadiumNav, tierDir } from "./lib/stadium-nav.mjs";
import { brokenLinks, internalLinks } from "./lib/site-links.mjs";

const ids = TIERS.map(([id]) => id);
let combos = 0;
for (let mask = 0; mask < 1 << ids.length; mask++) {
  const liveTiers = new Set(ids.filter((_, i) => mask & (1 << i)));
  for (const clubhouse of [false, true]) {
    combos++;
    const built = new Set(["practice/", ...ids.map(id => tierDir(id, false)), ...[...liveTiers].map(id => tierDir(id, true)), ...(clubhouse ? ["live/clubhouse/"] : [])]);
    const pages = [...ids.map(id => [id, false]), ...[...liveTiers].map(id => [id, true])];
    for (const [tier, live] of pages) {
      const nav = stadiumNav({ tier, live, liveTiers, clubhouse });
      const from = tierDir(tier, live);
      const links = [...internalLinks(nav.bar), ...Object.values(nav.pages)];
      for (const link of links) {
        const target = posix.normalize(posix.join("/", from, link)).slice(1).replace(/^$/, "").replace(/([^/])$/, "$1/");
        assert(built.has(target === "/" ? "" : target), `live=[${[...liveTiers]}] clubhouse=${clubhouse}: /${from} links to /${target}, which is not built`);
      }
      if (liveTiers.size && !live) assert(links.some(link => link.includes("live/")), `live=[${[...liveTiers]}]: the simulated /${from} page links to a LIVE build`);
    }
  }
}
console.log(`  ✓ stadium links resolve for all ${combos} deployment combinations`);

if (existsSync("site/index.html")) {
  const broken = brokenLinks("site");
  assert.deepEqual(broken, [], `site/ has internal links to missing files:\n${broken.join("\n")}`);
  console.log("  ✓ every internal link in site/ resolves to a file");
} else console.log("  - site/ not built: skipped the built-site link check (npm run build:site)");
console.log("PASS test-site-links");
