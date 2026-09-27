/**
 * FD-3b: what a wait for randomness looks like on the Stage (the game and the dev Showroom draw the same
 * thing). Pure drawing from a WaitCue (game/suspense.ts): no outcome is known or hinted while waiting.
 *   PENALTY  the ball warms up on the spot (glow + spin), a suspense meter, "THE KEEPER IS DECIDING…".
 *   PACK     a sealed pack that shakes and glows more the longer the wait runs.
 */
import { W, H, clamp01 } from "./core.js";
import { drawBall, type RarityFx } from "./ball.js";
import type { WaitCue } from "../game/suspense.js";

const text = (c: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, size = 8, bold = false) => {
  c.font = `${bold ? "bold " : ""}${size}px PixelifySans, monospace`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = "#0b0d1a"; c.fillText(value, x + 1, y + 1); c.fillStyle = color; c.fillText(value, x, y);
  c.textAlign = "left"; c.textBaseline = "alphabetic";
};
const dots = (time: number) => ".".repeat(1 + (Math.floor(time * 3) % 3));

/** The glow under the waiting ball (drawn before the ball) and the ball's warm-up spin. */
export function drawBallWarmup(c: CanvasRenderingContext2D, x: number, y: number, r: number, cue: WaitCue, time: number, reduced: boolean) {
  if (!cue.visible) return 0;
  const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * (4 + cue.warm * 6)), radius = r + 4 + cue.warm * 10 + pulse * 2;
  const g = c.createRadialGradient(x, y, r * 0.5, x, y, radius);
  g.addColorStop(0, `rgba(255,210,63,${0.35 + 0.35 * cue.warm})`); g.addColorStop(1, "rgba(255,140,0,0)");
  c.fillStyle = g; c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
  return reduced ? 0 : time * (4 + cue.warm * 16); // spin for drawBall
}

/** Screen-space overlay for a penalty wait: the locked-in tag, the keeper-deciding copy and the meter. */
export function drawPenaltyWait(c: CanvasRenderingContext2D, cue: WaitCue, time: number, locked: { x: number; y: number } | null) {
  if (!cue.visible) return;
  if (locked) text(c, "LOCKED IN", locked.x, locked.y - 12, "#ccff00", 7);
  // In the sky between the commentary box and the stands (clear of the pot banner on phones, and of the ball).
  if (cue.deciding) text(c, `THE KEEPER IS DECIDING${dots(time)}`, W / 2, 86, cue.hush ? "#ff5a6e" : "#ffd23f", 10, true);
  drawMeter(c, cue, time, cue.deciding ? null : "THE KEEPER'S DECISION", 100);
}

/** The suspense meter: a bar that fills towards (never to) the end until the randomness lands. The label sits under it. */
export function drawMeter(c: CanvasRenderingContext2D, cue: WaitCue, time: number, label: string | null, y: number) {
  if (cue.meter === null) return;
  const w = 120, h = 6, x = Math.round(W / 2 - w / 2);
  if (cue.hush) label = "ANY MOMENT NOW";
  c.fillStyle = "#0b0d1acc"; c.fillRect(x - 2, y - 2, w + 4, h + 4);
  c.fillStyle = "#2a3160"; c.fillRect(x, y, w, h);
  const fill = Math.round(w * clamp01(cue.meter)), hot = cue.hush ? (Math.floor(time * 6) % 2 ? "#ff5a6e" : "#ffd23f") : "#ffd23f";
  c.fillStyle = hot; c.fillRect(x, y, fill, h);
  if (label) text(c, label, W / 2, y + h + 7, "#f7f7f2", 7);
}

/**
 * The sealed pack while its roll is on the way: it shakes harder and glows brighter as the wait goes on.
 * The pack art is the same whatever is inside (the contents are not known yet, and it never pretends).
 */
export function drawSealedPack(c: CanvasRenderingContext2D, cue: WaitCue, time: number, count: number, reduced: boolean, fx: RarityFx) {
  c.fillStyle = `rgba(0,0,0,${0.35 + 0.25 * cue.warm})`; c.fillRect(0, 0, W, H);
  const cx = W / 2, cy = 142, amp = reduced ? 0 : 0.6 + cue.warm * 3.4 + (cue.hush ? 1.5 : 0);
  const dx = Math.sin(time * 37) * amp, dy = Math.cos(time * 29) * amp * 0.5, tilt = reduced ? 0 : Math.sin(time * 23) * 0.02 * (1 + cue.warm * 3);
  // Glow rays behind the pack (brighter with the wait).
  if (!reduced) {
    c.save(); c.translate(cx, cy); c.rotate(time * 0.4);
    for (let i = 0; i < 10; i++) { c.rotate(Math.PI / 5); c.fillStyle = `rgba(255,210,63,${0.05 + 0.12 * cue.warm})`; c.beginPath(); c.moveTo(0, 0); c.lineTo(-10, -90 - cue.warm * 40); c.lineTo(10, -90 - cue.warm * 40); c.fill(); }
    c.restore();
  }
  const glow = c.createRadialGradient(cx, cy, 10, cx, cy, 60 + cue.warm * 30);
  glow.addColorStop(0, `rgba(255,210,63,${0.2 + 0.4 * cue.warm})`); glow.addColorStop(1, "rgba(255,210,63,0)");
  c.fillStyle = glow; c.fillRect(cx - 100, cy - 100, 200, 200);
  c.save(); c.translate(cx + dx, cy + dy); c.rotate(tilt);
  const w = 58, h = 78;
  c.fillStyle = "#ffd23f"; c.fillRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
  const foil = c.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); foil.addColorStop(0, "#2a3160"); foil.addColorStop(0.5, "#4b2a7a"); foil.addColorStop(1, "#151a33");
  c.fillStyle = foil; c.fillRect(-w / 2, -h / 2, w, h);
  // Crimped seals top and bottom.
  c.fillStyle = "#c9a227"; for (let i = 0; i < 7; i++) { c.fillRect(-w / 2 + i * 9, -h / 2, 5, 4); c.fillRect(-w / 2 + i * 9, h / 2 - 4, 5, 4); }
  // A moving sheen.
  if (!reduced) { const sx = ((time * 50) % (w + 30)) - w / 2 - 15; c.fillStyle = "rgba(255,255,255,0.18)"; c.beginPath(); c.moveTo(sx, -h / 2); c.lineTo(sx + 8, -h / 2); c.lineTo(sx - 8, h / 2); c.lineTo(sx - 16, h / 2); c.fill(); }
  drawBall(c, 0, -8, 9, fx, reduced ? 0 : time * (2 + cue.warm * 10));
  c.restore();
  text(c, "PENALTY KINGS", cx + dx, cy + h / 2 - 16 + dy, "#ffd23f", 7, true);
  text(c, `${count} BALL${count === 1 ? "" : "S"} · SEALED`, cx, cy + h / 2 + 12, "#f7f7f2", 8, true);
  text(c, `RANDOMNESS ON ITS WAY${dots(time)}`, cx, cy - h / 2 - 16, "#ffd23f", 8, true);
  drawMeter(c, cue, time, null, cy + h / 2 + 22);
}
