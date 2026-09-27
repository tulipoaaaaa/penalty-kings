// Plays every free mode in the real sandboxed runtime: tutorial → Free Kicks (3) → Target
// Practice (kicks + a timed-out round is not waited for) → World Tour level → Daily Challenge.
// Screenshots each mode. Usage: node scripts/test-modes.mjs [--width 960] [--out artifacts/modes]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "artifacts/modes";
await mkdir(out, { recursive: true });
const errors = [];

await testGame("./games/penalty-kings", {
  width, timeout: 60_000,
  check: async ({ page, game }) => {
    page.on("pageerror", error => errors.push(String(error)));
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const frame = page.locator(".rf-game-frame");
    const toScreen = async (x, y) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale };
    };
    const swipe = async ({ fromX = 240, fromY = 250, dx = 0.3, steps = 9, step = 12, bow = 0 } = {}) => {
      const start = await toScreen(fromX, fromY);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { const b = Math.sin((i / steps) * Math.PI) * bow; await page.mouse.move(start.x + (i * dx * step + b) * start.scale, start.y - i * step * start.scale); await page.waitForTimeout(16); }
      await page.mouse.up();
    };
    const kick = async (label, options) => {
      await page.waitForTimeout(350);
      await swipe(options);
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      const banner = await game.locator(".pk-banner strong").textContent();
      console.log(`${label}: ${banner} (${await game.locator(".pk-banner span").textContent()})`);
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
      return banner;
    };

    // Tutorial (unlocks level 2).
    await button("Play").click();
    await game.getByTestId("mode-penalties").click();
    for (let i = 1; i <= 3; i++) await kick(`tutorial ${i}`, { dx: i === 2 ? -0.4 : 0.4 });
    await game.getByTestId("results").waitFor();
    assert.match(await game.getByTestId("results").textContent(), /Level 2/);
    await button("Modes").click();

    // Free Kicks: engine physics, wall, wind, trajectory preview.
    await game.getByTestId("mode-freekicks").click();
    await page.waitForTimeout(600);
    await frame.screenshot({ path: `${out}/freekick-aim-${width}.png` });
    const fk = [];
    for (let i = 1; i <= 3; i++) {
      const home = await canvas.evaluate(() => null);
      void home;
      fk.push(await kick(`free kick ${i}`, { fromY: 262, dx: i === 1 ? 0.25 : -0.3, steps: 10, step: 14, bow: i === 3 ? 30 : 0 }));
    }
    for (const result of fk) assert.match(result, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!|BLOCKED!/);
    await game.getByTestId("results").waitFor();
    await button("Modes").click();

    // Target Practice: a few kicks against moving targets (the 60 s clock keeps running).
    await game.getByTestId("mode-target").click();
    await page.waitForTimeout(500);
    await frame.screenshot({ path: `${out}/target-${width}.png` });
    for (let i = 1; i <= 2; i++) await kick(`target ${i}`, { dx: i === 1 ? 0.3 : -0.3 });
    await game.getByTestId("menu").click();
    await button("Change mode").click();

    // World Tour: Park level 1.
    await game.getByTestId("mode-tour").click();
    await game.getByTestId("level-park-1").click();
    await button("Kick off").click();
    for (let i = 1; i <= 5; i++) await kick(`tour park-1 kick ${i}`, { dx: [0.45, -0.45, 0.4, -0.35, 0.5][i - 1] });
    await game.getByTestId("results").waitFor();
    const tour = await game.getByTestId("results").textContent();
    console.log(`tour result: ${tour.replace(/\s+/g, " ").slice(0, 120)}`);
    assert.match(tour, /First Touch/);
    await frame.screenshot({ path: `${out}/tour-results-${width}.png` });
    await button("Modes").click();

    // Daily Challenge: today's scenario (penalties or a free kick), attempt counter.
    await game.getByTestId("mode-daily").click();
    await game.getByText("Attempts left:").waitFor();
    await button("Play today's challenge").click();
    const daily = await game.getByTestId("mode-chip").textContent();
    console.log(`daily: ${daily}`);
    for (let i = 1; i <= 5; i++) {
      await kick(`daily kick ${i}`, { fromY: 256, dx: [0.3, -0.3, 0.35, -0.25, 0.3][i - 1], steps: 10, step: 13 });
      if (await game.getByTestId("results").isVisible()) break;
    }
    await game.getByTestId("results").waitFor();
    assert.match(await game.getByTestId("results").textContent(), /Daily/);
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
console.log(`PASS every free mode played at ${width}px`);
