// Tokenomics v2 constants and exact ports of the on-chain maths (contracts/src, script/Launch.s.sol).
// Shared by scripts/economy-sim.mjs and the weekly scripts. `checkContracts()` re-reads the Solidity
// sources and fails if any constant here drifts from them. Pure: no network, no keys.
import { readFileSync } from "node:fs";

const E18 = 10n ** 18n;

/** GBoot.TOTAL_SUPPLY and the Launch.s.sol allocation (whole tokens). */
export const SUPPLY = 100_000_000;
export const ALLOCATION = { pool: 55_000_000, drops: 20_000_000, airdrop: 10_000_000, cups: 10_000_000, bounty: 5_000_000 };

/** EmissionVault parameters from Launch.s.sol (`weeklyCap`, `halvingWeeks`; 0 = flat). */
export const VAULTS = {
  drops: { total: ALLOCATION.drops, weeklyCap: 2_500_000, halvingWeeks: 4 },
  cups: { total: ALLOCATION.cups, weeklyCap: 100_000, halvingWeeks: 0 },
  // The rewards vault: the RewardsDistributor's own EmissionVault (50k/week, halving every 52 weeks).
  bounty: { total: ALLOCATION.bounty, weeklyCap: 50_000, halvingWeeks: 52 },
};

/** EmissionVault.capOf(week) in wei: weeklyCap >> (week / halvingWeeks), 0 after 255 halvings. */
export function capOfWei(vault, week) {
  const cap = BigInt(vault.weeklyCap) * E18;
  if (vault.halvingWeeks === 0) return cap;
  const halvings = BigInt(Math.floor(week / vault.halvingWeeks));
  return halvings >= 255n ? 0n : cap >> halvings;
}
export const capOf = (vault, week) => Number(capOfWei(vault, week)) / 1e18;

/** Most a vault can have released after `weeks` whole weeks (weeks 0 … weeks−1), bounded by its balance. */
export function releasedBy(vault, weeks) {
  let total = 0n;
  const balance = BigInt(vault.total) * E18;
  for (let week = 0; week < weeks && total < balance; week++) total += capOfWei(vault, week);
  return Number(total > balance ? balance : total) / 1e18;
}

/** EdgeSplitter: 40% RF burned, 30% RF buy-and-burn $GBOOT, 30% RF to the Cup (integer bps, like split()). */
export const EDGE_SPLIT = { burnBps: 4_000, buybackBps: 3_000, cupBps: 3_000 };
export function splitEdgeWei(totalWei) {
  const burn = (totalWei * BigInt(EDGE_SPLIT.burnBps)) / 10_000n;
  const buyback = (totalWei * BigInt(EDGE_SPLIT.buybackBps)) / 10_000n;
  return { burn, buyback, cup: totalWei - burn - buyback };
}

/** Bootroom constants and an exact BigInt port of progressBps / perkTier / log2Wad. */
export const BOOTROOM = { MAX_WEEKS: 52, MAX_LACE: 10_000, X_MAX: 520_000, BPS: 10_000, TIER2_BPS: 5_000, TIER3_BPS: 8_500 };
export function log2Wad(x) {
  let n = 0n, y = x / E18;
  while (y >= 2n) { y >>= 1n; n++; }
  let result = n * E18;
  y = x >> n;
  for (let delta = 5n * 10n ** 17n; delta > 10n ** 9n; delta >>= 1n) {
    y = (y * y) / E18;
    if (y >= 2n * E18) { result += delta; y >>= 1n; }
  }
  return result;
}
/** Bootroom.progressBps for a live lace of `amount` whole $GBOOT for `lockWeeks` weeks (expired or empty → 0). */
export function progressBps(amount, lockWeeks) {
  const BPS = BigInt(BOOTROOM.BPS);
  if (!(amount > 0) || !(lockWeeks > 0)) return 0;
  const counted = BigInt(Math.floor(Math.min(amount, BOOTROOM.MAX_LACE)));
  const x = counted * BigInt(lockWeeks);
  if (x >= BigInt(BOOTROOM.X_MAX)) return BOOTROOM.BPS;
  return Number((BPS * log2Wad(E18 + x * E18)) / log2Wad(E18 + BigInt(BOOTROOM.X_MAX) * E18));
}
/** Bootroom.perkTier: 0 (no live lace), 1, 2 (≥ 50%), 3 (≥ 85%). Progression only: cosmetics, XP, Cup seeding. */
export const perkTierOf = progress => (progress === 0 ? 0 : progress >= BOOTROOM.TIER3_BPS ? 3 : progress >= BOOTROOM.TIER2_BPS ? 2 : 1);
export const perkTier = (amount, lockWeeks) => perkTierOf(progressBps(amount, lockWeeks));
/** What a perk tier gives (off-chain progression; never a payout). */
export const PERKS = [
  { tier: 0, xpBonusPct: 0, cosmetic: "—", seeding: "unseeded" },
  { tier: 1, xpBonusPct: 5, cosmetic: "laced boots (glow 1)", seeding: "seed band 3" },
  { tier: 2, xpBonusPct: 10, cosmetic: "glow 2 + boot trail", seeding: "seed band 2" },
  { tier: 3, xpBonusPct: 15, cosmetic: "glow 3 + golden laces", seeding: "seed band 1" },
];

/** FriendsAirdrop, SkillCup, Wildcards, LiquidityLock / pool. */
export const AIRDROP = { LOCK_WEEKS: 12, CLAIM_WINDOW_DAYS: 180 };
/** RF-priced sinks: the $GBOOT charged is ⌈price_RF ÷ price⌉. Launch default: GBootFixedPrice (fixed
 *  0.1 RF per $GBOOT, so 10 RF = 100 $GBOOT); with the audited hook: GBootPriceFeed (30-minute TWAP). */
export const SKILL_CUP = { ENTRY_RF: 10, BURN_SHARE: 0.5, WEEKLY_LIMIT: 20, COOLDOWN_H: 1 };
export const WILDCARD = { PRICE_RF: 10, BURN_SHARE: 0.5 };
export const TWAP = { PERIOD_S: 1800, MAX_DEVIATION_TICKS: 1000, CHECKPOINT_S: 60, CARDINALITY: 64 };
/** RewardsDistributor: RF-valued rewards tied to a paid Skill Cup entry, per-Friend daily cap, season budget. */
export const REWARDS = { MAX_GENERATION: 4, SEASON_WEEKS: 4, DAILY_CAP_RF: 3, ENTRY_CAP_BPS: 2_000, MAX_VALIDITY_DAYS: 7 };
/** Launch default (owner decision "option B"): a PLAIN v4 pool, 1% LP fee, no hook. The locked
 *  positions earn the fee; LiquidityLock.collect splits each side 50% burned / 50% to the Cup pot. */
export const POOL = { FEE: 0.01, UNLOCK_DAYS: 180, HOOK: false };
export const LOCK = { BURN_BPS: 5_000 };
/** GBootFixedPrice.RF_PER_GBOOT_WAD: the fixed sink/reward price while there is no hook (no TWAP). */
export const FIXED_PRICE = 0.1;
/** Nominal launch price used by the drop schedule (games/penalty-kings/economy.ts); the tick-snapped pool start is 0.10027. */
export const NOMINAL_PRICE = 0.1;
export const DROP_SHARE = 0.02;           // base drop value = 2% of the ball price at ×1 (economy.ts)

/** Throws if any constant above no longer matches contracts/src or Launch.s.sol. */
export function checkContracts(root = new URL("../../", import.meta.url)) {
  const read = path => readFileSync(new URL(path, root), "utf8").replace(/_/g, "");
  const expect = (path, pattern, label) => { if (!pattern.test(read(path))) throw new Error(`tokenomics drift: ${label} (${path})`); };
  expect("contracts/src/GBoot.sol", /TOTALSUPPLY = 100000000e18/, "supply");
  const launch = "contracts/script/Launch.s.sol";
  expect(launch, /POOLGBOOT = 55000000e18/, "pool 55M");
  expect(launch, /DROPSGBOOT = 20000000e18/, "drops 20M");
  expect(launch, /AIRDROPGBOOT = 10000000e18/, "airdrop 10M");
  expect(launch, /CUPSGBOOT = 10000000e18/, "cups 10M");
  expect(launch, /BOUNTYGBOOT = 5000000e18/, "bounty 5M");
  expect(launch, /drops = new EmissionVault\([^;]*2500000e18, 4\)/, "drop vault 2.5M/week, halving every 4 weeks");
  expect(launch, /cups = new EmissionVault\([^;]*100000e18, 0\)/, "cups vault 100k/week flat");
  expect(launch, /rewards = new RewardsDistributor\([^;]*50000e18, 52, sinkList/, "rewards vault 50k/week, halving every 52 weeks");
  expect(launch, /LPFEE = 10000;/, "pool: 1% LP fee");
  expect(launch, /PoolKey\(address\(gboot\), RF, LPFEE, 200, address\(0\)\)/, "pool: plain (no hook), 1% LP fee");
  if (/new GBootFeeHook|new GBootPriceFeed|import \{ (GBootFeeHook|GBootPriceFeed) \}/.test(read(launch))) throw new Error("tokenomics drift: the launch default must not deploy the hook or the TWAP feed");
  expect(launch, /new GBootFixedPrice\(\)/, "sinks priced by GBootFixedPrice");
  expect(launch, /new LiquidityLock\([^;]*RF, address\(gboot\), pot\s*\)/, "LiquidityLock wired to the Cup pot");
  expect(launch, /new EdgeSplitter\([^;]*key, pot, operator\)/, "EdgeSplitter wired to the Cup pot");
  expect("contracts/src/GBootFixedPrice.sol", /RFPERGBOOTWAD = 0.1e18;/, "fixed price 0.1 RF per $GBOOT");
  expect("contracts/src/GBootFeeHook.sol", /FEEBPS = 100;/, "hook (designed, off until audited) fee 1%");
  expect("contracts/src/GBootPriceFeed.sol", /PERIOD = 30 minutes;[\s\S]*MAXDEVIATIONTICKS = 1000;/, "TWAP 30 min, 1,000-tick guard");
  expect("contracts/src/EdgeSplitter.sol", /BURNBPS = 4000;[\s\S]*BUYBACKBPS = 3000;/, "edge split 40/30/30");
  expect("contracts/src/Bootroom.sol", /MAXWEEKS = 52;[\s\S]*MAXLACE = 10000e18;[\s\S]*XMAX = 520000;[\s\S]*TIER2BPS = 5000;[\s\S]*TIER3BPS = 8500;/, "Bootroom constants");
  if (/function (boostBps|dropBps)\(/.test(read("contracts/src/Bootroom.sol"))) throw new Error("tokenomics drift: the Bootroom must not expose a payout multiplier");
  expect("contracts/src/FriendsAirdrop.sol", /LOCKWEEKS = 12;[\s\S]*CLAIMWINDOW = 180 days;/, "airdrop lock 12 weeks, 180-day window");
  expect("contracts/src/SkillCup.sol", /ENTRYRF = 10e18;[\s\S]*WEEKLYLIMIT = 20;/, "Skill Cup entry 10 RF");
  expect("contracts/src/Wildcards.sol", /PRICERF = 10e18;/, "Wildcards 10 RF");
  expect("contracts/src/RewardsDistributor.sol", /MAXGENERATION = 4;[\s\S]*SEASONWEEKS = 4;[\s\S]*DAILYCAPRF = 3e18;[\s\S]*ENTRYCAPBPS = 2000;[\s\S]*MAXVALIDITY = 7 days;/, "rewards caps");
  expect("contracts/src/LiquidityLock.sol", /BURNBPS = 5000;[\s\S]*burned = \(amount \* BURNBPS\) \/ 10000;\s*toPot = amount - burned;[\s\S]*\.burn\(burned\)[\s\S]*safeTransfer\(pot, toPot\)/, "LP fees: 50% burned / 50% to the pot, each side");
  return true;
}
