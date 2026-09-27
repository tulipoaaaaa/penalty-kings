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

/** Draws the canonical mask exactly (black pixels, one-pixel halo in the kit colour) + layers. */
export function drawFriend(c: CanvasRenderingContext2D, rows: FriendRows, pose: FriendPose, layers: FriendLayers, time: number) {
  const s = pose.scale;
  c.save();
  c.globalAlpha = pose.alpha;
  // Shadow (squashes as the Friend rises).
  c.fillStyle = "#00000055";
  c.beginPath(); c.ellipse(pose.x, pose.shadowY ?? pose.y + 1, 7 * s * (pose.sx || 1), 2 * s, 0, 0, Math.PI * 2); c.fill();
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
    c.fillStyle = layers.halo;
    rows.forEach((row, py) => { for (let px = 0; px < row.length; px++) if (row[px] === "#") c.fillRect(left + px * s - s, top + py * s - s, s * 3, s * 3); });
    c.fillStyle = "#000000";
    rows.forEach((row, py) => { for (let px = 0; px < row.length; px++) if (row[px] === "#") c.fillRect(left + px * s, top + py * s, s, s); });
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

type Beat = { dx: number; dy: number; rotate: number; sx: number; sy: number; flip: boolean; facing: "down" | "up" | "left" | "right"; cape: boolean; trophy: boolean };

/** Choreography for a celebration at local time t (seconds, ~2.4 s long). Emits its FX. */
export function celebrationBeat(id: CelebrationId, t: number, reduced: boolean, particles: Particles, at: { x: number; y: number }, colors: string[]): Beat {
  const base: Beat = { dx: 0, dy: 0, rotate: 0, sx: 1, sy: 1, flip: false, facing: "down", cape: false, trophy: false };
  const m = reduced ? 0.4 : 1;
  switch (id) {
    case "knee-slide": {
      const p = ease.outCubic(clamp01(t / 1.4));
      if (t < 1.4 && Math.random() < 0.8) particles.emit("grass", at.x + p * 70 - 10, at.y, 2, { color: ["#2e7d32", "#4caf50", "#8bc34a"], speed: 50, angle: -Math.PI * 0.8, spread: 0.8, life: 0.6 });
      return { ...base, dx: p * 70, dy: 6, sy: 0.82, sx: 1.12, rotate: -0.12 * m, facing: "right" };
    }
    case "spin-point": {
      const spinning = t < 1;
      return { ...base, flip: spinning && Math.floor(t * 14) % 2 === 1, dy: -Math.sin(clamp01(t) * Math.PI) * 10 * m, facing: spinning ? "down" : "left", rotate: spinning ? 0 : -0.1 };
    }
    case "backflip": {
      const p = clamp01((t - 0.2) / 0.9);
      if (p > 0 && p < 1) particles.emit("sparkle", at.x, at.y - 40 - Math.sin(p * Math.PI) * 40, 2, { color: colors, speed: 10, life: 0.5, gravity: 0 });
      return { ...base, dy: -Math.sin(p * Math.PI) * 44 * m, rotate: reduced ? 0 : -p * Math.PI * 2, sy: t < 0.2 ? 0.8 : 1 };
    }
    case "badge-kiss": {
      if (t > 0.5 && t < 1.8 && Math.random() < 0.3) particles.emit("sparkle", at.x + (Math.random() - 0.5) * 30, at.y - 60, 1, { color: ["#ffd23f", "#ffffff", "#ff8fab"], speed: 20, life: 0.8, gravity: -10 });
      return { ...base, sy: 1 + Math.sin(t * 6) * 0.04, dy: -Math.abs(Math.sin(t * 3)) * 4 * m };
    }
    case "crowd-surf": {
      const p = ease.inOutCubic(clamp01(t / 1.6));
      return { ...base, dy: -p * 120 * m + Math.sin(t * 8) * 3, dx: Math.sin(t * 2) * 30 * p, rotate: -Math.PI / 2 * p * m, sx: 1 - p * 0.35, sy: 1 - p * 0.35 };
    }
    case "disco": {
      if (Math.random() < 0.3) particles.emit("sparkle", at.x + (Math.random() - 0.5) * 80, at.y - 80 - Math.random() * 40, 1, { color: ["#ff4fd8", "#ccff00", "#7fd3ff", "#ffd23f"], speed: 5, life: 0.6, gravity: 0 });
      const beat = Math.floor(t * 4) % 4;
      return { ...base, dx: [-8, 0, 8, 0][beat] * m, dy: beat % 2 ? -6 * m : 0, flip: beat === 2, rotate: [0.15, 0, -0.15, 0][beat] * m };
    }
    case "superhero": {
      const rise = ease.outBack(clamp01(t / 0.6));
      return { ...base, dy: -rise * 8 * m, sy: 1.08, cape: true };
    }
    case "trophy-lift": {
      if (t > 0.4 && Math.random() < 0.9) particles.emit("confetti", at.x + (Math.random() - 0.5) * 200, 0, 2, { color: colors, speed: 20, angle: Math.PI / 2, spread: 0.6, gravity: 40, life: 3 });
      return { ...base, dy: -Math.abs(Math.sin(t * 5)) * 6 * m, trophy: t > 0.3 };
    }
  }
}

/** Reactions to a miss / save / post (whole-sprite only). */
export function reactionBeat(kind: "miss" | "save" | "post", t: number, reduced: boolean): Beat {
  const base: Beat = { dx: 0, dy: 0, rotate: 0, sx: 1, sy: 1, flip: false, facing: "up", cape: false, trophy: false };
  const m = reduced ? 0.3 : 1;
  if (kind === "save") return { ...base, sy: 0.92, rotate: Math.sin(t * 18) * 0.05 * m, dy: 2 };
  if (kind === "post") return { ...base, dy: t < 0.3 ? -8 * m : 0, sx: t < 0.3 ? 0.9 : 1, facing: "down" };
  return { ...base, sy: 1 - clamp01(t) * 0.12, rotate: 0.1 * m, dy: 3 };
}

export function drawTrophy(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = "#b8860b"; c.fillRect(x - 6, y + 10, 12, 3);
  c.fillStyle = "#ffd23f"; c.fillRect(x - 5, y - 6, 10, 12); c.fillRect(x - 8, y - 5, 3, 5); c.fillRect(x + 5, y - 5, 3, 5); c.fillRect(x - 1, y + 6, 2, 4);
  c.fillStyle = "#fff2b3"; c.fillRect(x - 3, y - 4, 2, 6);
}
