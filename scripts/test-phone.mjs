// Phone layouts in the real sandboxed runtime (R6-B7, owner playtest): 360×800 and 390×844 portrait, 800×360 and
// 844×390 landscape. For each size:
//   - the frame fits the screen (no scrolling to reach the game);
//   - portrait: the "Turn your phone sideways" card, then "Play in portrait anyway"; landscape: no card;
//   - the goal and the ball are wholly on screen, uncovered by game UI, and clear of the SDK toolbar;
//   - no text under 11 CSS px anywhere in the game UI (a DOM walk in the game frame) on the rotate card, the
//     title, the HUD / pot banner / coaching toast, the results, the pack opening and the ball carousel;
//   - Kick off, Quick shot and Menu (and the pack/carousel buttons) are on screen, tappable (nothing covers them)
//     and not under the SDK toolbar;
//   - a real swipe (touch events on the page, from the ball upwards) produces a kick;
//   - saves artifacts/phone-<w>x<h>.png (or --out docs/screenshots to refresh the docs) (the phone's screen while aiming, after the first kick).
// Usage: node scripts/test-phone.mjs [--size 360x800] [--out docs/screenshots]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const SIZES = (option("--size") ? [option("--size")] : ["360x800", "390x844", "800x360", "844x390"]).map(size => size.split("x").map(Number));
const OUT = option("--out") ?? "artifacts";
const MIN_FONT = 11;
// Logical scene geometry (gfx/stadium.ts, penalty camera): goal mouth incl. posts and bar, and the ball on the spot.
const GOAL = { left: 168, right: 312, top: 146, bottom: 212 };
const BALL = { left: 233, right: 247, top: 243, bottom: 257 };
await mkdir(OUT, { recursive: true });

for (const [width, height] of SIZES) {
  const portrait = height > width, label = `${width}x${height}`, errors = [];
  const checked = [];
  await testGame("./games/penalty-kings", {
    width, height, timeout: 60_000,
    check: async ({ page, game }) => {
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", error => errors.push(String(error)));
      const canvas = game.locator("canvas.pk-canvas");
      /** Tap on touch contexts (the harness enables touch below 500px), click otherwise. */
      const press = locator => (width < 500 ? locator.tap() : locator.click());
      const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
      /** Page coordinates of a logical scene point (the canvas letterboxes the 480 × 320 pitch: object-fit contain). */
      const toPage = async (x, y) => {
        const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
        return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale };
      };
      const toolbar = () => page.locator(".rf-frame-toolbar").evaluate(node => { const r = node.getBoundingClientRect(); return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; });
      const iframeOrigin = () => page.locator("iframe").evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left + node.clientLeft, y: r.top + node.clientTop }; });
      const hit = (a, b) => a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
      const inViewport = r => r.x1 >= -0.5 && r.y1 >= -0.5 && r.x2 <= width + 0.5 && r.y2 <= height + 0.5;

      /** No visible text in the game frame under 11 CSS px. */
      const fonts = async state => {
        const small = await game.locator("body").evaluate(min => {
          const bad = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent.trim(), element = node.parentElement;
            if (!text || !element || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            const box = range.getBoundingClientRect();
            if (box.width < 1 || box.height < 1 || box.right < 0 || box.bottom < 0 || box.left > innerWidth || box.top > innerHeight) continue;
            const size = parseFloat(getComputedStyle(element).fontSize);
            if (size < min - 0.01) bad.push(`${size.toFixed(1)}px <${element.tagName.toLowerCase()} class="${element.className}"> "${text.slice(0, 40)}"`);
          }
          return bad;
        }, MIN_FONT);
        assert.deepEqual(small, [], `${label} ${state}: text under ${MIN_FONT} CSS px`);
        checked.push(`fonts:${state}`);
      };
      /** On screen, tappable (the hit test at its centre lands on it, in the frame and on the page), not under the toolbar. */
      const reachable = async (locator, name) => {
        await locator.waitFor({ state: "visible" });
        const origin = await iframeOrigin(), bar = await toolbar();
        const own = await locator.evaluate(node => {
          const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
          return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, x, y, covered: !(top && node.contains(top)) && `${top?.tagName}.${top?.className}` };
        });
        const box = { x1: own.x1 + origin.x, y1: own.y1 + origin.y, x2: own.x2 + origin.x, y2: own.y2 + origin.y };
        assert.equal(own.covered, false, `${label}: ${name} is covered by ${own.covered}`);
        assert.ok(inViewport(box), `${label}: ${name} is off screen ${JSON.stringify(box)}`);
        assert.ok(!hit(box, bar), `${label}: ${name} is under the SDK toolbar ${JSON.stringify({ box, bar })}`);
        const onPage = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [own.x + origin.x, own.y + origin.y]);
        assert.equal(onPage, "IFRAME", `${label}: ${name}'s centre is covered on the page by ${onPage}`);
        assert.ok(box.y2 - box.y1 >= 32 && box.x2 - box.x1 >= 32, `${label}: ${name} is a small target ${JSON.stringify(box)}`);
        checked.push(`tap:${name}`);
      };
      /** A logical scene rect: on screen, not under the toolbar, and every sampled point hits the canvas. */
      const sceneVisible = async (rect, name) => {
        const a = await toPage(rect.left, rect.top), b = await toPage(rect.right, rect.bottom), bar = await toolbar(), origin = await iframeOrigin();
        const box = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        assert.ok(inViewport(box), `${label}: the ${name} is not wholly on screen ${JSON.stringify(box)}`);
        assert.ok(!hit(box, bar), `${label}: the ${name} is under the SDK toolbar`);
        const points = [];
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) points.push([box.x1 + (box.x2 - box.x1) * i / 4 - origin.x, box.y1 + (box.y2 - box.y1) * j / 4 - origin.y]);
        const covered = await canvas.evaluate((node, list) => list.map(([x, y]) => document.elementFromPoint(x, y)).filter(top => top !== node).map(top => `${top?.tagName}.${top?.className}`), points);
        assert.deepEqual([...new Set(covered)], [], `${label}: game UI covers the ${name}`);
        checked.push(`visible:${name}`);
        return box;
      };
      /** A real swipe: touch events from the ball, up and slightly right, ~180 ms. */
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const touchSwipe = async (dx = 0.3) => {
        const start = await toPage(240, 250);
        const point = i => ({ x: start.x + i * dx * 12 * start.scale, y: start.y - i * 12 * start.scale, id: 1, radiusX: 4, radiusY: 4, force: 1 });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
        for (let i = 1; i <= 9; i++) { await page.waitForTimeout(18); await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(i)] }); }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };

      // The frame fits the screen: nothing to scroll to.
      const frame = await page.locator(".rf-game-frame").boundingBox();
      assert.ok(frame.y >= 0 && frame.y + frame.height <= height + 0.5 && frame.x >= 0 && frame.x + frame.width <= width + 0.5, `${label}: the game frame does not fit the screen ${JSON.stringify(frame)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, `${label}: the page scrolls`);

      // Rotate card: from the frame's own size (portrait frames only).
      await game.getByTestId("rotate").waitFor({ state: "attached" });
      if (portrait) {
        await game.getByTestId("rotate").waitFor({ state: "visible" });
        assert.match(await game.getByTestId("rotate").textContent(), /Turn your phone sideways/);
        assert.equal(await game.locator(".pk-rotate-phone rect").count() > 5, true, "a pixel-art phone icon");
        await fonts("rotate card");
        await reachable(game.getByTestId("portrait-anyway"), "Play in portrait anyway");
        await page.screenshot({ path: `artifacts/phone-${label}-rotate.png` });
        await game.getByTestId("portrait-anyway").click();
        await game.getByTestId("rotate").waitFor({ state: "hidden" });
      } else assert.equal(await game.getByTestId("rotate").isVisible(), false, `${label}: no rotate card in landscape`);

      // Title: the cold open (showreel) and the attract card.
      await fonts("title (cold open)");
      await reachable(game.getByTestId("play"), "Kick off");
      if (await game.getByTestId("skip-intro").isVisible()) {
        await reachable(game.getByTestId("skip-intro"), "Skip intro");
        await game.getByTestId("skip-intro").click();
        await fonts("title (attract)");
        await reachable(game.getByTestId("play"), "Kick off");
      }
      await press(game.getByTestId("play"));

      // Tutorial: HUD chips, pot banner, coaching toast; the goal and the ball; Quick shot and Menu.
      await game.getByTestId("pot").waitFor();
      await waitShootable();
      await sceneVisible(GOAL, "goal");
      await sceneVisible(BALL, "ball");
      await fonts("tutorial HUD");
      await reachable(game.getByTestId("quick"), "Quick shot");
      await reachable(game.getByTestId("menu"), "Menu");
      const before = (await game.locator("body").evaluate(() => window.__pkStats())).shots;
      await touchSwipe(0.3);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      const banner = await game.locator(".pk-banner strong").textContent();
      assert.match(banner, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!/);
      assert.equal((await game.locator("body").evaluate(() => window.__pkStats())).shots, before + 1, "the swipe produced exactly one kick");
      assert.equal(await game.getByTestId("round").getAttribute("data-kicks"), "1");
      checked.push(`swipe:${banner}`);
      await fonts("kick banner");
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      await waitShootable();
      await fonts("after the kick (discovery toast)");
      await page.screenshot({ path: `${OUT}/phone-${label}.png` });
      // Kicks 2 and 3 with Quick shot (a tap), then the results.
      for (let kick = 2; kick <= 3; kick++) {
        await waitShootable();
        await reachable(game.getByTestId("quick"), "Quick shot");
        await press(game.getByTestId("quick"));
        await game.locator(".pk-banner").waitFor({ timeout: 8000 });
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      }
      await game.getByTestId("results").waitFor({ timeout: 10_000 });
      await fonts("results");
      await game.getByRole("button", { name: "Close" }).first().click();
      await reachable(game.getByTestId("menu"), "Menu");
      await press(game.getByTestId("menu"));
      await fonts("menu hub");
      await game.getByRole("button", { name: "Change mode", exact: true }).click();
      await fonts("mode select");

      // Big Match: buy a 2-ball pack, open it (pack opening overlay), reveal, kick, then the ball carousel.
      await game.getByTestId("ball-shop").click();
      await fonts("ball shop");
      await game.getByTestId("pack-2").click();
      await game.getByTestId("buy-pack").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText("2 balls bought.").waitFor();
      await game.getByTestId("open-pack").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByTestId("pack").waitFor({ timeout: 10_000 });
      await fonts("pack opening");
      await page.screenshot({ path: `artifacts/phone-${label}-pack.png` });
      await reachable(game.getByTestId("reveal-all"), "Reveal all");
      await reachable(game.locator(".pk-card").first(), "pack card");
      await press(game.getByTestId("reveal-all"));
      await game.getByTestId("pack-summary").waitFor();
      await fonts("pack summary");
      await reachable(game.getByTestId("to-bag"), "Go to my Bag");
      await press(game.getByTestId("to-bag"));
      await fonts("bag");
      await game.getByTestId("ball").first().getByTestId("shoot-ball").click();
      await waitShootable();
      await sceneVisible(GOAL, "goal (Big Match)");
      await sceneVisible(BALL, "ball (Big Match)");
      await fonts("Big Match HUD");
      await reachable(game.getByTestId("change-ball"), "Change ball");
      await reachable(game.getByTestId("quick"), "Quick shot");
      await reachable(game.getByTestId("menu"), "Menu");
      await touchSwipe(-0.3);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      await game.getByTestId("round").and(game.locator('[data-kicks="1"]')).waitFor({ timeout: 8000 });
      await waitShootable();
      await press(game.getByTestId("change-ball"));
      await game.getByTestId("carousel").waitFor({ timeout: 5000 });
      await fonts("ball carousel");
      await reachable(game.getByTestId("kick-with-ball"), "Kick with this ball");
      await reachable(game.getByRole("button", { name: "Close", exact: true }), "carousel Close");
      await page.screenshot({ path: `artifacts/phone-${label}-carousel.png` });
      await press(game.getByRole("button", { name: "Close", exact: true }));
      await waitShootable();
    },
  });
  assert.deepEqual(errors.filter(e => !/favicon/.test(e)), [], `console errors: ${errors.join("\n")}`);
  console.log(`PASS phone ${label} (${portrait ? "portrait, after the rotate card" : "landscape"}): ${checked.length} checks — ${checked.filter(c => c.startsWith("swipe")).join(", ")}`);
}
console.log(`PASS phone layouts: ${SIZES.map(s => s.join("x")).join(", ")}; screenshots in ${OUT}/`);
