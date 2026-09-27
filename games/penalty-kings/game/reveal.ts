/**
 * ETHICS RULE: a paid RF ball reveal shows the TRUE settled outcome. The reveal animation is a
 * pure function of the settled outcome id: no fake near-misses, no cycling through better
 * rarities, no "almost" moments. Near-miss drama exists only in the skill layer (the kick).
 */
export type RevealPlan = Readonly<{
  /** 0 Scuffed … 6 Golden Boot: the settled outcome, the ONLY rarity ever drawn. */
  rarity: number;
  /** Visual intensity tier (particles, trauma, edge flood) — rises with the true rarity. */
  tier: number;
  duration: number;
  /** Timeline beats in seconds. Every beat shows `rarity`. */
  beats: ReadonlyArray<{ at: number; kind: "drop" | "spin" | "slow" | "flood" | "banner" | "crowd"; shows: number }>;
  /** Rising pitch per tier for the reveal SFX (semitones above base). */
  pitch: number;
  fullScreen: boolean;
}>;

export function revealPlan(outcomeId: number): RevealPlan {
  if (!Number.isInteger(outcomeId) || outcomeId < 1 || outcomeId > 7) throw new Error(`invalid settled outcome ${outcomeId}`);
  const rarity = outcomeId - 1;
  const top = rarity === 6;
  const duration = top ? 3.8 : 2.4;
  const beats: RevealPlan["beats"] = [
    { at: 0, kind: "drop", shows: rarity },
    { at: 0.3, kind: "spin", shows: rarity },
    { at: 1.0, kind: "slow", shows: rarity },
    { at: 1.1, kind: "flood", shows: rarity },
    { at: 1.15, kind: "banner", shows: rarity },
    ...(top ? [{ at: 1.2, kind: "crowd" as const, shows: rarity }] : []),
  ];
  return { rarity, tier: rarity, duration, beats, pitch: rarity * 2, fullScreen: top };
}
