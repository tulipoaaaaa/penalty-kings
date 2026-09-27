// Records a ~10 s clip of three fixed free kicks (18 m, 25 m, 32 m) in FULL motion with the game's own Stage
// and engine (scripts/lib/fk-clip.ts), using Playwright's page.screencast and its bundled ffmpeg (VP8/WebM).
// Prints each kick's engine flight time next to the flight time measured on screen (strike → resolve).
// Run by hand, not by CI:  node scripts/record-freekicks.mjs --out docs/media/fk-after.webm
import { existsSync, mkdtempSync, readdirSync, copyFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/media/fk-after.webm";
const MAX_BYTES = 3 * 1024 * 1024, WIDTH = 960, HEIGHT = 640;
const ffmpeg = (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const dir = existsSync(root) ? readdirSync(root).filter(name => name.startsWith("ffmpeg")).sort().pop() : undefined;
  const bin = dir && join(root, dir, "ffmpeg-linux");
  return bin && existsSync(bin) ? bin : null;
})();

const temporary = mkdtempSync(join(tmpdir(), "pk-fk-"));
await build({ entryPoints: [resolve("scripts/lib/fk-clip.ts")], bundle: true, format: "iife", platform: "browser", target: "es2022", outfile: join(temporary, "clip.js"), loader: { ".png": "dataurl", ".woff2": "dataurl" }, logLevel: "warning" });
writeFileSync(join(temporary, "index.html"), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{width:${WIDTH}px;height:${HEIGHT}px;image-rendering:pixelated;display:block}#caption{position:fixed;left:12px;bottom:12px;padding:6px 10px;background:#0b1020e6;color:#fff;font:600 15px/1.2 system-ui,sans-serif;border:2px solid #d4ff3a;border-radius:4px}</style><canvas></canvas><div id="caption"></div><script src="clip.js"></script>`);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, reducedMotion: "no-preference" })).newPage();
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
const raw = join(temporary, "raw.webm");
await page.goto("file://" + join(temporary, "index.html"));
await page.screencast.start({ path: raw, size: { width: WIDTH, height: HEIGHT } });
await page.waitForFunction(() => window.__fkClip?.done, null, { timeout: 30_000 });
await page.waitForTimeout(300);
const report = await page.evaluate(() => window.__fkClip.report);
await page.screencast.stop();
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
mkdirSync(dirname(out), { recursive: true });
let file = raw;
if (ffmpeg && statSync(raw).size > MAX_BYTES) {
  file = join(temporary, "small.webm");
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", raw, "-c:v", "libvpx", "-b:v", "1200k", "-crf", "12", "-an", "-y", file]);
}
copyFileSync(file, out);
console.table(report);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
