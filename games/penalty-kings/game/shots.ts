/**
 * C2 "Shots that feel amazing": the game-side helpers for the PERFECT strike, streaks, the instant replay and
 * the shot clock. The RULES live in the shared engine (@penalty-kings/engine: isPerfectStrike, streakMultiplier,
 * shotClockSeconds), so the Skill Cup referee decides every kick exactly as the game does. Skill layer only:
 * nothing here touches RF, balls or $GBOOT.
 */
import { shotClockSeconds, type Difficulty } from "@penalty-kings/engine";
import type { KickRecord } from "./objectives.js";
import type { Progress } from "./progress.js";

/** Owner rule: every idea is one sentence a new player understands (shown in the Rules and the Scouting Book). */
export const SHOT_RULES = {
  perfect: "Flick at just the right speed, firm but not wild, for a PERFECT strike: a quicker ball and a steadier aim.",
  streak: "Goals in a row multiply your points: x1.2 from 3, x1.5 from 5 and x2 from 10 (a Skill Zone goal counts twice).",
  replay: "Great goals (top bins, in off the post, 28 m+ screamers, PERFECT strikes) get a 1.5 s slow-mo replay; tap to skip it.",
  clock: "After your first 3 matches a shot clock gives you 6 s for a penalty and 8 s for a free kick (5 s and 7 s at the very top); if it runs out, the kick is lost.",
} as const;

/** The instant replay: its length (real seconds) and its caption. */
export const REPLAY_SECONDS = 1.5;
export const REPLAY_LABEL = "INSTANT REPLAY";

/** Why a kick earns an instant replay (its caption), or null. Only goals: top bin, in off the post, 28 m+ screamer, PERFECT strike. */
export function replayReason(kick: Pick<KickRecord, "result" | "zone" | "postIn" | "screamer" | "distance" | "perfect">): string | null {
  if (kick.result !== "goal") return null;
  if (kick.zone === "bin") return "TOP BIN";
  if (kick.postIn) return "IN OFF THE POST";
  if (kick.screamer) return `${kick.distance ?? 28} M SCREAMER`;
  if (kick.perfect) return "PERFECT STRIKE";
  return null;
}

/** The longest run of real goals in a row (the scoreboard's "N in a row"; Skill Zones do not double it here). */
export function longestRun(kicks: readonly Pick<KickRecord, "result">[]) {
  let best = 0, run = 0;
  for (const kick of kicks) { run = kick.result === "goal" ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

/** Progress with the all-time BEST STREAK raised to `run` if it is longer (never lowered). */
export const withBestStreak = (progress: Progress, run: number): Progress => (run > progress.bestStreak ? { ...progress, bestStreak: run } : progress);

/** The shot clock the shell runs for this kind of kick (0 = off: Target Practice has its own 60 s timer). */
export const clockSeconds = (difficulty: Difficulty, kind: "penalty" | "freekick" | "target") => (kind === "target" ? 0 : shotClockSeconds(difficulty, kind));

/**
 * BQ-P2-6: the kick history the keeper AI reads (KickContext.history: previous kicks' crossing x; the robot learns
 * your favourite side from it). A timed-out kick struck nothing, so it is left out rather than read as a kick
 * down the middle (its placeholder x: 0).
 */
export const keeperHistory = (kicks: readonly Pick<KickRecord, "x" | "timedOut">[]) => kicks.filter(kick => !kick.timedOut).map(kick => kick.x);
