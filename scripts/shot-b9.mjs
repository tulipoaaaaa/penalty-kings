// B9 UI feel review screenshots: Results (after the tutorial) and the modes screen, in the real sandboxed runtime.
// Usage: node scripts/shot-b9.mjs --size 1280x800 --tag before [--out docs/screenshots/greatness]
// Writes <out>/b9-<screen>-<tag>-<w>x<h>.png once the Results count-up has settled (data-final) and transitions ended.
import { mkdir, stat } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture();
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [width, height] = arg("--size", "1280x800").split("x").map(Number);
const tag = arg("--tag", "after"), out = arg("--out", "docs/screenshots/greatness"), motion = tag !== "before" || args.includes("--motion");
await mkdir(out, { recursive: true });

await testGame("./games/penalty-kings", {
  width, height, timeout: 90_000,
  check: async ({ page, game }) => {
    const press = locator => (width < 500 ? locator.tap() : locator.click());
    const canvas = game.locator("canvas.pk-canvas");
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
    const swipe = async dx => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      const x = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 9; i++) { await page.mouse.move(x + i * dx * 12 * scale, y - i * 12 * scale); await page.waitForTimeout(18); }
      await page.mouse.up();
      await page.mouse.move(1, 1); // park the pointer (no hover lift in the shot)
    };
    const shot = async name => {
      await page.waitForTimeout(700);
      const path = `${out}/b9-${name}-${tag}-${width}x${height}.png`;
      await page.screenshot({ path });
      console.log(`${path} ${Math.round((await stat(path)).size / 1024)} KB`);
    };
    await game.getByTestId("play").waitFor();
    if (motion) await page.emulateMedia({ reducedMotion: "no-preference" }); // the SDK harness defaults to reduce
    const skip = game.getByTestId("skip-intro");
    if (await skip.isVisible()) await press(skip);
    await press(game.getByTestId("play"));
    for (let kick = 1; kick <= 3; kick++) {
      await waitShootable(); await swipe(kick === 2 ? -0.4 : 0.4);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    if (tag !== "before") {
      await page.waitForTimeout(250); // part-way through the count-up (the tiles are in view until it lands)
      const path = `${out}/b9-results-counting-${tag}-${width}x${height}.png`;
      await page.screenshot({ path });
      console.log(`${path} ${Math.round((await stat(path)).size / 1024)} KB`);
      await game.locator('[data-testid="results"][data-final]').waitFor({ timeout: 5000 });
    }
    await shot("results");
    await press(game.getByRole("button", { name: "Modes", exact: true }));
    await game.getByTestId("ball-shop").waitFor();
    await page.mouse.move(1, 1);
    await shot("modes");
    if (tag !== "before") { // a mode card held down: 2px into its shadow, darker (released off the card: no click)
      const box = await game.getByTestId("mode-freekicks").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await shot("modes-pressed");
      await page.mouse.move(1, 1); await page.mouse.up();
    }
  },
});
