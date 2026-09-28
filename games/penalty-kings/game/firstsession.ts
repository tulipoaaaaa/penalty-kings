/**
 * The first-session script (owner's "wow in 60 seconds"), used only for the very first match. Every
 * help here is VISUAL or AIM ASSIST: it never touches RF, balls, rarity, odds or prizes (the tutorial
 * is a free skill mode).
 */
import type { KeeperId } from "@penalty-kings/engine";

export type FirstKick = Readonly<{
  keeper: KeeperId;
  /** Aim-assist strength for this kick (0..1), skill layer only. */
  assist: number;
  /** Commentary context played before the kick. */
  intro: string;
  /** The coaching toast for this kick: one short line (the full shot rules live in Rules). */
  coach: string;
  /** Surprise keeper entrance with a walk-on + taunt. */
  surprise?: boolean;
  /** After the kick: a net-cam slow-mo replay of the best goal so far. */
  replayBest?: boolean;
  /** From this kick on, the tutorial's FIRST goal gets the full celebration + crowd wave (a save on this kick carries it over). */
  bigCelebration?: boolean;
}>;

export const FIRST_SESSION: readonly FirstKick[] = [
  { keeper: "mouse", assist: 0.9, intro: "tutorial-1", bigCelebration: true, coach: "Tutorial: swipe up from the ball. The target shows where it lands." },
  { keeper: "chameleon", assist: 0.6, intro: "here-comes-trouble", surprise: true, coach: "Kick 2: a longer swipe aims higher; a faster one adds pace, not height." },
  { keeper: "chameleon", assist: 0.5, intro: "tutorial-3", replayBest: true, coach: "Kick 3: go for a corner. Low shots down the middle hit the keeper's leg." },
];

/** The card that flips into the Scouting Book after the first round, plus the next-unlock teaser. */
export const FIRST_UNLOCK = {
  keeper: "octopus" as KeeperId, card: "New rival scouted: Octavia!",
  /** Shown while Free Kicks is still locked (below level 2). */
  teaser: "Free Kicks unlock at level 2 — you're nearly there.",
  /** Shown once the tutorial XP has opened Free Kicks (the usual case: the tutorial reaches level 2). */
  teaserOpen: "Next up: Free Kicks — bend it round the wall!",
} as const;

/** True when this tutorial kick is the first goal and a big celebration is due (so a save on kick 1 never loses the wave). */
export function bigCelebrationDue(previous: readonly { result: string }[], goal: boolean) {
  if (!goal || previous.length >= FIRST_SESSION.length || previous.some(kick => kick.result === "goal")) return false;
  return FIRST_SESSION.slice(0, previous.length + 1).some(kick => kick.bigCelebration);
}

/** The best goal so far (for the replay): highest points, then the most recent. */
export function bestGoal<T extends { result: string; points: number }>(kicks: readonly T[]) {
  let best: T | null = null;
  for (const kick of kicks) if (kick.result === "goal" && (!best || kick.points >= best.points)) best = kick;
  return best;
}
