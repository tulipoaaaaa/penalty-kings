/**
 * Deterministic penalty physics and keeper AI, shared by the game and the Skill Cup referee.
 *
 * Nothing here decides anything of value. Ball rarity (RF payout, $GBOOT drop, Cup race points)
 * comes from the chance-game settlement. The kick only decides score, streaks and leaderboards.
 *
 * Goal-plane units: posts at x = ±1, ground at y = 0, crossbar at y = 1.
 */
import { keeperFrame, keeperTouch, BALL_RADIUS, GOAL_ASPECT, LEG_CHANCE, TOP_BIN_Y, type KeeperPart } from "./keeper-rig.ts";

export type ShotInput = Readonly<{
  /** Aim across the goal face, goal units (posts at ±1). WHERE you point is where it goes. */
  aimX: number;
  /** Aim height on the goal face, goal units (ground 0, bar 1). */
  aimY: number;
  /** 0 … 1: pace only (flight time → keeper reaction). Only an extreme overhit (> OVERHIT) adds rise. */
  power: number;
  /** -1 … 1: deliberate bend. Bows the path; drifts the landing point by at most CURL_DRIFT. */
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
  /** Probability the keeper reads the shot and dives the right way (0 … 1). */
  read: number;
  boss?: boolean;
}>;

export const KEEPERS: readonly KeeperProfile[] = [
  { id: "mouse", name: "Squeak the Mouse", bio: "Tiny, brave and very fast. Cannot reach the top corners, however hard he jumps.", tell: "Top corners are always open.", mult: 0.75, reaction: 0.04, diveTime: 0.3, reach: 0.26, body: 0.1, maxY: 0.58, read: 0.1 },
  { id: "squirrel", name: "Nibbles the Squirrel", bio: "Too much coffee, not enough patience. Always goes early.", tell: "Leans towards the side he will dive during your run-up.", mult: 1, reaction: 0, diveTime: 0.36, reach: 0.3, body: 0.12, maxY: 1, read: 0.12 },
  { id: "sloth", name: "Snooze the Sloth", bio: "Barely moves, but those arms go on forever. Yawns between saves.", tell: "Hardly dives at all — power beats him.", mult: 1, reaction: 0.28, diveTime: 0.95, reach: 0.62, body: 0.16, maxY: 0.95, read: 0.05 },
  { id: "peacock", name: "Peacock Pete", bio: "Showboat. Fans his tail one way and loves to go the other.", tell: "His tail fans towards the side he is faking.", mult: 1.25, reaction: 0.02, diveTime: 0.4, reach: 0.3, body: 0.12, maxY: 1, read: 0.15 },
  { id: "octopus", name: "Octavia the Octopus", bio: "Four arms, one zone, total commitment. Inks the ball on a save.", tell: "Commits to one third of the goal — and covers all of it.", mult: 1.25, reaction: 0.12, diveTime: 0.46, reach: 0.46, body: 0.14, maxY: 1, read: 0.2 },
  { id: "mime", name: "Marcel the Mime", bio: "Builds an invisible wall across part of the goal. Takes his art very seriously.", tell: "A faint shimmer shows where the wall is.", mult: 1.25, reaction: 0.2, diveTime: 0.6, reach: 0.2, body: 0.12, maxY: 1, read: 0.1 },
  { id: "disco", name: "Disco Dee", bio: "Dives on the beat. Left on the one, right on the two.", tell: "Listen to the music: the beat tells you his side.", mult: 1.25, reaction: 0.08, diveTime: 0.4, reach: 0.34, body: 0.12, maxY: 1, read: 0.1 },
  { id: "sumo", name: "Big Bento", bio: "Fills the middle of the goal on his own. Stomps shake the stadium.", tell: "Nothing gets through the centre. Corners take him an age.", mult: 1.25, reaction: 0.12, diveTime: 0.7, reach: 0.34, body: 0.34, maxY: 0.9, read: 0.15 },
  { id: "chameleon", name: "Chroma the Chameleon", bio: "Blends into the net until you strike. You never quite know where she is.", tell: "Invisible until the kick — trust your aim.", mult: 1.5, reaction: 0.14, diveTime: 0.42, reach: 0.34, body: 0.13, maxY: 1, read: 0.2 },
  { id: "robot", name: "K-33P", bio: "A goalkeeping unit that learns. Remembers your favourite corner.", tell: "A scan-line sweeps the side it has learned.", mult: 1.5, reaction: 0.1, diveTime: 0.4, reach: 0.34, body: 0.13, maxY: 1, read: 0.25 },
  { id: "ghost", name: "Boo the Ghost", bio: "Blinks between the posts. Reads your eyes, then appears where you aimed.", tell: "Flickers when it has read you.", mult: 2, reaction: 0.22, diveTime: 0.1, reach: 0.3, body: 0.12, maxY: 1, read: 0.2 },
  { id: "finalwall", name: "THE FINAL WALL", bio: "The Skill Cup boss. Three phases, no mercy, and a very dramatic entrance.", tell: "Phase 1 guards the middle, phase 2 reads you, phase 3 covers everything.", mult: 2.5, reaction: 0.12, diveTime: 0.42, reach: 0.34, body: 0.2, maxY: 1, read: 0.35, boss: true },
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
const FRAME = 0.025;

/** Power above this is an overhit: it adds rise (up to +0.4 goal units at full power) and can clear the bar. */
export const OVERHIT = 0.9;
/** Maximum landing drift from full curl, goal units: an on-target aim with max curl stays within the post ± 0.05. */
export const CURL_DRIFT = 0.08;

// ── PERFECT strike ────────────────────────────────────────────────────────
/**
 * "Flick at just the right speed (firm, not wild) for a PERFECT strike: a faster ball and a steadier aim."
 * The sweet spot is a band of swipe SPEED, measured as the power the swipe maps to (swipeToShot: power is
 * swipe speed, calibrated per input), so it is decided by the shot inputs alone and the Skill Cup referee
 * (which receives `power`) agrees. Touch: about 2,000-3,100 CSS px/s; mouse about 2,250-3,450; trackpad
 * about 2,000-3,100. Space-bar charge: a release between about 0.81 and 0.92 s. Quick shot (power 0.7) is never perfect.
 */
export const PERFECT_BAND = [0.74, 0.84] as const;
/** A perfect penalty flies this much of its normal time (8 % quicker to the line). */
export const PERFECT_PACE = 0.92;
/** A perfect free kick is struck this much harder (launch speed x). */
export const PERFECT_FK_PACE = 1.04;
/** The aim wobble on a perfect strike is scaled by this (half the sway). */
export const PERFECT_WOBBLE = 0.5;
export const isPerfectStrike = (power: number) => Number.isFinite(power) && power >= PERFECT_BAND[0] && power <= PERFECT_BAND[1];
/** The aim wobble that actually applies to a strike of this power (tighter on a perfect strike). */
export const strikeWobble = (wobble: number, power: number) => (isPerfectStrike(power) ? wobble * PERFECT_WOBBLE : wobble);

/** Where the ball crosses the goal line, and how long it takes to get there (seconds). A perfect strike gets there quicker. */
export function shotTarget(shot: ShotInput) {
  const power = clamp(shot.power, 0, 1);
  const rise = power > OVERHIT ? (power - OVERHIT) * 4 : 0;
  return {
    x: clamp(shot.aimX, -1.6, 1.6) + clamp(shot.curl, -1, 1) * CURL_DRIFT,
    y: Math.max(0.02, clamp(shot.aimY, 0, 1.6) + rise),
    time: (0.95 - 0.55 * power) * (isPerfectStrike(power) ? PERFECT_PACE : 1),
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
  /** Arm-length multiplier (difficulty reach × boss phase); 1 = the keeper's art. */
  armScale?: number;
  /** This dive leaves a trailing leg across the middle (drawn, and it saves only what it touches). */
  leg?: boolean;
  /** Goal-x the keeper stands on before the dive (free kicks start off-centre, away from the wall); 0 when absent. */
  home?: number;
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

/** Rough keeper hand position at time t after the strike (legacy helper; saves use keeperFrame + keeperTouch). */
export function keeperAt(plan: KeeperPlan, t: number) {
  const raw = clamp((t - plan.reaction) / plan.diveTime, 0, 1);
  const progress = plan.teleport ? (raw > 0.5 ? 1 : 0) : 1 - (1 - raw) ** 2;
  return { x: plan.x * progress, y: Math.min(plan.maxY, 0.45 + (plan.y - 0.45) * progress), progress };
}

// ── Difficulty ─────────────────────────────────────────────────────────────
/**
 * A small parameter set layered on top of a keeper's personality.
 *  reaction: seconds added to the keeper's reaction (negative = sharper)
 *  reach:    multiplier on the save radius
 *  read:     added to the keeper's own read probability
 *  clock:    penalty shot clock in seconds (0 = off); free kicks add FREE_KICK_EXTRA_S (shotClockSeconds)
 *  wobble:   aim-wobble amplitude in goal units (grows with the streak)
 *  assist:   invisible aim assist strength 0 … 1 (assistShot), only on the easiest rungs
 */
export type Difficulty = Readonly<{ reaction: number; reach: number; read: number; clock: number; wobble: number; assist: number }>;
/** Identity: the keeper exactly as designed (the Skill Cup referee uses this). Its clock is the Skill Cup's: 6 s. */
export const NEUTRAL: Difficulty = { reaction: 0, reach: 1, read: 0, clock: 6, wobble: 0, assist: 0 };
/**
 * Shot clock seconds for a kick. `Difficulty.clock` is the PENALTY clock (6 s; tightening only on the hardest
 * rungs, never below 5 s); a free kick gets FREE_KICK_EXTRA_S more (8 s; never below 7 s). 0 = off.
 */
export const FREE_KICK_EXTRA_S = 2;
export const SHOT_CLOCK_MIN = { penalty: 5, freekick: 7 } as const;
export const shotClockSeconds = (difficulty: Difficulty, kind: "penalty" | "freekick" | "target") =>
  difficulty.clock <= 0 ? 0 : kind === "freekick" ? Math.max(SHOT_CLOCK_MIN.freekick, difficulty.clock + FREE_KICK_EXTRA_S) : Math.max(SHOT_CLOCK_MIN.penalty, difficulty.clock);

// ── Placement zones ───────────────────────────────────────────────────────
export type Zone = "centre" | "side" | "corner" | "bin";
/** Score multiplier by where the ball crosses the line. In off the post adds POST_IN_BONUS. */
export const ZONE_MULT: Readonly<Record<Zone, number>> = { centre: 1, side: 2, corner: 3, bin: 5 };
export const POST_IN_BONUS = 1.5;
export function shotZone(target: { x: number; y: number }): Zone {
  const ax = Math.abs(target.x);
  if (ax < 0.34) return "centre";
  if (ax >= 0.66) return target.y >= TOP_BIN_Y ? "bin" : "corner";
  return "side";
}

export type ShotOutcome = Readonly<{
  result: ShotResult;
  target: { x: number; y: number; time: number };
  plan: KeeperPlan;
  zone: Zone;
  /** Clipped the inside of the post and went in. */
  postIn: boolean;
  /** Which part of the keeper the ball hit (saves only). */
  touch?: KeeperPart;
}>;

/** Independent seeded stream for judgement calls, so the base dive plan never shifts. */
const judge = (seed: number) => prng((seed ^ 0x9e3779b9) >>> 0);

/** Applies read probability and difficulty to a plan. Pure. */
function adjustPlan(plan: KeeperPlan, profile: KeeperProfile, target: { x: number; y: number }, roll: () => number, difficulty: Difficulty): KeeperPlan {
  const leg = !plan.wall && !plan.teleport && roll() < LEG_CHANCE;
  let next: KeeperPlan = { ...plan, reaction: Math.max(0, plan.reaction + difficulty.reaction), reach: plan.reach * difficulty.reach, armScale: difficulty.reach * (profile.reach ? plan.reach / profile.reach : 1), leg };
  const read = clamp(profile.read + difficulty.read, 0, 0.95);
  // A read: the keeper guesses the right side and height. Walls and teleports already "know".
  if (!plan.wall && !plan.teleport && Math.abs(target.x) > 0.2 && roll() < read) {
    next = { ...next, x: Math.sign(target.x) * clamp(Math.abs(target.x), 0.45, 0.9), y: clamp(target.y, 0.15, 0.85) };
  }
  // BQ-P2-1: the mime (wall) and the ghost (teleport) skip the read above, so the ladder's harder rungs did not
  // touch them (the mime was flat, the ghost even got easier). They get ONLY the ladder's extra read: the mime
  // steps to your side of his wall, the ghost appears where you aimed. NEUTRAL and rungs with read ≤ 0 draw no
  // roll, so the Skill Cup referee and the easy rungs are unchanged.
  if ((plan.wall || plan.teleport) && difficulty.read > 0 && roll() < difficulty.read) {
    next = { ...next, x: clamp(target.x, -0.9, 0.9), y: clamp(target.y, 0.15, 0.85) };
  }
  return next;
}

/**
 * Resolve a shot: the keeper first, then the frame, then goal. Pure and deterministic.
 * The keeper saves ONLY if the ball touches his body, arms, gloves, trailing leg or (mime) wall at the
 * moment it crosses the line: keeperFrame(plan, target.time), the very frame the Stage draws.
 */
export function resolveShot(shot: ShotInput, profile: KeeperProfile, seed: number, context: KickContext = NO_CONTEXT, difficulty: Difficulty = NEUTRAL): ShotOutcome {
  const target = shotTarget(shot);
  const roll = judge(seed);
  const plan = adjustPlan(keeperPlan(profile, seed, target, context), profile, target, roll, difficulty);
  const zone = shotZone(target);
  const ax = Math.abs(target.x);
  const hitsPost = Math.abs(ax - 1) < BALL_RADIUS + FRAME && target.y < 1 + BALL_RADIUS;
  const hitsBar = Math.abs(target.y - 1) < BALL_RADIUS + FRAME && ax < 1 + BALL_RADIUS;
  const postRoll = roll();
  // The keeper first, for EVERY shot (BQ-P1-2): a ball the drawn keeper touches is a save, even one that
  // would have clipped the frame or crossed just wide/over. (Far from the goal the rig cannot reach: no touch.)
  const hit = keeperTouch(keeperFrame(profile.id, plan, target.time), { x: target.x, y: target.y * GOAL_ASPECT });
  if (hit) return { result: "save", target, plan, zone, postIn: false, touch: hit };
  if (hitsPost || hitsBar) {
    // Clipping the inside of the frame deflects in half the time: "in off the post".
    const postIn = ax < 1 - FRAME && target.y < 1 - FRAME && postRoll < 0.5;
    return { result: postIn ? "goal" : "post", target, plan, zone, postIn };
  }
  if (ax > 1) return { result: "wide", target, plan, zone, postIn: false };
  if (target.y > 1) return { result: "over", target, plan, zone, postIn: false };
  return { result: "goal", target, plan, zone, postIn: false };
}

/** Flight position at progress p (0 … 1), before projection. */
export function flightAt(target: { x: number; y: number }, curl: number, p: number) {
  const bow = Math.sin(Math.PI * p) * -curl * 0.35;
  return { x: target.x * p + bow, y: target.y * p * (0.6 + 0.4 * p) + Math.sin(Math.PI * p) * 0.08, depth: p };
}

/**
 * Streak multiplier on POINTS only (never RF, balls or $GBOOT): "score 3 in a row for x1.2, 5 for x1.5, 10 for x2".
 * `streak` counts this goal (the 3rd goal in a row is paid at x1.2). goalPoints is the ONLY place it is applied,
 * and the Skill Cup referee scores with goalPoints too, so the game and the referee always agree.
 */
export const STREAK_TIERS: readonly (readonly [number, number])[] = [[10, 2], [5, 1.5], [3, 1.2]];
export const STREAK_CAP = 2;
export const streakMultiplier = (streak: number) => STREAK_TIERS.find(([from]) => streak >= from)?.[1] ?? 1;

export function goalPoints(keeper: KeeperProfile, ballMult: number, streak: number, suddenDeath: boolean, zone: Zone = "centre", postIn = false) {
  return Math.round(100 * keeper.mult * ballMult * streakMultiplier(streak) * (suddenDeath ? 2 : 1) * ZONE_MULT[zone] * (postIn ? POST_IN_BONUS : 1));
}

// ── Input: one forgiving swipe ────────────────────────────────────────────
export type SwipePoint = Readonly<{ x: number; y: number; t: number }>;
/** Release window: the last ~100 ms before lift-off are averaged for the aim (80–120 ms allowed). */
export const RELEASE_BUFFER_MS = 100;
export type InputKind = "touch" | "mouse" | "trackpad";
/**
 * Speed calibration per input, CSS px per second: [slow → power 0.35, fast → power OVERHIT, huge → power 1].
 * Every normal flick (150–300 CSS px in ≥ 100 ms) stays at or under `fast`, so only a truly huge
 * overhit (power > OVERHIT) can rise over the bar. Pace eases in (square root) so a relaxed flick still has zip.
 */
export const SPEED_CALIBRATION: Readonly<Record<InputKind, readonly [number, number, number]>> = {
  touch: [250, 3800, 6000], mouse: [500, 4200, 7000], trackpad: [300, 3800, 6500],
};
/** Curl needs intent: a path bend under this fraction of its length is ignored (natural thumb arcs). */
export const CURL_DEAD_ZONE = 0.12;
/**
 * Height from the swipe's upward travel in CSS px (the same on every display): up to AIM_LIFT_CSS[0]
 * stays on the grass, AIM_LIFT_CSS[1] reaches AIM_CEILING, and any extra length adds only pace.
 * AIM_CEILING sits under the bar (ball radius + frame), so no swipe aim alone can clear it.
 */
export const AIM_LIFT_CSS = [60, 280] as const;
export const AIM_CEILING = 0.9;
/** Swipe angle from vertical (degrees) that aims at a post: 0° is the middle of the goal. */
export const AIM_POST_DEG = 45;
/** Shorter upward travel than this (CSS px) is a tap, not a kick. */
export const MIN_SWIPE_CSS = 12;

export type SwipeOptions = {
  width: number; height: number;
  /**
   * CSS px per canvas unit (display scale). Pointer coordinates are CSS px, so devicePixelRatio does
   * not enter; lengths and speeds are measured in CSS px and mean the same on a phone and a desktop.
   */
  pxPerUnit?: number;
  input?: InputKind;
  /** Screen geometry of the goal face and the ball, in the same units as the points (sets which direction is "at the goal"). */
  goal?: { cx: number; line: number; unitX: number; unitY: number };
  ball?: { x: number; y: number };
  bufferMs?: number;
};
const DEFAULT_GOAL = { cx: 240, line: 176, unitX: 90, unitY: 80 }, DEFAULT_BALL = { x: 240, y: 220 };

/**
 * The finger's release point, de-jittered: a least-squares line through the last `window` ms of
 * samples, evaluated at lift-off (unbiased at any speed), blended 50/50 with the raw last sample so a
 * skidding lift-off moves the aim only half as far.
 */
export function releasePoint(points: readonly SwipePoint[], window = RELEASE_BUFFER_MS) {
  const last = points[points.length - 1];
  const recent = points.filter(point => last.t - point.t <= window);
  if (recent.length < 3) return { x: last.x, y: last.y };
  const n = recent.length, mt = recent.reduce((s, p) => s + p.t, 0) / n, mx = recent.reduce((s, p) => s + p.x, 0) / n, my = recent.reduce((s, p) => s + p.y, 0) / n;
  const vt = recent.reduce((s, p) => s + (p.t - mt) ** 2, 0) || 1;
  const bx = recent.reduce((s, p) => s + (p.t - mt) * (p.x - mx), 0) / vt, by = recent.reduce((s, p) => s + (p.t - mt) * (p.y - my), 0) / vt;
  const fit = { x: mx + bx * (last.t - mt), y: my + by * (last.t - mt) };
  return { x: 0.5 * fit.x + 0.5 * last.x, y: 0.5 * fit.y + 0.5 * last.y };
}

/**
 * The aim point on the goal face for a swipe so far, the same on every display:
 *  - HEIGHT from the upward travel in CSS px: AIM_LIFT_CSS[0] or less stays on the grass,
 *    AIM_LIFT_CSS[1] reaches AIM_CEILING (under the bar); extra length only adds pace.
 *  - ACROSS from the swipe's DIRECTION alone: towards the goal's centre on screen (straight up for a
 *    penalty) is the middle of the goal, AIM_POST_DEG either side of that is the post. Length never moves the aim sideways, so a long flick cannot drift wide.
 * The reticle shows the result live (WYSIWYG), so the player steers by what they see.
 */
export function swipeAim(points: readonly SwipePoint[], options: SwipeOptions) {
  const goal = options.goal ?? DEFAULT_GOAL, ball = options.ball ?? DEFAULT_BALL, px = options.pxPerUnit ?? 1;
  const first = points[0];
  const window = clamp(options.bufferMs ?? RELEASE_BUFFER_MS, 80, 120);
  const release = releasePoint(points, window);
  const dx = (release.x - first.x) * px, up = (first.y - release.y) * px; // CSS px
  const [lo, hi] = AIM_LIFT_CSS;
  const aimY = AIM_CEILING * clamp((up - lo) / (hi - lo), 0, 1);
  const centre = Math.atan2(goal.cx - ball.x, Math.max(1, ball.y - goal.line));
  const angle = (Math.atan2(dx, Math.max(up, MIN_SWIPE_CSS)) - centre) * (180 / Math.PI);
  return { aimX: angle / AIM_POST_DEG, aimY };
}

/**
 * Turns a swipe (points in canvas units, t in ms) into a shot. The swipe's direction and upward
 * travel in CSS px set the aim (swipeAim); swipe SPEED in CSS px/s sets pace, calibrated per input; a
 * deliberate bend (beyond the dead-zone) sets curl. Returns null for a tap or a downward swipe.
 */
export function swipeToShot(points: readonly SwipePoint[], options: SwipeOptions): ShotInput | null {
  if (points.length < 2) return null;
  const px = options.pxPerUnit ?? 1;
  const first = points[0], last = points[points.length - 1];
  if ((first.y - last.y) * px < MIN_SWIPE_CSS) return null;
  const { aimX, aimY } = swipeAim(points, options);
  // Pace: path length in CSS px over the swipe's duration.
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const speed = (length * px) / Math.max(0.03, (last.t - first.t) / 1000);
  const [slow, fast, huge] = SPEED_CALIBRATION[options.input ?? "touch"];
  const power = speed <= fast
    ? 0.35 + (OVERHIT - 0.35) * Math.sqrt(clamp((speed - slow) / (fast - slow), 0, 1))
    : OVERHIT + (1 - OVERHIT) * clamp((speed - fast) / (huge - fast), 0, 1);
  // Curl: the largest signed deviation of the path from its chord (start → smoothed release), as a fraction of the chord.
  const end = releasePoint(points, options.bufferMs ?? RELEASE_BUFFER_MS);
  const dx = end.x - first.x, dy = end.y - first.y, chord = Math.hypot(dx, dy) || 1;
  let bow = 0;
  for (const point of points.slice(0, -1)) { const cross = ((point.x - first.x) * dy - (point.y - first.y) * dx) / chord; if (Math.abs(cross) > Math.abs(bow)) bow = cross; }
  const bend = Math.abs(bow) / chord;
  const curl = bend < CURL_DEAD_ZONE ? 0 : Math.sign(bow) * clamp((bend - CURL_DEAD_ZONE) / 0.2, 0, 1);
  return { aimX: clamp(aimX, -1.6, 1.6), aimY: clamp(aimY, 0, 1.6), power, curl };
}

/** Aim assist (tutorial, first matches, Park): pulls the aim towards a zone centre and keeps power below an overhit. */
export function assistShot(shot: ShotInput, strength: number): ShotInput {
  const k = clamp(strength, 0, 1);
  if (k === 0) return shot;
  const anchorsX = [-0.8, -0.5, 0, 0.5, 0.8], anchorsY = [0.25, 0.75];
  const near = (value: number, list: number[]) => list.reduce((best, x) => (Math.abs(x - value) < Math.abs(best - value) ? x : best), list[0]);
  return {
    ...shot,
    aimX: shot.aimX + (near(shot.aimX, anchorsX) - shot.aimX) * 0.6 * k,
    aimY: shot.aimY + (clamp(shot.aimY, 0.1, 0.9) - shot.aimY) * k,
    power: shot.power + (Math.min(shot.power, OVERHIT - 0.02) - shot.power) * k,
  };
}

/** Aim wobble at release time t (seconds): a smooth, readable sway you learn to time. */
export function aimWobble(t: number, amplitude: number) {
  return amplitude * (0.6 * Math.sin(t * 2.1) + 0.4 * Math.sin(t * 3.7 + 1));
}
/**
 * The shot that is actually taken: the raw gesture, shifted by the wobble at that instant, then aim
 * assist. The reticle (while aiming) and the kick (at release) BOTH use this, so what you see is
 * where it goes.
 */
export function aimedShot(raw: ShotInput, wobble: number, assist: number): ShotInput {
  return assistShot({ ...raw, aimX: raw.aimX + strikeWobble(wobble, raw.power) }, assist);
}
/** Where the reticle is drawn: the landing point of aimedShot (curl drift and any overhit rise included). */
export const reticleTarget = (raw: ShotInput, wobble: number, assist: number) => shotTarget(aimedShot(raw, wobble, assist));
/** Pressure: wobble grows with the streak (capped). */
export const wobbleFor = (difficulty: Difficulty, streak: number) => difficulty.wobble * (1 + 0.2 * Math.min(5, Math.max(0, streak)));

// ── Invisible dynamic difficulty ──────────────────────────────────────────
/** Easiest → hardest. Chosen so every bot skill profile settles at ~55–65 % goals (docs/DIFFICULTY.md). */
export const DIFFICULTY_LADDER: readonly Difficulty[] = [
  { reaction: 0.3, reach: 0.55, read: -0.3, clock: 6, wobble: 0, assist: 0.9 },
  { reaction: 0.22, reach: 0.65, read: -0.2, clock: 6, wobble: 0.02, assist: 0.6 },
  { reaction: 0.15, reach: 0.75, read: -0.1, clock: 6, wobble: 0.04, assist: 0.3 },
  { reaction: 0.08, reach: 0.85, read: 0, clock: 6, wobble: 0.06, assist: 0 },
  { reaction: 0.03, reach: 0.95, read: 0.05, clock: 6, wobble: 0.08, assist: 0 },
  { reaction: 0, reach: 1, read: 0.1, clock: 6, wobble: 0.1, assist: 0 },
  { reaction: -0.03, reach: 1.1, read: 0.2, clock: 5.5, wobble: 0.12, assist: 0 },
  { reaction: -0.06, reach: 1.2, read: 0.3, clock: 5, wobble: 0.14, assist: 0 },
  { reaction: -0.1, reach: 1.3, read: 0.4, clock: 5, wobble: 0.16, assist: 0 },
];
export const TARGET_BAND = [0.55, 0.65] as const;
export type ShotRecord = Readonly<{ goal: boolean; zone: Zone }>;

/**
 * Called ONLY between rounds (never mid-shot). Looks at the last 10 shots and moves at most one
 * rung: above the band → harder, below → easier. Needs 5 shots of evidence.
 */
export function nextDifficultyLevel(level: number, history: readonly ShotRecord[]): number {
  const recent = history.slice(-10);
  if (recent.length < 5) return clamp(level, 0, DIFFICULTY_LADDER.length - 1);
  const rate = recent.filter(shot => shot.goal).length / recent.length;
  const step = rate > TARGET_BAND[1] ? 1 : rate < TARGET_BAND[0] ? -1 : 0;
  return clamp(level + step, 0, DIFFICULTY_LADDER.length - 1);
}
export * from "./freekick.ts";
export * from "./keeper-rig.ts";
