/**
 * Canvas renderer for the pitch. Logical resolution 480 × 320 (3:2), scaled up
 * with nearest-neighbour. The Friend's canonical 16 × 16 mask is drawn exactly
 * (black pixels, one-pixel halo); animations move, flip or rotate the whole
 * sprite and never edit its pixels.
 */
import { flightAt, keeperAt, type KeeperId, type KeeperPlan, type ShotResult } from "@penalty-kings/engine";
import { BALL_ROWS } from "./art.js";
import { drawKeeper as drawKeeperSprite, keeperArms } from "./gfx/keepers.js";

export const W = 480, H = 320;
export const GOAL = { left: 150, right: 330, bar: 78, line: 168, unit: 90, cx: 240 } as const;
export const SPOT = { x: 240, y: 246 } as const;

export const toScreen = (gx: number, gy: number) => ({ x: GOAL.cx + gx * GOAL.unit, y: GOAL.line - gy * GOAL.unit });

export type FriendPose = Readonly<{
  rows: readonly string[] | null;
  x: number; y: number; scale: number;
  flip?: boolean; rotate?: number; squash?: number;
  halo: string; boots: string;
}>;

export type SceneState = {
  time: number;
  keeper: KeeperId;
  keeperPose: { x: number; y: number; rotate: number; lift: number };
  ball: { x: number; y: number; r: number; color: string; accent: string; visible: boolean; spin: number };
  trail: { x: number; y: number }[];
  friend: FriendPose;
  netColor: string;
  ripple: { x: number; y: number; t: number } | null;
  shake: number;
  roar: number;
  reticle: { x: number; y: number; power: number; curl: number; aimX: number; active: boolean } | null;
  flash: string | null;
};

const crowdPalette = ["#e63946", "#f1faee", "#a8dadc", "#457b9d", "#ffd23f", "#ccff00", "#ff8fab", "#9b5de5", "#1d3557", "#f4a261"];
const crowdSeats: { x: number; y: number; c: string; phase: number }[] = [];
for (let row = 0; row < 7; row++) {
  for (let col = 0; col < 80; col++) {
    const hash = Math.imul(row * 131 + col * 7919, 2654435761) >>> 0;
    crowdSeats.push({ x: col * 6 + (row % 2) * 3, y: 8 + row * 7, c: crowdPalette[hash % crowdPalette.length], phase: (hash >>> 8) % 628 / 100 });
  }
}

export function drawMask(context: CanvasRenderingContext2D, rows: readonly string[], left: number, top: number, scale: number, fill: string, halo: string | null, accent?: string) {
  if (halo) {
    context.fillStyle = halo;
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== ".") context.fillRect(left + x * scale - scale, top + y * scale - scale, scale * 3, scale * 3); });
  }
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const pixel = row[x];
      if (pixel === ".") continue;
      context.fillStyle = pixel === "o" && accent ? accent : fill;
      context.fillRect(left + x * scale, top + y * scale, scale, scale);
    }
  });
}

function drawStands(context: CanvasRenderingContext2D, state: SceneState) {
  context.fillStyle = "#1b1f3a"; context.fillRect(0, 0, W, 62);
  for (const seat of crowdSeats) {
    const bounce = state.roar > 0 ? Math.round(Math.sin(state.time * 18 + seat.phase) * 1.5 * state.roar) : 0;
    context.fillStyle = seat.c; context.fillRect(seat.x, seat.y + bounce, 3, 3);
    context.fillStyle = "#00000055"; context.fillRect(seat.x, seat.y + 3 + bounce, 3, 2);
  }
  // Advertising boards (original text only).
  context.fillStyle = "#0b0d1a"; context.fillRect(0, 60, W, 14);
  const boards = ["PENALTY KINGS", "$GBOOT", "GOLDEN BOOT CUP", "RARE FRIENDS"];
  context.font = "bold 8px monospace"; context.textBaseline = "middle";
  const offset = (state.time * 20) % 120;
  for (let i = -1; i < 6; i++) {
    const x = i * 120 - offset;
    context.fillStyle = i % 2 ? "#ccff00" : "#ffd23f"; context.fillRect(x + 2, 62, 116, 10);
    context.fillStyle = "#0b0d1a"; context.fillText(boards[(i + 8) % boards.length], x + 8, 67.5);
  }
}

function drawPitch(context: CanvasRenderingContext2D) {
  let y = 74, band = 0;
  while (y < H) {
    const h = 6 + (y - 74) * 0.12;
    context.fillStyle = band % 2 ? "#2f8f3a" : "#35a042"; context.fillRect(0, y, W, Math.ceil(h));
    y += h; band++;
  }
  context.strokeStyle = "#e9f5e1"; context.lineWidth = 1;
  const line = (x1: number, y1: number, x2: number, y2: number) => { context.beginPath(); context.moveTo(x1 + 0.5, y1 + 0.5); context.lineTo(x2 + 0.5, y2 + 0.5); context.stroke(); };
  line(0, GOAL.line, W, GOAL.line);
  line(118, GOAL.line, 104, 196); line(362, GOAL.line, 376, 196); line(104, 196, 376, 196);
  line(40, GOAL.line, -10, 236); line(440, GOAL.line, 490, 236); line(-10, 236, 490, 236);
  context.fillStyle = "#e9f5e1"; context.fillRect(SPOT.x - 2, SPOT.y + 3, 5, 2);
  // D arc.
  context.beginPath(); context.ellipse(240, 236, 50, 12, 0, 0, Math.PI); context.stroke();
}

function drawGoal(context: CanvasRenderingContext2D, state: SceneState, front: boolean) {
  const { left, right, bar, line } = GOAL;
  if (!front) {
    // Net: back frame + mesh, with a ripple around the impact point.
    const backTop = bar + 10, backLeft = left + 12, backRight = right - 12, backLine = line - 8;
    context.fillStyle = "#00000022"; context.fillRect(left, bar, right - left, line - bar);
    context.strokeStyle = state.netColor; context.globalAlpha = 0.55; context.lineWidth = 1;
    const ripple = (x: number, y: number) => {
      if (!state.ripple) return 0;
      const d = Math.hypot(x - state.ripple.x, y - state.ripple.y), t = state.ripple.t;
      return Math.max(0, 1 - d / 60) * Math.sin(d * 0.35 - t * 25) * 5 * Math.max(0, 1 - t / 1.2);
    };
    for (let x = backLeft; x <= backRight; x += 6) {
      context.beginPath();
      for (let y = backTop; y <= backLine; y += 3) { const dy = ripple(x, y); y === backTop ? context.moveTo(x + 0.5, y + dy) : context.lineTo(x + 0.5 + dy * 0.3, y + dy); }
      context.stroke();
    }
    for (let y = backTop; y <= backLine; y += 6) {
      context.beginPath();
      for (let x = backLeft; x <= backRight; x += 3) { const dy = ripple(x, y); x === backLeft ? context.moveTo(x, y + 0.5 + dy) : context.lineTo(x, y + 0.5 + dy); }
      context.stroke();
    }
    context.beginPath(); context.moveTo(left, bar); context.lineTo(backLeft, backTop); context.moveTo(right, bar); context.lineTo(backRight, backTop);
    context.moveTo(left, line); context.lineTo(backLeft, backLine); context.moveTo(right, line); context.lineTo(backRight, backLine);
    context.moveTo(backLeft, backTop); context.lineTo(backRight, backTop); context.stroke();
    context.globalAlpha = 1;
    return;
  }
  context.fillStyle = "#ffffff";
  context.fillRect(left - 3, bar - 3, 3, line - bar + 3);
  context.fillRect(right, bar - 3, 3, line - bar + 3);
  context.fillRect(left - 3, bar - 3, right - left + 6, 3);
  context.fillStyle = "#c9ced6"; context.fillRect(left - 1, bar, 1, line - bar); context.fillRect(right + 2, bar, 1, line - bar);
}

function drawKeeper(context: CanvasRenderingContext2D, state: SceneState) {
  const pose = state.keeperPose;
  const { x, y } = toScreen(pose.x, pose.y);
  const diving = Math.abs(pose.rotate) > 0.05;
  const [armL, armR] = keeperArms(state.keeper, diving ? "dive" : "idle", state.time, pose.x, pose.y);
  drawKeeperSprite(context, state.keeper, { x, y: Math.min(GOAL.line, y + 24) - pose.lift, rotate: pose.rotate, stretch: 1, armL, armR, alpha: state.keeper === "ghost" ? 0.85 : 1, scaleMul: 1, mood: diving ? "dive" : "idle" }, state.time);
}

function drawFriend(context: CanvasRenderingContext2D, pose: FriendPose) {
  const { rows, scale } = pose;
  context.save();
  context.fillStyle = "#00000044"; context.beginPath(); context.ellipse(pose.x, pose.y + 1, 7 * scale, 2 * scale, 0, 0, Math.PI * 2); context.fill();
  context.translate(Math.round(pose.x), Math.round(pose.y));
  if (pose.rotate) { context.translate(0, -8 * scale); context.rotate(pose.rotate); context.translate(0, 8 * scale); }
  if (pose.squash) context.scale(1 + pose.squash * 0.5, 1 - pose.squash);
  if (pose.flip) context.scale(-1, 1);
  if (!rows) {
    context.fillStyle = "#fff"; context.strokeStyle = "#111";
    context.beginPath(); context.arc(0, -8 * scale, 5 * scale, 0, Math.PI * 2); context.fill(); context.stroke();
  } else {
    drawMask(context, rows, -8 * scale, -15 * scale, scale, "#000000", pose.halo);
    // Boots: drawn beneath the lowest row of the mask; the mask itself is untouched.
    const lowest = rows.reduce((found, row, index) => row.includes("#") ? index : found, -1);
    if (lowest >= 0) {
      const row = rows[lowest], first = row.indexOf("#"), last = row.lastIndexOf("#");
      context.fillStyle = pose.boots;
      const top = -15 * scale + (lowest + 1) * scale;
      context.fillRect(-8 * scale + first * scale - scale, top, scale * 2, scale);
      context.fillRect(-8 * scale + last * scale, top, scale * 2, scale);
    }
  }
  context.restore();
}

export function drawBall(context: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, accent: string, spin = 0) {
  const scale = Math.max(1, Math.round((r * 2) / 9 * 2) / 2);
  const size = 9 * scale, left = Math.round(x - size / 2), top = Math.round(y - size / 2);
  context.save();
  if (spin) { context.translate(x, y); context.rotate(spin); context.translate(-x, -y); }
  BALL_ROWS.forEach((row, py) => {
    for (let px = 0; px < row.length; px++) {
      const pixel = row[px];
      if (pixel === ".") continue;
      context.fillStyle = pixel === "#" ? "#1a1a1a" : pixel === "o" ? accent : color;
      context.fillRect(left + px * scale, top + py * scale, scale, scale);
    }
    // fill interior with base colour
    const first = row.indexOf("#"), last = row.lastIndexOf("#");
    context.fillStyle = color;
    for (let px = first + 1; px < last; px++) if (row[px] === ".") context.fillRect(left + px * scale, top + py * scale, scale, scale);
  });
  context.restore();
}

function drawReticle(context: CanvasRenderingContext2D, state: SceneState) {
  const reticle = state.reticle;
  if (!reticle) return;
  const { x, y } = toScreen(reticle.x, reticle.y);
  const color = reticle.y > 1 || Math.abs(reticle.x) > 1 ? "#ff5a6e" : "#ccff00";
  // Curl preview.
  context.strokeStyle = "#ffffff66"; context.setLineDash([2, 3]); context.beginPath();
  for (let i = 0; i <= 16; i++) {
    const p = i / 16, f = flightAt({ x: reticle.x, y: reticle.y }, reticle.curl, p);
    const px = SPOT.x + (GOAL.cx + f.x * GOAL.unit - SPOT.x) * p + (f.x - reticle.x * p) * GOAL.unit * (1 - p) * 0;
    const py = SPOT.y + (GOAL.line - f.y * GOAL.unit - SPOT.y) * p;
    i ? context.lineTo(px, py) : context.moveTo(px, py);
  }
  context.stroke(); context.setLineDash([]);
  context.strokeStyle = color; context.lineWidth = 1;
  context.strokeRect(Math.round(x) - 5.5, Math.round(y) - 5.5, 11, 11);
  context.fillStyle = color; context.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
  context.fillRect(Math.round(x) - 9, Math.round(y), 3, 1); context.fillRect(Math.round(x) + 6, Math.round(y), 3, 1);
  context.fillRect(Math.round(x), Math.round(y) - 9, 1, 3); context.fillRect(Math.round(x), Math.round(y) + 6, 1, 3);
  // Power meter by the ball.
  if (reticle.active) {
    const mx = SPOT.x + 26, my = SPOT.y - 36, h = 44;
    context.fillStyle = "#0b0d1acc"; context.fillRect(mx - 1, my - 1, 8, h + 2);
    const zone = (from: number, to: number, c: string) => { context.fillStyle = c; context.fillRect(mx, my + h * (1 - to), 6, h * (to - from)); };
    zone(0, 0.6, "#2f8f3a55"); zone(0.6, 0.9, "#ccff0055"); zone(0.9, 1, "#ff5a6e66");
    context.fillStyle = reticle.power > 0.9 ? "#ff5a6e" : "#ccff00";
    context.fillRect(mx, my + h * (1 - reticle.power), 6, h * reticle.power);
  }
}

export function renderScene(context: CanvasRenderingContext2D, state: SceneState) {
  context.save();
  context.imageSmoothingEnabled = false;
  if (state.shake > 0) context.translate(Math.round((Math.random() - 0.5) * state.shake * 6), Math.round((Math.random() - 0.5) * state.shake * 6));
  context.fillStyle = "#0b0d1a"; context.fillRect(-8, -8, W + 16, H + 16);
  drawStands(context, state);
  drawPitch(context);
  drawGoal(context, state, false);
  const ballBehindKeeper = state.ball.visible && state.ball.y < GOAL.line - 2 && state.ball.r < 3.2;
  if (ballBehindKeeper) drawBallWithTrail(context, state);
  drawKeeper(context, state);
  drawGoal(context, state, true);
  drawReticle(context, state);
  // Striker in front when near the spot, behind the ball otherwise.
  const friendFirst = state.friend.y < state.ball.y || ballBehindKeeper;
  if (friendFirst) drawFriend(context, state.friend);
  if (!ballBehindKeeper && state.ball.visible) drawBallWithTrail(context, state);
  if (!friendFirst) drawFriend(context, state.friend);
  if (state.flash) { context.fillStyle = state.flash; context.fillRect(0, 0, W, H); }
  context.restore();
}

function drawBallWithTrail(context: CanvasRenderingContext2D, state: SceneState) {
  state.trail.forEach((point, index) => {
    context.fillStyle = `rgba(255,255,255,${(index / state.trail.length) * 0.35})`;
    context.fillRect(Math.round(point.x) - 1, Math.round(point.y) - 1, 2, 2);
  });
  context.fillStyle = "#00000040";
  const shadowY = Math.max(state.ball.y + state.ball.r, Math.min(SPOT.y + 5, state.ball.y + 30));
  context.beginPath(); context.ellipse(state.ball.x, Math.min(shadowY, H), state.ball.r, state.ball.r * 0.35, 0, 0, Math.PI * 2); context.fill();
  drawBall(context, state.ball.x, state.ball.y, state.ball.r, state.ball.color, state.ball.accent, state.ball.spin);
}

/** Ball screen position along its flight (p in 0 … 1). */
export function ballFlightScreen(target: { x: number; y: number }, curl: number, p: number) {
  const f = flightAt(target, curl, p);
  const end = toScreen(target.x, target.y);
  const bow = (f.x - target.x * p) * GOAL.unit;
  return {
    x: SPOT.x + (end.x - SPOT.x) * p + bow,
    y: SPOT.y + (end.y - SPOT.y) * p - Math.sin(Math.PI * p) * 10,
    r: 4.5 - 2 * p,
  };
}

/** Keeper pose from the plan at simulated time t. */
export function keeperPose(plan: KeeperPlan | null, t: number, idle: number) {
  if (!plan) return { x: Math.sin(idle * 2.2) * 0.12, y: 0.2, rotate: 0, lift: Math.abs(Math.sin(idle * 4.4)) * 2 };
  const hands = keeperAt(plan, t);
  const lean = Math.atan2(hands.x, 0.9) * hands.progress * 1.4;
  return { x: hands.x * 0.85, y: 0.2 + Math.max(0, hands.y - 0.45) * 0.8 * hands.progress, rotate: lean, lift: 0 };
}

export type { ShotResult };
