/**
 * The commentator's picker: given contexts from most to least specific, returns a line that has not
 * been used in the last REPEAT_SECONDS seconds nor the last REPEAT_LINES picks. Seeded, so the same
 * seed and inputs give the same lines.
 */
import { BANTER, LINE_BANK, fillLine } from "./lines.ts";
import type { Rng } from "./rng.ts";
import type { KeeperId, Line } from "./types.ts";

export const REPEAT_SECONDS = 60;
export const REPEAT_LINES = 40;

export type Names = { friend: string; keeper: string; number: string };
export type CommentatorState = { used: [string, number][] };

export class Commentator {
  /** [line id, time used], oldest first: the last REPEAT_LINES picks plus anything younger than REPEAT_SECONDS. */
  used: [string, number][] = [];

  private blocked(id: string, now: number) {
    return this.used.some(([used, at]) => used === id && now - at < REPEAT_SECONDS) || this.used.slice(-REPEAT_LINES).some(([used]) => used === id);
  }
  private mark(id: string, now: number) {
    this.used.push([id, now]);
    const keepFrom = this.used.length - REPEAT_LINES;
    this.used = this.used.filter(([, at], i) => i >= keepFrom || now - at < REPEAT_SECONDS);
  }

  /**
   * The first context (in order) with a free line wins. If every candidate is blocked: null, or with
   * `mustSpeak` the least recently used line of the first known context (the only way a line repeats).
   */
  pick(contexts: readonly string[], rng: Rng, names: Names, now: number, mustSpeak = false): Line | null {
    const known = contexts.filter(context => LINE_BANK[context]?.length);
    for (const context of known) {
      const free = LINE_BANK[context].map((_, i) => `${context}#${i}`).filter(id => !this.blocked(id, now));
      if (!free.length) continue;
      const id = free[rng.int(free.length)];
      return this.emit(id, context, LINE_BANK[context][Number(id.slice(id.lastIndexOf("#") + 1))], names, now);
    }
    if (!known.length || !mustSpeak) return null;
    const context = known[0], ids = LINE_BANK[context].map((_, i) => `${context}#${i}`);
    const lastUse = (id: string) => { for (let i = this.used.length - 1; i >= 0; i--) if (this.used[i][0] === id) return i; return -1; };
    const id = ids.reduce((best, candidate) => (lastUse(candidate) < lastUse(best) ? candidate : best));
    return this.emit(id, context, LINE_BANK[context][Number(id.slice(id.lastIndexOf("#") + 1))], names, now);
  }

  /** A keeper banter pair (commentator set-up + keeper answer), or null when both pairs were used recently. */
  banter(keeper: KeeperId, rng: Rng, names: Names, now: number): Line[] | null {
    const pairs = BANTER[keeper] ?? [];
    const free = pairs.map((_, i) => i).filter(i => !this.blocked(`banter:${keeper}#${i}:0`, now));
    if (!free.length) return null;
    const i = free[rng.int(free.length)], [setup, answer] = pairs[i];
    return [this.emit(`banter:${keeper}#${i}:0`, "banter", setup, names, now), { ...this.emit(`banter:${keeper}#${i}:1`, "banter", answer, names, now), by: "keeper" }];
  }

  private emit(id: string, context: string, template: string, names: Names, now: number): Line {
    this.mark(id, now);
    return { id, text: fillLine(template, names), context, by: "commentator" };
  }

  save(): CommentatorState { return { used: this.used.map(([id, at]) => [id, at]) }; }
  load(state: CommentatorState) { this.used = state.used.map(([id, at]) => [id, at]); }
}
