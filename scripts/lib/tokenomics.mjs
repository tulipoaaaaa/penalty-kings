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
  bounty: { total: ALLOCATION.bounty, weeklyCap: 50_000, halvingWeeks: 0 },
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

/** Bootroom constants and an exact BigInt port of boostBps / dropBps / log2Wad. */
export const BOOTROOM = { MAX_WEEKS: 52, MAX_LACE: 10_000, X_MAX: 520_000, BPS: 10_000 };
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
/** boostBps for a live lace of `amount` whole $GBOOT for `lockWeeks` weeks (expired or empty → 10,000). */
export function boostBps(amount, lockWeeks) {
  const BPS = BigInt(BOOTROOM.BPS);
  if (!(amount > 0) || !(lockWeeks > 0)) return BOOTROOM.BPS;
  const counted = BigInt(Math.floor(Math.min(amount, BOOTROOM.MAX_LACE)));
  const x = counted * BigInt(lockWeeks);
  if (x >= BigInt(BOOTROOM.X_MAX)) return 2 * BOOTROOM.BPS;
  return Number(BPS + (BPS * log2Wad(E18 + x * E18)) / log2Wad(E18 + BigInt(BOOTROOM.X_MAX) * E18));
}
/** Bootroom.dropBps: 1 + (boost − 1) / 2. */
export const dropBpsOf = boost => BOOTROOM.BPS + Math.floor((boost - BOOTROOM.BPS) / 2);

/** FriendsAirdrop, SkillCup, Wildcards, LiquidityLock / pool. */
export const AIRDROP = { LOCK_WEEKS: 12, CLAIM_WINDOW_DAYS: 180 };
export const SKILL_CUP = { ENTRY: 100, BURN_SHARE: 0.5, WEEKLY_LIMIT: 20 };
export const WILDCARD = { PRICE: 100, BURN_SHARE: 0.5 };
export const POOL = { FEE: 0.01, UNLOCK_DAYS: 180 };
/** Nominal launch price used by the drop schedule (games/penalty-kings/economy.ts); the tick-snapped pool start is 0.10027. */
export const NOMINAL_PRICE = 0.1;
export const DROP_SHARE = 0.02;           // base drop value = 2% of the ball price at ×1 (economy.ts)
export const MAX_DROP_BPS = dropBpsOf(2 * BOOTROOM.BPS); // ×1.5 at the maximum boost → drops ≤ 3%

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
  expect(launch, /bounty = new EmissionVault\([^;]*50000e18, 0\)/, "bounty vault 50k/week flat");
  expect(launch, /PoolKey\(address\(gboot\), RF, 10000, 200/, "pool fee 1%");
  expect("contracts/src/EdgeSplitter.sol", /BURNBPS = 4000;[\s\S]*BUYBACKBPS = 3000;/, "edge split 40/30/30");
  expect("contracts/src/Bootroom.sol", /MAXWEEKS = 52;[\s\S]*MAXLACE = 10000e18;[\s\S]*XMAX = 520000;/, "Bootroom constants");
  expect("contracts/src/FriendsAirdrop.sol", /LOCKWEEKS = 12;[\s\S]*CLAIMWINDOW = 180 days;/, "airdrop lock 12 weeks, 180-day window");
  expect("contracts/src/SkillCup.sol", /ENTRY = 100e18;[\s\S]*WEEKLYLIMIT = 20;/, "Skill Cup entry 100");
  expect("contracts/src/Wildcards.sol", /PRICE = 100e18;/, "Wildcards 100");
  expect("contracts/src/LiquidityLock.sol", /if \(burned0 > 0\) IBurnableCurrency\(currency0\)\.burn[\s\S]*if \(burned1 > 0\) IBurnableCurrency\(currency1\)\.burn/, "LP fees burned on both sides");
  return true;
}
