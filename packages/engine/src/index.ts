/**
 * Deterministic penalty physics and keeper AI, shared by the game and the Skill Cup referee.
 *
 * Nothing here decides anything of value. Ball rarity (RF payout, $GBOOT drop, Cup race points)
 * comes from the chance-game settlement. The kick only decides score, streaks and leaderboards.
 *
 * Goal-plane units: posts at x = ±1, ground at y = 0, crossbar at y = 1.
 */

export type ShotInput = Readonly<{
  /** Reticle across the goal, -1.4 … 1.4 (posts at ±1). */
  aimX: number;
  /** Keyboard loft adjustment, -0.3 … 0.3. Touch uses 0. */
  loft: number;
  /** 0 … 1. Height and ball speed rise with power; above ~0.9 it clears the bar. */
  power: number;
  /** -1 … 1. Swerve applied to the final position and the flight path. */
  curl: number;
}>;

export type KeeperId =
  | "sloth" | "squirrel" | "octopus" | "ghost" | "sumo" | "robot"
  | "peacock" | "mouse" | "chameleon" | "mime" | "disco" | "finalwall";
export type ShotResult = "goal" | "save" | "post" | "over" | "wide";

export type KeeperProfile = Readonly<{
  id: KeeperId;
  name: string;
  bio: string;
  /** What a sharp striker can read before shooting. */
  tell: string;
  /** Score multiplier: tougher keepers score more. */
  mult: number;
  /** Seconds between the strike and the keeper moving. */
  reaction: number;
  /** Seconds for a full dive. */
  diveTime: number;
  /** Save radius around the hands, goal units. */
  reach: number;
  /** Half-width of the standing body block. */
  body: number;
  /** Highest point the hands can reach (1 = crossbar). */
  maxY: number;
  boss?: boolean;
}>;

export const KEEPERS: readonly KeeperProfile[] = [
  { id: "mouse", name: "Squeak the Mouse", bio: "Tiny, brave and very fast. Cannot reach the top corners, however hard he jumps.", tell: "Top corners are always open.", mult: 0.75, reaction: 0.04, diveTime: 0.3, reach: 0.26, body: 0.1, maxY: 0.58 },
  { id: "squirrel", name: "Nibbles the Squirrel", bio: "Too much coffee, not enough patience. Always goes early.", tell: "Leans towards the side he will dive during your run-up.", mult: 1, reaction: 0, diveTime: 0.36, reach: 0.3, body: 0.12, maxY: 1 },
  { id: "sloth", name: "Snooze the Sloth", bio: "Barely moves, but those arms go on forever. Yawns between saves.", tell: "Hardly dives at all — power beats him.", mult: 1, reaction: 0.28, diveTime: 0.95, reach: 0.62, body: 0.16, maxY: 0.95 },
  { id: "peacock", name: "Peacock Pete", bio: "Showboat. Fans his tail one way and loves to go the other.", tell: "His tail fans towards the side he is faking.", mult: 1.25, reaction: 0.02, diveTime: 0.4, reach: 0.3, body: 0.12, maxY: 1 },
  { id: "octopus", name: "Octavia the Octopus", bio: "Four arms, one zone, total commitment. Inks the ball on a save.", tell: "Commits to one third of the goal — and covers all of it.", mult: 1.25, reaction: 0.12, diveTime: 0.46, reach: 0.46, body: 0.14, maxY: 1 },
  { id: "mime", name: "Marcel the Mime", bio: "Builds an invisible wall across part of the goal. Takes his art very seriously.", tell: "A faint shimmer shows where the wall is.", mult: 1.25, reaction: 0.2, diveTime: 0.6, reach: 0.2, body: 0.12, maxY: 1 },
  { id: "disco", name: "Disco Dee", bio: "Dives on the beat. Left on the one, right on the two.", tell: "Listen to the music: the beat tells you his side.", mult: 1.25, reaction: 0.08, diveTime: 0.4, reach: 0.34, body: 0.12, maxY: 1 },
  { id: "sumo", name: "Big Bento", bio: "Fills the middle of the goal on his own. Stomps shake the stadium.", tell: "Nothing gets through the centre. Corners take him an age.", mult: 1.25, reaction: 0.12, diveTime: 0.7, reach: 0.34, body: 0.34, maxY: 0.9 },
  { id: "chameleon", name: "Chroma the Chameleon", bio: "Blends into the net until you strike. You never quite know where she is.", tell: "Invisible until the kick — trust your aim.", mult: 1.5, reaction: 0.14, diveTime: 0.42, reach: 0.34, body: 0.13, maxY: 1 },
  { id: "robot", name: "K-33P", bio: "A goalkeeping unit that learns. Remembers your favourite corner.", tell: "A scan-line sweeps the side it has learned.", mult: 1.5, reaction: 0.1, diveTime: 0.4, reach: 0.34, body: 0.13, maxY: 1 },
  { id: "ghost", name: "Boo the Ghost", bio: "Blinks between the posts. Reads your eyes, then appears where you aimed.", tell: "Flickers when it has read you.", mult: 2, reaction: 0.22, diveTime: 0.1, reach: 0.3, body: 0.12, maxY: 1 },
  { id: "finalwall", name: "THE FINAL WALL", bio: "The Skill Cup boss. Three phases, no mercy, and a very dramatic entrance.", tell: "Phase 1 guards the middle, phase 2 reads you, phase 3 covers everything.", mult: 2.5, reaction: 0.12, diveTime: 0.42, reach: 0.34, body: 0.2, maxY: 1, boss: true },
];

export const keeperById = (id: KeeperId) => KEEPERS.find(keeper => keeper.id === id)!;

/** Match context the keeper may use. The referee supplies exactly the same values. */
export type KickContext = Readonly<{ kickIndex: number; history: readonly number[] }>;
const NO_CONTEXT: KickContext = { kickIndex: 0, history: [] };

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

/** Where the ball crosses the goal line, and how long it takes to get there (seconds). */
export function shotTarget(shot: ShotInput) {
  const power = clamp(shot.power, 0, 1);
  return {
    x: clamp(shot.aimX, -1.6, 1.6) + clamp(shot.curl, -1, 1) * 0.3,
    y: Math.max(0.02, 1.25 * power - 0.15 + clamp(shot.loft, -0.3, 0.3)),
    time: 0.95 - 0.55 * power,
  };
}

export type KeeperPlan = Readonly<{
  x: number; y: number; reaction: number; diveTime: number; reach: number; body: number; maxY: number;
  /** Pre-kick lean the renderer shows (-1 … 1); gameplay-neutral information for readable tells. */
  lean: number;
  /** Mime: goal-x interval blocked by the invisible wall. */
  wall?: readonly [number, number];
  /** Ghost / chameleon: instant relocation instead of a dive. */
  teleport?: boolean;
  /** Robot: the side it scans (-1, 0, 1). */
  scan?: number;
  /** Boss phase 1–3. */
  phase?: number;
}>;

/** Keeper dive decision. Seeded + context, so the same inputs always dive the same way. */
export function keeperPlan(profile: KeeperProfile, seed: number, target: { x: number; y: number }, context: KickContext = NO_CONTEXT): KeeperPlan {
  const random = prng(seed);
  const side = random() < 0.5 ? -1 : 1;
  const base = { reaction: profile.reaction, diveTime: profile.diveTime, reach: profile.reach, body: profile.body, maxY: profile.maxY, lean: 0 };
  const corner = () => side * (0.55 + random() * 0.35), height = () => 0.2 + random() * 0.6;
  switch (profile.id) {
    case "mouse": return { ...base, x: corner(), y: random() < 0.5 ? 0.15 : 0.45 };
    case "squirrel": { const x = corner(); return { ...base, x, y: height(), lean: Math.sign(x) * 0.8 }; }
    case "sloth": return random() < 0.55 ? { ...base, x: 0, y: 0.45 } : { ...base, x: side * 0.35, y: 0.4 };
    case "peacock": {
      const fake = side, real = random() < 0.62 ? -fake : fake;
      return { ...base, x: real * (0.6 + random() * 0.3), y: height(), lean: fake * 0.9 };
    }
    case "octopus": { const zone = Math.floor(random() * 3) - 1; return { ...base, x: zone * 0.72, y: 0.5 }; }
    case "mime": { const third = Math.floor(random() * 3) - 1; const wall: [number, number] = [third * 0.67 - 0.36, third * 0.67 + 0.36]; return { ...base, x: -third * 0.3, y: 0.4, wall }; }
    case "disco": { const beat = context.kickIndex % 2 === 0 ? -1 : 1; return { ...base, x: beat * (0.55 + random() * 0.3), y: height(), lean: beat * 0.3 }; }
    case "sumo": return random() < 0.7 ? { ...base, x: 0, y: 0.35 } : { ...base, x: side * 0.5, y: 0.3 };
    case "chameleon": {
      if (random() < 0.3) return { ...base, x: clamp(target.x + (random() - 0.5) * 0.5, -1, 1), y: clamp(target.y + (random() - 0.5) * 0.4, 0.1, 0.9) };
      return { ...base, x: corner(), y: height() };
    }
    case "robot": {
      const recent = context.history.slice(-3);
      const favourite = recent.length >= 2 ? Math.sign(recent.reduce((sum, x) => sum + Math.sign(x), 0)) : 0;
      if (favourite !== 0 && random() < 0.7) return { ...base, x: favourite * (0.55 + random() * 0.3), y: height(), scan: favourite };
      return { ...base, x: corner(), y: height(), scan: 0 };
    }
    case "ghost": {
      if (random() < 0.38) return { ...base, x: clamp(target.x + (random() - 0.5) * 0.3, -1, 1), y: clamp(target.y + (random() - 0.5) * 0.3, 0.1, 0.9), teleport: true };
      return { ...base, x: side * (0.4 + random() * 0.5), y: height(), teleport: true };
    }
    case "finalwall": {
      const phase = context.kickIndex < 2 ? 1 : context.kickIndex < 4 ? 2 : 3;
      if (phase === 1) return { ...base, x: random() < 0.5 ? 0 : side * 0.4, y: 0.4, body: 0.3, phase };
      if (phase === 2) {
        if (random() < 0.55) return { ...base, x: clamp(target.x + (random() - 0.5) * 0.35, -1, 1), y: clamp(target.y + (random() - 0.5) * 0.3, 0.1, 0.9), phase };
        return { ...base, x: corner(), y: height(), phase };
      }
      return { ...base, x: corner(), y: height(), reach: 0.46, diveTime: 0.3, phase };
    }
  }
}

/** Keeper hand position at time t after the strike. */
export function keeperAt(plan: KeeperPlan, t: number) {
  const raw = clamp((t - plan.reaction) / plan.diveTime, 0, 1);
  const progress = plan.teleport ? (raw > 0.5 ? 1 : 0) : 1 - (1 - raw) ** 2;
  return { x: plan.x * progress, y: Math.min(plan.maxY, 0.45 + (plan.y - 0.45) * progress), progress };
}

export type ShotOutcome = Readonly<{
  result: ShotResult;
  target: { x: number; y: number; time: number };
  plan: KeeperPlan;
}>;

/** Resolve a shot: frame first, then keeper (wall, body, hands), then goal. Pure and deterministic. */
export function resolveShot(shot: ShotInput, profile: KeeperProfile, seed: number, context: KickContext = NO_CONTEXT): ShotOutcome {
  const target = shotTarget(shot);
  const plan = keeperPlan(profile, seed, target, context);
  const ax = Math.abs(target.x);
  const hitsPost = Math.abs(ax - 1) < BALL_RADIUS + FRAME && target.y < 1 + BALL_RADIUS;
  const hitsBar = Math.abs(target.y - 1) < BALL_RADIUS + FRAME && ax < 1 + BALL_RADIUS;
  if (hitsPost || hitsBar) return { result: "post", target, plan };
  if (ax > 1) return { result: "wide", target, plan };
  if (target.y > 1) return { result: "over", target, plan };
  if (plan.wall && target.x >= plan.wall[0] && target.x <= plan.wall[1]) return { result: "save", target, plan };
  const hands = keeperAt(plan, target.time);
  const body = Math.abs(target.x - hands.x * 0.6) < plan.body + 0.04 && target.y < 0.85;
  const reach = Math.hypot(target.x - hands.x, (target.y - Math.min(hands.y, plan.maxY)) * 1.2) < plan.reach && target.y <= plan.maxY + plan.reach * 0.6;
  return { result: body || reach ? "save" : "goal", target, plan };
}

/** Flight position at progress p (0 … 1), before projection. */
export function flightAt(target: { x: number; y: number }, curl: number, p: number) {
  const bow = Math.sin(Math.PI * p) * -curl * 0.35;
  return { x: target.x * p + bow, y: target.y * p * (0.6 + 0.4 * p) + Math.sin(Math.PI * p) * 0.08, depth: p };
}

export const STREAK_CAP = 3;
export const streakMultiplier = (streak: number) => Math.min(STREAK_CAP, 1 + 0.5 * Math.max(0, streak - 1));

export function goalPoints(keeper: KeeperProfile, ballMult: number, streak: number, suddenDeath: boolean) {
  return Math.round(100 * keeper.mult * ballMult * streakMultiplier(streak) * (suddenDeath ? 2 : 1));
}
