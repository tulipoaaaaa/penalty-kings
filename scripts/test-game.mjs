// Interaction test with the SDK's mock wallet (preview): title → tutorial (3 swipes) → results →
// Big Match: buy → place (play + settle) → TRUE reveal → kick. Also asserts that no HUD/pot/action
// element overlaps the goal mouth or the striker, and records frame times.
// Usage: node scripts/test-game.mjs [--width 360] [--screenshot path]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const shotIndex = args.indexOf("--screenshot");
const screenshot = shotIndex >= 0 ? args[shotIndex + 1] : undefined;
const errors = [];

// Logical scene geometry (games/penalty-kings/gfx): goal mouth and the striker's standing box.
const GOAL = { left: 150, right: 330, top: 96, bottom: 176 };
const STRIKER = { left: 186, right: 226, top: 240, bottom: 310 };
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
    await button("Play").click();
    await game.getByTestId("mode-penalties").click();
    await game.getByTestId("pot").waitFor();
    assert.equal(await game.getByTestId("pot").getAttribute("data-tag"), "SIMULATED", "pot banner is tagged SIMULATED in the preview");
    assert.deepEqual(await overlaps(), [], "no UI over the goal or striker (tutorial)");
    for (let kick = 1; kick <= 3; kick++) {
      await page.waitForTimeout(400);
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

    // Big Match: buy one ball in the kit bag (the runtime asks for an in-frame confirmation).
    await button("Kit bag").click();
    await game.locator(".pk-pedestal").first().waitFor();
    assert.equal(await game.locator(".pk-pedestal").count(), 7, "display case shows all 7 balls");
    await button("Buy 1 · 10 RF").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByText("1 ball added to your kit bag.").waitFor();
    await game.getByTestId("big-match").click();
    assert.equal(await game.getByTestId("balls").textContent(), "1");
    assert.match(await game.getByTestId("mode-chip").textContent(), /SIMULATED/);
    assert.deepEqual(await overlaps(), [], "no UI over the goal or striker (Big Match)");

    // Place the ball: play + settle → the TRUE rarity is revealed.
    await game.getByTestId("place").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    const reveal = game.locator(".pk-reveal");
    await reveal.waitFor({ timeout: 10_000 });
    const revealed = await reveal.getAttribute("aria-label");
    assert.match(revealed, /(Scuffed|Training|Match|Pro|Silver|Gold|Golden Boot) Ball revealed/);
    await button("Take the kick ⏎").click();
    await page.waitForTimeout(300);
    await swipe(0.3);
    await game.locator(".pk-banner").waitFor({ timeout: 8000 });
    const banner = await game.locator(".pk-banner strong").textContent();
    await game.getByTestId("round").and(game.locator('[data-kicks="1"]')).waitFor({ timeout: 8000 });
    console.log(`big match kick: ${banner}; ball: ${revealed}`);

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
