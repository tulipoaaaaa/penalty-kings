/**
 * Ball rarities as spectacle: unique sprite colours, spin, trails and particle signatures.
 */
import type { Particles } from "./core.js";

export type RarityFx = { base: string; accent: string; trail: string[]; kind: "dust" | "neon" | "clean" | "sparkle" | "comet" | "gold" | "fire"; tier: number };
/** Indexed by outcome id - 1 (Scuffed … Golden Boot); index 7 = warm-up ball. */
export const RARITY_FX: readonly RarityFx[] = [
  { base: "#8a7a66", accent: "#5b4f40", trail: ["#8a7a66", "#b3a48f"], kind: "dust", tier: 0 },
  { base: "#f2f2f2", accent: "#f08a24", trail: ["#f08a24", "#ffd23f"], kind: "neon", tier: 1 },
  { base: "#ffffff", accent: "#2a6fdb", trail: ["#ffffff"], kind: "clean", tier: 1 },
  { base: "#ffffff", accent: "#16a34a", trail: ["#7fd3ff", "#2a6fdb", "#ffffff"], kind: "sparkle", tier: 2 },
  { base: "#d7dde5", accent: "#8a96a8", trail: ["#ffffff", "#d7dde5", "#8a96a8"], kind: "comet", tier: 3 },
  { base: "#ffd23f", accent: "#b8860b", trail: ["#ffd23f", "#fff2b3", "#ffffff"], kind: "gold", tier: 4 },
  { base: "#ffe680", accent: "#ff8c00", trail: ["#ff8c00", "#ff3b1f", "#ffd23f"], kind: "fire", tier: 5 },
  { base: "#f4f4f4", accent: "#9aa3ad", trail: ["#ffffff"], kind: "clean", tier: 0 },
];

const PANEL = [
  "..#####..",
  ".#..o..#.",
  "#..ooo..#",
  "#.o...o.#",
  "#oo...oo#",
  "#.o...o.#",
  "#..ooo..#",
  ".#..o..#.",
  "..#####..",
];

/** Pixel ball at (x, y) with radius r (logical px), rotation spin, optional squash. */
export function drawBall(c: CanvasRenderingContext2D, x: number, y: number, r: number, fx: RarityFx, spin = 0, squash = 0, onFire = false) {
  const scale = Math.max(1, Math.round((r * 2) / 9 * 2) / 2), size = 9 * scale;
  c.save();
  c.translate(x, y);
  if (squash) c.scale(1 + squash, 1 - squash);
  c.rotate(spin);
  const left = -size / 2, top = -size / 2;
  PANEL.forEach((row, py) => {
    const first = row.indexOf("#"), last = row.lastIndexOf("#");
    for (let px = first; px <= last; px++) {
      const p = row[px];
      c.fillStyle = p === "#" ? "#1a1a1a" : p === "o" ? fx.accent : fx.base;
      c.fillRect(left + px * scale, top + py * scale, scale, scale);
    }
  });
  if (onFire || fx.kind === "fire") { c.fillStyle = "#ff8c0066"; c.fillRect(left - scale, top - scale, size + scale * 2, size + scale * 2); }
  c.restore();
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
