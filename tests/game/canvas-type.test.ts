import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FeelFx } from "../../games/penalty-kings/gfx/feel.ts";
import { drawPenaltyWait, drawSealedPack } from "../../games/penalty-kings/gfx/waits.ts";
import { HEAD_FACE, headFont } from "../../games/penalty-kings/gfx/core.ts";
import { RARITY_FX } from "../../games/penalty-kings/gfx/ball.ts";

// Polish: Pixelify's BOLD uppercase C closes into an O on the canvas ("OLANG!", "SO OLOSE!", "HAT-TRIOK!",
// "SOUFFED BALL"). Canvas headings use the clear heading face (PKHead = Departure Mono, declared in style.css,
// the same face the DOM headings use since B4). The browser check in scripts/test-game.mjs renders C and O in it.

const GFX = new URL("../../games/penalty-kings/gfx/", import.meta.url).pathname;

/** A 2D context that records the font in force for every fillText. */
function recorder() {
  const texts: Array<{ text: string; font: string }> = [];
  let font = "10px sans-serif";
  const gradient = { addColorStop() {} };
  const context: Record<string, unknown> = new Proxy({}, {
    get: (_t, key) => key === "font" ? font : key === "fillText" ? (text: string) => texts.push({ text, font })
      : key === "measureText" ? (text: string) => ({ width: text.length * 6 })
      : key === "createRadialGradient" || key === "createLinearGradient" ? () => gradient : () => undefined,
    set: (_t, key, value) => { if (key === "font") font = value; return true; },
  });
  return { context: context as unknown as CanvasRenderingContext2D, texts };
}
const BOLD_PIXELIFY = /\b(bold|[6-9]00)\b[^,]*PixelifySans/;

test("the heading face is PKHead first, falling back to Pixelify, never bold (PKHead has one weight: no synthetic bold)", () => {
  assert.match(HEAD_FACE, /^PKHead, PixelifySans/);
  assert.equal(headFont(16), `16px ${HEAD_FACE}`);
  assert.doesNotMatch(headFont(16), /bold/);
  const css = readFileSync(new URL("../../games/penalty-kings/style.css", import.meta.url), "utf8");
  assert.match(css, /@font-face \{ font-family: PKHead; src: url\("\.\/assets\/departure-mono-pk-subset\.woff2"\)/, "style.css declares PKHead (canvas uses it once loaded)");
});

test("near-miss and fever chips (CLANG! / SO CLOSE! / HAT-TRICK!) draw in the heading face", () => {
  for (const [text, sub, hot] of [["CLANG!", "SO CLOSE!", false], ["HAT-TRICK!", "3 IN A ROW", true], ["TIPPED!", "FINGERTIP SAVE", false]] as const) {
    const fx = new FeelFx(), { context, texts } = recorder();
    fx.say(text, sub, hot); fx.update(0.5);
    for (const reduced of [false, true]) fx.drawUI(context, reduced, 1);
    assert.ok(texts.some(t => t.text === text) && texts.some(t => t.text === sub), `${text}: both lines drawn`);
    for (const t of texts) {
      assert.ok(t.font.includes(HEAD_FACE), `${t.text} drawn in ${t.font}`);
      assert.doesNotMatch(t.font, BOLD_PIXELIFY, t.text);
    }
  }
});

test("wait overlays (THE KEEPER IS DECIDING…, the sealed pack) draw their bold lines in the heading face", () => {
  const { context, texts } = recorder();
  drawPenaltyWait(context, { visible: true, deciding: true, hush: false, meter: null, warm: 0.5 } as never, 1, { x: 240, y: 250 });
  drawSealedPack(context, { visible: true, deciding: true, hush: false, meter: null, warm: 0.5 } as never, 1, 3, false, RARITY_FX[0]);
  assert.ok(texts.some(t => t.text.startsWith("THE KEEPER IS DECIDING")));
  for (const t of texts) assert.doesNotMatch(t.font, BOLD_PIXELIFY, `${t.text} drawn in ${t.font}`);
});

test("no canvas text in gfx/ is set in bold Pixelify (the reveal banner, the walkout name plate, the chant ribbon…)", () => {
  // friend.ts's dashed "?" is the Friend's loading silhouette (no C in it, and the Friend's file stays untouched).
  // sharecard.ts is the 960-px share PNG, not the Stage: its bold lines are mixed case at 18–54 px (owner's call).
  const rest: string[] = [];
  for (const name of readdirSync(GFX).filter(n => n.endsWith(".ts") && n !== "friend.ts" && n !== "sharecard.ts")) {
    readFileSync(join(GFX, name), "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/font\s*=\s*([`"][^`"]*[`"])/g)) if (/bold|[6-9]00 /.test(m[1]) && m[1].includes("PixelifySans")) rest.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(rest, [], `bold Pixelify canvas fonts: ${rest.join(", ")}`);
});
