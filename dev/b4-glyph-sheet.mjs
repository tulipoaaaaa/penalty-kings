// B4: before/after glyph sheet for docs/screenshots/greatness/b4-*.png (dev only, not shipped).
// Before = Pixelify Sans alone; after = the real @font-face set from games/penalty-kings/style.css (Departure Mono
// digits via unicode-range, PKHead headings). The canvas rows draw the Stage scoreboard, a target value and the
// shot clock the old way (8px fillText) and the new way (glyphText, 4×5 bitmap digits).
// Usage: node dev/b4-glyph-sheet.mjs [outdir]
import { chromium } from "playwright";
import { build } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname, out = process.argv[2] || `${root}docs/screenshots/greatness`;
mkdirSync(out, { recursive: true });
const asset = name => `data:font/woff2;base64,${readFileSync(`${root}games/penalty-kings/assets/${name}`).toString("base64")}`;
const faces = readFileSync(`${root}games/penalty-kings/style.css`, "utf8").match(/@font-face[^}]+}/g).join("\n").replace(/url\("\.\/assets\/([^"]+)"\)/g, (_, name) => `url("${asset(name)}")`);
const before = `@font-face{font-family:PixelifySans;font-weight:400;src:url("${asset("pixelify-sans-latin-400-normal.woff2")}")}@font-face{font-family:PixelifySans;font-weight:700;src:url("${asset("pixelify-sans-latin-700-normal.woff2")}")}`;
const glyphs = (await build({ entryPoints: [`${root}games/penalty-kings/gfx/stadium.ts`], bundle: true, format: "iife", globalName: "PKG", write: false, logLevel: "error" })).outputFiles[0].text;

const LINES = [
  ["Pack summary", "Spent 20 RF on 2 balls · Net −20 RF · 2 Scuffed Balls"],
  ["Pot banner", "🏆 500,000 RF ≈ $728 · ends in 0d 5h 43m"],
  ["HUD", "LV 2 · 44/200 XP · kick 1/5 · 12 s left · Bag 8"],
  ["Odds line", "Odds per ball: 31.5% · 27% · 20% · 11% · 7% · 2.5% · 1%"],
  ["Tiers", "Park 10 RF · Pro 1,000 RF · Champions 10,000 RF · ×1.5 · +50%"],
  ["Market", "S1 · Park · 50 RF · floor 25 RF · 0/12 stamped"],
];
const page = (fontCss, label, head) => `<!doctype html><meta charset="utf-8"><style>${fontCss}
body{margin:0;padding:14px 18px;background:#0b0d1a;color:#f7f7f2;font-family:PixelifySans,monospace;width:900px}
h1{font:700 12px monospace;color:#9aa3d0;margin:0 0 8px;letter-spacing:.1em} .row{display:grid;grid-template-columns:120px 1fr;align-items:baseline;gap:8px;margin:5px 0}
.row i{font:11px monospace;color:#9aa3d0;font-style:normal} .row b{font-size:15px;font-weight:400} .row b.bold{font-weight:700;font-size:13px}
h2{font:${head};color:#ffd23f;text-transform:uppercase;margin:12px 0 4px;text-shadow:2px 2px 0 #000}
.tile{display:inline-grid;justify-items:center;margin:6px 8px 0 0;padding:6px 10px;border:2px solid #ffd23f;box-shadow:2px 2px 0 #000;background:#1b2147}
.tile b{font:700 24px PixelifySans;color:#ffd23f} .tile span{font-size:11px;color:#9aa3d0} canvas{image-rendering:pixelated;display:block;margin-top:10px}
</style><h1>${label}</h1>
${LINES.map(([k, v]) => `<div class="row"><i>${k}</i><b>${v}</b></div><div class="row"><i></i><b class="bold">${v}</b></div>`).join("")}
<h2>Cups · Scouting Book · Ball shop · Collection</h2>
<div class="tile"><b>20 RF</b><span>SPENT</span></div><div class="tile"><b>0 RF</b><span>PULLED</span></div><div class="tile"><b>−20 RF</b><span>NET</span></div><div class="tile"><b>+120</b><span>POINTS</span></div>
<canvas id="c" width="300" height="34" style="width:900px;height:102px"></canvas>`;

const browser = await chromium.launch();
for (const [name, css, label, head, newCanvas] of [
  ["before", before, "BEFORE (Pixelify Sans only) · canvas: 8px fillText", "700 17px/1.1 PixelifySans", false],
  ["after", faces, "AFTER (B4: Departure Mono digits via unicode-range, PKHead headings) · canvas: GLYPHS bitmap digits", "400 17px/1.1 PKHead, PixelifySans", true],
]) {
  const p = await browser.newPage({ viewport: { width: 936, height: 520 } });
  await p.setContent(page(css, label, head));
  await p.addScriptTag({ content: glyphs });
  await p.evaluate(async fresh => {
    await document.fonts.load("8px PixelifySans", "0123456789SCORE"); await document.fonts.load("bold 8px PixelifySans", "0123456789"); await document.fonts.ready;
    const c = document.getElementById("c").getContext("2d"); c.imageSmoothingEnabled = false;
    const { glyphText, glyphCols } = window.PKG;
    // The Stage scoreboard (Pro colours), score 00120 and "3 IN A ROW".
    const x = 2, y = 2; c.fillStyle = "#0b0d1a"; c.fillRect(x - 1, y - 1, 90, 30); c.fillStyle = "#0b0d1a"; c.fillRect(x, y, 88, 18);
    const text = "00120";
    if (!fresh) {
      c.fillStyle = "#ccff00"; c.font = "8px PixelifySans, monospace"; c.textBaseline = "top"; c.fillText("SCORE", x + 4, y + 5);
      for (let i = 0; i < 5; i++) { const dx = x + 38 + i * 9; c.fillStyle = "#00000055"; c.fillRect(dx - 1, y + 3, 8, 12); c.fillStyle = "#ccff00"; c.fillText(text[i], dx + 1, y + 5); }
      c.fillStyle = "#ff8c00"; c.fillText("3 IN A ROW", x + 4, y + 21);
    } else {
      glyphText(c, "SCORE", x + 3, y + 7, 1, "#ccff00");
      for (let i = 0; i < 5; i++) { const dx = x + 31 + i * 11; c.fillStyle = "#00000055"; c.fillRect(dx, y + 3, 10, 12); glyphText(c, text[i], dx + 1, y + 4, 2, "#ccff00"); }
      glyphText(c, "3 IN A ROW", x + 4, y + 22, 1, "#0b0d1a"); glyphText(c, "3 IN A ROW", x + 3, y + 21, 1, "#ff8c00");
    }
    // Target practice values (on a pale ring) and the shot-clock count.
    [100, 200, 500].forEach((v, i) => {
      const cx = 120 + i * 34, cy = 16; c.fillStyle = i === 2 ? "#ffd23f" : "#dfe7ff"; c.beginPath(); c.ellipse(cx, cy, 14, 12, 0, 0, Math.PI * 2); c.fill();
      if (!fresh) { c.fillStyle = "#0b0d1a"; c.font = "bold 8px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(v), cx, cy); c.textAlign = "left"; }
      else glyphText(c, String(v), Math.round(cx - glyphCols(String(v)) / 2), cy - 2, 1, "#0b0d1a");
    });
    for (const [i, n] of [5, 2, 8].entries()) {
      const cx = 240 + i * 20, cy = 16; c.strokeStyle = "#ccff00"; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 7, 0, Math.PI * 2); c.stroke();
      if (!fresh) { c.fillStyle = "#f7f7f2"; c.font = "bold 8px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n), cx, cy); c.textAlign = "left"; }
      else glyphText(c, String(n), cx - 2, cy - 2, 1, "#f7f7f2");
    }
  }, newCanvas);
  await p.screenshot({ path: `${out}/b4-glyphs-${name}.png`, fullPage: true });
  await p.close();
}
await browser.close();
console.log(`wrote ${out}/b4-glyphs-before.png and b4-glyphs-after.png`);
