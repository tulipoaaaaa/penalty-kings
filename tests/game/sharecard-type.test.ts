import { test } from "node:test";
import assert from "node:assert/strict";
import { shareCardLayout, renderShareCard, cardFontsReady, CARD_TAGLINE, HEAD_EM, type ShareCardInput } from "../../games/penalty-kings/gfx/sharecard.ts";

// Polish: bold Pixelify (weight 700) draws an uppercase C like an O, and the share card set its heading lines in it.
// They are now in the heading face (PKHead: the Departure Mono subset, A–Z, digits and number punctuation), uppercase
// so no glyph falls back, at multiples of 11 px (its pixel grid) so every pixel lands whole; the rest stays Pixelify 400.

const input: ShareCardInput = { name: "Friend #7730", score: 1420, scoreLabel: "pts", goals: 4, kicks: 5, bestStreak: 3, subtitle: "3 free kicks vs Snooze the Sloth", link: "https://tulipoaaaaa.github.io/penalty-kings/?challenge=x", code: "pkc1.f.sloth.1rdy26k.f0.5yq.f3a68cc1" };
const practice: ShareCardInput = { name: "The Trialist", score: 12, scoreLabel: "goals", goals: 12, kicks: 20, bestStreak: 5, subtitle: "Free practice", link: "https://tulipoaaaaa.github.io/penalty-kings/" };
const BOLD_PIXELIFY = /\b(bold|[6-9]00)\b[^,]*PixelifySans/;
/** What the PKHead subset covers: anything else would fall back to Pixelify mid-word. */
const HEAD_GLYPHS = /^[ !"%&'()+,\-./0-9:?A-Z]+$/;

/** A 2D context that records the font in force for every fillText. */
function recorder() {
  const texts: Array<{ text: string; font: string }> = [];
  let font = "10px sans-serif";
  const context: Record<string, unknown> = new Proxy({}, {
    get: (_t, key) => key === "font" ? font : key === "fillText" ? (text: string) => texts.push({ text, font })
      : key === "measureText" ? (text: string) => ({ width: text.length * 6 }) : () => undefined,
    set: (_t, key, value) => { if (key === "font") font = value; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, texts };
}

test("share card: no line is set in bold Pixelify; the heading lines are PKHead, uppercase, on its 11 px grid", () => {
  for (const card of [input, practice]) {
    const layout = shareCardLayout(card), heads = layout.texts.filter(text => text.head);
    assert.deepEqual(heads.map(text => text.text), ["PENALTY KINGS", card.scoreLabel === "pts" ? "1,420 PTS" : "12 GOALS", CARD_TAGLINE.toUpperCase()]);
    for (const text of layout.texts) {
      assert.doesNotMatch(text.font, BOLD_PIXELIFY, `${text.text}: ${text.font}`);
      assert.ok(text.font.includes(`${text.size}px`), `${text.text}: the font carries its size`);
      if (/C/.test(text.text)) assert.ok(text.size >= 10, `${text.text}: a C at ${text.size}px`);
    }
    for (const text of heads) {
      assert.match(text.font, /^\d+px PKHead, PixelifySans\b/, text.text);
      assert.match(text.text, HEAD_GLYPHS, `${text.text}: every glyph is in the heading face`);
      assert.equal(text.size % 11, 0, `${text.text}: ${text.size}px is on the 11 px grid`);
      assert.ok(text.x + text.text.length * text.size * HEAD_EM <= layout.width - 16, `${text.text} fits with a margin`);
    }
    for (const text of layout.texts.filter(t => !t.head)) assert.match(text.font, /^400 \d+px PixelifySans\b/, text.text);
  }
  // Big numbers step down a grid size rather than overflow.
  const big = shareCardLayout({ ...practice, score: 123_456, scoreLabel: "pts" }).texts.find(text => text.text === "123,456 PTS")!;
  assert.ok(big.size % 11 === 0 && big.x + big.text.length * big.size * HEAD_EM <= 640 - 16, `${big.size}px`);
});

test("share card render: every fillText uses its line's font (never bold Pixelify)", () => {
  const layout = shareCardLayout(input), { canvas, texts } = recorder();
  // (With rows still loading, friend.ts draws its own "?" placeholder silhouette: the Friend's file, not card text.
  // With rows, it caches the sprite on an offscreen canvas: a scratch one here.)
  const doc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => recorder().canvas };
  try { renderShareCard(canvas, layout, Array.from({ length: 16 }, () => "....########....")); } finally { (globalThis as { document?: unknown }).document = doc; }
  for (const line of layout.texts) {
    const drawn = texts.filter(text => text.text === line.text);
    assert.ok(drawn.length >= 2, `${line.text}: drawn with its shadow`);
    for (const text of drawn) assert.equal(text.font, line.font, line.text);
  }
  for (const text of texts) assert.doesNotMatch(text.font, BOLD_PIXELIFY, `${text.text}: ${text.font}`);
});

test("share card fonts: every face and size the card draws is loaded before it is painted", async () => {
  const layout = shareCardLayout(input), loads: string[] = [];
  const doc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { fonts: { load: async (font: string) => { loads.push(font); return []; } } };
  try { await cardFontsReady(layout); } finally { (globalThis as { document?: unknown }).document = doc; }
  for (const text of layout.texts) assert.ok(loads.includes(text.font), `${text.font} loaded`);
});
