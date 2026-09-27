// DEV ONLY — Part B game-feel captures from the Showroom (needs `npm run play:dev` running).
//   node dev/showroom/feel-shots.mjs [--out docs/screenshots/greatness] [--prefix after] [--reduced] [--only b1-goal,b2-post] [--seq] [--dump] [--scale 2]
// For each moment: a frame sequence sheet (every ~50 ms from the release, real time, so hit-stop and slow-mo show)
// a 4-frame strip around the result (1×) and the key frame ~120 ms after it (--scale, default 1×). Math.random is seeded per moment so before/after runs match.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const args = process.argv.slice(2), arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = arg("--out", "docs/screenshots/greatness"), prefix = arg("--prefix", "after"), reduced = args.includes("--reduced");
const only = arg("--only", "").split(",").filter(Boolean);
const url = process.env.SHOWROOM_URL ?? "http://localhost:5199/showroom/";
await mkdir(out, { recursive: true });

// id = a Showroom FEEL trigger (dev/showroom/main.ts); streak = Stage.streak before the kick (the Showroom counts goals on "resolved").
const MOMENTS = [
  { name: "b1-goal", id: "goal-rocket", stadium: "champions", streak: 0, seed: 11 },
  { name: "b1-strike", id: "goal-rocket", stadium: "pro", streak: 0, seed: 14, strike: true }, // frames around the boot contact
  { name: "b1-goal-park", id: "goal-rocket", stadium: "park", streak: 0, seed: 12 },
  { name: "b1-goal-pro", id: "goal-rocket", stadium: "pro", streak: 0, seed: 13 },
  { name: "b2-post", id: "post", stadium: "pro", streak: 0, seed: 21 },
  { name: "b2-bar", id: "bar", stadium: "park", streak: 0, seed: 22 },
  { name: "b2-fingertip", id: "fingertip", stadium: "park", streak: 0, seed: 23 },
  { name: "b2-so-close", id: "so-close", stadium: "pro", streak: 0, seed: 24 },
  { name: "b6-fever-3", id: "fever-3", stadium: "park", seed: 31 },
  { name: "b6-fever-5", id: "fever-5", stadium: "pro", seed: 32 },
  { name: "b6-fever-10", id: "fever-10", stadium: "champions", seed: 33 },
].filter(m => !only.length || only.includes(m.name));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForFunction(() => window.__showroom && document.fonts.status === "loaded");
await page.waitForTimeout(3500); await page.evaluate(() => window.__showroom.loadSample("7730"));
if (reduced) await page.evaluate(() => { const box = document.querySelector("#reduced"); box.checked = true; box.dispatchEvent(new Event("change")); });
await page.waitForTimeout(1200);

for (const m of MOMENTS) {
  await page.evaluate(({ stadium }) => { window.__showroom.setStadium(stadium); window.__showroom.toPenalty(); window.__showroom.stage.cancel(); window.__showroom.stage.streak = 0; }, m);
  await page.waitForTimeout(700);
  const result = await page.evaluate(async ({ id, seed, streak }) => {
    let s = seed >>> 0; Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const stage = window.__showroom.stage, canvas = document.querySelector("#stage");
    if (streak !== undefined) stage.streak = streak;
    let resolvedAt = -1; const prev = stage.onEvent;
    stage.onEvent = (event, data) => { if (event === "resolved" && resolvedAt < 0) resolvedAt = performance.now() - t0; prev(event, data); };
    const t0 = performance.now(); window.__showroom.feel ? window.__showroom.feel(id) : window.__showroom.goal();
    const frames = [];
    await new Promise(done => { let next = 250; const tick = () => { const t = performance.now() - t0; if (t >= next) { frames.push({ t: Math.round(t), url: canvas.toDataURL("image/png") }); next += 50; } if (t < 2300) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
    stage.onEvent = prev;
    return { frames, resolvedAt: Math.round(resolvedAt) };
  }, m);
  const key = result.frames.find(f => f.t >= result.resolvedAt + 120) ?? result.frames.at(-1);
  // Sheet: 8 columns at 1×, each frame labelled with its real-time ms since release (R = result).
  const sheet = await page.evaluate(async ({ frames, resolvedAt, title }) => {
    const cols = 8, w = 480, h = 320, label = 12, rows = Math.ceil(frames.length / cols);
    const canvas = document.createElement("canvas"); canvas.width = cols * w; canvas.height = rows * (h + label) + 18;
    const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false; c.fillStyle = "#12162b"; c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = "12px monospace"; c.fillStyle = "#ffd23f"; c.fillText(title, 6, 13);
    for (const [i, f] of frames.entries()) {
      const img = new Image(); img.src = f.url; await img.decode();
      const x = (i % cols) * w, y = 18 + Math.floor(i / cols) * (h + label);
      c.drawImage(img, x, y + label); c.fillStyle = resolvedAt >= 0 && f.t >= resolvedAt && f.t < resolvedAt + 50 ? "#ff5a6e" : "#9aa3d0";
      c.fillText(`${f.t} ms${resolvedAt >= 0 && f.t >= resolvedAt && f.t < resolvedAt + 50 ? " (R)" : ""}`, x + 4, y + 10);
    }
    return canvas.toDataURL("image/png");
  }, { frames: result.frames, resolvedAt: result.resolvedAt, title: `${m.name} · ${prefix}${reduced ? " · reduced motion" : ""} · result at ${result.resolvedAt} ms` });
  const scaled = await page.evaluate(async ([src, k]) => {
    const img = new Image(); img.src = src; await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = img.width * k; canvas.height = img.height * k;
    const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }, [key.url, Number(arg("--scale", "1"))]);
  // Strip: 4 frames around the result (just before, the freeze/punch, +250 ms, +600 ms) at 1×, side by side.
  const base = m.strike ? 400 : result.resolvedAt; // the strike is 0.4 s after release
  const pick = offsets => offsets.map(o => result.frames.reduce((best, f) => (Math.abs(f.t - base - o) < Math.abs(best.t - base - o) ? f : best)));
  const strip = await page.evaluate(async frames => {
    const canvas = document.createElement("canvas"); canvas.width = frames.length * 482; canvas.height = 334;
    const c = canvas.getContext("2d"); c.imageSmoothingEnabled = false; c.fillStyle = "#12162b"; c.fillRect(0, 0, canvas.width, canvas.height); c.font = "11px monospace";
    for (const [i, f] of frames.entries()) { const img = new Image(); img.src = f.url; await img.decode(); c.drawImage(img, i * 482, 14); c.fillStyle = "#ffd23f"; c.fillText(f.label, i * 482 + 4, 11); }
    return canvas.toDataURL("image/png");
  }, pick(m.strike ? [-50, 5, 50, 110] : [-60, 70, 250, 600]).map((f, i) => ({ url: f.url, label: `${(m.strike ? ["before contact", "contact", "+50 ms", "+110 ms"] : ["before result", "freeze + punch", "+250 ms", "+600 ms"])[i]} (${f.t} ms)` })));
  const tag = `${m.name}-${prefix}${reduced ? "-reduced" : ""}`;
  await writeFile(`${out}/${tag}-strip.png`, Buffer.from(strip.split(",")[1], "base64"));
  await writeFile(`${out}/${tag}.png`, Buffer.from(scaled.split(",")[1], "base64"));
  if (args.includes("--seq")) await writeFile(`${out}/${tag}-seq.png`, Buffer.from(sheet.split(",")[1], "base64")); // every 50 ms (large)
  if (args.includes("--dump")) for (const f of result.frames) await writeFile(`${out}/${tag}-f${String(f.t).padStart(4, "0")}.png`, Buffer.from(f.url.split(",")[1], "base64"));
  console.log(`${tag}: result at ${result.resolvedAt} ms, key frame ${key.t} ms, ${result.frames.length} frames`);
}
const meter = await page.evaluate(() => { const m = window.__frameMeter; return `${m.average.toFixed(2)} ms avg, ${m.p95.toFixed(2)} ms p95`; });
console.log(`Showroom Stage.render+update over the last 240 frames: ${meter}`);
await browser.close();
