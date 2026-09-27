/**
 * Goal net as a damped spring mesh (screen space). A goal injects an impulse that bulges and
 * ripples outwards; thread "snaps" spawn particles. Cheap: 13 × 7 nodes.
 */
import { GOAL } from "./stadium.js";

const COLS = 13, ROWS = 7;
export class Net {
  private offset = new Float32Array(COLS * ROWS);
  private velocity = new Float32Array(COLS * ROWS);
  color = "#e8e8e8";
  impulse(screenX: number, screenY: number, strength: number) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const { x, y } = this.node(c, r), d = Math.hypot(x - screenX, y - screenY);
      this.velocity[r * COLS + c] += Math.max(0, 1 - d / 55) * strength;
    }
  }
  update(dt: number) {
    const k = 90, damping = 5;
    for (let i = 0; i < this.offset.length; i++) {
      const c = i % COLS, r = Math.floor(i / COLS);
      const neighbours = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]].filter(([x, y]) => x >= 0 && y >= 0 && x < COLS && y < ROWS);
      const pull = neighbours.reduce((sum, [x, y]) => sum + this.offset[y * COLS + x], 0) / neighbours.length;
      const edge = c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;
      const force = edge ? -this.offset[i] * k * 2 : (pull - this.offset[i]) * k * 0.6 - this.offset[i] * k * 0.4;
      this.velocity[i] += force * dt; this.velocity[i] *= 1 - damping * dt; this.offset[i] += this.velocity[i] * dt;
    }
  }
  private node(c: number, r: number) {
    const backLeft = GOAL.left + 12, backRight = GOAL.right - 12, top = GOAL.bar + 9, bottom = GOAL.line - 7;
    return { x: backLeft + ((backRight - backLeft) * c) / (COLS - 1), y: top + ((bottom - top) * r) / (ROWS - 1) };
  }
  draw(c: CanvasRenderingContext2D) {
    const { left, right, bar, line } = GOAL, backLeft = left + 12, backRight = right - 12, backTop = bar + 9, backLine = line - 7;
    c.fillStyle = "#00000026"; c.fillRect(left, bar, right - left, line - bar);
    c.strokeStyle = this.color; c.globalAlpha = 0.6; c.lineWidth = 1;
    const at = (col: number, row: number) => { const n = this.node(col, row), o = this.offset[row * COLS + col]; return { x: n.x + o * 0.25, y: n.y + o }; };
    for (let row = 0; row < ROWS; row++) { c.beginPath(); for (let col = 0; col < COLS; col++) { const p = at(col, row); col ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); } c.stroke(); }
    for (let col = 0; col < COLS; col++) { c.beginPath(); for (let row = 0; row < ROWS; row++) { const p = at(col, row); row ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); } c.stroke(); }
    c.beginPath();
    c.moveTo(left, bar); c.lineTo(backLeft, backTop); c.moveTo(right, bar); c.lineTo(backRight, backTop);
    c.moveTo(left, line); c.lineTo(backLeft, backLine); c.moveTo(right, line); c.lineTo(backRight, backLine);
    c.stroke(); c.globalAlpha = 1;
  }
}
