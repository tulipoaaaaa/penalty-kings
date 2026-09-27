/**
 * The Bag: every revealed ball as a collectible record layered over the SDK's on-chain inventory.
 *
 * HONESTY RULES
 *  • The on-chain inventory (snapshot.inventory[rarity]) is the source of truth for how many balls of
 *    each rarity the Friend holds and what they are worth. Records are only a presentation layer:
 *    syncBag() always makes the record count match the inventory exactly.
 *  • Rarity and RF value are fixed at reveal (on-chain randomness). Choosing, kicking or starring a
 *    ball NEVER changes them: kickStyle() only returns skill-layer fields, recordKick() only touches
 *    career stats (both are tested).
 */
import type { CommentaryContext } from "../gfx/commentary.js";
import type { Zone } from "@penalty-kings/engine";

export type SeasonId = "S0" | "S1";
export type Season = { id: SeasonId; name: string; active: boolean; sample?: boolean; ends: string };
/** Season 1 is live. Season 0 exists in the PREVIEW only, as a labelled sample of a discontinued edition. */
export const SEASONS: readonly Season[] = [
  { id: "S0", name: "Season 0", active: false, sample: true, ends: "2026-09-01" },
  { id: "S1", name: "Season 1", active: true, ends: "2026-10-26" },
];
export const CURRENT_SEASON: SeasonId = "S1";
export const BALL_PROMISE = "Revealed balls never expire. Each one is backed by RF reserved in the stadium contract and can be redeemed for its RF value at any time, even after its season is discontinued.";
export const CHOICE_RULE = "Your ball choice changes your kick's score multiplier, trail and commentary only. It never changes rarity, RF value, odds or prizes.";

export type BallRecord = {
  id: string;
  /** 0 Scuffed … 6 Golden Boot: fixed at reveal. */
  rarity: number;
  season: SeasonId;
  tier: "park" | "pro" | "champions";
  pulledAt: number;
  kicks: number; goals: number; topBins: number;
  lucky: boolean;
  /** Preview-only sample (Season 0): never counted as inventory, never redeemable. */
  sample?: boolean;
};

let counter = 0;
const newId = (rarity: number, now: number) => `b${now.toString(36)}-${rarity}-${(counter++).toString(36)}`;

/** New records for freshly revealed balls (in reveal order). */
export function addPulls(records: readonly BallRecord[], rarities: readonly number[], tier: BallRecord["tier"], now: number): BallRecord[] {
  return [...records, ...rarities.map((rarity, index) => ({ id: newId(rarity, now + index), rarity, season: CURRENT_SEASON, tier, pulledAt: now + index, kicks: 0, goals: 0, topBins: 0, lucky: false }))];
}

/**
 * Make the (non-sample) records match the on-chain inventory exactly: add records for balls we have
 * no record of (e.g. pulled on another device), drop records for balls no longer held (redeemed
 * elsewhere) — the least-kicked, non-lucky, oldest first.
 */
export function syncBag(records: readonly BallRecord[], inventory: readonly bigint[], tier: BallRecord["tier"], now: number): BallRecord[] {
  const samples = records.filter(record => record.sample);
  let real = records.filter(record => !record.sample);
  for (let rarity = 0; rarity < inventory.length; rarity++) {
    const held = Number(inventory[rarity]);
    const mine = real.filter(record => record.rarity === rarity);
    if (mine.length < held) real = addPulls(real, Array(held - mine.length).fill(rarity), tier, now);
    if (mine.length > held) {
      const drop = new Set([...mine].sort((a, b) => Number(a.lucky) - Number(b.lucky) || a.kicks - b.kicks || a.pulledAt - b.pulledAt).slice(0, mine.length - held).map(record => record.id));
      real = real.filter(record => !drop.has(record.id));
    }
  }
  return [...real, ...samples];
}

/** Remove one specific record after an SDK redeem of its rarity succeeded. */
export const removeBall = (records: readonly BallRecord[], id: string) => records.filter(record => record.id !== id);

/** Star exactly one lucky ball; starring the current lucky ball again clears it. */
export function setLucky(records: readonly BallRecord[], id: string): BallRecord[] {
  const clearing = records.find(record => record.id === id)?.lucky ?? false;
  return records.map(record => ({ ...record, lucky: !clearing && record.id === id }));
}

/** A kick with this ball: career stats only. Rarity, season, tier and id are untouched. */
export function recordKick(record: BallRecord, kick: { goal: boolean; zone: Zone }): BallRecord {
  return { ...record, kicks: record.kicks + 1, goals: record.goals + (kick.goal ? 1 : 0), topBins: record.topBins + (kick.goal && kick.zone === "bin" ? 1 : 0) };
}

/** What choosing a ball changes: skill-layer presentation and score only. */
export type KickStyle = Readonly<{ scoreMult: number; fx: number; luckyTrail: boolean; intro: CommentaryContext | null; crowd: "cheer" | "tense" }>;
export function kickStyle(record: BallRecord | null, dropMult: readonly number[]): KickStyle {
  if (!record) return { scoreMult: 1, fx: 7, luckyTrail: false, intro: null, crowd: "tense" };
  return {
    scoreMult: dropMult[record.rarity],
    fx: record.rarity,
    luckyTrail: record.lucky,
    intro: record.lucky ? "lucky-ball" : record.goals >= 10 ? "veteran-ball" : record.rarity >= 5 ? "rarity-high" : null,
    crowd: record.rarity >= 5 || record.lucky ? "cheer" : "tense",
  };
}

export type SortKey = "rarity" | "value" | "newest";
export function sortBag(records: readonly BallRecord[], by: SortKey, rewardOf: (rarity: number) => bigint): BallRecord[] {
  const copy = [...records];
  if (by === "newest") return copy.sort((a, b) => b.pulledAt - a.pulledAt);
  if (by === "value") return copy.sort((a, b) => Number(rewardOf(b.rarity) - rewardOf(a.rarity)) || b.rarity - a.rarity);
  return copy.sort((a, b) => b.rarity - a.rarity || b.pulledAt - a.pulledAt);
}

/** The pack summary: TRUE totals, including the loss when there is one. */
export function packSummary(rarities: readonly number[], price: bigint, rewardOf: (rarity: number) => bigint) {
  const spent = price * BigInt(rarities.length);
  const pulled = rarities.reduce((sum, rarity) => sum + rewardOf(rarity), 0n);
  return { spent, pulled, net: pulled - spent, count: rarities.length, best: rarities.length ? Math.max(...rarities) : -1 };
}

export const editionLabel = (record: Pick<BallRecord, "season" | "tier">) => `${record.season} · ${record.tier[0].toUpperCase()}${record.tier.slice(1)}`;
export const isDiscontinued = (season: SeasonId) => !SEASONS.find(item => item.id === season)?.active;

/** The preview's labelled sample of a discontinued edition (never inventory, never redeemable). */
export const sampleDiscontinued = (now: number): BallRecord[] => [
  { id: "sample-s0-gold", rarity: 5, season: "S0", tier: "park", pulledAt: now - 40 * 86_400_000, kicks: 31, goals: 19, topBins: 6, lucky: false, sample: true },
];
