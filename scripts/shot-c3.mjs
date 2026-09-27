// C3 review screenshots: title, modes, results and the Ball shop at one size, in the real sandboxed runtime.
// Usage: node scripts/shot-c3.mjs --size 1280x800 --tag before [--out docs/screenshots/greatness]
// Writes <out>/c3-<screen>-<tag>-<w>x<h>.png. PK_NOW=<ms> pins the page clock (e.g. a Champions Night Saturday).
import { mkdir, stat } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture();
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [width, height] = arg("--size", "1280x800").split("x").map(Number);
const tag = arg("--tag", "after"), out = arg("--out", "docs/screenshots/greatness");
const now = process.env.PK_NOW ? Number(process.env.PK_NOW) : null;
await mkdir(out, { recursive: true });

await testGame("./games/penalty-kings", {
  width, height, timeout: 90_000,
  check: async ({ page, game }) => {
    if (now !== null) await page.clock.install({ time: now });
    const press = locator => (width < 500 ? locator.tap() : locator.click());
    const canvas = game.locator("canvas.pk-canvas");
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
    const swipe = async dx => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      const x = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 9; i++) { await page.mouse.move(x + i * dx * 12 * scale, y - i * 12 * scale); await page.waitForTimeout(18); }
      await page.mouse.up();
    };
    const shot = async name => {
      await page.waitForTimeout(700);
      const path = `${out}/c3-${name}-${tag}-${width}x${height}.png`;
      await page.screenshot({ path });
      console.log(`${path} ${Math.round((await stat(path)).size / 1024)} KB`);
    };
    await game.getByTestId("play").waitFor();
    const skip = game.getByTestId("skip-intro");
    if (await skip.isVisible()) await press(skip);
    await shot("title");
    await press(game.getByTestId("play"));
    for (let kick = 1; kick <= 3; kick++) {
      await waitShootable(); await swipe(kick === 2 ? -0.4 : 0.4);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    await shot("results");
    await press(game.getByRole("button", { name: "Modes", exact: true }));
    await game.getByTestId("ball-shop").waitFor();
    await shot("modes");
    await press(game.getByTestId("ball-shop"));
    await game.locator(".pk-tiers").waitFor();
    await game.locator(".pk-tiers").scrollIntoViewIfNeeded();
    await shot("shop");
  },
});
