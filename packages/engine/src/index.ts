/**
 * Deterministic penalty physics and keeper AI.
 *
 * Nothing here decides anything of value. Ball rarity (RF payout, $GBOOT drop,
 * Cup race points) comes from the chance-game settlement. The kick only decides
 * score, streaks and the skill leaderboard.
 *
 * Goal-plane units: posts at x = ±1, ground at y = 0, crossbar at y = 1.
 */

export type ShotInput = Readonly<{
  /** Reticle across the goal, -1.4 … 1.4 (posts at ±1). */
  aimX: number;
  /** Keyboard loft adjustment, -0.3 … 0.3. Touch uses 0. */
  loft: number;
  /** 0 … 1. Height and ball speed rise with power; above ~0.95 it clears the bar. */
  power: number;
  /** -1 … 1. Swerve applied to the final position and the flight path. */
  curl: number;
}>;

export type KeeperId = "wall" | "octopus" | "showboat" | "ghost";
export type ShotResult = "goal" | "save" | "post" | "over" | "wide";

export type KeeperProfile = Readonly<{
  id: KeeperId;
  name: string;
  blurb: string;
  /** Score multiplier: tougher keepers score more. */
  mult: number;
  /** Seconds between the strike and the keeper moving. */
  reaction: number;
  /** Seconds for a full dive. */
  diveTime: number;
  /** Save radius around the hands, goal units. */
  reach: number;
}>;

export const KEEPERS: readonly KeeperProfile[] = [
  { id: "showboat", name: "Showboat", blurb: "Commits before you strike. Big, early, flashy dives.", mult: 1, reaction: 0, diveTime: 0.42, reach: 0.22 },
  { id: "octopus", name: "Octopus", blurb: "Guesses wildly, but those arms reach everywhere.", mult: 1.25, reaction: 0.14, diveTime: 0.48, reach: 0.44 },
  { id: "wall", name: "The Wall", blurb: "Holds the middle and fills the goal. Slow to the corners.", mult: 1.5, reaction: 0.08, diveTime: 0.44, reach: 0.4 },
  { id: "ghost", name: "Ghost", blurb: "Waits, reads your body, then appears where you aimed.", mult: 2, reaction: 0.22, diveTime: 0.34, reach: 0.3 },
];

export const keeperById = (id: KeeperId) => KEEPERS.find(keeper => keeper.id === id)!;

/** mulberry32: small, fast, deterministic. */
export function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function kickSeed(ballId: number, kickIndex: number, keeper: KeeperId) {
  let hash = 2166136261;
  for (const part of `${ballId}:${kickIndex}:${keeper}`) hash = Math.imul(hash ^ part.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const BALL_RADIUS = 0.045;
const FRAME = 0.025;

/** Where the ball crosses the goal line, and how long it takes to get there. */
export function shotTarget(shot: ShotInput) {
  const power = clamp(shot.power, 0, 1);
  return {
    x: clamp(shot.aimX, -1.6, 1.6) + clamp(shot.curl, -1, 1) * 0.3,
    y: Math.max(0.02, 1.12 * power - 0.1 + clamp(shot.loft, -0.3, 0.3)),
    time: 0.95 - 0.55 * power,
  };
}

export type KeeperPlan = Readonly<{ x: number; y: number; reaction: number; diveTime: number; reach: number }>;

/** Keeper dive decision. Seeded, so one ball + kick index + keeper always dives the same way. */
export function keeperPlan(profile: KeeperProfile, seed: number, target: { x: number; y: number }): KeeperPlan {
  const random = prng(seed);
  const side = random() < 0.5 ? -1 : 1;
  const base = { reaction: profile.reaction, diveTime: profile.diveTime, reach: profile.reach };
  switch (profile.id) {
    case "wall": {
      if (random() < 0.3) return { ...base, x: 0, y: 0.45, reach: 0.5 };
      return { ...base, x: side * (0.45 + random() * 0.35), y: 0.2 + random() * 0.5 };
    }
    case "octopus": {
      const zone = Math.floor(random() * 6);
      return { ...base, x: [-0.75, 0, 0.75][zone % 3], y: zone < 3 ? 0.25 : 0.7 };
    }
    case "showboat":
      return { ...base, x: side * (0.7 + random() * 0.25), y: random() < 0.5 ? 0.2 : 0.75 };
    case "ghost": {
      if (random() < 0.38) return { ...base, x: clamp(target.x + (random() - 0.5) * 0.3, -1, 1), y: clamp(target.y + (random() - 0.5) * 0.3, 0.1, 0.9) };
      return { ...base, x: side * (0.4 + random() * 0.5), y: 0.2 + random() * 0.6 };
    }
  }
}

/** Keeper hand position at time t after the strike. */
export function keeperAt(plan: KeeperPlan, t: number) {
  const progress = clamp((t - plan.reaction) / plan.diveTime, 0, 1);
  const eased = 1 - (1 - progress) ** 2;
  return { x: plan.x * eased, y: 0.45 + (plan.y - 0.45) * eased, progress: eased };
}

export type ShotOutcome = Readonly<{
  result: ShotResult;
  target: { x: number; y: number; time: number };
  plan: KeeperPlan;
}>;

/** Resolve a shot: frame first, then keeper, then goal. Pure and deterministic. */
export function resolveShot(shot: ShotInput, profile: KeeperProfile, seed: number): ShotOutcome {
  const target = shotTarget(shot);
  const plan = keeperPlan(profile, seed, target);
  const ax = Math.abs(target.x);
  const hitsPost = Math.abs(ax - 1) < BALL_RADIUS + FRAME && target.y < 1 + BALL_RADIUS;
  const hitsBar = Math.abs(target.y - 1) < BALL_RADIUS + FRAME && ax < 1 + BALL_RADIUS;
  if (hitsPost || hitsBar) return { result: "post", target, plan };
  if (ax > 1) return { result: "wide", target, plan };
  if (target.y > 1) return { result: "over", target, plan };
  const hands = keeperAt(plan, target.time);
  // Standing body blocks central, low-ish shots even without a dive.
  const body = Math.abs(target.x - hands.x * 0.6) < 0.16 && target.y < 0.85;
  const reach = Math.hypot(target.x - hands.x, (target.y - hands.y) * 1.2) < plan.reach;
  return { result: body || reach ? "save" : "goal", target, plan };
}

/** Screen-space flight position at progress p (0 … 1), before projection. */
export function flightAt(target: { x: number; y: number }, curl: number, p: number) {
  const bow = Math.sin(Math.PI * p) * -curl * 0.35;
  return { x: target.x * p + bow, y: target.y * p * (0.6 + 0.4 * p) + Math.sin(Math.PI * p) * 0.08, depth: p };
}

export const STREAK_CAP = 3;
export const streakMultiplier = (streak: number) => Math.min(STREAK_CAP, 1 + 0.5 * Math.max(0, streak - 1));

export function goalPoints(keeper: KeeperProfile, ballMult: number, streak: number, suddenDeath: boolean) {
  return Math.round(100 * keeper.mult * ballMult * streakMultiplier(streak) * (suddenDeath ? 2 : 1));
}
