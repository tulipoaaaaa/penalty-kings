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
  // The SDK host labels its preview ledger "Local preview"; on Pages it is a public preview. Display strings only
  // (exact literal swaps; the ownership gate and every other runtime behaviour are untouched).
  const runtime = `${outdir}/runtime.js`;
  if (await exists(runtime)) {
    let js = (await readFile(runtime, "utf8")).replaceAll('"Local preview"', '"Public preview · simulated"');
    for (const [from, to] of RUNTIME_COPY) {
      if (!js.includes(from)) throw new Error(`build-site: SDK runtime copy changed, update RUNTIME_COPY: ${from}`);
      js = js.replaceAll(from, to);
    }
    await writeFile(runtime, js);
  }
  console.log(`built ${tier}${deployment ? " (LIVE)" : " (simulated)"} → ${outdir}`);
}

// BQ-P1-8: the SDK's "local preview" copy on the published pages, and a way forward from "No browser wallet found".
const RUNTIME_COPY = [
  ['"Choose your Friend for this local preview. Balances, items and outcomes are simulated."', '"Choose your Friend for this public preview. Balances, items and outcomes are simulated."'],
  ['"No browser wallet found. Enable your wallet extension or open this game in your wallet\\u2019s browser."', '"No browser wallet found. Enable your wallet extension or open this game in your wallet\\u2019s browser \\u2014 or play a free practice kick first (no wallet needed)."'],
];
const LANDING_CLIP = "site-src/landing/play.webm"; // 6 s of real play from docs/media/judge-path.webm (384 × 240, VP8, muted)

const TIERS = [["park", "Park · 10 RF"], ["pro", "Pro · 1,000 RF"], ["champions", "Champions · 10,000 RF"]];
/** Must equal STADIUM_MESSAGE in games/penalty-kings/economy.ts (tests/game/weekly.test.ts checks it). */
const STADIUM_MESSAGE = "penalty-kings:open-stadium";
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
  // BQ-P1-10: the links are 44px tap targets (they were 14px-tall text links).
  const style = "<style>.pk-stadiums{max-width:var(--rf-game-max-width,960px);margin:0 auto;padding:0 8px;display:flex;flex-wrap:wrap;gap:0 12px;align-items:center;font:12px ui-monospace,monospace}.pk-stadiums a{color:#111;display:inline-flex;align-items:center;min-height:44px}.pk-stadiums span{padding:2px 6px;font-weight:700}.pk-stadiums .sim{background:#ffd23f}.pk-stadiums .live{background:#ff5a6e;color:#fff}.pk-stadiums .practice{margin-left:auto;font-weight:700}</style>";
  // BQ-P1-8: without a browser wallet the SDK can only say "No browser wallet found"; the host page offers the
  // free practice kick instead (shown by default; hidden as soon as a wallet is detected, like the runtime does it).
  // The runtime focuses its "Choose your Friend" dialog on load, which would scroll this panel away: undo
  // that until the visitor first touches, clicks, scrolls or types.
  const landing = `<section class="pk-landing" aria-label="Play without a wallet"><div class="pk-landing-text"><p class="pk-landing-lead">No wallet on this device? Kick a ball right now: free, no sign-up.</p><a class="pk-landing-cta" data-testid="practice-cta" href="${root}practice/">Play a free practice kick &#9654;</a><p class="pk-landing-friend">To play for real you need a Friend: a hardwired <a href="https://rarefriends.com">Rare Friends Generations NFT</a> on Robinhood.</p></div><video src="${root}landing/play.webm" width="384" height="240" autoplay muted loop playsinline preload="auto" aria-label="Six seconds of real play: three penalty kicks"></video></section>`
    + `<script>(()=>{const panel=document.currentScript.previousElementSibling,hide=()=>{panel.hidden=true};if(window.ethereum)hide();addEventListener("eip6963:announceProvider",hide);const top=()=>{if(!panel.hidden)requestAnimationFrame(()=>scrollTo(0,0))},stop=()=>document.removeEventListener("focusin",top);document.addEventListener("focusin",top);for(const type of ["pointerdown","keydown","wheel","touchstart"])addEventListener(type,stop,{once:true,capture:true})})()</script>`;
  const landingStyle = "<style>.pk-landing{max-width:var(--rf-game-max-width,960px);margin:0 auto 8px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;font:14px/1.4 ui-monospace,monospace;background:#fff;border:2px solid #111}.pk-landing[hidden]{display:none}.pk-landing-text{flex:1 1 280px;display:flex;flex-direction:column;gap:10px}.pk-landing p{margin:0}.pk-landing-lead{font-weight:700}.pk-landing-cta{display:flex;align-items:center;justify-content:center;min-height:56px;padding:8px 20px;background:#ffd23f;color:#111;border:3px solid #111;box-shadow:4px 4px 0 #111;font:700 18px ui-monospace,monospace;text-decoration:none}.pk-landing-cta:active{transform:translate(2px,2px);box-shadow:2px 2px 0 #111}.pk-landing-cta:focus-visible{outline:3px solid #2a6df4;outline-offset:3px}.pk-landing-friend a{color:#111;font-weight:700}.pk-landing video{display:block;flex:0 1 384px;width:100%;max-width:384px;height:auto;aspect-ratio:8/5;background:#2f7d32;border:2px solid #111}</style>";
  // C4 CHALLENGE A FRIEND: the game runs in an allow-scripts sandbox (opaque origin, no-referrer), so it cannot read this
  // page's ?challenge= link. This trusted host page shows the code to paste into the game's Challenge box (text only,
  // set with textContent; anything that is not a well-formed code is ignored).
  const challenge = `<section class="pk-challenge" aria-label="Challenge from a friend" hidden><p><b>A friend challenged you!</b> Choose your Friend, then paste this code under <b>Modes → Got a challenge code?</b></p><input readonly aria-label="Challenge code" data-testid="host-challenge-code"></section>`
    + `<script>(()=>{const box=document.currentScript.previousElementSibling,code=(new URLSearchParams(location.search).get("challenge")||"").trim().toLowerCase();if(!/^pkc1(\\.[0-9a-z]{1,14}){5}\\.[0-9a-f]{8}$/.test(code))return;const input=box.querySelector("input");input.value=code;input.addEventListener("focus",()=>input.select());box.hidden=false})()</script>`;
  const challengeStyle = "<style>.pk-challenge{max-width:var(--rf-game-max-width,960px);margin:0 auto 8px;padding:8px 16px;display:grid;gap:6px;font:14px/1.4 ui-monospace,monospace;background:#ccff00;border:2px solid #111}.pk-challenge[hidden]{display:none}.pk-challenge p{margin:0}.pk-challenge input{min-height:44px;padding:4px 8px;font:14px ui-monospace,monospace;border:2px solid #111;background:#fff;color:#111}</style>";
  // C3b: the Ball shop's "Play at Pro / Champions" buttons. The game runs in an allow-scripts sandbox (it cannot
  // navigate this page), so it posts STADIUM_MESSAGE (games/penalty-kings/economy.ts); this trusted page opens that
  // stadium's page, by the same relative links as the bar, only for a message from a frame on this page.
  const pages = Object.fromEntries(TIERS.filter(([id]) => id !== tier && (!live || liveTiers.has(id))).map(([id]) => [id, href(id)]));
  const opener = `<script>(()=>{const pages=${JSON.stringify(pages)};addEventListener("message",event=>{const data=event.data;if(!data||data.type!==${JSON.stringify(STADIUM_MESSAGE)}||typeof data.stadium!=="string"||!Object.hasOwn(pages,data.stadium))return;if(![...document.querySelectorAll("iframe")].some(frame=>frame.contentWindow===event.source))return;location.assign(pages[data.stadium])})})()</script>`;
  const file = `${outdir}/index.html`;
  const html = await readFile(file, "utf8");
  await writeFile(file, html.replace("<body>", `<body>${style}${landingStyle}${challengeStyle}${bar}${challenge}${landing}${opener}`));
}

for (const tier of ["park", "pro", "champions"]) if (await exists(`${GAME}/deployments/${tier}.json`)) liveTiers.add(tier);
await buildTier("park", SITE);
await buildTier("pro", `${SITE}/pro`);
await buildTier("champions", `${SITE}/champions`);
for (const tier of ["park", "pro", "champions"]) {
  const file = `${GAME}/deployments/${tier}.json`;
  if (await exists(file)) await buildTier(tier, tier === "park" ? `${SITE}/live` : `${SITE}/live/${tier}`, file);
}
await mkdir(`${SITE}/landing`, { recursive: true });
await copyFile(LANDING_CLIP, `${SITE}/landing/play.webm`);
await buildPractice(`${SITE}/practice`);
console.log("built free practice → site/practice");
// The $GBOOT Clubhouse is part of the undeployed upgrade package (docs/GBOOT-UPGRADE.md): it is only published
// once its contracts exist (deployments/live.json). The pilot ships without $GBOOT, so the public site has no Clubhouse.
if (await exists(`${GAME}/deployments/live.json`)) {
  await buildClubhouse(`${SITE}/live/clubhouse`);
  console.log("built clubhouse (live) → site/live/clubhouse");
}
await writeFile(`${SITE}/.nojekyll`, "");
await rm(WORK, { recursive: true, force: true });
console.log(`site ready in ${SITE}/`);
