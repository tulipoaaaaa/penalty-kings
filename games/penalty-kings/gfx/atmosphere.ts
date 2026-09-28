/**
 * Stadium atmosphere (docs/GREATNESS.md deferred list): the goal mouth POPS.
 *
 * CROWD BAND. The stands directly behind the goal sit in shadow: a darker, lower-contrast band (a flat
 * dark tone laid over the crowd and boards at a few fixed strengths), so the net, the keeper and the
 * ball read against it instead of against a wall of confetti-coloured fans.
 * FLOODLIGHT POOL. A lighter ellipse on the grass around the goal mouth and the six-yard box (golden
 * at Champions, cool white at Pro, soft sun at the Park; wetter under rain, weaker in fog and snow).
 * VIGNETTE. The stadium camera grade's edge darkening, stepped instead of a smooth gradient.
 *
 * PIXEL ART. Every layer is a handful of flat strengths (STEPS) joined by a 4×4 ordered (Bayer) dither
 * on whole pixels: no smooth gradients. PERFORMANCE. Each layer is rendered once into an offscreen
 * canvas (cached per stadium × weather × size) and blitted per frame: no per-frame dithering.
 * MOTION. The lighting is static: no flicker, no animation (identical under reduced motion).
 * Drawing only: nothing here touches physics, outcomes or timing.
 */
import { W, H } from "./core.js";
import { GOAL, type StadiumId, type Weather } from "./stadium.js";

/** 4×4 Bayer thresholds (0..15). */
export const BAYER4: readonly (readonly number[])[] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/**
 * Ordered dither of an intensity in [0, 1] into 0..steps (integer). Flat bands of one strength, joined
 * by a Bayer seam: only the middle `seam` share of each step is dithered (1 = a dither across the whole
 * step; smaller = wider flat bands and narrower dithered seams, the classic banded pixel-art ramp).
 */
export function ditherLevel(t: number, steps: number, x: number, y: number, seam = 1) {
  const v = Math.min(1, Math.max(0, t)) * steps, base = Math.floor(v);
  if (base >= steps) return steps;
  const f = Math.min(1, Math.max(0, (v - base - (1 - seam) / 2) / seam));
  return base + (f > (BAYER4[y & 3][x & 3] + 0.5) / 16 ? 1 : 0);
}

export type RGB = readonly [number, number, number];
/** A cached overlay: a rectangle at integer screen px, a tone, its strongest alpha and the number of dither steps. */
export type AtmosLayer = Readonly<{ x: number; y: number; w: number; h: number; tone: RGB; alpha: number; steps: number; seam: number }>;
export type CrowdBand = AtmosLayer & Readonly<{ kind: "band"; coreLeft: number; coreRight: number; coreTop: number; fadeX: number; fadeY: number }>;
export type FloodPool = AtmosLayer & Readonly<{ kind: "pool"; cx: number; cy: number; rx: number; ry: number; plateau: number }>;
export type Vignette = AtmosLayer & Readonly<{ kind: "vignette"; cx: number; cy: number; r0: number; r1: number }>;
export type Atmosphere = Readonly<{ band: CrowdBand; pool: FloodPool; animated: false }>;
/** Goal-art placement on screen (Stage.goalXf / PENALTY_GOAL / goalTransform). */
export type GoalXf = Readonly<{ g: number; x: number; y: number }>;

/** Per-ground looks. `standTop`: the top of the stands (backdrop-layer y; the grass starts at 102). Band: the shadow tone and its strength. Pool: the light's colour and strength. */
export const ATMOS_LOOKS: Readonly<Record<StadiumId, { band: RGB; bandAlpha: number; pool: RGB; poolAlpha: number; standTop: number }>> = {
  park: { standTop: 60, band: [30, 26, 44], bandAlpha: 0.3, pool: [246, 255, 206], poolAlpha: 0.1 },
  pro: { standTop: -38, band: [2, 4, 14], bandAlpha: 0.42, pool: [214, 246, 222], poolAlpha: 0.14 },
  champions: { standTop: -17, band: [12, 4, 22], bandAlpha: 0.4, pool: [255, 226, 130], poolAlpha: 0.15 },
};
/** Weather: rain wets the grass (a brighter pool), fog and snow scatter it (weaker, wider), a sunset warms it. */
const WEATHER_POOL: Readonly<Record<Weather, { k: number; wide: number; tint?: RGB }>> = {
  sun: { k: 1, wide: 1 }, rain: { k: 1.25, wide: 1 }, snow: { k: 0.6, wide: 1.1 }, fog: { k: 0.7, wide: 1.2 }, sunset: { k: 1, wide: 1, tint: [255, 214, 150] },
};
export const BAND_STEPS = 3, POOL_STEPS = 3, VIGNETTE_STEPS = 4;

/**
 * The atmosphere layers for one ground, weather and goal placement (screen px, all integers).
 * `grassTop` is the screen y where the boards end and the grass begins (the band stops there; the pool
 * starts there). Static by construction: no time input, so reduced motion draws exactly the same.
 */
export function atmosphereParams(stadium: StadiumId, weather: Weather, xf: GoalXf, grassTop: number): Atmosphere {
  const look = ATMOS_LOOKS[stadium], w = WEATHER_POOL[weather];
  const hw = GOAL.unit * xf.g, gh = (GOAL.line - GOAL.bar) * xf.g, barY = xf.y - gh;
  // Band: full strength across the goal (a little wider than the posts), fading out to the sides and above the bar.
  const coreHalf = Math.round(hw * 1.1), fadeX = Math.max(6, Math.round(hw * 0.5)), fadeY = Math.max(6, Math.round(gh * 0.7));
  // Free kicks: the far goal stands on the grass below the stands, so the band shades the stand rows straight above it.
  // It never reaches past the top of the stands (the Park's sky stays clear): the stand edge is its top edge there.
  const coreTop = Math.round(Math.min(barY - gh * 0.2, grassTop - 20)), top = Math.max(coreTop - fadeY, Math.round(grassTop - 102 + look.standTop)), cx = Math.round(xf.x);
  const bx = cx - coreHalf - fadeX, bottom = Math.round(grassTop);
  const band: CrowdBand = { kind: "band", x: bx, y: top, w: 2 * (coreHalf + fadeX), h: Math.max(1, bottom - top), tone: look.band, alpha: look.bandAlpha * (weather === "fog" ? 0.8 : 1),
    steps: BAND_STEPS, seam: 0.6, coreLeft: cx - coreHalf, coreRight: cx + coreHalf, coreTop, fadeX, fadeY };
  // Pool: an ellipse centred on the goal mouth, a little in front of the line (over the six-yard box).
  const rx = Math.round(hw * 1.95 * w.wide), ry = Math.round(hw * 0.52 * w.wide), cy = Math.round(xf.y + ry * 0.3);
  const py = Math.max(Math.round(grassTop), cy - ry);
  const pool: FloodPool = { kind: "pool", x: cx - rx, y: py, w: 2 * rx, h: cy + ry - py, tone: w.tint && stadium === "park" ? w.tint : look.pool,
    alpha: Math.min(0.22, look.poolAlpha * w.k), steps: POOL_STEPS, seam: 0.6, cx, cy, rx, ry, plateau: 0.45 };
  return { band, pool, animated: false };
}

/** The stepped vignette of the stadium camera grade: a (W + 40) × (H + 40) layer drawn at (−20, −20). */
export function vignetteParams(tone: RGB, strength: number): Vignette {
  return { kind: "vignette", x: -20, y: -20, w: W + 40, h: H + 40, tone, alpha: strength, steps: VIGNETTE_STEPS, seam: 0.3, cx: W / 2 + 20, cy: H * 0.46 + 20, r0: H * 0.35, r1: W * 0.62 };
}

/** Intensity (0..1) of a layer at layer-local pixel (x, y), sampled at the pixel centre. */
export function layerIntensity(layer: CrowdBand | FloodPool | Vignette, x: number, y: number) {
  const sx = layer.x + x + 0.5, sy = layer.y + y + 0.5;
  if (layer.kind === "band") {
    const u = Math.max(0, layer.coreLeft - sx, sx - layer.coreRight) / layer.fadeX, v = Math.max(0, layer.coreTop - sy) / layer.fadeY;
    return Math.max(0, 1 - Math.hypot(u, v));
  }
  if (layer.kind === "pool") {
    const d = Math.hypot((sx - layer.cx) / layer.rx, (sy - layer.cy) / layer.ry);
    return Math.min(1, Math.max(0, (1 - d) / (1 - layer.plateau)));
  }
  const d = Math.hypot(x + 0.5 - layer.cx, y + 0.5 - layer.cy);
  return Math.min(1, Math.max(0, (d - layer.r0) / (layer.r1 - layer.r0)));
}

/**
 * Renders a layer to RGBA pixels (pure; the game puts them in an offscreen canvas once). Every pixel
 * is the layer's tone at one of `steps + 1` alphas (0, alpha/steps, …, alpha).
 */
export function renderLayer(layer: CrowdBand | FloodPool | Vignette): Uint8ClampedArray {
  const out = new Uint8ClampedArray(layer.w * layer.h * 4), [r, g, b] = layer.tone;
  for (let y = 0; y < layer.h; y++) for (let x = 0; x < layer.w; x++) {
    // Dither in screen space so neighbouring layers and redraws line up on the same grid.
    const level = ditherLevel(layerIntensity(layer, x, y), layer.steps, layer.x + x, layer.y + y, layer.seam);
    if (!level) continue;
    const i = (y * layer.w + x) * 4;
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = Math.round((255 * layer.alpha * level) / layer.steps);
  }
  return out;
}

/** Source-over of a rendered layer onto an RGBA frame buffer (pure; used by the tests to measure what the game draws). */
export function compositeLayer(frame: Uint8ClampedArray, fw: number, fh: number, layer: AtmosLayer, pixels: Uint8ClampedArray) {
  for (let y = 0; y < layer.h; y++) for (let x = 0; x < layer.w; x++) {
    const fx = layer.x + x, fy = layer.y + y;
    if (fx < 0 || fy < 0 || fx >= fw || fy >= fh) continue;
    const i = (y * layer.w + x) * 4, a = pixels[i + 3] / 255; if (!a) continue;
    const j = (fy * fw + fx) * 4;
    for (let k = 0; k < 3; k++) frame[j + k] = Math.round(pixels[i + k] * a + frame[j + k] * (1 - a));
  }
}

// ── Canvas side (browser): each layer rendered once, then blitted ─────────────
/** Paints rendered RGBA pixels into a 2D context once, as horizontal runs of one colour (a few strengths → few runs). */
export function paintPixels(c: CanvasRenderingContext2D, w: number, px: Uint8ClampedArray) {
  const h = px.length / 4 / w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
    const i = (y * w + x) * 4, a = px[i + 3];
    let end = x + 1;
    while (end < w) { const j = (y * w + end) * 4; if (px[j + 3] !== a || px[j] !== px[i] || px[j + 1] !== px[i + 1] || px[j + 2] !== px[i + 2]) break; end++; }
    if (a) { c.fillStyle = `rgba(${px[i]},${px[i + 1]},${px[i + 2]},${a / 255})`; c.fillRect(x, y, end - x, 1); }
    x = end;
  }
}
const cache = new Map<string, HTMLCanvasElement>();
function layerCanvas(layer: CrowdBand | FloodPool | Vignette) {
  const key = `${layer.kind}:${layer.x},${layer.y},${layer.w}x${layer.h}:${layer.tone.join(",")}:${layer.alpha.toFixed(3)}:${layer.steps}`;
  let canvas = cache.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas"); canvas.width = layer.w; canvas.height = layer.h;
    const c = canvas.getContext("2d");
    if (c) paintPixels(c, layer.w, renderLayer(layer));
    if (cache.size > 24) cache.clear(); // free-kick setups each place the goal differently: keep the cache small
    cache.set(key, canvas);
  }
  return canvas;
}
export function drawLayer(c: CanvasRenderingContext2D, layer: CrowdBand | FloodPool | Vignette) {
  c.drawImage(layerCanvas(layer), layer.x, layer.y);
}
/** The crowd band (over the stands and boards behind the goal), then the floodlight pool (on the grass). */
export function drawAtmosphere(c: CanvasRenderingContext2D, atmos: Atmosphere) {
  drawLayer(c, atmos.band);
  drawLayer(c, atmos.pool);
}
