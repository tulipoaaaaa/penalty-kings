// DEV ONLY — atmosphere (crowd band + floodlight pool) frames from the Showroom (needs `npm run play:dev` running).
//   SHOWROOM_URL=http://localhost:5199/showroom/ node dev/showroom/atmos-shots.mjs --raw <dir> --prefix before|after
//   node dev/showroom/atmos-shots.mjs --compose <dir> [--out docs/screenshots/greatness]
// --raw: the Showroom loop is paused, Math.random seeded, a left-side penalty save is played and the Stage stepped at
// 1/60 s to just after the strike (the kick moment); one frame per scene is saved as <prefix>-<scene>.png (Stage px).
// --compose: pairs before/after crops around the goal side by side (--x --y --w --h Stage px, --scale) → atmos-<scene>.png.
import { chromium } from "playwright";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";

/**
 * A lossless PNG, smaller than the canvas encoder's: 8-bit palette when a frame has ≤ 256 colours,
 * else RGB with a per-row adaptive filter; deflate level 9.
 */
function compactPng(w, h, rgba) {
  const map = new Map(), palette = [], index = new Uint8Array(w * h);
  for (let i = 0; i < w * h && palette.length <= 256; i++) {
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let n = map.get(key); if (n === undefined) { n = palette.length; map.set(key, n); palette.push(key); }
    index[i] = n;
  }
  const indexed = palette.length <= 256, bpp = indexed ? 1 : 3, stride = w * bpp;
  const rows = Array.from({ length: h }, (_, y) => {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) if (indexed) row[x] = index[y * w + x]; else for (let k = 0; k < 3; k++) row[x * 3 + k] = rgba[(y * w + x) * 4 + k];
    return row;
  });
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const cur = rows[y], prev = y ? rows[y - 1] : Buffer.alloc(stride);
    let best = null, bestScore = Infinity;
    for (let f = 0; f < (indexed ? 1 : 5); f++) {
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        out[i] = (cur[i] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
      }
      const score = out.reduce((sum, v) => sum + (v < 128 ? v : 256 - v), 0);
      if (score < bestScore) { bestScore = score; best = [f, out]; }
    }
    raw[y * (stride + 1)] = best[0]; best[1].copy(raw, y * (stride + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = indexed ? 3 : 2;
  const chunks = [chunk("IHDR", ihdr)];
  if (indexed) chunks.push(chunk("PLTE", Buffer.from(palette.flatMap(k => [k >> 16, (k >> 8) & 255, k & 255]))));
  chunks.push(chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

const args = process.argv.slice(2), arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const SCENES = [["park", "park", "sun"], ["pro", "pro", "rain"], ["champions", "champions", "sun"], ["champions-snow", "champions", "snow"]];
const url = process.env.SHOWROOM_URL ?? "http://localhost:5199/showroom/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

if (args.includes("--raw")) {
  const dir = arg("--raw"), prefix = arg("--prefix", "after");
  await mkdir(dir, { recursive: true });
  await page.goto(url);
  await page.waitForFunction(() => window.__showroom && document.fonts.status === "loaded");
  await page.waitForTimeout(3500); await page.evaluate(() => window.__showroom.loadSample("7730"));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__showroom.toPenalty(); window.__showroom.stage.cancel(); document.querySelector("#pause").click(); });
  for (const [scene, stadium, weather] of SCENES) {
    const data = await page.evaluate(({ stadium, weather }) => {
      let s = 11 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const room = window.__showroom, stage = room.stage, canvas = document.querySelector("#stage"), ctx = canvas.getContext("2d");
      room.setStadium(stadium); stage.weather = weather;
      stage.cancel(); stage.particles.clear(); stage.update(1 / 60); stage.particles.clear();
      room.leftPenalty("save");
      for (let clock = 0; clock < 0.52; clock += 1 / 60) stage.update(1 / 60); // strike at 0.4 s: the ball has just left the boot
      stage.render(ctx);
      const k = canvas.width / 480, out = document.createElement("canvas"); out.width = 480; out.height = 320;
      const o = out.getContext("2d"); o.imageSmoothingEnabled = false; o.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 480, 320);
      stage.cancel(); void k;
      return out.toDataURL("image/png");
    }, { stadium, weather });
    const file = `${dir}/${prefix}-${scene}.png`;
    await writeFile(file, Buffer.from(data.split(",")[1], "base64")); console.log(file);
  }
}

if (args.includes("--compose")) {
  const dir = arg("--compose"), out = arg("--out", "docs/screenshots/greatness");
  await mkdir(out, { recursive: true });
  await page.setContent("<body></body>");
  for (const [scene] of SCENES) {
    const [before, after] = await Promise.all(["before", "after"].map(p => readFile(`${dir}/${p}-${scene}.png`).then(b => `data:image/png;base64,${b.toString("base64")}`)));
    const data = await page.evaluate(async ({ before, after, scene, crop, k }) => {
      const load = async src => { const img = new Image(); img.src = src; await img.decode(); return img; };
      const head = 18, gap = 4, canvas = document.createElement("canvas"); canvas.width = 2 * crop.w * k + gap; canvas.height = crop.h * k + head;
      const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false; c.fillStyle = "#12162b"; c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(await load(before), crop.x, crop.y, crop.w, crop.h, 0, head, crop.w * k, crop.h * k);
      c.drawImage(await load(after), crop.x, crop.y, crop.w, crop.h, crop.w * k + gap, head, crop.w * k, crop.h * k);
      c.font = "12px monospace"; c.fillStyle = "#ffd23f"; c.fillText(`${scene} · before`, 6, 13); c.fillText(`${scene} · after`, crop.w * k + gap + 6, 13);
      return { w: canvas.width, h: canvas.height, px: Array.from(c.getImageData(0, 0, canvas.width, canvas.height).data) };
    }, { before, after, scene, crop: { x: Number(arg("--x", 96)), y: Number(arg("--y", 84)), w: Number(arg("--w", 288)), h: Number(arg("--h", 200)) }, k: Number(arg("--scale", 2)) });
    const file = `${out}/atmos-${scene}.png`, png = compactPng(data.w, data.h, Uint8Array.from(data.px));
    await writeFile(file, png); console.log(`${file} ${(png.length / 1024).toFixed(0)} KB`);
  }
}
await browser.close();
