/**
 * Rendering foundation: easing, tweens/timelines, trauma camera, pooled particles and a
 * palette-indexed sprite cache. Internal resolution 480 × 320, integer-upscaled, no smoothing.
 */
export const W = 480, H = 320;

// ── Easing ───────────────────────────────────────────────────────────────────
export const ease = {
  linear: (t: number) => t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  outElastic: (t: number) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
/**
 * Canvas heading face. Pixelify's BOLD uppercase C closes into an O at Stage sizes ("OLANG!", "HAT-TRIOK!",
 * "SOUFFED BALL"), so canvas headings use PKHead: the Departure Mono subset style.css declares for the DOM headings
 * (A–Z, digits, number punctuation; anything else falls back to Pixelify). One weight: never ask for bold.
 */
export const HEAD_FACE = "PKHead, PixelifySans, monospace";
export const headFont = (px: number) => `${px}px ${HEAD_FACE}`;
/** Canvas text does not start a web-font download by itself: ask for PKHead once so the first chip already has it. */
export function loadHeadFont() {
  try {
    const fonts = (globalThis as { document?: { fonts?: { load(font: string, text?: string): Promise<unknown> } } }).document?.fonts;
    fonts?.load(headFont(16), "CLANG!").catch(() => undefined);
  } catch { /* no FontFaceSet */ }
}
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of `t` through a window [start, start + duration], eased. */
export const phase = (t: number, start: number, duration: number, fn: (x: number) => number = ease.linear) => fn(clamp01((t - start) / duration));

// ── Timeline: fire callbacks once at scheduled times of a choreographed sequence ──
export class Timeline {
  private events: { at: number; fn: () => void; done: boolean }[] = [];
  time = 0;
  at(time: number, fn: () => void) { this.events.push({ at: time, fn, done: false }); return this; }
  advance(dt: number) {
    this.time += dt;
    for (const event of this.events) if (!event.done && this.time >= event.at) { event.done = true; event.fn(); }
  }
  reset() { this.events = []; this.time = 0; }
}

// ── Camera: follow, zoom punch, trauma shake, slow-mo time scale ─────────────
/** Largest shake in logical px (480 × 320) at trauma 1. */
export const SHAKE_MAX = { x: 5, y: 4 } as const;
/**
 * Screen shake offset (Eiserloh's trauma model): trauma² × max, smooth (two incommensurate sines, not
 * white noise), snapped to whole logical pixels so the pixel art never shimmers. Zero under reduced motion.
 */
export function shakeOffset(trauma: number, time: number, reduced: boolean, yScale = 1) {
  if (reduced || trauma <= 0) return { x: 0, y: 0 };
  const s = trauma * trauma;
  const nx = Math.sin(time * 38.1) * 0.65 + Math.sin(time * 61.7 + 1.3) * 0.35, ny = Math.cos(time * 43.3) * 0.65 + Math.sin(time * 57.9 + 2.1) * 0.35;
  return { x: Math.round(s * SHAKE_MAX.x * nx) || 0, y: Math.round(s * SHAKE_MAX.y * yScale * ny) || 0 };
}
/** Zoom punch envelope 0–1 at `t` s: an 80 ms ease-out rise, a hold to 0.3 s, then an ease back by `dur`. */
export function punchEnvelope(t: number, dur: number) {
  if (t < 0 || t >= dur) return 0;
  if (t < 0.08) return ease.outQuad(t / 0.08);
  if (t < 0.3) return 1;
  return 1 - ease.inOutCubic(clamp01((t - 0.3) / (dur - 0.3)));
}
export class Camera {
  x = W / 2; y = H / 2; zoom = 1;
  targetX = W / 2; targetY = H / 2; targetZoom = 1;
  trauma = 0; timeScale = 1; hitStop = 0;
  /** Vertical share of the shake (a post clang shakes mostly sideways). Back to 1 once the trauma is spent. */
  shakeY = 1;
  /** A short zoom-in punch towards a world point (the net point on a goal), on top of the follow zoom. */
  punch: { x: number; y: number; amount: number; t: number; dur: number } | null = null;
  reduced = false;
  addTrauma(amount: number, shakeY = 1) { if (this.reduced) return; if (this.trauma <= 0.05 || shakeY < this.shakeY) this.shakeY = shakeY; this.trauma = Math.min(1, this.trauma + amount); }
  /** Hit-stop: freeze for `seconds` (the longer of the current and the new freeze). */
  freeze(seconds: number) { this.hitStop = Math.max(this.hitStop, seconds); }
  punchAt(x: number, y: number, amount: number, dur = 0.8) { if (!this.reduced) this.punch = { x, y, amount, t: 0, dur }; }
  update(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    this.x = lerp(this.x, this.targetX, k); this.y = lerp(this.y, this.targetY, k); this.zoom = lerp(this.zoom, this.targetZoom, k);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    if (this.trauma === 0) this.shakeY = 1;
    if (this.punch && (this.punch.t += dt) >= this.punch.dur) this.punch = null;
  }
  apply(context: CanvasRenderingContext2D, time: number) {
    const { x: ox, y: oy } = shakeOffset(this.trauma, time, this.reduced, this.shakeY);
    let zoom = this.zoom, cx = this.x, cy = this.y;
    const p = this.punch, env = p && !this.reduced ? punchEnvelope(p.t, p.dur) : 0;
    if (p && env > 0) {
      // Keep the punch point where it is on screen, drift it a quarter of the way to the centre, never show past the world's edge.
      const z = zoom * (1 + p.amount * env);
      cx = p.x - ((p.x - cx) * zoom) / z; cy = p.y - ((p.y - cy) * zoom) / z;
      cx += (p.x - cx) * 0.25 * env; cy += (p.y - cy) * 0.25 * env;
      const hw = W / (2 * z), hh = H / (2 * z);
      cx = Math.min(W - hw, Math.max(hw, cx)); cy = Math.min(H - hh, Math.max(hh, cy));
      zoom = z;
    }
    context.translate(W / 2 + ox, H / 2 + oy);
    context.scale(zoom, zoom);
    context.translate(-cx, -cy);
  }
  reset() { this.targetX = this.x = W / 2; this.targetY = this.y = H / 2; this.targetZoom = this.zoom = 1; this.trauma = 0; this.timeScale = 1; this.hitStop = 0; this.shakeY = 1; this.punch = null; }
}

// ── Particles: pooled, capped, cheap pixel squares ───────────────────────────
export type ParticleKind = "confetti" | "grass" | "dust" | "spark" | "smoke" | "rain" | "snow" | "firework" | "fire" | "ink" | "thread" | "sparkle" | "zzz";
type Particle = { alive: boolean; kind: ParticleKind; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; gravity: number; drag: number; spin: number };
export class Particles {
  private pool: Particle[] = [];
  budget = 1; // 0.25 under reduced motion or when frames drop
  constructor(private cap = 500) {
    for (let i = 0; i < cap; i++) this.pool.push({ alive: false, kind: "dust", x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: "#fff", gravity: 0, drag: 0, spin: 0 });
  }
  get count() { let n = 0; for (const p of this.pool) if (p.alive) n++; return n; }
  emit(kind: ParticleKind, x: number, y: number, count: number, options: Partial<{ color: string | string[]; speed: number; spread: number; angle: number; life: number; size: number; gravity: number; drag: number }> = {}) {
    const n = Math.max(1, Math.round(count * this.budget));
    for (let i = 0; i < n; i++) {
      const p = this.pool.find(item => !item.alive);
      if (!p) return;
      const speed = (options.speed ?? 60) * (0.5 + Math.random() * 0.8);
      const angle = (options.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (options.spread ?? Math.PI);
      const colors = Array.isArray(options.color) ? options.color : [options.color ?? "#fff"];
      Object.assign(p, { alive: true, kind, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0, max: (options.life ?? 1) * (0.7 + Math.random() * 0.6), size: options.size ?? 1, color: colors[Math.floor(Math.random() * colors.length)], gravity: options.gravity ?? 120, drag: options.drag ?? 0.5, spin: Math.random() * 6 });
    }
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; continue; }
      p.vx *= 1 - p.drag * dt; p.vy = p.vy * (1 - p.drag * dt) + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.spin += dt * 8;
    }
  }
  draw(context: CanvasRenderingContext2D) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const fade = 1 - p.life / p.max;
      context.globalAlpha = p.kind === "smoke" ? fade * 0.5 : p.kind === "ink" ? fade * 0.9 : Math.min(1, fade * 1.5);
      context.fillStyle = p.color;
      if (p.kind === "confetti") { const w = Math.abs(Math.cos(p.spin)) * 2 + 1; context.fillRect(Math.round(p.x), Math.round(p.y), Math.round(w), 2); }
      else if (p.kind === "rain") context.fillRect(Math.round(p.x), Math.round(p.y), 1, 4);
      else if (p.kind === "smoke") { const s = Math.round(p.size + p.life * 10); context.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s); }
      else if (p.kind === "zzz") { context.font = "8px PixelifySans, monospace"; context.fillText("z", Math.round(p.x), Math.round(p.y)); }
      else context.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    context.globalAlpha = 1;
  }
  clear() { for (const p of this.pool) p.alive = false; }
}

// ── Palette-indexed sprites ──────────────────────────────────────────────────
export type Palette = Readonly<Record<string, string>>;
const spriteCache = new Map<string, HTMLCanvasElement>();
/** Rows of palette keys ('.' = transparent) → cached canvas. */
export function sprite(key: string, rows: readonly string[], palette: Palette): HTMLCanvasElement {
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(...rows.map(row => row.length)); canvas.height = rows.length;
  const context = canvas.getContext("2d")!;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = palette[row[x]]; if (c) { context.fillStyle = c; context.fillRect(x, y, 1, 1); } } });
  spriteCache.set(key, canvas);
  return canvas;
}
/** Draw a sprite centred at (x, y-anchor bottom) with whole-sprite transforms only. */
export function drawSprite(context: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, x: number, y: number, options: { scale?: number; flip?: boolean; rotate?: number; sx?: number; sy?: number; alpha?: number; anchorY?: number } = {}) {
  const scale = options.scale ?? 1, w = image.width * scale, h = image.height * scale;
  context.save();
  context.globalAlpha = options.alpha ?? 1;
  context.translate(Math.round(x), Math.round(y));
  if (options.rotate) context.rotate(options.rotate);
  context.scale((options.flip ? -1 : 1) * (options.sx ?? 1), options.sy ?? 1);
  context.drawImage(image, -w / 2, -h * (options.anchorY ?? 1), w, h);
  context.restore();
}

/** A 4-point pixel star (a plus of 1 px arms around a 2 px-wide core), `len` px per arm. */
export function pixelStar(c: CanvasRenderingContext2D, x: number, y: number, len: number, colour: string) {
  if (len < 1) return;
  c.fillStyle = colour; c.fillRect(x - len, y, len * 2 + 1, 1); c.fillRect(x, y - len, 1, len * 2 + 1);
  if (len > 2) { c.fillRect(x - 1, y - 1, 3, 3); c.globalAlpha *= 0.5; c.fillRect(x - 2, y - 2, 1, 1); c.fillRect(x + 2, y - 2, 1, 1); c.fillRect(x - 2, y + 2, 1, 1); c.fillRect(x + 2, y + 2, 1, 1); c.globalAlpha *= 2; }
}
/** Deterministic hash → [0, 1). */
export function hash01(n: number) { let t = (n * 2654435761) >>> 0; t ^= t >>> 15; t = Math.imul(t, 2246822519) >>> 0; t ^= t >>> 13; return (t >>> 0) / 4294967296; }

/** Frame-time meter (exposed to the Playwright harness). */
export class FrameMeter {
  private samples: number[] = [];
  push(ms: number) { this.samples.push(ms); if (this.samples.length > 240) this.samples.shift(); }
  get average() { return this.samples.length ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length : 0; }
  get p95() { if (!this.samples.length) return 0; const s = [...this.samples].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)]; }
}
