// B8: frames of the cold-open showreel at fixed times, full motion, 1280×800 (SDK harness, sandboxed runtime).
// Times are wall-clock from the moment "Skip intro" appears (the reel starts with it), so they are ±0.2 s.
// Usage: node scripts/shot-coldopen.mjs <label>   → docs/screenshots/greatness/b8-<label>-t<ms>-1280x800.png
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

const label = process.argv[2] || "after";
const TIMES = [0.5, 2, 4, 6];
installPriceFixture();
{ // full motion from the first frame (the harness creates its context with reducedMotion "reduce")
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...launchArgs) => {
    const browser = await launch(...launchArgs);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (options = {}) => newContext({ ...options, reducedMotion: "no-preference" });
    return browser;
  };
}
mkdirSync("docs/screenshots/greatness", { recursive: true });
await testGame("./games/penalty-kings", {
  width: 1280, height: 800, timeout: 60_000,
  check: async ({ page, game }) => {
    await game.getByTestId("skip-intro").waitFor();
    const start = Date.now();
    for (const t of TIMES) {
      const wait = start + t * 1000 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      const path = `docs/screenshots/greatness/b8-${label}-t${String(Math.round(t * 1000)).padStart(4, "0")}-1280x800.png`;
      await page.screenshot({ path });
      console.log(`${((Date.now() - start) / 1000).toFixed(2)} s  ${path}`);
    }
  },
});
