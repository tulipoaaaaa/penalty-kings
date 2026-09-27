// Interaction test with the SDK's mock wallet (preview): title → tutorial (3 swipes) → results →
// Big Match: buy → place (play + settle) → TRUE reveal → kick. Also asserts that no HUD/pot/action
// element overlaps the goal mouth or the striker, and records frame times.
// Usage: node scripts/test-game.mjs [--width 360] [--screenshot path]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const shotIndex = args.indexOf("--screenshot");
const screenshot = shotIndex >= 0 ? args[shotIndex + 1] : undefined;
const errors = [];

// Logical scene geometry (games/penalty-kings/gfx): goal mouth and the striker's standing box.
// Penalty camera (round 6 B1): goal unit 68 px, goal line y 210, bar y 150. Round 6 B5: the striker stands
// 3 m behind-left of the spot (gfx/kick.ts runupStart: feet (145, 273), perspective scale 4.69 → 75 px tall).
const GOAL = { left: 172, right: 308, top: 150, bottom: 211 };
const STRIKER = { left: 107, right: 183, top: 202, bottom: 278 };
const SCOREBOARD = { left: 386, right: 480, top: 0, bottom: 22 };

await testGame("./games/penalty-kings", {
  width, screenshot, timeout: 60_000,
  check: async ({ page, game }) => {
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const toScreen = async (x, y) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale };
    };
    // A swipe from the ball: up and slightly right, ~180 ms, with a bowed middle.
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const swipe = async (dx = 0.35) => {
      const start = await toScreen(240, 250);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      for (let i = 1; i <= 9; i++) { await page.mouse.move(start.x + i * dx * 12 * start.scale, start.y - i * 12 * start.scale); await page.waitForTimeout(18); }
      await page.mouse.up();
    };
    const overlaps = async () => {
      const [g1, g2, s1, s2, b1, b2] = await Promise.all([toScreen(GOAL.left, GOAL.top), toScreen(GOAL.right, GOAL.bottom), toScreen(STRIKER.left, STRIKER.top), toScreen(STRIKER.right, STRIKER.bottom), toScreen(SCOREBOARD.left, SCOREBOARD.top), toScreen(SCOREBOARD.right, SCOREBOARD.bottom)]);
      const zones = { goal: { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y }, striker: { x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y }, scoreboard: { x1: b1.x, y1: b1.y, x2: b2.x, y2: b2.y } };
      const boxes = await game.locator(".pk-hud .pk-stat, .pk-hud .pk-chip, .pk-pot, .pk-actions button").evaluateAll(nodes => nodes.filter(n => n.offsetParent).map(n => { const r = n.getBoundingClientRect(); return { name: n.textContent.slice(0, 24), x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; }));
      const frame = await game.locator("canvas.pk-canvas").evaluate(n => { const r = n.ownerDocument.defaultView.frameElement?.getBoundingClientRect(); return r ? { x: r.left, y: r.top } : { x: 0, y: 0 }; });
      const hits = [];
      for (const box of boxes) for (const [zone, z] of Object.entries(zones)) {
        const b = { x1: box.x1 + frame.x, y1: box.y1 + frame.y, x2: box.x2 + frame.x, y2: box.y2 + frame.y };
        if (b.x1 < z.x2 - 1 && b.x2 > z.x1 + 1 && b.y1 < z.y2 - 1 && b.y2 > z.y1 + 1) hits.push(`${box.name.trim()} overlaps ${zone}`);
      }
      // UI elements must not overlap each other either (HUD chips, pot banner, action cluster).
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x1 < b.x2 - 1 && a.x2 > b.x1 + 1 && a.y1 < b.y2 - 1 && a.y2 > b.y1 + 1) hits.push(`${a.name.trim()} overlaps ${b.name.trim()}`);
      }
      const chips = await game.locator(".pk-hud .pk-stat, .pk-hud .pk-chip").evaluateAll(nodes => nodes.filter(n => n.offsetParent).length);
      if (chips > 3) hits.push(`${chips} HTML HUD chips (max 3 + canvas scoreboard)`);
      return hits;
    };

    // Title → modes → Penalties (first time = tutorial).
    await game.getByTestId("play").click(); // first session: "Kick off" goes straight into the coached tutorial
    await game.getByTestId("pot").waitFor();
    assert.equal(await game.getByTestId("pot").getAttribute("data-tag"), "SIMULATED", "pot banner is tagged SIMULATED in the preview");
    // USD is converted with the live RF price (recorded pool reads in the test fixture), not a constant.
    await game.getByTestId("pot-usd").filter({ hasText: /^≈ \$[\d,.]+$/ }).waitFor({ timeout: 10_000 });
    console.log(`pot banner at ${width}px: ${(await game.getByTestId("pot").innerText()).replace(/\s+/g, " ")}`);
    // Nothing in the pot banner is clipped or ellipsised.
    const clipped = await game.getByTestId("pot").evaluate(pot => {
      const box = pot.getBoundingClientRect(), bad = [];
      if (pot.scrollWidth > pot.clientWidth + 1 || pot.scrollHeight > pot.clientHeight + 1) bad.push("banner overflows");
      for (const child of pot.children) {
        if (!child.offsetParent) continue;
        const r = child.getBoundingClientRect();
        if (child.scrollWidth > child.clientWidth + 1 || r.left < box.left - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1) bad.push(`clipped: ${child.textContent}`);
      }
      return bad;
    });
    assert.deepEqual(clipped, [], "pot banner is not truncated");
    assert.deepEqual(await overlaps(), [], "no UI over the goal or striker (tutorial)");
    for (let kick = 1; kick <= 3; kick++) {
      await waitShootable();
      await swipe(kick === 2 ? -0.4 : 0.4);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      const banner = await game.locator(".pk-banner strong").textContent();
      assert.match(banner, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!/);
      console.log(`tutorial kick ${kick}: ${banner}`);
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    assert.match(await game.getByTestId("results").textContent(), /Tutorial complete/);
    await button("Modes").click();

    // Big Match, founder flow: BUY a pack → OPEN (SDK play + settle) → REVEAL ALL → true summary → BAG →
    // choose a ball → KICK (the ball is not consumed) → REDEEM one ball for RF.
    // (The SDK preview wallet holds 20 simulated RF, so the largest affordable Park pack is 2 balls.)
    await game.getByTestId("ball-shop").click();
    // Round 6 C10/C11: the first purchase explains Scuffed balls and the tokens, word for word.
    const first = await game.getByTestId("first-purchase").textContent();
    assert.match(first, /Scuffed Ball: 0 RF, but still drops \$GBOOT and counts for your collection/);
    assert.match(first, /RF: Rare Friends money\. Buy balls with it; cash balls back into it\./);
    assert.match(first, /Burn: spent \$GBOOT is gone forever\./);
    assert.doesNotMatch(first, /coins?/i);
    await game.getByTestId("pack-2").click();
    await game.getByTestId("buy-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByText("2 balls bought.").waitFor();
    await game.getByTestId("open-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByTestId("pack").waitFor({ timeout: 10_000 });
    assert.match(await game.getByTestId("pack").textContent(), /Rarity decided by/);
    await game.getByTestId("reveal-all").click();
    const summary = await game.getByTestId("pack-summary").textContent();
    assert.match(summary, /Spent 20 RF/, "the summary shows the true amount spent");
    console.log(`pack summary: ${summary.replace(/\s+/g, " ").slice(0, 140)}`);
    await game.getByTestId("to-bag").click();
    const cards = game.getByTestId("ball");
    assert.equal(await cards.count(), 2, "both revealed balls are in the Bag");
    const rfBefore = Number(await game.getByTestId("rf").textContent().catch(() => "0"));
    void rfBefore;
    await cards.first().getByTestId("shoot-ball").click();
    await waitShootable();
    assert.deepEqual(await overlaps(), [], "no UI over the goal or striker (Big Match)");
    await swipe(0.3);
    await game.locator(".pk-banner").waitFor({ timeout: 8000 });
    const banner = await game.locator(".pk-banner strong").textContent();
    await game.getByTestId("round").and(game.locator('[data-kicks="1"]')).waitFor({ timeout: 8000 });
    // Round 6 C12: the same ball comes back for the next kick (no carousel); the HUD reads "Bag N · Unopened M".
    await waitShootable();
    assert.equal(await game.getByTestId("carousel").count(), 0, "no carousel between kicks: the last-used ball is remembered");
    assert.match(await game.locator(".pk-hud-left .pk-stat").textContent(), /Bag 2 · Unopened 0/);
    await game.getByTestId("change-ball").click();
    await game.getByTestId("carousel").waitFor({ timeout: 5000 });
    assert.match(await game.getByTestId("carousel").textContent(), /1 kicks|0 goals in 1 kicks|1 goals in 1 kicks/, "the ball's career counts the kick");
    console.log(`big match kick: ${banner}`);
    // The ball stays in the Bag after kicking; redeem one with RF value (if both were Scuffed, there is nothing to redeem).
    await game.getByRole("button", { name: "Close", exact: true }).click();
    await waitShootable(); // closing the carousel goes back to aiming with the same ball
    await game.getByTestId("menu").click();
    await button("My Bag").click();
    assert.equal(await game.getByTestId("ball").count(), 2, "kicking did not consume a ball");
    const redeemable = game.getByTestId("redeem-ball").and(game.locator(":not([disabled])"));
    if (await redeemable.count()) {
      await redeemable.first().click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText(/^Redeemed a /).waitFor({ timeout: 10_000 });
      assert.equal(await game.getByTestId("ball").count(), 1, "the redeemed ball left the Bag");
      console.log("redeemed one ball for RF");
    } else console.log("both balls were Scuffed (no RF value): nothing to redeem this run");

    // Round 6 C11: the Cups screen explains the tokens, and a Wildcard spend asks first (Cancel spends nothing).
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    await button("Cups").click();
    assert.match(await game.getByTestId("token-lines").textContent(), /\$GBOOT: the game's token\. Spend it on kits, cup entries and wildcards\./);
    const potBefore = await game.getByText(/^Pot \$GBOOT:/).textContent();
    await game.getByTestId("wildcard").click();
    await game.getByTestId("wildcard-confirm").waitFor();
    await button("Cancel").click();
    assert.equal(await game.getByText(/^Pot \$GBOOT:/).textContent(), potBefore, "cancel spends nothing");
    await game.getByTestId("wildcard").click();
    await game.getByTestId("wildcard-yes").click();
    await game.getByText(/^Wildcards: 1/).waitFor();
    console.log("wildcard: confirmation shown, cancel spends nothing, confirm buys one");

    // Frame times (Stage render only) from a short idle window.
    const frames = await game.locator("canvas.pk-canvas").evaluate(async node => {
      const samples = []; let last = performance.now();
      await new Promise(resolve => { let n = 0; const tick = now => { samples.push(now - last); last = now; if (++n < 90) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      samples.sort((a, b) => a - b); void node;
      return { median: samples[Math.floor(samples.length / 2)], p95: samples[Math.floor(samples.length * 0.95)] };
    });
    console.log(`frame interval at ${width}px: median ${frames.median.toFixed(1)} ms, p95 ${frames.p95.toFixed(1)} ms`);
  },
});
assert.deepEqual(errors.filter(e => !/favicon/.test(e)), [], `console errors: ${errors.join("\n")}`);
console.log(`PASS interaction test at ${width}px`);
