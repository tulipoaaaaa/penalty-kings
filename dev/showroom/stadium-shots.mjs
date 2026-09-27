// DEV ONLY — screenshots of the three stadiums from the Showroom (needs `npm run play:dev` running).
//   node dev/showroom/stadium-shots.mjs [--out docs/screenshots] [--extra]
// Writes stadium-{park,pro,champions}.png (penalty view, 2×) and stadiums.png (penalty row + free-kick row).
// --extra also writes goal-moment shots (stadium-{pro,champions}-goal.png) and a reduced-motion frame.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/screenshots";
const extra = args.includes("--extra");
const url = process.env.SHOWROOM_URL ?? "http://localhost:5199/showroom/";
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => window.__showroom && document.fonts.status === "loaded");
await page.waitForTimeout(1500);
const grab = () => page.evaluate(() => document.querySelector("#stage").toDataURL("image/png"));
const save = async (name, dataUrl) => { await writeFile(`${out}/${name}`, Buffer.from(dataUrl.split(",")[1], "base64")); console.log(`wrote ${out}/${name}`); };
const scaled = (dataUrl, scale) => page.evaluate(async ([src, k]) => {
  const img = new Image(); img.src = src; await img.decode();
  const canvas = document.createElement("canvas"); canvas.width = img.width * k; canvas.height = img.height * k;
  const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}, [dataUrl, scale]);

const shots = {};
for (const id of ["park", "pro", "champions"]) {
  await page.evaluate(stadium => { window.__showroom.setStadium(stadium); window.__showroom.toPenalty(); }, id);
  await page.waitForTimeout(4200); // a full FrameMeter window (240 frames) in this stadium
  const penalty = await grab();
  console.log(`${id}: Stage.render ${await page.evaluate(() => { const m = window.__frameMeter; return `${m.average.toFixed(2)} ms avg, ${m.p95.toFixed(2)} ms p95`; })} (penalty view, idle)`);
  await page.evaluate(() => window.__showroom.freeKickView());
  await page.waitForTimeout(900);
  const freeKick = await grab();
  await page.evaluate(() => window.__showroom.toPenalty());
  shots[id] = { penalty, freeKick };
  await save(`stadium-${id}.png`, await scaled(penalty, 2));
}

const sheet = await page.evaluate(async list => {
  const load = async src => { const img = new Image(); img.src = src; await img.decode(); return img; };
  const W = 480, H = 320, gap = 8, head = 22, rowLabel = 16;
  const canvas = document.createElement("canvas"); canvas.width = 3 * W + 4 * gap; canvas.height = head + 2 * (H + rowLabel) + 3 * gap;
  const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false;
  c.fillStyle = "#0b0d1a"; c.fillRect(0, 0, canvas.width, canvas.height);
  c.font = "14px PixelifySans, monospace"; c.textBaseline = "middle";
  const names = { park: "PARK · Sunday League", pro: "PRO · Floodlit Bowl", champions: "CHAMPIONS · Golden Arena" };
  let i = 0;
  for (const [id, shot] of Object.entries(list)) {
    const x = gap + i * (W + gap);
    c.fillStyle = "#ffd23f"; c.fillText(names[id], x, head / 2 + 2);
    c.fillStyle = "#9aa3d0"; c.font = "11px PixelifySans, monospace";
    c.fillText("penalty view", x, head + gap + rowLabel / 2); c.drawImage(await load(shot.penalty), x, head + gap + rowLabel);
    c.fillText("free-kick view", x, head + 2 * gap + H + rowLabel * 1.5); c.drawImage(await load(shot.freeKick), x, head + 2 * gap + H + 2 * rowLabel);
    c.font = "14px PixelifySans, monospace"; i++;
  }
  return canvas.toDataURL("image/png");
}, shots);
await save("stadiums.png", sheet);

if (extra) {
  for (const [id, wait] of [["pro", 900], ["champions", 1700]]) {
    await page.evaluate(stadium => { window.__showroom.setStadium(stadium); window.__showroom.goal(); }, id);
    await page.waitForTimeout(1000); // run-up + flight: the ball is in the net ~1 s after the shot
    await page.waitForTimeout(wait);
    await save(`stadium-${id}-goal.png`, await scaled(await grab(), 2));
    await page.waitForTimeout(2500);
    console.log(`${id} goal: Stage.render ${await page.evaluate(() => { const m = window.__frameMeter; return `${m.average.toFixed(2)} ms avg, ${m.p95.toFixed(2)} ms p95`; })} (last 4 s, through the celebration)`);
  }
}
await browser.close();
