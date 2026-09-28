// TEST APP checks (owner's test lane; not part of the judged CI job):
//  1. packages/wallet unit + contract tests, and the test app typecheck;
//  2. npm run build:test-app (skip with --no-build);
//  3. Playwright, served under a sub-path (/penalty-kings-app/) to prove relative URLs:
//     Chromium 390×844 and 844×390 (recorded → docs/media/test-app-onboarding.webm, ≤ 3 MB) and WebKit iPhone 13 /
//     iPhone 15 landscape: the full onboarding → first kick (< 60 s) → a pack purchase, the "TEST BUILD · SIMULATED"
//     badge on every simulated screen, no request leaves the app (fully offline-capable), and in the portrait run
//     every error state with Retry, logout / re-login restore and reset. The landscape run then checks the service
//     worker: "New version — tap to reload" and a full offline reload.
// Usage: node scripts/test-test-app.mjs [--no-build] [--only chromium-portrait,chromium-landscape,iphone13,iphone15] [--no-video]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, devices } from "playwright";
import { serveStatic } from "./lib/static-server.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: ROOT, stdio: "inherit" });

run("node", ["--experimental-strip-types", "--no-warnings", "--test", ...["dev-simulated", "contract"].map(name => `packages/wallet/test/${name}.test.ts`)]);
run("npx", ["tsc", "-p", "tsconfig.test-app.json"]);
if (!args.includes("--no-build")) run("node", ["scripts/build-test-app.mjs"]);

// Serve a private copy (the update test edits sw.js) under a sub-path, like a GitHub Pages project site.
const BASE = "/penalty-kings-app/";
const copy = await mkdtemp(join(tmpdir(), "pk-test-app-"));
await cp(join(ROOT, "dist-test-app"), copy, { recursive: true });
const server = await serveStatic(copy, { base: BASE });
const BADGE = "TEST BUILD · SIMULATED";
const VIDEO = join(ROOT, "docs/media/test-app-onboarding.webm");

const RUNS = [
  { name: "chromium-portrait", browser: chromium, options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, errors: true },
  { name: "chromium-landscape", browser: chromium, options: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, record: !args.includes("--no-video"), pwa: true },
  { name: "iphone13", browser: webkit, options: devices["iPhone 13 landscape"] },
  { name: "iphone15", browser: webkit, options: devices["iPhone 15 landscape"], pwa: "update" },
].filter(item => !only || only.includes(item.name));

const results = [];
try {
  for (const spec of RUNS) results.push(await flow(spec));
} finally {
  await server.close(); await rm(copy, { recursive: true, force: true });
}
for (const result of results) console.log(`PASS ${result.name}: first kick ${(result.firstKickMs / 1000).toFixed(1)} s after load · pack bought · ${result.screens} simulated screens badged${result.extra ? ` · ${result.extra}` : ""}`);

async function flow({ name, browser: type, options, record, errors: testErrors, pwa }) {
  const browser = await type.launch();
  const videoDir = record ? await mkdtemp(join(tmpdir(), "pk-video-")) : null;
  const context = await browser.newContext({ ...options, reducedMotion: "reduce", serviceWorkers: "allow", ...(videoDir ? { recordVideo: { dir: videoDir, size: options.viewport } } : {}) });
  const external = [], pageErrors = [];
  // Nothing may leave the app: the simulated build needs no network at all (RPC, fonts, analytics, wallet SDKs).
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(server.url).origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    external.push(url.href); return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => void dialog.accept());
  const game = page.frameLocator("iframe[sandbox]");
  const tid = id => page.getByTestId(id);
  let screens = 0;
  const badged = async screen => {
    await tid(screen).waitFor();
    const badge = page.getByTestId("test-badge").first();
    assert.equal(await badge.innerText(), BADGE, `${name}: badge text on ${screen}`);
    assert.ok(await badge.isVisible(), `${name}: the badge is visible on ${screen}`);
    const box = await badge.boundingBox(), view = page.viewportSize();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height, `${name}: the badge is on screen (${screen})`);
    screens++;
  };
  const tap = id => tid(id).click();
  const devFailure = async (kind, from = "app-version") => {
    for (let i = 0; i < 5; i++) await tid(from).first().click();
    await badged("dev-menu");
    await tap(`dev-failure-${kind}`); await tap("dev-close");
  };
  const expectError = async (code, retry = true) => {
    const box = tid("error-box");
    await box.waitFor();
    assert.equal(await box.getAttribute("data-code"), code, `${name}: error state ${code}`);
    assert.ok(await page.getByTestId("test-badge").first().isVisible());
    if (retry) await tid("retry").click();
  };

  const started = Date.now();
  await page.goto(server.url);
  await badged("screen-welcome");
  assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "noindex,nofollow");
  if (testErrors) {
    await devFailure("cancelled"); await tap("login-google"); await expectError("cancelled", false); await tap("back");
    await devFailure("offline");
  }
  await tap("login-email");
  await badged("screen-email");
  await tap("send-code");
  if (testErrors) await expectError("offline");
  await badged("screen-code");
  if (testErrors) {
    await tid("code-input").fill("12"); assert.ok(await tid("verify-code").isDisabled(), "a short code cannot be submitted");
    await tap("code-cancel"); await expectError("cancelled", false); await tap("back"); await tap("send-code"); await badged("screen-code");
  }
  await tid("code-input").fill("123456");
  await tap("verify-code");
  await badged("screen-creating").catch(() => {}); // shown ~1 s while the (simulated) wallet is created
  await badged("screen-address");
  const address = await tid("wallet-address").innerText();
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  await tap("copy-address");
  await tap("next-get-rf");
  await badged("screen-rf");
  assert.match(await tid("price-label").innerText(), /1 RF ≈ \$[\d.]+ · price: on-chain snapshot · block 73,949,883/);
  if (testErrors) await devFailure("declined");
  await tap("rf-20");
  await badged("pay-sheet");
  const sheet = await tid("pay-sheet").innerText();
  assert.match(sheet, /Simulated payment \(test\)/);
  assert.match(sheet, /In the real app, .+ will handle this step\./);
  assert.doesNotMatch(sheet, /Apple Pay|Google Pay|G Pay/i, "no payment-platform look-alike on the simulated sheet");
  assert.equal(await page.locator(".pkt-sheet img, .pkt-sheet svg").count(), 0, "no logos on the simulated sheet");
  await tap("pay-confirm");
  if (testErrors) await expectError("declined");
  await tid("rf-added").waitFor();
  await tap("next-friend");
  await badged("screen-friend");
  assert.ok(await tid("friend-art").isVisible(), "the fixture Friend's art is shown");
  if (testErrors) await devFailure("offline");
  await tap("friend-loan");
  if (testErrors) await expectError("offline");
  await badged("screen-hardwire");
  if (testErrors) await devFailure("rejected");
  await tap("hardwire-start");
  if (testErrors) await expectError("rejected");
  await tid("tx-hash").waitFor();
  assert.match(await tid("tx-hash").innerText(), /^SIMULATED tx 0x/);
  await tap("enter-game");
  await badged("screen-game");
  // The game: the SDK frame, the real ownership gate (simulated identity), the child in its allow-scripts sandbox.
  assert.equal(await page.locator("iframe[sandbox]").getAttribute("sandbox"), "allow-scripts");
  await game.locator("#root > *").first().waitFor({ timeout: 30_000 });
  await game.getByTestId("rotate").waitFor({ state: "attached", timeout: 15_000 });
  const rotate = game.getByTestId("portrait-anyway");
  if (await rotate.isVisible()) { assert.ok(options.viewport.height > options.viewport.width, "the rotate overlay only in portrait"); await rotate.click(); }
  if (await game.getByTestId("skip-intro").isVisible().catch(() => false)) await game.getByTestId("skip-intro").click();
  await game.getByTestId("play").click();
  const kick = async (dx = 0.35) => {
    await game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 20000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
    const canvas = game.locator("canvas.pk-canvas"), box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
    const x = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 9; i++) { await page.mouse.move(x + i * dx * 12 * scale, y - i * 12 * scale); await page.waitForTimeout(18); }
    await page.mouse.up();
    await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
    const banner = await game.locator(".pk-banner strong").textContent();
    await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
    return banner;
  };
  const first = await kick();
  const firstKickMs = Date.now() - started;
  assert.ok(firstKickMs < 60_000, `${name}: first kick at ${firstKickMs} ms (target < 60 s)`);
  assert.match(first, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!/);
  await kick(-0.4); await kick(0.4);
  await game.getByTestId("results").waitFor({ timeout: 15_000 });
  await game.getByRole("button", { name: "Modes", exact: true }).click();
  await game.getByTestId("ball-shop").click();
  await game.getByTestId("pack-2").click();
  const before = await tid("balance").innerText();
  await game.getByTestId("buy-pack").click();
  await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
  await game.getByText("2 balls bought.").waitFor({ timeout: 15_000 });
  await page.waitForFunction(text => document.querySelector('[data-testid="balance"]')?.textContent !== text, before, { timeout: 5000 });
  const after = await tid("balance").innerText();
  const rf = text => Number(text.replace(/[^\d.]/g, ""));
  assert.equal(Math.round((rf(before) - rf(after)) * 100) / 100, 20, `${name}: the pack's 20 RF left the simulated wallet (${before} → ${after})`);
  assert.ok(await page.getByTestId("test-badge").first().isVisible(), "badge visible in the game");
  let extra = "";

  if (testErrors) extra = await errorStates();
  if (pwa) extra = await pwaChecks(pwa === true);

  assert.deepEqual(external, [], `${name}: requests left the app`);
  assert.deepEqual(pageErrors, [], `${name}: page errors`);
  const video = page.video();
  await context.close(); await browser.close();
  if (video) {
    await mkdir(join(ROOT, "docs/media"), { recursive: true });
    await rename(await video.path(), VIDEO).catch(async () => { await cp(await video.path(), VIDEO); });
    const size = (await stat(VIDEO)).size;
    assert.ok(size <= 3 * 1024 * 1024, `video ${size} bytes > 3 MB`);
    extra += ` · video ${(size / 1024 / 1024).toFixed(2)} MB → docs/media/test-app-onboarding.webm`;
    await rm(videoDir, { recursive: true, force: true });
  }
  return { name, firstKickMs, screens, extra };

  // ── Logout + re-login restores the account; reset wipes it ──
  async function errorStates() {
    const balanceText = await tid("balance").innerText();
    await tap("menu-open"); await tid("menu").waitFor();
    assert.match(await tid("settings-version").innerText(), /^\d+\.\d+\.\d+\+\S+$/, "Settings shows the app version");
    assert.equal(await tid("menu-address").innerText(), address);
    await tap("logout");
    await badged("screen-welcome");
    await tap("login-email"); await tap("send-code"); await tid("code-input").fill("654321"); await tap("verify-code");
    await badged("screen-game");
    assert.equal(await tid("balance").innerText(), balanceText, "re-login restores the simulated RF");
    await tap("menu-open"); await tap("reset-account");
    await badged("screen-welcome");
    await tap("login-email"); await tap("send-code"); await tid("code-input").fill("111111"); await tap("verify-code");
    await badged("screen-address");
    assert.equal(await tid("wallet-address").innerText(), address, "same test account → same deterministic address");
    await tap("next-get-rf"); await badged("screen-rf");
    assert.equal(await tid("rf-added").count(), 0);
    return "errors cancelled/offline/declined/rejected + Retry, logout/re-login restore, reset";
  }

  async function pwaChecks(offline) {
    // Service worker controls the page after a reload; every file is precached.
    await page.reload(); await tid("screen-game").waitFor();
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
    // New version: a changed sw.js is found → "New version — tap to reload" → the page reloads on the new version.
    await writeFile(join(copy, "sw.js"), `${await readFile(join(copy, "sw.js"), "utf8")}\n// next build\n`);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(registration => registration.update()));
    await tid("update-toast").waitFor({ timeout: 20_000 });
    assert.equal(await tid("update-toast").innerText(), "New version — tap to reload");
    await Promise.all([page.waitForEvent("load"), tap("update-toast")]);
    await tid("screen-game").waitFor();
    // Playwright's WebKit cannot reload a service-worker page with network emulation off ("internal error"), so the
    // offline reload is checked in Chromium; WebKit checks the update toast.
    if (!offline) return "service worker: update toast → reload";
    // Fully offline: the app and the game (sandboxed child included) reload from the cache.
    await context.setOffline(true);
    await page.reload(); await badged("screen-game");
    await game.locator("#root > *").first().waitFor({ timeout: 30_000 });
    await game.getByTestId("rotate").waitFor({ state: "attached", timeout: 20_000 });
    await context.setOffline(false);
    return "service worker: update toast + offline reload of shell and game";
  }
}
