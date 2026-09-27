/**
 * One gesture for every mode. The swipe's direction (across) and upward travel in CSS px (height,
 * capped under the bar) are the aim, the same on every display (WYSIWYG: the reticle shows the
 * landing point live), swipe speed in CSS px/s is pace (calibrated per input), a deliberate bend is
 * curl. Free kicks add a flick-at-the-end topspin and SOLVE the lift so an unspun, windless shot
 * crosses at the aimed height. Keyboard and mouse produce the same inputs.
 */
import { swipeToShot, solveLift, clamp, kickSeed, RELEASE_BUFFER_MS, type KeeperId, type SwipePoint, type SwipeOptions, type ShotInput, type FreeKickShot, type FreeKickSetup } from "@penalty-kings/engine";

export function swipeToFreeKick(points: readonly SwipePoint[], options: SwipeOptions, setup: FreeKickSetup): FreeKickShot | null {
  const base = swipeToShot(points, options);
  if (!base) return null;
  const first = points[0], last = points[points.length - 1];
  const recent = points.filter(point => last.t - point.t <= RELEASE_BUFFER_MS);
  const from = recent.length >= 2 ? recent[0] : points[points.length - 2];
  const releaseSpeed = (from.y - last.y) / Math.max(1, last.t - from.t), averageSpeed = (first.y - last.y) / Math.max(1, last.t - first.t);
  const top = clamp((releaseSpeed / Math.max(0.01, averageSpeed) - 1.1) * 1.2, 0, 1);
  const aimX = clamp(base.aimX, -1.3, 1.3), aimY = clamp(base.aimY, 0, 1.4);
  return { aimX, lift: solveLift(setup, { aimX, aimY, power: base.power, top }), power: base.power, spin: base.curl, top };
}

/** Keyboard aim state → the same shot types (arrows aim across and up, A/D curl, W/S topspin, Space pace). */
export type KeyAim = { aimX: number; aimY: number; curl: number; top: number; power: number };
export const keyShot = (aim: KeyAim): ShotInput => ({ aimX: aim.aimX, aimY: aim.aimY, power: aim.power, curl: aim.curl });
export function keyFreeKick(aim: KeyAim, setup: FreeKickSetup): FreeKickShot {
  const aimX = clamp(aim.aimX, -1.3, 1.3);
  return { aimX, lift: solveLift(setup, { aimX, aimY: aim.aimY, power: aim.power, top: aim.top }), power: aim.power, spin: aim.curl, top: aim.top };
}

/**
 * The setup a free kick is actually struck with: the session's setup with this kick's seed. The trajectory
 * preview and the strike both use it, so the knuckleball wobble the preview draws is the one the ball flies.
 */
export const kickSetup = (setup: FreeKickSetup, sessionSeed: number, kickIndex: number, keeper: KeeperId): FreeKickSetup =>
  ({ ...setup, seed: kickSeed(sessionSeed, kickIndex, keeper) });
