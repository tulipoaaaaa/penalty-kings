/**
 * Free kicks: deterministic 3D flight (fixed-step integration) with gravity, air drag, Magnus
 * curl (sidespin), topspin dip, a seeded knuckleball wobble and wind; a wall of 3–5 that jumps
 * on a timing; a keeper who shuffles, reads the flight and makes ONE capped dive
 * (freekick-keeper.ts). Metres, seconds. Same inputs + seed → same result everywhere.
 *
 * Owner playtest C1: launch 24–36 m/s (pro range; distance adds pace automatically), so a kick
 * reaches the line in ≈0.8–1.1 s from 18–24 m and ≈1.0–1.4 s from 30–32 m; topspin is a real
 * long-range dip (Magnus ∝ spin × speed), so a well-struck ball clears the wall and still comes
 * down under the bar from every distance.
 */
import { prng, clamp, isPerfectStrike, PERFECT_FK_PACE, type KeeperProfile, type KeeperPlan, type Difficulty, NEUTRAL, shotZone, type Zone } from "./index.ts";
import { keeperTouch, BALL_RADIUS, GOAL_ASPECT, type KeeperPart } from "./keeper-rig.ts";
import { planFreeKickKeeper, freeKickKeeperFrame, type FreeKickKeeper } from "./freekick-keeper.ts";

export * from "./freekick-keeper.ts";

export const GOAL_HALF_WIDTH = 3.66, GOAL_HEIGHT = 2.44, WALL_DISTANCE = 9.15;
/** Air drag k (a = −k·v·v⃗, per metre), Magnus sidespin and topspin gains (per m/s of speed), fixed step. */
const G = 9.81, DRAG = 0.0125, MAGNUS = 0.2, TOPSPIN = 0.5, DT = 1 / 240, WIND_GAIN = 0.09;
/** Every struck free kick carries a little natural topspin (an instep drive); a knuckleball carries none. */
const BASE_TOP = 0.2;
export const PLAYER_WIDTH = 0.62, JUMP_HEIGHT = 0.38, JUMP_TIME = 0.5;
/** Wall height by difficulty (stadium): a youth wall at Park, a pro wall at Champions. Levels may override. */
export const WALL_HEIGHTS = { park: 1.65, pro: 1.8, champions: 1.9 } as const;
/** Launch speed band, m/s: a soft 18 m chip at the bottom, the hardest 32 m strike at the top. */
export const FK_MIN_SPEED = 24, FK_MAX_SPEED = 36;
/** Free kicks from this far (metres) are long-range: +50 % points and a SCREAMER when they go in. */
export const SCREAMER_DISTANCE = 28;
export const SCREAMER_BONUS = 1.5;

export type FreeKickSetup = Readonly<{
  /** Straight-line distance from the ball to the centre of the goal line (18–32 m). */
  distance: number;
  /** Angle off the centre line, radians (negative = ball left of centre). */
  angle: number;
  wallSize: 3 | 4 | 5;
  /** Standing height of the wall players, metres (1.55–1.95). */
  wallHeight: number;
  /** Seconds after the strike when the wall leaves the ground. */
  wallJumpAt: number;
  /** Lateral wind, m/s (+ blows towards +x). 0 indoors. */
  wind: number;
  seed: number;
}>;

export type FreeKickShot = Readonly<{
  /** Horizontal aim across the goal in goal units (posts at ±1), before spin and wind. */
  aimX: number;
  /** Elevation 0 … 1. */
  lift: number;
  /** 0 … 1 → launch speed, scaled by distance (freeKickSpeed): 24–28.8 m/s at 18 m, 31.2–36 m/s at 32 m. */
  power: number;
  /** Sidespin −1 … 1 (Magnus curl; + bends towards +x). */
  spin: number;
  /** Topspin 0 … 1 (dip). */
  top: number;
}>;

export type FreeKickResult = "goal" | "save" | "post" | "over" | "wide" | "wall";
export type FlightSample = Readonly<{ t: number; x: number; y: number; z: number }>;
export type FreeKickOutcome = Readonly<{
  result: FreeKickResult;
  /** Crossing point in goal units (x: posts ±1, y: bar = 1). */
  target: { x: number; y: number; time: number };
  zone: Zone;
  knuckle: boolean;
  /** Wall centre and half-width in metres along x at the wall plane; which side it covers. */
  wall: { x: number; halfWidth: number; side: number; jumped: boolean };
  /** The keeper's dive (plan.home = where the dive starts). Kept for the shared ShotOutcome shape; the motion is `keeperMotion`. */
  keeper: KeeperPlan;
  /** The whole free-kick keeper motion (shuffle, read, cross-steps, one dive). The Stage draws freeKickKeeperFrame(motion, t). */
  keeperMotion: FreeKickKeeper;
  /** Which part of the keeper the ball hit (keeper saves only). */
  touch?: KeeperPart;
  /** A save on a ball heading over or just under the bar: the keeper tipped it over. */
  tipOver?: boolean;
  /** BQ-P2-8: result "post": which woodwork it hit (the post, the crossbar, or both in the corner). */
  hitPost?: boolean;
  hitBar?: boolean;
  /** The kick was taken from SCREAMER_DISTANCE or further. */
  longRange: boolean;
  /** 30 Hz samples for rendering. */
  path: FlightSample[];
}>;

/** A date/level-seeded setup. Outdoor stadiums pass maxWind > 0. */
export function freeKickSetup(seed: number, options: { distance?: number; angle?: number; wallSize?: 3 | 4 | 5; maxWind?: number; wallHeight?: number } = {}): FreeKickSetup {
  const random = prng(seed);
  const distance = options.distance ?? 18 + Math.round(random() * 14);
  const angle = options.angle ?? (random() - 0.5) * 0.7;
  const wallSize = options.wallSize ?? ((3 + Math.floor(random() * 3)) as 3 | 4 | 5);
  const wind = options.maxWind ? Math.round((random() * 2 - 1) * options.maxWind * 10) / 10 : 0;
  return { distance: clamp(distance, 18, 32), angle: clamp(angle, -0.5, 0.5), wallSize, wallHeight: clamp(options.wallHeight ?? WALL_HEIGHTS.pro, 1.55, 1.95), wallJumpAt: 0.12 + random() * 0.18, wind, seed };
}

/** Knuckleball: hard and almost spinless. */
export const isKnuckle = (shot: FreeKickShot) => shot.power > 0.78 && Math.abs(shot.spin) < 0.12 && shot.top < 0.15;

/**
 * Launch speed (m/s) for a swipe's power at this distance: a natural swipe from 30 m is struck harder
 * than the same swipe from 18 m (the taker leans into a long one). 24–28.8 m/s at 18 m, 31.2–36 m/s at 32 m.
 */
export function freeKickSpeed(power: number, distance: number) {
  const reach = clamp((distance - 18) / 14, 0, 1);
  return FK_MIN_SPEED + (FK_MAX_SPEED - FK_MIN_SPEED) * clamp(0.4 * clamp(power, 0, 1) + 0.6 * reach, 0, 1);
}
/** Launch elevation (radians) for lift 0 … 1. */
export const freeKickElevation = (lift: number) => 0.03 + 0.5 * clamp(lift, 0, 1);

/** The wall's geometry for a setup (no shot needed). */
export function freeKickWall(setup: FreeKickSetup) {
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance;
  const side = x0 === 0 ? 1 : Math.sign(x0);
  const nearPost = side * GOAL_HALF_WIDTH * 0.55;
  const wallT = WALL_DISTANCE / setup.distance;
  return { x: x0 + (nearPost - x0) * wallT, z: depth * wallT, halfWidth: (setup.wallSize * PLAYER_WIDTH) / 2, side };
}

type Flight = { path: FlightSample[]; t: number; x: number; y: number; z: number; depth: number; wallHit: boolean; jumped: boolean; knuckle: boolean };
/** The ball's flight alone (no keeper). `wobble: false` flies a knuckleball without its seeded wobble (solveLift). */
function fly(setup: FreeKickSetup, shot: FreeKickShot, random: () => number, wobble = true): Flight {
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance;
  const wall = freeKickWall(setup);
  // A PERFECT strike (power in PERFECT_BAND) is struck a little harder: the same rule as penalties.
  const speed = freeKickSpeed(shot.power, setup.distance) * (isPerfectStrike(shot.power) ? PERFECT_FK_PACE : 1);
  const aimX = clamp(shot.aimX, -1.6, 1.6) * GOAL_HALF_WIDTH;
  const heading = Math.atan2(aimX - x0, depth);
  const elevation = freeKickElevation(shot.lift);
  let vx = speed * Math.cos(elevation) * Math.sin(heading), vy = speed * Math.sin(elevation), vz = speed * Math.cos(elevation) * Math.cos(heading);
  let x = x0, y = 0.11, z = 0, t = 0;
  const spin = clamp(shot.spin, -1, 1);
  const knuckle = isKnuckle(shot);
  const top = knuckle ? 0 : BASE_TOP + (1 - BASE_TOP) * clamp(shot.top, 0, 1);
  const wobbleFreq = 1.6 + random() * 1.8, phaseX = random() * Math.PI * 2, phaseY = random() * Math.PI * 2, wobbleAmp = knuckle && wobble ? 3.2 : 0;
  const path: FlightSample[] = [{ t, x, y, z }];
  let wallCrossed = false, wallHit = false, jumped = false;
  let nextSample = 1 / 30;
  while (z < depth && t < 3.5 && y > -0.2) {
    const v = Math.hypot(vx, vy, vz);
    // Drag, gravity, Magnus (sidespin around the vertical axis → lateral; topspin → downward), wind, knuckle wobble.
    let ax = -DRAG * v * vx + MAGNUS * spin * vz * 0.9 + setup.wind * WIND_GAIN;
    let ay = -G - DRAG * v * vy - TOPSPIN * top * v;
    const az = -DRAG * v * vz;
    if (wobbleAmp) { ax += wobbleAmp * Math.sin(2 * Math.PI * wobbleFreq * t + phaseX); ay += wobbleAmp * 0.7 * Math.sin(2 * Math.PI * wobbleFreq * 1.3 * t + phaseY); }
    const prevZ = z, prevY = y, prevX = x;
    vx += ax * DT; vy += ay * DT; vz += az * DT;
    x += vx * DT; y += vy * DT; z += vz * DT; t += DT;
    if (y < 0.11 && vy < 0) { y = 0.11; vy = -vy * 0.45; vx *= 0.8; vz *= 0.8; } // bounce
    if (!wallCrossed && prevZ < wall.z && z >= wall.z) {
      wallCrossed = true;
      const k = (wall.z - prevZ) / (z - prevZ || 1), cx = prevX + (x - prevX) * k, cy = prevY + (y - prevY) * k;
      const jump = t >= setup.wallJumpAt ? Math.sin(clamp((t - setup.wallJumpAt) / JUMP_TIME, 0, 1) * Math.PI) * JUMP_HEIGHT : 0;
      jumped = jump > 0;
      // Over the top, or UNDER a wall that has jumped (a skidding low shot).
      const under = jump > 0.12 && cy < jump - 0.08;
      if (Math.abs(cx - wall.x) < wall.halfWidth && cy < (setup.wallHeight ?? 1.85) + jump && !under) wallHit = true;
    }
    if (wallHit) break;
    if (t >= nextSample) { path.push({ t, x, y, z }); nextSample += 1 / 30; }
  }
  // The last sample: exactly on the goal line (interpolated back from the step that crossed it).
  if (!wallHit && z >= depth && path.length) {
    const prev = path[path.length - 1], k = clamp((depth - prev.z) / (z - prev.z || 1), 0, 1);
    x = prev.x + (x - prev.x) * k; y = prev.y + (y - prev.y) * k; t = prev.t + (t - prev.t) * k; z = depth;
  }
  path.push({ t, x, y, z });
  return { path, t, x, y, z, depth, wallHit, jumped, knuckle };
}

export function resolveFreeKick(setup: FreeKickSetup, shot: FreeKickShot, keeper: KeeperProfile, difficulty: Difficulty = NEUTRAL): FreeKickOutcome {
  const random = prng((setup.seed ^ 0x5bd1e995) >>> 0);
  const flight = fly(setup, shot, random);
  const { x, y, z, t, depth, wallHit, knuckle, path } = flight;
  const target = { x: x / GOAL_HALF_WIDTH, y: y / GOAL_HEIGHT, time: t };
  const zone = shotZone(target);
  const w = freeKickWall(setup);
  const wall = { x: w.x, halfWidth: w.halfWidth, side: w.side, jumped: flight.jumped };
  // The keeper: shuffles off his post as the kick is taken, reads the flight (later when the wall screens it), then ONE dive.
  const screened = Math.abs(target.x * GOAL_HALF_WIDTH - w.x) < w.halfWidth + 1.2;
  const motion = planFreeKickKeeper(keeper, difficulty, { side: w.side, target, knuckle, screened, blocked: wallHit, seed: random() * 0x100000000 >>> 0 });
  const base = { target, zone, knuckle, wall, path, keeper: motion.plan, keeperMotion: motion, longRange: setup.distance >= SCREAMER_DISTANCE };
  if (wallHit) return { ...base, result: "wall" };
  if (z < depth) return { ...base, result: "wide" }; // ran out of air before the line (never at 24 m/s+)
  // Saved ONLY when the ball (BALL_RADIUS at the crossing point) touches the keeper the Stage draws at that
  // instant: freeKickKeeperFrame(motion, t), the same rig and contact test as penalties. Tested FIRST, so a
  // ball the drawn keeper touches is always a save (a tip over the bar or round the post included).
  const touch = keeperTouch(freeKickKeeperFrame(keeper.id, motion, t), { x: target.x, y: target.y * GOAL_ASPECT }, BALL_RADIUS);
  if (touch) return { ...base, result: "save", touch, ...(target.y > 0.8 ? { tipOver: true } : {}) };
  const ax = Math.abs(target.x);
  const hitsPost = Math.abs(ax - 1) < 0.045 && target.y < 1.03;
  const hitsBar = Math.abs(target.y - 1) < 0.045 && ax < 1.03;
  if (hitsPost || hitsBar) return { ...base, result: "post", hitPost: hitsPost, hitBar: hitsBar };
  if (ax > 1) return { ...base, result: "wide" };
  if (target.y > 1) return { ...base, result: "over" };
  return { ...base, result: "goal" };
}

/**
 * WYSIWYG free kicks: the elevation that makes an unspun, windless shot at this pace cross the goal
 * line at `aimY` (goal units). Spin, topspin, wind, the wall and the keeper then do their thing:
 * that is the skill. Bisection on the real flight model (deterministic; a knuckleball is solved
 * without its wobble, which the strike then adds).
 */
export function solveLift(setup: FreeKickSetup, shot: { aimX: number; aimY: number; power: number; top: number }): number {
  const plain = { ...setup, wind: 0, wallHeight: 0.02, seed: 1 };
  const still = () => 0.5;
  const heightAt = (lift: number) => fly(plain, { aimX: shot.aimX, lift, power: shot.power, spin: 0, top: shot.top }, still, false).y / GOAL_HEIGHT;
  let lo = 0, hi = 1;
  if (heightAt(hi) < shot.aimY) return 1;
  if (heightAt(lo) > shot.aimY) return 0;
  for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (heightAt(mid) < shot.aimY) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
