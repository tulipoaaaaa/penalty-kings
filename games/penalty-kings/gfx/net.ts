/**
 * Goal net as a small damped spring grid (screen space, 13 × 7 nodes on the back netting, edges pinned).
 * B1: a goal pushes the mesh open around the ball's crossing point (the ball "pocket", peak 6–10 px),
 * and the displacement ripples out through the neighbours and settles in 600–900 ms (research R2 #1).
 * Each node carries a 2D offset; a node is pulled back to rest and towards its neighbours' mean
 * (the ripple), with velocity damping.
 */
import { GOAL } from "./stadium.js";

const COLS = 13, ROWS = 7;
/** Spring constants (per second²) and damping (per second): tuned so a full-power goal peaks at ~8 px and settles by ~0.75 s. */
export const NET_TUNING = { rest: 380, couple: 260, damping: 6.4, radius: 44, kick: 290 } as const;
export class Net {
  private ox = new Float32Array(COLS * ROWS);
  private oy = new Float32Array(COLS * ROWS);
  private vx = new Float32Array(COLS * ROWS);
  private vy = new Float32Array(COLS * ROWS);
  private sx = new Float32Array(COLS * ROWS);
  private sy = new Float32Array(COLS * ROWS);
  color = "#e8e8e8";
  /**
   * A ball into the net at (screenX, screenY) in goal-art coordinates. `strength` 0–1.2 (1 = a firm goal):
   * nodes within the radius are kicked away from the ball (the pocket opens) and slightly down (the ball drops).
   */
  impulse(screenX: number, screenY: number, strength: number) {
    const s = Math.min(1.2, strength > 2 ? strength / 160 : strength) * NET_TUNING.kick; // legacy callers passed 160
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      const i = r * COLS + c, { x, y } = this.node(c, r), dx = x - screenX, dy = y - screenY, d = Math.hypot(dx, dy);
      const fall = Math.max(0, 1 - d / NET_TUNING.radius) ** 2;
      if (fall <= 0) continue;
      const ux = d > 0.5 ? dx / d : 0, uy = d > 0.5 ? dy / d : 1;
      this.vx[i] += ux * s * fall; this.vy[i] += (uy * 0.8 + 0.45) * s * fall;
    }
  }
  /** Largest node displacement now, px (tests and the Showroom read this). */
  get peak() { let m = 0; for (let i = 0; i < this.ox.length; i++) m = Math.max(m, Math.hypot(this.ox[i], this.oy[i])); return m; }
  update(dt: number) {
    if (dt <= 0) return;
    const { rest, couple, damping } = NET_TUNING, keep = Math.max(0, 1 - damping * dt);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) { this.sx[i] = this.sy[i] = 0; continue; }
      const mx = (this.ox[i - 1] + this.ox[i + 1] + this.ox[i - COLS] + this.ox[i + COLS]) / 4, my = (this.oy[i - 1] + this.oy[i + 1] + this.oy[i - COLS] + this.oy[i + COLS]) / 4;
      this.sx[i] = (mx - this.ox[i]) * couple - this.ox[i] * rest; this.sy[i] = (my - this.oy[i]) * couple - this.oy[i] * rest;
    }
    for (let i = 0; i < this.ox.length; i++) {
      this.vx[i] = (this.vx[i] + this.sx[i] * dt) * keep; this.vy[i] = (this.vy[i] + this.sy[i] * dt) * keep;
      this.ox[i] += this.vx[i] * dt; this.oy[i] += this.vy[i] * dt;
    }
  }
  private node(c: number, r: number) {
    const backLeft = GOAL.left + 12, backRight = GOAL.right - 12, top = GOAL.bar + 9, bottom = GOAL.line - 7;
    return { x: backLeft + ((backRight - backLeft) * c) / (COLS - 1), y: top + ((bottom - top) * r) / (ROWS - 1) };
  }
  draw(c: CanvasRenderingContext2D) {
    const { left, right, bar, line } = GOAL, backLeft = left + 12, backRight = right - 12, backTop = bar + 9, backLine = line - 7;
    c.fillStyle = "#00000026"; c.fillRect(left, bar, right - left, line - bar);
    // The mesh brightens while it bulges, so the pocket reads against a busy crowd.
    c.strokeStyle = this.color; c.globalAlpha = 0.6 + 0.35 * Math.min(1, this.peak / 5); c.lineWidth = 1;
    const px = (col: number, row: number) => this.node(col, row).x + this.ox[row * COLS + col], py = (col: number, row: number) => this.node(col, row).y + this.oy[row * COLS + col];
    for (let row = 0; row < ROWS; row++) { c.beginPath(); for (let col = 0; col < COLS; col++) col ? c.lineTo(px(col, row), py(col, row)) : c.moveTo(px(col, row), py(col, row)); c.stroke(); }
    for (let col = 0; col < COLS; col++) { c.beginPath(); for (let row = 0; row < ROWS; row++) row ? c.lineTo(px(col, row), py(col, row)) : c.moveTo(px(col, row), py(col, row)); c.stroke(); }
    c.beginPath();
    c.moveTo(left, bar); c.lineTo(backLeft, backTop); c.moveTo(right, bar); c.lineTo(backRight, backTop);
    c.moveTo(left, line); c.lineTo(backLeft, backLine); c.moveTo(right, line); c.lineTo(backRight, backLine);
    c.stroke(); c.globalAlpha = 1;
  }
}
