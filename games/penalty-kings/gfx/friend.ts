/**
 * The player's Friend: the hero. Its canonical 16 × 16 mask is NEVER edited — only whole-sprite
 * transforms (translate, rotate, squash/stretch, flip) plus layers AROUND it: shadow, boots,
 * headband, cape, trails, sparkles, a trophy. Eight choreographed celebrations and reactions.
 */
import { ease, clamp01, type Particles } from "./core.js";

export type FriendRows = readonly string[] | null;
export type FriendLayers = { halo: string; boots: string; headband: string | null; cape: boolean; laced: number };
export type FriendPose = { x: number; y: number; scale: number; rotate: number; sx: number; sy: number; flip: boolean; alpha: number; shadowY?: number };

export const CELEBRATIONS = [
  { id: "knee-slide", name: "Knee slide" },
  { id: "spin-point", name: "Spin and point" },
  { id: "backflip", name: "Backflip" },
  { id: "badge-kiss", name: "Badge kiss" },
  { id: "crowd-surf", name: "Crowd surf" },
  { id: "disco", name: "Disco dance" },
  { id: "superhero", name: "Superhero pose" },
  { id: "trophy-lift", name: "Trophy lift" },
] as const;
export type CelebrationId = typeof CELEBRATIONS[number]["id"];

const maskCache = new Map<string, HTMLCanvasElement>();
/** The canonical mask at one pixel per cell with a one-cell halo border ('#' → black, halo around it). */
function maskImage(rows: readonly string[], halo: string) {
  const key = `${halo}|${rows.join("/")}`, cached = maskCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas"), w = Math.max(...rows.map(row => row.length)) + 2, h = rows.length + 2;
  canvas.width = w; canvas.height = h;
  const m = canvas.getContext("2d")!;
  m.fillStyle = halo;
  rows.forEach((row, py) => { for (let px = 0; px < row.length; px++) if (row[px] === "#") m.fillRect(px, py, 3, 3); });
  m.fillStyle = "#000000";
  rows.forEach((row, py) => { for (let px = 0; px < row.length; px++) if (row[px] === "#") m.fillRect(px + 1, py + 1, 1, 1); });
  if (maskCache.size > 96) maskCache.delete(maskCache.keys().next().value!);
  maskCache.set(key, canvas);
  return canvas;
}

/** Draws the canonical mask exactly (black pixels, one-pixel halo in the kit colour) + layers. */
export function drawFriend(c: CanvasRenderingContext2D, rows: FriendRows, pose: FriendPose, layers: FriendLayers, time: number) {
  const s = pose.scale;
  c.save();
  c.globalAlpha = pose.alpha;
  // Shadow (squashes as the Friend rises).
  c.fillStyle = "#00000055";
  c.beginPath(); c.ellipse(Math.round(pose.x), Math.round(pose.shadowY ?? pose.y + 1), 7 * s * (pose.sx || 1), 2 * s, 0, 0, Math.PI * 2); c.fill();
  c.translate(Math.round(pose.x), Math.round(pose.y));
  if (pose.rotate) { c.translate(0, -8 * s); c.rotate(pose.rotate); c.translate(0, 8 * s); }
  c.scale((pose.flip ? -1 : 1) * pose.sx, pose.sy);
  const left = -8 * s, top = -15 * s;
  if (layers.cape) {
    const flutter = Math.sin(time * 12) * 2;
    c.fillStyle = "#e63946"; c.beginPath(); c.moveTo(left + 4 * s, top + 6 * s); c.lineTo(left + 12 * s, top + 6 * s); c.lineTo(left + 15 * s + flutter, top + 17 * s); c.lineTo(left + 1 * s - flutter, top + 17 * s); c.fill();
  }
  if (!rows) {
    // Art still loading (or unreadable): a neutral dashed silhouette, never mistaken for the ball.
    c.fillStyle = "#00000055"; c.strokeStyle = "#ffffffaa"; c.lineWidth = 1; c.setLineDash([2, 2]);
    c.fillRect(left + 3 * s, top + 3 * s, 10 * s, 12 * s); c.strokeRect(left + 3 * s, top + 3 * s, 10 * s, 12 * s); c.setLineDash([]);
    c.fillStyle = "#ffffff"; c.font = `bold ${6 * s}px PixelifySans, monospace`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("?", 0, top + 9 * s); c.textAlign = "left"; c.textBaseline = "alphabetic";
  } else {
    // The scale follows perspective (non-integer) and the sprite rotates/squashes, so the mask is
    // rasterised once at one pixel per cell (halo + black, exactly as read) and drawn as a single
    // nearest-neighbour image: no seams between cells at any scale or angle.
    const smoothing = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    const mask = maskImage(rows, layers.halo);
    c.drawImage(mask, left - s, top - s, mask.width * s, mask.height * s);
    c.imageSmoothingEnabled = smoothing;
    const topRow = rows.findIndex(row => row.includes("#")), lowest = rows.reduce((found, row, index) => (row.includes("#") ? index : found), -1);
    if (layers.headband && topRow >= 0) { c.fillStyle = layers.headband; c.fillRect(left + rows[topRow].indexOf("#") * s - s, top + (topRow - 1) * s, (rows[topRow].lastIndexOf("#") - rows[topRow].indexOf("#") + 3) * s, s); }
    if (lowest >= 0) {
      // Boots sit just below the lowest row of the mask; laced boots glow (Bootroom).
      const row = rows[lowest], first = row.indexOf("#"), last = row.lastIndexOf("#"), by = top + (lowest + 1) * s;
      if (layers.laced > 0) { c.fillStyle = `rgba(255,210,63,${0.25 + 0.2 * Math.sin(time * 4)})`; c.fillRect(left + first * s - 2 * s, by - s, (last - first + 5) * s, 3 * s); }
      c.fillStyle = layers.boots;
      c.fillRect(left + first * s - s, by, s * 2, s); c.fillRect(left + last * s, by, s * 2, s);
    }
  }
  c.restore();
}

/**
 * Kick-leg overlay (drawn ON TOP of the unaltered sprite): a pixel leg from the Friend's right hip
 * to the boot, in the mask's black with the kit halo, bent at the knee by frame
 * (back-lift → swing → contact → follow-through). The boot's centre is exactly `leg.foot`.
 */
export function drawKickLeg(c: CanvasRenderingContext2D, leg: { frame: "back" | "swing" | "contact" | "through"; hip: { x: number; y: number }; foot: { x: number; y: number } }, scale: number, halo: string, boots: string) {
  const { hip, foot } = leg, dx = foot.x - hip.x, dy = foot.y - hip.y, len = Math.hypot(dx, dy) || 1;
  const bend = { back: 0.35, swing: 0.18, contact: 0.04, through: -0.12 }[leg.frame];
  // Knee: off the hip→foot line, towards the camera (down-screen) and back.
  const knee = { x: hip.x + dx / 2 - (dy / len) * len * bend, y: hip.y + dy / 2 + (Math.abs(dx) / len) * len * bend };
  const w = Math.max(2, Math.round(scale * 1.2)), h = Math.max(1, Math.round(scale * 0.5));
  const walk = (grow: number) => {
    for (const [a, b] of [[hip, knee], [knee, foot]] as const) {
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, w / 2)));
      for (let i = 0; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
        c.fillRect(Math.round(x - w / 2) - grow, Math.round(y - w / 2) - grow, w + grow * 2, w + grow * 2);
      }
    }
  };
  c.fillStyle = halo; walk(h);
  c.fillStyle = "#000000"; walk(0);
  const bw = Math.max(3, Math.round(scale * 2)), bh = Math.max(2, Math.round(scale));
  c.fillStyle = "#000000"; c.fillRect(Math.round(foot.x - bw / 2) - 1, Math.round(foot.y - bh / 2) - 1, bw + 2, bh + 2);
  c.fillStyle = boots; c.fillRect(Math.round(foot.x - bw / 2), Math.round(foot.y - bh / 2), bw, bh);
}

/** Contact flash at the ball: a white pixel burst that grows and fades over ~0.12 s (`k` 1 → 0). */
export function drawContactFlash(c: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, reduced = false) {
  const reach = r + 2 + (reduced ? 2 : (1 - k) * 9), dot = Math.max(2, Math.round(r * 0.6));
  c.save();
  c.globalAlpha = Math.min(1, k * 1.4) * (reduced ? 0.6 : 1);
  c.strokeStyle = "#ffffff"; c.lineWidth = 1.5;
  c.beginPath(); c.arc(x, y, r + 1.5, 0, Math.PI * 2); c.stroke();
  c.fillStyle = "#fff6b0";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, d = i % 2 ? reach * 0.75 : reach;
    c.fillRect(Math.round(x + Math.cos(a) * d - dot / 2), Math.round(y + Math.sin(a) * d - dot / 2), dot, dot);
  }
  c.restore();
}

export type Beat = { dx: number; dy: number; rotate: number; sx: number; sy: number; flip: boolean; facing: "down" | "up" | "left" | "right"; cape: boolean; trophy: boolean };

// ── B12: celebrations with follow-through ────────────────────────────────────
// Every celebration and reaction beat is keyed like a classic animation: ANTICIPATION (a crouch or
// wind-up away from the action) → ACTION (stretch into it) → OVERSHOOT (squash on landing, the lean
// or rotation carried past the pose) → FOLLOW-THROUGH/SETTLE (back to an exact rest pose). Only whole-
// sprite transforms: the canonical mask is never redrawn. Offsets are whole pixels, rotation moves in
// π/64 steps and squash/stretch in 1/64 steps, so the nearest-neighbour sprite never shimmers.
// Timings: every celebration settles by CELEBRATION_SETTLE (the Stage's celebrate mode still runs 2.6 s),
// every reaction by REACTION_SETTLE (react mode still runs 1.6 s). Reduced motion: one static pose, no
// squash/stretch bounce and no dust.

type Ease = "io" | "in" | "out" | "outCubic";
/** A pose track key: [time s, value, easing of the segment that ENDS at this key (default ease-in-out)]. */
export type Key = readonly [number, number, Ease?];
const EASES: Record<Ease, (x: number) => number> = { io: x => 0.5 - Math.cos(Math.PI * x) / 2, in: ease.inQuad, out: ease.outQuad, outCubic: ease.outCubic };
/** Value of a keyed track at t (holds the first/last key's value outside the keys). */
export function track(keys: readonly Key[], t: number) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, fn = "io"] = keys[i];
    if (t < t1) { const [t0, v0] = keys[i - 1]; return v0 + (v1 - v0) * EASES[fn]((t - t0) / (t1 - t0)); }
  }
  return keys[keys.length - 1][1];
}

export const CELEBRATION_SETTLE = 2.4;
export const REACTION_SETTLE = 1.4;
export const ROTATE_STEP = Math.PI / 64;
const px = (v: number) => Math.round(v) || 0; // whole pixels, never -0
const steps = (v: number, step: number) => (Math.round(v / step) * step) || 0;
/** Volume-preserving squash/stretch: `sy` is keyed and `sx` widens as it squashes. `size` is a uniform (non-bounce) scale. */
function pose(base: Beat, dx: number, dy: number, rotate: number, sy: number, size = 1): Beat {
  const sq = steps(sy, 1 / 64);
  return { ...base, dx: px(dx), dy: px(dy), rotate: steps(rotate, ROTATE_STEP), sx: steps(size * (1 + (1 - sq) * 0.6), 1 / 64), sy: steps(size * sq, 1 / 64) };
}
const BASE: Beat = { dx: 0, dy: 0, rotate: 0, sx: 1, sy: 1, flip: false, facing: "down", cape: false, trophy: false };

/** Knee slide: crouch → sprint (stretch, leaning in) → drop to the knees → a decelerating slide leaning BACK → the torso's follow-through at the stop → spring up with a settle bounce. */
const KNEE = {
  dx: [[0, 0], [0.18, -3], [0.38, 10, "in"], [1.5, 70, "outCubic"]] as Key[],
  dy: [[0, 0], [0.18, 0], [0.28, -3, "out"], [0.38, 0, "in"], [0.46, 3], [2.0, 3], [2.12, -3, "out"], [2.25, 0, "in"]] as Key[],
  rotate: [[0, 0], [0.18, -0.06], [0.38, 0.12], [0.5, -0.34], [0.62, -0.26], [1.5, -0.26], [1.64, -0.14], [1.84, -0.32], [2.0, -0.26], [2.25, 0], [2.33, 0.05], [2.4, 0]] as Key[],
  sy: [[0, 1], [0.18, 0.86], [0.3, 1.12], [0.38, 1.1], [0.46, 0.86], [0.56, 0.97], [0.64, 0.94], [2.0, 0.94], [2.12, 1.1], [2.25, 0.86], [2.33, 1.05], [2.4, 1]] as Key[],
};
const SPIN = {
  dy: [[0, 0], [0.15, 0], [0.52, -13, "out"], [0.9, 0, "in"]] as Key[],
  rotate: [[0, 0], [0.9, 0], [1.02, -0.22], [1.18, -0.05], [1.3, -0.1]] as Key[],
  sy: [[0, 1], [0.15, 0.84], [0.25, 1.12], [0.52, 1.03], [0.86, 1.06], [0.96, 0.84], [1.1, 1.06], [1.22, 0.98], [1.3, 1]] as Key[],
};
const FLIP = {
  dy: [[0, 0], [0.22, 0], [0.67, -44, "out"], [1.12, 0, "in"]] as Key[],
  // One full backward turn in the air, carried 0.2 rad past upright on landing and rocked back.
  rotate: [[0, 0], [0.22, 0.1], [1.12, -Math.PI * 2 - 0.2], [1.28, -Math.PI * 2 + 0.07], [1.42, -Math.PI * 2]] as Key[],
  sy: [[0, 1], [0.22, 0.8], [0.3, 1.16], [0.5, 1], [1.05, 1], [1.12, 1.06], [1.22, 0.8], [1.36, 1.07], [1.48, 0.98], [1.56, 1]] as Key[],
};
const KISS = {
  dy: [[0, 0], [0.2, 0], [0.4, -7, "out"], [0.6, 0, "in"], [1.9, 0], [2.05, -5, "out"], [2.2, 0, "in"]] as Key[],
  rotate: [[0, 0], [0.6, 0], [0.8, 0.12], [1.0, 0.06], [1.65, 0.06], [1.8, -0.05], [1.95, 0]] as Key[],
  sy: [[0, 1], [0.2, 0.88], [0.4, 1.1], [0.55, 0.9], [0.65, 1.03], [0.72, 1], [1.9, 1], [1.96, 0.9], [2.05, 1.08], [2.2, 0.88], [2.3, 1.04], [2.4, 1]] as Key[],
};
const SURF = {
  dx: [[0, 0], [0.2, 0], [0.9, 20], [1.6, -12], [1.9, -8]] as Key[],
  dy: [[0, 0], [0.2, 3], [1.4, -128], [1.7, -116], [1.9, -120]] as Key[],
  rotate: [[0, 0], [0.2, 0.08], [1.4, -Math.PI / 2 - 0.2], [1.7, -Math.PI / 2 + 0.08], [1.9, -Math.PI / 2]] as Key[],
  sy: [[0, 1], [0.2, 0.86], [0.35, 1.12], [0.6, 1]] as Key[],
  size: [[0, 1], [0.2, 1], [1.6, 0.65]] as Key[],
};
const HERO = {
  dy: [[0, 0], [0.2, 0], [0.55, -11, "out"], [0.75, -6], [0.9, -8]] as Key[],
  sy: [[0, 1], [0.2, 0.84], [0.35, 1.14], [0.55, 1.04], [0.75, 0.94], [0.9, 1.03], [1.0, 1]] as Key[],
};
const TROPHY = {
  dy: [[0, 0], [0.25, 0], [0.5, -9, "out"], [0.75, 0, "in"], [0.95, -6, "out"], [1.15, 0, "in"], [1.33, -4, "out"], [1.5, 0, "in"], [1.65, -2, "out"], [1.8, 0, "in"]] as Key[],
  sy: [[0, 1], [0.25, 0.86], [0.35, 1.12], [0.5, 1.04], [0.72, 1.04], [0.8, 0.88], [0.9, 1.06], [1.12, 1.02], [1.2, 0.9], [1.3, 1.04], [1.47, 1.02], [1.54, 0.93], [1.62, 1.02], [1.78, 1.01], [1.85, 0.96], [1.95, 1.02], [2.05, 1]] as Key[],
};
const DISCO = {
  intro: [[0, 1], [0.18, 0.86], [0.25, 0.9]] as Key[],
  rotate: [[2.0, 0], [2.12, -0.24], [2.26, -0.08], [2.4, -0.14]] as Key[],
  sy: [[2.0, 1], [2.08, 0.88], [2.2, 1.08], [2.32, 0.98], [2.4, 1]] as Key[],
};

/** The static pose each celebration shows under reduced motion (no squash/stretch, no travel). */
const STILL: Record<CelebrationId, Partial<Beat>> = {
  "knee-slide": { dy: 2, rotate: steps(-0.2, ROTATE_STEP), facing: "right" },
  "spin-point": { rotate: steps(-0.1, ROTATE_STEP), facing: "left" },
  backflip: {},
  "badge-kiss": { rotate: steps(0.06, ROTATE_STEP) },
  "crowd-surf": { dy: -24, rotate: steps(-0.2, ROTATE_STEP) },
  disco: { rotate: steps(-0.14, ROTATE_STEP) },
  superhero: { dy: -8, cape: true },
  "trophy-lift": { trophy: true },
};

/** Pure pose of a celebration at local time t (seconds). Deterministic, no FX (see celebrationBeat). */
export function celebrationPose(id: CelebrationId, t: number, reduced: boolean): Beat {
  if (reduced) return { ...BASE, ...STILL[id] };
  switch (id) {
    case "knee-slide": return { ...pose(BASE, track(KNEE.dx, t), track(KNEE.dy, t), track(KNEE.rotate, t), track(KNEE.sy, t)), facing: "right" };
    case "spin-point": {
      const spinning = t >= 0.15 && t < 0.9;
      return { ...pose(BASE, 0, track(SPIN.dy, t), track(SPIN.rotate, t), track(SPIN.sy, t)), flip: spinning && Math.floor(t * 14) % 2 === 1, facing: t < 0.9 ? "down" : "left" };
    }
    case "backflip": return pose(BASE, 0, track(FLIP.dy, t), track(FLIP.rotate, t) + (t >= 1.12 ? Math.PI * 2 : 0), track(FLIP.sy, t));
    case "badge-kiss": {
      const breathe = t > 0.72 && t < 1.9 ? Math.sin(((t - 0.72) * Math.PI * 2) / 0.59) * 0.04 : 0; // two whole breaths: zero at both ends
      return pose(BASE, 0, track(KISS.dy, t), track(KISS.rotate, t), track(KISS.sy, t) + breathe);
    }
    case "crowd-surf": {
      const bob = Math.sin(Math.PI * clamp01((t - 0.4) / 1.5)) * Math.sin(t * 8) * 3; // riding the hands, gone by the settle
      return pose(BASE, track(SURF.dx, t), track(SURF.dy, t) + bob, track(SURF.rotate, t), track(SURF.sy, t), track(SURF.size, t));
    }
    case "disco": {
      if (t < 0.25) return pose(BASE, 0, 0, 0, track(DISCO.intro, t));
      if (t >= 2.0) return pose(BASE, 0, 0, track(DISCO.rotate, t), track(DISCO.sy, t));
      // Four steps a second: each lands on the downbeat with a squash, springs up (stretch) and
      // swings into its side with a little overshoot (outBack).
      const at = (t - 0.25) * 4, beat = Math.floor(at) % 4, u = at - Math.floor(at), prev = (beat + 3) % 4;
      const swing = ease.outBack(clamp01(u / 0.45)), X = [-8, 0, 8, 0], R = [0.15, 0, -0.15, 0];
      const fromX = at < 1 ? 0 : X[prev], fromR = at < 1 ? 0 : R[prev];
      return { ...pose(BASE, fromX + (X[beat] - fromX) * swing, -5 * Math.sin(Math.PI * u), fromR + (R[beat] - fromR) * swing, 1 - 0.1 * Math.max(0, 1 - u * 5) + 0.06 * Math.sin(Math.PI * u)), flip: beat === 2 };
    }
    case "superhero": return { ...pose(BASE, 0, track(HERO.dy, t), 0, track(HERO.sy, t)), cape: true };
    case "trophy-lift": return { ...pose(BASE, 0, track(TROPHY.dy, t), 0, track(TROPHY.sy, t)), trophy: t > 0.3 };
  }
}

/** Choreography for a celebration at local time t (seconds; settles by CELEBRATION_SETTLE). Emits its FX. */
export function celebrationBeat(id: CelebrationId, t: number, reduced: boolean, particles: Particles, at: { x: number; y: number }, colors: string[]): Beat {
  const beat = celebrationPose(id, t, reduced);
  const dust = (x: number, n: number) => particles.emit("dust", x, at.y, n, { color: ["#e8e0c8", "#c8b99a", "#a89878"], speed: 24, angle: -Math.PI / 2, spread: 2.2, life: 0.5, gravity: -8, size: 2 });
  switch (id) {
    case "knee-slide":
      if (reduced) break;
      // Turf sprays off the knees while the slide is quick, thinning as it decelerates; a small puff at the knee-drop and at the stop.
      if (t >= 0.38 && t < 1.5 && Math.random() < 0.9 * (1 - (t - 0.38) / 1.12) + 0.1) particles.emit("grass", at.x + beat.dx - 10, at.y, 2, { color: ["#2e7d32", "#8bc34a", "#c8b99a", "#e8e0c8"], speed: 50, angle: -Math.PI * 0.8, spread: 0.8, life: 0.6 });
      if ((t >= 0.38 && t < 0.46) || (t >= 1.42 && t < 1.58)) dust(at.x + beat.dx + 6, 2);
      break;
    case "backflip": {
      const p = clamp01((t - 0.22) / 0.9);
      if (p > 0 && p < 1) particles.emit("sparkle", at.x, at.y - 40 - Math.sin(p * Math.PI) * 40, 2, { color: colors, speed: 10, life: 0.5, gravity: 0 });
      if (!reduced && t >= 1.12 && t < 1.2) dust(at.x, 2);
      break;
    }
    case "spin-point": if (!reduced && t >= 0.9 && t < 0.98) dust(at.x, 1); break;
    case "badge-kiss":
      if (t > 0.5 && t < 1.8 && Math.random() < 0.3) particles.emit("sparkle", at.x + (Math.random() - 0.5) * 30, at.y - 60, 1, { color: ["#ffd23f", "#ffffff", "#ff8fab"], speed: 20, life: 0.8, gravity: -10 });
      break;
    case "disco":
      if (Math.random() < 0.3) particles.emit("sparkle", at.x + (Math.random() - 0.5) * 80, at.y - 80 - Math.random() * 40, 1, { color: ["#ff4fd8", "#ccff00", "#7fd3ff", "#ffd23f"], speed: 5, life: 0.6, gravity: 0 });
      break;
    case "trophy-lift":
      if (t > 0.4 && Math.random() < 0.9) particles.emit("confetti", at.x + (Math.random() - 0.5) * 200, 0, 2, { color: colors, speed: 20, angle: Math.PI / 2, spread: 0.6, gravity: 40, life: 3 });
      break;
  }
  return beat;
}

const REACT = {
  // Save: up on the toes (hope) → the flinch as it's kept out (overshoots the slump) → a head shake that dies away.
  save: { dy: [[0, 0], [0.08, -2], [0.2, 2]] as Key[], sy: [[0, 1], [0.08, 1.06], [0.2, 0.86], [0.32, 0.95], [0.42, 0.9], [0.5, 0.92]] as Key[] },
  // Post: a flinch → jolted up (stretch) → lands with a squash → settles.
  post: { dy: [[0, 0], [0.06, 0], [0.2, -9, "out"], [0.36, 0, "in"], [0.46, -2, "out"], [0.56, 0, "in"]] as Key[], sy: [[0, 1], [0.06, 0.9], [0.14, 1.12], [0.3, 1.02], [0.38, 0.86], [0.48, 1.05], [0.58, 0.98], [0.66, 1]] as Key[] },
  // Miss: a stretched "noo" → slumps past the dejected pose → settles into it.
  miss: { dy: [[0, 0], [0.12, -2], [0.35, 4], [0.5, 2], [0.62, 3]] as Key[], rotate: [[0, 0], [0.12, -0.04], [0.35, 0.14], [0.5, 0.08], [0.62, 0.1]] as Key[], sy: [[0, 1], [0.12, 1.07], [0.35, 0.84], [0.5, 0.91], [0.62, 0.87], [0.7, 0.88]] as Key[] },
};

/** Reactions to a miss / save / post (whole-sprite only), settled by REACTION_SETTLE. */
export function reactionBeat(kind: "miss" | "save" | "post", t: number, reduced: boolean): Beat {
  const base: Beat = { ...BASE, facing: kind === "post" ? "down" : "up" };
  if (reduced) return kind === "save" ? { ...base, dy: 2 } : kind === "miss" ? { ...base, dy: 3, rotate: steps(0.1, ROTATE_STEP) } : base;
  if (kind === "save") return pose(base, 0, track(REACT.save.dy, t), Math.sin(t * 18) * 0.05 * Math.max(0, 1 - t / 1.2), track(REACT.save.sy, t));
  if (kind === "post") return pose(base, 0, track(REACT.post.dy, t), 0, track(REACT.post.sy, t));
  return pose(base, 0, track(REACT.miss.dy, t), track(REACT.miss.rotate, t), track(REACT.miss.sy, t));
}

export function drawTrophy(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = "#b8860b"; c.fillRect(x - 6, y + 10, 12, 3);
  c.fillStyle = "#ffd23f"; c.fillRect(x - 5, y - 6, 10, 12); c.fillRect(x - 8, y - 5, 3, 5); c.fillRect(x + 5, y - 5, 3, 5); c.fillRect(x - 1, y + 6, 2, 4);
  c.fillStyle = "#fff2b3"; c.fillRect(x - 3, y - 4, 2, 6);
}
