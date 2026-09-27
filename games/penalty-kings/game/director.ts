/**
 * The Match Director: decides WHAT the player sees and hears so every session feels like a
 * broadcast — keeper rotation between rounds, keeper intros, weather lines, pre-kick taunts,
 * the right line for the right goal (top bin, post-in, Panenka, curler, knuckleball), crowd waves
 * on streaks (rationed), consolation on cold streaks, and the attract-mode showreel. Pure logic:
 * it never touches outcomes (the engine and on-chain randomness decide those).
 */
import { LADDER } from "./progress.js";
import type { KeeperId, Zone } from "@penalty-kings/engine";
import type { CommentaryContext } from "../gfx/commentary.js";

export type KickFacts = {
  kind: "penalty" | "freekick" | "target";
  result: "goal" | "save" | "post" | "over" | "wide" | "wall";
  zone: Zone; postIn?: boolean; y: number; x: number; spin?: number; knuckle?: boolean; streak: number; misses: number;
};
export type Cue = { say: CommentaryContext | null; wave: boolean };
export type ShowreelBeat = "walkout" | "penalty-goal" | "penalty-save" | "celebration" | "wave" | "freekick" | "taunt" | "post";

export class MatchDirector {
  private kicks = 0;
  private lastWave = -99;
  private round = 0;
  constructor(private seed = 1) {}

  /** Keeper for the next free round: the ladder keeper, with a rematch against a beaten one every third round. */
  keeperForRound(stamps: readonly KeeperId[], ladderNext: KeeperId): KeeperId {
    const round = this.round++;
    if (stamps.length && round % 3 === 2) return stamps[(this.seed + round) % stamps.length];
    return ladderNext;
  }

  /** Free kicks rotate the keeper every kick: the ladder keeper, beaten ones, and a sneak peek at the next rung. */
  keeperForKick(stamps: readonly KeeperId[], ladderNext: KeeperId, kick: number): KeeperId {
    const index = LADDER.indexOf(ladderNext), window = LADDER.slice(Math.max(0, index - 2), index + 2).filter(id => id === ladderNext || stamps.includes(id) || LADDER.indexOf(id) === index + 1);
    return window[(kick + this.seed) % window.length] ?? ladderNext;
  }

  /** Round opening line: the keeper's intro, or the weather if it is dramatic. */
  roundIntro(keeper: KeeperId, weather: string, mode: string): CommentaryContext {
    if (mode === "daily") return "daily";
    if (mode === "tour") return this.round % 2 ? "tour" : `intro:${keeper}`;
    if ((weather === "rain" || weather === "snow" || weather === "fog") && this.round % 2 === 1) return weather as CommentaryContext;
    return `intro:${keeper}`;
  }

  /** Before the kick: build-up line on big moments, a keeper taunt now and then. */
  beforeKick(kickIndex: number, streak: number): { say: CommentaryContext | null; taunt: boolean } {
    if (streak >= 2) return { say: "buildup", taunt: true };
    return { say: kickIndex > 0 && kickIndex % 3 === 0 ? "buildup" : null, taunt: kickIndex % 2 === 1 };
  }

  /** After the kick: the most specific line, and a (rationed) Mexican wave on a streak. */
  afterKick(facts: KickFacts): Cue {
    this.kicks++;
    const goal = facts.result === "goal";
    let say: CommentaryContext;
    if (facts.result === "wall") say = "wall";
    else if (goal && facts.postIn) say = "post-in";
    else if (goal && facts.knuckle) say = "knuckle";
    else if (goal && facts.zone === "bin") say = "top-bin";
    else if (goal && facts.zone === "centre" && facts.y >= 0.55) say = "panenka";
    else if (goal && facts.kind === "freekick" && Math.abs(facts.spin ?? 0) >= 0.45) say = "curler";
    else if (goal && facts.streak >= 3) say = "streak3";
    else if (goal && facts.streak === 2) say = "streak2";
    else if (goal) say = "goal";
    else if (facts.misses >= 3) say = "cold-streak";
    else if ((facts.result === "wide" || facts.result === "over") && (Math.abs(Math.abs(facts.x) - 1) < 0.1 || Math.abs(facts.y - 1) < 0.08)) say = "near-miss";
    else say = facts.result === "post" ? "post" : facts.result;
    const wave = goal && facts.streak >= 2 && this.kicks - this.lastWave >= 6;
    if (wave) this.lastWave = this.kicks;
    return { say, wave };
  }

  /** Attract-mode showreel: a fixed, varied loop of skill moments (never paid reveals). */
  static readonly SHOWREEL: readonly ShowreelBeat[] = ["walkout", "penalty-goal", "celebration", "taunt", "penalty-save", "wave", "freekick", "post", "penalty-goal"];
}
