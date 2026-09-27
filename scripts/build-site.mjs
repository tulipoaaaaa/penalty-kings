// Builds the static site for GitHub Pages.
//   site/            Park (simulated preview; the submission URL)
//   site/pro/        Pro (simulated)
//   site/champions/  Champions (simulated, shown as locked in-game)
//   site/live/…      LIVE builds, only when games/penalty-kings/deployments/<tier>.json exists
//   site/practice/   Free practice (5 kicks on the real engine + Stage; no wallet, no network): scripts/build-practice.mjs
// Each tier is a copy of the game directory with that tier's game.json (one SDK ChanceGame per tier).
import { cp, rm, mkdir, writeFile, readFile, access, copyFile } from "node:fs/promises";
import { buildGame, readGameDeployment } from "@rarefriends/friendsdk/build";
import { buildClubhouse } from "./build-clubhouse.mjs";
import { buildPractice } from "./build-practice.mjs";

const GAME = "games/penalty-kings", WORK = ".build", SITE = "site";
const exists = path => access(path).then(() => true, () => false);
await rm(WORK, { recursive: true, force: true }); await rm(SITE, { recursive: true, force: true });
await mkdir(SITE, { recursive: true });

async function buildTier(tier, outdir, deploymentFile) {
  const dir = `${WORK}/${tier}${deploymentFile ? "-live" : ""}`;
  await cp(GAME, dir, { recursive: true, filter: source => !source.includes(".friendsdk") });
  await copyFile(`${GAME}/tiers/${tier}.json`, `${dir}/game.json`);
  // Live builds read on-chain cosmetic unlocks from the deployed KitShop.
  if (deploymentFile && await exists(`${GAME}/deployments/live.json`)) await copyFile(`${GAME}/deployments/live.json`, `${dir}/live.json`);
  const deployment = deploymentFile ? await readGameDeployment(deploymentFile) : undefined;
  const build = await buildGame(dir, { outdir, deployment });
  await build.close();
  await addStadiumBar(outdir, tier, Boolean(deployment));
  // The SDK host labels its preview ledger "Local preview"; on Pages it is a public preview.
  const runtime = `${outdir}/runtime.js`;
  if (await exists(runtime)) await writeFile(runtime, (await readFile(runtime, "utf8")).replaceAll('"Local preview"', '"Public preview · simulated"'));
  console.log(`built ${tier}${deployment ? " (LIVE)" : " (simulated)"} → ${outdir}`);
}

const TIERS = [["park", "Park · 10 RF"], ["pro", "Pro · 1,000 RF"], ["champions", "Champions · 10,000 RF"]];
const liveTiers = new Set();

/** Trusted host page only (outside the game sandbox): links between stadium builds. */
async function addStadiumBar(outdir, tier, live) {
  const depth = (tier === "park" ? 0 : 1) + (live ? 1 : 0);
  const root = depth ? "../".repeat(depth) : "./";
  const base = live ? `${root}live/` : root;
  const href = id => (id === "park" ? base : `${base}${id}/`);
  const links = TIERS.map(([id, label]) => id === tier ? `<strong aria-current="page">${label}</strong>` : `<a href="${href(id)}">${label}</a>`).join(" ");
  const other = live ? `<a href="${root}">Simulated preview</a> <a href="${root}live/clubhouse/">Clubhouse (live)</a>` : liveTiers.size ? `<a href="${root}live/">Live — real RF</a> <a href="${root}live/clubhouse/">Clubhouse (live)</a>` : "";
  const practice = `<a class="practice" href="${root}practice/">Try a free practice kick</a>`;
  const bar = `<nav class="pk-stadiums" aria-label="Stadiums"><span class="${live ? "live" : "sim"}">${live ? "LIVE — real RF" : "SIMULATED preview"}</span> ${links} ${other} ${practice}</nav>`;
  const style = "<style>.pk-stadiums{max-width:var(--rf-game-max-width,960px);margin:0 auto;padding:6px 8px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font:12px ui-monospace,monospace}.pk-stadiums a{color:#111}.pk-stadiums span{padding:2px 6px;font-weight:700}.pk-stadiums .sim{background:#ffd23f}.pk-stadiums .live{background:#ff5a6e;color:#fff}.pk-stadiums .practice{margin-left:auto;font-weight:700}</style>";
  const file = `${outdir}/index.html`;
  const html = await readFile(file, "utf8");
  await writeFile(file, html.replace("<body>", `<body>${style}${bar}`));
}

for (const tier of ["park", "pro", "champions"]) if (await exists(`${GAME}/deployments/${tier}.json`)) liveTiers.add(tier);
await buildTier("park", SITE);
await buildTier("pro", `${SITE}/pro`);
await buildTier("champions", `${SITE}/champions`);
for (const tier of ["park", "pro", "champions"]) {
  const file = `${GAME}/deployments/${tier}.json`;
  if (await exists(file)) await buildTier(tier, tier === "park" ? `${SITE}/live` : `${SITE}/live/${tier}`, file);
}
await buildPractice(`${SITE}/practice`);
console.log("built free practice → site/practice");
await buildClubhouse(`${SITE}/live/clubhouse`);
console.log("built clubhouse (live) → site/live/clubhouse");
await writeFile(`${SITE}/.nojekyll`, "");
await rm(WORK, { recursive: true, force: true });
console.log(`site ready in ${SITE}/`);
