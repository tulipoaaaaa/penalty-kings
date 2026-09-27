// Action-flow audit in the real sandboxed runtime (bug round 3). Tries the awkward interleavings a
// player can produce and asserts exactly one kick (or none) each time. The pure state machine is
// tested exhaustively in tests/game/flow.test.ts; this proves the shell obeys it.
// Usage: node scripts/test-flow.mjs [--width 960]
import assert from "node:assert/strict";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { playInPortraitIfAsked } from "./lib/phone.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const errors = [];
const results = [];
const ok = name => { results.push(name); console.log(`  ✓ ${name}`); };
/** Save-code helpers (game/savecode.ts format): CRC-32 over "friendId:payload", payload = base64url JSON. */
const crc32 = text => { let crc = ~0; for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (~crc >>> 0).toString(16).padStart(8, "0"); };
const editSaveCode = (code, friendId, change) => {
  const [prefix, payload] = code.trim().split(".");
  const next = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ...change }), "utf8").toString("base64url");
  return `${prefix}.${next}.${crc32(`${friendId}:${next}`)}`;
};

// UI Bug Quest P2 (a fresh visit: 20 simulated RF, an empty Bag). `--p2-only` stops after this run.
await testGame("./games/penalty-kings", {
  width, timeout: 90_000,
  check: async ({ page, game }) => {
    await playInPortraitIfAsked(game);
    page.on("pageerror", error => errors.push(String(error)));
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const stats = () => game.locator("body").evaluate(() => window.__pkStats());
    const quickKick = async () => { await waitShootable(); await game.getByTestId("quick").click(); await game.locator(".pk-banner").waitFor({ timeout: 10_000 }); const text = await game.locator(".pk-banner strong").textContent(); await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 }); return text; };
    const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
    if (await game.getByTestId("skip-intro").isVisible()) await game.getByTestId("skip-intro").click();

    // BQ-X7: the tutorial's net-cam replay of the best goal is never under the coaching toast. Kick 1 goes top right
    // against the mouse (he never saves a top bin), so there is a goal to replay after kick 3.
    await game.getByTestId("play").click();
    await waitShootable();
    await hold("ArrowRight", 250); await hold("ArrowUp", 600);
    const tutorial = [await quickKick(), await quickKick()];
    const replaysBefore = (await stats()).replays; console.log(`  tutorial: ${tutorial.join(", ")}`);
    await waitShootable(); await game.getByTestId("quick").click();
    await game.locator("body").evaluate((_, before) => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkStats().replays > before ? resolve(true) : Date.now() - start > 8000 ? reject(new Error("no net-cam replay")) : setTimeout(poll, 20)); poll(); }), replaysBefore);
    assert.equal(await game.locator(".pk-toast").isVisible(), false, "no coaching toast over the net-cam replay");
    await game.getByTestId("results").waitFor({ timeout: 15_000 });
    ok("BQ-X7: the tutorial's net-cam replay plays with no coaching toast over it");
    await game.getByRole("button", { name: "Modes", exact: true }).click();

    // The Kit shop and the Rules are one tap from the modes screen (≥ 44 px targets).
    const modes = game.locator(".pk-modescreen");
    for (const name of ["Kit shop", "Rules"]) {
      assert.equal(await modes.getByRole("button", { name, exact: true }).count(), 1, `${name} on the modes screen`);
      const box = await modes.getByRole("button", { name, exact: true }).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${name} on the modes screen, ≥ 44 px (${box && `${box.width}×${box.height}`})`);
    }
    ok("Kit shop and Rules on the modes screen, ≥ 44 px");
  },
});
if (args.includes("--p2-only")) { assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`); console.log(`PASS UI Bug Quest P2 at ${width}px`); process.exit(0); }

await testGame("./games/penalty-kings", {
  width, timeout: 90_000,
  check: async ({ page, game, friendId }) => {
    await playInPortraitIfAsked(game); // 360 × 800 is a portrait phone: "Play in portrait anyway" (R6-B7)
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

    // 0. Sound (B3): a visible ≥ 44 px toggle on the title and in the HUD; the first gesture turns sound on,
    //    an explicit mute is respected afterwards.
    const toggle = game.getByTestId("sound-toggle"), soundState = () => toggle.getAttribute("data-sound");
    const bigEnough = async where => { const b = await toggle.boundingBox(); assert.ok(b && b.width >= 44 && b.height >= 44, `${where}: sound toggle is ≥ 44 px (${b && `${b.width}×${b.height}`})`); };
    assert.equal(await toggle.count(), 1, "one sound toggle on the title");
    await bigEnough("title");
    if (width > 600) assert.equal(await soundState(), "off", "silent before any gesture"); // (at 360 px "Play in portrait anyway" was a gesture)
    await game.locator(".pk-attract-top h1").click();
    assert.equal(await soundState(), "on", "the first gesture turns sound on");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await toggle.click();
    assert.equal(await soundState(), "off", "the toggle mutes");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");

    // 1. Shoot during the keeper walkout (tutorial opening): ignored, and the shot clock does not run.
    await game.getByTestId("play").click();
    await page.waitForTimeout(300);
    assert.equal((await flow()).stage, true, "the walkout is a protected moment");
    await swipe();
    await noBanner(600);
    assert.equal(await kicks(), 0);
    ok("swipe during the walkout is ignored");
    assert.equal(await soundState(), "off", "later gestures (Play, the swipe) respect the explicit mute");
    await bigEnough("HUD");
    await toggle.click();
    assert.equal(await soundState(), "on", "the HUD toggle turns sound back on");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    ok("sound toggle: title + HUD, ≥ 44 px, first gesture unmutes, explicit mute respected, flips state");

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

    // 5a. Round 6 C14: no shot clock in the first 3 matches after the tutorial (no bar, no timeout).
    await game.getByTestId("mode-penalties").click();
    await waitShootable();
    assert.equal(await game.getByTestId("shot-clock").isVisible(), false, "no shot-clock bar in the first matches");
    await page.waitForTimeout(6000);
    assert.equal(await game.locator(".pk-banner").count(), 0, "no timeout in the first matches");
    assert.equal(await kicks(), 0);
    ok("first matches after the tutorial: shot clock off");

    // 5a2. BQ-P1-5: Results "XP earned" includes every kick's XP (goals, placement, Skill Zones), and a level
    //      reached mid-session shows under "Unlocked". Start 1 XP short of level 3 (save code), kick 5 at a corner.
    const hudXp = async () => {
      const [, level, into] = (await game.locator(".pk-hud-left .pk-stat").textContent()).match(/LV\s*(\d+)\s*·\s*(\d+)\//);
      return 100 * Number(level) * (Number(level) - 1) / 2 + Number(into); // levelFromXp: 100, 200, 300 … per level
    };
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Settings", exact: true }).click();
    await game.getByTestId("save-code-in").fill(editSaveCode(await game.getByTestId("save-code-out").inputValue(), friendId, { xp: 299 }));
    await game.getByTestId("save-code-restore").click();
    await game.getByTestId("save-code-note").filter({ hasText: /restored/ }).waitFor();
    await game.getByRole("button", { name: "Close" }).first().click();
    await waitShootable();
    const xpBefore = await hudXp();
    assert.equal(xpBefore, 299, "1 XP short of level 3");
    let goals5a2 = 0;
    for (let kick = 0; kick < 5; kick++) {
      await waitShootable();
      if (kick === 0) { // aim high to the right (kept between kicks): 0.5 → ~0.8 across, ~0.85 up
        await page.keyboard.down("ArrowRight"); await page.waitForTimeout(250); await page.keyboard.up("ArrowRight");
        await page.keyboard.down("ArrowUp"); await page.waitForTimeout(600); await page.keyboard.up("ArrowUp");
      }
      await game.getByTestId("quick").click();
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      if (/GOAL/.test(await game.locator(".pk-banner strong").textContent())) goals5a2++;
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    const resultsText = await game.getByTestId("results").textContent();
    const resultsXp = Number(resultsText.match(/\+(\d+)\s*XP earned/)?.[1] ?? 0), xpAfter = await hudXp();
    console.log(`  ${goals5a2} goals · HUD XP ${xpBefore} → ${xpAfter} · Results +${resultsXp}`);
    assert.ok(goals5a2 > 0, "at least one goal (needed for kick XP)");
    assert.equal(resultsXp, xpAfter - xpBefore, "Results XP equals the HUD's XP gain over the session");
    assert.match(resultsText, /Unlocked:\s*Level 3/, "the mid-session level-up shows under Unlocked");
    ok("BQ-P1-5: Results XP == HUD XP gain (kick XP included); mid-session level-up listed");
    await game.getByRole("button", { name: "Play again", exact: true }).click();
    await waitShootable();

    // Restore a save code with 3 matches played after the tutorial, so the clock is on from here.
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Settings", exact: true }).click();
    await game.getByTestId("save-code-in").fill(editSaveCode(await game.getByTestId("save-code-out").inputValue(), friendId, { matches: 4 }));
    await game.getByTestId("save-code-restore").click();
    await game.getByTestId("save-code-note").filter({ hasText: /restored/ }).waitFor();
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Change mode", exact: true }).click();

    // 5b. Penalties (shot clock on, shown as a bar): an open menu freezes the clock; closing it does not time out.
    await game.getByTestId("mode-penalties").click();
    await waitShootable();
    await game.getByTestId("shot-clock").waitFor({ state: "visible", timeout: 2000 });
    await game.getByTestId("menu").click();
    await page.waitForTimeout(6500);
    await game.getByRole("button", { name: "Close" }).first().click();
    await page.waitForTimeout(700);
    assert.equal(await game.locator(".pk-banner").count(), 0, "no TIME! after closing the menu");
    assert.equal(await kicks(), 0);
    ok("menu open for 6.5 s during a 6 s shot clock: no timeout");

    // 5c. Round 6 C14: when the clock runs out the kick is lost OUT LOUD, with a pause before the next kick.
    await game.locator(".pk-banner strong").filter({ hasText: "Time up — kick lost" }).waitFor({ timeout: 8000 }); // C2: the penalty clock is 6 s (was 5 s)
    const lostAt = Date.now();
    await page.waitForTimeout(900);
    assert.equal(await game.locator(".pk-banner strong").textContent(), "Time up — kick lost", "the time-up banner stays up");
    assert.equal((await flow()).shootable, false, "no next kick during the pause");
    await waitShootable();
    assert.ok(Date.now() - lostAt >= 1300, `pause before the next kick (${Date.now() - lostAt} ms)`);
    assert.equal(await kicks(), 1, "the lost kick counts");
    ok("shot clock out: 'Time up — kick lost', a short pause, then the next kick");

    // 5d. BQ-P1-4: "Turn your phone sideways" freezes the shot clock like a pause. Turn to portrait mid-clock
    //     (the card stays up, not dismissed) for 6 s, then back: no kick lost, no "Time up".
    //     (The 360 px run chose "Play in portrait anyway" for the session, so the card cannot come back there.)
    if (width > 700) {
      await waitShootable();
      await game.getByTestId("shot-clock").waitFor({ state: "visible", timeout: 2000 });
      const landscape = page.viewportSize(), before5d = await kicks();
      await page.setViewportSize({ width: 400, height: 820 });
      await game.getByTestId("rotate").waitFor({ state: "visible", timeout: 3000 });
      assert.equal((await flow()).shootable, false, "not shootable behind the rotate card");
      await page.waitForTimeout(6000);
      assert.equal(await game.locator(".pk-banner").count(), 0, "no Time up behind the rotate card");
      await page.setViewportSize(landscape);
      await game.getByTestId("rotate").waitFor({ state: "hidden", timeout: 3000 });
      await waitShootable();
      await page.waitForTimeout(700);
      assert.equal(await game.locator(".pk-banner").count(), 0, "no Time up after turning back");
      assert.equal(await kicks(), before5d, "the kick counter did not change");
      ok("BQ-P1-4: rotate card up for 6 s during a live shot clock: no timeout, no kick lost");
    } else console.log("  (BQ-P1-4 rotate-card clock check runs at 960 px)");

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
    const before8 = await kicks();
    await swipe();
    await page.waitForTimeout(150);
    assert.equal(await game.getByTestId("menu").isDisabled(), true, "Menu disabled mid-kick");
    assert.equal(await game.getByTestId("pot").isDisabled(), true, "pot banner disabled mid-kick");
    await waitIdleKick();
    assert.equal(await kicks(), before8 + 1);
    ok("no menu or mode switch mid-kick");

    // 8b. FD-3b: a simulated randomness wait (dev-only delay, set inside the game frame; the judged default is 0 s).
    //     The shot is committed and the keeper decides: no mode switch (Menu disabled), no result. A pause (the
    //     host's Friend-wallet menu) aborts the wait: nothing is scored, and the same kick is aimed again.
    const setDelay = ms => game.locator("body").evaluate((_, value) => { window.__pkDevRandomnessDelayMs = value; }, ms);
    const waitFor = (want, ms = 4000) => game.locator("body").evaluate((_, [key, value, limit]) => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.()[key] === value ? resolve(true) : Date.now() - start > limit ? reject(new Error(`never ${key}=${value}: ${JSON.stringify(window.__pkFlow?.())}`)) : setTimeout(poll, 40)); poll(); }), [want[0], want[1], ms]);
    await waitShootable();
    const before8b = await kicks();
    await setDelay(5000);
    await swipe();
    await waitFor(["waiting", "penalty"]);
    await game.getByTestId("randomness-wait").waitFor({ timeout: 2000 });
    await page.waitForTimeout(1200);
    assert.equal(await game.getByTestId("menu").isDisabled(), true, "no mode switch while the keeper is deciding");
    assert.equal(await game.locator(".pk-banner").count(), 0, "no result before the beacon");
    assert.equal(await kicks(), before8b);
    await page.getByRole("button", { name: "Open Friend wallet" }).click();
    await waitFor(["waiting", null]);
    assert.equal((await flow()).inFlight, 0, "the pending kick is gone");
    await page.waitForTimeout(4500); // paused past the moment the aborted beacon would have landed (the shot clock is frozen)
    assert.equal(await game.locator(".pk-banner").count(), 0, "the cancelled wait never scores");
    assert.equal(await kicks(), before8b, "no kick recorded");
    await page.getByRole("button", { name: /^Close / }).first().click();
    await waitShootable();
    ok("randomness wait (5 s, simulated): Menu disabled, a pause cancels it, nothing scored");

    // 8c. A 2 s wait that lands: the strike plays once, then back to instant (0 s) for everything else.
    await setDelay(2000);
    await swipe();
    await waitFor(["waiting", "penalty"]);
    await waitIdleKick();
    assert.equal(await kicks(), before8b + 1, "exactly one kick after the beacon");
    await setDelay(0);
    const waited = (await flow()).timing.filter(entry => entry.wait >= 1000);
    assert.ok(waited.length === 1 && waited[0].wait >= 1800, `the waited kick is logged with its wait: ${JSON.stringify(waited)}`);
    ok("randomness wait (2 s, simulated) lands: one strike, one kick");

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
    // The SDK test fixture pins every preview roll to 1500 (a Scuffed Ball, 0 RF). Let the first roll of this pack
    // land on 5000 (a Match Ball, 10 RF) so the Bag holds a redeemable ball for 12b; the rest stay pinned.
    await page.evaluate(() => { const pinned = crypto.getRandomValues.bind(crypto); let once = true; crypto.getRandomValues = array => (once && array instanceof Uint32Array && array.length === 1 ? (once = false, array[0] = 5000, array) : pinned(array)); });
    await setDelay(3000); // FD-3b: the pack stays sealed while its (simulated) roll is on the way
    await game.getByTestId("open-pack").click();
    await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    await game.getByTestId("pack-sealed").waitFor({ timeout: 5000 });
    const sealed = await flow();
    assert.equal(sealed.pack, true); assert.equal(sealed.sealed, true); assert.equal(sealed.shootable, false, "not shootable while the pack is sealed");
    assert.equal(await game.getByTestId("pack").count(), 0, "no card is shown before the roll lands");
    await game.getByTestId("pack").waitFor({ timeout: 10_000 });
    await setDelay(0);
    const during = await flow();
    assert.equal(during.pack, true); assert.equal(during.shootable, false, "not shootable while the pack is open");
    await page.keyboard.down(" "); await page.keyboard.up(" ");
    await noBanner(500);
    ok("no kick while a pack is revealing (keyboard included)");

    // 11b. BQ-P0-1: leave the pack mid-reveal (Menu → Change mode). The pack closes (no soft-lock), and both
    //      Penalties and Big Match start afterwards.
    assert.equal(await game.getByTestId("to-bag").count(), 0, "still mid-reveal");
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Change mode", exact: true }).click();
    await game.getByTestId("mode-penalties").waitFor({ timeout: 3000 });
    await page.waitForTimeout(2500); // past the reveal sequence's timers
    const left = await flow();
    assert.equal(left.pack, false, `pack cleared on Change mode: ${JSON.stringify(left)}`);
    assert.equal(left.stage, false, "no Stage reveal left running");
    assert.equal(await game.getByTestId("pack").count(), 0, "the pack dialog is gone");
    await game.getByTestId("mode-penalties").click();
    await waitShootable();
    assert.equal((await flow()).match, false, "Penalties started after leaving the pack");
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "Change mode", exact: true }).click();
    await game.getByTestId("mode-match").click();
    await waitShootable();
    assert.equal((await flow()).match, true, "Big Match started after leaving the pack");
    ok("BQ-P0-1: leaving a pack mid-reveal (Change mode) clears it; Penalties and Big Match start");

    // 12. Redeem the ball being aimed with → the aim is cancelled (cannot kick a ball you no longer hold).
    await game.getByTestId("menu").click();
    await game.getByRole("button", { name: "My Bag", exact: true }).click();
    const cards = game.getByTestId("ball");
    await cards.first().getByTestId("shoot-ball").click();
    await waitShootable();
    const redeemable = await game.locator("[data-testid=redeem]").count();
    if (redeemable) console.log("  (redeem path covered by test-game.mjs when a valued ball is pulled)");
    await game.getByTestId("menu").click();
    await page.waitForTimeout(200);
    assert.equal((await flow()).shootable, false, "menu open: not shootable");
    ok("Big Match aim with menu open is not shootable");

    // 12b. BQ-P1-6: redeem the SELECTED ball, then "Kick with this ball" in the carousel kicks with the ball it
    //      shows (it used to pass the cleared selection, null, and open the Ball shop instead). Step 11's pack
    //      holds one Match Ball (redeemable) and one Scuffed Ball (0 RF: no Redeem).
    await game.getByRole("button", { name: "My Bag", exact: true }).click();
    const redeemableCard = cards.filter({ has: game.locator("[data-testid=redeem-ball]:not([disabled])") }).first();
    assert.ok(await cards.count() >= 2, "two balls in the Bag");
    assert.equal(await redeemableCard.count(), 1, "a redeemable ball in the Bag");
    {
      await redeemableCard.getByTestId("shoot-ball").click(); // select it: the Big Match aims with it
      await waitShootable();
      await game.getByTestId("menu").click();
      await game.getByRole("button", { name: "My Bag", exact: true }).click();
      const ballsBefore = await cards.count();
      await game.locator("[data-testid=ball][data-selected=true] [data-testid=redeem-ball]").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText(/^Redeemed a /).first().waitFor({ timeout: 10_000 });
      assert.equal(await cards.count(), ballsBefore - 1, "the redeemed ball left the Bag");
      await game.getByRole("button", { name: "Close" }).first().click();
      await game.getByTestId("change-ball").click();
      await game.getByTestId("carousel").waitFor({ timeout: 3000 });
      await game.getByTestId("kick-with-ball").click();
      await page.waitForTimeout(300);
      assert.equal(await game.getByTestId("buy-pack").count(), 0, "the Ball shop did not open");
      await waitShootable();
      assert.equal((await flow()).match, true, "Big Match aims with the ball the carousel showed");
      ok("BQ-P1-6: redeem the selected ball → carousel 'Kick with this ball' kicks with the shown ball");
    }

    // 13. Speed (round 6 B3): penalties go release → result ≤ 1.2 s and result → next kick ready ≤ 1.5 s.
    // Instant randomness (the judged default): the waited kick of 8c is excluded, every other one must meet the targets.
    const timing = (await flow()).timing.filter(entry => entry.kind === "penalty" && entry.wait < 500);
    console.log(`  timing (ms, release→result/→ready, beacon kicks: release→strike): ${timing.map(entry => `${entry.toResult}/${entry.toReady}${entry.wait ? ` (${entry.wait})` : ""}`).join(" ")}`);
    assert.ok(timing.length >= 4, "enough penalty kicks timed");
    // C2 instant replay: after a great goal the Stage hands control back at the same moment ("done", toReady), but
    // shows a 1.5 s replay first. A tap (or key) at that moment skips it AND starts the swipe, so toReady is measured
    // to that skip point; the replay's own length is logged separately and must stay ≤ 1.5 s (+ a frame of slack).
    for (const entry of timing) {
      assert.ok(entry.toResult <= 1200, `release → result ${entry.toResult} ms`); assert.ok(entry.toReady <= 1500, `result → ready ${entry.toReady} ms`);
      if (entry.replay !== undefined) assert.ok(entry.replay <= 1600, `instant replay ${entry.replay} ms`);
    }
    ok("every penalty: release → result ≤ 1.2 s, next kick ready ≤ 1.5 s after (instant replays ≤ 1.5 s, skippable)");

    // 14. BQ-P1-7: no $GBOOT is spent without a confirmation: Kit shop "try on" is a free preview (buying is a
    //     separate, confirmed step), and the Skill Cup entry (Cups) and its Results "Play again" both ask first.
    const menuItem = name => game.getByRole("button", { name, exact: true });
    const kitBalance = async () => { // the Kit shop's "Balance: N" line (simulated $GBOOT)
      await menuItem("Kit shop").click();
      const value = Number((await game.locator("body").textContent()).match(/Balance:\s*([\d,.]+)/)[1].replace(/,/g, ""));
      await game.getByRole("button", { name: "Close" }).first().click();
      return value;
    };
    const chip = () => game.getByTestId("mode-chip").textContent();
    const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.011, `${message}: ${actual} vs ${expected}`); // 2-decimal display
    await game.getByTestId("menu").click();
    const g0 = await kitBalance();
    await game.getByTestId("menu").click();
    await menuItem("Kit shop").click();
    const volt = game.getByRole("button", { name: /^Volt net/ });
    await volt.click(); // try on
    assert.equal(await volt.getAttribute("aria-pressed"), "true", "the tried-on net shows");
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    assert.equal(await kitBalance(), g0, "trying on spends nothing");
    await game.getByTestId("menu").click();
    await menuItem("Kit shop").click();
    await game.getByTestId("kit-buy").click();
    await game.getByTestId("kit-confirm").waitFor();
    await game.getByTestId("kit-confirm").getByRole("button", { name: "Cancel" }).click();
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    assert.equal(await kitBalance(), g0, "a cancelled buy spends nothing");
    await game.getByTestId("menu").click();
    await menuItem("Kit shop").click();
    await game.getByTestId("kit-buy").click();
    await game.getByTestId("kit-yes").click();
    assert.match(await volt.textContent(), /equipped/, "bought and equipped");
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.getByTestId("menu").click();
    const g1 = await kitBalance();
    near(g1, g0 - 4, "the confirmed buy spends the Volt net's 4 $GBOOT");
    ok("BQ-P1-7: Kit shop try-on is free; buying needs a confirmation (cancel spends nothing)");

    // The Skill Cup entry is open when no kick is being aimed: from the modes screen's Cups.
    const confirmBalance = async () => Number((await game.getByTestId("skill-confirm").textContent()).match(/You have ([\d,.]+) \$GBOOT/)[1].replace(/,/g, ""));
    await game.getByTestId("menu").click();
    await menuItem("Change mode").click();
    await menuItem("Cups").click();
    await game.getByRole("button", { name: /^Enter ·/ }).click();
    await game.getByTestId("skill-confirm").waitFor({ timeout: 2000 });
    assert.equal((await flow()).session, false, "no Skill Cup session before confirming");
    near(await confirmBalance(), g1, "nothing spent on Enter");
    await game.getByTestId("skill-confirm").getByRole("button", { name: "Cancel" }).click();
    await game.getByRole("button", { name: /^Enter ·/ }).click();
    near(await confirmBalance(), g1, "a cancelled Skill Cup entry spent nothing");
    await game.getByTestId("skill-yes").click();
    await waitShootable();
    assert.match(await chip(), /SKILL CUP/, "the confirmed entry starts the Skill Cup");
    await game.getByTestId("menu").click();
    const g2 = await kitBalance();
    near(g2, g1 - 100, "the confirmed entry spends 100 $GBOOT");
    for (let kick = 0; kick < 5; kick++) { await waitShootable(); await game.getByTestId("quick").click(); await waitIdleKick(); }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    await game.getByRole("button", { name: "Play again", exact: true }).click();
    await game.getByTestId("skill-confirm").waitFor({ timeout: 2000 });
    assert.equal(await game.getByTestId("round").getAttribute("data-kicks"), "5", "no new Skill Cup session before confirming");
    assert.match(await game.getByTestId("skill-confirm").textContent(), new RegExp(`You have ${g2} \\$GBOOT`), "nothing spent yet");
    await game.getByTestId("skill-yes").click();
    await waitShootable();
    assert.equal(await kicks(), 0, "a new Skill Cup session");
    await game.getByTestId("menu").click();
    near(await kitBalance(), g2 - 100, "the confirmed Play again spends 100 $GBOOT");
    ok("BQ-P1-7: Skill Cup entry (Cups) and Results 'Play again' spend only after a confirmation");
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
console.log(`PASS action-flow audit at ${width}px (${results.length} scenarios)`);
