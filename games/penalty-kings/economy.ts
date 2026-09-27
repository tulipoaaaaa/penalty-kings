/**
 * Penalty Kings economy constants shared by the game UI.
 * Everything in this file drives SIMULATED preview figures. Live figures come
 * from contracts, the published weekly drop rate (docs/DROPS.md) and the
 * weekly Cup report (docs/WEEKLY.md).
 */

export type TierId = "park" | "pro" | "champions";

export type Tier = Readonly<{ id: TierId; name: string; priceRF: number; path: string; raceWeight: number; baseDrop: number }>;

/**
 * Base $GBOOT drop per ball at the v2 launch price (0.1 RF per $GBOOT, 100M supply):
 * 2% × ball price ÷ 0.1 ÷ 2.15, where 2.15 is the average rarity multiplier. At the maximum
 * Bootroom boost drops are ×1.5, so the drop value is ≤ 3% of the ball price and total value per
 * ball ≤ 93% (90% RF return + 3%). Park: 0.93 × 2.15 = 2 $GBOOT ≈ 0.2 RF = 2% of a 10 RF ball.
 * Live rate each week: min(this schedule, 3% × volume ÷ TWAP, the drop vault's season cap) — docs/DROPS.md.
 */
export const TIERS: readonly Tier[] = [
  { id: "park", name: "Park", priceRF: 10, path: "./", raceWeight: 1, baseDrop: 0.93 },
  { id: "pro", name: "Pro", priceRF: 1000, path: "./pro/", raceWeight: 100, baseDrop: 93 },
  { id: "champions", name: "Champions", priceRF: 10000, path: "./champions/", raceWeight: 1000, baseDrop: 930 },
];

export const tierForPrice = (priceRF: number) => TIERS.find(tier => tier.priceRF === priceRF) ?? TIERS[0];

export type Rarity = Readonly<{ name: string; dropMult: number; racePoints: number; color: string; accent: string; label: string }>;

/** Indexed by outcome id - 1, matching game.json order. */
export const RARITIES: readonly Rarity[] = [
  { name: "Scuffed Ball", dropMult: 1, racePoints: 0, color: "#8a7a66", accent: "#5b4f40", label: "Common" },
  { name: "Training Ball", dropMult: 1.5, racePoints: 0, color: "#f2f2f2", accent: "#f08a24", label: "Common" },
  { name: "Match Ball", dropMult: 2, racePoints: 0, color: "#ffffff", accent: "#2a6fdb", label: "Uncommon" },
  { name: "Pro Ball", dropMult: 3, racePoints: 0, color: "#ffffff", accent: "#16a34a", label: "Rare" },
  { name: "Silver Ball", dropMult: 5, racePoints: 0, color: "#d7dde5", accent: "#8a96a8", label: "Epic" },
  { name: "Gold Ball", dropMult: 8, racePoints: 1, color: "#ffd23f", accent: "#b8860b", label: "Legendary" },
  { name: "Golden Boot Ball", dropMult: 15, racePoints: 2, color: "#ffe680", accent: "#ff8c00", label: "Mythic" },
];

/** Cup pot share of each ball (tokenomics v2, docs/ECONOMY.md): 30% of the swept edge = 0.10 × 0.90 × 30%. */
export const CUP_SHARE_OF_PRICE = 0.027;
/** Simulated opening pot shown in the preview. */
export const SIM_CUP_SEED_RF = 500_000;
export const SIM_CUP_SEED_GBOOT = 10_000_000;

/** Top-10 payout curve (percent of pot), published in docs/ECONOMY.md. */
export const CUP_CURVE = [25, 18, 13, 10, 8, 7, 6, 5, 4, 4] as const;

export type Cosmetic = Readonly<{ id: string; kind: "boots" | "kit" | "net" | "celebration"; name: string; price: number; color?: string }>;

/** KitShop: bought with $GBOOT, burned. Cosmetic only. */
export const COSMETICS: readonly Cosmetic[] = [
  { id: "boots-classic", kind: "boots", name: "Classic black boots", price: 0, color: "#111111" },
  { id: "boots-volt", kind: "boots", name: "Volt boots", price: 6, color: "#ccff00" },
  { id: "boots-blaze", kind: "boots", name: "Blaze boots", price: 9, color: "#ff4d2e" },
  { id: "kit-white", kind: "kit", name: "White halo kit", price: 0, color: "#ffffff" },
  { id: "kit-sky", kind: "kit", name: "Sky halo kit", price: 8, color: "#7fd3ff" },
  { id: "kit-gold", kind: "kit", name: "Gold halo kit", price: 15, color: "#ffd23f" },
  { id: "net-white", kind: "net", name: "White net", price: 0, color: "#e8e8e8" },
  { id: "net-volt", kind: "net", name: "Volt net", price: 4, color: "#ccff00" },
  { id: "net-crimson", kind: "net", name: "Crimson net", price: 4, color: "#ff5a6e" },
  { id: "cele-knee-slide", kind: "celebration", name: "Knee slide", price: 0 },
  { id: "cele-spin-point", kind: "celebration", name: "Spin and point", price: 5 },
  { id: "cele-badge-kiss", kind: "celebration", name: "Badge kiss", price: 7 },
  { id: "cele-backflip", kind: "celebration", name: "Backflip", price: 12 },
  { id: "cele-disco", kind: "celebration", name: "Disco dance", price: 9 },
  { id: "cele-superhero", kind: "celebration", name: "Superhero pose", price: 10 },
];

/** Earned with World Tour stars (free skill layer) — never sold, not in the on-chain KitShop. */
export const STAR_REWARDS: readonly Cosmetic[] = [
  { id: "net-lime", kind: "net", name: "Lime net (Top Bins ★★★)", price: 0, color: "#a3e635" },
  { id: "boots-gold", kind: "boots", name: "Gold boots (Park Final ★★★)", price: 0, color: "#ffd23f" },
  { id: "kit-neon", kind: "kit", name: "Neon kit (Beat Chroma ★★★)", price: 0, color: "#ff4fd8" },
  { id: "cele-crowd-surf", kind: "celebration", name: "Crowd surf (Pro Final ★★★)", price: 0 },
  { id: "cele-trophy-lift", kind: "celebration", name: "Trophy lift (THE FINAL WALL ★★★)", price: 0 },
];
export const ALL_COSMETICS: readonly Cosmetic[] = [...COSMETICS, ...STAR_REWARDS];
/** Stage celebration id for a celebration cosmetic ("cele-knee-slide" → "knee-slide"). */
export const celebrationOf = (id: string) => id.replace(/^cele-/, "");

/** Simulated preview only: starting $GBOOT so judges can try the shop, Wildcards and the Skill Cup. Labelled in the UI. */
export const SIM_STARTING_GBOOT = 250;

/** Wildcard: an extra Cup race draw. 50% burned, 50% to the pot. */
export const WILDCARD_PRICE = 100;

/** Skill Cup entry: one 5-kick shootout vs Ghost. 50% burned, 50% to the Skill Cup pot. */
export const SKILL_CUP_ENTRY = 100;

/** The token explainer (round 6 C11), word for word: shown at the first purchase and on the Cups screen. RF + $GBOOT only. */
export const TOKEN_LINES: ReadonlyArray<readonly [term: string, text: string]> = [
  ["RF", "Rare Friends money. Buy balls with it; cash balls back into it."],
  ["Ball", "your shot. Its RF value is printed on it."],
  ["$GBOOT", "the game's token. Spend it on kits, cup entries and wildcards."],
  ["Lace", "lock $GBOOT into your Friend for style + XP perks."],
  ["Burn", "spent $GBOOT is gone forever."],
];

export const formatNumber =(value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
