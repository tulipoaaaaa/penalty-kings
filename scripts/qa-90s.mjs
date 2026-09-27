// 90-second first-session QA in the real sandboxed runtime: watch the showreel, take the
// tutorial, play Penalties, Free Kicks and Target Practice until 90 s are up, then count what the
// viewer actually saw (Stage stats) and check minimums. Usage: node scripts/qa-90s.mjs [--width 960]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const MINIMUMS = { uniqueLines: 25, contexts: 12, keepers: 4, celebrations: 2, waves: 1, taunts: 3, shots: 14, walkouts: 1 };
let report;

await testGame("./games/penalty-kings", {
  width, timeout: 60_000,
  check: async ({ page, game }) => {
    const started = Date.now(), elapsed = () => (Date.now() - started) / 1000;
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const swipe = async (dx, fromY = 250, step = 12) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      const x = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y = box.y + (box.height - 320 * scale) / 2 + fromY * scale;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 9; i++) { await page.mouse.move(x + i * dx * 12 * scale, y - i * step * scale); await page.waitForTimeout(16); }
      await page.mouse.up();
    };
    const kick = async (dx, fromY, step) => {
      await waitShootable(); await swipe(dx, fromY, step);
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
    };
    const aims = [0.45, -0.45, 0.35, -0.3, 0.5, -0.5, 0.2];

    await page.waitForTimeout(12_000); // the showreel plays behind the title
    await page.locator(".rf-game-frame").screenshot({ path: `artifacts/qa-showreel-${width}.png` });
    await button("Kick off").click(); // first session: straight into the coached tutorial
    for (let i = 0; i < 3; i++) await kick(aims[i]);
    await game.getByTestId("results").waitFor(); await button("Modes").click();
    await game.getByTestId("mode-penalties").click();
    for (let i = 0; i < 5; i++) await kick(aims[(i + 3) % aims.length]);
    await game.getByTestId("results").waitFor(); await button("Modes").click();
    await game.getByTestId("mode-freekicks").click();
    for (let i = 0; i < 3; i++) await kick([0.2, -0.25, 0.3][i], 262, 14);
    await game.getByTestId("results").waitFor(); await button("Modes").click();
    await game.getByTestId("mode-target").click();
    for (let i = 0; elapsed() < 88; i++) await kick(aims[i % aims.length] * 0.8);
    const stats = await game.locator("body").evaluate(() => window.__pkStats());
    report = {
      seconds: Math.round(elapsed()), shots: stats.shots, goals: stats.goals, saves: stats.saves, woodwork: stats.woodwork,
      uniqueLines: stats.lines.length, contexts: stats.contexts.length, keepers: stats.keepers.length, celebrations: stats.celebrations.length,
      waves: stats.waves, taunts: stats.taunts, walkouts: stats.walkouts, sfx: stats.sfx, reveals: stats.reveals,
      keeperList: stats.keepers.join(", "), celebrationList: stats.celebrations.join(", "),
    };
  },
});
console.log(`90-second QA at ${width}px:`);
for (const [key, value] of Object.entries(report)) console.log(`  ${key.padEnd(15)} ${value}${MINIMUMS[key] !== undefined ? `   (min ${MINIMUMS[key]})` : ""}`);
for (const [key, min] of Object.entries(MINIMUMS)) assert.ok(report[key] >= min, `${key} ${report[key]} < ${min}`);
console.log("PASS 90-second QA");
