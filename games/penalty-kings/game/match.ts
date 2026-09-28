// Big Match rule (unchanged): 5 regulation kicks; 3+ goals in those 5 start sudden death (double points until
// you miss). Kick 5 belongs to the regulation 5, so a miss on kick 5 never ends sudden death: it has not begun.
export const MATCH_KICKS = 5;
export const SUDDEN_DEATH_GOALS = 3;

type Kick = { result: string };

export interface MatchStep {
  /** Sudden death is on for the kicks that follow. */
  suddenDeath: boolean;
  /** This kick (the 5th) has just started sudden death. */
  starts: boolean;
  /** This kick was a sudden-death miss: the match is over. */
  over: boolean;
  /** No more kicks. */
  done: boolean;
}

/** The match state after `kicks` (including the one just taken), given whether sudden death was on BEFORE it. */
export function matchAfterKick(kicks: readonly Kick[], suddenDeathBefore: boolean): MatchStep {
  const goals = kicks.filter(item => item.result === "goal").length;
  if (suddenDeathBefore) {
    const over = kicks[kicks.length - 1]?.result !== "goal";
    return { suddenDeath: true, starts: false, over, done: over };
  }
  if (kicks.length < MATCH_KICKS) return { suddenDeath: false, starts: false, over: false, done: false };
  const starts = kicks.length === MATCH_KICKS && goals >= SUDDEN_DEATH_GOALS;
  return { suddenDeath: starts, starts, over: false, done: !starts };
}

/** Big Match Results title. `suddenDeath` is the session flag; the match may also end early (Leave). */
export function matchResultTitle(kicks: readonly Kick[], suddenDeath: boolean): string {
  const goals = kicks.filter(item => item.result === "goal").length;
  if (suddenDeath && kicks.length > MATCH_KICKS && kicks[kicks.length - 1]?.result !== "goal") return "Sudden death over: missed";
  if (suddenDeath) return `Full time: ${goals} of ${kicks.length} scored, sudden death reached`;
  return `Full time: ${goals} of ${kicks.length} scored (3 goals start sudden death)`;
}
