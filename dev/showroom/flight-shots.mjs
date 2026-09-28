// DEV ONLY — B11 mid-flight strips from the Showroom (needs `npm run play:dev` running).
//   SHOWROOM_URL=http://localhost:5199/showroom/ node dev/showroom/flight-shots.mjs [--out docs/screenshots/greatness] [--prefix after] [--reduced]
// A left-side penalty save and a left-side free-kick save (real engine outcomes, Math.random seeded so before/after
// runs match). The Showroom loop is paused, the Stage is stepped at a fixed 1/60 s and four frames are captured:
// just after contact, mid-flight, the crossing, and the reaction (b11-<kind>-<prefix>.png).
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const args = process.argv.slice(2), arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = arg("--out", "docs/screenshots/greatness"), prefix = arg("--prefix", "after"), reduced = args.includes("--reduced");
const url = process.env.SHOWROOM_URL ?? "http://localhost:5199/showroom/";
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => window.__showroom && document.fonts.status === "loaded");
await page.waitForTimeout(3500); await page.evaluate(() => window.__showroom.loadSample("7730"));
if (reduced) await page.evaluate(() => { const box = document.querySelector("#reduced"); box.checked = true; box.dispatchEvent(new Event("change")); });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__showroom.setStadium("pro"); window.__showroom.toPenalty(); window.__showroom.stage.cancel(); document.querySelector("#pause").click(); });
await page.waitForTimeout(300);

for (const kind of ["penalty", "freekick"]) {
  const strip = await page.evaluate(async ({ kind, title }) => {
    let s = 11 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const room = window.__showroom, stage = room.stage, canvas = document.querySelector("#stage"), ctx = canvas.getContext("2d");
    stage.cancel(); stage.particles.clear(); stage.update(1 / 60); stage.particles.clear();
    const outcome = kind === "penalty" ? room.leftPenalty("save") : room.leftFreeKick("save");
    const flight = kind === "penalty" ? 0.35 + 0.2 * Math.min(1, Math.max(0, (outcome.target.time - 0.4) / 0.55)) : Math.max(0.3, outcome.path[outcome.path.length - 1].t);
    const strike = 0.4, times = [[strike + 0.08, "contact+0.08"], [strike + flight * 0.55, "mid-flight"], [strike + flight, "crossing"], [strike + flight + 0.4, "reaction"]];
    // Crop (Stage px) around the goal and the Friend; drawn at 2× Stage px (the canvas backing store is 2×).
    const crop = kind === "penalty" ? { x: 142, y: 172, w: 196, h: 124 } : { x: 160, y: 146, w: 190, h: 170 };
    const cw = crop.w, ch = crop.h, scale = 2, label = 14, k = canvas.width / 480;
    const sheet = document.createElement("canvas"); sheet.width = 2 * cw * scale; sheet.height = 2 * (ch * scale + label) + 16;
    const c = sheet.getContext("2d"); c.imageSmoothingEnabled = false; c.fillStyle = "#12162b"; c.fillRect(0, 0, sheet.width, sheet.height);
    c.font = "12px monospace"; c.fillStyle = "#ffd23f"; c.fillText(title, 6, 13);
    let clock = 0;
    for (const [i, [t, name]] of times.entries()) {
      while (clock + 1e-9 < t) { stage.update(1 / 60); clock += 1 / 60; }
      stage.render(ctx);
      const x = (i % 2) * cw * scale, y = 16 + Math.floor(i / 2) * (ch * scale + label);
      c.drawImage(canvas, crop.x * k, crop.y * k, cw * k, ch * k, x, y, cw * scale, ch * scale);
      c.fillStyle = "#ffffff"; c.fillText(`${name}  t=${t.toFixed(2)}s`, x + 4, y + ch * scale + label - 3);
    }
    stage.cancel();
    return sheet.toDataURL("image/png");
  }, { kind, title: `B11 ${kind} left-side save — ${prefix}${reduced ? " (reduced motion)" : ""}` });
  const file = `${out}/b11-${kind}-${prefix}${reduced ? "-reduced" : ""}.png`;
  await writeFile(file, Buffer.from(strip.split(",")[1], "base64"));
  console.log(file);
}
await browser.close();
