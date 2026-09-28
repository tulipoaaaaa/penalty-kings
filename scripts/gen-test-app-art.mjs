// Generates the TEST APP's icons and iOS launch images (apps/mobile/web/public/icons/, committed) from the game's
// own pixel art: the Gold Ball sprite (games/penalty-kings/gfx/ball.ts, drawn procedurally, original design) on the
// game's pitch palette, with the heading face (Departure Mono subset shipped in games/penalty-kings/assets).
// Also the native shells' launcher icons, adaptive-icon layers and splash images (apps/mobile/android, apps/mobile/ios).
// Re-run only when the art changes:  node scripts/gen-test-app-art.mjs   (--native: the native shells' files only)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { shrinkPng } from "./lib/png-palette.mjs";

const ROOT = new URL("..", import.meta.url).pathname, OUT = join(ROOT, "apps/mobile/web/public/icons");
await mkdir(OUT, { recursive: true });
const bundle = await build({
  stdin: { resolveDir: ROOT, loader: "ts", sourcefile: "art.ts", contents: `
import { ballSprite, drawBallShadow } from "./games/penalty-kings/gfx/ball.ts";
const INK = "#0b0d1a", GRASS = ["#2e7d32", "#2a7330"], LINE = "#f7f7f2", GOLD = "#ffd23f", VOLT = "#ccff00";
/** A logical pixel scene (w × h), scaled by an integer and centred on a W × H canvas. */
(window as any).paint = async (W: number, H: number, output: "icon" | "maskable" | "splash" | "round" | "foreground" | "splash-contain", fill = 1) => {
  await document.fonts.load("16px PKHead");
  const kind = output === "round" || output === "foreground" ? "maskable" : output === "splash-contain" ? "splash" : output;
  const h = kind === "splash" ? 90 : 48, w = output === "splash-contain" ? 160 : kind === "splash" ? Math.round(h * W / H) : 48;
  const s = document.createElement("canvas"); s.width = w; s.height = h;
  const c = s.getContext("2d")!; c.imageSmoothingEnabled = false;
  c.fillStyle = INK; c.fillRect(0, 0, w, h);
  const pitchTop = kind === "splash" ? 46 : 14;
  for (let y = pitchTop; y < h; y += 4) { c.fillStyle = GRASS[((y - pitchTop) / 4) & 1]; c.fillRect(0, y, w, 4); }
  // Goal: posts, bar and a net grid (the game's white frame, pixel lines).
  const gw = kind === "splash" ? 70 : 34, gh = kind === "splash" ? 22 : 16, gx = Math.round((w - gw) / 2), gy = pitchTop - gh + (kind === "splash" ? 8 : 6);
  c.fillStyle = "#ffffff22"; for (let x = gx + 2; x < gx + gw; x += 3) c.fillRect(x, gy + 2, 1, gh - 2); for (let y = gy + 2; y < gy + gh; y += 3) c.fillRect(gx + 2, y, gw - 4, 1);
  c.fillStyle = LINE; c.fillRect(gx, gy, gw, 2); c.fillRect(gx, gy, 2, gh); c.fillRect(gx + gw - 2, gy, 2, gh);
  c.fillRect(0, gy + gh, w, 1);
  // The Gold Ball (rarity index 5) on the spot, with its pixel shadow.
  const size = kind === "splash" ? 18 : kind === "maskable" ? 16 : 20, bx = Math.round(w / 2), by = kind === "splash" ? 66 : 33;
  drawBallShadow(c, bx, by + Math.round(size / 2) + 1, size);
  const sprite = ballSprite(5, "S1", size, false)!;
  c.drawImage(sprite.canvas as CanvasImageSource, 2 * sprite.cell, 0, sprite.cell, sprite.cell, bx - Math.floor(sprite.cell / 2), by - Math.floor(sprite.cell / 2), sprite.cell, sprite.cell);
  if (kind === "splash") {
    c.font = "16px PKHead"; c.textAlign = "center"; c.textBaseline = "top";
    c.fillStyle = "#000"; c.fillText("PENALTY KINGS", w / 2 + 1, 5); c.fillStyle = VOLT; c.fillText("PENALTY KINGS", w / 2, 4);
    c.font = "8px PKHead"; c.fillStyle = INK; c.fillRect(w / 2 - 30, 78, 60, 11); c.fillStyle = GOLD; c.fillRect(w / 2 - 29, 79, 58, 9);
    c.fillStyle = INK; c.fillText("TEST BUILD", w / 2, 79);
  } else if (kind === "icon") {
    c.fillStyle = INK; c.fillRect(1, 37, 23, 10); c.fillStyle = GOLD; c.fillRect(2, 38, 21, 8); c.fillStyle = INK; c.font = "8px PKHead"; c.textBaseline = "top"; c.fillText("TEST", 3, 38);
  }
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const o = out.getContext("2d")!; o.imageSmoothingEnabled = false;
  // Round launcher icons and adaptive-icon foregrounds keep a transparent outside; everything else is on ink.
  if (output !== "round" && output !== "foreground") { o.fillStyle = INK; o.fillRect(0, 0, W, H); }
  // Nearest-neighbour: splash images cover the screen (centred crop), icons fill the square.
  if (output === "splash-contain") { const k = Math.max(1, Math.floor(Math.min(W * fill / w, H * fill / h))); o.drawImage(s, Math.round((W - w * k) / 2), Math.round((H - h * k) / 2), w * k, h * k); }
  else if (kind === "splash") { const cover = Math.max(W / w, H / h); o.drawImage(s, Math.round((W - w * cover) / 2), Math.round((H - h * cover) / 2), Math.ceil(w * cover), Math.ceil(h * cover)); }
  // Android adaptive icon: 108 dp layer, the launcher shows at most the centre 72 dp, so the art fills exactly that.
  else if (output === "foreground") { const inset = Math.round(W * 18 / 108); o.drawImage(s, inset, inset, W - 2 * inset, H - 2 * inset); }
  else if (output === "round") { o.beginPath(); o.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); o.clip(); o.drawImage(s, 0, 0, W, H); }
  else o.drawImage(s, 0, 0, W, H);
  return out.toDataURL("image/png");
};` },
  bundle: true, format: "iife", write: false, platform: "browser", target: "es2022", logLevel: "warning",
});
const font = (await readFile(join(ROOT, "games/penalty-kings/assets/departure-mono-pk-subset.woff2"))).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>@font-face{font-family:PKHead;src:url(data:font/woff2;base64,${font}) format("woff2")}</style><p style="font-family:PKHead">A</p>`);
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const WEB = [
  ["icon-192.png", 192, 192, "icon"], ["icon-512.png", 512, 512, "icon"], ["icon-maskable-512.png", 512, 512, "maskable"], ["apple-touch-icon.png", 180, 180, "icon"],
  ["splash-2532x1170.png", 2532, 1170, "splash"], ["splash-2556x1179.png", 2556, 1179, "splash"], ["splash-2796x1290.png", 2796, 1290, "splash"], ["splash-1334x750.png", 1334, 750, "splash"],
].map(([name, ...rest]) => [join(OUT, name), ...rest]);
// Native shells (apps/mobile/android + ios, Capacitor): launcher icons (legacy square + round, adaptive foreground on
// the ink background colour), pre-Android-12 splash drawables, the iOS App Store icon and launch image.
const RES = join(ROOT, "apps/mobile/android/app/src/main/res"), XC = join(ROOT, "apps/mobile/ios/App/App/Assets.xcassets");
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };
const NATIVE = [
  ...Object.entries(DENSITIES).flatMap(([d, k]) => [
    [join(RES, `mipmap-${d}/ic_launcher.png`), 48 * k, 48 * k, "icon"],
    [join(RES, `mipmap-${d}/ic_launcher_round.png`), 48 * k, 48 * k, "round"],
    [join(RES, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, "foreground"],
    [join(RES, `drawable-land-${d}/splash.png`), SPLASH[d][0], SPLASH[d][1], "splash"],
    [join(RES, `drawable-port-${d}/splash.png`), SPLASH[d][1], SPLASH[d][0], "splash-contain", 0.9],
  ]),
  [join(RES, "drawable/splash.png"), 480, 320, "splash"],
  [join(XC, "AppIcon.appiconset/AppIcon-512@2x.png"), 1024, 1024, "icon"],
  // LaunchScreen.storyboard aspect-fills a 1366 pt square: only its centre ~46 % shows on a phone in either
  // orientation, so the scene sits in the middle 35 %. Same file for 1x/2x/3x (the Capacitor template's layout).
  ...["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"].map(name => [join(XC, `Splash.imageset/${name}`), 2732, 2732, "splash-contain", 0.35]),
];
const TARGETS = [...(process.argv.includes("--native") ? [] : WEB), ...NATIVE];
for (const [path, width, height, kind, fill] of TARGETS) {
  const url = await page.evaluate(([W, H, k, f]) => window.paint(W, H, k, f), [width, height, kind, fill ?? 1]);
  const raw = Buffer.from(url.split(",")[1], "base64");
  // Palette PNG (no alpha) for opaque art; transparent layers keep the browser's RGBA PNG.
  const png = kind === "round" || kind === "foreground" ? raw : shrinkPng(raw);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  console.log(`${relative(ROOT, path)} ${width}×${height} ${(png.length / 1024).toFixed(1)} KB`);
}
await browser.close();
