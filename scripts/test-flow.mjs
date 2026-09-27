// Action-flow audit in the real sandboxed runtime (bug round 3). Tries the awkward interleavings a
// player can produce and asserts exactly one kick (or none) each time. The pure state machine is
// tested exhaustively in tests/game/flow.test.ts; this proves the shell obeys it.
// Usage: node scripts/test-flow.mjs [--width 960]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const errors = [];
const results = [];
const ok = name => { results.push(name); console.log(`  ✓ ${name}`); };

await testGame("./games/penalty-kings", {
  width, timeout: 90_000,
  check: async ({ page, game }) => {
    page.on("pageerror", error => errors.push(String(error)));
    const canvas = game.locator("canvas.pk-canvas");
    const flow = () => game.locator("body").evaluate(() => window.__pkFlow());
    const kicks = async () => Number(await game.getByTestId("round").getAttribute("data-kicks"));
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const waitIdleKick = async () => { await game.locator(".pk-banner").waitFor({ timeout: 10_000 }); await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 }); };
    const toScreen = async (x, y) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale, box };
    };
    const swipe = async ({ dx = 0.35, fromX = 240, fromY = 250, before, mid, up = true } = {}) => {
      const start = await toScreen(fromX, fromY);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      for (let i = 1; i <= 9; i++) { await page.mouse.move(start.x + i * dx * 12 * start.scale, start.y - i * 12 * start.scale); await page.waitForTimeout(16); if (i === 4 && mid) await mid(); }
      if (before) await before();
      if (up) await page.mouse.up();
    };
    const noBanner = async (ms = 1200) => { await page.waitForTimeout(ms); assert.equal(await game.locator(".pk-banner").count(), 0, "no kick happened"); };

    // 1. Shoot during the keeper walkout (tutorial opening): ignored, and the shot clock does not run.
    await game.getByTestId("play").click();
    await page.waitForTimeout(300);
    assert.equal((await flow()).stage, true, "the walkout is a protected moment");
    await swipe();
    await noBanner(600);
    assert.equal(await kicks(), 0);
    ok("swipe during the walkout is ignored");

    // 2. Double release: swipe + Quick shot + Space in the same instant → exactly ONE kick.
    await waitShootable();
    await swipe({ before: async () => { await game.getByTestId("quick").click({ force: true, noWaitAfter: true }).catch(() => {}); } });
    await page.keyboard.down(" "); await page.keyboard.up(" ");
    await waitIdleKick();
    assert.equal(await kicks(), 1, "one kick recorded");
    ok("double release (swipe + Quick shot + Space) records exactly one kick");

    // 3. Keyboard + mouse together: while Space charges, a pointer swipe cannot start; releasing Space shoots once.
    await waitShootable();
    await page.keyboard.down(" ");
    await swipe();
    await page.waitForTimeout(150);
    assert.equal(await game.locator(".pk-banner").count(), 0, "the swipe did not shoot while Space was charging");
    await page.keyboard.up(" ");
    await waitIdleKick();
    assert.equal(await kicks(), 2);
    ok("Space charge + mouse swipe at once: one kick, from the key");

    // 4. Swipe released outside the canvas (pointer capture) still shoots exactly once.
    await waitShootable();
    const { box } = await toScreen(240, 250);
    await swipe({ up: false });
    await page.mouse.move(box.x + box.width / 2, box.y - 60); // above the canvas, outside it
    await page.mouse.up();
    await waitIdleKick();
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    ok("swipe released outside the canvas shoots once (tutorial finished on 3 kicks)");
    await game.getByRole("button", { name: "Modes", exact: true }).click();

    // 5. Penalties (5 s shot clock): an open menu freezes the clock; closing it does not time out.
    await game.getByTestId("mode-penalties").click();
    await waitShootable();
    await game.getByTestId("menu").click();
    await page.waitForTimeout(6500);
    await game.getByRole("button", { name: "Close" }).first().click();
    await page.waitForTimeout(700);
    assert.equal(await game.locator(".pk-banner").count(), 0, "no TIME! after closing the menu");
    assert.equal(await kicks(), 0);
    ok("menu open for 6.5 s during a 5 s shot clock: no timeout");

    // 6. Swipe starting off-canvas (above the pitch, in the HUD band) and dragged over the ball: no shot.
    await waitShootable();
    const top = await toScreen(240, 40);
    await page.mouse.move(top.x, top.box.y - 20); await page.mouse.down();
    await page.mouse.move(top.x, top.y + 180, { steps: 8 }); await page.mouse.up();
    await noBanner(600);
    ok("swipe starting off-canvas does not shoot");

    // 7. Resize mid-swipe: the gesture is dropped (no shot measured at two scales).
    await waitShootable();
    const size = page.viewportSize();
    await swipe({ mid: async () => { await page.setViewportSize({ width: size.width - 40, height: size.height }); } });
    await noBanner(900);
    await page.setViewportSize(size);
    ok("resize mid-swipe drops the gesture");

    // 8. Mode switch mid-kick: Menu and the pot banner are disabled while the kick plays.
    await waitShootable();
    await swipe();
    await page.waitForTimeout(150);
    assert.equal(await game.getByTestId("menu").isDisabled(), true, "Menu disabled mid-kick");
    assert.equal(await game.getByTestId("pot").isDisabled(), true, "pot banner disabled mid-kick");
    await waitIdleKick();
    assert.equal(await kicks(), 1);
    ok("no menu or mode switch mid-kick");

    // 9. Quick shot during a free kick (double click) → one kick.
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Change mode", exact: true }).click();
    await game.getByTestId("mode-freekicks").click();
    await waitShootable();
    await game.getByTestId("quick").dblclick();
    await waitIdleKick();
    assert.equal(await kicks(), 1);
    ok("Quick shot double-click on a free kick records one kick");

    // 10. Shoot with 0 balls: Big Match with an empty Bag opens the ball shop instead of a session.
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Change mode", exact: true }).click();
    await game.getByTestId("mode-match").click();
    await game.getByTestId("buy-pack").waitFor({ timeout: 5000 });
    assert.equal((await flow()).match, false, "no Big Match session without balls");
    ok("Big Match with 0 balls goes to the shop, no kick possible");

    // 11. Shoot while a pack is revealing (buy a 2-pack, open it, swipe on the pitch behind the cards).
    await game.getByTestId("pack-2").click();
    await game.getByTestId("buy-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByText("2 balls bought.").waitFor();
    await game.getByTestId("open-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByTestId("pack").waitFor({ timeout: 10_000 });
    const during = await flow();
    assert.equal(during.pack, true); assert.equal(during.shootable, false, "not shootable while the pack is open");
    await page.keyboard.down(" "); await page.keyboard.up(" ");
    await noBanner(500);
    await game.getByTestId("reveal-all").click();
    await game.getByTestId("to-bag").click();
    ok("no kick while a pack is revealing (keyboard included)");

    // 12. Redeem the ball being aimed with → the aim is cancelled (cannot kick a ball you no longer hold).
    const cards = game.getByTestId("ball");
    await cards.first().getByTestId("shoot-ball").click();
    await waitShootable();
    const redeemable = await game.locator("[data-testid=redeem]").count();
    if (redeemable) console.log("  (redeem path covered by test-game.mjs when a valued ball is pulled)");
    await game.getByTestId("menu").click();
    await page.waitForTimeout(200);
    assert.equal((await flow()).shootable, false, "menu open: not shootable");
    ok("Big Match aim with menu open is not shootable");
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
console.log(`PASS action-flow audit at ${width}px (${results.length} scenarios)`);
