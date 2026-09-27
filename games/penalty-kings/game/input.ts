/**
 * One gesture for every mode. Penalties use the engine's forgiving swipe directly; free kicks add
 * lift (how far up the swipe travels) and topspin (a flick that speeds up at the end). Keyboard and
 * mouse drag produce the same inputs.
 */
import { swipeToShot, clamp, RELEASE_BUFFER_MS, type SwipePoint, type ShotInput, type FreeKickShot } from "@penalty-kings/engine";

export function swipeToFreeKick(points: readonly SwipePoint[], size: { width: number; height: number }): FreeKickShot | null {
  const base = swipeToShot(points, size);
  if (!base) return null;
  const first = points[0], last = points[points.length - 1];
  const up = (first.y - last.y) / size.height;
  const recent = points.filter(point => last.t - point.t <= RELEASE_BUFFER_MS);
  const from = recent.length >= 2 ? recent[0] : points[points.length - 2];
  const releaseSpeed = (from.y - last.y) / Math.max(1, last.t - from.t), averageSpeed = (first.y - last.y) / Math.max(1, last.t - first.t);
  return {
    aimX: clamp(base.aimX / 1.6, -1.2, 1.2),
    lift: clamp((up - 0.12) / 0.55, 0, 1),
    power: base.power,
    spin: base.curl,
    top: clamp((releaseSpeed / Math.max(0.01, averageSpeed) - 1.1) * 1.2, 0, 1),
  };
}

/** Keyboard aim state → the same shot types. */
export type KeyAim = { aimX: number; loft: number; lift: number; curl: number; top: number; power: number };
export const keyShot = (aim: KeyAim): ShotInput => ({ aimX: aim.aimX, loft: aim.loft, power: aim.power, curl: aim.curl });
export const keyFreeKick = (aim: KeyAim): FreeKickShot => ({ aimX: aim.aimX / 1.6, lift: aim.lift, power: aim.power, spin: aim.curl, top: aim.top });
