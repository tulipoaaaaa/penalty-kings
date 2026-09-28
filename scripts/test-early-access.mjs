// EARLY ACCESS preset, end to end (docs/EARLY-ACCESS.md).
//  1. Builds site-ea/ (npm run build:site:ea) and checks it: no dev code or QA hooks, every link resolves, each stadium
//     rolls with the preview Friend's rated odds (Gen 3: 93.00%), no challenge box on the host pages, practice copy.
//  2. Plays the early access game in the SDK's real sandboxed runtime (mock wallet, SIMULATED economy) at 960 px and
//     360 px: only the four features are reachable (balls, Practice, Daily Challenge, Scouting Book), every button
//     leads somewhere visible (no dead ends), NEXT GOAL and Results point only at visible modes, the Ball shop shows the
//     player's rating and the exact per-Friend odds, and a pack is bought, opened and a ball redeemed.
// Usage: node scripts/test-early-access.mjs [--width 960|360] (default: both)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, rm, copyFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { installPreset } from "./lib/preset.mjs";
import { brokenLinks } from "./lib/site-links.mjs";
import { exposedQaHooks } from "./lib/qa-hooks.mjs";

installPreset("early-access"); // before the SDK testing harness is imported: its build compiles the early access regions
const { testGame } = await import("@rarefriends/friendsdk/testing");
const { installPriceFixture } = await import("./lib/price-fixture.mjs");
const { playInPortraitIfAsked } = await import("./lib/phone.mjs");

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2), only = Number(args[args.indexOf("--width") + 1] || 0) || null;
const config = JSON.parse(await readFile(join(ROOT, "games/penalty-kings/config/ratings.json"), "utf8"));
const GEN = config.previewGeneration, RATING = `${config.generations[GEN].toFixed(2)}%`;
const rated = JSON.parse(await readFile(join(ROOT, `games/penalty-kings/tiers/ratings/park-gen-${GEN}.json`), "utf8"));
const CHANCES = rated.outcomes.map(outcome => outcome.chanceBps);
/** Words that name a hidden feature (Golden Boot BALL is a rarity; the Golden Boot CUP is hidden). */
const HIDDEN = /Free Kicks?\b|World Tour|Target Practice|Skill Cup|Kit shop|Golden Boot Cup|\bCups\b|Champions Night|Keeper of the Week|challenge code|Wildcard|\$GBOOT|Market \(coming soon\)/i;

// ── 1. The static early access site ─────────────────────────────────────────────────────────────────────────────
execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { cwd: ROOT, env: { ...process.env, PK_PRESET: "early-access" }, stdio: "inherit" });
{
  const SITE = join(ROOT, "site-ea"), problems = [];
  const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) { await walk(path); continue; }
    if (!/\.(html|js|css)$/.test(entry.name)) continue; const text = await readFile(path, "utf8");
    for (const marker of ["isPenaltyKingsDevWallet", "DEV mock wallet", "DEV SHOWROOM", "mock-wallet"]) if (text.includes(marker)) problems.push(`${path}: ${marker}`);
    for (const hook of exposedQaHooks(text)) problems.push(`${path}: QA hook ${hook}`); } };
  await walk(SITE);
  for (const link of brokenLinks(SITE)) problems.push(`broken link ${link}`);
  assert.deepEqual(problems, [], "site-ea/ is publishable");
  for (const [tier, dir] of [["park", ""], ["pro", "pro/"], ["champions", "champions/"]]) {
    const runtime = await readFile(join(SITE, dir, "runtime.js"), "utf8"), def = JSON.parse(await readFile(join(ROOT, `games/penalty-kings/tiers/ratings/${tier}-gen-${GEN}.json`), "utf8"));
    assert.ok(runtime.includes(`price:"${def.price}"`), `${tier}: rated price`);
    for (const outcome of def.outcomes) assert.ok(runtime.includes(`chanceBps:${outcome.chanceBps}`), `${tier}: rolls with the Gen ${GEN} chance ${outcome.name} ${outcome.chanceBps}`);
    const html = await readFile(join(SITE, dir, "index.html"), "utf8");
    assert.ok(html.includes("EARLY ACCESS · SIMULATED preview"), `${tier}: labelled`);
    assert.ok(!html.includes("pk-challenge\""), `${tier}: no challenge box (challenge codes are hidden)`);
  }
  const practice = await readFile(join(SITE, "practice/index.html"), "utf8");
  assert.doesNotMatch(practice, /World Tour|free kicks|for the pot/, "the practice page names only early access features");
  assert.match(practice, /Open the early access game/);
  console.log(`PASS site-ea/: publishable, every stadium rolls at Gen ${GEN} (${RATING}), no challenge box, practice copy`);
}

// ── 2. The early access game in the real SDK runtime ────────────────────────────────────────────────────────────
// The SDK test harness builds a game DIRECTORY; this one is the game with the preview Friend's rated Park odds.
const GAME = join(ROOT, ".build-ea-test/penalty-kings");
await rm(join(ROOT, ".build-ea-test"), { recursive: true, force: true });
await cp(join(ROOT, "games/penalty-kings"), GAME, { recursive: true, filter: source => !source.includes(".friendsdk") });
await copyFile(join(ROOT, `games/penalty-kings/tiers/ratings/park-gen-${GEN}.json`), join(GAME, "game.json"));
installPriceFixture();

async function run(width) {
  const errors = [];
  await testGame(GAME, {
    width, timeout: 60_000,
    check: async ({ page, game }) => {
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await playInPortraitIfAsked(game);
      const button = name => game.getByRole("button", { name, exact: true });
      const text = () => game.locator("body").innerText();
      const noHidden = async where => { const body = await text(); const hit = body.match(HIDDEN); assert.equal(hit, null, `${where} names a hidden feature: "${hit?.[0]}"`); };
      const closeMenu = async () => { await game.getByRole("button", { name: "Close" }).first().click(); };
      const canvas = game.locator("canvas.pk-canvas");
      const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
      const swipe = async (dx = 0.35) => {
        const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
        const x = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
        await page.mouse.move(x, y); await page.mouse.down();
        for (let i = 1; i <= 9; i++) { await page.mouse.move(x + i * dx * 12 * scale, y - i * 12 * scale); await page.waitForTimeout(18); }
        await page.mouse.up();
      };
      /** Tap targets ≥ 44 px and text ≥ 11 px inside a container (the rules for every screen). */
      const sizes = async (selector, where) => {
        const bad = await game.locator(selector).first().evaluate(root => {
          const out = [];
          for (const el of root.querySelectorAll("button, a, select, input")) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.height < 44 && r.width > 0) out.push(`tap ${Math.round(r.height)}px: ${el.textContent.trim().slice(0, 30)}`); }
          const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) { const el = node.parentElement; if (!node.textContent.trim() || !el?.offsetParent) continue; const px = parseFloat(getComputedStyle(el).fontSize); if (px < 11) out.push(`text ${px}px: ${node.textContent.trim().slice(0, 30)}`); }
          return out;
        });
        assert.deepEqual(bad, [], `${where}: tap ≥ 44 px, text ≥ 11 px`);
      };

      // Title: no Cup pot, no winners ticker; the preview says what is simulated.
      if (await game.getByTestId("skip-intro").isVisible()) await game.getByTestId("skip-intro").click();
      await game.getByTestId("play").waitFor();
      assert.equal(await game.getByTestId("pot-counter").count(), 0, "no Cup pot on the title");
      assert.equal(await game.getByTestId("winners").count(), 0, "no winners ticker");
      assert.match(await text(), /Early access preview: the economy \(RF, balls, redeem values\) is SIMULATED/);
      await noHidden("title");

      // Practice (in game): the tutorial, then Results that unlock only visible modes.
      await game.getByTestId("play").click();
      await waitShootable();
      assert.equal(await game.getByTestId("pot").count(), 0, "no Cup pot banner on the HUD");
      for (let kick = 1; kick <= 3; kick++) {
        await waitShootable(); await swipe(kick === 2 ? -0.4 : 0.4);
        await game.locator(".pk-banner").waitFor({ timeout: 8000 });
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      }
      const results = game.getByTestId("results");
      await results.waitFor({ timeout: 10_000 });
      assert.equal(await results.locator("h3").first().textContent(), "Tutorial complete! Level 2: Daily Challenge unlocked");
      assert.equal(await game.getByTestId("results-cup").count(), 0, "Results: no Cup pot or entries");
      assert.equal(await game.getByTestId("share-panel").count(), 0, "Results: no share card (challenge links are hidden)");
      const goal = game.getByTestId("results-next-goal");
      if (await goal.count()) assert.ok(["penalties", "daily"].includes(await goal.getAttribute("data-mode")), "Results NEXT GOAL points at a visible mode");
      await noHidden("tutorial Results");
      await button("Modes").click();

      // Modes screen: exactly Practice, Daily Challenge and Big Match; menus for the four features (+ Rules, Settings).
      await game.locator(".pk-modescreen").waitFor();
      const modes = await game.locator(".pk-modes [data-testid^=mode-]").evaluateAll(nodes => nodes.map(n => [n.dataset.testid, n.querySelector("strong").textContent, n.disabled]));
      assert.deepEqual(modes, [["mode-penalties", "Practice", false], ["mode-daily", "Daily Challenge", false], ["mode-match", "Big Match", false]], "the tutorial XP opened the Daily Challenge; nothing else is listed");
      assert.deepEqual(await game.getByTestId("modes-menus").locator("button").allTextContents(), ["Scouting Book", "Ball shop", "My Bag", "Rules", "Settings"]);
      for (const gone of ["weekly-keeper", "challenge-box", "pot-counter", "winners"]) assert.equal(await game.getByTestId(gone).count(), 0, `modes screen: no ${gone}`);
      const next = game.getByTestId("next-goal");
      assert.ok(["penalties", "daily"].includes(await next.getAttribute("data-mode")), "NEXT GOAL points at a visible mode");
      await noHidden("modes screen");
      await sizes(".pk-modescreen", "modes screen");
      // No dead ends: every menu on the modes screen opens a real screen that names no hidden feature, and closes.
      for (const name of ["Scouting Book", "Rules", "Settings", "My Bag"]) {
        await game.getByTestId("modes-menus").getByRole("button", { name, exact: true }).click();
        await game.locator(".rf-frame-menu").waitFor();
        assert.ok((await game.locator(".rf-frame-menu").innerText()).trim().length > 40, `${name} has content`);
        await noHidden(name);
        await closeMenu();
      }
      // NEXT GOAL leads somewhere real (Practice or the Daily Challenge).
      const nextMode = await next.getAttribute("data-mode");
      await next.click();
      if (nextMode === "daily") { await game.getByRole("button", { name: "Play today's challenge" }).waitFor(); await closeMenu(); }
      else { await waitShootable(); await game.getByTestId("menu").click(); await button("Change mode").click(); }
      await game.locator(".pk-modescreen").waitFor();

      // Daily Challenge: its own card, no share card.
      await game.getByTestId("mode-daily").click();
      await game.getByRole("button", { name: "Play today's challenge" }).waitFor();
      assert.equal(await game.getByTestId("share-panel").count(), 0);
      await noHidden("Daily Challenge");
      await closeMenu();

      // Ball shop: the player's rating and the exact per-Friend odds.
      await game.getByTestId("ball-shop").click();
      const panel = game.getByTestId("rating-panel");
      await panel.waitFor();
      assert.equal(await game.getByTestId("rating-value").textContent(), RATING);
      assert.match(await game.getByTestId("rating-friend").innerText(), new RegExp(`Gen ${GEN}[\\s\\S]*SIMULATED`));
      assert.deepEqual(await game.getByTestId("rating-table").locator("td").allTextContents(), ["Rating (payout rate)", ...[1, 2, 3, 4, 5, 6].map(gen => `${config.generations[gen].toFixed(2)}%`)]);
      const oddsLine = await game.getByTestId("odds-line").first().textContent();
      assert.ok(oddsLine.includes(`Odds per ball (your rating ${RATING}):`), oddsLine);
      assert.deepEqual([...oddsLine.matchAll(/([\d.]+)%/g)].slice(1).map(match => Math.round(Number(match[1]) * 100)), CHANCES, "the odds printed on the pack are the Gen's exact chances");
      assert.match(await game.getByTestId("ea-shop").innerText(), new RegExp(`Average return ${RATING.replace(".", "\\.")}`));
      await noHidden("Ball shop");
      await sizes("[data-testid=ea-shop]", "Ball shop");
      await game.getByTestId("see-odds").click();
      const odds = await game.getByTestId("rating-odds").locator("tbody tr").evaluateAll(rows => rows.map(row => row.children[1].textContent));
      assert.deepEqual(odds, CHANCES.map(chance => `${(chance / 100).toFixed(2)}%`), "Odds screen: exact chances for the player's rating");
      assert.match(await game.locator(".rf-frame-menu").innerText(), new RegExp(`Average return: ${RATING.replace(".", "\\.")}`));
      await noHidden("Odds");
      await closeMenu();

      // Buy a 2-ball pack (the preview wallet holds 20 simulated RF), open it, redeem a ball.
      // The preview's draw is pinned to roll 5700: Match Ball at Gen 3 (Scuffed 2970 + Training 2700 = 5670), but a
      // Training Ball on today's 90% table (3150 + 2700 = 5850): the ball proves the stadium rolls with the rated odds.
      await game.getByTestId("ball-shop").click();
      await game.getByTestId("pack-2").click();
      await game.getByTestId("buy-pack").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText("2 balls bought.").waitFor();
      const pin = `(() => { const real = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = array => { if (array instanceof Uint32Array && array.length === 1) { array[0] = 5700; return array; } return real(array); }; })()`;
      await page.evaluate(pin); await game.locator("body").evaluate(pin);
      await game.getByTestId("open-pack").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByTestId("pack").waitFor({ timeout: 10_000 });
      assert.ok((await game.getByTestId("pack").getByTestId("odds-line").textContent()).includes(`your rating ${RATING}`), "odds printed on the pack being opened");
      await game.getByTestId("reveal-all").click();
      const summary = await game.getByTestId("pack-summary").innerText();
      assert.match(summary, /Spent 20 RF[\s\S]*worth 20 RF/, `two Match Balls (10 RF each): ${summary}`);
      assert.doesNotMatch(summary, /\$GBOOT/);
      await game.getByTestId("to-bag").click();
      assert.equal(await game.getByTestId("ball").count(), 2);
      assert.deepEqual(await game.getByTestId("ball").locator("strong").allTextContents(), ["Match Ball", "Match Ball"]);
      assert.equal(await game.getByRole("button", { name: "Market (coming soon)" }).count(), 0, "Bag: no Market");
      await noHidden("My Bag");
      await game.getByTestId("redeem-ball").first().click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText("Redeemed a Match Ball for 10 RF.").waitFor({ timeout: 10_000 });
      assert.equal(await game.getByTestId("ball").count(), 1, "the redeemed ball left the Bag");

      // Big Match with the other ball: the HUD shows the rating, no Cup pot; the in-game Menu lists only visible screens.
      await game.getByTestId("shoot-ball").first().click();
      await waitShootable();
      assert.equal(await game.getByTestId("hud-rating").textContent(), RATING);
      assert.equal(await game.getByTestId("pot").count(), 0);
      await game.getByTestId("menu").click();
      assert.deepEqual(await game.locator(".pk-hub > button").allTextContents(), ["Ball shop", "My Bag", "Scouting Book", "Rules", "Settings", "Change mode"]);
      await noHidden("in-game Menu");
      await button("Change mode").click();
      await game.locator(".pk-modescreen").waitFor();
      // Practice mode itself: a free round, chip PRACTICE.
      await game.getByTestId("mode-penalties").click();
      await waitShootable();
      assert.equal(await game.getByTestId("mode-chip").textContent(), "PRACTICE");
      console.log(`PASS early access at ${width}px: only balls, Practice, Daily Challenge, Scouting Book; rating ${RATING} and Gen ${GEN} odds shown; pack bought, opened (2 Match Balls) and one redeemed`);
    },
  });
  assert.deepEqual(errors.filter(e => !/favicon/.test(e)), [], `console errors: ${errors.join("\n")}`);
}

try { for (const width of only ? [only] : [960, 360]) await run(width); }
finally { await rm(join(ROOT, ".build-ea-test"), { recursive: true, force: true }); }
console.log("PASS test:early-access");
