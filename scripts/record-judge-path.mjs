// SIO-5: records the 40-60 s judge path (first kick within 10 s) as a video, plus six key frames for the submission README.
// Real sandboxed runtime (SDK testGame: mock wallet, SIMULATED economy, sample Friend #7730), real swipes, FULL
// motion (the SDK harness forces prefers-reduced-motion: reduce; this script overrides it so the showreel plays).
// Path: cold-open showreel → Skip intro → Kick off → tutorial (3 kicks, first goal = big celebration + wave) →
// Modes (NEXT GOAL) → Free Kicks (2 kicks) → Ball shop (odds line) → buy a pack → open → Reveal all → choose a
// ball → Big Match kick → HUD.
// Output: docs/media/judge-path.webm and docs/screenshots/judge-*.png. Run by hand (npm run record:judge), not by CI.
// Usage: node scripts/record-judge-path.mjs [--out-video docs/media/judge-path.webm] [--shots docs/screenshots]
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const videoOut = arg("--out-video", "docs/media/judge-path.webm"), shotsOut = arg("--shots", "docs/screenshots");
const WIDTH = 960, HEIGHT = 640; // 3:2, the game frame fills the viewport
const MAX_BYTES = 8 * 1024 * 1024;

installPriceFixture(); // recorded RF/USD pool reads (the SDK fixture rejects unknown RPC reads)
// Full motion from the first frame: the SDK harness creates its context with reducedMotion "reduce".
{
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...launchArgs) => {
    const browser = await launch(...launchArgs);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (options = {}) => newContext({ ...options, reducedMotion: "no-preference" });
    return browser;
  };
}

// Playwright's bundled ffmpeg (VP8/WebM only) is used to measure and, if needed, shrink the video.
const ffmpeg = (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = existsSync(root) ? readdirSync(root).filter(name => name.startsWith("ffmpeg")).sort().pop() : undefined;
  const bin = dir && join(root, dir, process.platform === "darwin" ? "ffmpeg-mac" : "ffmpeg-linux");
  return bin && existsSync(bin) ? bin : null;
})();
/** Decodes the whole file (webm output to /dev/null) and returns the last timestamp ffmpeg reports, in seconds. */
const duration = file => {
  if (!ffmpeg) return NaN;
  const { stderr = "" } = spawnSync(ffmpeg, ["-hide_banner", "-i", file, "-c:v", "copy", "-f", "webm", "-y", "/dev/null"], { encoding: "utf8" });
  const times = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times.at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
};

mkdirSync(dirname(videoOut), { recursive: true });
mkdirSync(shotsOut, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "pk-judge-"));
const raw = join(temporary, "raw.webm");
const log = [];
const errors = [];

await testGame("./games/penalty-kings", {
  width: WIDTH, height: HEIGHT, timeout: 60_000,
  check: async ({ page, game }) => {
    page.on("pageerror", error => errors.push(String(error)));
    const started = Date.now(), at = () => ((Date.now() - started) / 1000).toFixed(1);
    const note = text => { log.push(`${at().padStart(5)} s  ${text}`); console.log(`${at().padStart(5)} s  ${text}`); };
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const frame = page.locator(".rf-game-frame");
    const pause = ms => page.waitForTimeout(ms); // viewer pauses only; every step below waits for a test id or flow state

    // Step captions in the bottom-left corner (over the host's "Local preview" chips, never over the game).
    let caption = null;
    const say = async text => {
      await caption?.dispose?.();
      caption = await page.screencast.showOverlay(`<div style="position:fixed;left:12px;bottom:12px;padding:6px 10px;background:#0b1020e6;color:#fff;font:600 15px/1.2 system-ui,sans-serif;border:2px solid #d4ff3a;border-radius:4px;letter-spacing:.02em">${text}</div>`);
    };
    const shoot = async name => {
      await page.screencast.hideOverlays();
      await frame.screenshot({ path: join(shotsOut, `judge-${name}.png`) });
      await page.screencast.showOverlays();
      note(`frame judge-${name}.png`);
    };

    const flow = () => game.locator("body").evaluate(() => window.__pkFlow?.());
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const toScreen = async (x, y) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale };
    };
    // The same swipe as the browser tests: from the ball, up and sideways, ~180 ms.
    const swipe = async ({ dx = 0.35, fromY = 250, step = 12, steps = 9 } = {}) => {
      const start = await toScreen(240, fromY);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(start.x + i * dx * 12 * start.scale, start.y - i * step * start.scale); await page.waitForTimeout(18); }
      await page.mouse.up();
    };
    /** One kick: waits until shootable, swipes, returns the banner text; onBanner runs while the banner is up. */
    const kick = async (label, options, onBanner) => {
      await waitShootable();
      await pause(250);
      await swipe(options);
      note(`${label}: swipe`);
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      const banner = (await game.locator(".pk-banner strong").textContent()).trim();
      note(`${label}: ${banner}`);
      await onBanner?.(banner);
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
      return banner;
    };
    const confirmPreview = () => page.getByRole("button", { name: "Confirm preview", exact: true }).click();

    await page.screencast.start({ path: raw, size: { width: WIDTH, height: HEIGHT } });
    note("recording");

    // 1. Cold open: the showreel plays behind the title.
    await game.getByTestId("skip-intro").waitFor();
    await say("1 · Cold open: the showreel plays behind the title");
    await pause(2000);
    await shoot("title");
    await pause(800); // owner requirement: the first kick lands within 10 s of the start
    await game.getByTestId("skip-intro").click();
    note("skip intro");
    await pause(700);

    // 2. Kick off → coached tutorial, 3 kicks. The first goal gets the big celebration + crowd wave.
    await say("2 · Kick off: the tutorial, three swipes");
    await game.getByTestId("play").click();
    let celebrated = false;
    for (let i = 1; i <= 3; i++) {
      await kick(`tutorial ${i}`, { dx: [0.4, -0.4, 0.35][i - 1] }, async banner => {
        if (!celebrated && banner === "GOAL!") { celebrated = true; await pause(300); await shoot("goal"); }
      });
    }
    assert.ok(celebrated, "the tutorial scored at least once (celebration frame)");
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    note("tutorial results");
    await pause(1800);

    // 3. Modes: the NEXT GOAL line (free progression only).
    await button("Modes").click();
    await game.getByTestId("next-goal").waitFor();
    await say("3 · Modes: NEXT GOAL always points at a free unlock");
    note(`next goal: ${(await game.getByTestId("next-goal").textContent()).trim()}`);
    await pause(900);
    await shoot("modes");
    await pause(1300);

    // 4. Free Kicks: two kicks over the wall.
    await game.getByTestId("mode-freekicks").click();
    await say("4 · Free Kicks: curl it over the wall");
    await waitShootable();
    await pause(900);
    await shoot("freekick");
    for (let i = 1; i <= 2; i++) await kick(`free kick ${i}`, { fromY: 262, dx: [0.25, -0.3][i - 1], steps: 10, step: 14 });
    await game.getByTestId("menu").click();
    await button("Change mode").click();
    await game.getByTestId("ball-shop").waitFor();

    // 5. Big Match: Ball shop (odds printed on the pack) → buy → open → Reveal all → choose a ball.
    await say("5 · Big Match: buy a pack (odds on the pack, economy SIMULATED)");
    await game.getByTestId("ball-shop").click();
    await game.getByTestId("pack-2").click(); // the preview wallet holds 20 simulated RF: a 2-ball Park pack
    const odds = game.getByTestId("odds-line").first();
    await odds.scrollIntoViewIfNeeded();
    note(`odds: ${(await odds.textContent()).trim()}`);
    await pause(1800);
    await game.getByTestId("buy-pack").scrollIntoViewIfNeeded();
    await game.getByTestId("buy-pack").click();
    await confirmPreview();
    await game.getByText("2 balls bought.").waitFor();
    await pause(700);
    await game.getByTestId("open-pack").click();
    await confirmPreview();
    await game.getByTestId("pack").waitFor({ timeout: 15_000 });
    await game.getByTestId("reveal-all").waitFor();
    await pause(900);
    await game.getByTestId("reveal-all").click();
    await game.getByTestId("pack-summary").waitFor();
    note(`pack: ${(await game.locator(".pk-card strong").allTextContents()).join(", ")}`);
    await pause(1100); // let the flip settle
    await shoot("pack-summary"); // judge-pack.png was the pre-B4 font; the README points here
    await pause(900);
    await game.getByTestId("to-bag").click();
    await game.getByTestId("ball").first().waitFor();
    await pause(900);
    await game.getByTestId("shoot-ball").first().click();

    // 6. Big Match kicks with the chosen ball (it stays in the Bag).
    await say("6 · Big Match: kick with the ball you chose");
    let shotTaken = false;
    for (let i = 1; i <= 2; i++) {
      await kick(`big match ${i}`, { dx: [0.3, -0.35][i - 1] }, async () => {
        if (!shotTaken) { shotTaken = true; await pause(300); await shoot("bigmatch"); }
      });
    }
    await waitShootable();
    note(`HUD: ${(await game.locator(".pk-hud-left .pk-stat").textContent()).trim()} · flow ${JSON.stringify((await flow())?.phase ?? "")}`);
    await say("Penalty Kings · FriendSDK v0.1.2 · preview economy is SIMULATED");
    await pause(Math.max(800, Math.min(2500, 57_500 - (Date.now() - started)))); // stay under 60 s
    await caption?.dispose?.();
    await page.screencast.stop();
    note("stopped");
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);

// Keep the file small enough for a GitHub page view: re-encode at a lower bitrate if it is over the cap.
let seconds = duration(raw);
if (statSync(raw).size > MAX_BYTES && ffmpeg) {
  const smaller = join(temporary, "small.webm");
  const kbps = Math.floor((MAX_BYTES * 8 * 0.9) / (seconds || 60) / 1000);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", raw, "-c:v", "libvpx", "-b:v", `${kbps}k`, "-crf", "10", "-an", "-y", smaller]);
  renameSync(smaller, raw);
  seconds = duration(raw);
}
renameSync(raw, videoOut);
rmSync(temporary, { recursive: true, force: true });
const bytes = statSync(videoOut).size;
console.log(`\n${videoOut}: ${Number.isFinite(seconds) ? seconds.toFixed(1) : "?"} s, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`frames: ${["title", "goal", "modes", "freekick", "pack-summary", "bigmatch"].map(name => join(shotsOut, `judge-${name}.png`)).join(", ")}`);
assert.ok(bytes <= MAX_BYTES, `video is ${bytes} bytes (cap ${MAX_BYTES})`);
if (Number.isFinite(seconds)) assert.ok(seconds >= 40 && seconds <= 60, `video length ${seconds.toFixed(1)} s is outside 40-60 s`);
console.log("PASS judge path recorded");
