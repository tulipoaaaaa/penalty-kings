/**
 * World Tour "points" objectives vs the streak curve (C2). Deterministic: every kick sequence of a level is
 * enumerated under a fixed "good player" model, and the session is scored exactly as the shell scores a tour
 * penalty (engine goalPoints with the level's keeper, zone and post-in; Skill Zone goals step the scoring
 * streak by 2, game/rewards.ts streakAfter; no Golden Hour in the tour).
 *
 * Good player (the difficulty band's centre): each kick scores 60 % of the time; a goal is a side goal 40 %,
 * a corner 40 %, a top bin 12 %, in off the post (a corner) 8 %.
 */
import { keeperById, streakMultiplier, ZONE_MULT, POST_IN_BONUS, type KeeperProfile, type Zone } from "../../packages/engine/src/index.ts";
import { streakAfter, skillZoneOf } from "../../games/penalty-kings/game/rewards.ts";

export type Curve = "old" | "new";
/** The streak curve before C2: x1 / x1.5 / x2 … capped at x3 (streak counts this goal). */
export const oldStreakMultiplier = (streak: number) => Math.min(3, 1 + 0.5 * Math.max(0, streak - 1));
const mult = (curve: Curve, streak: number) => (curve === "old" ? oldStreakMultiplier(streak) : streakMultiplier(streak));

type Kick = { goal: false } | { goal: true; zone: Zone; postIn: boolean };
export const GOOD_PLAYER: readonly { p: number; kick: Kick }[] = [
  { p: 0.4, kick: { goal: false } },
  { p: 0.6 * 0.4, kick: { goal: true, zone: "side", postIn: false } },
  { p: 0.6 * 0.4, kick: { goal: true, zone: "corner", postIn: false } },
  { p: 0.6 * 0.12, kick: { goal: true, zone: "bin", postIn: false } },
  { p: 0.6 * 0.08, kick: { goal: true, zone: "corner", postIn: true } },
];

/** One kick's points: the engine's goalPoints formula (ball x1, no sudden death) at streak + 1, with the old or new curve. */
export function kickPoints(keeper: KeeperProfile, streak: number, kick: Kick, curve: Curve) {
  if (!kick.goal) return 0;
  return Math.round(100 * keeper.mult * mult(curve, streak + 1) * ZONE_MULT[kick.zone] * (kick.postIn ? POST_IN_BONUS : 1));
}
const nextStreak = (streak: number, kick: Kick) => (kick.goal ? streakAfter(streak, skillZoneOf({ goal: true, zone: kick.zone, postIn: kick.postIn })) : 0);

/** Score of a fixed kick sequence. */
export function sessionPoints(keeperId: Parameters<typeof keeperById>[0], kicks: readonly Kick[], curve: Curve) {
  const keeper = keeperById(keeperId);
  let streak = 0, points = 0;
  for (const kick of kicks) { points += kickPoints(keeper, streak, kick, curve); streak = nextStreak(streak, kick); }
  return points;
}

/** The most a level can score: every kick a top bin in off the post (x5 x1.5, a Skill Zone each). */
export const maxPoints = (keeperId: Parameters<typeof keeperById>[0], kicks: number, curve: Curve) =>
  sessionPoints(keeperId, Array.from({ length: kicks }, () => ({ goal: true, zone: "bin" as Zone, postIn: true })), curve);

/** A plain 3-goal session: three side goals in a row, then misses. */
export const threeGoalPoints = (keeperId: Parameters<typeof keeperById>[0], kicks: number, curve: Curve) =>
  sessionPoints(keeperId, Array.from({ length: kicks }, (_, i) => (i < 3 ? { goal: true, zone: "side" as Zone, postIn: false } : { goal: false as const })), curve);

/** A strong player (who chases 3 stars): 80 % goals; side 20 %, corner 45 %, top bin 25 %, in off the post 10 %. */
export const STRONG_PLAYER: readonly { p: number; kick: Kick }[] = [
  { p: 0.2, kick: { goal: false } },
  { p: 0.8 * 0.2, kick: { goal: true, zone: "side", postIn: false } },
  { p: 0.8 * 0.45, kick: { goal: true, zone: "corner", postIn: false } },
  { p: 0.8 * 0.25, kick: { goal: true, zone: "bin", postIn: false } },
  { p: 0.8 * 0.1, kick: { goal: true, zone: "corner", postIn: true } },
];

/** Expected points and P(points >= threshold) for a player model (exact enumeration). */
export function goodPlayer(keeperId: Parameters<typeof keeperById>[0], kicks: number, curve: Curve, threshold = Infinity, model: readonly { p: number; kick: Kick }[] = GOOD_PLAYER) {
  const keeper = keeperById(keeperId);
  let expected = 0, reach = 0;
  const walk = (i: number, streak: number, points: number, p: number) => {
    if (i === kicks) { expected += p * points; if (points >= threshold) reach += p; return; }
    for (const branch of model) walk(i + 1, nextStreak(streak, branch.kick), points + kickPoints(keeper, streak, branch.kick, curve), p * branch.p);
  };
  walk(0, 0, 0, 1);
  return { expected, reach };
}

/** A clean threshold: nearest 250 under 5,000, nearest 500 from there. */
export const clean = (value: number) => { const step = value < 5000 ? 250 : 500; return Math.max(step, Math.round(value / step) * step); };

/**
 * The new-curve threshold with the same relative difficulty as `old`: the clean threshold whose chance of being
 * reached under the new curve is CLOSEST to the chance `old` had under the old curve (quantile matching for
 * `model`, the strong player who chases 3 stars); a tie goes to the lower, easier threshold.
 */
export function rescale(keeperId: Parameters<typeof keeperById>[0], kicks: number, old: number, model: readonly { p: number; kick: Kick }[] = STRONG_PLAYER) {
  const target = goodPlayer(keeperId, kicks, "old", old, model).reach;
  let best = 250, gap = Infinity;
  for (let t = 250; t <= old; t += 250) {
    if (clean(t) !== t) continue;
    const d = Math.abs(goodPlayer(keeperId, kicks, "new", t, model).reach - target);
    if (d < gap - 1e-12) { gap = d; best = t; }
  }
  return best;
}
