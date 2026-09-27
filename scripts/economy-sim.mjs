// Penalty Kings economy simulator (tokenomics v2: 100M $GBOOT).
// Every constant comes from contracts/src, contracts/script/Launch.s.sol and games/penalty-kings/*
// (scripts/lib/tokenomics.mjs asserts that the Solidity still says the same thing). It validates
// prize-bank solvency, the halving supply schedule, burns per unit of volume, lacing perk tiers
// (progression only), airdrop sizing, Sudden Death, the pool, the farm checks, the $GBOOT rewards
// bound (RewardsDistributor), the weekly scale table and the Cup pot sources, then writes
// each generated block into docs/ECONOMY.md between its <!-- SIM:<name>:START/END --> markers.
//
//   node scripts/economy-sim.mjs          full run, rewrites the docs/ECONOMY.md blocks
//   node scripts/economy-sim.mjs --smoke  fewer Monte Carlo runs, same assertions, writes nothing (CI)
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { rfUsd, rfPerEth, MARKET_FEE, SNAPSHOT } from "./lib/market.mjs";
import {
  SUPPLY, ALLOCATION, VAULTS, capOf, releasedBy, EDGE_SPLIT, splitEdgeWei, BOOTROOM, progressBps, perkTier, PERKS,
  AIRDROP, SKILL_CUP, WILDCARD, POOL, LOCK, FIXED_PRICE, NOMINAL_PRICE, DROP_SHARE, TWAP, REWARDS, checkContracts,
} from "./lib/tokenomics.mjs";
import { planPool } from "./onchain/pool-plan.mjs";

const SMOKE = process.argv.includes("--smoke");
checkContracts();

// ── Game constants (games/penalty-kings/tiers/*.json; verify-odds asserts those) ──
export const CHANCES = [3150, 2700, 2000, 1100, 700, 250, 100];
export const PAYOUT_X = [0, 0.5, 1, 1.5, 2.5, 5, 10];
export const DROP_MULT = [1, 1.5, 2, 3, 5, 8, 15];
export const RACE_POINTS = [0, 0, 0, 0, 0, 1, 2];
export const TIERS = [
  { id: "park", price: 10, bank: 20_000, raceWeight: 1 },
  { id: "pro", price: 1_000, bank: 200_000, raceWeight: 100 },
  { id: "champions", price: 10_000, bank: 2_000_000, raceWeight: 1000 },
];
export const EDGE = 0.1;                  // 1 − 90% RTP
export const RETAIN_WHILE_GROWING = 0.1;  // operator policy: share of the weekly surplus kept in a growing bank before the split
export const AVG_DROP_MULT = CHANCES.reduce((s, c, i) => s + c * DROP_MULT[i], 0) / 10000; // 2.15
export const RACE_EV = CHANCES.reduce((s, c, i) => s + c * RACE_POINTS[i], 0) / 10000;    // 0.045

const mean = PAYOUT_X.reduce((s, x, i) => s + x * CHANCES[i], 0) / 10000;
const variance = PAYOUT_X.reduce((s, x, i) => s + (x - mean) ** 2 * CHANCES[i], 0) / 10000;
const SD = Math.sqrt(variance);
assert.ok(Math.abs(mean - 0.9) < 1e-12, "RTP 90%");
assert.ok(Math.abs(AVG_DROP_MULT - 2.15) < 1e-12);

// The launch schedule is economy.ts TIERS baseDrop (0.93 / 93 / 930): 2% × price ÷ 0.1 ÷ 2.15, rounded down.
const SCHEDULE = {};
const scheduleBase = price => SCHEDULE[price];
{
  const src = await readFile(new URL("../games/penalty-kings/economy.ts", import.meta.url), "utf8");
  for (const tier of TIERS) {
    const m = src.match(new RegExp(`id: "${tier.id}"[^}]*priceRF: (\\d+)[^}]*baseDrop: ([\\d.]+)`));
    assert.ok(m, `economy.ts tier ${tier.id}`);
    assert.equal(Number(m[1]), tier.price, `${tier.id} price`);
    const formula = (DROP_SHARE * tier.price) / NOMINAL_PRICE / AVG_DROP_MULT;
    SCHEDULE[tier.price] = Number(m[2]);
    assert.ok(SCHEDULE[tier.price] <= formula && SCHEDULE[tier.price] > formula * 0.999, `${tier.id} baseDrop ≈ 2% × price ÷ 0.1 ÷ 2.15 (${formula})`);
  }
  // economy.ts shows the preview prices in $GBOOT at the 0.1 launch price; on-chain they are 10 RF each.
  assert.match(src, /WILDCARD_PRICE = 100;/); assert.match(src, /SKILL_CUP_ENTRY = 100;/);
  assert.equal(WILDCARD.PRICE_RF, 100 * NOMINAL_PRICE); assert.equal(SKILL_CUP.ENTRY_RF, 100 * NOMINAL_PRICE);
}

// ── Pool (scripts/onchain/pool-plan.mjs: tick-snapped start, position A range) ──
const plan = planPool("0xffffffffffffffffffffffffffffffffffffffff");
export const START_PRICE = plan.startPriceRfPerGboot;              // ≈ 0.10027 RF per $GBOOT
const [A_LOW, A_HIGH] = plan.positionA.gbootPriceRange;            // ≈ 0.10027 … 99.46
const L_A = ALLOCATION.pool / (1 / Math.sqrt(A_LOW) - 1 / Math.sqrt(A_HIGH));
export const rfToMultiply = m => (L_A * (Math.sqrt(A_LOW * m) - Math.sqrt(A_LOW))) / (1 - POOL.FEE);
const gbootOutFor = m => L_A * (1 / Math.sqrt(A_LOW) - 1 / Math.sqrt(A_LOW * m));
assert.ok(Math.abs(START_PRICE * SUPPLY / 1e6 - 10.03) < 0.01, "FDV ≈ 10.03M RF");

// ── Drops: base = min(schedule, 2% × price ÷ TWAP ÷ 2.15); no lacing multiplier; weekly total ≤ vault cap ──
export const baseDropAt = (price, twap) => Math.min(scheduleBase(price), (DROP_SHARE * price) / twap / AVG_DROP_MULT);
/** $GBOOT dropped per RF of ball volume at a given TWAP (the same for every Friend: lacing is not a payout). */
const dropsPerRf = twap => (baseDropAt(10, twap) * AVG_DROP_MULT) / 10;

// ── Edge path per RF of ball volume (expected values) ──
const SWEEP = EDGE * (1 - RETAIN_WHILE_GROWING);                   // RF reaching the EdgeSplitter per RF of volume
const perRf = {
  rfBurned: SWEEP * EDGE_SPLIT.burnBps / 1e4,
  rfSwapped: SWEEP * EDGE_SPLIT.buybackBps / 1e4,
  rfCup: SWEEP * EDGE_SPLIT.cupBps / 1e4,
};
perRf.lpFee = perRf.rfSwapped * POOL.FEE;                         // the buy-back swap pays the 1% LP fee in RF (its input side) to the locked positions
perRf.lpFeeBurned = perRf.lpFee * LOCK.BURN_BPS / 1e4;             // LiquidityLock.collect: half burned …
perRf.lpFeePot = perRf.lpFee - perRf.lpFeeBurned;                  // … half to the Cup pot
/** $GBOOT bought back and burned per RF of ball volume (price impact ignored: see the pool table). */
const buybackPerRf = price => (perRf.rfSwapped * (1 - POOL.FEE)) / price;
{ // the float model agrees with EdgeSplitter's integer maths
  const s = splitEdgeWei(10n ** 24n);
  assert.equal(s.burn + s.buyback + s.cup, 10n ** 24n);
  assert.equal(s.burn * 10_000n, 10n ** 24n * BigInt(EDGE_SPLIT.burnBps));
}

// ── Weekly scale model ──
const MIX = [ // share of daily players, balls per player per day
  { tier: 0, share: 0.8, balls: 15 },
  { tier: 1, share: 0.18, balls: 3 },
  { tier: 2, share: 0.02, balls: 1 },
];
const CONCURRENCY = 0.05;
const FRESH_RF_SHARE = 0.25;
export const weeklyVolume = players => MIX.reduce((s, m) => s + players * m.share * m.balls * 7 * TIERS[m.tier].price, 0);
assert.equal(weeklyVolume(50), 301_000);

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CUM = CHANCES.reduce((a, c) => [...a, (a.at(-1) ?? 0) + c], []);
const draw = random => { const roll = Math.floor(random() * 10000); return CUM.findIndex(c => roll < c); };

// ── Formatting ──
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = rf => `$${fmt(rf * rfUsd, rf * rfUsd < 100 ? 2 : 0)}`;
const M = n => `${fmt(n / 1e6, 2)}M`;
const blocks = {};
const header = `_Generated by \`node scripts/economy-sim.mjs\` from the contracts and game constants (market snapshot from the RF/WETH and WETH/USDG Uniswap v4 pools at block ${SNAPSHOT.block.toLocaleString("en-US")}: 1 RF = $${rfUsd.toFixed(5)}, 1 ETH = ${fmt(rfPerEth)} RF. The game itself shows the LIVE price, read every 60 s from the same pools; see docs/ADDRESSES.md)._`;

// ═════ 1. Supply over time (halving schedule + burns) ═════
const SCENARIOS = [
  { name: "no play", players: 0 },
  { name: "50 players/day", players: 50 },
  { name: "500 players/day", players: 500 },
  { name: "5,000 players/day", players: 5000 },
];
export const SELL_SHARE = 0.5;               // assumption: recipients sell half of everything vaults release, the week they get it
const FLOOR_RF = 250_000;                    // Launch size: position B, the RF floor (docs/DEPLOYMENT.md budget)
const floorPlan = planPool("0xffffffffffffffffffffffffffffffffffffffff", BigInt(FLOOR_RF));
const [B_LOW, B_HIGH] = floorPlan.positionB.gbootPriceRange;
const L_B = Number(floorPlan.positionB.liquidity) / 1e18;
/** Liquidity (RF-per-$GBOOT price space) of the launch positions: B (RF floor) below the start, A above. */
const SEGMENTS = [{ lo: B_LOW, hi: B_HIGH, L: L_B }, { lo: B_HIGH, hi: A_LOW, L: 0 }, { lo: A_LOW, hi: A_HIGH, L: L_A }];
/** Swap against the launch positions (1% fee). Buy: RF in → $GBOOT out. Sell: $GBOOT in → RF out. Returns [out, newPrice]. */
export function swap(price, amountIn, buy) {
  let sp = Math.sqrt(price), left = amountIn * (1 - POOL.FEE), out = 0;
  const segs = buy ? SEGMENTS : [...SEGMENTS].reverse();
  for (const seg of segs) {
    const lo = Math.sqrt(seg.lo), hi = Math.sqrt(seg.hi);
    if (buy ? sp >= hi : sp <= lo) continue;
    if (seg.L === 0) { sp = buy ? hi : lo; continue; }
    if (buy) { const room = seg.L * (hi - sp), use = Math.min(left, room), next = sp + use / seg.L; out += seg.L * (1 / sp - 1 / next); left -= use; sp = next; }
    else { const room = seg.L * (1 / lo - 1 / sp), use = Math.min(left, room), next = 1 / (1 / sp + use / seg.L); out += seg.L * (sp - next); left -= use; sp = next; }
    if (left <= 1e-9) break;
  }
  return [out, sp * sp];
}
/** Week-by-week projection. Each week: the edge buy-back buys and burns $GBOOT; drops (auto-scaled to the
 *  current price, ≤ capOf), the Cups and rewards vaults (full cap) and, from week 12, the
 *  airdrop (all claimed, unlaced at expiry) are released and SELL_SHARE of each release is sold. */
function project(players, weeks = 104) {
  const volume = weeklyVolume(players);
  const rem = { drops: VAULTS.drops.total, cups: VAULTS.cups.total, bounty: VAULTS.bounty.total };
  let burned = 0, released = 0, drops = 0, price = START_PRICE;
  const rows = [{ week: 0, supply: SUPPLY, burned: 0, released: 0, drops: 0, price }];
  for (let week = 0; week < weeks; week++) {
    const [bought, afterBuy] = swap(price, volume * perRf.rfSwapped, true);
    burned += bought; price = afterBuy;
    const d = Math.min(volume * dropsPerRf(price), capOf(VAULTS.drops, week), rem.drops);
    const c = Math.min(capOf(VAULTS.cups, week), rem.cups), b = Math.min(capOf(VAULTS.bounty, week), rem.bounty);
    const air = week + 1 === AIRDROP.LOCK_WEEKS ? ALLOCATION.airdrop : 0;
    rem.drops -= d; rem.cups -= c; rem.bounty -= b; drops += d; released += d + c + b + air;
    if (d + c + b + air > 0) price = swap(price, (d + c + b + air) * SELL_SHARE, false)[1];
    rows.push({ week: week + 1, supply: SUPPLY - burned, burned, released, drops, price });
  }
  return rows;
}
const projections = SCENARIOS.map(s => ({ ...s, rows: project(s.players) }));
const MILESTONES = [0, 4, 8, 12, 16, 26, 52, 78, 104];
{
  const out = [header, "",
    "**Schedule (independent of volume).** Week *w* counts from the vault's `start` (week 0 = launch week). Caps are upper bounds; a week's unused cap is lost.", "",
    "| After week | Drop cap in the last week | Drops released, max (Σ capOf) | Drop vault left, min | Cups vault released, max | Rewards vault released, max | Airdrop unlocked, max | **Max $GBOOT released from vaults** |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const w of MILESTONES) {
    const drops = releasedBy(VAULTS.drops, w), cups = releasedBy(VAULTS.cups, w), bounty = releasedBy(VAULTS.bounty, w);
    const air = w >= AIRDROP.LOCK_WEEKS ? ALLOCATION.airdrop : 0;
    out.push(`| ${w} | ${w ? fmt(capOf(VAULTS.drops, w - 1)) : "—"} | ${fmt(drops)} | ${fmt(VAULTS.drops.total - drops)} | ${fmt(cups)} | ${fmt(bounty)} | ${fmt(air)} | **${fmt(drops + cups + bounty + air)}** |`);
  }
  assert.equal(releasedBy(VAULTS.drops, 4), 10_000_000, "first season releases at most 10M");
  assert.equal(releasedBy(VAULTS.drops, 26), 19_765_625, "26 weeks: 20M × (1 − 2⁻⁶) + 2 × 39,062.5");
  assert.equal(releasedBy(VAULTS.cups, 104), 10_000_000, "cups vault empties at week 100");
  assert.equal(releasedBy(VAULTS.bounty, 52), 2_600_000, "rewards vault: 50k/week in year 1");
  assert.equal(releasedBy(VAULTS.bounty, 104), 3_900_000, "rewards vault: 25k/week in year 2");
  out.push("", `**Total supply (100M minus everything burned), price-responsive.** Each week the edge buy-back buys $GBOOT through the launch positions (A: 55M $GBOOT from ${A_LOW.toFixed(4)} RF up; B: a ${fmt(FLOOR_RF)} RF floor from ${B_LOW.toFixed(4)} to ${B_HIGH.toFixed(4)} RF) and burns it; then drops (auto-scaled to the new price; lacing no longer multiplies them), the full Cups and rewards-vault caps (the rewards vault's real budget is also capped by the previous season's sink burns, so this over-counts it) and, at week ${AIRDROP.LOCK_WEEKS}, the whole airdrop are released and **${SELL_SHARE * 100}% of every release is sold** into the pool. Burns counted: the buy-back only; Skill Cup, Wildcard, KitShop, early-unlace and LP-fee burns are extra. These are stress assumptions, not forecasts.`, "",
    "| Scenario | Ball volume / week | Week 0 | Week 26 | Week 52 | Week 104 | $GBOOT burned by wk 104 | Drops paid by wk 104 | Price wk 104 (RF) |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const p of projections) {
    const at = w => p.rows[w];
    out.push(`| ${p.name} | ${fmt(weeklyVolume(p.players))} RF (${usd(weeklyVolume(p.players))}) | ${fmt(at(0).supply)} | ${fmt(at(26).supply)} | ${fmt(at(52).supply)} | ${fmt(at(104).supply)} | ${fmt(at(104).burned)} | ${fmt(at(104).drops)} | ${fmt(at(104).price, 4)} |`);
    assert.ok(at(104).supply <= SUPPLY && at(104).supply > 0);
  }
  // ASCII charts: the drop cap per week (halving) and cumulative releases.
  const bar = (v, max, width = 40) => "█".repeat(Math.round((v / max) * width)).padEnd(width, "·");
  out.push("", "```text", "Drop vault: weekly cap (halves every 4 weeks)            cumulative drops released (max, of 20M)");
  for (let w = 0; w <= 52; w += 4) {
    const cap = capOf(VAULTS.drops, w), cum = releasedBy(VAULTS.drops, w + 1);
    out.push(`wk ${String(w).padStart(3)} ${bar(cap, 2_500_000, 24)} ${fmt(cap).padStart(9)}   ${bar(cum, 20_000_000, 24)} ${M(cum).padStart(7)}`);
  }
  const hi = projections.at(-1).rows, floor = Math.floor(Math.min(...hi.map(r => r.supply)) / 5e6) * 5e6;
  out.push("", `Total supply, "${projections.at(-1).name}" (axis ${M(floor)} … ${M(SUPPLY)} $GBOOT)`);
  for (let w = 0; w <= 104; w += 8) out.push(`wk ${String(w).padStart(3)} ${bar(hi[w].supply - floor, SUPPLY - floor)} ${M(hi[w].supply).padStart(7)}`);
  out.push("```");
  blocks.supply = out;
}

// ═════ 2. Burns and the deflation needed per unit of volume ═════
{
  const P = START_PRICE, rfPerUsd = 1 / rfUsd;
  const out = [header, "",
    "Per **1 RF of ball volume** (expected values; the edge is 10%, the growing bank keeps 10% of it):", "",
    "| Path | Formula | RF per RF of volume | Per $1 of volume |", "|---|---|---:|---:|",
    `| RF burned by EdgeSplitter | 0.10 × (1 − 0.10) × 40% | ${perRf.rfBurned.toFixed(4)} RF | ${fmt(perRf.rfBurned * rfPerUsd, 1)} RF |`,
    `| RF swapped for $GBOOT (buy-back) | 0.10 × 0.90 × 30% | ${perRf.rfSwapped.toFixed(4)} RF | ${fmt(perRf.rfSwapped * rfPerUsd, 1)} RF |`,
    `| … its 1% LP fee (paid in RF to the locked positions; \`LiquidityLock.collect\` burns half, the pot gets half) | 0.027 × 1% | ${perRf.lpFee.toFixed(5)} RF (${perRf.lpFeeBurned.toFixed(6)} burned) | ${fmt(perRf.lpFee * rfPerUsd, 2)} RF |`,
    `| **$GBOOT bought and burned** | 0.027 × 0.99 ÷ P | **${fmt(buybackPerRf(P), 4)} $GBOOT** at P = ${P.toFixed(5)} | **${fmt(buybackPerRf(P) * rfPerUsd, 1)} $GBOOT** |`,
    `| RF to the Golden Boot Cup | 0.10 × 0.90 × 30% | ${perRf.rfCup.toFixed(4)} RF | ${fmt(perRf.rfCup * rfPerUsd, 1)} RF |`,
    `| **Total RF burned** | 0.036 + 0.027 × 1% × 50% | **${(perRf.rfBurned + perRf.lpFeeBurned).toFixed(5)} RF** | **${fmt((perRf.rfBurned + perRf.lpFeeBurned) * rfPerUsd, 1)} RF** |`,
    `| $GBOOT dropped (emitted) | 2% ÷ price (no lacing multiplier) | ${fmt(dropsPerRf(P), 4)} $GBOOT | ${fmt(dropsPerRf(P) * rfPerUsd, 1)} $GBOOT |`,
    "",
    `Both sides scale as 1 ÷ price, so the ratio is price-independent: burned ÷ dropped = 2.673% ÷ 2% = ${(0.02673 / 0.02).toFixed(4)} (the LP fee's RF burn is extra). **Ball play is always net deflationary for $GBOOT** (lacing no longer raises drops): every RF of ball volume burns ${fmt(buybackPerRf(P) - dropsPerRf(P), 4)} more $GBOOT than it drops at P = ${P.toFixed(5)}.`,
    "", `Pool trading adds more: the plain pool charges a ${POOL.FEE * 100}% LP fee on every swap's input side (RF on buys, $GBOOT on sells). The locked positions earn it, and anyone's weekly \`LiquidityLock.collect\` burns ${LOCK.BURN_BPS / 100}% of each side and sends ${100 - LOCK.BURN_BPS / 100}% to the Cup pot, so **1 RF of $GBOOT trading volume burns 0.005 RF-equivalent and adds 0.005 RF-equivalent to the pot** (while the lock holds all of the pool's liquidity; after the ${POOL.UNLOCK_DAYS}-day unlock the beneficiary may withdraw the positions, and the fees then follow the NFTs).`,
    "", "**Break-even weekly ball volume** (burns = emissions, the full Cups + rewards-vault releases of 150,000 $GBOOT included, all vaults releasing their full cap; the rewards vault really pays at most the previous season's sink burns, so this is conservative):", "",
    "| Week | Drop cap | Break-even ball volume |", "|---:|---:|---:|"];
  const flat = VAULTS.cups.weeklyCap + VAULTS.bounty.weeklyCap;
  const breakEven = week => {
    const net = buybackPerRf(P) - dropsPerRf(P); // $GBOOT per RF of volume, drops uncapped
    const cap = capOf(VAULTS.drops, week);
    const cands = [];
    if (net > 0) { const v = flat / net; if (v * dropsPerRf(P) <= cap) cands.push(v); }
    const vCapped = (cap + flat) / buybackPerRf(P); if (vCapped * dropsPerRf(P) >= cap) cands.push(vCapped);
    return Math.min(...cands);
  };
  for (const w of [0, 4, 8, 12, 16, 20, 24, 52]) { const v = breakEven(w); out.push(`| ${w} | ${fmt(capOf(VAULTS.drops, w))} | ${fmt(v)} RF (${usd(v)}) |`); }
  assert.ok(buybackPerRf(P) > dropsPerRf(P), "ball play burns more $GBOOT than it drops");
  out.push("", "Formula: with *b* = 0.02673 ÷ P $GBOOT burned per RF and *d* = 0.02 ÷ P dropped per RF, the break-even volume is V = 150,000 ÷ (b − d) while drops are under the cap, else V = (capOf(week) + 150,000) ÷ b. Above it, total supply falls faster than vaults release.");
  blocks.burn = out;
}

// ═════ 3. Lacing scenarios (Bootroom.progressBps / perkTier, exact port): progression only ═════
{
  const amounts = [1, 100, 1_000, 10_000, 50_000], weeks = [1, 4, 12, 26, 52];
  const out = [header, "", "Perk tier (lacing progress in brackets) for a live lace of *amount* $GBOOT committed for *weeks*. **A perk tier is not a multiplier**: race points, drops, Cup ranks and rewards are identical for every tier.", "",
    `| Laced | ${weeks.map(w => `${w} wk`).join(" | ")} |`, `|---:|${weeks.map(() => "---:").join("|")}|`];
  for (const a of amounts) out.push(`| ${fmt(a)} | ${weeks.map(w => `T${perkTier(a, w)} (${(progressBps(a, w) / 100).toFixed(0)}%)`).join(" | ")} |`);
  assert.equal(progressBps(10_000, 52), 10_000); assert.equal(progressBps(50_000, 52), 10_000, "MAX_LACE caps the curve");
  assert.equal(perkTier(100, 7), 1); assert.equal(perkTier(100, 8), 2); assert.equal(perkTier(10_000, 7), 2); assert.equal(perkTier(10_000, 8), 3);
  out.push("", "What each tier gives (progression; proposed values, the owner decides the exact perks):", "",
    "| Tier | Progress | XP bonus | Cosmetic | Cup seeding (display / draw order only) | Ball value (RF + drops) |", "|---:|---|---:|---|---|---:|");
  const ballValue = 0.9 + (baseDropAt(10, START_PRICE) * AVG_DROP_MULT * START_PRICE) / 10;
  const bands = ["0 (none or expired)", "> 0", `≥ ${BOOTROOM.TIER2_BPS / 100}%`, `≥ ${BOOTROOM.TIER3_BPS / 100}%`];
  for (const perk of PERKS) out.push(`| ${perk.tier} | ${bands[perk.tier]} | +${perk.xpBonusPct}% | ${perk.cosmetic} | ${perk.seeding} | ${(ballValue * 100).toFixed(2)}% |`);
  assert.ok(ballValue <= 0.93 + 1e-9, "a ball stays ≤ 93% at every tier");
  blocks.lacing = out;
}

// ═════ 4. Airdrop sizing (FriendsAirdrop: 10M, pre-laced for 12 weeks) ═════
{
  const out = [header, "", `Equal split of ${fmt(ALLOCATION.airdrop)} $GBOOT across N eligible Friends, each laced for ${AIRDROP.LOCK_WEEKS} weeks:`, "",
    "| Eligible Friends N | $GBOOT per Friend | ≈ RF at launch price | Counted for the perk curve (≤ 10,000) | Perk tier for 12 weeks (progress) | Uncounted $GBOOT (no extra progress) |", "|---:|---:|---:|---:|---:|---:|"];
  for (const n of [250, 500, 1_000, 2_000, 5_000, 10_000, 20_000]) {
    const each = Math.floor(ALLOCATION.airdrop / n), counted = Math.min(each, BOOTROOM.MAX_LACE);
    out.push(`| ${fmt(n)} | ${fmt(each)} | ${fmt(each * START_PRICE)} | ${fmt(counted)} | T${perkTier(each, AIRDROP.LOCK_WEEKS)} (${(progressBps(each, AIRDROP.LOCK_WEEKS) / 100).toFixed(0)}%) | ${fmt(Math.max(0, each - BOOTROOM.MAX_LACE) * n)} |`);
  }
  const unclaimedWeeks = AIRDROP.CLAIM_WINDOW_DAYS / 7;
  out.push("", `Unclaimed $GBOOT can be swept to the Cups & events vault after the ${AIRDROP.CLAIM_WINDOW_DAYS}-day window (≈ ${unclaimedWeeks.toFixed(1)} weeks). The vault's flat 100,000/week cap does not change, so a sweep of S $GBOOT extends its runway by S ÷ 100,000 weeks (a full 10M sweep: +100 weeks).`);
  blocks.airdrop = out;
}

// ═════ 5. Sudden Death solvency ═════
{
  const out = [header, "", "Big Match rule: after 5 kicks with 3+ goals, every further goal scores ×2 until the first miss. Expected extra kicks for goal rate *p* (geometric run) and the most one kick can score (`packages/engine` goalPoints: 100 × keeper ≤ 2.5 × ball × streak ≤ 3 × Sudden Death 2 × top bin 5 × post-in 1.5):", "",
    "| Goal rate p | P(reach Sudden Death) = P(≥3 of 5) | Expected Sudden Death kicks, p ÷ (1 − p) | P(run ≥ 10 goals) = p¹⁰ |", "|---:|---:|---:|---:|"];
  const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  for (const p of [0.55, 0.6, 0.65]) {
    const reach = [3, 4, 5].reduce((s, k) => s + binom(5, k) * p ** k * (1 - p) ** (5 - k), 0);
    out.push(`| ${(p * 100).toFixed(0)}% | ${(reach * 100).toFixed(1)}% | ${(p / (1 - p)).toFixed(2)} | ${(p ** 10 * 100).toFixed(2)}% |`);
  }
  const maxKick = 100 * 2.5 * 3 * 2 * 5 * 1.5;
  out.push("", `Largest single-kick score ≤ ${fmt(maxKick)} points × the ball multiplier. **Points carry zero RF or $GBOOT liability**: every RF payout was fixed by Dice when the ball was placed (the prize bank reserved 10 × price for it), and the Skill Cup referee scores with Sudden Death off (\`verifier/src/core.ts\`: \`goalPoints(…, false, …)\`) over exactly 5 kicks.`);
  blocks.suddendeath = out;
}

// ═════ 6. Solvency (prize banks) ═════
function ruinProbability(barrier, runs, horizon, seed) {
  const random = rng(seed); let hits = 0;
  for (let run = 0; run < runs; run++) {
    let bank = 0;
    for (let ball = 0; ball < horizon; ball++) { bank += 1 - PAYOUT_X[draw(random)]; if (bank <= -barrier) { hits++; break; } }
  }
  return hits / runs;
}
const theory = barrier => Math.exp((-2 * EDGE * barrier) / variance);
const THETA = (() => { // exact Lundberg exponent: E[exp(−θ·(1 − payout))] = 1
  const f = t => PAYOUT_X.reduce((sum, v, i) => sum + (CHANCES[i] / 10000) * Math.exp(-t * (1 - v)), 0) - 1;
  let lo = 0.01, hi = 0.5;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
})();
const lundberg = barrier => Math.exp(-THETA * barrier);
{
  const runs = SMOKE ? 2000 : 20000, horizon = SMOKE ? 4000 : 20000, barriers = SMOKE ? [10, 20] : [10, 20, 30, 40];
  const out = [header, "", `Per ball, in units of the ball price: mean payout ${mean.toFixed(2)}, standard deviation **${SD.toFixed(3)}**, edge **${EDGE.toFixed(2)}**, variance ${variance.toFixed(3)}.`, "",
    "| Loss barrier (ball prices) | Simulated P(ever reached) | Normal approx. exp(−2·edge·N/σ²) | Exact upper bound exp(−θ·N), θ = " + THETA.toFixed(4) + " |", "|---:|---:|---:|---:|"];
  for (const barrier of barriers) {
    const p = ruinProbability(barrier, runs, horizon, 1000 + barrier);
    out.push(`| ${barrier} | ${p.toExponential(2)} | ${theory(barrier).toExponential(2)} | ${lundberg(barrier).toExponential(2)} |`);
    assert.ok(p <= lundberg(barrier) * 1.1 + 5 / runs, `solvency at ${barrier}: sim ${p} exceeds Lundberg bound ${lundberg(barrier)}`);
  }
  out.push(`| **100** | (too rare to sample) | ${theory(100).toExponential(2)} | **${lundberg(100).toExponential(2)}** |`, "",
    `${fmt(runs)} runs × ${fmt(horizon)} balls per barrier. The exact Lundberg bound sits above every simulated value, so "a bank ever falls 100 ball prices below its start" has probability **at most ≈ ${lundberg(100).toExponential(0)}**. Only the surplus above the opening bank is swept (high-water sweep), so the drift always applies below the start.`, "",
    "| Stadium | Ball | Top prize | Opening bank | Balls in flight (bank ÷ top prize) |", "|---|---:|---:|---:|---:|");
  for (const t of TIERS) out.push(`| ${t.id} | ${fmt(t.price)} RF | ${fmt(t.price * 10)} RF | ${fmt(t.bank)} RF | ${fmt(t.bank / (t.price * 10))} |`);
  blocks.solvency = out;
}

// ═════ 7. Pool ═════
{
  const out = [header, "", `Position A: ${fmt(ALLOCATION.pool)} $GBOOT single-sided from ${A_LOW.toFixed(5)} to ${A_HIGH.toFixed(2)} RF per $GBOOT (tick-snapped by pool-plan.mjs). L = ${fmt(L_A)}. Start FDV = 100M × ${START_PRICE.toFixed(5)} = **${fmt(SUPPLY * START_PRICE)} RF** (${usd(SUPPLY * START_PRICE)}). RF in = L·(√P₁ − √P₀) ÷ 0.99; $GBOOT out = L·(1/√P₀ − 1/√P₁).`, "",
    "| Price move | New price (RF) | RF that must flow in | ≈ USD | $GBOOT bought out of the pool |", "|---|---:|---:|---:|---:|"];
  for (const m of [2, 10, 100]) out.push(`| ×${m} | ${fmt(A_LOW * m, 3)} | ${fmt(rfToMultiply(m))} | ${usd(rfToMultiply(m))} | ${fmt(gbootOutFor(m))} |`);
  blocks.pool = out;
}

// ═════ 8. Farm checks ═════
{
  const out = [header, "", "RF payout is always 90%. Drops are valued at the $GBOOT market price; there is no lacing multiplier any more:", "",
    "| $GBOOT price | Drop value, fixed schedule | Total, fixed | Drop value, auto-scaled | **Total, auto-scaled** |", "|---|---:|---:|---:|---:|"];
  for (const m of [0.1, 1, 10, 100]) {
    const twap = START_PRICE * m;
    const fixed = (scheduleBase(10) * AVG_DROP_MULT * twap) / 10, scaled = (baseDropAt(10, twap) * AVG_DROP_MULT * twap) / 10;
    out.push(`| ${m}× (${fmt(twap, 4)} RF) | ${(fixed * 100).toFixed(2)}% | ${((0.9 + fixed) * 100).toFixed(2)}% | ${(scaled * 100).toFixed(2)}% | **${((0.9 + scaled) * 100).toFixed(2)}%** |`);
    assert.ok(0.9 + scaled <= 0.92 + 1e-9, "auto-scaled farm check ≤ 92% (≤ 93% bound kept)");
  }
  out.push("", "### Wildcard farm check (RF cost per Golden Boot race point)", "",
    `A Park ball costs 10 RF and returns 9 RF on average plus its drop; a Wildcard returns nothing. **Launch default (no hook):** a Wildcard costs a fixed ${WILDCARD.PRICE_RF / FIXED_PRICE} $GBOOT (\`GBootFixedPrice\`, ${WILDCARD.PRICE_RF} RF at ${FIXED_PRICE} RF per $GBOOT), so its RF cost moves with the market price. **With the audited hook** it would cost ${WILDCARD.PRICE_RF} RF of $GBOOT at the 30-minute TWAP at every price. Both give ${RACE_EV} expected race points; lacing multiplies neither.`, "",
    "| $GBOOT price | Park ball, net RF per point | **Wildcard, RF per point (launch default: fixed 100 $GBOOT)** | Wildcard with the audited hook (TWAP) | … hook worst case: spot 10.5% under the TWAP | Cheaper route (launch default) |", "|---|---:|---:|---:|---:|---|");
  const guard = Math.pow(1.0001, TWAP.MAX_DEVIATION_TICKS); // the divergence guard: spot within 1,000 ticks of the TWAP
  const ballPerPoint = price => (10 * EDGE - baseDropAt(10, price) * AVG_DROP_MULT * price) / RACE_EV;
  const fixedPerPoint = price => (WILDCARD.PRICE_RF / FIXED_PRICE) * price / RACE_EV;
  for (const m of [0.1, 1, 10, 100]) {
    const twap = START_PRICE * m, ball = ballPerPoint(twap), fixed = fixedPerPoint(twap);
    const wildcard = WILDCARD.PRICE_RF / RACE_EV, worst = WILDCARD.PRICE_RF / guard / RACE_EV;
    out.push(`| ${m}× (${fmt(twap, 4)} RF) | ${fmt(ball, 2)} | **${fmt(fixed, 2)}** | ${fmt(wildcard, 2)} | ${fmt(worst, 2)} | ${fixed > ball ? "balls" : "**WILDCARDS**"} |`);
    assert.ok(worst > ball, `with the hook, Wildcards must not be the cheaper route at ${m}×`);
    assert.ok(fixed > ball, `launch default: Wildcards must not be the cheaper route at ${m}×`);
  }
  let lo = 1e-6, hi = START_PRICE; // price below which fixed-price Wildcards beat balls
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (fixedPerPoint(mid) > ballPerPoint(mid)) hi = mid; else lo = mid; }
  out.push("", `**Launch default, known limit:** with fixed $GBOOT prices, a Wildcard is the cheaper route to race points only if $GBOOT trades below **${fmt(hi, 4)} RF** (≈ ${fmt(hi / START_PRICE, 3)}× the launch price, a ${fmt((1 - hi / START_PRICE) * 100, 1)}% fall). The weekly report (\`scripts/cup/weekly.mjs --twap\`) reads the market price, so the operator can see it coming; the structural fix is the audited hook, whose RF pricing removes the break-even: a Wildcard then costs ${WILDCARD.PRICE_RF} RF of $GBOOT at every price (≥ ${fmt(WILDCARD.PRICE_RF / guard, 2)} RF at spot under the divergence guard), while a ball's net cost per point never exceeds ${fmt(10 * EDGE / RACE_EV, 2)} RF. Skill Cup entries (100 $GBOOT) and KitShop items (listed $GBOOT prices) are fixed the same way; their farm check is in $GBOOT and does not depend on the price (see Rewards).`);
  blocks.farm = out;
}

// ═════ 8b. $GBOOT rewards (RewardsDistributor): value per entry, per ball, per season ═════
{
  const P = START_PRICE, guard = Math.pow(1.0001, TWAP.MAX_DEVIATION_TICKS);
  const entry = SKILL_CUP.ENTRY_RF, maxReward = entry * REWARDS.ENTRY_CAP_BPS / 1e4, burned = entry * SKILL_CUP.BURN_SHARE, pot = entry - burned;
  const out = [header, "",
    `Every $GBOOT reward is tied to a **paid** Skill Cup entry (\`SkillCup.entryFriend(entryId) == friendId\`), a hardwired Friend of generation ≤ ${REWARDS.MAX_GENERATION}, a referee EIP-712 signature, a nonce and a deadline ≤ ${REWARDS.MAX_VALIDITY_DAYS} days. Values are signed in RF and converted to $GBOOT (rounded down) at the fixed ${FIXED_PRICE} RF per $GBOOT (launch default, \`GBootFixedPrice\`), or at the 30-minute TWAP with the audited hook. At the fixed price both the entry and the reward are fixed $GBOOT amounts (${SKILL_CUP.ENTRY_RF / FIXED_PRICE} and at most ${SKILL_CUP.ENTRY_RF * REWARDS.ENTRY_CAP_BPS / 1e4 / FIXED_PRICE}), so the shares below hold at every market price.`, "",
    "**Per paid entry** (RF-equivalent at the price source):", "",
    "| Item | RF | Share of the entry |", "|---|---:|---:|",
    `| Entry price (\`SkillCup.ENTRY_RF\`) | ${entry} | 100% |`,
    `| Burned | ${burned} | ${SKILL_CUP.BURN_SHARE * 100}% |`,
    `| To the pot (paid by rank to the week's best scores) | ${pot} | ${(1 - SKILL_CUP.BURN_SHARE) * 100}% |`,
    `| Most rewards for the entry (skill ≤ 1.5 + streak 0.5; \`ENTRY_CAP_BPS\`) | ${maxReward} | ${REWARDS.ENTRY_CAP_BPS / 100}% |`,
    `| … audited hook only: at spot, spot up to 10.5% above the TWAP (divergence guard) | ${fmt(maxReward * guard, 2)} | ${(maxReward * guard / entry * 100).toFixed(1)}% |`,
    `| **Entrant's best case: max reward + the whole pot back** (hook worst case; ${((maxReward + pot) / entry * 100).toFixed(0)}% at the fixed price) | **${fmt(maxReward * guard + pot, 2)}** | **${((maxReward * guard + pot) / entry * 100).toFixed(1)}%** |`,
    "", `So an entry returns at most ${((maxReward * guard + pot) / entry * 100).toFixed(1)}% of its price even if one player wins every pot: farming rewards loses ≥ ${fmt(entry - maxReward * guard - pot, 2)} RF per entry. The per-Friend daily cap (${REWARDS.DAILY_CAP_RF} RF) needs ≥ ${Math.ceil(REWARDS.DAILY_CAP_RF / maxReward)} paid entries (${Math.ceil(REWARDS.DAILY_CAP_RF / maxReward) * entry} RF, ${Math.ceil(REWARDS.DAILY_CAP_RF / maxReward) * burned} RF burned).`, "",
    "**Per ball** (the 10% edge): rewards are not attached to balls, so a ball's value is unchanged:", "",
    "| Stadium | RF return | Drops (at the price) | Rewards | **Total** | Edge kept |", "|---|---:|---:|---:|---:|---:|"];
  for (const t of TIERS) {
    const drop = (baseDropAt(t.price, P) * AVG_DROP_MULT * P) / t.price;
    out.push(`| ${t.id} (${fmt(t.price)} RF) | 90.00% | ${(drop * 100).toFixed(2)}% | 0.00% | **${((0.9 + drop) * 100).toFixed(2)}%** | ${((0.1 - drop) * 100).toFixed(2)}% |`);
    assert.ok(0.9 + drop < 1 && drop < EDGE, "the $GBOOT value of a ball stays below the 10% edge");
  }
  const mixed = Math.max(0.9 + dropsPerRf(P) * P, (maxReward * guard + pot) / entry);
  assert.ok(mixed < 0.93, "balls + entries together stay below 93% per RF spent");
  out.push("", `A player mixing balls and entries gets back at most max(${((0.9 + dropsPerRf(P) * P) * 100).toFixed(2)}%, ${((maxReward * guard + pot) / entry * 100).toFixed(1)}%) = ${(mixed * 100).toFixed(2)}% of every RF spent: the $GBOOT value per RF (drops + rewards) never reaches the 10% edge.`, "",
    `**Per season** (${REWARDS.SEASON_WEEKS} weeks): budget(s) = min(Σ capOf of the rewards vault over the season, $GBOOT burned by KitShop + SkillCup + Wildcards in season s − 1, vault balance), fixed once by the permissionless \`setSeasonBudget()\`. Rewards therefore never exceed the previous season's sink burns: they recycle burned $GBOOT and cannot inflate supply on net. Season 0 pays nothing (no previous season).`, "",
    "| Skill Cup entries / week | Wildcards / week | Sink burns per season (P = launch) | Ceiling, season 1 | **Budget, season 2** | Most the entries can claim (all at the per-entry cap) | Binding |", "|---:|---:|---:|---:|---:|---:|---|");
  const ceiling = s => { let t = 0; for (let w = s * REWARDS.SEASON_WEEKS; w < (s + 1) * REWARDS.SEASON_WEEKS; w++) t += capOf(VAULTS.bounty, w); return t; };
  for (const [e, w] of [[50, 50], [500, 200], [5_000, 1_000], [20_000, 5_000]]) {
    const burnsPerSeason = (e * burned + w * WILDCARD.PRICE_RF * WILDCARD.BURN_SHARE) / P * REWARDS.SEASON_WEEKS;
    const budget = Math.min(ceiling(1), burnsPerSeason), claimable = e * REWARDS.SEASON_WEEKS * maxReward / P;
    const binding = claimable <= budget ? "per-entry caps" : budget === ceiling(1) ? "halving ceiling" : "sink burns";
    out.push(`| ${fmt(e)} | ${fmt(w)} | ${fmt(burnsPerSeason)} | ${fmt(ceiling(1))} | **${fmt(budget)}** | ${fmt(claimable)} | ${binding} |`);
    assert.ok(Math.min(budget, claimable) <= burnsPerSeason, "rewards ≤ previous season's burns");
  }
  out.push("", "Not paid in $GBOOT (cannot be farm-proofed, so progression only: XP, stars, cosmetics): **daily login** (costs nothing, so any $GBOOT per login is a sybil faucet), **practice / Daily-challenge scores** (played in the browser, not judged by the referee), **Big Match Sudden Death goals** (client-side), and the **Bootroom perk tier**.");
  blocks.rewards = out;
}

// ═════ 9. Weekly scale table (Monte Carlo, mixed stadiums) ═════
function weekly(dailyPlayers, runs, seed) {
  const random = rng(seed);
  const t = { spend: 0, payouts: 0, drops: 0 };
  for (let run = 0; run < runs; run++) for (const mix of MIX) {
    const tier = TIERS[mix.tier], balls = Math.round(dailyPlayers * mix.share * mix.balls * 7);
    for (let i = 0; i < balls; i++) {
      const o = draw(random);
      t.spend += tier.price / runs; t.payouts += (PAYOUT_X[o] * tier.price) / runs;
      t.drops += (baseDropAt(tier.price, START_PRICE) * DROP_MULT[o]) / runs;
    }
  }
  const sweep = Math.max(0, t.spend - t.payouts) * (1 - RETAIN_WHILE_GROWING);
  const need = MIX.map(mix => Math.ceil(dailyPlayers * mix.share * CONCURRENCY) * 10 * TIERS[mix.tier].price);
  return { ...t, sweep, need, feesEth: (t.spend * FRESH_RF_SHARE / rfPerEth) * MARKET_FEE / (1 - MARKET_FEE) };
}
{
  const out = [header, "", `Assumptions: ${MIX.map(m => `${m.share * 100}% of players at ${TIERS[m.tier].id} × ${m.balls} balls/day`).join(", ")}; ${CONCURRENCY * 100}% of a stadium's daily players have a ball in flight at the peak; ${FRESH_RF_SHARE * 100}% of RF spent is bought fresh with ETH. Burn and Cup figures use the realised surplus of the simulated week (luck included), after the 10% growth retention. Drops (no lacing multiplier), before and after the drop vault's week-0 and week-26 caps.`, "",
    "| Daily players | RF spent / wk | RF burned (40%) | $GBOOT bought & burned (30%) | Cup RF (30%) | Friend fees / wk | Drops / wk (uncapped) | Cap wk 0 / wk 26 binds? | Peak bank need vs opening bank |", "|---:|---:|---:|---:|---:|---:|---:|---|---|"];
  for (const players of [50, 500, 5000]) {
    const w = weekly(players, SMOKE ? 5 : 40, players);
    const burnRf = w.sweep * EDGE_SPLIT.burnBps / 1e4, swap = w.sweep * EDGE_SPLIT.buybackBps / 1e4, cup = w.sweep - burnRf - swap;
    const binds = [0, 26].map(week => (w.drops > capOf(VAULTS.drops, week) ? "yes" : "no")).join(" / ");
    out.push(`| ${fmt(players)} | ${fmt(w.spend)} RF (${usd(w.spend)}) | ${fmt(burnRf)} RF | ${fmt(swap * (1 - POOL.FEE) / START_PRICE)} | ${fmt(cup)} RF | ${w.feesEth.toFixed(3)} ETH | ${fmt(w.drops)} | ${binds} | ${w.need.map(n => fmt(n)).join(" / ")} vs ${TIERS.map(t => fmt(t.bank)).join(" / ")} |`);
  }
  out.push("", `Skill Cup (${SKILL_CUP.ENTRY_RF} RF) and Wildcards (${WILDCARD.PRICE_RF} RF), paid in $GBOOT (a fixed ${WILDCARD.PRICE_RF / FIXED_PRICE} $GBOOT each at launch), burn ${SKILL_CUP.BURN_SHARE * 100}% of every entry on top: each 1,000 entries burn ${fmt(1000 * SKILL_CUP.ENTRY_RF * SKILL_CUP.BURN_SHARE)} RF worth of $GBOOT (${fmt(1000 * SKILL_CUP.ENTRY_RF * SKILL_CUP.BURN_SHARE / START_PRICE)} $GBOOT at the launch price).`);
  blocks.scale = out;
}

// ═════ 10. Where the Cup pot comes from (weekly, reproducible) ═════
// Assumptions (stated in the output): the weekly scale model's player mix, the 10% edge with 30% of it
// to the Cup (steady state: banks no longer growing), Skill Cup / Wildcard entry rates per player,
// half of the pool's trading volume buys and half sells, the locked positions hold all the pool's
// liquidity, $GBOOT valued at the fixed launch price. Expected values (no Monte Carlo luck).
export const POT_ASSUME = { skillEntriesPerPlayerDay: 0.2, wildcardsPerPlayerDay: 0.1, buyShare: 0.5 };
export function weeklyPot(players, tradingVolumeRf) {
  const P = FIXED_PRICE, volume = weeklyVolume(players);
  const edgeRf = volume * EDGE * EDGE_SPLIT.cupBps / 1e4;                              // RF
  const buybackRf = volume * EDGE * EDGE_SPLIT.buybackBps / 1e4;                       // the EdgeSplitter's swap also pays the LP fee (in RF)
  const potShare = 1 - LOCK.BURN_BPS / 1e4;
  const skillEntries = players * POT_ASSUME.skillEntriesPerPlayerDay * 7, wildcards = players * POT_ASSUME.wildcardsPerPlayerDay * 7;
  const skillGboot = skillEntries * (SKILL_CUP.ENTRY_RF / P) * (1 - SKILL_CUP.BURN_SHARE);
  const wildGboot = wildcards * (WILDCARD.PRICE_RF / P) * (1 - WILDCARD.BURN_SHARE);
  const feeRf = (tradingVolumeRf * POT_ASSUME.buyShare + buybackRf) * POOL.FEE * potShare;         // buys pay the fee in RF
  const feeGboot = (tradingVolumeRf * (1 - POT_ASSUME.buyShare) / P) * POOL.FEE * potShare;         // sells pay it in $GBOOT
  const cupsVaultGboot = VAULTS.cups.weeklyCap;
  const rf = edgeRf + feeRf, gboot = skillGboot + wildGboot + feeGboot + cupsVaultGboot;
  return { volume, edgeRf, buybackRf, skillEntries, wildcards, skillGboot, wildGboot, feeRf, feeGboot, cupsVaultGboot, rf, gboot, totalRfEq: rf + gboot * P };
}
{
  const P = FIXED_PRICE, PLAYERS = [50, 500, 5_000], VOLUMES = [10_000, 100_000, 1_000_000];
  { // hand check of one cell: 50 players, 10k RF of trading
    const w = weeklyPot(50, 10_000);
    assert.equal(w.volume, 301_000);
    assert.ok(Math.abs(w.edgeRf - 9_030) < 1e-6, "30% of the 10% edge of 301,000 RF");
    assert.ok(Math.abs(w.skillGboot - 3_500) < 1e-6 && Math.abs(w.wildGboot - 1_750) < 1e-6, "70 entries × 50 $GBOOT, 35 Wildcards × 50 $GBOOT");
    assert.ok(Math.abs(w.feeRf - (5_000 + 9_030) * 0.005) < 1e-6 && Math.abs(w.feeGboot - 250) < 1e-6, "0.5% of the fee-paying volume, each side");
  }
  const rfEq = w => w.totalRfEq;
  const out = [header, "",
    "**Assumptions (change them in `scripts/economy-sim.mjs`, `POT_ASSUME` and `MIX`):**", "",
    `- **Players:** ${MIX.map(m => `${m.share * 100}% play ${TIERS[m.tier].id} (${fmt(TIERS[m.tier].price)} RF) × ${m.balls} balls a day`).join("; ")}.`,
    `- **Edge:** ${EDGE * 100}% of ball spend, and **${EDGE_SPLIT.cupBps / 100}% of the edge goes to the Cup**. Steady state: the prize banks are no longer growing (while a bank grows, the operator keeps ${RETAIN_WHILE_GROWING * 100}% of its surplus first, so the edge line is ${RETAIN_WHILE_GROWING * 100}% lower). Expected values, no luck.`,
    `- **Entries:** each daily player makes ${POT_ASSUME.skillEntriesPerPlayerDay} Skill Cup entries and ${POT_ASSUME.wildcardsPerPlayerDay} Wildcard draws a day; each costs ${SKILL_CUP.ENTRY_RF / P} $GBOOT (fixed launch price) and ${(1 - SKILL_CUP.BURN_SHARE) * 100}% goes to the pot.`,
    `- **Pool:** "trading volume" is outside $GBOOT/RF swaps per week, half buys (fee paid in RF) and half sells (fee paid in $GBOOT); the edge buy-back swap is added on top. The LP fee is ${POOL.FEE * 100}%, the locked positions hold all the liquidity, and \`LiquidityLock.collect\` sends ${100 - LOCK.BURN_BPS / 100}% of each side to the pot.`,
    `- **Cups vault:** the operator releases the full ${fmt(VAULTS.cups.weeklyCap)} $GBOOT weekly cap into the pot (it is a cap, not a promise).`,
    `- **Value:** $GBOOT counted at the fixed ${P} RF launch price; USD at the market snapshot above.`, "",
    "**Pot inflows by source, per week** (trading volume 0 here; pool fees are in the next table):", "",
    "| Daily players | Ball spend | 30% of the edge (RF) | Skill Cup halves ($GBOOT) | Wildcard halves ($GBOOT) | Buy-back LP fee to pot (RF) | Cups vault ($GBOOT) | **Total, RF-equivalent** |", "|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const players of PLAYERS) {
    const w = weeklyPot(players, 0);
    out.push(`| ${fmt(players)} | ${fmt(w.volume)} RF | ${fmt(w.edgeRf)} | ${fmt(w.skillGboot)} (${fmt(w.skillEntries)} entries) | ${fmt(w.wildGboot)} (${fmt(w.wildcards)} draws) | ${fmt(w.feeRf, 1)} | ${fmt(w.cupsVaultGboot)} | **${fmt(rfEq(w))}** (${usd(rfEq(w))}) |`);
  }
  out.push("", "**Pool trading fees to the pot, per week** (on top of the table above):", "",
    "| Weekly $GBOOT trading volume | LP fees (1%) | Burned (50%) | To the pot: RF side | To the pot: $GBOOT side | **To the pot, RF-equivalent** |", "|---:|---:|---:|---:|---:|---:|");
  for (const v of VOLUMES) {
    const fee = v * POOL.FEE, potRf = v * POT_ASSUME.buyShare * POOL.FEE * (1 - LOCK.BURN_BPS / 1e4), potG = v * (1 - POT_ASSUME.buyShare) / P * POOL.FEE * (1 - LOCK.BURN_BPS / 1e4);
    out.push(`| ${fmt(v)} RF | ${fmt(fee)} RF-eq. | ${fmt(fee * LOCK.BURN_BPS / 1e4)} RF-eq. | ${fmt(potRf)} RF | ${fmt(potG)} $GBOOT | **${fmt(potRf + potG * P)}** |`);
    assert.ok(Math.abs(weeklyPot(0, v).totalRfEq - VAULTS.cups.weeklyCap * P - (potRf + potG * P)) < 1e-6);
  }
  out.push("", "**Weekly pot size, RF-equivalent** (everything above; in brackets: without the Cups vault, i.e. only what the contracts send automatically):", "",
    `| Daily players ↓ / weekly trading volume → | ${VOLUMES.map(v => `${fmt(v)} RF`).join(" | ")} |`, `|---:|${VOLUMES.map(() => "---:").join("|")}|`);
  for (const players of PLAYERS) {
    out.push(`| ${fmt(players)} | ${VOLUMES.map(v => { const w = weeklyPot(players, v); return `**${fmt(rfEq(w))}** (${fmt(rfEq(w) - w.cupsVaultGboot * P)})`; }).join(" | ")} |`);
  }
  const small = weeklyPot(50, 10_000), big = weeklyPot(5_000, 1_000_000);
  out.push("", `Reading it: at 50 players a day the pot is about ${usd(rfEq(small))} a week, and the Cups vault is ${fmt(small.cupsVaultGboot * P / rfEq(small) * 100, 0)}% of it. At 5,000 players the game's edge dominates (${fmt(big.edgeRf / rfEq(big) * 100, 0)}% of the pot). Pool fees matter only at high trading volume: 1M RF of trading adds ${fmt(weeklyPot(0, 1_000_000).totalRfEq - VAULTS.cups.weeklyCap * P)} RF-equivalent a week. **Starting seed** (one-off, not in the table): the contracts start the pot at 0; the operator may add an optional RF seed (the public preview simulates ${fmt(500_000)} RF, \`SIM_CUP_SEED_RF\`).`);
  blocks.pot = out;
}

// ── Output ──
const text = Object.entries(blocks).map(([name, lines]) => `### ${name}\n\n${lines.join("\n")}`).join("\n\n");
if (SMOKE) { console.log(text); console.log("\nPASS economy-sim smoke (tokenomics v2 constants match contracts/src)"); process.exit(0); }
const path = new URL("../docs/ECONOMY.md", import.meta.url);
let doc = await readFile(path, "utf8");
for (const [name, lines] of Object.entries(blocks)) {
  const start = `<!-- SIM:${name}:START -->`, end = `<!-- SIM:${name}:END -->`;
  assert.ok(doc.includes(start) && doc.includes(end), `ECONOMY.md is missing the ${name} markers`);
  doc = doc.slice(0, doc.indexOf(start) + start.length) + "\n" + lines.join("\n") + "\n" + doc.slice(doc.indexOf(end));
}
await writeFile(path, doc);
console.log(text); console.log("\nPASS economy-sim: tables written to docs/ECONOMY.md");
