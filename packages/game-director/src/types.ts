import type { KeeperId, Zone } from "@penalty-kings/engine";

export type { KeeperId, Zone };
export type Phase = "build-up" | "peak" | "relax";
export type MomentTier = "micro" | "notable" | "set-piece";
/** When the shell plays it: before the kick (aiming), as the reaction to the result, or in the reset between kicks. */
export type MomentSlot = "before" | "reaction" | "between";
export type StadiumId = "park" | "pro" | "champions";
export type Weather = "sun" | "rain" | "snow" | "fog" | "sunset";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type PlayMode = "penalties" | "freekicks" | "match" | "tour" | "daily" | "skill" | "tutorial" | "target";
export type KickResult = "goal" | "save" | "post" | "over" | "wide" | "wall";
/** Cosmetic glow of the ball in play (read only, for a line; the Director never sees odds or prizes). */
export type BallGlow = "standard" | "high" | "top";

/** Modes where the Golden Hour skill-score bonus may apply: free play only, never anything with a leaderboard, prize or paid ball. */
export const FREE_PLAY_MODES: readonly PlayMode[] = ["penalties", "freekicks"];

/** What the shell tells the Director after a kick resolved (the engine decided it; the Director only reacts). */
export type KickFacts = Readonly<{
  kind: "penalty" | "freekick" | "target";
  result: KickResult;
  zone: Zone;
  /** Crossing point in goal units (x: -1 … 1 between the posts, y: 0 … 1 up to the bar). */
  x: number; y: number;
  postIn?: boolean; spin?: number; knuckle?: boolean;
  /** Seconds (any monotonic clock) for the commentary no-repeat window. Defaults to 12 s per kick. */
  now?: number;
}>;

/** A line to show: already filled in ({friend}, {keeper}, {number}). */
export type Line = Readonly<{ id: string; text: string; context: string; by: "commentator" | "keeper" }>;

/** A moment the shell should stage. */
export type Moment = Readonly<{
  id: string; name: string; tier: MomentTier; slot: MomentSlot;
  /** Payload for the Stage: a keeper to walk on, a weather to roll in, jumbotron text. */
  keeper?: KeeperId; weather?: Weather; jumbotron?: string;
  lines: readonly Line[];
}>;

/** Everything the shell needs for one step. Cosmetic only (see test/cosmetic.test.ts). */
export type Beat = Readonly<{
  kick: number; round: number; kickInRound: number;
  phase: Phase; intensity: number;
  keeper: KeeperId; keeperChanged: boolean;
  moments: readonly Moment[];
  /** The commentator line for this step (always one after a kick). */
  lines: readonly Line[];
  /** Build-up pressure hints: crowd hush, shot-clock emphasis. */
  hush: boolean; shotClock: boolean;
  /** Golden Hour skill-score bonus: 2 during Golden Hour in FREE_PLAY_MODES, else always 1. */
  skillScoreMultiplier: 1 | 2;
}>;
