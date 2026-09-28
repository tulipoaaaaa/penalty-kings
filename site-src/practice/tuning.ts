/**
 * Free practice tuning: the ONLY place the practice page's difficulty lives. Pure (no DOM), so
 * tests/game/practice-tuning.test.ts can play thousands of seeded five-kick rounds with the same calls.
 *
 * Owner brief: "naive swipes must not score 5/5. Aim for about 3/5 for a careless player; keep it welcoming."
 * The game's shared tables (the engine's keepers and DIFFICULTY_LADDER, the Director's rotation) are NOT
 * touched (nor any keeper's profile: the mouse still cannot get above his maxY). Practice layers its own rules on
 * a copy of the game's easiest rung:
 *   1. HOLD: on a shot through the middle (|x| < holdBand) the keeper sometimes stays home and springs at the
 *      ball instead of diving for a corner (holdChance; a seeded roll from its own stream, so the engine's dive
 *      plan and judgement rolls never shift). He only saves what the drawn rig really touches (keeperFrame +
 *      keeperTouch), and the Stage draws that exact plan, so every save is visible.
 *   2. A keeper who reacts a touch later than rung 0 (reaction +0.4 s instead of +0.3 s), so aimed corners are
 *      rewarded more than in the game's first rung.
 *   3. Aim assist 0.6 instead of 0.9: a lighter pull to the zone anchors (it still keeps power under an overhit mostly).
 * Measured (tests/game/practice-tuning.test.ts, PK_PRACTICE_REPORT=1): careless ~60 % (about 3 of 5; 2+ goals in
 * ~90 % of rounds), casual ~72 %, corner-aiming ~94 %. Before: every profile ~81-84 %, centre blasting 5/5 often.
 */
import {
  aimedShot, clamp, keeperById, keeperFrame, keeperTouch, prng, resolveShot, DIFFICULTY_LADDER, GOAL_ASPECT,
  type Difficulty, type KeeperId, type ShotInput, type ShotOutcome,
} from "@penalty-kings/engine";

export type PracticeTuning = Readonly<{
  /** The difficulty layered on the keepers (reaction, reach, read, wobble, assist). No shot clock in practice. */
  difficulty: Difficulty;
  /** |x| under this (goal units, posts at ±1) is "through the middle" for the hold rule. */
  holdBand: number;
  /** Chance the keeper stays up for a shot through the middle (0 = always dives, as in the game). */
  holdChance: number;
}>;

/** Before this change: the game's easiest rung, no hold. Kept for the simulation's before/after table. */
export const BASELINE_TUNING: PracticeTuning = { difficulty: { ...DIFFICULTY_LADDER[0], clock: 0 }, holdBand: 0, holdChance: 0 };

/** The practice page's tuning (see the header; numbers from tests/game/practice-tuning.test.ts). */
export const PRACTICE_TUNING: PracticeTuning = {
  difficulty: { ...DIFFICULTY_LADDER[0], clock: 0, assist: 0.6, reaction: 0.4 },
  holdBand: 0.34,
  holdChance: 0.3,
};

/** Seed salt for the hold roll: its own stream, independent of the engine's dive and judgement rolls. */
const HOLD_SALT = 0x5eed_c0de;
/** The smallest hop off centre (goal units): keeperFrame draws a plan within 0.12 of home as an upright block. */
const HOP = 0.13;

export type PracticeKick = Readonly<{ shot: ShotInput; outcome: ShotOutcome; held: boolean }>;

/**
 * One practice kick: the raw gesture → the aimed shot (wobble + assist, what the reticle shows) → the engine's
 * resolveShot, then the practice hold rule. Deterministic in (raw, wobble, keeper, seed, index, history).
 */
export function practiceKick(raw: ShotInput, wobble: number, keeper: KeeperId, seed: number, index: number, history: readonly number[], tuning: PracticeTuning = PRACTICE_TUNING): PracticeKick {
  const shot = aimedShot(raw, wobble, tuning.difficulty.assist);
  const profile = keeperById(keeper);
  const outcome = resolveShot(shot, profile, seed, { kickIndex: index, history }, tuning.difficulty);
  const target = outcome.target;
  if (outcome.result !== "goal" || Math.abs(target.x) >= tuning.holdBand || outcome.plan.teleport || outcome.plan.wall) return { shot, outcome, held: false };
  const roll = prng((seed ^ HOLD_SALT) >>> 0);
  if (roll() >= tuning.holdChance) return { shot, outcome, held: false };
  // He stays home and springs at the ball: a short hop towards it (at least HOP off centre, so keeperFrame draws a
  // stretch, not an upright block whose arms stop at chest height). His own maxY still caps how high he gets.
  const side = target.x > 0.02 ? 1 : target.x < -0.02 ? -1 : roll() < 0.5 ? -1 : 1;
  const plan = { ...outcome.plan, x: side * Math.max(HOP, Math.abs(target.x)), y: clamp(target.y, 0.1, 0.95), leg: false, lean: 0 };
  const touch = keeperTouch(keeperFrame(profile.id, plan, target.time), { x: target.x, y: target.y * GOAL_ASPECT });
  if (!touch) return { shot, outcome, held: false };
  return { shot, outcome: { ...outcome, result: "save", plan, postIn: false, hitPost: false, hitBar: false, touch }, held: true };
}

/** A short, friendly tip after a kick that did not go in (empty after a goal). */
export function missHint(result: ShotOutcome["result"], x: number): string {
  if (result === "goal") return "";
  if (result === "save") return Math.abs(x) < 0.34 ? "Tip: aim for a corner, the keeper covers the middle." : "Tip: so close. Try the other corner, or go higher.";
  if (result === "over") return "Tip: a gentler flick keeps it under the bar.";
  if (result === "wide") return "Tip: a little less angle keeps it inside the post.";
  return "Tip: just inside the post is the sweet spot.";
}
