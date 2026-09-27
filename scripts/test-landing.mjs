// The public site's landing page with NO wallet (BQ-P1-8): a phone at 390 × 844 with no injected provider.
//   - a big "Play a free practice kick" button is visible, at least 44 CSS px tall, wholly above the fold,
//     and tapping it opens ./practice/ (the practice page's canvas loads);
//   - a short muted, looping, autoplaying clip of real play is shown (and stays small: <= 600 KB);
//   - one line says how to get a Friend and links to https://rarefriends.com;
//   - the SDK's "local preview" copy is not on the published page;
//   - with a browser wallet present (window.ethereum), the no-wallet panel stays hidden;
//   - C3b: the host page opens /pro/ or /champions/ when a frame on it asks (the Ball shop's "Play at …"), and nothing else.
// Run after `npm run build:site`. Screenshot: artifacts/landing-390x844-no-wallet.png.
import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { chromium } from "playwright";
import { serveStatic } from "./lib/static-server.mjs";

const SITE = "site", OUT = "artifacts", W = 390, H = 844;
await readFile(`${SITE}/index.html`).catch(() => { console.error("site/ missing: run npm run build:site first"); process.exit(1); });
await mkdir(OUT, { recursive: true });
const server = await serveStatic(SITE);
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  // 1. No wallet.
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(server.url, { waitUntil: "load" });
  await page.getByText("No browser wallet found", { exact: false }).waitFor({ timeout: 15_000 });
  const cta = page.getByTestId("practice-cta");
  await cta.waitFor({ state: "visible", timeout: 5_000 });
  assert.match(await cta.innerText(), /Play a free practice kick/i);
  const box = await cta.boundingBox();
  assert(box.height >= 44, `the practice CTA is ${box.height}px tall (< 44)`);
  assert(box.x >= 0 && box.x + box.width <= W + 0.5 && box.y >= 0 && box.y + box.height <= H + 0.5, `the practice CTA is not wholly above the fold ${JSON.stringify(box)}`);
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=practice-cta]") !== null, [box.x + box.width / 2, box.y + box.height / 2]);
  assert(top, "the practice CTA is covered by something else");
  checks.push(`cta ${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)}`);

  const video = page.locator(".pk-landing video");
  const props = await video.evaluate(node => ({ autoplay: node.autoplay, muted: node.muted, loop: node.loop, inline: node.playsInline, src: node.currentSrc }));
  assert.deepEqual([props.autoplay, props.muted, props.loop, props.inline], [true, true, true, true], `clip attributes ${JSON.stringify(props)}`);
  const clip = await stat(`${SITE}/${new URL(props.src).pathname.slice(1)}`);
  assert(clip.size <= 600 * 1024, `the clip is ${clip.size} bytes (> 600 KB)`);
  await page.waitForFunction(() => document.querySelector(".pk-landing video")?.currentTime > 0.2, null, { timeout: 10_000 });
  checks.push(`clip ${Math.round(clip.size / 1024)} KB playing`);

  const friend = page.locator('.pk-landing a[href="https://rarefriends.com"]');
  assert.equal(await friend.count(), 1, "links to Rare Friends");
  assert.match(await page.locator(".pk-landing").innerText(), /Rare Friends Generations NFT/);
  assert.match(await page.locator(".pk-landing").innerText(), /hardwired/i);
  assert(!/local preview/i.test(await page.locator("body").innerText()), "the SDK's local-preview copy is on the public page");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflow <= 0, `horizontal scroll of ${overflow}px`);
  await page.screenshot({ path: `${OUT}/landing-390x844-no-wallet.png` });

  await cta.tap();
  await page.waitForURL(/\/practice\/$/, { timeout: 10_000 });
  await page.locator("#pp-canvas").waitFor({ timeout: 10_000 });
  checks.push(`tap → ${new URL(page.url()).pathname}`);
  assert.deepEqual(errors, [], "page errors");
  await context.close();

  // 2. A browser wallet is present: no no-wallet panel.
  const walletContext = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true });
  await walletContext.addInitScript(() => { window.ethereum = { request: () => new Promise(() => {}), on() {}, removeListener() {} }; });
  const walletPage = await walletContext.newPage();
  await walletPage.goto(server.url, { waitUntil: "load" });
  await walletPage.waitForTimeout(500);
  assert.equal(await walletPage.getByTestId("practice-cta").isVisible(), false, "the no-wallet panel shows although a wallet is present");
  checks.push("hidden with a wallet");
  await walletContext.close();

  // 3. C3b: the Ball shop's "Play at Pro" asks the host page (the game is an allow-scripts sandbox). The page opens
  //    the stadium's relative link only for a known stadium asked by a frame on the page; anything else is ignored.
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostContext.newPage();
  await host.goto(server.url, { waitUntil: "load" });
  const ask = (stadium, fromFrame) => host.evaluate(([stadium, fromFrame]) => {
    const message = { type: "penalty-kings:open-stadium", stadium };
    if (!fromFrame) { window.postMessage(message, "*"); return; }
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = `<script>parent.postMessage(${JSON.stringify(message)}, "*")<\/script>`;
    document.body.appendChild(frame);
  }, [stadium, fromFrame]);
  const start = host.url();
  await ask("pro", false); await ask("../../evil", true); await ask("park", true);
  await host.waitForTimeout(600);
  assert.equal(host.url(), start, "a message from the page itself, an unknown stadium or the current one navigates nowhere");
  await ask("pro", true);
  await host.waitForURL(/\/pro\/$/, { timeout: 10_000 });
  checks.push(`Play at Pro → ${new URL(host.url()).pathname}`);
  await ask("champions", true);
  await host.waitForURL(/\/champions\/$/, { timeout: 10_000 });
  assert.equal(new URL(host.url()).pathname, "/champions/", "relative links from /pro/ reach /champions/");
  checks.push(`then Champions → ${new URL(host.url()).pathname}`);
  await hostContext.close();
} finally {
  await browser.close(); await server.close();
}
console.log(`PASS test-landing (390x844, no wallet): ${checks.join("; ")}; screenshot ${OUT}/landing-390x844-no-wallet.png`);
