// Builds the static site for GitHub Pages.
//   site/            Park (simulated preview; the submission URL)
//   site/pro/        Pro (simulated)
//   site/champions/  Champions (simulated, shown as locked in-game)
//   site/live/…      LIVE builds, only when games/penalty-kings/deployments/<tier>.json exists
// Each tier is a copy of the game directory with that tier's game.json (one SDK ChanceGame per tier).
import { cp, rm, mkdir, writeFile, access, copyFile } from "node:fs/promises";
import { buildGame, readGameDeployment } from "@rarefriends/friendsdk/build";

const GAME = "games/penalty-kings", WORK = ".build", SITE = "site";
const exists = path => access(path).then(() => true, () => false);
await rm(WORK, { recursive: true, force: true }); await rm(SITE, { recursive: true, force: true });
await mkdir(SITE, { recursive: true });

async function buildTier(tier, outdir, deploymentFile) {
  const dir = `${WORK}/${tier}${deploymentFile ? "-live" : ""}`;
  await cp(GAME, dir, { recursive: true, filter: source => !source.includes(".friendsdk") });
  await copyFile(`${GAME}/tiers/${tier}.json`, `${dir}/game.json`);
  const deployment = deploymentFile ? await readGameDeployment(deploymentFile) : undefined;
  const build = await buildGame(dir, { outdir, deployment });
  await build.close();
  console.log(`built ${tier}${deployment ? " (LIVE)" : " (simulated)"} → ${outdir}`);
}

await buildTier("park", SITE);
await buildTier("pro", `${SITE}/pro`);
await buildTier("champions", `${SITE}/champions`);
for (const tier of ["park", "pro", "champions"]) {
  const file = `${GAME}/deployments/${tier}.json`;
  if (await exists(file)) await buildTier(tier, tier === "park" ? `${SITE}/live` : `${SITE}/live/${tier}`, file);
}
await writeFile(`${SITE}/.nojekyll`, "");
await rm(WORK, { recursive: true, force: true });
console.log(`site ready in ${SITE}/`);
