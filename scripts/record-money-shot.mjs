// B10: the ~15 s "money shot" for the README tops, recorded from the real sandboxed runtime at FULL motion
// (SDK testGame: mock wallet, SIMULATED economy, sample Friend #7730; the harness forces prefers-reduced-motion:
// reduce, this script overrides it so shake, confetti and slow motion play).
//
// The clip, in order (each beat is cut from one continuous session, see BEATS):
//   1. cold open: the showreel's logo slam and the top-bin goal with the net-cam push;
//   2. a post CLANG (World Tour park-1 vs Squeak the Mouse, a swipe at the top of the far post);
//   3. a Golden Boot pack reveal (a 1-ball pack; the SDK preview's draw is pinned to roll 9950, in the 1% band);
//   4. streak fever in the Big Match with that ball: goals 3 (HAT-TRICK), 5 (ON FIRE) and 10 in a row.
//
// Why it is reproducible:
//  • A save code (the player-facing Settings feature) puts the player on difficulty rung 0 (no aim wobble, aim
//    assist 0.9) with no keeper stamped, so the Big Match keeper is the ladder's first, Squeak the Mouse.
//  • A straight swipe fixes the aim (its direction sets aimX, ≥ 280 CSS px up clamps aimY to AIM_CEILING;
//    scripts/test-skillzones.mjs). The engine pre-pass below proves each planned kick has ONE outcome against the
//    Mouse for every keeper seed (the Big Match seeds the keeper from the simulated beacon), every swipe speed
//    and ±0.03 of aim: top bins (aimX ±0.8) always score (the Mouse cannot reach the top corners), and aimX 1.27
//    at the ceiling always hits the post.
//  • The pack's rarity roll is pinned in the host page (the same technique as scripts/test-flow.mjs step 11).
//
// Frames come from Chromium's own screencast (CDP), with timestamps, so each beat is cut by time and the dead
// time between beats (menus, save code, the shop) never reaches the clip. Playwright's bundled ffmpeg (VP8/WebM
// and PNG only) encodes the webm; scripts/lib/gif.mjs builds the GIF from ffmpeg's PNG frames.
//
// Outputs: docs/media/money-shot.webm (≤ 2 MB), docs/media/money-shot.gif (≤ 4 MB), docs/media/cast-sheet.png
// (the twelve keepers, cut from docs/screenshots/keepers.png). Run by hand: npm run record:money.
// Usage: node scripts/record-money-shot.mjs [--out docs/media] [--cast-only] [--frames DIR (keep the GIF's PNG frames)]
//        [--recut (re-cut the last take, .dev/money-shot-capture.json, after changing BEATS; no browser)]
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { decodePng, encodeGif } from "./lib/gif.mjs";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const outDir = arg("--out", "docs/media"), keepFrames = arg("--frames", null), castOnly = args.includes("--cast-only");
const WIDTH = 960, HEIGHT = 640; // 3:2, the game frame fills the viewport (the game draws 480 × 320, ×2)
const FPS = 25, GIF_FPS = 10;
const MAX_WEBM = 2_000_000, MAX_GIF = 4_000_000; // bytes (decimal MB, the stricter reading)
const E = await import(join(root, "packages/engine/src/index.ts")); // node ≥ 22 --experimental-strip-types (see package.json)

mkdirSync(outDir, { recursive: true });
const ffmpeg = (() => {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = existsSync(base) ? readdirSync(base).filter(name => name.startsWith("ffmpeg")).sort().pop() : undefined;
  const bin = dir && join(base, dir, process.platform === "darwin" ? "ffmpeg-mac" : "ffmpeg-linux");
  return bin && existsSync(bin) ? bin : null;
})();

// ── The cast sheet: each keeper's idle and dive frames, cut from docs/screenshots/keepers.png ───────────────
async function castSheet() {
  const sheet = readFileSync(join(root, "docs/screenshots/keepers.png")).toString("base64");
  const keepers = E.KEEPERS.map(keeper => ({ name: keeper.name, tell: keeper.tell }));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b1020"><canvas id="c"></canvas></body>`);
  await page.evaluate(async ({ sheet, keepers }) => {
    const image = new Image(); image.src = `data:image/png;base64,${sheet}`; await image.decode();
    // keepers.png: 12 rows from y = 37, ~84.75 px apart; "idle" is the first column (x ≈ 170), "dive" the last (x ≈ 1300).
    const ROW0 = 37, ROW = 84.75, CELL_W = 190, CELL_H = 162, COLS = 6, PAD = 16, TITLE = 44;
    const canvas = document.getElementById("c"), c = canvas.getContext("2d");
    canvas.width = COLS * CELL_W + PAD * 2; canvas.height = TITLE + Math.ceil(keepers.length / COLS) * CELL_H + PAD;
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b1020"; c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#d4ff3a"; c.font = "700 20px ui-monospace, monospace"; c.fillText("PENALTY KINGS · THE KEEPERS", PAD, 30);
    c.fillStyle = "#8a96a8"; c.font = "13px ui-monospace, monospace"; c.textAlign = "right"; c.fillText("idle · dive · each one has a tell", canvas.width - PAD, 30); c.textAlign = "left";
    const wrap = (text, x, y, width, line) => { let row = ""; for (const word of text.split(" ")) { const next = row ? `${row} ${word}` : word; if (c.measureText(next).width > width && row) { c.fillText(row, x, y); row = word; y += line; } else row = next; } if (row) c.fillText(row, x, y); };
    keepers.forEach((keeper, index) => {
      const x = PAD + (index % COLS) * CELL_W, y = TITLE + Math.floor(index / COLS) * CELL_H;
      c.fillStyle = index % 2 ? "#141a33" : "#172040"; c.fillRect(x + 3, y + 3, CELL_W - 6, CELL_H - 6);
      const top = Math.round(ROW0 + index * ROW) + 12;
      c.drawImage(image, 140, top, 64, 62, x + 14, y + 8, 64, 62);   // idle
      c.drawImage(image, 1268, top, 64, 62, x + 104, y + 8, 64, 62); // dive
      c.fillStyle = "#ffffff"; c.font = "700 13px ui-monospace, monospace"; c.fillText(keeper.name, x + 12, y + 88);
      c.fillStyle = "#aab4c8"; c.font = "11px ui-monospace, monospace"; wrap(keeper.tell, x + 12, y + 106, CELL_W - 24, 14);
    });
  }, { sheet, keepers });
  const box = await page.locator("#c").boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
  const file = join(outDir, "cast-sheet.png");
  await page.locator("#c").screenshot({ path: file });
  await browser.close();
  console.log(`${file}: ${(statSync(file).size / 1024).toFixed(0)} KB`);
}
await castSheet();
if (castOnly) process.exit(0);
assert.ok(ffmpeg, "Playwright's ffmpeg is needed (npx playwright install ffmpeg)");

// ── Engine pre-pass: every planned kick has exactly one outcome against the Mouse at rung 0 ──────────────
const RUNG = 0, difficulty = E.DIFFICULTY_LADDER[RUNG], mouse = E.keeperById("mouse");
assert.equal(difficulty.wobble, 0, "rung 0 has no aim wobble");
const ASSIST = 0.9; // max(rung 0 assist 0.9, assistLevel × 0.5): the first matches after the tutorial
const POST = { aimX: 1.27, aimY: E.AIM_CEILING, expect: "post" };
const TOP_BIN = [{ aimX: 0.8, aimY: E.AIM_CEILING, expect: "goal" }, { aimX: -0.8, aimY: E.AIM_CEILING, expect: "goal" }];
for (const kick of [POST, ...TOP_BIN]) {
  const seen = new Set();
  for (let s = 0; s < 4000; s++) for (const power of [0.35, 0.5, 0.65, 0.8, 1]) for (const slack of [-0.03, 0, 0.03]) {
    const shot = E.aimedShot({ aimX: kick.aimX + slack, aimY: kick.aimY, power, curl: 0 }, 0, ASSIST);
    seen.add(E.resolveShot(shot, mouse, Math.imul(s + 1, 2654435761) >>> 0, { kickIndex: s % 12, history: [] }, difficulty).result);
  }
  assert.deepEqual([...seen], [kick.expect], `engine pre-pass aimX ${kick.aimX}: ${[...seen].join(", ")}`);
}
console.log(`engine pre-pass: vs ${mouse.name} at rung ${RUNG}: aimX ±0.8 top bin → always a goal, aimX ${POST.aimX} at the ceiling → always the post`);

// ── Full motion from the first frame ─────────────────────────────────────────────────────────────────
{
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...launchArgs) => {
    const browser = await launch(...launchArgs);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (options = {}) => newContext({ ...options, reducedMotion: "no-preference" });
    return browser;
  };
}
installPriceFixture(); // recorded RF/USD pool reads (the SDK fixture rejects unknown RPC reads)

// Beat windows, in seconds relative to each beat's anchor (tuned by looking at the frames; see the report).
const BEATS = {
  cold: { from: 0.9, to: 4.1 },        // anchor: the title screen appears (the logo plate, then TOP BIN! with the net-cam push; the wipe starts ~4.2 s)
  post: { from: 0.1, to: 2.6 },        // anchor: swipe release (strike, the post at ~1.5 s with shake, CLANG! · SO CLOSE! · OFF THE POST!)
  reveal: { from: -0.2, to: 3.3 },     // anchor: the face-down card is tapped (light rays, GOLDEN BOOT BALL)
  fever3: { from: 0.4, to: 2.5 },      // anchor: swipe release of goal 3 (fire trail, GOAL!, HAT-TRICK! 3 IN A ROW)
  fever5: { from: 0.4, to: 2.5 },      // goal 5 (ON FIRE! 5 IN A ROW, sudden death)
  fever10: { from: 0.4, to: 2.6 },     // goal 10 (10 IN A ROW! THE WHOLE STADIUM IS SINGING); cut just before the instant replay shows (~2.1-2.3 s)
};

const frames = []; // { t (s, browser wall clock), data (base64 JPEG) }
const marks = {};
const errors = [], skew = [];
let rolling = false;

const crc32 = text => { let crc = ~0; for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (~crc >>> 0).toString(16).padStart(8, "0"); };
const editSaveCode = (code, friendId, change) => {
  const [prefix, payload] = code.trim().split(".");
  const next = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ...change }), "utf8").toString("base64url");
  return `${prefix}.${next}.${crc32(`${friendId}:${next}`)}`;
};

const CAPTURE = join(root, ".dev/money-shot-capture.json"); // the raw take (gitignored), for --recut
const recut = args.includes("--recut");
if (recut) { const saved = JSON.parse(readFileSync(CAPTURE, "utf8")); Object.assign(marks, saved.marks); frames.push(...saved.frames); }
else await testGame("./games/penalty-kings", {
  width: WIDTH, height: HEIGHT, timeout: 90_000,
  check: async ({ page, game, friendId }) => {
    page.on("pageerror", error => errors.push(String(error)));
    const started = Date.now(), note = text => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${text}`);
    const button = name => game.getByRole("button", { name, exact: true });
    const canvas = game.locator("canvas.pk-canvas");
    const confirmPreview = () => page.getByRole("button", { name: "Confirm preview", exact: true }).click();
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
    const mark = name => { marks[name] = Date.now() / 1000; };

    // Chromium's screencast: every composited frame, with its timestamp. Frames are kept only while `rolling`.
    const cdp = await page.context().newCDPSession(page);
    let last = null; // a still screen sends no frames: a new roll starts from the frame already on screen
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      last = { t: metadata.timestamp, data }; skew.push(Date.now() / 1000 - metadata.timestamp); // arrival lag (marks use Node's clock)
      if (rolling) frames.push(last);
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
    const roll = async (on, settle = 0) => { if (on) { rolling = true; if (last) frames.push({ t: Date.now() / 1000, data: last.data }); } else { await page.waitForTimeout(settle); rolling = false; } };

    /** A straight swipe from the ball: aimX sets the direction (aimX × 45° from vertical), `up` CSS px of travel. */
    const swipe = async ({ aimX, up = 300, steps = 12 }) => {
      const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
      const x0 = box.x + (box.width - 480 * scale) / 2 + 240 * scale, y0 = box.y + (box.height - 320 * scale) / 2 + 250 * scale;
      const dx = up * Math.tan((aimX * E.AIM_POST_DEG * Math.PI) / 180);
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (dx * i) / steps, y0 - (up * i) / steps); await page.waitForTimeout(16); }
      await page.mouse.up();
    };
    /** One kick: waits until shootable, swipes (marking the release), returns the banner text once it clears. */
    const kick = async (label, aim, markAs, afterRelease) => {
      await waitShootable();
      await page.waitForTimeout(200);
      if (markAs) await roll(true);
      await swipe(aim);
      if (markAs) mark(markAs);
      afterRelease?.();
      await game.locator(".pk-banner").waitFor({ timeout: 10_000 });
      const banner = (await game.locator(".pk-banner strong").textContent()).trim(), sub = (await game.locator(".pk-banner span").textContent()).trim();
      note(`${label}: ${banner} | ${sub}`);
      if (markAs) await roll(false, 1600);
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 12_000 });
      return { banner, sub };
    };

    // 1. Cold open: the title screen and the showreel.
    await game.getByTestId("skip-intro").waitFor();
    await roll(true); mark("cold");
    await page.waitForTimeout(5200);
    await roll(false);
    note("cold open captured");
    await game.getByTestId("skip-intro").click();

    // 2. Tutorial (required for the World Tour), then Settings → save code: rung 0, no keeper stamped.
    await game.getByTestId("play").click();
    for (let i = 0; i < 3; i++) await kick(`tutorial ${i + 1}`, { aimX: 0.45, up: 150 });
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    await game.getByRole("button", { name: "Close" }).first().click(); // closing Results goes to the Modes screen (QA-8)
    await game.locator(".pk-modescreen").waitFor();
    await button("Settings").click();
    const code = await game.getByTestId("save-code-out").inputValue();
    await game.getByTestId("save-code-in").fill(editSaveCode(code, friendId, { difficulty: RUNG, stamps: [] }));
    await game.getByTestId("save-code-restore").click();
    await game.getByTestId("save-code-note").filter({ hasText: /restored/ }).waitFor();
    await game.getByRole("button", { name: "Close" }).first().click();
    note("save code restored: rung 0, no stamps");

    // 3. The post: World Tour park-1 (keeper: the Mouse), one swipe at the top of the far post.
    await game.locator(".pk-modescreen").waitFor();
    await game.getByTestId("mode-tour").click();
    await game.getByTestId("level-park-1").click();
    await button("Kick off").click();
    const post = await kick("post", { aimX: POST.aimX, up: 300 }, "post");
    assert.match(post.banner, /POST|CLANG|BAR/i, `the post kick hit the woodwork: ${post.banner}`);

    // 4. The Golden Boot: a 1-ball pack, the preview's draw pinned to 9950 (Golden Boot is 9900–9999).
    await game.getByTestId("menu").click();
    await button("Change mode").click();
    await game.getByTestId("ball-shop").click();
    await game.getByTestId("pack-1").click();
    await game.getByTestId("buy-pack").click();
    await confirmPreview();
    await game.getByTestId("open-pack").waitFor();
    await page.evaluate(() => { const real = crypto.getRandomValues.bind(crypto); let once = true; crypto.getRandomValues = array => (once && array instanceof Uint32Array && array.length === 1 ? (once = false, array[0] = 9950, array) : real(array)); });
    await game.getByTestId("open-pack").click();
    await confirmPreview();
    await game.getByTestId("pack").waitFor({ timeout: 15_000 });
    const card = game.locator(".pk-card").first();
    await card.waitFor();
    await page.waitForTimeout(600);
    await roll(true); await page.waitForTimeout(400); mark("reveal");
    await card.click();
    await game.getByTestId("pack-summary").waitFor({ timeout: 15_000 });
    await roll(false, 300);
    const pulled = (await game.locator(".pk-card strong").allTextContents()).join(", ");
    note(`pack: ${pulled}`);
    assert.equal(pulled, "Golden Boot", "the pinned roll revealed a Golden Boot ball");

    // 5. Big Match with the Golden Boot ball: ten top bins in a row (5 kicks, then sudden death until a miss).
    await game.getByTestId("to-bag").click();
    await game.getByTestId("shoot-ball").first().click();
    for (let n = 1; n <= 10; n++) {
      const markAs = n === 3 ? "fever3" : n === 5 ? "fever5" : n === 10 ? "fever10" : null;
      // Goal 10 is a top bin, so the C2 instant replay follows it: the clip ends just before the replay shows.
      const replay = () => game.getByTestId("instant-replay").waitFor({ state: "visible", timeout: 10_000 }).then(() => mark("replay10"), () => {});
      const result = await kick(`big match ${n}`, { aimX: TOP_BIN[n % 2].aimX, up: 340 }, markAs, n === 10 ? replay : undefined);
      assert.equal(result.banner, "GOAL!", `big match kick ${n} scored`);
      if (n >= 2) assert.match(result.sub, new RegExp(`${n} in a row`), `kick ${n}: ${result.sub}`);
    }
    const director = await game.locator("body").evaluate(() => window.__pkDirector?.());
    const faced = [...new Set((director?.keepers ?? []).map(entry => entry.id))];
    note(`keepers on the pitch: ${faced.join(", ")}`);
    await cdp.send("Page.stopScreencast");
  },
});
assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
if (!recut) { mkdirSync(join(root, ".dev"), { recursive: true }); writeFileSync(CAPTURE, JSON.stringify({ marks, frames })); }

// ── Cut: each beat resampled to a constant frame rate (the latest screencast frame at each tick) ─────────
const order = ["cold", "post", "reveal", "fever3", "fever5", "fever10"];
frames.sort((a, b) => a.t - b.t);
skew.sort((a, b) => a - b);
if (skew.length) console.log(`screencast frame arrival lag: median ${(skew[skew.length >> 1] * 1000).toFixed(0)} ms (the beat windows absorb it)`);
const lengths = {};
function resample(fps) {
  const picked = [];
  for (const name of order) {
    const anchor = marks[name], { from } = BEATS[name];
    const to = name === "fever10" && marks.replay10 ? Math.min(BEATS[name].to, marks.replay10 - anchor - 0.45) : BEATS[name].to; // the replay's first frames reach the screen before the DOM check sees it
    assert.ok(anchor, `beat ${name} was marked`);
    lengths[name] = to - from;
    const near = frames.filter(frame => frame.t >= anchor + from - 2 && frame.t <= anchor + to + 2);
    if (fps === FPS) console.log(`beat ${name}: ${near.length} frames within ±2 s of the window (${near.length ? `${(near[0].t - anchor).toFixed(2)} … ${(near.at(-1).t - anchor).toFixed(2)} s` : "none"})`);
    let cursor = 0;
    for (let t = anchor + from; t < anchor + to; t += 1 / fps) {
      while (cursor + 1 < frames.length && frames[cursor + 1].t <= t) cursor++;
      assert.ok(frames[cursor] && Math.abs(frames[cursor].t - t) < 1.5, `beat ${name}: no frame near ${t.toFixed(2)}`);
      picked.push(frames[cursor]);
    }
  }
  return picked;
}
const temporary = mkdtempSync(join(tmpdir(), "pk-money-"));
/** The picked JPEG frames, concatenated into one file for ffmpeg's image2pipe demuxer. */
const jpegFile = (picked, name) => { const file = join(temporary, name); writeFileSync(file, Buffer.concat(picked.map(frame => Buffer.from(frame.data, "base64")))); return file; };
const video = resample(FPS), seconds = video.length / FPS;
console.log(`clip: ${seconds.toFixed(1)} s, ${video.length} frames at ${FPS} fps (from ${frames.length} screencast frames)`);

const webm = join(outDir, "money-shot.webm"), videoJpegs = jpegFile(video, "video.mjpeg");
for (const kbps of [950, 800, 650, 500]) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", videoJpegs,
    "-c:v", "libvpx", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-qmin", "4", "-qmax", "63", "-deadline", "good", "-auto-alt-ref", "0", "-an", "-y", webm]);
  console.log(`webm at ${kbps} kbps: ${(statSync(webm).size / 1024 / 1024).toFixed(2)} MB`);
  if (statSync(webm).size <= MAX_WEBM) break;
}

// GIF: 480 × 320 (the game's own pixel grid), 10 fps, from the same JPEG frames.
const gifFrames = resample(GIF_FPS), pngDir = keepFrames ?? join(temporary, "png");
mkdirSync(pngDir, { recursive: true });
execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(GIF_FPS), "-i", jpegFile(gifFrames, "gif.mjpeg"),
  "-vf", `scale=${WIDTH / 2}:${HEIGHT / 2}:flags=area`, "-pix_fmt", "rgb24", "-c:v", "png", "-f", "image2", "-y", join(pngDir, "f%04d.png")]);
const pngs = readdirSync(pngDir).filter(name => /^f\d+\.png$/.test(name)).sort();
const gif = join(outDir, "money-shot.gif");
let gifBytes = Infinity;
for (const tolerance of [14, 20, 28]) {
  writeFileSync(gif, encodeGif(pngs.map(name => decodePng(readFileSync(join(pngDir, name)))), { delayCs: Math.round(100 / GIF_FPS), tolerance }));
  gifBytes = statSync(gif).size;
  if (gifBytes <= MAX_GIF) break;
}
rmSync(temporary, { recursive: true, force: true });

const decodedSeconds = (() => {
  const { stderr = "" } = spawnSync(ffmpeg, ["-hide_banner", "-i", webm, "-c:v", "copy", "-f", "webm", "-y", "/dev/null"], { encoding: "utf8" });
  const last = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN;
})();
const webmBytes = statSync(webm).size;
console.log(`\n${webm}: ${decodedSeconds.toFixed(1)} s, ${(webmBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`${gif}: ${pngs.length} frames, ${(gifBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`beats: ${order.map(name => `${name} ${lengths[name].toFixed(1)} s`).join(" · ")}${marks.replay10 ? ` (goal 10 cut before its instant replay, ${(marks.replay10 - marks.fever10).toFixed(2)} s after the release)` : ""}`);
assert.ok(webmBytes <= MAX_WEBM, `webm is ${webmBytes} bytes (cap ${MAX_WEBM})`);
assert.ok(gifBytes <= MAX_GIF, `gif is ${gifBytes} bytes (cap ${MAX_GIF})`);
console.log("PASS money shot recorded");
