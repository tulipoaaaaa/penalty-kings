/**
 * The free-kick keeper (owner playtest C1c): a motion model INSIDE the engine, so the save test and the
 * drawing use the very same frame (freeKickKeeperFrame → keeperFrame rig → keeperTouch).
 *
 *   1. Set: he stands on his side of the wall (home), then takes 1–3 shuffle steps off his post as the
 *      kick is taken (≈0.26 m each, ≈2.9 m/s peak), and is set at the strike.
 *   2. Read: he picks up the flight `commit` s after the strike (later when the wall screens it; a
 *      knuckleball or a poor reader misjudges where it will cross).
 *   3. Cross-steps: if the ball is beyond one dive, he steps across first (≤ 4.5 m/s) while there is time.
 *   4. ONE explosive dive, timed to arrive at the crossing: a trapezoid lateral-speed profile capped at
 *      his personal speed (≤ FK_KEEPER_SPEED_CAP = 6 m/s), 0.35–0.5 s in the air, so the gloves reach
 *      ≈2.5–2.8 m from where he took off. A ball further away than that, or one that arrives before
 *      the dive does, beats him: saves come from positioning and timing, never from teleport speed.
 *   A ball over his head (high and close) is a backpedal and an upward leap to tip it over the bar.
 *
 * Personality modifiers: Squeak is quick (6 m/s) but short, Nibbles commits early and guesses more,
 * Snooze dives slowly on endlessly long arms, Big Bento is slow across the goal, and so on.
 */
import type { KeeperId, KeeperPlan, KeeperProfile, Difficulty } from "./index.ts";
import { keeperFrame, LEG_CHANCE, type KeeperFrame } from "./keeper-rig.ts";

/** Metres per goal unit (half the goal width). */
const UNIT = 3.66;
/** No keeper, at any difficulty, ever moves his body sideways faster than this (m/s). */
export const FK_KEEPER_SPEED_CAP = 6;
/** Dive airtime range (s) and the trapezoid profile: 30 % push-off, 20 % landing (peak = 4/3 × mean speed). */
export const FK_AIR_MIN = 0.35, FK_AIR_MAX = 0.5;
const PUSH = 0.3, LAND = 0.2, PEAK = 1 / (1 - PUSH / 2 - LAND / 2);
/** Cross-step peak speed (m/s) and the pre-kick shuffle: step length (units) and duration (s). */
const STEP_PEAK = 4.5, SHUFFLE_STEP = 0.07;
/** Seconds per pre-kick shuffle step (the steps end at the strike). */
export const FK_SHUFFLE_TIME = 0.14;
const SHUFFLE_TIME = FK_SHUFFLE_TIME;
/** Seconds after the strike a keeper picks up an unscreened free kick (before personality and difficulty). */
const READ_TIME = 0.2, SCREEN_DELAY = 0.12;
/** Seconds of watching the flight at which his misjudgement is 'normal' (less time: worse, more: better). */
const WATCH = 0.65;

type Personality = Readonly<{ speed: number; early?: number; guess?: number }>;
/** Dive speed (m/s) and quirks per keeper. early: seconds sooner he commits; guess: × misjudgement. */
export const FK_KEEPER_STYLE: Readonly<Record<KeeperId, Personality>> = {
  mouse: { speed: 6 },
  squirrel: { speed: 5.8, early: 0.1, guess: 1.5 },
  sloth: { speed: 4.2 },
  peacock: { speed: 5.5, guess: 1.2 },
  octopus: { speed: 5 },
  mime: { speed: 5 },
  disco: { speed: 5.5 },
  sumo: { speed: 4.4 },
  chameleon: { speed: 5.5 },
  robot: { speed: 5.6, guess: 0.9 },
  ghost: { speed: 5.6 },
  finalwall: { speed: 6, guess: 0.8 },
};

export type FreeKickKeeper = Readonly<{
  /** Where he stands for the wall, goal x. */
  home: number;
  /** Pre-kick shuffle: number of steps and their direction (+1 / −1); the steps end at the strike (t = 0). */
  steps: number; stepDir: number;
  /** Where he is set at the strike, goal x. */
  set: number;
  /** When he reads the flight (s after the strike). */
  commit: number;
  /** Cross-steps after the read: to `stepTo` by `stepEnd` (stepEnd = commit when there are none). */
  stepTo: number; stepEnd: number;
  /** The dive: starts at plan.reaction, lasts plan.diveTime, from plan.home (= stepTo) to the glove point (plan.x, plan.y). */
  plan: KeeperPlan;
  /** Whether he dives at all (a ball blocked by the wall: he stays set). */
  dives: boolean;
  /** An upward leap to tip a ball over the bar. */
  tip: boolean;
  /** His lateral speed cap (m/s). */
  speed: number;
}>;

export type FreeKickKeeperContext = Readonly<{
  /** The side the wall covers (+1 / −1): he stands on the other side. */
  side: number;
  /** Where and when the ball crosses the line (goal units, s). */
  target: { x: number; y: number; time: number };
  knuckle: boolean; screened: boolean; blocked: boolean;
  seed: number;
}>;

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());

/** Dive progress 0 … 1 at time fraction s: accelerate (push), constant, decelerate (land). Speed ≤ PEAK / T. */
export function diveProgress(s: number) {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  if (s < PUSH) return (PEAK * s * s) / (2 * PUSH);
  if (s <= 1 - LAND) return PEAK * (PUSH / 2 + (s - PUSH));
  return 1 - (PEAK * (1 - s) * (1 - s)) / (2 * LAND);
}

/** Body x at the end of a dive from `home` towards the glove point (the rig decides how far the body travels). */
const bodyEnd = (id: KeeperId, plan: KeeperPlan) => keeperFrame(id, { ...plan, reaction: 0, diveTime: 1 }, 2).x;

export function planFreeKickKeeper(keeper: KeeperProfile, difficulty: Difficulty, ctx: FreeKickKeeperContext): FreeKickKeeper {
  const random = rng(ctx.seed), style = FK_KEEPER_STYLE[keeper.id];
  const speed = Math.min(FK_KEEPER_SPEED_CAP, style.speed);
  // 1. Set: home on his side of the wall, 1–3 shuffle steps towards the middle as the kick is taken.
  const home = -ctx.side * 0.3, steps = 1 + Math.floor(random() * 3), stepDir = ctx.side;
  const set = home + stepDir * steps * SHUFFLE_STEP;
  // 2. Read: when, and how well (a Gaussian misjudgement of the crossing point).
  const commit = Math.max(0.08, READ_TIME + keeper.reaction * 0.5 + difficulty.reaction + (ctx.screened ? SCREEN_DELAY : 0) - (style.early ?? 0));
  const read = clamp(keeper.read + difficulty.read, 0, 0.95);
  // The longer he watches it before it arrives, the better he judges it (a long-range shot is read, a close one is a snap).
  const watch = clamp(WATCH / Math.max(0.05, ctx.target.time - commit), 0.5, 1.6);
  const sigma = (0.06 + 0.22 * (1 - read)) * watch * (ctx.screened ? 1.25 : 1) * (ctx.knuckle ? 2.2 : 1) * (style.guess ?? 1);
  const guessX = clamp(ctx.target.x + gauss(random) * sigma, -1.08, 1.08);
  const guessY = clamp(ctx.target.y + gauss(random) * sigma * 0.6, 0.06, Math.min(keeper.maxY, 1.02));
  const leg = random() < LEG_CHANCE;
  const base: KeeperPlan = { x: guessX, y: guessY, lean: 0, home: set, reaction: 99, diveTime: FK_AIR_MAX, reach: keeper.reach * difficulty.reach, body: keeper.body, maxY: keeper.maxY, armScale: difficulty.reach, leg };
  if (ctx.blocked) return { home, steps, stepDir, set, commit, stepTo: set, stepEnd: commit, plan: base, dives: false, tip: false, speed };

  // A ball over his head (high, close): backpedal a touch and leap up to tip it over.
  const tip = guessY > 0.78 && Math.abs(guessX - set) < 0.3;
  let aimX = guessX;
  if (tip && Math.abs(aimX - set) < 0.14) aimX = set + (aimX >= set ? 1 : -1) * 0.14;
  const plan = (from: number, x: number): KeeperPlan => ({ ...base, x, home: from, leg: tip ? false : leg });
  const stepMean = Math.min(STEP_PEAK, speed * 0.8) / (Math.PI / 2); // cross-steps: a (1 − cos) ease, peak = π/2 × mean
  const oneDive = (speed * FK_AIR_MAX) / PEAK / UNIT; // furthest body travel in one dive, goal units
  const needed = bodyEnd(keeper.id, plan(set, aimX)) - set, dir = Math.sign(needed) || 1;
  const latest = ctx.target.time - FK_AIR_MAX;
  let stepTo = set, stepEnd = commit, x = aimX;
  if (Math.abs(needed) > oneDive) {
    // 3. Cross-steps first, as far as the time allows; the dive then covers the rest (or falls short).
    const want = Math.abs(needed) - oneDive, time = Math.max(0, Math.min((want * UNIT) / stepMean, latest - commit));
    stepTo = set + dir * (time * stepMean) / UNIT; stepEnd = commit + time;
    // Still out of reach: dive at full stretch towards it (the gloves stop short).
    const rest = bodyEnd(keeper.id, plan(stepTo, aimX)) - stepTo;
    if (Math.abs(rest) > oneDive) {
      let lo = 0, hi = 1; // fraction of the way to the ball the full-stretch dive reaches
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (Math.abs(bodyEnd(keeper.id, plan(stepTo, stepTo + (aimX - stepTo) * mid)) - stepTo) > oneDive) hi = mid; else lo = mid; }
      x = stepTo + (aimX - stepTo) * lo;
    }
  }
  // 4. One dive, timed to land on the crossing (or as soon as he can when late), never faster than his cap.
  const travel = Math.abs(bodyEnd(keeper.id, plan(stepTo, x)) - stepTo) * UNIT;
  const diveTime = clamp((travel * PEAK) / speed, FK_AIR_MIN, FK_AIR_MAX);
  const diveAt = Math.max(stepEnd, ctx.target.time - diveTime);
  return { home, steps, stepDir, set, commit, stepTo, stepEnd, plan: { ...plan(stepTo, x), reaction: diveAt, diveTime }, dives: true, tip, speed };
}

/** The keeper's body x before the dive: the pre-kick shuffle, set, then the cross-steps. */
export function freeKickKeeperX(motion: FreeKickKeeper, t: number) {
  const start = -motion.steps * SHUFFLE_TIME;
  if (t <= start) return motion.home;
  if (t < 0) {
    const k = (t - start) / SHUFFLE_TIME, i = Math.floor(k), f = k - i;
    return motion.home + motion.stepDir * SHUFFLE_STEP * (i + (1 - Math.cos(Math.PI * f)) / 2);
  }
  if (t <= motion.commit || motion.stepEnd <= motion.commit) return t <= motion.commit ? motion.set : motion.stepTo;
  const u = clamp((t - motion.commit) / (motion.stepEnd - motion.commit), 0, 1);
  return motion.set + (motion.stepTo - motion.set) * (1 - Math.cos(Math.PI * u)) / 2;
}

/**
 * The free-kick keeper at time t after the strike (t < 0: the run-up shuffle). Pure and deterministic:
 * resolveFreeKick tests the ball against this frame, the Stage draws it.
 */
export function freeKickKeeperFrame(id: KeeperId, motion: FreeKickKeeper, t: number): KeeperFrame {
  const plan = motion.plan;
  if (!motion.dives || t < plan.reaction) return keeperFrame(id, { ...plan, home: freeKickKeeperX(motion, t), reaction: 99 }, 0);
  // keeperFrame eases progress as 1 − (1 − raw)²; feed it the raw time that gives the trapezoid progress.
  const q = diveProgress((t - plan.reaction) / plan.diveTime), raw = 1 - Math.sqrt(Math.max(0, 1 - q));
  return keeperFrame(id, plan, plan.reaction + raw * plan.diveTime);
}
