// Generates the TEST APP's icons and iOS launch images (apps/mobile/web/public/icons/, committed) from the game's
// own pixel art: the Gold Ball sprite (games/penalty-kings/gfx/ball.ts, drawn procedurally, original design) on the
// game's pitch palette, with the heading face (Departure Mono subset shipped in games/penalty-kings/assets).
// Re-run only when the art changes:  node scripts/gen-test-app-art.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
(window as any).paint = async (W: number, H: number, kind: "icon" | "maskable" | "splash") => {
  await document.fonts.load("16px PKHead");
  const h = kind === "splash" ? 90 : 48, w = kind === "splash" ? Math.round(h * W / H) : 48;
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
  const o = out.getContext("2d")!; o.imageSmoothingEnabled = false; o.fillStyle = INK; o.fillRect(0, 0, W, H);
  // Nearest-neighbour: splash images cover the screen (centred crop), icons fill the square.
  if (kind === "splash") { const cover = Math.max(W / w, H / h); o.drawImage(s, Math.round((W - w * cover) / 2), Math.round((H - h * cover) / 2), Math.ceil(w * cover), Math.ceil(h * cover)); }
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
const TARGETS = [
  ["icon-192.png", 192, 192, "icon"], ["icon-512.png", 512, 512, "icon"], ["icon-maskable-512.png", 512, 512, "maskable"], ["apple-touch-icon.png", 180, 180, "icon"],
  ["splash-2532x1170.png", 2532, 1170, "splash"], ["splash-2556x1179.png", 2556, 1179, "splash"], ["splash-2796x1290.png", 2796, 1290, "splash"], ["splash-1334x750.png", 1334, 750, "splash"],
];
for (const [name, width, height, kind] of TARGETS) {
  const url = await page.evaluate(([W, H, k]) => window.paint(W, H, k), [width, height, kind]);
  const png = shrinkPng(Buffer.from(url.split(",")[1], "base64"));
  await writeFile(join(OUT, name), png);
  console.log(`${name} ${width}×${height} ${(png.length / 1024).toFixed(1)} KB`);
}
await browser.close();
