// Focused interaction test with the SDK's mock wallet: buy → place (play + settle) → reveal → shoot → HUD.
// Usage: node scripts/test-game.mjs [--width 360] [--screenshot path]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const shotIndex = args.indexOf("--screenshot");
const screenshot = shotIndex >= 0 ? args[shotIndex + 1] : undefined;
const errors = [];

await testGame("./games/penalty-kings", {
  width, screenshot, timeout: 30_000,
  check: async ({ page, game }) => {
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(String(error)));
    const button = name => game.getByRole("button", { name, exact: true });
    const text = id => game.getByTestId(id).textContent();

    // Intro card shows the Friend as the striker; dismiss it.
    await game.getByRole("dialog", { name: "Welcome to Penalty Kings" }).waitFor();
    await button("Kick off").click();

    // Warm-up kick with the keyboard: no rewards, no round progress.
    await button("Warm-up").click();
    await game.locator("canvas.pk-canvas").focus();
    await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(250); await page.keyboard.up("ArrowLeft");
    await page.keyboard.down("Space"); await page.waitForTimeout(700); await page.keyboard.up("Space");
    await game.getByText("Warm-up kick · no score, no rewards").waitFor({ timeout: 8000 });
    await button("Buy balls").waitFor({ timeout: 10_000 });
    assert.equal(await text("score"), "0", "warm-up scores nothing");

    // Buy one ball in the kit bag (the runtime asks for an in-frame confirmation).
    await button("Buy balls").click();
    await game.getByRole("cell", { name: "Golden Boot Ball" }).waitFor();
    await button("Buy 1 · 10 RF").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByText("1 ball added to your kit bag.").waitFor();
    await game.getByRole("button", { name: "Close Kit bag", exact: true }).click();
    assert.equal(await text("balls"), "1");
    assert.equal(await text("rf"), "10");

    // Place the ball: play + settle → rarity reveal.
    await button("Place ball").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    const reveal = game.getByRole("dialog");
    await reveal.waitFor({ timeout: 10_000 });
    const revealed = await reveal.getAttribute("aria-label");
    assert.match(revealed, /(Scuffed|Training|Match|Pro|Silver|Gold|Golden Boot) Ball revealed/);
    assert.ok(Number((await text("gboot")).replace(/,/g, "")) >= 13, "ball drop credited (simulated)");
    await game.getByText("Your kick never changes what you win").first().waitFor();

    // Shoot (touch-style flick from the ball, up and to the right).
    await button("Take the kick ⏎").click();
    const canvas = game.locator("canvas.pk-canvas");
    const box = await canvas.boundingBox();
    const sx = box.x + box.width * (240 / 480), sy = box.y + box.height * (246 / 320);
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(sx + i * box.width * 0.012, sy - i * box.height * 0.035);
    await page.mouse.up();
    await game.locator(".pk-banner").waitFor({ timeout: 8000 });
    const banner = await game.locator(".pk-banner strong").textContent();
    assert.match(banner, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!/);
    await game.getByTestId("round").and(game.locator('[data-kicks="1"]')).waitFor({ timeout: 8000 });
    if (banner === "GOAL!") assert.notEqual(await text("score"), "0");
    await button("Buy balls").waitFor({ timeout: 10_000 });
    console.log(`kick result: ${banner}; ball: ${revealed}`);
  },
});
assert.deepEqual(errors, [], `console errors: ${errors.join("\n")}`);
console.log(`PASS interaction test at ${width}px`);
