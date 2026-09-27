// DEV ONLY — B12 celebration frame strips from the Showroom (needs `npm run play:dev` running).
//   SHOWROOM_URL=http://localhost:5199/showroom/ node dev/showroom/celebration-shots.mjs [--out docs/screenshots/greatness] [--prefix after] [--reduced] [--only knee-slide,backflip] [--scale 2] [--sample 7730]
// For each celebration (and the three reactions): the Showroom loop is paused, the Stage is stepped at a fixed 1/60 s,
// and 6 frames around the Friend are cropped into one labelled strip (b12-<id>-<prefix>.png). Math.random is seeded so
// before/after runs match.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const args = process.argv.slice(2), arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = arg("--out", "docs/screenshots/greatness"), prefix = arg("--prefix", "after"), reduced = args.includes("--reduced");
const only = arg("--only", "").split(",").filter(Boolean), scale = Number(arg("--scale", "2"));
const url = process.env.SHOWROOM_URL ?? "http://localhost:5199/showroom/";
await mkdir(out, { recursive: true });

const sample = arg("--sample", "7730");
// Six frames on the beats: anticipation, action, landing/overshoot, mid, follow-through, settle.
const TIMES = { "knee-slide": [0.18, 0.32, 0.5, 1.0, 1.66, 2.25], "spin-point": [0.15, 0.5, 0.96, 1.05, 1.2, 2.4], backflip: [0.22, 0.45, 0.8, 1.14, 1.22, 2.4],
  "badge-kiss": [0.2, 0.4, 0.55, 0.8, 2.05, 2.4], "crowd-surf": [0.2, 0.35, 0.9, 1.4, 1.7, 2.4], disco: [0.18, 0.3, 0.55, 0.8, 2.2, 2.4],
  superhero: [0.2, 0.35, 0.55, 0.75, 0.9, 2.4], "trophy-lift": [0.25, 0.35, 0.5, 0.8, 1.2, 2.4] };
const MOMENTS = [
  ...["knee-slide", "spin-point", "backflip", "badge-kiss", "crowd-surf", "disco", "superhero", "trophy-lift"].map(id => ({ id, kind: "celebration", times: TIMES[id], up: id === "crowd-surf" ? 175 : id === "backflip" ? 130 : 80 })),
  ...["miss", "save", "post"].map(id => ({ id, kind: "reaction", times: [0.07, 0.14, 0.2, 0.36, 0.5, 1.5], up: 80 })),
].filter(m => !only.length || only.includes(m.id));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => window.__showroom && document.fonts.status === "loaded");
await page.waitForTimeout(3500); await page.evaluate(id => window.__showroom.loadSample(id), sample);
if (reduced) await page.evaluate(() => { const box = document.querySelector("#reduced"); box.checked = true; box.dispatchEvent(new Event("change")); });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__showroom.setStadium("pro"); window.__showroom.toPenalty(); window.__showroom.stage.cancel(); document.querySelector("#pause").click(); });
await page.waitForTimeout(300);

for (const m of MOMENTS) {
  const strip = await page.evaluate(async ({ id, kind, times, up, scale: fullScale, title }) => {
    const scale = up > 100 ? Math.max(1, fullScale / 2) : fullScale; // tall crops (the crowd behind) at 1× to stay under 150 KB
    let s = 7 >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const stage = window.__showroom.stage, canvas = document.querySelector("#stage"), ctx = canvas.getContext("2d");
    stage.cancel(); stage.particles.clear(); stage.update(1 / 60); stage.particles.clear();
    const home = stage.kickPose(99);
    if (kind === "celebration") stage.startCelebration(id); else stage.react(id);
    const cw = 160, ch = up + 22, cx = Math.round(home.x) - 45, cy = Math.round(home.y) - up, label = 12;
    const sheet = document.createElement("canvas"); sheet.width = times.length * cw * scale; sheet.height = ch * scale + label + 16;
    const c = sheet.getContext("2d"); c.imageSmoothingEnabled = false; c.fillStyle = "#12162b"; c.fillRect(0, 0, sheet.width, sheet.height);
    c.font = "12px monospace"; c.fillStyle = "#ffd23f"; c.fillText(title, 6, 13);
    let clock = 0;
    for (const [i, t] of times.entries()) {
      while (clock + 1e-9 < t) { stage.update(1 / 60); clock += 1 / 60; }
      stage.render(ctx);
      c.drawImage(canvas, cx, cy, cw, ch, i * cw * scale, 16, cw * scale, ch * scale);
      c.fillStyle = "#ffffff"; c.fillText(`t=${t.toFixed(2)}s`, i * cw * scale + 4, 16 + ch * scale + label - 1);
    }
    stage.cancel();
    return sheet.toDataURL("image/png");
  }, { ...m, scale, title: `B12 ${m.kind} ${m.id} — ${prefix}${reduced ? " (reduced motion)" : ""}` });
  const file = `${out}/b12-${m.id}-${prefix}${reduced ? "-reduced" : ""}${sample === "7730" ? "" : `-${sample}`}.png`;
  await writeFile(file, Buffer.from(strip.split(",")[1], "base64"));
  console.log(file);
}
await browser.close();
