// Interaction test with the SDK's mock wallet (preview): title → tutorial (3 swipes) → results →
// Big Match: buy → place (play + settle) → TRUE reveal → kick. Also asserts that no HUD/pot/action
// element overlaps the goal mouth or the striker, and records frame times.
// Usage: node scripts/test-game.mjs [--width 360] [--screenshot path]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { playInPortraitIfAsked } from "./lib/phone.mjs";

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
    await playInPortraitIfAsked(game); // 360 × 800 is a portrait phone: "Play in portrait anyway" (R6-B7)
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
      const boxes = await game.locator(".pk-hud .pk-stat, .pk-hud .pk-chip, .pk-pot, .pk-actions button, .pk-discover").evaluateAll(nodes => nodes.filter(n => n.offsetParent).map(n => { const r = n.getBoundingClientRect(); return { name: n.textContent.slice(0, 24), x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; }));
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

    // C3c: the title carries the pot (not the HUD banner), the Cup draw countdown, the Champions Night strip and
    // last week's winners, all labelled SIMULATED in the preview. C3b: outside Champions Night the stadium looks like its tier.
    {
      const counter = game.getByTestId("pot-counter");
      if (await game.getByTestId("skip-intro").isVisible()) {
        assert.equal(await counter.isVisible(), false, "B8: the cold open stays decluttered");
        await game.getByTestId("skip-intro").click();
      }
      await counter.waitFor();
      assert.equal(await counter.getAttribute("data-place"), "title");
      assert.equal(await counter.getAttribute("data-tag"), "SIMULATED");
      assert.match(await counter.innerText(), /GOLDEN BOOT CUP[\s\S]*🏆 [\d,]+ RF[\s\S]*SIMULATED/);
      assert.match(await game.getByTestId("cup-draw").innerText(), /^Cup draw in (\d+d \d+h|\d+h \d+m|\d+m)$/);
      assert.match(await game.getByTestId("champions-night").innerText(), /^(Champions Night in (\d+d \d+h|\d+h \d+m|\d+m)|CHAMPIONS NIGHT · double Cup points · ends in .+)$/);
      assert.equal(await game.getByTestId("pot").isVisible(), false, "the HUD pot banner waits for play (the title has its own pot line)");
      const winners = await game.getByTestId("winners").innerText();
      assert.match(winners, /LAST WEEK[\s\S]*SIMULATED/); assert.match(winners, /#1 Friend #\d{4}\s+[\d,]+ RF/);
      const now = new Date(), night = now.getUTCDay() === 6 && now.getUTCHours() >= 19 && now.getUTCHours() < 21;
      assert.equal((await game.locator("body").evaluate(() => window.__pkStats())).stadium, night ? "champions" : "park", "the Park look outside Champions Night");
      // QA-7: no canvas SCORE box behind the title card (it belongs to a session).
      await game.locator("body").evaluate(() => new Promise(requestAnimationFrame));
      assert.equal((await game.locator("body").evaluate(() => window.__pkStats())).scoreboard, false, "no SCORE box on the title");
      console.log(`title pot line: ${(await counter.innerText()).replace(/\s+/g, " ")}`);
    }
    // Polish: canvas headings (CLANG! / SO CLOSE! / HAT-TRICK! chips, the reveal's SCUFFED BALL banner) use the
    // heading face, whose C is not an O. Rendered in the game's own document, at the sizes the Stage draws C in.
    {
      const face = readFileSync(new URL("../games/penalty-kings/gfx/core.ts", import.meta.url), "utf8").match(/export const HEAD_FACE = "([^"]+)"/)?.[1];
      assert.ok(face, "gfx/core.ts exports HEAD_FACE");
      const fonts = [16, 12, 11, 10].map(px => `${px}px ${face}`).concat(["bold 16px PixelifySans, monospace"]);
      const diff = await game.locator("body").evaluate(async (_body, fonts) => {
        const out = {};
        for (const font of fonts) {
          await document.fonts.load(font, "CO");
          const mask = ch => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
            const c = canvas.getContext("2d"); c.font = font; c.textBaseline = "middle"; c.fillStyle = "#fff"; c.fillText(ch, 4, 16);
            const data = c.getImageData(0, 0, 32, 32).data, bits = [];
            for (let i = 3; i < data.length; i += 4) bits.push(data[i] > 127);
            return bits;
          };
          const cm = mask("C"), om = mask("O");
          let xor = 0, union = 0; cm.forEach((on, i) => { if (on !== om[i]) xor++; if (on || om[i]) union++; });
          out[font] = union ? xor / union : 0;
        }
        return out;
      }, fonts);
      for (const font of fonts.slice(0, 4)) assert.ok(diff[font] >= 0.2, `C and O differ in ${font}: ${(diff[font] * 100).toFixed(0)} % of their pixels`);
      console.log(`C vs O pixel difference: ${Object.entries(diff).map(([f, d]) => `${f.split(",")[0]} ${(d * 100).toFixed(0)}%`).join(" · ")}`);
    }
    // Title → modes → Penalties (first time = tutorial).
    await game.getByTestId("play").click(); // first session: "Kick off" goes straight into the coached tutorial
    await game.getByTestId("pot").waitFor();
    assert.equal(await game.getByTestId("pot").getAttribute("data-tag"), "SIMULATED", "pot banner is tagged SIMULATED in the preview");
    assert.match(await game.getByTestId("pot-age").innerText(), /^(on-chain snapshot|snapshot)$/, "the USD figure says where its price comes from");
    assert.ok(await game.getByTestId("pot-age").isVisible(), "the price tag is visible next to the USD value");
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
    // B4: digits resolve to the Departure Mono digit face (unicode-range on the PixelifySans family), not Pixelify's S-like 5s.
    {
      const fonts = await game.getByTestId("pot").evaluate(async node => {
        const doc = node.ownerDocument, span = doc.createElement("span");
        span.textContent = "20 RF · 500,000 · 31.5% · ×2"; span.style.cssText = "font-size:13px"; node.closest(".pk").appendChild(span);
        await doc.fonts.load("13px PixelifySans", "0123456789"); await doc.fonts.load("700 13px PixelifySans", "0123456789"); await doc.fonts.ready;
        const family = getComputedStyle(span).fontFamily; span.remove();
        const digitFace = [...doc.fonts].find(face => face.family.replace(/"/g, "") === "PixelifySans" && /U\+30-39/i.test(face.unicodeRange));
        const width = ch => { const c = doc.createElement("canvas").getContext("2d"); c.font = "20px PixelifySans"; return c.measureText(ch).width; };
        return { family, checked: doc.fonts.check("13px PixelifySans", "0123456789") && doc.fonts.check("700 13px PixelifySans", "0123456789"),
          digitFace: digitFace ? { range: digitFace.unicodeRange, status: digitFace.status } : null,
          tabular: new Set([..."0123456789"].map(width)).size === 1, letterWidth: width("S") !== width("5") };
      });
      assert.match(fonts.family, /^PixelifySans\b/, `numeric span font-family: ${fonts.family}`);
      assert.ok(fonts.digitFace && fonts.digitFace.status === "loaded", `the digit face is loaded: ${JSON.stringify(fonts.digitFace)}`);
      assert.ok(fonts.checked, "document.fonts.check: every face needed to draw the digits is loaded");
      assert.ok(fonts.tabular, "digits are tabular (Pixelify's 1 is narrower than its other digits: the override is not in use)");
      assert.ok(fonts.letterWidth, "letters are not drawn by the monospaced digit face");
      console.log(`digit font: ${fonts.digitFace.range} (${fonts.digitFace.status}), tabular`);
    }
    assert.deepEqual(await overlaps(), [], "no UI over the goal or striker (tutorial)");
    // BQ-P1-11: the commentator strip (Stage.drawCommentary, 22 logical px tall at canvas[data-commentary-top]) never sits under the pot banner.
    {
      const canvasNode = game.locator("canvas.pk-canvas"), box = await canvasNode.boundingBox(), pot = await game.getByTestId("pot").boundingBox();
      const logicalTop = Number(await canvasNode.getAttribute("data-commentary-top"));
      const scale = Math.min(box.width / 480, box.height / 320), stripTop = box.y + (box.height - 320 * scale) / 2 + logicalTop * scale;
      const centre = box.x + box.width / 2, across = pot.x < centre + 130 * scale && pot.x + pot.width > centre - 130 * scale;
      assert.ok(Number.isFinite(logicalTop), "the shell reports the commentator strip position");
      assert.ok(!across || pot.y + pot.height <= stripTop + 1, `pot banner (bottom ${Math.round(pot.y + pot.height)}) covers the commentator strip (top ${Math.round(stripTop)}) at ${width}px`);
    }
    for (let kick = 1; kick <= 3; kick++) {
      await waitShootable();
      await swipe(kick === 2 ? -0.4 : 0.4);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      const banner = await game.locator(".pk-banner strong").textContent();
      assert.match(banner, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!/);
      console.log(`tutorial kick ${kick}: ${banner}`);
      if (kick === 1) {
        // SIO-4: the first Director moment ever seen shows a small "NEW: …!" toast; it never covers the goal, the striker or the HUD.
        const toast = game.getByTestId("discover-toast");
        await toast.waitFor({ timeout: 5000 });
        assert.match(await toast.textContent(), /^NEW: .+!$/);
        assert.deepEqual(await overlaps(), [], "the discovery toast overlaps nothing (goal, striker, HUD, pot, actions)");
        console.log(`discovery toast: ${await toast.textContent()}`);
      }
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    assert.match(await game.getByTestId("results").textContent(), /Tutorial complete/);
    // SIO-2: the keeper-unlock card (flips into the Scouting Book); Free Kicks is named in the Level 2 unlock title.
    // QA-2: the NEXT GOAL button is the one "what next", so no separate Free Kicks teaser contradicts it.
    assert.match(await game.getByTestId("unlock-card").textContent(), /New rival scouted: Octavia!/);
    assert.match(await game.getByTestId("results").locator("h3").textContent(), /Level 2: Free Kicks/);
    assert.equal(await game.getByTestId("teaser").count(), 0);
    // SIO-4: the Scouting Book's Discovery meter.
    // C3c: Results shows the pot and "Your Cup entries this week" (preview: from the simulated race table).
    assert.equal(await game.getByTestId("results").getByTestId("pot-counter").getAttribute("data-place"), "results");
    assert.match(await game.getByTestId("cup-entries").innerText(), /^Your Cup entries this week: [\d,]+ · .+ SIMULATED$/);
    await game.getByTestId("open-book").click();
    const meter =await game.getByTestId("discovery").textContent();
    assert.match(meter, /^Seen \d+\/60 moments · \d+\/12 keepers · 1\/3 stadiums$/);
    assert.ok(Number(/Seen (\d+)/.exec(meter)[1]) >= 1 && Number(/(\d+)\/12 keepers/.exec(meter)[1]) >= 3, `discovery after the first session: ${meter}`);
    console.log(`scouting book: ${meter}`);
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    await button("Change mode").click();

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
    // C3b: Pro and Champions are working choices: one line of Cup points per ball, and "Play at …" asks the host page
    // (outside the allow-scripts sandbox) to open that stadium's own page; the preview labels it SIMULATED.
    assert.match(await game.getByTestId("race-park").innerText(), /^Cup points ×1 per ball/);
    assert.match(await game.getByTestId("race-pro").innerText(), /^Cup points ×(100|200) per ball/);
    assert.match(await game.getByTestId("race-champions").innerText(), /^Cup points ×(1,000|2,000) per ball/);
    assert.match(await game.getByTestId("stadium-rule").innerText(), /same Golden Boot Cup/);
    assert.equal(await game.getByTestId("go-park").count(), 0, "no button for the stadium you are in");
    assert.match(await game.getByTestId("go-champions").innerText(), /Play at Champions[\s\S]*\/champions\/ · SIMULATED/);
    await page.evaluate(() => { window.__pkAsked = []; addEventListener("message", event => { if (event.data?.type === "penalty-kings:open-stadium") window.__pkAsked.push(event.data.stadium); }); });
    await game.getByTestId("go-pro").click();
    await page.waitForFunction(() => window.__pkAsked.length > 0);
    assert.deepEqual(await page.evaluate(() => window.__pkAsked), ["pro"], "the game asked its host page for the Pro page");
    assert.match(await game.locator(".pk-warn").first().innerText(), /Opening the Pro stadium page \(simulated preview\)/);
    await game.getByTestId("pack-2").click();
    // D21: the odds are printed on every pack (shop and opening), and they are the definition's exact chances.
    const oddsText = await game.getByTestId("odds-line").first().textContent();
    const shown = [...oddsText.matchAll(/([\d.]+)%/g)].map(match => Number(match[1]));
    assert.equal(shown.length, 7, `seven rarities on the odds line: ${oddsText}`);
    assert.equal(Math.round(shown.reduce((sum, value) => sum + value, 0) * 100), 10_000, "odds line sums to 100%");
    assert.match(oddsText, /Golden Boot 1%/);
    await game.getByTestId("buy-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByText("2 balls bought.").waitFor();
    await game.getByTestId("open-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByTestId("pack").waitFor({ timeout: 10_000 });
    // QA-7: the pack reveal (opened from the Ball shop, no session) shows no stale SCORE box from the tutorial.
    assert.equal((await game.locator("body").evaluate(() => window.__pkStats())).scoreboard, false, "no stale SCORE box during the pack reveal");
    assert.match(await game.getByTestId("pack").textContent(), /Rarity decided by/);
    assert.match(await game.getByTestId("pack").getByTestId("odds-line").textContent(), /Odds per ball:.*Golden Boot 1%/, "odds printed on the pack being opened");
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
