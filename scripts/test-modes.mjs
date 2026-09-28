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

    const quickKicksToResults = async label => {
      for (let i = 1; i <= 12 && !(await game.getByTestId("results").isVisible()); i++) {
        await waitShootable(); await game.getByTestId("quick").click();
        await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
      }
      await game.getByTestId("results").waitFor();
      console.log(`${label}: results`);
    };
    // EVERY SHARE ENTRY POINT (owner report: "Share result card in the Daily Challenge not working"): in the real SDK
    // sandbox each share button, within 2 s, shows a non-empty 640x360 PNG that is on screen and on top (not behind a
    // menu), the public link (never blob:/about:srcdoc), the challenge code where the round can be replayed, copy
    // fields that select their whole value on focus and a note telling the player to select/long-press (the sandbox
    // blocks the clipboard, so there is no silent "Copy" button). No page errors, no unhandled promise rejections.
    await game.locator("body").evaluate(() => { window.__pkRejections = []; addEventListener("unhandledrejection", event => window.__pkRejections.push(String(event.reason))); });
    const PUBLIC = "https://tulipoaaaaa.github.io/penalty-kings/";
    const shared = [];
    const checkShare = async (entry, { code, trigger = game.getByTestId("share-card") }) => {
      const started = Date.now();
      await trigger.click();
      const image = game.getByTestId("share-image");
      try { await image.waitFor({ state: "visible", timeout: 2_000 }); }
      catch { throw new Error(`${entry}: no share card within 2 s of the tap. Visible: ${(await game.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400)}`); }
      const ms = Date.now() - started;
      const card = await image.evaluate(el => {
        const r = el.getBoundingClientRect(), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
        const hit = bottom > top ? document.elementFromPoint(r.left + r.width / 2, (top + bottom) / 2) : null;
        return { src: el.src.slice(0, 22), w: el.naturalWidth, h: el.naturalHeight, bytes: Number(el.dataset.bytes), onScreen: bottom - top >= 40, onTop: hit === el };
      });
      assert.equal(card.src, "data:image/png;base64,", `${entry}: a PNG`); assert.deepEqual([card.w, card.h], [640, 360], `${entry}: 640x360`);
      assert.ok(card.bytes > 5000, `${entry}: the card is not empty (${card.bytes} bytes)`);
      assert.ok(card.onScreen && card.onTop, `${entry}: the card is on screen and not behind anything (${JSON.stringify(card)})`);
      const link = await game.getByTestId("share-link").inputValue();
      assert.ok(link.startsWith(PUBLIC), `${entry}: the public link, not ${link}`);
      assert.doesNotMatch(link, /blob:|about:|srcdoc/);
      if (code) {
        const value = await game.getByTestId("challenge-code").inputValue();
        assert.match(value, /^pkc1\./, `${entry}: a challenge code`);
        assert.equal(link, `${PUBLIC}?challenge=${value}`, `${entry}: the challenge link`);
      } else { assert.equal(await game.getByTestId("challenge-code").count(), 0, `${entry}: no challenge code`); assert.equal(link, PUBLIC); }
      const selected = await game.getByTestId("share-link").evaluate(el => { el.focus(); return el.selectionStart === 0 && el.selectionEnd === el.value.length; });
      assert.ok(selected, `${entry}: focusing the link selects all of it, ready to copy`);
      const words = await game.getByTestId("share-dialog").innerText();
      assert.match(words, /Long-press or right-click the image/, `${entry}: says how to save the image`);
      assert.match(words, /select it, then copy/i, `${entry}: says how to copy where the clipboard is blocked`);
      shared.push({ entry, ms, bytes: card.bytes, code: Boolean(code) });
      console.log(`share ${entry}: card in ${ms} ms, ${card.bytes} bytes${code ? ", challenge code" : ""}`);
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
    await checkShare("Results: tutorial", { code: false });
    // Polish: its heading lines are drawn in the heading face (PKHead, not bold Pixelify, which drew C like O), loaded
    // before the card is painted (tests/game/sharecard-type.test.ts checks every line's font).
    assert.ok(await game.locator("body").evaluate(() => [...document.fonts].some(face => face.family.replace(/"/g, "") === "PKHead" && face.status === "loaded")), "PKHead is loaded for the card");
    assert.equal(await game.getByTestId("share-download").count(), sandbox.origin === "null" ? 0 : 1, "no download link where the sandbox blocks downloads");
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
    await checkShare("Results: Free Kicks", { code: true });
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
    await checkShare("Results: challenge round", { code: true });
    await button("Modes").click();
    // Keeper of the Week: a 5-penalty round against the featured keeper (the chip names the mode).
    await game.getByTestId("weekly-keeper").click();
    assert.equal(await game.getByTestId("mode-chip").textContent(), "KEEPER OF THE WEEK");
    await quickKicksToResults("keeper of the week");
    await checkShare("Results: Keeper of the Week", { code: true });
    await button("Modes").click();
    // Penalties: a free round.
    await game.getByTestId("mode-penalties").click();
    await quickKicksToResults("penalties");
    await checkShare("Results: Penalties", { code: true });
    await button("Modes").click();

    // Target Practice: "60 seconds" is a real minute. The clock runs through each flight and result banner (it used to
    // run only while aiming, so a round of continuous kicks took minutes): kicking non-stop, Results is up within 75 s.
    const targetStarted = Date.now();
    await game.getByTestId("mode-target").click();
    await page.waitForTimeout(500);
    await frame.screenshot({ path: `${out}/target-${width}.png` });
    const targetResults = game.getByTestId("results");
    let targetKicks = 0;
    while (Date.now() - targetStarted < 120_000) {
      const next = await game.locator("body").evaluate(() => new Promise(resolve => {
        const start = Date.now();
        const poll = () => (document.querySelector("[data-testid=results]") ? resolve("results") : window.__pkFlow?.().shootable ? resolve("shoot") : Date.now() - start > 15000 ? resolve("stuck") : setTimeout(poll, 50));
        poll();
      }));
      if (next !== "shoot") break;
      await swipe({ dx: targetKicks % 2 ? -0.3 : 0.3 }); targetKicks++;
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 }).catch(() => undefined);
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 }).catch(() => undefined);
    }
    const targetSeconds = (Date.now() - targetStarted) / 1000;
    await targetResults.waitFor({ timeout: 5_000 }).catch(() => undefined);
    assert.ok(await targetResults.isVisible(), `a Target Practice round ends on its own (${targetKicks} kicks, ${targetSeconds.toFixed(1)} s)`);
    assert.ok(targetSeconds <= 75, `the 60 s Target round took ${targetSeconds.toFixed(1)} s of real time (${targetKicks} kicks)`);
    console.log(`target: ${targetKicks} kicks, round over in ${targetSeconds.toFixed(1)} s of real time`);
    await checkShare("Results: Target Practice", { code: false });
    await button("Modes").click();

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
    await checkShare("Results: World Tour", { code: false });
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
    await checkShare("Results: Daily", { code: true });
    const dailyCode = await game.getByTestId("challenge-code").inputValue();
    // The Daily Challenge menu's "Share result card" (the owner's report): it used to call navigator.share (absent in
    // the sandbox), then the clipboard (blocked), then put the text in a message hidden behind the open Daily menu, so
    // the tap did nothing visible. It now opens the same share card for today's best Daily round, in the menu.
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.locator(".pk-modescreen").waitFor();
    await game.getByTestId("mode-daily").click();
    await checkShare("Daily Challenge menu card", { code: true, trigger: game.locator(".pk-daily").getByRole("button", { name: "Share result card", exact: true }) });
    assert.equal(await game.getByTestId("challenge-code").inputValue(), dailyCode, "the Daily card shares today's best round (the only one played)");
    await frame.screenshot({ path: `${out}/daily-share-${width}.png` });
    assert.deepEqual(shared.map(item => item.entry), ["Results: tutorial", "Results: Free Kicks", "Results: challenge round", "Results: Keeper of the Week", "Results: Penalties", "Results: Target Practice", "Results: World Tour", "Results: Daily", "Daily Challenge menu card"], "every in-game share entry point was checked");
    assert.deepEqual(await game.locator("body").evaluate(() => window.__pkRejections), [], "no unhandled promise rejections");

    // Save code round-trip (Settings): copy the code, paste it back, progress is restored.
    // (Closing the Daily menu goes to the Modes screen, which has its own Settings button.)
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.locator(".pk-modescreen").waitFor();
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

// C3b Champions Night: the page clock pinned inside the Saturday 19:00–21:00 UTC window. On the Park build: the
// Champions look, the "double Cup points" strip, the special intro line, the HUD night tag. C3c: the simulated pot
// ticks up (count-up, glow) as simulated rivals buy balls.
const NIGHT = Date.UTC(2026, 9, 3, 19, 30); // Saturday 3 Oct 2026, 19:30 UTC
await testGame("./games/penalty-kings", {
  width, timeout: 90_000,
  check: async ({ page, game }) => {
    await playInPortraitIfAsked(game);
    page.on("pageerror", error => errors.push(String(error)));
    await page.clock.install({ time: NIGHT });
    const stats = () => game.locator("body").evaluate(() => window.__pkStats());
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
    if (await game.getByTestId("skip-intro").isVisible()) await game.getByTestId("skip-intro").click();
    const strip = game.getByTestId("champions-night");
    await game.locator('[data-testid="champions-night"][data-active="true"]').waitFor({ timeout: 5000 });
    assert.match(await strip.innerText(), /^CHAMPIONS NIGHT · double Cup points · ends in 1h \d+m$/);
    assert.equal(await game.locator("section.pk").getAttribute("data-night"), "true");
    await game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkStats().stadium === "champions" ? resolve(true) : Date.now() - start > 5000 ? reject(new Error("no Champions look")) : setTimeout(poll, 50)); poll(); }));
    console.log(`champions night: ${await strip.innerText()} · stadium ${(await stats()).stadium}`);
    // The simulated pot ticks up: a simulated rival's ball every 15 s → the counter counts up and glows.
    const value = game.getByTestId("pot-counter-value");
    assert.match(await value.innerText(), /500,000 RF/);
    await game.locator('[data-testid="pot-counter"][data-glow]').waitFor({ timeout: 20_000 }); // the rivals' interval runs on real time
    await game.getByTestId("pot-counter-value").filter({ hasText: "500,027 RF" }).waitFor({ timeout: 5000 });
    console.log(`pot ticked up: ${await value.innerText()}`);
    // Tutorial (keeps its first-walkout line), then Penalties: the Champions Night intro line and the HUD tag.
    await game.getByTestId("play").click();
    for (let i = 1; i <= 3; i++) {
      await waitShootable(); await game.getByTestId("quick").click();
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
    }
    await game.getByTestId("results").waitFor();
    assert.match(await game.getByTestId("results").getByTestId("champions-night").innerText(), /^CHAMPIONS NIGHT/);
    await game.getByRole("button", { name: "Modes", exact: true }).click();
    await game.getByTestId("mode-penalties").click();
    await waitShootable();
    assert.equal((await stats()).stadium, "champions", "the Park build plays in the Champions look tonight");
    assert.ok((await stats()).contexts.includes("champions-night"), "the commentator opens with the Champions Night line");
    assert.match(await game.getByTestId("night-tag").innerText(), /NIGHT ×2/);
    console.log("champions night: intro line said, HUD tag shown");
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
console.log(`PASS Champions Night at ${width}px`);
