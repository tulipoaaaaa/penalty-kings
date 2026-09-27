import { test } from "node:test";
import assert from "node:assert/strict";
import { GLYPHS, glyphText, glyphCols } from "../../games/penalty-kings/gfx/stadium.ts";

// B4 / BQ-X8: the 4×5 canvas font had no digits, so a number drawn with glyphText came out blank.
// Every canvas number (scoreboard, streak, target values, shot clock) now goes through it.

const bits = (ch: string) => GLYPHS[ch]!.replace(" ", "");

test("GLYPHS has the digits 0-9 and the number punctuation", () => {
  for (const ch of [..."0123456789", "/", ".", ",", "%", "+", "-", "×"]) {
    assert.ok(GLYPHS[ch], `missing glyph ${ch}`);
    assert.match(bits(ch), /^[01]{20}$/, `glyph ${ch} is not 4×5`);
    if (ch !== " ") assert.ok(bits(ch).includes("1"), `glyph ${ch} is blank`);
  }
});

test("the digits are all different and never copy a letter they are confused with", () => {
  const digits = [..."0123456789"].map(bits);
  assert.equal(new Set(digits).size, 10);
  for (const [digit, letter] of [["5", "S"], ["2", "Z"], ["8", "B"], ["0", "O"], ["1", "I"]] as const) assert.notEqual(bits(digit), bits(letter), `${digit} draws like ${letter}`);
});

test("glyphText draws pixels for a number (it drew nothing before B4)", () => {
  const rects: number[][] = [];
  const c = { fillStyle: "", fillRect: (...r: number[]) => { rects.push(r); } } as unknown as CanvasRenderingContext2D;
  glyphText(c, "20 RF", 0, 0, 1, "#fff");
  const lit = (from: number, to: number) => rects.filter(([x]) => x >= from && x < to).length;
  assert.ok(lit(0, 4) > 0 && lit(5, 9) > 0, "the digits 2 and 0 draw pixels");
  assert.equal(glyphCols("500"), 14);
});
