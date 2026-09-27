// 90-second first-session QA in the real sandboxed runtime: watch the showreel, take the
// tutorial, play Penalties, Free Kicks and Target Practice until 90 s are up, then count what the
// viewer actually saw (Stage stats + the Match Director QA hook) and check minimums.
// Owner's targets for the first 90 s of a fresh session (desktop 960 and phone 360):
//   >= 5 keepers, >= 8 distinct Director moments, >= 15 unique commentary lines, 0 lines repeated within 60 s.
// Usage: node scripts/qa-90s.mjs [--width 960|360] [--motion]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
/** --motion: play with full motion (the SDK harness forces prefers-reduced-motion: reduce by default). */
const motion = args.includes("--motion");
// keepers: distinct keepers on screen in the 90 s (Stage stats: cold open, walk-ons and kicks). keepersFaced
// (keepers actually kicked against) is reported next to it: Park free play rotates within the Director's
// easy pool (the ladder keeper ± one rung), so it is lower on a fresh profile.
const MINIMUMS = { uniqueLines: 25, contexts: 12, keepers: 5, celebrations: 2, waves: 1, taunts: 3, shots: 14, walkouts: 1,
  // Owner's first-90-s targets (Match Director): distinct moments played, unique lines said after Kick off.
  moments: 8, playLines: 15 };
/** 0 repeated commentary lines within 60 s (the whole 90 s, cold open included). */
const MAXIMUMS = { repeatsWithin60s: 0 };
let report, repeatList = [];

await testGame("./games/penalty-kings", {
  width, timeout: 60_000,
  check: async ({ page, game }) => {
    if (motion) await page.emulateMedia({ reducedMotion: "no-preference" });
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
    const kickoffAt = await game.locator("body").evaluate(() => performance.now() / 1000);
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
    const director = await game.locator("body").evaluate(() => window.__pkDirector());
    // Every line on screen with its time (Stage stats.lineLog): none may come back within 60 s.
    const log = stats.lineLog, repeats = [];
    for (let i = 0; i < log.length; i++) for (let j = i + 1; j < log.length; j++) if (log[j].text === log[i].text && log[j].at - log[i].at < 60) repeats.push(`${log[i].text} (${(log[j].at - log[i].at).toFixed(1)} s apart)`);
    repeatList = repeats;
    const inPlay = log.filter(entry => entry.at >= kickoffAt);
    const moments = [...new Set(director.played.map(m => m.id))];
    const faced = [...new Set(director.keepers.map(k => k.id))];
    report = {
      moments: moments.length, playLines: new Set(inPlay.map(entry => entry.text)).size, repeatsWithin60s: repeats.length, linesShown: log.length,
      keepersFaced: faced.length, walkOns: stats.walkOns, replays: stats.replays,
      momentList: director.played.map(m => `${m.id}@${Math.round(m.at - kickoffAt)}s`).join(", "), facedList: faced.join(", "), discovery: director.discovery,
      seconds: Math.round(elapsed()), shots: stats.shots, goals: stats.goals, saves: stats.saves, woodwork: stats.woodwork,
      uniqueLines: stats.lines.length, contexts: stats.contexts.length, keepers: stats.keepers.length, celebrations: stats.celebrations.length,
      waves: stats.waves, taunts: stats.taunts, walkouts: stats.walkouts, sfx: stats.sfx, reveals: stats.reveals,
      keeperList: stats.keepers.join(", "), celebrationList: stats.celebrations.join(", "),
    };
  },
});
console.log(`90-second QA at ${width}px (${motion ? "full motion" : "reduced motion, the SDK harness default"}):`);
for (const [key, value] of Object.entries(report)) console.log(`  ${key.padEnd(17)} ${value}${MINIMUMS[key] !== undefined ? `   (min ${MINIMUMS[key]})` : MAXIMUMS[key] !== undefined ? `   (max ${MAXIMUMS[key]})` : ""}`);
for (const [key, min] of Object.entries(MINIMUMS)) assert.ok(report[key] >= min, `${key} ${report[key]} < ${min}`);
for (const [key, max] of Object.entries(MAXIMUMS)) assert.ok(report[key] <= max, `${key} ${report[key]} > ${max}: ${repeatList.join(" | ")}`);
console.log("PASS 90-second QA");
