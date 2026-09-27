// Free practice page (site/practice/): served from the built site/, played in Chromium at the two
// phone sizes (844 × 390 landscape, 360 × 640 portrait) and a desktop width.
//   - 5 swipes → 5 results and the final "Get your Friend to play for real" card with its links;
//   - EVERY network request is recorded: all must be same-origin GETs for the page's own files
//     (no RPC host, no provider, no wallet, nothing cross-origin, no POST);
//   - no wallet/provider code in the bundle; the site root links to the practice page;
//   - text >= 11 CSS px, no horizontal scroll, no console errors; works with storage blocked.
// Screenshots: artifacts/practice-*.png (set PK_DOC_SHOTS=1 to refresh docs/screenshots/). `npm run test:practice` builds the site first.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serveStatic } from "./lib/static-server.mjs";

const SITE = "site", SHOTS = process.env.PK_DOC_SHOTS ? "docs/screenshots" : "artifacts";
const RPC_HOSTS = ["rpc.mainnet.chain.robinhood.com", "robinhood", "infura", "alchemy", "quicknode", "walletconnect", "privy", "moonpay", "blockscout", "rarefriends.com"];
const BUNDLE_BANNED = [/window\.ethereum/, /eth_requestAccounts/, /eth_chainId/, /wallet_switchEthereumChain/, /privy/i, /moonpay/i, /walletconnect/i, /metamask:\/\//i, /isPenaltyKingsDevWallet/, /mock-wallet/];

await readFile(`${SITE}/practice/index.html`).catch(() => { console.error("site/practice missing: use npm run test:practice (it builds the site first)"); process.exit(1); });

// Static checks on the built files.
const bundle = await readFile(`${SITE}/practice/practice.js`, "utf8"), html = await readFile(`${SITE}/practice/index.html`, "utf8");
for (const pattern of BUNDLE_BANNED) { assert(!pattern.test(bundle), `practice.js contains ${pattern}`); assert(!pattern.test(html), `practice/index.html contains ${pattern}`); }
assert.match(html, /connect-src 'none'/, "the practice CSP must forbid every connection");
assert.match(html, /href="https:\/\/rarefriends\.com"/, "links to Rare Friends");
const root = await readFile(`${SITE}/index.html`, "utf8");
assert.match(root, /<a class="practice" href="\.\/practice\/">Try a free practice kick<\/a>/, "the site root links to the free practice page");
for (const file of await readdir(`${SITE}/practice`)) assert(!/^(sw|service-worker)\.js$/.test(file), "no service worker in practice/");

await mkdir(SHOTS, { recursive: true });
const server = await serveStatic(SITE);
const origin = new URL(server.url).origin;
const browser = await chromium.launch({ headless: true });
const report = [];

async function run({ width, height, name, mobile, blockStorage = false }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: "no-preference" });
  if (blockStorage) await context.addInitScript(() => { for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, { get() { throw new DOMException("blocked", "SecurityError"); } }); });
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on("request", request => requests.push({ url: request.url(), method: request.method() }));
  page.on("websocket", socket => requests.push({ url: socket.url(), method: "WEBSOCKET" }));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`${server.url}practice/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
  if (!blockStorage) await page.screenshot({ path: `${SHOTS}/practice-${name}.png` });

  // Text size: every visible text node's element is >= 11 CSS px.
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || !el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const own = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 11) out.push(`${el.tagName}.${el.className}: ${getComputedStyle(el).fontSize}`);
    }
    return out;
  });
  assert.deepEqual(small, [], `${name}: text under 11px`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `${name}: horizontal scroll of ${overflow}px`);
  // The whole pitch is on screen (landscape: no scrolling to reach the ball).
  const box = await page.locator("#pp-canvas").boundingBox();
  assert(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= Math.max(height, box.y + box.height) , `${name}: canvas off screen`);
  if (width > height) assert(box.y + box.height <= height + 0.5, `${name}: in landscape the pitch must fit the screen (bottom ${box.y + box.height} > ${height})`);
  assert(Math.abs(box.width / box.height - 1.5) < 0.02, `${name}: canvas aspect ${box.width / box.height}`);

  // Five swipes from the ball, up and to alternating sides (like scripts/test-game.mjs).
  const toScreen = (x, y) => { const scale = Math.min(box.width / 480, box.height / 320); return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale }; };
  for (let kick = 0; kick < 5; kick++) {
    await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
    const dx = [0.5, -0.45, 0.2, -0.6, 0.35][kick];
    const start = toScreen(240, 252);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i <= 9; i++) { await page.mouse.move(start.x + i * dx * 12 * start.scale, start.y - i * 11 * start.scale); await page.waitForTimeout(18); }
    await page.mouse.up();
    await page.waitForFunction(n => window.__pkPractice?.().kicks.length === n, kick + 1, { timeout: 20_000 });
    if (kick === 1 && !blockStorage) { await page.waitForTimeout(150); await page.screenshot({ path: `${SHOTS}/practice-${name}-kick.png` }); }
  }
  await page.waitForFunction(() => window.__pkPractice?.().phase === "done", null, { timeout: 20_000 });
  const results = page.locator('[data-testid="practice-result"]');
  assert.equal(await results.count(), 5, `${name}: 5 results`);
  const shown = await results.evaluateAll(items => items.map(item => item.dataset.result));
  assert(shown.every(result => ["goal", "save", "post", "over", "wide"].includes(result)), `${name}: results ${shown}`);
  const end = page.getByTestId("practice-end");
  await end.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("heading", { name: "Get your Friend to play for real" }).waitFor();
  assert.equal(await page.getByTestId("cta-game").getAttribute("href"), "../");
  assert.equal(await page.getByTestId("cta-rarefriends").getAttribute("href"), "https://rarefriends.com");
  const endText = await end.innerText();
  assert.match(endText, /Rare Friends Generations NFT/);
  assert.match(endText, /Rare Friends app/);
  assert(!/\bRF\b|\$GBOOT|GBOOT|prize|jackpot|\bpot\b/i.test(await page.locator("body").innerText()), `${name}: economy words on the practice page`);
  if (!blockStorage) await page.screenshot({ path: `${SHOTS}/practice-${name}-end.png` });
  const cardSmall = await page.evaluate(() => [...document.querySelectorAll(".pp-end *")].filter(el => el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11).map(el => el.tagName));
  assert.deepEqual(cardSmall, [], `${name}: end card text under 11px`);

  // Network: only this origin, only GETs, only the page's own files.
  const foreign = requests.filter(request => !request.url.startsWith(origin + "/") || request.method !== "GET");
  const rpc = requests.filter(request => RPC_HOSTS.some(host => request.url.includes(host)));
  assert.deepEqual(rpc, [], `${name}: requests to an RPC/provider host`);
  assert.deepEqual(foreign, [], `${name}: cross-origin or non-GET requests`);
  const paths = [...new Set(requests.map(request => new URL(request.url).pathname))];
  assert(paths.every(path => path.startsWith("/practice/")), `${name}: requests outside /practice/: ${paths}`);
  assert.deepEqual(errors, [], `${name}: console errors`);
  const stats = await page.evaluate(() => window.__pkPractice());
  report.push({ name, width, height, results: shown.join(" "), goals: stats.goals, keepers: stats.keepers.join(","), lines: stats.lines, requests: paths.join(" ") });
  await context.close();
}

try {
  await run({ width: 844, height: 390, name: "844x390", mobile: true });
  await run({ width: 360, height: 640, name: "360x640", mobile: true });
  await run({ width: 1280, height: 800, name: "1280x800", mobile: false });
  await run({ width: 844, height: 390, name: "no-storage", mobile: true, blockStorage: true });
} finally {
  await browser.close(); await server.close();
}
for (const row of report) console.log(`${row.name}: ${row.results} (goals ${row.goals}; keepers ${row.keepers}; ${row.lines} commentary lines) · requests: ${row.requests}`);
console.log("PASS test-practice: 5 kicks → 5 results → CTA at 844×390, 360×640 and 1280×800 (and with storage blocked); no wallet/provider/RPC requests");
