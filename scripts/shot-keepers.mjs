// Screenshots the Showroom's keeper sheet (12 keepers × every frame) for review.
// Usage: node scripts/shot-keepers.mjs [--out docs/screenshots/keepers.png] [--masks]
// Starts the DEV server (dev/server.mjs) on a spare port, opens /showroom/ in Playwright's
// preinstalled Chromium, switches to the Keepers tab and saves the sheet canvas.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/screenshots/keepers.png";
const port = 5300 + Math.floor(Math.random() * 400);
const root = new URL("..", import.meta.url).pathname;
const server = spawn(process.execPath, ["dev/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "inherit"] });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dev server did not start")), 120_000);
    server.stdout.on("data", chunk => { if (String(chunk).includes("SHOWROOM")) { clearTimeout(timer); resolve(); } });
    server.on("exit", code => reject(new Error(`dev server exited (${code})`)));
  });
  // The showroom bundle builds in the background: wait for a fresh app.js before loading the page.
  const bundle = `${root}.dev/showroom/app.js`, started = Date.now() - 1000;
  for (let i = 0; i < 600 && !(existsSync(bundle) && statSync(bundle).mtimeMs > started); i++) await new Promise(resolve => setTimeout(resolve, 100));
  await new Promise(resolve => setTimeout(resolve, 500));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://localhost:${port}/showroom/`);
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId("tab-keepers").click();
  if (args.includes("--masks")) await page.locator("#keepers-masks").check();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__drawKeeperSheet());
  await page.getByTestId("keeper-sheet").screenshot({ path: out });
  if (args.includes("--live")) await page.getByTestId("keeper-live").screenshot({ path: out.replace(/\.png$/, "-live.png") });
  await browser.close();
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
  console.log(`saved ${out}`);
} finally {
  server.kill();
}
