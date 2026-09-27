/**
 * $GBOOT reward claims signed by the Skill Cup referee (EIP-712), redeemed on-chain by
 * contracts/src/RewardsDistributor.sol. The contract enforces every hard limit itself (hardwired
 * Friend of generation ≤ 4, a PAID SkillCup entry of that Friend, ≤ 2 RF-equivalent per entry, ≤ 3 RF
 * per Friend per day, nonce, deadline ≤ 7 days, season budget); this module only decides what a
 * finished entry earns, in RF terms (the contract converts at the 30-minute TWAP).
 *
 * Paid kinds (both tied to one paid entry, together ≤ ENTRY_CAP_RF):
 *  - KIND_SKILL (0): by goals in the 5 referee-judged kicks: 5 → 1.5 RF, 4 → 1 RF, 3 → 0.5 RF, else 0.
 *  - KIND_STREAK (1): 0.5 RF on the first finished entry of a UTC day when the Friend has finished
 *    entries on ≥ STREAK_DAYS consecutive days (within the Cup week the referee holds).
 * Daily-login rewards are NOT signed: they cannot be farm-proofed, so they stay XP / cosmetics.
 */
import type { ShotResult } from "../../packages/engine/src/index.ts";

export const KIND_SKILL = 0;
export const KIND_STREAK = 1;
const RF = 10n ** 18n;
export const ENTRY_CAP_RF = 2n * RF; // SkillCup.ENTRY_RF (10 RF) × RewardsDistributor.ENTRY_CAP_BPS (20%)
export const STREAK_BONUS_RF = RF / 2n;
export const STREAK_DAYS = 3;
export const CLAIM_VALIDITY_S = 3 * 24 * 60 * 60; // the contract accepts at most 7 days

/** EIP-712 types: must match RewardsDistributor.CLAIM_TYPEHASH (checked by verifier/test). */
export const REWARD_TYPES = {
  RewardClaim: [
    { name: "friendId", type: "uint256" },
    { name: "entryId", type: "uint256" },
    { name: "kind", type: "uint8" },
    { name: "rfValue", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const REWARD_DOMAIN_NAME = "Penalty Kings Rewards";
export const REWARD_DOMAIN_VERSION = "1";
export const rewardDomain = (chainId: number, verifyingContract: `0x${string}`) =>
  ({ name: REWARD_DOMAIN_NAME, version: REWARD_DOMAIN_VERSION, chainId, verifyingContract }) as const;

export type RewardClaim = { friendId: bigint; entryId: bigint; kind: number; rfValue: bigint; nonce: bigint; deadline: bigint };
export type RewardSigner = (claim: RewardClaim) => Promise<`0x${string}`>;
/** JSON-safe form returned to the client (bigints as decimal strings). */
export type SignedReward = { claim: Record<keyof RewardClaim, string>; signature: string };

/** One nonce per (entry, kind): a claim can never be signed twice with different nonces for the same entry. */
export const rewardNonce = (entryId: number, kind: number) => BigInt(entryId) * 4n + BigInt(kind);

export function skillRewardRf(results: readonly ShotResult[]): bigint {
  const goals = results.filter(result => result === "goal").length;
  return goals >= 5 ? (3n * RF) / 2n : goals === 4 ? RF : goals === 3 ? RF / 2n : 0n;
}

const DAY_MS = 86_400_000;
/** Consecutive UTC days ending on `today` with at least one finished entry (`days` = day indexes). */
export function dayStreak(days: Iterable<number>, today: number) {
  const set = new Set(days);
  let streak = 0;
  while (set.has(today - streak)) streak++;
  return streak;
}
export const dayOf = (ms: number) => Math.floor(ms / DAY_MS);

export const toJson = (claim: RewardClaim): SignedReward["claim"] =>
  Object.fromEntries(Object.entries(claim).map(([key, value]) => [key, String(value)])) as SignedReward["claim"];
