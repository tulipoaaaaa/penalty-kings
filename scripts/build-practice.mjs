// Builds the FREE PRACTICE page (site/practice/): five penalty kicks on the real engine, Stage and
// Match Director, outside the SDK game. No wallet, no provider, no network: the page's CSP sets
// connect-src 'none', so it cannot call any RPC or API even by mistake.
import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";

/** The Rare Friends site, as cited in the repo docs (docs/ADDRESSES.md, docs/HUMAN-CHECKS.md). */
export const RARE_FRIENDS_URL = "https://rarefriends.com";
/** The public game (the share card and its link point here). */
export const PUBLIC_URL = "https://tulipoaaaaa.github.io/penalty-kings/";

export async function buildPractice(outdir, { mainGame = "../" } = {}) {
  await mkdir(`${outdir}/assets`, { recursive: true });
  await build({
    entryPoints: ["site-src/practice/main.ts"], bundle: true, format: "iife", platform: "browser", target: "es2022",
    minify: !process.env.PK_NO_MINIFY, sourcemap: process.env.PK_NO_MINIFY ? "inline" : false, outfile: `${outdir}/practice.js`, logLevel: "warning", legalComments: "none",
  });
  await copyFile("site-src/practice/practice.css", `${outdir}/practice.css`);
  for (const weight of ["400", "700"]) await copyFile(`games/penalty-kings/assets/pixelify-sans-latin-${weight}-normal.woff2`, `${outdir}/assets/pixelify-sans-latin-${weight}-normal.woff2`);
  await copyFile("games/penalty-kings/assets/PixelifySans-OFL.txt", `${outdir}/assets/PixelifySans-OFL.txt`);
  await copyFile("games/penalty-kings/assets/departure-mono-pk-subset.woff2", `${outdir}/assets/departure-mono-pk-subset.woff2`);
  await copyFile("games/penalty-kings/assets/DepartureMono-OFL.txt", `${outdir}/assets/DepartureMono-OFL.txt`);
  const csp = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
  const results = Array.from({ length: 5 }, (_, i) => `<li>${i + 1}</li>`).join("");
  await writeFile(`${outdir}/index.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Penalty Kings free practice: five penalty kicks against the keepers. No wallet, no sign-in, nothing to buy.">
<title>Penalty Kings · Free practice</title>
<link rel="stylesheet" href="./practice.css">
</head>
<body>
<header class="pp-top">
  <h1>Free practice</h1><span class="pp-free">FREE · NO WALLET</span>
  <a class="pp-home" href="${mainGame}">Penalty Kings: full game</a>
  <span class="pp-count" id="pp-count" data-testid="practice-count" aria-live="polite">Kick 1 of 5</span>
  <button type="button" class="pp-btn pp-btn-quiet" id="pp-sound" aria-pressed="false">Sound off</button>
</header>
<p class="pp-rotate" id="pp-rotate"><i aria-hidden="true"></i><span>Tip: turn your phone sideways for a bigger pitch.</span><button type="button" aria-label="Hide this tip">×</button></p>
<main class="pp-main">
  <div class="pp-stage">
    <canvas id="pp-canvas" width="480" height="320" tabindex="0" aria-label="Practice pitch. Swipe up from the ball to shoot: where you release decides the shot. Keys: arrows aim, A and D curl, hold Space for power."></canvas>
    <div class="pp-banner" id="pp-banner" hidden aria-hidden="true"></div>
  </div>
  <div class="pp-side">
    <ol class="pp-results" id="pp-results" aria-label="Your five kicks">${results}</ol>
    <p class="pp-status" id="pp-status" role="status" aria-live="polite"></p>
    <p class="pp-tip" id="pp-tip" data-testid="practice-tip" aria-live="polite" hidden></p>
    <div class="pp-controls"><button type="button" class="pp-btn" id="pp-quick" data-testid="quick" disabled>Quick shot</button></div>
    <p class="pp-keys">Swipe up from the ball: direction aims, length aims higher, speed is pace, a bend curls it. Keys: arrows aim, A / D curl, hold Space to charge.</p>
  </div>
</main>
<footer class="pp-foot">
  <p>Practice only: no wallet, no sign-in, no Friend art, nothing to buy or win. The striker here is a generic stand-in.</p>
  <p><a href="${mainGame}">Penalty Kings: the full game</a></p>
</footer>
<section class="pp-end" id="pp-end" data-testid="practice-end" hidden aria-labelledby="pp-end-title">
  <div class="pp-end-card">
    <p class="pp-end-score" id="pp-end-score"></p>
    <h2 id="pp-end-title" tabindex="-1">Get your Friend to play for real</h2>
    <p>In Penalty Kings your striker is your own Rare Friend: a Rare Friends Generations NFT takes the kicks, and the stands fill with little copies of it.</p>
    <p>The full game (the 12-keeper ladder, free kicks, the World Tour, the daily challenge) runs inside the Rare Friends app through its SDK, which looks after signing in and your Friend. This page never connects a wallet.</p>
    <div class="pp-share" data-testid="practice-share">
      <button type="button" class="pp-btn" id="pp-share-btn" data-testid="practice-share-btn">Make my share card</button>
      <img id="pp-share-img" data-testid="practice-share-img" width="640" height="360" alt="" hidden>
      <p class="pp-share-note" id="pp-share-note" hidden>Long-press or right-click the image to save it, or send the link: tap it to select it, then copy.</p>
      <div class="pp-end-links" id="pp-share-actions" hidden>
        <button type="button" class="pp-btn" id="pp-share-native" data-testid="practice-share-native" hidden>Share</button>
        <a class="pp-btn pp-btn-link" id="pp-share-save" data-testid="practice-share-save" download="penalty-kings-practice.png" href="#" hidden>Save image</a>
      </div>
      <label class="pp-share-link">Link<input readonly id="pp-share-link" data-testid="practice-share-link" value="${PUBLIC_URL}"></label>
    </div>
    <div class="pp-end-links">
      <a class="pp-cta" href="${mainGame}" data-testid="cta-game">Open the full game</a>
      <a class="pp-cta pp-cta-alt" href="${RARE_FRIENDS_URL}" target="_blank" rel="noopener noreferrer" data-testid="cta-rarefriends">Get a Friend to play for the pot ↗</a>
      <button type="button" class="pp-btn pp-btn-quiet" id="pp-again">Practice again</button>
    </div>
    <p class="pp-how" data-testid="cta-how">How: a Friend is a hardwired Rare Friends Generations NFT on Robinhood; hold one and it takes the kicks.</p>
  </div>
</section>
<script src="./practice.js"></script>
</body>
</html>
`);
}

if (import.meta.url === `file://${process.argv[1]}`) { const out = process.argv[2] ?? "site/practice"; await buildPractice(out); console.log(`built free practice → ${out}`); }
