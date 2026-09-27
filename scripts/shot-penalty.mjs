// Screenshots the penalty view (aim state) for visual review. Usage: node scripts/shot-penalty.mjs [--width 960] [--out path]
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
installPriceFixture();
const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : `artifacts/penalty-${width}.png`;
await testGame("./games/penalty-kings", {
  width, timeout: 60_000,
  check: async ({ page, game }) => {
    await game.getByTestId("play").click();
    await game.locator("body").evaluate(() => new Promise(resolve => { const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : setTimeout(poll, 50)); poll(); }));
    await page.waitForTimeout(3200);
    await page.locator(".rf-game-frame").screenshot({ path: out });
  },
});
console.log(`saved ${out}`);
