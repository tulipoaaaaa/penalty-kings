/**
 * The NEXT GOAL on the modes screen (round 6 D20): always one concrete thing to do next, in priority order.
 * Progression only (XP, stamps, stars): it never points at buying anything.
 */
import { keeperById } from "@penalty-kings/engine";
import { MODES, LADDER, levelFromXp, nextRung, type ModeId, type Progress } from "./progress.js";
import { DAILY_ATTEMPTS, dailyState } from "./daily.js";
import { nextLevel } from "./tour.js";
import type { Level } from "./objectives.js";

export type NextGoal = Readonly<{ text: string; mode: ModeId }>;

export function nextGoal(progress: Progress, levels: readonly Level[], today: string): NextGoal {
  const { level, into, next } = levelFromXp(progress.xp);
  // 1. The next mode to unlock (free modes only; Big Match is open from the start and never a goal).
  const locked = MODES.filter(mode => !mode.paid && mode.level > level).sort((a, b) => a.level - b.level)[0];
  if (locked) return { text: `${next - into} XP to level ${locked.level}: unlocks ${MODES.filter(mode => mode.level === locked.level && !mode.paid).map(mode => mode.name).join(", ")}`, mode: "penalties" };
  // 2. Today's Daily Challenge, while attempts are left.
  const daily = dailyState(progress.daily, today);
  if (daily.attempts < DAILY_ATTEMPTS) return { text: `Daily Challenge: ${DAILY_ATTEMPTS - daily.attempts} attempt${DAILY_ATTEMPTS - daily.attempts === 1 ? "" : "s"} left today`, mode: "daily" };
  // 3. The next keeper on the ladder to stamp in the Scouting Book.
  if (progress.stamps.length < LADDER.length) return { text: `Beat ${keeperById(nextRung(progress)).name} (3 goals in a round) for Scouting Book stamp ${progress.stamps.length + 1}/${LADDER.length}`, mode: "penalties" };
  // 4. The next World Tour level short of 3 stars.
  const tour = nextLevel(levels, progress);
  if (tour) return { text: `World Tour: ${tour.name} (${progress.stars[tour.id] ?? 0}/3 stars)`, mode: "tour" };
  // 5. Everything done: chase personal bests.
  return { text: `Beat your Target Practice best: ${progress.best.target}`, mode: "target" };
}
