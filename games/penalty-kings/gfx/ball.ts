/**
 * Ball rarities as spectacle: pixel sprites (8-frame spin, specular highlight, ground shadow),
 * a distinct panel pattern / palette / trim per rarity, trails and particle signatures.
 *
 * Sprites are rendered procedurally ONCE per (rarity, season, diameter, sheen) into an offscreen
 * strip of 8 frames and cached; drawing a ball afterwards is a single drawImage. All designs are
 * original geometric patterns (no real club, brand or real ball design).
 */
import type { Particles } from "./core.js";

export type Season = "S0" | "S1";
export type RarityFx = {
  base: string; accent: string; trail: string[]; kind: "dust" | "neon" | "clean" | "sparkle" | "comet" | "gold" | "fire"; tier: number;
  /** Rarity index (0 Scuffed … 6 Golden Boot, 7 standard). Used to find the sprite. */
  id?: number; season?: Season;
};
/** Indexed by outcome id - 1 (Scuffed … Golden Boot); index 7 = the standard (warm-up / Skill Cup) ball. */
export const RARITY_FX: readonly RarityFx[] = [
  { base: "#8a7a66", accent: "#5b4f40", trail: ["#8a7a66", "#b3a48f"], kind: "dust", tier: 0, id: 0 },
  { base: "#f2f2f2", accent: "#f08a24", trail: ["#f08a24", "#ffd23f"], kind: "neon", tier: 1, id: 1 },
  { base: "#ffffff", accent: "#2a6fdb", trail: ["#ffffff"], kind: "clean", tier: 1, id: 2 },
  { base: "#ffffff", accent: "#16a34a", trail: ["#7fd3ff", "#2a6fdb", "#ffffff"], kind: "sparkle", tier: 2, id: 3 },
  { base: "#d7dde5", accent: "#8a96a8", trail: ["#ffffff", "#d7dde5", "#8a96a8"], kind: "comet", tier: 3, id: 4 },
  { base: "#ffd23f", accent: "#b8860b", trail: ["#ffd23f", "#fff2b3", "#ffffff"], kind: "gold", tier: 4, id: 5 },
  { base: "#ffe680", accent: "#ff8c00", trail: ["#ff8c00", "#ff3b1f", "#ffd23f"], kind: "fire", tier: 5, id: 6 },
  { base: "#f4f4f4", accent: "#9aa3ad", trail: ["#ffffff"], kind: "clean", tier: 0, id: 7 },
];

const VINTAGE = ["#8a6a45", "#c9b08a", "#e8dcc2", "#6d8fb3", "#b7b7a4", "#d9a441", "#e07b39", "#c9b08a"];
const seasonCache = new Map<string, RarityFx>();
/** Seasonal editions: Season 0 (discontinued) is a vintage leather print of the same rarity. Memoised (no per-frame allocation). */
export function seasonFx(season: Season, rarity: number): RarityFx {
  const fx = RARITY_FX[rarity];
  if (season !== "S0") return fx;
  const key = `${season}${rarity}`;
  let out = seasonCache.get(key);
  if (!out) { out = { ...fx, base: VINTAGE[rarity] ?? fx.base, accent: "#3b2a1a", id: rarity, season: "S0" }; seasonCache.set(key, out); }
  return out;
}

/** Lucky-ball trail: green-and-gold four-leaf sparkles, on top of the rarity's own trail. */
export function emitLucky(particles: Particles, x: number, y: number) {
  particles.emit("sparkle", x, y, 2, { color: ["#3ddc84", "#ffd23f", "#b9f6ca"], speed: 16, life: 0.6, gravity: 0 });
}

// ── Reduced motion ───────────────────────────────────────────────────────────
// Sheen sweeps and sparkle twinkles are skipped under reduced motion. Defaults to the OS
// preference; the game shell can override it with setBallReducedMotion (e.g. its settings toggle).
let reducedOverride: boolean | null = null;
let reducedQuery: MediaQueryList | null = null;
try { reducedQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null; } catch { reducedQuery = null; }
export function setBallReducedMotion(value: boolean | null) { reducedOverride = value; }
export function ballReducedMotion(): boolean { return reducedOverride ?? reducedQuery?.matches ?? false; }

// ── Identity: pattern, palette and trim per rarity ───────────────────────────
type Pattern = "classic" | "leather" | "panels6" | "blades" | "band" | "facets12" | "gems20" | "flames";
export type BallIdentity = {
  name: string; pattern: Pattern; base: string; accent: string; trim: string; seam: string; outline: string;
  /** Extra detail colour (scuffs, flame core, …). */
  detail: string; spec: string; metal: boolean; sheen: 0 | 1 | 2; sparkle: 0 | 1 | 2;
};
/** What makes each ball recognisable at 24 px. Index = rarity (7 = standard ball). */
export const BALL_IDENTITY: readonly BallIdentity[] = [
  { name: "Scuffed", pattern: "leather", base: "#b3a68c", accent: "#5e5446", trim: "#ddd2bc", seam: "#6b5f4c", outline: "#2a2016", detail: "#6f6a45", spec: "#d8ceb8", metal: false, sheen: 0, sparkle: 0 },
  { name: "Training", pattern: "panels6", base: "#f2f4f7", accent: "#f08a24", trim: "#ffd23f", seam: "#3a2a1c", outline: "#1d1f2b", detail: "#c2621a", spec: "#ffffff", metal: false, sheen: 0, sparkle: 0 },
  { name: "Match", pattern: "blades", base: "#f4f7fb", accent: "#2a6fdb", trim: "#7fd3ff", seam: "#1b2f5c", outline: "#141c33", detail: "#173f86", spec: "#ffffff", metal: false, sheen: 0, sparkle: 0 },
  { name: "Pro", pattern: "band", base: "#f4f7fb", accent: "#16a34a", trim: "#7fd3ff", seam: "#0f3d24", outline: "#10241a", detail: "#0d6b31", spec: "#ffffff", metal: false, sheen: 1, sparkle: 0 },
  { name: "Silver", pattern: "facets12", base: "#d7dde5", accent: "#a3aebd", trim: "#ffffff", seam: "#3c4452", outline: "#1f2530", detail: "#6d7788", spec: "#ffffff", metal: true, sheen: 1, sparkle: 0 },
  { name: "Gold", pattern: "gems20", base: "#f2c230", accent: "#c8921a", trim: "#fff2b3", seam: "#5a3a00", outline: "#3a2400", detail: "#8a5a08", spec: "#fffbe6", metal: true, sheen: 2, sparkle: 1 },
  { name: "Golden Boot", pattern: "flames", base: "#ffd23f", accent: "#ff8c00", trim: "#fff2b3", seam: "#6a3000", outline: "#3a1a00", detail: "#e0301a", spec: "#ffffff", metal: true, sheen: 2, sparkle: 2 },
  { name: "Standard", pattern: "classic", base: "#eef1f6", accent: "#353b47", trim: "#eef1f6", seam: "#9aa3b3", outline: "#1d212b", detail: "#3a404c", spec: "#ffffff", metal: false, sheen: 0, sparkle: 0 },
];

function identityFor(rarity: number, season: Season): BallIdentity {
  const id = BALL_IDENTITY[rarity] ?? BALL_IDENTITY[7];
  if (season !== "S0") return id;
  // Season 0 vintage: the same panel pattern, printed on matte vintage leather with a lace.
  const base = VINTAGE[rarity] ?? id.base;
  return { ...id, base, accent: mix(base, "#3b2a1a", 0.45), trim: mix(base, "#f5e6c8", 0.35), seam: "#3b2a1a", outline: "#24170c", detail: "#3b2a1a", spec: mix(base, "#fff4dc", 0.6), metal: false, sheen: 0, sparkle: 0 };
}

// ── Colour helpers ───────────────────────────────────────────────────────────
type RGB = [number, number, number];
function rgb(hex: string): RGB { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hex([r, g, b]: RGB): string { return `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`; }
function mix(a: string, b: string, t: number): string { const x = rgb(a), y = rgb(b); return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
/** 4-step ramp (deep, shadow, mid, light) for a material colour. */
function ramp(color: string, metal: boolean, cool: string): RGB[] {
  return metal
    ? [rgb(mix(color, cool, 0.62)), rgb(mix(color, cool, 0.32)), rgb(color), rgb(mix(color, "#ffffff", 0.55))]
    : [rgb(mix(color, cool, 0.5)), rgb(mix(color, cool, 0.24)), rgb(color), rgb(mix(color, "#ffffff", 0.4))];
}

// ── Sphere geometry ──────────────────────────────────────────────────────────
type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: V3[] = [];
for (const a of [-1, 1]) for (const b of [-1, 1]) { ICO.push(norm([0, a, b * PHI]), norm([a, b * PHI, 0]), norm([b * PHI, 0, a])); }
const DOD: V3[] = [];
for (const a of [-1, 1]) for (const b of [-1, 1]) {
  for (const c of [-1, 1]) DOD.push(norm([a, b, c]));
  DOD.push(norm([0, a / PHI, b * PHI]), norm([a / PHI, b * PHI, 0]), norm([b * PHI, 0, a / PHI]));
}
const CLASSIC = [...ICO, ...DOD];
const TET: V3[] = [norm([1, 1, 1]), norm([1, -1, -1]), norm([-1, 1, -1]), norm([-1, -1, 1])];
const CUBE: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];

/** Nearest two centres: index of nearest and the angular gap to the runner-up (seam distance). */
function voronoi(p: V3, centres: readonly V3[]): { i: number; gap: number; d: number } {
  let i = 0, d1 = -2, d2 = -2;
  for (let k = 0; k < centres.length; k++) {
    const d = dot(p, centres[k]);
    if (d > d1) { d2 = d1; d1 = d; i = k; } else if (d > d2) d2 = d;
  }
  return { i, gap: Math.acos(Math.max(-1, Math.min(1, d2))) - Math.acos(Math.max(-1, Math.min(1, d1))), d: d1 };
}
function rotate(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle), k = dot(axis, v);
  const cross: V3 = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return [v[0] * c + cross[0] * s + axis[0] * k * (1 - c), v[1] * c + cross[1] * s + axis[1] * k * (1 - c), v[2] * c + cross[2] * s + axis[2] * k * (1 - c)];
}
function hash(x: number, y: number, z: number) { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); }

/** Materials: 0 base, 1 accent, 2 seam, 3 trim, 4 detail. */
const M = { Base: 0, Accent: 1, Seam: 2, Trim: 3, Detail: 4 } as const;
type M = (typeof M)[keyof typeof M];
/** Object-space pattern lookup. `w` = one pixel in radians at the disc centre (seam width). */
function material(pattern: Pattern, q: V3, w: number, vintage: boolean): M {
  let out: M;
  switch (pattern) {
    case "classic": {
      const cell = voronoi(q, CLASSIC);
      if (cell.gap < w * 0.8) return M.Seam;
      out = cell.i < 12 && cell.d > 0.95 ? M.Accent : M.Base;
      break;
    }
    case "leather": {
      // a battered classic: pentagons half worn away, faded seams, big mud/grass stains
      const cell = voronoi(q, CLASSIC);
      const stain = hash(Math.round(q[0] * 2.6), Math.round(q[1] * 2.6), Math.round(q[2] * 2.6));
      const grit = hash(Math.round(q[0] * 12), Math.round(q[1] * 12), Math.round(q[2] * 12));
      if (stain > 0.72 && grit > 0.2) return M.Detail;
      if (cell.gap < w * 0.75) return grit > 0.3 ? M.Seam : M.Base;
      out = cell.i < 12 && cell.d > 0.95 && hash(cell.i, 3, 7) > 0.3 ? (grit > 0.75 ? M.Base : M.Accent) : grit > 0.94 ? M.Trim : M.Base;
      break;
    }
    case "panels6": {
      // octant checker: orange / white quarter-panels, so every view shows both colours
      const ax = Math.abs(q[0]), ay = Math.abs(q[1]), az = Math.abs(q[2]), edge = Math.min(ax, ay, az);
      if (edge < w * 0.55) return M.Seam;
      out = q[0] * q[1] * q[2] > 0 ? (edge < w * 1.9 ? M.Trim : M.Accent) : M.Base;
      break;
    }
    case "blades": {
      const cell = voronoi(q, TET);
      if (cell.gap < w * 0.9) return M.Seam;
      const c = TET[cell.i], r = Math.acos(Math.min(1, cell.d));
      // tangent frame around the cell centre → polar angle for a three-bladed swirl
      const ref: V3 = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm([ref[1] * c[2] - ref[2] * c[1], ref[2] * c[0] - ref[0] * c[2], ref[0] * c[1] - ref[1] * c[0]]);
      const v: V3 = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];
      const a = Math.atan2(dot(q, v), dot(q, u));
      const s = Math.sin(3 * a + r * 5.2);
      out = r < 0.22 ? M.Detail : r < 0.95 && s > 0.15 ? (s > 0.8 && r > 0.4 ? M.Trim : M.Accent) : M.Base;
      break;
    }
    case "band": {
      const h = q[1], gap = Math.abs(Math.abs(h) - 0.34);
      if (Math.abs(h) < 0.26) out = M.Accent;
      else if (gap < 0.08) out = M.Trim;
      else if (Math.abs(h) > 0.9) out = M.Detail;
      else if (Math.abs(Math.abs(h) - 0.9) < w * 1.1) return M.Seam;
      else out = M.Base;
      // chevrons cut into the band
      if (out === M.Accent) { const a = Math.atan2(q[2], q[0]); if (Math.abs(((a * 6 / Math.PI + 1.5 * Math.sign(h || 1) * Math.abs(h) * 4) % 2 + 2) % 2 - 1) < 0.18) out = M.Detail; }
      break;
    }
    case "facets12": {
      const cell = voronoi(q, ICO);
      if (cell.gap < w * 0.9) return M.Seam;
      if (cell.gap < w * 2.0) return M.Trim;
      out = cell.i % 2 ? M.Accent : M.Base;
      break;
    }
    case "gems20": {
      const cell = voronoi(q, DOD);
      if (cell.gap < w * 0.9) return M.Seam;
      const r = Math.acos(Math.min(1, cell.d));
      out = r < 0.1 ? M.Trim : [0, 3, 5, 6, 9, 10, 12, 15, 17, 18].includes(cell.i) ? M.Accent : M.Base;
      break;
    }
    case "flames": {
      const a = Math.atan2(q[2], q[0]), h = q[1];                   // y points down: h > 0 is the lower half
      const tooth = Math.abs(((a * 7) / Math.PI % 2 + 2) % 2 - 1);  // 0..1 triangle wave → 7 flame tongues
      const b = 0.36 - 0.5 * tooth;                                 // flame edge: tips reach above the equator
      if (h > b + 0.34) out = M.Detail;                             // red-hot core
      else if (h > b) out = M.Accent;                               // orange flame
      else if (h > b - w * 1.1) return M.Seam;                      // dark flame outline
      else {
        // five-point star at the upper pole on the gold
        const r = Math.acos(Math.min(1, -h)), star = Math.atan2(q[2], q[0]);
        out = r < 0.4 * (0.55 + 0.45 * Math.cos(5 * star)) ? M.Trim : M.Base;
      }
      break;
    }
  }
  if (vintage && out === M.Base && hash(Math.round(q[0] * 14), Math.round(q[1] * 14), Math.round(q[2] * 14)) > 0.9) out = M.Detail;
  return out;
}

// ── Sprite cache ─────────────────────────────────────────────────────────────
export const BALL_FRAMES = 8;
type Surface = HTMLCanvasElement | OffscreenCanvas;
export type BallSprite = { canvas: Surface; size: number; margin: number; cell: number };
const cache = new Map<string, BallSprite | null>();

/** An offscreen surface: OffscreenCanvas when present, otherwise a detached <canvas>; null in non-DOM environments. */
function surface(width: number, height: number): Surface | null {
  try { if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height); } catch { /* fall through */ }
  try { if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = width; c.height = height; return c; } } catch { /* none */ }
  return null;
}
const SPIN_AXIS = norm([0.34, 1, 0.12]);
const LIGHT = norm([-0.55, -0.7, 0.6]);
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
const BAYER = [0, 0.5, 0.75, 0.25];
const PRESET: Record<Pattern, V3> = { classic: [0.3, 0.2, 0.1], leather: [0.5, 0.3, 0.2], panels6: [0.55, 0.62, 0.2], blades: [0.1, 0.5, 0.3], band: [0.05, 0.25, -0.35], facets12: [0.2, 0.1, 0.3], gems20: [0.35, 0.2, 0.1], flames: [0, 0.2, 0.18] };

/** Margin around the disc: room for sparkles (and nothing else; shadows are drawn separately). */
const marginFor = (size: number) => Math.max(1, Math.round(size / 7));

/**
 * The 8-frame spin strip for a ball, rendered once and cached.
 * `sheen` false renders the reduced-motion strip: same spin frames, no sweeping sheen or twinkle.
 */
export function ballSprite(rarity: number, season: Season, size: number, sheen = true): BallSprite | null {
  size = Math.max(3, Math.min(64, Math.round(size)));
  const id = identityFor(rarity, season);
  const animated = sheen && (id.sheen > 0 || id.sparkle > 0);
  const key = `${rarity}|${season}|${size}|${animated ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key)!;
  const margin = marginFor(size), cell = size + margin * 2;
  const canvas = surface(cell * BALL_FRAMES, cell);
  const context = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!canvas || !context) { cache.set(key, null); return null; }
  const image = context.createImageData(cell * BALL_FRAMES, cell);
  for (let f = 0; f < BALL_FRAMES; f++) paintFrame(image.data, cell * BALL_FRAMES, f * cell, margin, size, id, f, animated, season === "S0");
  context.putImageData(image, 0, 0);
  const sprite = { canvas, size, margin, cell };
  cache.set(key, sprite);
  return sprite;
}
/** Number of cached strips (for tests / the Showroom). */
export const ballSpriteCacheSize = () => cache.size;

function paintFrame(data: Uint8ClampedArray, stride: number, ox: number, margin: number, size: number, id: BallIdentity, frame: number, animated: boolean, vintage: boolean) {
  const R = size / 2, cx = margin + R, cy = margin + R, w = 1.25 / R;
  const cool = id.metal ? id.outline : "#27304a";
  const ramps: RGB[][] = [ramp(id.base, id.metal, cool), ramp(id.accent, id.metal, cool), ramp(id.seam, false, "#000000"), ramp(id.trim, id.metal, cool), ramp(id.detail, id.metal, cool)];
  const outline = rgb(id.outline), spec = rgb(id.spec), sheenColor = rgb(id.metal ? mix(id.trim, "#ffffff", 0.5) : "#ffffff");
  const angle = (frame / BALL_FRAMES) * Math.PI * 2;
  const preset = PRESET[id.pattern];
  const inside = (px: number, py: number) => { const x = (px + 0.5 - cx) / R, y = (py + 0.5 - cy) / R; return x * x + y * y <= 1; };
  const cellSize = size + margin * 2;
  const sub = size <= 12 ? 4 : 3;
  // Sheen: a diagonal glint that crosses the ball over frames 1–4 (off in 0 and 5–7, so a still frame has none).
  const sheenAt = animated && id.sheen ? [99, -1.2, -0.4, 0.4, 1.2, 99, 99, 99][frame] : 99;
  const put = (px: number, py: number, c: RGB, a = 255) => { const i = (py * stride + ox + px) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a; };
  const orient = (v: V3): V3 => rotate(rotate(rotate(v, SPIN_AXIS, -angle), [1, 0, 0], preset[0] * 3), [0, 1, 0], preset[1] * 3 + preset[2]);

  for (let py = 0; py < cellSize; py++) for (let px = 0; px < cellSize; px++) {
    if (!inside(px, py)) continue;
    const edge = !inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1);
    if (edge && size >= 6) { put(px, py, outline); continue; }
    // supersampled material vote
    const votes = [0, 0, 0, 0, 0];
    for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
      const x = (px + (sx + 0.5) / sub - cx) / R, y = (py + (sy + 0.5) / sub - cy) / R, rr = x * x + y * y;
      if (rr > 1) continue;
      votes[material(id.pattern, orient([x, y, Math.sqrt(1 - rr)]), w, vintage)]++;
    }
    let m = 0; for (let k = 1; k < 5; k++) if (votes[k] > votes[m] || (votes[k] === votes[m] && k === M.Seam)) m = k;
    const x = (px + 0.5 - cx) / R, y = (py + 0.5 - cy) / R, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const n: V3 = [x, y, z];
    const lam = Math.max(0, dot(n, LIGHT));
    let v = 0.25 + 0.75 * lam;
    if (id.metal) { const env = y < -0.25 ? 0.95 : y < 0.2 ? 0.2 : 0.6; v = 0.45 * v + 0.55 * env; }
    if (vintage) v = 0.2 + 0.8 * v;
    const dither = size >= 14 ? BAYER[(py & 1) * 2 + (px & 1)] - 0.375 : 0;
    let level = Math.max(0, Math.min(3, Math.floor(v * 3.6 + dither * 0.9)));
    if (m === M.Seam) level = Math.min(level, 2);
    // sheen band
    const s = (x + y) * 0.72;
    if (Math.abs(s - sheenAt) < (id.sheen === 2 ? 0.2 : 0.13)) {
      if (id.sheen === 2 && Math.abs(s - sheenAt) < 0.09 && m !== M.Seam) { put(px, py, sheenColor); continue; }
      level = Math.min(3, level + 1);
    }
    // specular highlight
    const h = dot(n, HALF);
    if (h > (vintage ? 0.985 : id.metal ? 0.955 : 0.965) && m !== M.Seam) { put(px, py, spec); continue; }
    put(px, py, ramps[m][level]);
  }
  // lace on vintage leather (a short stitched slit at the top)
  if (vintage && size >= 12) {
    const lx = Math.round(cx + ((frame % 4) - 1.5) * size / 8), ly0 = Math.round(cy - R * 0.62), dark = rgb("#24170c"), light = rgb("#f5e6c8");
    for (let k = 0; k < Math.max(3, Math.round(size / 6)); k++) { put(lx, ly0 + k, dark); if (k % 2 === 0) { put(lx - 1, ly0 + k, light); put(lx + 1, ly0 + k, light); } }
  }
  // sparkles (Gold: one; Golden Boot: several that twinkle across frames)
  if (id.sparkle && size >= 8) {
    const spots = id.sparkle === 2 ? 3 : 1;
    for (let k = 0; k < spots; k++) {
      if (!animated && k > 0) break;
      const t = animated ? frame : 0;
      const a = -2.3 + k * 2.1 + t * 0.55 * (k % 2 ? -1 : 1), rad = R * (0.78 + 0.18 * ((t + k) % 3));
      const sx = Math.round(cx + Math.cos(a) * rad), sy = Math.round(cy + Math.sin(a) * rad);
      const big = animated ? (t + k) % 4 !== 3 : true, arm = big ? Math.max(1, Math.round(size / 12)) : 1;
      const white = rgb("#ffffff"), pale = rgb(id.trim);
      put(sx, sy, white);
      for (let d = 1; d <= arm; d++) {
        const c = d === arm ? pale : white;
        if (sx + d < cellSize) put(sx + d, sy, c); if (sx - d >= 0) put(sx - d, sy, c);
        if (sy + d < cellSize) put(sx, sy + d, c); if (sy - d >= 0) put(sx, sy - d, c);
      }
    }
  }
}

/** Spin angle (radians) → sprite frame. */
export const frameOf = (spin: number) => ((Math.floor((spin / (Math.PI * 2)) * BALL_FRAMES) % BALL_FRAMES) + BALL_FRAMES) % BALL_FRAMES;

/** Draw one frame of a cached ball sprite centred at (x, y). */
export function drawBallSprite(c: CanvasRenderingContext2D, x: number, y: number, size: number, rarity: number, season: Season, frame: number, reduced = ballReducedMotion()): boolean {
  const sprite = ballSprite(rarity, season, size, !reduced);
  if (!sprite) return false;
  const f = ((frame % BALL_FRAMES) + BALL_FRAMES) % BALL_FRAMES;
  c.drawImage(sprite.canvas as CanvasImageSource, f * sprite.cell, 0, sprite.cell, sprite.cell, Math.round(x - sprite.cell / 2), Math.round(y - sprite.cell / 2), sprite.cell, sprite.cell);
  return true;
}

const shadowCache = new Map<number, Surface | null>();
/** Pixel ground shadow (a dithered ellipse) under a ball of the given diameter, centred at (x, y). */
export function drawBallShadow(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
  size = Math.max(3, Math.round(size));
  let s = shadowCache.get(size);
  if (s === undefined) {
    const w = size + 2, h = Math.max(2, Math.round(size * 0.3));
    s = surface(w, h);
    const context = s?.getContext("2d") as CanvasRenderingContext2D | null | undefined;
    if (s && context) {
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        const nx = (px + 0.5 - w / 2) / (w / 2), ny = (py + 0.5 - h / 2) / (h / 2), d = nx * nx + ny * ny;
        if (d > 1) continue;
        if (d > 0.55 && (px + py) % 2) continue;
        context.fillStyle = d < 0.35 ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.32)"; context.fillRect(px, py, 1, 1);
      }
    } else s = null;
    shadowCache.set(size, s);
  }
  if (s) c.drawImage(s as CanvasImageSource, Math.round(x - (s.width as number) / 2), Math.round(y - (s.height as number) / 2));
}

/** Pixel ball at (x, y) with radius r (logical px), rotation spin (→ one of 8 frames), optional squash. */
export function drawBall(c: CanvasRenderingContext2D, x: number, y: number, r: number, fx: RarityFx, spin = 0, squash = 0, onFire = false) {
  const rarity = fx.id ?? 7, season: Season = fx.season ?? "S1", size = Math.max(3, Math.round(r * 2));
  if (onFire) {
    const flicker = ballReducedMotion() ? 0 : Math.sin(spin * 3) * 0.6;
    c.fillStyle = "#ff8c0044"; c.beginPath(); c.arc(x, y, r + 1.6 + flicker, 0, Math.PI * 2); c.fill();
  }
  if (squash) { c.save(); c.translate(x, y); c.scale(1 + squash, 1 - squash); c.translate(-x, -y); }
  if (!drawBallSprite(c, x, y, size, rarity, season, frameOf(spin))) {
    c.fillStyle = fx.base; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  if (squash) c.restore();
}

// ── B7: readable in flight ───────────────────────────────────────────────────
// Drawing only: the physics radius (BALL_RADIUS at the crossing) is untouched. In flight the ball is DRAWN
// bigger (so its 1 px identity outline and panel pattern survive: a sprite of 8 px or more), easing back to the
// exact physics radius over the last stretch, so at the crossing the drawn disc is the one the keeper rig tested.
/** In-flight draw scale and floor (logical px radius). */
export const FLIGHT_SCALE = 1.45, FLIGHT_MIN_R = 4;
const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** 0 at the strike → 1 by 12 % of the flight, held, → 0 at the crossing (from 78 %). */
export const flightBoost = (p: number) => (p <= 0 || p >= 1 ? 0 : Math.min(smooth(p / 0.12), 1 - smooth((p - 0.78) / 0.22)));
/** The radius a ball of physics radius `r` is drawn at, `p` (0..1) through its flight. Never smaller than `r`. */
export function flightRadius(r: number, p: number): number {
  const big = Math.max(r * FLIGHT_SCALE, FLIGHT_MIN_R);
  return big <= r ? r : r + (big - r) * flightBoost(p);
}

/** Ribbon trail colours: `edge` (the rarity colour), `core` (its bright centre line) and a width cap. */
export type Ribbon = { edge: string; core: string | null; maxWidth: number };
/** Index = rarity (7 = standard ball). Colours reused from RARITY_FX / BALL_IDENTITY (fixed, learnable hues). */
export const RIBBONS: readonly Ribbon[] = [
  { edge: "#8a7a66", core: "#b3a48f", maxWidth: 99 }, // Scuffed: dusty brown
  { edge: "#f08a24", core: "#ffd23f", maxWidth: 99 }, // Training: orange
  { edge: "#2a6fdb", core: "#7fd3ff", maxWidth: 99 }, // Match: blue
  { edge: "#16a34a", core: "#b9f6ca", maxWidth: 99 }, // Pro: green
  { edge: "#8a96a8", core: "#ffffff", maxWidth: 99 }, // Silver: steel with a white-hot core
  { edge: "#c8921a", core: "#fff2b3", maxWidth: 99 }, // Gold
  { edge: "#ff3b1f", core: "#ffd23f", maxWidth: 99 }, // Golden Boot: fire
  { edge: "#f4f4f4", core: null, maxWidth: 2 },       // Standard: a thin chalk streak (not a rarity)
];
const vintageRibbons = new Map<number, Ribbon>();
/** The ribbon for a ball (Season 0 editions trail their vintage leather colour). */
export function ribbonFor(fx: RarityFx): Ribbon {
  const rarity = fx.id ?? 7;
  if (fx.season !== "S0") return RIBBONS[rarity] ?? RIBBONS[7];
  let out = vintageRibbons.get(rarity);
  if (!out) { out = { edge: VINTAGE[rarity] ?? VINTAGE[0], core: "#f5e6c8", maxWidth: 99 }; vintageRibbons.set(rarity, out); }
  return out;
}
export type RibbonPoint = { x: number; y: number; r: number };
/**
 * A short, pixel-snapped ribbon behind a flying ball: `points` run head (the ball) → tail. Square stamps every
 * pixel, tapering from 0.8 × the ball's diameter to 1 px, the rarity colour with a bright core, the far half
 * dithered on a fixed screen checker (no random flicker).
 */
export function drawRibbon(c: CanvasRenderingContext2D, points: readonly RibbonPoint[], ribbon: Ribbon) {
  if (points.length < 2) return;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  if (total < 1) return;
  for (const pass of [0, 1] as const) {
    const color = pass ? ribbon.core : ribbon.edge;
    if (!color) continue;
    c.fillStyle = color;
    let run = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(len));
      for (let s = 0; s < steps; s++) {
        const k = s / steps, t = (run + len * k) / total, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, r = a.r + (b.r - a.r) * k;
        const w = Math.min(ribbon.maxWidth, Math.max(1, Math.round(r * 1.6 * (1 - t)))) - pass * 2;
        if (w < 1) continue;
        const px = Math.round(x - w / 2), py = Math.round(y - w / 2);
        if (t > 0.55 && ((px + py) & 1)) continue;
        c.fillRect(px, py, w, w);
      }
      run += len;
    }
  }
}

/** Per-frame trail particles for a flying ball. */
export function emitTrail(particles: Particles, fx: RarityFx, x: number, y: number, onFire: boolean) {
  switch (onFire ? "fire" : fx.kind) {
    case "dust": particles.emit("dust", x, y, 1, { color: fx.trail, speed: 10, life: 0.5, gravity: 10 }); break;
    case "neon": particles.emit("spark", x, y, 2, { color: fx.trail, speed: 6, life: 0.35, gravity: 0 }); break;
    case "sparkle": particles.emit("sparkle", x, y, 2, { color: fx.trail, speed: 18, life: 0.5, gravity: 0 }); break;
    case "comet": particles.emit("spark", x, y, 3, { color: fx.trail, speed: 4, life: 0.6, gravity: 0, size: 2 }); break;
    case "gold": particles.emit("sparkle", x, y, 3, { color: fx.trail, speed: 24, life: 0.7, gravity: 10 }); break;
    case "fire": particles.emit("fire", x, y, 4, { color: ["#ff8c00", "#ff3b1f", "#ffd23f"], speed: 20, life: 0.45, gravity: -40, size: 2 }); break;
    default: break;
  }
}
