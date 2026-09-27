/**
 * Free kicks: deterministic 3D flight (fixed-step integration) with gravity, air drag, Magnus
 * curl (sidespin), topspin dip, a seeded knuckleball wobble and wind; a wall of 3–5 that jumps
 * on a timing; a keeper positioned relative to the wall. Metres, seconds. Same inputs + seed →
 * same result everywhere.
 */
import { prng, clamp, keeperAt, type KeeperProfile, type KeeperPlan, type Difficulty, NEUTRAL, shotZone, type Zone } from "./index.ts";

export const GOAL_HALF_WIDTH = 3.66, GOAL_HEIGHT = 2.44, WALL_DISTANCE = 9.15;
const G = 9.81, DRAG = 0.0125, MAGNUS = 0.19, DT = 1 / 240, WIND_GAIN = 0.09;
const PLAYER_WIDTH = 0.62, WALL_HEIGHT = 1.85, JUMP_HEIGHT = 0.38, JUMP_TIME = 0.5;

export type FreeKickSetup = Readonly<{
  /** Straight-line distance from the ball to the centre of the goal line (18–32 m). */
  distance: number;
  /** Angle off the centre line, radians (negative = ball left of centre). */
  angle: number;
  wallSize: 3 | 4 | 5;
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
  /** 0 … 1 → 18 … 32 m/s. */
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
  keeper: KeeperPlan;
  /** 30 Hz samples for rendering. */
  path: FlightSample[];
}>;

/** A date/level-seeded setup. Outdoor stadiums pass maxWind > 0. */
export function freeKickSetup(seed: number, options: { distance?: number; angle?: number; wallSize?: 3 | 4 | 5; maxWind?: number } = {}): FreeKickSetup {
  const random = prng(seed);
  const distance = options.distance ?? 18 + Math.round(random() * 14);
  const angle = options.angle ?? (random() - 0.5) * 0.7;
  const wallSize = options.wallSize ?? ((3 + Math.floor(random() * 3)) as 3 | 4 | 5);
  const wind = options.maxWind ? Math.round((random() * 2 - 1) * options.maxWind * 10) / 10 : 0;
  return { distance: clamp(distance, 18, 32), angle: clamp(angle, -0.5, 0.5), wallSize, wallJumpAt: 0.12 + random() * 0.18, wind, seed };
}

/** Knuckleball: hard and almost spinless. */
export const isKnuckle = (shot: FreeKickShot) => shot.power > 0.78 && Math.abs(shot.spin) < 0.12 && shot.top < 0.15;

export function resolveFreeKick(setup: FreeKickSetup, shot: FreeKickShot, keeper: KeeperProfile, difficulty: Difficulty = NEUTRAL): FreeKickOutcome {
  const random = prng((setup.seed ^ 0x5bd1e995) >>> 0);
  // Geometry: goal line is z = depth; the ball starts at (x0, 0, 0).
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance;
  // Wall: 9.15 m from the ball on the line to the NEAR post, covering the near side.
  const side = x0 === 0 ? 1 : Math.sign(x0);
  const nearPost = side * GOAL_HALF_WIDTH * 0.55;
  const wallT = WALL_DISTANCE / setup.distance;
  const wallX = x0 + (nearPost - x0) * wallT, wallZ = depth * wallT;
  const halfWidth = (setup.wallSize * PLAYER_WIDTH) / 2;
  // Launch.
  const speed = 18 + 14 * clamp(shot.power, 0, 1);
  const aimX = clamp(shot.aimX, -1.6, 1.6) * GOAL_HALF_WIDTH;
  const heading = Math.atan2(aimX - x0, depth);
  const elevation = 0.08 + 0.32 * clamp(shot.lift, 0, 1);
  let vx = speed * Math.cos(elevation) * Math.sin(heading), vy = speed * Math.sin(elevation), vz = speed * Math.cos(elevation) * Math.cos(heading);
  let x = x0, y = 0.11, z = 0, t = 0;
  const spin = clamp(shot.spin, -1, 1), top = clamp(shot.top, 0, 1);
  const knuckle = isKnuckle(shot);
  const wobbleFreq = 1.6 + random() * 1.8, phaseX = random() * Math.PI * 2, phaseY = random() * Math.PI * 2, wobbleAmp = knuckle ? 3.2 : 0;
  const path: FlightSample[] = [{ t, x, y, z }];
  let wallCrossed = false, wallHit = false, jumped = false;
  let nextSample = 1 / 30;
  while (z < depth && t < 3.5 && y > -0.2) {
    const v = Math.hypot(vx, vy, vz);
    // Drag, gravity, Magnus (sidespin around the vertical axis → lateral; topspin → downward), wind, knuckle wobble.
    let ax = -DRAG * v * vx + MAGNUS * spin * vz * 0.9 + setup.wind * WIND_GAIN;
    let ay = -G - DRAG * v * vy - MAGNUS * top * v * 0.55;
    const az = -DRAG * v * vz;
    if (wobbleAmp) { ax += wobbleAmp * Math.sin(2 * Math.PI * wobbleFreq * t + phaseX); ay += wobbleAmp * 0.7 * Math.sin(2 * Math.PI * wobbleFreq * 1.3 * t + phaseY); }
    const prevZ = z, prevY = y, prevX = x;
    vx += ax * DT; vy += ay * DT; vz += az * DT;
    x += vx * DT; y += vy * DT; z += vz * DT; t += DT;
    if (y < 0.11 && vy < 0) { y = 0.11; vy = -vy * 0.45; vx *= 0.8; vz *= 0.8; } // bounce
    if (!wallCrossed && prevZ < wallZ && z >= wallZ) {
      wallCrossed = true;
      const k = (wallZ - prevZ) / (z - prevZ || 1), cx = prevX + (x - prevX) * k, cy = prevY + (y - prevY) * k;
      const jump = t >= setup.wallJumpAt ? Math.sin(clamp((t - setup.wallJumpAt) / JUMP_TIME, 0, 1) * Math.PI) * JUMP_HEIGHT : 0;
      jumped = jump > 0;
      // Over the top, or UNDER a wall that has jumped (a skidding low shot).
      const under = jump > 0.12 && cy < jump - 0.08;
      if (Math.abs(cx - wallX) < halfWidth && cy < WALL_HEIGHT + jump && !under) wallHit = true;
    }
    if (wallHit) break;
    if (t >= nextSample) { path.push({ t, x, y, z }); nextSample += 1 / 30; }
  }
  path.push({ t, x, y, z });
  const target = { x: x / GOAL_HALF_WIDTH, y: y / GOAL_HEIGHT, time: t };
  const zone = shotZone(target);
  // Keeper: starts on the side the wall does NOT cover, reacts late when screened by the wall.
  const startX = -side * 0.3;
  const read = clamp(keeper.read + difficulty.read, 0, 0.95);
  const guess = random() < read ? target.x : (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.4);
  const screened = Math.abs(target.x * GOAL_HALF_WIDTH - wallX) < halfWidth + 1.2;
  const plan: KeeperPlan = {
    x: clamp(guess, -1, 1), y: clamp(target.y, 0.15, 0.85), lean: 0,
    reaction: Math.max(0.05, keeper.reaction + difficulty.reaction + 0.12 + (screened ? 0.15 : 0)),
    diveTime: keeper.diveTime, reach: keeper.reach * difficulty.reach, body: keeper.body, maxY: keeper.maxY,
  };
  const wall = { x: wallX, halfWidth, side, jumped };
  const base = { target, zone, knuckle, wall, path };
  if (wallHit) return { ...base, result: "wall", keeper: plan };
  if (z < depth) return { ...base, result: y <= 0 ? "save" : "wide", keeper: plan }; // died before the line
  const ax = Math.abs(target.x);
  const hitsPost = Math.abs(ax - 1) < 0.045 && target.y < 1.03;
  const hitsBar = Math.abs(target.y - 1) < 0.045 && ax < 1.03;
  if (hitsPost || hitsBar) return { ...base, result: "post", keeper: plan };
  if (ax > 1) return { ...base, result: "wide", keeper: plan };
  if (target.y > 1) return { ...base, result: "over", keeper: plan };
  // Keeper hands relative to its start position.
  const hands = keeperAt({ ...plan, x: plan.x - startX }, t);
  const handX = startX + hands.x;
  const saved = Math.hypot(target.x - handX, (target.y - Math.min(hands.y, plan.maxY)) * 1.2) < plan.reach || (Math.abs(target.x - startX) < plan.body && target.y < 0.8);
  return { ...base, result: saved ? "save" : "goal", keeper: { ...plan, x: handX } };
}
