// Screenshots of the in-frame menus (results, ball shop, Bag, rules, odds) for UI reviews, plus the smallest
// text size found in each menu (the owner's minimum is 11 CSS px).
// Usage: node scripts/shot-ui.mjs [--width 360] [--tag after] [--out docs/screenshots] [--all [--all-out artifacts/ui]]
// Writes <out>/ui-<screen>-<width>[-<tag>].png; --all also visits the hub, cups, book, kit shop, settings, market,
// tour and daily menus (screenshots into --all-out). Uses the SDK preview wallet and the recorded RF price fixture.
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture();
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const width = Number(arg("--width", 960)), tag = arg("--tag", ""), out = arg("--out", "docs/screenshots");
const all = args.includes("--all"), allOut = arg("--all-out", "artifacts/ui");
const report = [];

await testGame("./games/penalty-kings", {
  width, timeout: 90_000,
  check: async ({ page, game }) => {
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
    const swipe = async dx => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      const x = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 9; i++) { await page.mouse.move(x + i * dx * 12 * scale, y - i * 12 * scale); await page.waitForTimeout(18); }
      await page.mouse.up();
    };
    const shot = async (name, dir = out) => {
      const menu = game.locator(".rf-frame-menu");
      await menu.waitFor();
      await page.waitForTimeout(450); // let the entry animation finish
      const sizes = await menu.evaluate(root => {
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let min = Infinity, where = "";
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement;
          if (!node.textContent.trim() || !el || !el.getClientRects().length) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < min) { min = size; where = `${el.tagName.toLowerCase()}.${el.className} "${node.textContent.trim().slice(0, 30)}"`; }
        }
        return { min, where };
      });
      const path = `${dir}/ui-${name}-${width}${tag ? `-${tag}` : ""}.png`;
      await page.locator(".rf-game-frame").screenshot({ path });
      report.push(`${name}: smallest text ${sizes.min}px (${sizes.where})`);
      console.log(`${path}: smallest text ${sizes.min}px ${sizes.where}`);
    };

    // Tutorial (3 kicks) → results.
    await game.getByTestId("play").click();
    for (let kick = 1; kick <= 3; kick++) {
      await waitShootable(); await swipe(kick === 2 ? -0.4 : 0.4);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    await shot("results");
    await button("Modes").click();

    // Ball shop (first purchase explainer), then buy + open a pack → Bag.
    await game.getByTestId("ball-shop").click();
    await game.getByTestId("first-purchase").waitFor();
    await shot("shop");
    await game.getByRole("button", { name: "See odds", exact: true }).first().click();
    await game.locator(".pk-odds").first().waitFor();
    await shot("odds");
    await game.getByRole("button", { name: "Close Odds" }).click();
    await game.getByTestId("ball-shop").click();
    await game.getByTestId("pack-2").click();
    await game.getByTestId("buy-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByText("2 balls bought.").waitFor();
    await game.getByTestId("open-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByTestId("reveal-all").click();
    await game.getByTestId("to-bag").click();
    assert.equal(await game.getByTestId("ball").count(), 2);
    await shot("bag");

    // Kick with a ball → in-play Menu → Rules.
    await game.getByTestId("shoot-ball").first().click();
    await waitShootable();
    await game.getByTestId("menu").click();
    await button("Rules").click();
    await game.locator(".pk-rules").waitFor();
    await shot("rules");
    if (!all) return;

    // --all: every other in-frame menu (text-size check; screenshots go to --all-out).
    const close = () => game.locator(".rf-frame-menu-heading button").click();
    await close(); await game.getByTestId("menu").click(); await shot("hub", allOut);
    for (const name of ["Cups", "Scouting Book", "Kit shop", "Settings"]) {
      await button(name).click(); await shot(name.toLowerCase().replace(" ", "-"), allOut);
      await close(); await game.getByTestId("menu").click();
    }
    await button("My Bag").click(); await button("Market (coming soon)").click(); await shot("market", allOut);
    await close(); await game.getByTestId("menu").click(); await button("Change mode").click();
    await game.getByTestId("mode-tour").click(); await shot("tour", allOut);
    await game.getByTestId("level-park-1").click(); await shot("tour-brief", allOut);
    await close(); await game.getByTestId("mode-daily").click(); await shot("daily", allOut);
  },
});
console.log(`PASS UI screenshots at ${width}px\n${report.join("\n")}`);
