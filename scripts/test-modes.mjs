// Plays every free mode in the real sandboxed runtime: tutorial → Free Kicks (3) → Target
// Practice (kicks + a timed-out round is not waited for) → World Tour level → Daily Challenge.
// Screenshots each mode. Usage: node scripts/test-modes.mjs [--width 960] [--out artifacts/modes]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { playInPortraitIfAsked } from "./lib/phone.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "artifacts/modes";
await mkdir(out, { recursive: true });
const errors = [];

await testGame("./games/penalty-kings", {
  width, timeout: 60_000,
  check: async ({ page, game }) => {
    await playInPortraitIfAsked(game); // 360 × 800 is a portrait phone: "Play in portrait anyway" (R6-B7)
    page.on("pageerror", error => errors.push(String(error)));
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const frame = page.locator(".rf-game-frame");
    const toScreen = async (x, y) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale };
    };
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const swipe = async ({ fromX = 240, fromY = 250, dx = 0.3, steps = 9, step = 12, bow = 0 } = {}) => {
      const start = await toScreen(fromX, fromY);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { const b = Math.sin((i / steps) * Math.PI) * bow; await page.mouse.move(start.x + (i * dx * step + b) * start.scale, start.y - i * step * start.scale); await page.waitForTimeout(16); }
      await page.mouse.up();
    };
    const kick = async (label, options) => {
      await waitShootable();
      await swipe(options);
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      const banner = await game.locator(".pk-banner strong").textContent();
      console.log(`${label}: ${banner} (${await game.locator(".pk-banner span").textContent()})`);
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
      return banner;
    };

    // Tutorial (unlocks level 2).
    await game.getByTestId("play").click(); // first session: "Kick off" goes straight into the coached tutorial
    for (let i = 1; i <= 3; i++) await kick(`tutorial ${i}`, { dx: i === 2 ? -0.4 : 0.4 });
    await game.getByTestId("results").waitFor();
    assert.match(await game.getByTestId("results").textContent(), /Level 2/);
    // C4 SHARE CARD in the real sandbox: one tap draws a non-empty PNG. What the allow-scripts frame permits is probed
    // and logged: an opaque origin cannot download (no allow-downloads), so no "Save image" link is offered there.
    const sandbox = await game.locator("body").evaluate(() => ({ origin: window.origin, share: typeof navigator.share, canShare: typeof navigator.canShare, clipboard: typeof navigator.clipboard?.writeText }));
    console.log(`sandbox abilities: ${JSON.stringify(sandbox)}`);
    await game.getByTestId("share-card").click();
    const shareImage = game.getByTestId("share-image");
    await shareImage.waitFor();
    const card = await shareImage.evaluate(el => ({ src: el.src.slice(0, 22), w: el.naturalWidth, h: el.naturalHeight, bytes: Number(el.dataset.bytes) }));
    assert.equal(card.src, "data:image/png;base64,"); assert.deepEqual([card.w, card.h], [640, 360]);
    assert.ok(card.bytes > 5000, `the share card is not empty (${card.bytes} bytes)`);
    assert.equal(await game.getByTestId("share-download").count(), sandbox.origin === "null" ? 0 : 1, "no download link where the sandbox blocks downloads");
    assert.equal(await game.getByTestId("share-link").inputValue(), "https://tulipoaaaaa.github.io/penalty-kings/");
    console.log(`share card: ${card.w}x${card.h} PNG, ${card.bytes} bytes`);
    await button("Modes").click();
    // C4: Day N (the check-in run) and the Keeper of the Week line on the modes screen.
    assert.match(await game.getByTestId("streak-day").textContent(), /^Day 1/);
    const weekly = await game.getByTestId("weekly-keeper").textContent();
    assert.match(weekly, /^KEEPER OF THE WEEK: .+\. Score 3 in a round for ×2 XP/);
    console.log(`weekly: ${weekly}`);

    // Free Kicks: engine physics, wall, wind, trajectory preview.
    // D20: the modes screen always names the next goal (free progression only).
    const goal = await game.getByTestId("next-goal").textContent();
    assert.match(goal, /^NEXT GOAL /); assert.doesNotMatch(goal, /\bRF\b|pack|buy/i);
    console.log(`next goal: ${goal}`);
    // D18: the first visit of the day checks in (XP only) and says so.
    assert.match(await game.getByTestId("checkin").textContent(), /^Day 1 of 7 check-in: \+20 XP/);
    await game.getByTestId("mode-freekicks").click();
    await page.waitForTimeout(600);
    await frame.screenshot({ path: `${out}/freekick-aim-${width}.png` });
    const fk = [];
    for (let i = 1; i <= 3; i++) {
      const home = await canvas.evaluate(() => null);
      void home;
      fk.push(await kick(`free kick ${i}`, { fromY: 262, dx: i === 1 ? 0.25 : -0.3, steps: 10, step: 14, bow: i === 3 ? 30 : 0 }));
    }
    for (const result of fk) assert.match(result, /GOAL!|SCREAMER!|SAVED!|TIPPED OVER!|OFF THE POST!|OFF THE BAR!|OVER THE BAR!|WIDE!|BLOCKED!/);
    await game.getByTestId("results").waitFor();
    // C4 CHALLENGE A FRIEND: the share card carries a challenge code; come back tomorrow for day 2.
    assert.equal(await game.getByTestId("come-back").textContent(), "Come back tomorrow for day 2.");
    await game.getByTestId("share-card").click();
    const challengeCode = await game.getByTestId("challenge-code").inputValue();
    assert.match(challengeCode, /^pkc1\.f\./, "a free-kick challenge code");
    assert.equal(await game.getByTestId("share-link").inputValue(), `https://tulipoaaaaa.github.io/penalty-kings/?challenge=${challengeCode}`);
    const fkScore = Number(await game.getByTestId("round").getAttribute("data-score"));
    await frame.screenshot({ path: `${out}/c4-share-dialog-${width}.png` });
    await writeFile(`${out}/c4-share-card.png`, Buffer.from((await game.getByTestId("share-image").getAttribute("src")).split(",")[1], "base64")); // the card itself, as shared
    await button("Modes").click();
    // A tampered code is refused; the real one plays the same 3 free kicks against the same keeper.
    await game.getByTestId("challenge-box").locator("summary").click();
    const parts = challengeCode.split("."); parts[4] = (Number.parseInt(parts[4], 36) + 500).toString(36);
    await game.getByTestId("challenge-in").fill(parts.join("."));
    await game.getByTestId("challenge-play").click();
    assert.match(await game.getByTestId("challenge-error").textContent(), /changed or mistyped/);
    await game.getByTestId("challenge-in").fill(`https://tulipoaaaaa.github.io/penalty-kings/?challenge=${challengeCode}`);
    assert.match(await game.getByTestId("challenge-brief").textContent(), /^Friend #7730 scored .* in 3 free kicks against .+\. Beat it!$/);
    await game.getByTestId("challenge-play").click();
    assert.equal(await game.getByTestId("mode-chip").textContent(), "CHALLENGE");
    for (let i = 1; i <= 3; i++) await kick(`challenge free kick ${i}`, { fromY: 262, dx: [0.25, -0.3, 0.2][i - 1], steps: 10, step: 14 });
    await game.getByTestId("results").waitFor();
    const verdict = await game.getByTestId("results").locator("h3").textContent(); // the verdict is the Results title
    const mine = Number(await game.getByTestId("round").getAttribute("data-score"));
    assert.match(verdict, mine > fkScore ? /^You beat Friend #7730's / : mine === fkScore ? /^Level with Friend #7730/ : /^Friend #7730 still leads by /);
    console.log(`challenge: ${fkScore} to beat, scored ${mine}: ${verdict}`);
    await frame.screenshot({ path: `${out}/c4-challenge-result-${width}.png` });
    await button("Modes").click();
    // Keeper of the Week: a 5-penalty round against the featured keeper (the chip names the mode).
    await game.getByTestId("weekly-keeper").click();
    assert.equal(await game.getByTestId("mode-chip").textContent(), "KEEPER OF THE WEEK");
    await game.getByTestId("menu").click();
    await button("Change mode").click();

    // Target Practice: a few kicks against moving targets (the 60 s clock keeps running).
    await game.getByTestId("mode-target").click();
    await page.waitForTimeout(500);
    await frame.screenshot({ path: `${out}/target-${width}.png` });
    for (let i = 1; i <= 2; i++) await kick(`target ${i}`, { dx: i === 1 ? 0.3 : -0.3 });
    await game.getByTestId("menu").click();
    await button("Change mode").click();

    // World Tour: Park level 1.
    await game.getByTestId("mode-tour").click();
    // Round 6 C16: a path of 6 cities; the next level is highlighted; city 2 is closed until 9 stars in city 1.
    assert.equal(await game.locator("[data-testid^=city-]").count(), 6);
    assert.equal(await game.getByTestId("level-park-1").getAttribute("data-next"), "true", "the next level is highlighted");
    assert.equal(await game.getByTestId("level-park-6").isDisabled(), true, "city 2 waits for stars");
    await game.getByTestId("level-park-1").click();
    await button("Kick off").click();
    for (let i = 1; i <= 5; i++) await kick(`tour park-1 kick ${i}`, { dx: [0.45, -0.45, 0.4, -0.35, 0.5][i - 1] });
    await game.getByTestId("results").waitFor();
    const tour = await game.getByTestId("results").textContent();
    console.log(`tour result: ${tour.replace(/\s+/g, " ").slice(0, 120)}`);
    assert.match(tour, /First Touch/);
    await frame.screenshot({ path: `${out}/tour-results-${width}.png` });
    // "Next level" opens the following level's brief (Pick a Corner, same city).
    await game.getByTestId("next-level").click();
    await game.getByRole("heading", { name: "Pick a Corner" }).waitFor();
    await button("Back").click();
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    await button("Change mode").click();

    // Daily Challenge: today's scenario (penalties or a free kick), attempt counter.
    await game.getByTestId("mode-daily").click();
    await game.getByText("Attempts left:").waitFor();
    // Round 6 B6: the SDK sandbox cannot persist, so the Daily limit is labelled as practice attempts.
    await game.getByTestId("daily-practice").waitFor();
    await button("Play today's challenge").click();
    const daily = await game.getByTestId("mode-chip").textContent();
    console.log(`daily: ${daily}`);
    for (let i = 1; i <= 5; i++) {
      await kick(`daily kick ${i}`, { fromY: 256, dx: [0.3, -0.3, 0.35, -0.25, 0.3][i - 1], steps: 10, step: 13 });
      if (await game.getByTestId("results").isVisible()) break;
    }
    await game.getByTestId("results").waitFor();
    assert.match(await game.getByTestId("results").textContent(), /Daily/);

    // Save code round-trip (Settings): copy the code, paste it back, progress is restored.
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Settings", exact: true }).click();
    const code = await game.getByTestId("save-code-out").inputValue();
    assert.match(code, /^PK1\./, "a save code is shown");
    await game.getByTestId("save-code-in").fill(code);
    await game.getByTestId("save-code-restore").click();
    assert.match(await game.getByTestId("save-code-note").textContent(), /restored/);
    console.log(`save code: ${code.length} chars, restored`);
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
console.log(`PASS every free mode played at ${width}px`);
