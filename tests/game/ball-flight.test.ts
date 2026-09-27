import { test } from "node:test";
import assert from "node:assert/strict";
import { BALL_RADIUS } from "@penalty-kings/engine";
import { penaltyBallArt, penaltyBallDrawn, penaltyRibbon } from "../../games/penalty-kings/gfx/stage.ts";
import { GOAL, PENALTY_GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { RARITY_FX, BALL_IDENTITY, ballSprite, flightRadius, ribbonFor, drawRibbon, seasonFx, RIBBONS } from "../../games/penalty-kings/gfx/ball.ts";

// B7 "Ball readable in flight" (docs/GREATNESS.md): the in-flight ball was ~5 px (radius ~2.5–3.8) with
// no room for an outline, and Silver / Standard / Scuffed looked identical in flight. Drawing only: the
// physics disc (BALL_RADIUS at the crossing, what the keeper rig tests) is unchanged.

const TARGETS = [{ x: -0.8, y: 0.8 }, { x: 0.6, y: 0.2 }, { x: 0, y: 0.5 }, { x: 0.95, y: 0.95 }];
const SILVER = 4, SCUFFED = 0, STANDARD = 7;

test("B7: at typical flight depth the drawn ball has a radius of at least 5 px (was ~3.8)", () => {
  for (const target of TARGETS) for (const curl of [-0.6, 0, 0.6]) for (const p of [0.25, 0.4, 0.5, 0.6, 0.7]) {
    const physics = penaltyBallArt(target, curl, p).r * PENALTY_GOAL.g, drawn = penaltyBallDrawn(target, curl, p);
    assert.ok(physics < 4.4, `the physics radius alone is small (${physics.toFixed(2)})`);
    assert.ok(drawn.r >= 5, `drawn r ${drawn.r.toFixed(2)} at p ${p}`);
    assert.ok(Math.round(drawn.r * 2) >= 10, "sprite diameter ≥ 10 px");
  }
});

test("B7: drawing only — the drawn ball is exactly the physics disc at the strike and at the crossing", () => {
  for (const target of TARGETS) {
    const end = penaltyBallDrawn(target, 0.3, 1), art = penaltyBallArt(target, 0.3, 1);
    assert.equal(end.r, Math.max(1.2, art.r * PENALTY_GOAL.g));
    assert.ok(Math.abs(end.r - BALL_RADIUS * GOAL.unit * PENALTY_GOAL.g) < 1e-9, "BALL_RADIUS at the crossing");
    assert.equal(penaltyBallDrawn(target, 0.3, 0).r, penaltyBallArt(target, 0.3, 0).r * PENALTY_GOAL.g);
  }
  for (const r of [1.4, 2, 3, 4.5]) { assert.equal(flightRadius(r, 0), r); assert.equal(flightRadius(r, 1), r); assert.ok(flightRadius(r, 0.5) >= Math.max(4, r)); }
  // never shrinks the ball, anywhere in the flight
  for (let p = 0; p <= 1; p += 0.05) assert.ok(flightRadius(3, p) >= 3);
});

/** Minimal OffscreenCanvas so ballSprite paints its pixels in Node. */
function installOffscreen() {
  class FakeOffscreen {
    width: number; height: number; image: { data: Uint8ClampedArray; width: number; height: number } | null = null;
    constructor(width: number, height: number) { this.width = width; this.height = height; }
    getContext() {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) => { this.image = image; },
      };
    }
  }
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreen;
}

test("B7: the in-flight sprite has a 1 px dark outline in the ball's identity colour (Silver, Scuffed, Standard)", () => {
  installOffscreen();
  const size = Math.round(penaltyBallDrawn({ x: 0.5, y: 0.5 }, 0, 0.5).r * 2);
  for (const rarity of [SILVER, SCUFFED, STANDARD]) {
    const sprite = ballSprite(rarity, "S1", size, false)!;
    assert.ok(sprite, "sprite painted");
    const image = (sprite.canvas as unknown as { image: { data: Uint8ClampedArray; width: number } }).image;
    const outline = BALL_IDENTITY[rarity].outline, want = [1, 3, 5].map(i => parseInt(outline.slice(i, i + 2), 16));
    // the leftmost opaque pixel on the disc's middle row, and the topmost on its middle column, are outline pixels
    const mid = sprite.margin + Math.floor(size / 2), px = (x: number, y: number) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
    let left = 0; while (px(left, mid)[3] === 0) left++;
    let top = 0; while (px(mid, top)[3] === 0) top++;
    for (const [x, y] of [[left, mid], [mid, top]]) assert.deepEqual(px(x, y), [...want, 255], `outline at (${x}, ${y}) for rarity ${rarity}`);
    // and the outline is dark
    assert.ok(want[0] + want[1] + want[2] < 3 * 64, "dark outline");
  }
});

test("B7: the ribbon trail is in the rarity colour: Silver ≠ Standard ≠ Scuffed, every tier its own hue", () => {
  const silver = ribbonFor(RARITY_FX[SILVER]), standard = ribbonFor(RARITY_FX[STANDARD]), scuffed = ribbonFor(RARITY_FX[SCUFFED]);
  assert.notEqual(silver.edge, standard.edge); assert.notEqual(silver.edge, scuffed.edge); assert.notEqual(standard.edge, scuffed.edge);
  assert.notDeepEqual(silver, standard); assert.notDeepEqual(silver, scuffed); assert.notDeepEqual(standard, scuffed);
  assert.equal(new Set(RIBBONS.map(r => r.edge)).size, RIBBONS.length, "every tier's ribbon edge is distinct");
  // reuses the ball code's rarity colours
  const palette = new Set(RARITY_FX.flatMap(fx => [fx.base, fx.accent, ...fx.trail]).concat(BALL_IDENTITY.flatMap(id => [id.base, id.accent, id.trim])).concat(["#b9f6ca"]));
  for (const r of RIBBONS) { assert.ok(palette.has(r.edge), `${r.edge} from the ball palette`); if (r.core) assert.ok(palette.has(r.core), `${r.core} from the ball palette`); }
  // Season 0 editions trail their vintage leather, not the modern colour
  assert.notEqual(ribbonFor(seasonFx("S0", SILVER)).edge, silver.edge);
});

type Op = { style: string; x: number; y: number; w: number; h: number };
function recorder() {
  const ops: Op[] = [];
  const c = { fillStyle: "", fillRect(x: number, y: number, w: number, h: number) { ops.push({ style: c.fillStyle, x, y, w, h }); } };
  return { c: c as unknown as CanvasRenderingContext2D, ops };
}

test("B7: the ribbon is pixel-snapped, tapers from wide to 1 px, and is deterministic (no reduced-motion flicker)", () => {
  const target = { x: 0.7, y: 0.6 }, points = penaltyRibbon(target, 0.4, 0.5, false);
  assert.ok(points.length >= 4, "a few samples behind the ball");
  assert.deepEqual(points[0], penaltyBallDrawn(target, 0.4, 0.5), "the ribbon starts at the ball");
  const a = recorder(), b = recorder(), ribbon = ribbonFor(RARITY_FX[SILVER]);
  drawRibbon(a.c, points, ribbon); drawRibbon(b.c, points, ribbon);
  assert.deepEqual(a.ops, b.ops, "same frame → same pixels");
  assert.ok(a.ops.length > 10);
  for (const op of a.ops) { assert.ok(Number.isInteger(op.x) && Number.isInteger(op.y) && Number.isInteger(op.w), "pixel-snapped"); assert.ok(op.style === ribbon.edge || op.style === ribbon.core); }
  const edge = a.ops.filter(op => op.style === ribbon.edge);
  assert.ok(edge[0].w >= 6, `wide at the ball (${edge[0].w} px)`); assert.equal(Math.min(...edge.map(op => op.w)), 1, "1 px at the tail");
  assert.ok(a.ops.some(op => op.style === ribbon.core), "a bright core");
  // reduced motion: a shorter static ribbon, still deterministic
  const short = penaltyRibbon(target, 0.4, 0.5, true), long = points;
  const length = (pts: typeof points) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  assert.ok(length(short) < length(long) * 0.6);
  // the standard ball's chalk streak stays thin
  const chalk = recorder(); drawRibbon(chalk.c, points, ribbonFor(RARITY_FX[STANDARD]));
  assert.ok(chalk.ops.every(op => op.w <= 2));
});
