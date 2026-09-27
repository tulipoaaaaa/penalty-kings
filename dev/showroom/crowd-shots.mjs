// DEV ONLY — close-up screenshots of the Friends crowd from the Showroom (needs `npm run play:dev` running).
//   node dev/showroom/crowd-shots.mjs [--out docs/screenshots] [--sample 7730]
// Writes crowd-{park,pro,champions}.png: the penalty view (2×), then the stands ×4 at rest and
// mid-goal (the hop ripple, scarves up, flags waving), and prints Stage.render times per stadium.
// The Friend comes from the chain (the Showroom's default read); if the chain can't be reached, from
// the SDK's recorded canonical sample (--sample, default 7730). The sheet says which.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/screenshots";
const sample = args.includes("--sample") ? args[args.indexOf("--sample") + 1] : "7730";
const url = process.env.SHOWROOM_URL ?? "http://localhost:5199/showroom/";
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => window.__showroom && document.fonts.status === "loaded");
// The Showroom reads its default Friend from the chain at start-up.
await page.waitForFunction(() => /loaded from chain|not loaded/.test(window.__showroom.friend() ?? ""), null, { timeout: 30_000 }).catch(() => {});
let source = await page.evaluate(() => window.__showroom.friend());
if (!/loaded from chain/.test(source ?? "")) { await page.evaluate(id => window.__showroom.loadSample(id), sample); source = await page.evaluate(() => window.__showroom.friend()); }
console.log(`Friend: ${source}`);

const grab = () => page.evaluate(() => document.querySelector("#stage").toDataURL("image/png"));
const meter = () => page.evaluate(() => { const m = window.__frameMeter; return `${m.average.toFixed(2)} ms avg, ${m.p95.toFixed(2)} ms p95`; });
const REGION = { park: { x: 150, y: 58, w: 180, h: 44 }, pro: { x: 150, y: 20, w: 180, h: 70 }, champions: { x: 120, y: 34, w: 180, h: 62 } };

for (const id of ["park", "pro", "champions"]) {
  await page.evaluate(stadium => { window.__showroom.setStadium(stadium); window.__showroom.toPenalty(); }, id);
  await page.waitForTimeout(4200); // a full FrameMeter window (240 frames), idle
  const idleTime = await meter();
  const idle = await grab();
  await page.evaluate(() => window.__showroom.crowd("cheer"));
  await page.waitForTimeout(650); // the hop ripple has reached the ends of the stand
  const cheer = await grab();
  await page.waitForTimeout(3600);
  const cheerTime = await meter();
  const census = await page.evaluate(() => window.__showroom.census());
  const drop = await page.evaluate(() => window.__showroom.drop);
  console.log(`${id}: Stage.render ${idleTime} (idle) · ${cheerTime} (through a goal ripple) · ${census.friends} Friends, ${census.humans} humans, ${census.flags} flag-wavers, ${census.bigFlags} PK flags, ${census.banners} banners`);
  const sheet = await page.evaluate(async ([idle, cheer, region, label]) => {
    const load = async src => { const img = new Image(); img.src = src; await img.decode(); return img; };
    const [a, b] = [await load(idle), await load(cheer)], zoom = 4, head = 24, gap = 8;
    const full = 2, fw = 480 * full, zw = region.w * zoom, zh = region.h * zoom;
    const canvas = document.createElement("canvas"); canvas.width = Math.max(fw, zw * 2 + gap) + gap * 2; canvas.height = head + 320 * full + gap * 3 + head + zh;
    const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b0d1a"; c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = "14px PixelifySans, monospace"; c.textBaseline = "middle"; c.fillStyle = "#ffd23f";
    c.fillText(label, gap, head / 2);
    c.drawImage(a, gap, head, fw, 320 * full);
    const y = head + 320 * full + gap * 2;
    c.fillStyle = "#9aa3d0"; c.font = "12px PixelifySans, monospace";
    c.fillText("stands ×4, at rest", gap, y + head / 2 - 4); c.fillText("stands ×4, 0.65 s after a goal", gap * 2 + zw, y + head / 2 - 4);
    c.drawImage(a, region.x, region.y, region.w, region.h, gap, y + head, zw, zh);
    c.drawImage(b, region.x, region.y, region.w, region.h, gap * 2 + zw, y + head, zw, zh);
    c.strokeStyle = "#ffd23f"; c.strokeRect(gap + region.x * full + 0.5, head + region.y * full + 0.5, region.w * full, region.h * full);
    return canvas.toDataURL("image/png");
  }, [idle, cheer, { ...REGION[id], y: REGION[id].y + drop }, `${id.toUpperCase()} · crowd of little Friends · ${source}`]);
  await writeFile(`${out}/crowd-${id}.png`, Buffer.from(sheet.split(",")[1], "base64"));
  console.log(`wrote ${out}/crowd-${id}.png`);
}
await browser.close();
