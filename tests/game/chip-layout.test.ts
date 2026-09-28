import { test } from "node:test";
import assert from "node:assert/strict";
import { chipLayout, DOM_BANNER_BAND, FeelFx } from "../../games/penalty-kings/gfx/feel.ts";
import { W, H } from "../../games/penalty-kings/gfx/core.ts";
import { GOAL, PENALTY_GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { applyGoal } from "../../games/penalty-kings/gfx/setpieces.ts";
import { plantSpot, PENALTY_VIEW } from "../../games/penalty-kings/gfx/kick.ts";

// Polish: at a result the canvas feel chip (CLANG! / HAT-TRICK!) and its sub-chip stacked at top centre with the
// commentary strip and the DOM result banner (.pk-banner: its big word and sub line). The chip is now a lower-third
// caption on the pitch: clear of the DOM banner's band on every layout, of the goal mouth (the net and the keeper's
// reaction), of the Friend at its spot, of the scoreboard and of the DOM action buttons.

type Rect = { x0: number; y0: number; x1: number; y1: number };
const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** PKHead advances ≈ 0.64 em: 16 px chip text, 11 px sub line (the widths drawUI measures). */
const widths = (text: string, sub: string) => [text.length * 10.3, sub.length * 7.1] as const;
const BEATS: Array<[string, string]> = [["CLANG!", "SO CLOSE!"], ["SO CLOSE!", "BY A WHISKER"], ["TIPPED!", "FINGERTIP SAVE"], ["HAT-TRICK!", "3 IN A ROW"],
  ["ON FIRE!", "5 IN A ROW"], ["10 IN A ROW!", "THE WHOLE STADIUM IS SINGING"], ["25 IN A ROW!", "THE WHOLE STADIUM IS SINGING"]];

test("the DOM banner band covers where .pk-banner lands in logical canvas px on every layout (style.css)", () => {
  // Desktop: top 30cqh; landscape phone: pitch top + 70 logical px; portrait: pitch top + 60. Its big word is
  // 22–68 px (≈ 30–40 logical px with the sub line under it at the layouts' scales), so the band spans ~56–154 (desktop 1280 × 800: the word at 102–130, its sub line to 152).
  assert.ok(DOM_BANNER_BAND.y0 <= 56 && DOM_BANNER_BAND.y1 >= 154, JSON.stringify(DOM_BANNER_BAND));
  assert.ok(DOM_BANNER_BAND.x0 <= 0 && DOM_BANNER_BAND.x1 >= W, "full width: the banner is centred and max-content wide");
});

test("chipLayout: the chip and its sub line never intersect the DOM result banner band", () => {
  for (const [text, sub] of BEATS) {
    const [tw, sw] = widths(text, sub), layout = chipLayout(tw, sw);
    for (const [name, r] of [["chip", layout.chip], ["sub", layout.sub]] as const) {
      assert.ok(!intersects(r, DOM_BANNER_BAND), `${text} ${name} ${JSON.stringify(r)} vs banner band`);
      assert.ok(r.x0 >= 0 && r.x1 <= W && r.y0 >= 0 && r.y1 <= H, `${text} ${name}: on the canvas`);
      for (const v of [r.x0, r.y0, r.x1, r.y1]) assert.ok(Number.isInteger(v), `${text} ${name}: whole pixels`);
    }
    assert.ok(layout.sub.y0 >= layout.chip.y1, `${text}: the sub line sits under the chip`);
    assert.ok(layout.chip.x1 - layout.chip.x0 >= tw + 20, `${text}: the text fits its plate`);
  }
});

test("chipLayout: a lower-third caption, clear of the goal mouth (net ripple, keeper reaction) and of the Friend at its spot", () => {
  const bar = applyGoal(PENALTY_GOAL, { x: GOAL.left, y: GOAL.bar }), line = applyGoal(PENALTY_GOAL, { x: GOAL.right, y: GOAL.line });
  const mouth = { x0: bar.x, y0: bar.y, x1: line.x, y1: line.y + 2 };
  const scoreboard = { x0: 386, y0: 0, x1: 480, y1: 22 };
  // The Friend at its planted spot (where it stands at the result): the sprite spans ±9 cells, 16 up, 2 down + shadow.
  const plant = plantSpot(PENALTY_VIEW), k = plant.scale;
  const friend = { x0: plant.x - 9 * k, y0: plant.y - 16 * k, x1: plant.x + 9 * k, y1: plant.y + 3 * k };
  // The DOM Menu and sound buttons sit over the canvas's bottom-right corner on the 16:10 desktop layout.
  const actions = { x0: 388, y0: 252, x1: W, y1: 282 };
  for (const [text, sub] of BEATS) {
    const { chip, sub: s } = chipLayout(...widths(text, sub));
    assert.ok(!intersects(chip, mouth) && !intersects(s, mouth), `${text}: clear of the goal mouth ${JSON.stringify(mouth)}`);
    assert.ok(!intersects(chip, scoreboard), `${text}: clear of the scoreboard`);
    for (const r of [chip, s]) {
      assert.ok(!intersects(r, friend), `${text}: clear of the Friend ${JSON.stringify(friend)}`);
      assert.ok(!intersects(r, actions), `${text}: clear of the DOM action buttons`);
    }
  }
});

test("drawUI draws the chip plate where chipLayout puts it (not at the top under the commentary strip)", () => {
  const rects: Rect[] = [];
  const context = new Proxy({}, {
    get: (_t, key) => key === "measureText" ? (text: string) => ({ width: text.length * 10.3 })
      : key === "fillRect" ? (x: number, y: number, w: number, h: number) => rects.push({ x0: x, y0: y, x1: x + w, y1: y + h })
      : key === "translate" ? (x: number, y: number) => rects.push({ x0: x, y0: y, x1: x, y1: y }) : () => undefined,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const fx = new FeelFx(); fx.say("CLANG!", "SO CLOSE!"); fx.update(0.6);
  fx.drawUI(context, true, 1);
  const layout = chipLayout(6 * 10.3, 9 * 10.3), centre = rects[0];
  assert.deepEqual([centre.x0, centre.y0], [(layout.chip.x0 + layout.chip.x1) / 2, (layout.chip.y0 + layout.chip.y1) / 2], "the plate pops around the chip rect's centre");
  assert.equal(rects[1].x1 - rects[1].x0, layout.chip.x1 - layout.chip.x0, "the plate is the chip rect's width");
  assert.deepEqual(rects.at(-1), layout.sub, "the sub plate is the layout's sub rect");
});
