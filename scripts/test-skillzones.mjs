// D17 Skill Zones, end to end and DETERMINISTIC, in the real sandboxed runtime (no test hooks in the game).
//
// Why it is deterministic:
//  • World Tour levels keep a fixed seed (dateSeed(level.id)) and the level's keeper (the Director only
//    rotates keepers in free play), so every kick's keeper seed is kickSeed(seed, kickIndex, keeper).
//  • A save code (the player-facing Settings feature) puts the player on difficulty rung 0: aim wobble 0
//    and aim assist 0.9 (the first matches after the tutorial), so no clock-dependent sway moves the aim.
//  • A straight swipe fixes the aim exactly: its DIRECTION sets aimX (45° = the post), and its upward
//    travel clamps aimY (≤ 60 CSS px → 0 on the grass, ≥ 280 CSS px → AIM_CEILING). Swipe speed (power)
//    is the only timing-dependent input, so the engine pre-pass below proves each planned kick has the
//    same outcome for EVERY power 0.35 … 1 (and ±0.03 of aim slack) before the browser plays it.
// Plan (park-1, "First Touch", keeper Mouse): kick 1 in off the post, kick 2 top bin, kick 3 a low side-netting
// goal (no Skill Zone). Usage: node scripts/test-skillzones.mjs [--width 960]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { playInPortraitIfAsked } from "./lib/phone.mjs";

const root = new URL("..", import.meta.url).pathname, out = join(root, ".dev/test-skillzones");
mkdirSync(out, { recursive: true });
await build({
  stdin: {
    contents: [
      `export { resolveShot, aimedShot, goalPoints, kickSeed, keeperById, DIFFICULTY_LADDER, AIM_POST_DEG, AIM_LIFT_CSS, AIM_CEILING } from "@penalty-kings/engine";`,
      `export { dateSeed } from "./games/penalty-kings/game/daily.ts";`,
      `export { skillZoneOf, SKILL_ZONE_XP, SKILL_ZONE_LABEL } from "./games/penalty-kings/game/rewards.ts";`,
      `export { XP, levelFromXp, assistLevel, fresh } from "./games/penalty-kings/game/progress.ts";`,
      `export { default as LEVELS } from "./games/penalty-kings/game/levels.json";`,
    ].join("\n"),
    resolveDir: root, loader: "ts",
  },
  outfile: join(out, "logic.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning",
  alias: { "@penalty-kings/engine": join(root, "packages/engine/src/index.ts") },
});
const E = await import(`${pathToFileURL(join(out, "logic.mjs")).href}?${Date.now()}`);

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

// ── Engine pre-pass: the plan holds for every swipe speed ──────────────────────────────────────────
const LEVEL = E.LEVELS.find(level => level.id === "park-1");
assert.equal(LEVEL.mode, "penalty"); assert.equal(LEVEL.keeper, "mouse");
const RUNG = 0, difficulty = E.DIFFICULTY_LADDER[RUNG];
assert.equal(difficulty.wobble, 0, "rung 0 has no aim wobble");
// kickAssist in a tour level: max(rung assist, assistLevel × 0.5); assistLevel is 1 in the first 3 matches after the tutorial.
const restoredMatches = 1;
const assist = Math.max(difficulty.assist, E.assistLevel({ ...E.fresh(), tutorialDone: true, matches: restoredMatches }, "park") * 0.5);
const seed = E.dateSeed(LEVEL.id), keeper = E.keeperById(LEVEL.keeper);
const PLAN = [
  { name: "in off the post", aimX: 1.13, aimY: 0, zone: "post-in" },
  { name: "top bin", aimX: 0.8, aimY: E.AIM_CEILING, zone: "top-bin" },
  { name: "low side netting", aimX: 0.5, aimY: 0, zone: null },
];
const history = [];
PLAN.forEach((kick, kickIndex) => {
  const seen = new Set();
  for (let power = 0.35; power <= 1.0001; power += 0.01) for (const slack of [-0.03, 0, 0.03]) {
    const shot = E.aimedShot({ aimX: kick.aimX + slack, aimY: kick.aimY, power, curl: 0 }, 0, assist);
    const outcome = E.resolveShot(shot, keeper, E.kickSeed(seed, kickIndex, keeper.id), { kickIndex, history }, difficulty);
    seen.add(`${outcome.result}:${E.skillZoneOf({ goal: outcome.result === "goal", zone: outcome.zone, postIn: outcome.postIn, hitBar: outcome.hitBar })}`);
  }
  assert.deepEqual([...seen], [`goal:${kick.zone}`], `engine pre-pass, kick ${kickIndex + 1} (${kick.name}): ${[...seen].join(", ")}`);
  history.push(kick.aimX); // the kick history the game passes (only the robot keeper reads it)
});
console.log(`engine pre-pass: park-1 vs ${keeper.name}, rung ${RUNG}, assist ${assist}: ${PLAN.map(kick => `${kick.name} → goal (${kick.zone ?? "no skill zone"})`).join("; ")} for every power`);

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
/** --motion: full motion (the SDK harness forces prefers-reduced-motion: reduce), so the instant replay is the slow-mo net-cam, not the still card. */
const motion = args.includes("--motion");
if (motion) {
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...launchArgs) => {
    const browser = await launch(...launchArgs), newContext = browser.newContext.bind(browser);
    browser.newContext = async (options = {}) => newContext({ ...options, reducedMotion: "no-preference" });
    return browser;
  };
}
const errors = [];
const crc32 = text => { let crc = ~0; for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (~crc >>> 0).toString(16).padStart(8, "0"); };
const editSaveCode = (code, friendId, change) => {
  const [prefix, payload] = code.trim().split(".");
  const next = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ...change }), "utf8").toString("base64url");
  return `${prefix}.${next}.${crc32(`${friendId}:${next}`)}`;
};
// A level start with room to spare, so the HUD's "into/next XP" moves by exactly the XP paid.
const START_XP = [300, 600, 1000].find(xp => E.levelFromXp(xp).into === 0 && E.levelFromXp(xp).next >= 200);

await testGame("./games/penalty-kings", {
  width, timeout: 90_000,
  check: async ({ page, game, friendId }) => {
    await playInPortraitIfAsked(game);
    page.on("pageerror", error => errors.push(String(error)));
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    /** A straight swipe from the ball: `deg` from vertical (aimX = deg / AIM_POST_DEG), `up` CSS px of upward travel. */
    const swipe = async ({ deg, up, steps = 12 }) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      const x0 = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y0 = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
      const dx = up * Math.tan((deg * Math.PI) / 180);
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (dx * i) / steps, y0 - (up * i) / steps); await page.waitForTimeout(16); }
      await page.mouse.up();
    };
    const xpInto = async () => Number((await game.locator(".pk-hud-left .pk-stat").textContent()).match(/· (\d+)\/\d+ XP/)[1]);
    const kick = async (plan, index) => {
      await waitShootable();
      const before = await xpInto();
      // Low shots: 40 CSS px up (under AIM_LIFT_CSS[0] = 60, aimY 0). Top bin: 340 CSS px up (past AIM_LIFT_CSS[1] = 280, aimY AIM_CEILING).
      await swipe({ deg: plan.aimX * E.AIM_POST_DEG, up: plan.aimY > 0 ? E.AIM_LIFT_CSS[1] + 60 : E.AIM_LIFT_CSS[0] - 20 });
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      const banner = (await game.locator(".pk-banner strong").textContent()).trim(), sub = (await game.locator(".pk-banner span").textContent()).trim();
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
      const xp = (await xpInto()) - before, hud = (await game.getByTestId("round").textContent()).trim();
      console.log(`kick ${index + 1} (${plan.name}): ${banner} | ${sub} | +${xp} XP | HUD "${hud}"`);
      return { banner, sub, xp, hud };
    };

    // Tutorial (first session, required to unlock the World Tour); its kicks are not part of the plan.
    await game.getByTestId("play").click();
    for (let i = 0; i < 3; i++) { await waitShootable(); await swipe({ deg: 20, up: 150 }); await game.locator(".pk-banner").waitFor({ timeout: 10_000 }); await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 }); }
    await game.getByTestId("results").waitFor();

    // Settings → save code: difficulty rung 0 (no wobble), a clean XP level start.
    // (Closing Results goes to the Modes screen, QA-8, which has its own Settings button.)
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.locator(".pk-modescreen").waitFor();
    await button("Settings").click();
    const code = await game.getByTestId("save-code-out").inputValue();
    const saved = JSON.parse(Buffer.from(code.split(".")[1], "base64url").toString("utf8"));
    assert.equal(saved.tutorialDone, true); assert.equal(saved.matches, restoredMatches, "one match played (the tutorial): full aim assist");
    await game.getByTestId("save-code-in").fill(editSaveCode(code, friendId, { difficulty: RUNG, xp: START_XP }));
    await game.getByTestId("save-code-restore").click();
    await game.getByTestId("save-code-note").filter({ hasText: /restored/ }).waitFor();
    await game.getByRole("button", { name: "Close" }).first().click();
    await game.locator(".pk-modescreen").waitFor();

    // World Tour, park-1.
    await game.getByTestId("mode-tour").click();
    await game.getByTestId("level-park-1").click();
    await button("Kick off").click();
    // (the modes screen's D18 check-in may have added 20 XP; the level still has room for every kick below)
    assert.ok((await xpInto()) <= 40, `the HUD starts near a clean level (${START_XP} XP)`);

    // C2 INSTANT REPLAY: a great goal (here in off the post, then a top bin) gets a 1.5 s slow-mo replay; a tap skips it
    // (and aims at once); left alone it ends by itself; a plain goal gets none.
    const replay = game.getByTestId("instant-replay");
    const post = await kick(PLAN[0], 0);
    await replay.waitFor({ state: "visible", timeout: 1500 });
    assert.match(await replay.textContent(), /INSTANT REPLAY.*IN OFF THE POST/);
    const still = (await replay.getAttribute("data-still")) === "true";
    console.log(`instant replay shown as ${still ? "a still replay card (reduced motion)" : "the slow-mo net-cam"}`);
    assert.equal(still, !motion, "reduced motion: a still card; full motion: the slow-mo replay on the Stage");
    if (motion) assert.equal((await game.locator("body").evaluate(() => window.__pkFlow())).stage, true, "the slow-mo replay is a Stage moment");
    assert.equal((await game.locator("body").evaluate(() => window.__pkFlow())).shootable, false, "no shooting during the replay");
    { const box = await canvas.boundingBox(); const tapAt = Date.now(); await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.8); await replay.waitFor({ state: "detached", timeout: 1000 }); await waitShootable(); console.log(`instant replay (post-in) skipped by a tap: aimable ${Date.now() - tapAt} ms after the tap`); }
    const bin = await kick(PLAN[1], 1);
    await replay.waitFor({ state: "visible", timeout: 1500 });
    assert.match(await replay.textContent(), /TOP BIN/);
    { const shownAt = Date.now(); await replay.waitFor({ state: "detached", timeout: 3000 }); const ms = Date.now() - shownAt; console.log(`instant replay (top bin) ran ${ms} ms`); assert.ok(ms <= 2000, `the replay ends by itself in about 1.5 s (${ms} ms)`); }
    const plain = await kick(PLAN[2], 2);
    await page.waitForTimeout(400);
    assert.equal(await replay.count(), 0, "a plain side-netting goal gets no replay");
    const logged = (await game.locator("body").evaluate(() => window.__pkFlow())).timing.filter(entry => entry.replay !== undefined);
    assert.equal(logged.length, 2, `two replays logged: ${JSON.stringify(logged)}`);
    const skill = zone => `SKILL ZONE: ${E.SKILL_ZONE_LABEL[zone]} +${E.SKILL_ZONE_XP[zone]} XP, streak +2`;

    // Kick 1: in off the post.
    assert.equal(post.banner, "GOAL!");
    assert.ok(post.sub.includes("in off the post"), post.sub);
    assert.ok(post.sub.includes(skill("post-in")), `post-in Skill Zone line: ${post.sub}`);
    assert.ok(post.sub.includes("SKILL ZONE: in off the post +20 XP"), post.sub);
    assert.equal(post.xp, E.XP.goal + E.SKILL_ZONE_XP["post-in"], "post-in pays XP.goal + 20");
    assert.doesNotMatch(post.hud, /in a row/, "one goal is not a run yet");

    // Kick 2: top bin, two goals in a row (the scoring streak is 4 after two Skill Zones; the text counts goals).
    assert.equal(bin.banner, "GOAL!");
    assert.ok(bin.sub.includes("TOP BIN"), bin.sub);
    assert.ok(bin.sub.includes("SKILL ZONE: top bin +15 XP, streak +2"), `top-bin Skill Zone line: ${bin.sub}`);
    assert.equal(bin.xp, E.XP.goal + E.SKILL_ZONE_XP["top-bin"], "top bin pays XP.goal + 15");
    assert.match(bin.sub, /· 2 in a row/); assert.doesNotMatch(bin.sub, /[34] in a row/);
    assert.match(bin.hud, /· 2 in a row$/, `HUD after two goals: ${bin.hud}`);
    // ...while the SCORING streak did jump by 2: kick 2 is paid at streak 3 (0 → 2 → 3), kick 3 at streak 5.
    assert.ok(bin.sub.startsWith(`+${E.goalPoints(keeper, 1, 3, false, "bin").toLocaleString("en-US")} points`), `top-bin points at streak 3: ${bin.sub}`);

    // Kick 3: a normal goal (low, side netting) pays the ordinary XP and shows no Skill Zone.
    assert.equal(plain.banner, "GOAL!");
    assert.doesNotMatch(plain.sub, /SKILL ZONE/, plain.sub);
    assert.equal(plain.xp, E.XP.goal + E.XP.zoneBonus.side, "a plain side goal pays XP.goal + the side bonus");
    assert.match(plain.sub, /· 3 in a row/); assert.match(plain.hud, /· 3 in a row$/);
    assert.ok(plain.sub.startsWith(`+${E.goalPoints(keeper, 1, 5, false, "side").toLocaleString("en-US")} points`), `side goal points at streak 5: ${plain.sub}`);
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
console.log(`PASS D17 Skill Zones end to end at ${width}px${motion ? " (full motion)" : ""}: in off the post (+20 XP), top bin (+15 XP), streak text counts real goals, a plain goal shows no Skill Zone; C2 instant replays (tap-skip, 1.5 s, none for a plain goal)`);
