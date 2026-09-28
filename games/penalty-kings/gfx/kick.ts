/**
 * The taker's run-up and strike, in world metres through the view's camera (pure: no canvas).
 *
 * The Friend is scaled by perspective at its own depth: it is FRIEND_HEIGHT_M tall (1.2 × the
 * keepers' mean height in metres, read from their art in the goal group), so it is consistent with
 * the keepers in both the penalty and the free-kick camera. It runs in on a slight angle from
 * behind-left and plants BESIDE the ball on the non-kicking (left) side; at the contact frame the
 * kick-leg overlay's foot is at the ball. The canonical sprite is never edited: only its position
 * and scale come from here, and the leg + contact flash are overlays drawn on top.
 */
import { GOAL_HEIGHT, type FreeKickSetup } from "@penalty-kings/engine";
import { GOAL, CAM_FX, CAM_FY, type PitchCamera } from "./stadium.js";
import { fkProject, FK_CAMERA, PENALTY_SETUP, PENALTY_CAMERA } from "./setpieces.js";
import { KEEPER_DESIGNS } from "./keepers.js";

/** Seconds from release to the strike (the run-up). Round 6 B3: ≤ 0.4 s. */
export const STRIKE_AT = 0.4;
/** The run-up arrives at the plant this long before the strike (the leg swings in that time). */
export const PLANT_BEFORE = 0.12;
/** The canonical Friend mask is 16 × 16; its drawn height is 16 × scale. */
export const FRIEND_CELL = 16;

/** Goal-art px per metre, vertically (the bar→line art height is the real 2.44 m). */
const ART_PX_PER_M = (GOAL.line - GOAL.bar) / GOAL_HEIGHT;
/** A keeper's standing height in metres, from its art (rows × scale in the goal group). */
export const keeperArtHeight = (id: keyof typeof KEEPER_DESIGNS) => KEEPER_DESIGNS[id].rows.length * KEEPER_DESIGNS[id].scale;
export const keeperHeightM = (id: keyof typeof KEEPER_DESIGNS) => keeperArtHeight(id) / ART_PX_PER_M;
const KEEPER_IDS = Object.keys(KEEPER_DESIGNS) as Array<keyof typeof KEEPER_DESIGNS>;
/** The keepers' mean height (≈ 1.28 m: they are cartoon animals). */
export const KEEPER_HEIGHT_M = KEEPER_IDS.reduce((sum, id) => sum + keeperHeightM(id), 0) / KEEPER_IDS.length;
/** A Friend stands 1.2 × a keeper (≈ 1.54 m). */
export const FRIEND_HEIGHT_M = 1.2 * KEEPER_HEIGHT_M;
/** Vertical screen px per metre at a depth whose horizontal px/m is `pxPerM` (the camera's FY/FX). */
export const vPxPerM = (pxPerM: number) => (pxPerM * CAM_FY) / CAM_FX;
/** The Friend's whole-sprite scale at a depth (horizontal px/m `pxPerM`). */
export const friendScale = (pxPerM: number) => (FRIEND_HEIGHT_M * vPxPerM(pxPerM)) / FRIEND_CELL;

export type KickView = { setup: FreeKickSetup; camera: PitchCamera; ball: { x: number; y: number; r: number }; runup: { back: number; side: number }; plantBack: number };
/** Penalty: ball on the spot (drawn centred on the spot line), a 3 m run-up from behind-left. */
export const PENALTY_VIEW: KickView = { setup: PENALTY_SETUP, camera: PENALTY_CAMERA, ball: { x: 240, y: Math.round(fkProject(PENALTY_SETUP, { x: 0, y: 0, z: 0 }, PENALTY_CAMERA).y), r: 4.5 }, runup: { back: 3, side: 1.3 }, plantBack: 0.25 };
/** Free kick: the camera is 14 m behind the ball, so the run-up is short to stay in frame. */
export function freeKickView(setup: FreeKickSetup): KickView {
  const at = fkProject(setup, { x: Math.sin(setup.angle) * setup.distance, y: 0.11, z: 0 });
  return { setup, camera: FK_CAMERA, ball: { x: at.x, y: at.y, r: Math.max(2, 0.11 * at.pxPerM) }, runup: { back: 1.0, side: 0.6 }, plantBack: 0.25 };
}

/** A pitch point `forward` metres towards goal and `right` metres to the camera's right of the ball. */
function world(setup: FreeKickSetup, forward: number, right: number) {
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance, d = setup.distance;
  const ux = -x0 / d, uz = depth / d, nx = depth / d, nz = x0 / d;
  return { x: x0 + forward * ux + right * nx, y: 0, z: forward * uz + right * nz };
}
/** Screen point + sprite scale for the Friend's feet at (forward, right) metres from the ball. */
function place(view: KickView, forward: number, right: number) {
  const p = fkProject(view.setup, world(view.setup, forward, right), view.camera);
  return { x: p.x, y: p.y, pxPerM: p.pxPerM, scale: friendScale(p.pxPerM), forward, right };
}

/** Where the Friend plants: slightly behind the ball, its sprite (with halo) just left of the ball. */
export function plantSpot(view: KickView) {
  const depth = place(view, -view.plantBack, 0), gap = view.ball.r + 9 * depth.scale;
  return place(view, -view.plantBack, (view.ball.x - gap - depth.x) / depth.pxPerM); // the ball is on the camera's centre line
}
/** The run-up start (and the aim-view stance): behind and to the left of the plant, a slight angle. */
export function runupStart(view: KickView) {
  const plant = plantSpot(view);
  return place(view, plant.forward - view.runup.back, plant.right - view.runup.side);
}
/** Where the leg overlay attaches: the Friend's right hip (sprite-local px, feet at 0). */
export const HIP = { x: 4.5, y: -3.5 };

export type LegFrame = "back" | "swing" | "contact" | "through";
export type KickPose = {
  x: number; y: number; scale: number; walking: boolean;
  /** Horizontal screen px per metre at the Friend's depth (the scale is derived from it). */
  pxPerM: number;
  /** Body squash/lean while striking (whole-sprite transforms). */
  sx: number; sy: number; rotate: number;
  /** The kick-leg overlay (screen px): hip → foot, and which pixel frame. */
  leg: { frame: LegFrame; hip: { x: number; y: number }; foot: { x: number; y: number } } | null;
  /** 0..1 contact flash at the ball. */
  flash: number;
};

/** The leg's pixel frame at `t` seconds after release (null: no overlay). */
export function legFrame(t: number): LegFrame | null {
  const k = t - STRIKE_AT;
  if (k < -PLANT_BEFORE || k >= 0.2) return null;
  if (k < -0.06) return "back";
  if (k < -0.025) return "swing";
  if (k < 0.06) return "contact";
  return "through";
}

/** The Friend's run-up / strike pose `t` seconds after release (t ≤ 0: the aim-view stance; long after: planted). */
export function kickPose(view: KickView, t: number): KickPose {
  const start = runupStart(view), plant = plantSpot(view);
  const p = Math.min(1, Math.max(0, t / (STRIKE_AT - PLANT_BEFORE))), e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
  // A straight line on the pitch (a slight angle), projected each frame: the scale follows the depth.
  const at = t <= 0 ? start : p >= 1 ? plant : place(view, start.forward + (plant.forward - start.forward) * e, start.right + (plant.right - start.right) * e);
  const pose: KickPose = { x: at.x, y: at.y, scale: at.scale, pxPerM: at.pxPerM, walking: t > 0 && p < 1, sx: 1, sy: 1, rotate: 0, leg: null, flash: 0 };
  if (pose.walking) { const step = (t * 6) % 1; pose.sy = 1 - Math.abs(Math.sin(step * Math.PI)) * 0.08; pose.sx = 2 - pose.sy; }
  const frame = legFrame(t);
  if (frame) {
    const s = pose.scale, hip = { x: at.x + HIP.x * s, y: at.y + HIP.y * s }, contact = contactPoint(view);
    const back = { x: hip.x + 0.8 * s, y: hip.y + 3 * s }, through = { x: view.ball.x + 1.5 * s, y: view.ball.y - 3 * s };
    const foot = frame === "back" ? back : frame === "swing" ? { x: back.x + (contact.x - back.x) * 0.6, y: back.y + (contact.y - back.y) * 0.6 } : frame === "contact" ? contact : through;
    pose.leg = { frame, hip, foot };
    if (frame === "contact" || frame === "through") { pose.sx = 1.05; pose.sy = 0.95; pose.rotate = -0.05; }
  }
  const k = t - STRIKE_AT;
  pose.flash = k >= 0 && k < 0.12 ? 1 - k / 0.12 : 0;
  return pose;
}
/** The foot's point at contact: on the back-left of the ball. */
export const contactPoint = (view: KickView) => ({ x: view.ball.x - 2, y: view.ball.y + 1 });

// ── B11: the Friend eases aside while the ball is in flight ─────────────────────────────
// Drawn big in the foreground, the planted Friend hides the left third of the goal while the ball flies, so the
// arrival and the keeper's save on that side are lost. After the contact frame (the leg is into its follow-through)
// the whole Friend layer fades to FRIEND_FLIGHT_ALPHA and eases a few whole pixels aside (left, and a touch down,
// away from the goal); it holds there through the crossing and the payoff (net ripple, keeper reaction) until
// FRIEND_HOLD_AFTER s after it, then eases back: full opacity and its exact planted position FRIEND_RESTORE_AFTER s
// after the crossing, before the goal celebration (+1.0 s). The miss/save/post reaction beat keeps its +0.1 s start
// and plays under the fade. Layering only: the canonical sprite is never redrawn or recoloured; kickPose and its
// timing are untouched.
/** Seconds after contact the fade starts: the end of the "contact" leg frame (legFrame), never before it. */
export const FRIEND_ASIDE_FROM = 0.06;
/** Seconds the ease aside takes. */
export const FRIEND_ASIDE_EASE = 0.12;
/** Seconds after the crossing the Friend stays faded and aside (the DOM result banner is up by then). */
export const FRIEND_HOLD_AFTER = 0.4;
/** Seconds the ease back takes. */
export const FRIEND_RESTORE_EASE = 0.25;
/** Seconds after the crossing by which the Friend is fully restored (the goal celebration starts at +1.0 s). */
export const FRIEND_RESTORE_AFTER = FRIEND_HOLD_AFTER + FRIEND_RESTORE_EASE;
/** The Friend's opacity while the ball is in flight. */
export const FRIEND_FLIGHT_ALPHA = 0.45;
/** How far it eases aside, in sprite cells (× the sprite scale → screen px): left, and slightly down. */
export const FRIEND_ASIDE_CELLS = { x: -3, y: 1 } as const;
export type FriendAside = { alpha: number; dx: number; dy: number };

/**
 * The Friend's flight alpha and whole-pixel offset `since` s after contact (negative: before the strike), for a
 * flight of `flight` s and a sprite `scale`. Reduced motion: no movement, an instant alpha step for the flight.
 */
export function friendAside(since: number, flight: number, scale: number, reduced = false): FriendAside {
  const restoreEnd = flight + FRIEND_RESTORE_AFTER;
  const rest: FriendAside = { alpha: 1, dx: 0, dy: 0 };
  if (!(since >= FRIEND_ASIDE_FROM) || since >= restoreEnd) return rest;
  if (reduced) return { alpha: FRIEND_FLIGHT_ALPHA, dx: 0, dy: 0 };
  // Out: ease-out from the follow-through; back: ease-in-out over FRIEND_RESTORE_EASE s from FRIEND_HOLD_AFTER s
  // after the crossing (so the ball's arrival and the payoff are always seen with the Friend aside).
  const back = Math.max(flight + FRIEND_HOLD_AFTER, FRIEND_ASIDE_FROM);
  let k: number;
  if (since < back) { const p = Math.min(1, (since - FRIEND_ASIDE_FROM) / FRIEND_ASIDE_EASE); k = 1 - (1 - p) ** 3; }
  else { const p = Math.min(1, (since - back) / (restoreEnd - back)); k = 1 - (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2); }
  const peak = Math.min(1, (back - FRIEND_ASIDE_FROM) / FRIEND_ASIDE_EASE); // a (very) short flight never fully eases out
  k = Math.min(k, 1 - (1 - peak) ** 3);
  return { alpha: 1 - (1 - FRIEND_FLIGHT_ALPHA) * k, dx: Math.round(k * FRIEND_ASIDE_CELLS.x * scale) || 0, dy: Math.round(k * FRIEND_ASIDE_CELLS.y * scale) || 0 };
}
