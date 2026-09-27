// Penalty Kings economy simulator (tokenomics v2: 100M $GBOOT).
// Every constant comes from contracts/src, contracts/script/Launch.s.sol and games/penalty-kings/*
// (scripts/lib/tokenomics.mjs asserts that the Solidity still says the same thing). It validates
// prize-bank solvency, the halving supply schedule, burns per unit of volume, lacing boosts,
// airdrop sizing, Sudden Death, the pool, the farm checks and the weekly scale table, then writes
// each generated block into docs/ECONOMY.md between its <!-- SIM:<name>:START/END --> markers.
//
//   node scripts/economy-sim.mjs          full run, rewrites the docs/ECONOMY.md blocks
//   node scripts/economy-sim.mjs --smoke  fewer Monte Carlo runs, same assertions, writes nothing (CI)
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { rfUsd, rfPerEth, MARKET_FEE, SNAPSHOT } from "./lib/market.mjs";
import {
  SUPPLY, ALLOCATION, VAULTS, capOf, releasedBy, EDGE_SPLIT, splitEdgeWei, BOOTROOM, boostBps, dropBpsOf,
  AIRDROP, SKILL_CUP, WILDCARD, POOL, NOMINAL_PRICE, DROP_SHARE, MAX_DROP_BPS, checkContracts,
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
  assert.match(src, /WILDCARD_PRICE = 100;/); assert.match(src, /SKILL_CUP_ENTRY = 100;/);
}

// ── Pool (scripts/onchain/pool-plan.mjs: tick-snapped start, position A range) ──
const plan = planPool("0xffffffffffffffffffffffffffffffffffffffff");
export const START_PRICE = plan.startPriceRfPerGboot;              // ≈ 0.10027 RF per $GBOOT
const [A_LOW, A_HIGH] = plan.positionA.gbootPriceRange;            // ≈ 0.10027 … 99.46
const L_A = ALLOCATION.pool / (1 / Math.sqrt(A_LOW) - 1 / Math.sqrt(A_HIGH));
export const rfToMultiply = m => (L_A * (Math.sqrt(A_LOW * m) - Math.sqrt(A_LOW))) / (1 - POOL.FEE);
const gbootOutFor = m => L_A * (1 / Math.sqrt(A_LOW) - 1 / Math.sqrt(A_LOW * m));
assert.ok(Math.abs(START_PRICE * SUPPLY / 1e6 - 10.03) < 0.01, "FDV ≈ 10.03M RF");

// ── Drops: base = min(schedule, 2% × price ÷ TWAP ÷ 2.15); × dropBps (≤ ×1.5); weekly total ≤ vault cap ──
export const baseDropAt = (price, twap) => Math.min(scheduleBase(price), (DROP_SHARE * price) / twap / AVG_DROP_MULT);
/** $GBOOT dropped per RF of ball volume at a given TWAP and average drop multiplier from lacing. */
const dropsPerRf = (twap, dropMult) => (baseDropAt(10, twap) * AVG_DROP_MULT * dropMult) / 10;

// ── Edge path per RF of ball volume (expected values) ──
const SWEEP = EDGE * (1 - RETAIN_WHILE_GROWING);                   // RF reaching the EdgeSplitter per RF of volume
const perRf = {
  rfBurned: SWEEP * EDGE_SPLIT.burnBps / 1e4,
  rfSwapped: SWEEP * EDGE_SPLIT.buybackBps / 1e4,
  rfCup: SWEEP * EDGE_SPLIT.cupBps / 1e4,
};
perRf.rfLpFeeBurned = perRf.rfSwapped * POOL.FEE;                  // the buy-back swap's 1% fee is RF, burned by collectAndBurn
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
const x = bps => `×${(bps / 1e4).toFixed(2)}`;
const blocks = {};
const header = `_Generated by \`node scripts/economy-sim.mjs\` from the contracts and game constants (market snapshot from the RF/WETH and WETH/USDG Uniswap v4 pools at block ${SNAPSHOT.block.toLocaleString("en-US")}: 1 RF = $${rfUsd.toFixed(5)}, 1 ETH = ${fmt(rfPerEth)} RF. The game itself shows the LIVE price, read every 60 s from the same pools; see docs/ADDRESSES.md)._`;

// ═════ 1. Supply over time (halving schedule + burns) ═════
const SCENARIOS = [
  { name: "no play", players: 0 },
  { name: "50 players/day", players: 50 },
  { name: "500 players/day", players: 500 },
  { name: "5,000 players/day", players: 5000 },
];
const PROJ_DROP_MULT = MAX_DROP_BPS / 1e4;  // worst case for supply: every Friend at the maximum lacing boost (×1.5 drops)
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
 *  current price, ×1.5 boost, ≤ capOf), the Cups and bounty vaults (full cap) and, from week 12, the
 *  airdrop (all claimed, unlaced at expiry) are released and SELL_SHARE of each release is sold. */
function project(players, weeks = 104) {
  const volume = weeklyVolume(players);
  const rem = { drops: VAULTS.drops.total, cups: VAULTS.cups.total, bounty: VAULTS.bounty.total };
  let burned = 0, released = 0, drops = 0, price = START_PRICE;
  const rows = [{ week: 0, supply: SUPPLY, burned: 0, released: 0, drops: 0, price }];
  for (let week = 0; week < weeks; week++) {
    const [bought, afterBuy] = swap(price, volume * perRf.rfSwapped, true);
    burned += bought; price = afterBuy;
    const d = Math.min(volume * dropsPerRf(price, PROJ_DROP_MULT), capOf(VAULTS.drops, week), rem.drops);
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
    "| After week | Drop cap in the last week | Drops released, max (Σ capOf) | Drop vault left, min | Cups vault released, max | Bounty vault released, max | Airdrop unlocked, max | **Max $GBOOT released from vaults** |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const w of MILESTONES) {
    const drops = releasedBy(VAULTS.drops, w), cups = releasedBy(VAULTS.cups, w), bounty = releasedBy(VAULTS.bounty, w);
    const air = w >= AIRDROP.LOCK_WEEKS ? ALLOCATION.airdrop : 0;
    out.push(`| ${w} | ${w ? fmt(capOf(VAULTS.drops, w - 1)) : "—"} | ${fmt(drops)} | ${fmt(VAULTS.drops.total - drops)} | ${fmt(cups)} | ${fmt(bounty)} | ${fmt(air)} | **${fmt(drops + cups + bounty + air)}** |`);
  }
  assert.equal(releasedBy(VAULTS.drops, 4), 10_000_000, "first season releases at most 10M");
  assert.equal(releasedBy(VAULTS.drops, 26), 19_765_625, "26 weeks: 20M × (1 − 2⁻⁶) + 2 × 39,062.5");
  assert.equal(releasedBy(VAULTS.cups, 104), 10_000_000, "cups vault empties at week 100");
  out.push("", `**Total supply (100M minus everything burned), price-responsive.** Each week the edge buy-back buys $GBOOT through the launch positions (A: 55M $GBOOT from ${A_LOW.toFixed(4)} RF up; B: a ${fmt(FLOOR_RF)} RF floor from ${B_LOW.toFixed(4)} to ${B_HIGH.toFixed(4)} RF) and burns it; then drops (auto-scaled to the new price, all at the maximum ×1.5 boost), the full Cups and bounty caps and, at week ${AIRDROP.LOCK_WEEKS}, the whole airdrop are released and **${SELL_SHARE * 100}% of every release is sold** into the pool. Burns counted: the buy-back only; Skill Cup, Wildcard, KitShop, early-unlace and LP-fee burns are extra. These are stress assumptions, not forecasts.`, "",
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
    `| … its 1% LP fee, burned by LiquidityLock | 0.027 × 1% | ${perRf.rfLpFeeBurned.toFixed(5)} RF | ${fmt(perRf.rfLpFeeBurned * rfPerUsd, 2)} RF |`,
    `| **$GBOOT bought and burned** | 0.027 × 0.99 ÷ P | **${fmt(buybackPerRf(P), 4)} $GBOOT** at P = ${P.toFixed(5)} | **${fmt(buybackPerRf(P) * rfPerUsd, 1)} $GBOOT** |`,
    `| RF to the Golden Boot Cup | 0.10 × 0.90 × 30% | ${perRf.rfCup.toFixed(4)} RF | ${fmt(perRf.rfCup * rfPerUsd, 1)} RF |`,
    `| **Total RF burned** | 0.036 + 0.00027 | **${(perRf.rfBurned + perRf.rfLpFeeBurned).toFixed(5)} RF** | **${fmt((perRf.rfBurned + perRf.rfLpFeeBurned) * rfPerUsd, 1)} RF** |`,
    `| $GBOOT dropped (emitted) | 2% ÷ TWAP × dropBps | ${fmt(dropsPerRf(P, 1), 4)} … ${fmt(dropsPerRf(P, 1.5), 4)} $GBOOT (×1 … ×1.5) | ${fmt(dropsPerRf(P, 1) * rfPerUsd, 1)} … ${fmt(dropsPerRf(P, 1.5) * rfPerUsd, 1)} $GBOOT |`,
    "",
    `Both sides scale as 1 ÷ price, so the ratio is price-independent: burned ÷ dropped = 2.673% ÷ (2% × average drop boost). **Ball play is net deflationary for $GBOOT whenever the average drop boost is below ×${(0.02673 / 0.02).toFixed(4)}**; at the maximum ×1.5 it emits 0.327% of volume in $GBOOT value more than it burns, until the season cap binds.`,
    "", "Pool trading adds more: every swap pays 1% and `LiquidityLock.collectAndBurn` burns both fee sides, so **1 RF of $GBOOT trading volume burns 0.01 RF-equivalent** (RF on buys, $GBOOT on sells) while the positions stay locked (180 days).",
    "", "**Break-even weekly ball volume** (burns = emissions, the flat Cups + bounty releases of 150,000 $GBOOT included, all vaults releasing their full cap):", "",
    "| Week | Drop cap | Avg drop boost ×1.0 | ×1.25 | ×1.5 |", "|---:|---:|---:|---:|---:|"];
  const flat = VAULTS.cups.weeklyCap + VAULTS.bounty.weeklyCap;
  const breakEven = (week, mult) => {
    const net = buybackPerRf(P) - dropsPerRf(P, mult); // $GBOOT per RF of volume, drops uncapped
    const cap = capOf(VAULTS.drops, week);
    const cands = [];
    if (net > 0) { const v = flat / net; if (v * dropsPerRf(P, mult) <= cap) cands.push(v); }
    const vCapped = (cap + flat) / buybackPerRf(P); if (vCapped * dropsPerRf(P, mult) >= cap) cands.push(vCapped);
    return Math.min(...cands);
  };
  for (const w of [0, 4, 8, 12, 16, 20, 24, 52]) out.push(`| ${w} | ${fmt(capOf(VAULTS.drops, w))} | ${[1, 1.25, 1.5].map(m => { const v = breakEven(w, m); return `${fmt(v)} RF (${usd(v)})`; }).join(" | ")} |`);
  assert.ok(breakEven(0, 1) < breakEven(0, 1.5));
  out.push("", "Formula: with *b* = 0.02673 ÷ P $GBOOT burned per RF and *d* = 0.02 × boost ÷ P dropped per RF, the break-even volume is V = 150,000 ÷ (b − d) while drops are under the cap, else V = (capOf(week) + 150,000) ÷ b. Above it, total supply falls faster than vaults release.");
  blocks.burn = out;
}

// ═════ 3. Lacing scenarios (Bootroom.boostBps, exact port) ═════
{
  const amounts = [1, 100, 1_000, 10_000, 50_000], weeks = [1, 4, 12, 26, 52];
  const out = [header, "", "Race-point boost (drop boost in brackets) for a live lace of *amount* $GBOOT committed for *weeks*:", "",
    `| Laced | ${weeks.map(w => `${w} wk`).join(" | ")} |`, `|---:|${weeks.map(() => "---:").join("|")}|`];
  for (const a of amounts) out.push(`| ${fmt(a)} | ${weeks.map(w => { const b = boostBps(a, w); return `${x(b)} (${x(dropBpsOf(b))})`; }).join(" | ")} |`);
  assert.equal(boostBps(10_000, 52), 20_000); assert.equal(boostBps(50_000, 52), 20_000, "MAX_LACE caps the boost");
  assert.equal(boostBps(50_000, 12), boostBps(10_000, 12));
  out.push("", "What a boost is worth, per Park ball (10 RF) at the launch price:", "",
    "| Boost | Drops per ball (avg, $GBOOT) | Drop value | RF return + drop value | Race points per 100 balls |", "|---:|---:|---:|---:|---:|");
  for (const b of [10_000, 13_506, 15_387, 18_885, 20_000]) {
    const d = dropBpsOf(b) / 1e4, drops = baseDropAt(10, START_PRICE) * AVG_DROP_MULT * d, value = drops * START_PRICE / 10;
    out.push(`| ${x(b)} | ${fmt(drops, 3)} | ${(value * 100).toFixed(2)}% | ${((0.9 + value) * 100).toFixed(2)}% | ${fmt(100 * RACE_EV * b / 1e4, 2)} |`);
    assert.ok(0.9 + value <= 0.93 + 1e-9, "a laced ball stays ≤ 93%");
  }
  blocks.lacing = out;
}

// ═════ 4. Airdrop sizing (FriendsAirdrop: 10M, pre-laced for 12 weeks) ═════
{
  const out = [header, "", `Equal split of ${fmt(ALLOCATION.airdrop)} $GBOOT across N eligible Friends, each laced for ${AIRDROP.LOCK_WEEKS} weeks:`, "",
    "| Eligible Friends N | $GBOOT per Friend | ≈ RF at launch price | Counted for the boost (≤ 10,000) | Boost for 12 weeks (drops) | Uncounted $GBOOT (no extra boost) |", "|---:|---:|---:|---:|---:|---:|"];
  for (const n of [250, 500, 1_000, 2_000, 5_000, 10_000, 20_000]) {
    const each = Math.floor(ALLOCATION.airdrop / n), counted = Math.min(each, BOOTROOM.MAX_LACE), b = boostBps(each, AIRDROP.LOCK_WEEKS);
    out.push(`| ${fmt(n)} | ${fmt(each)} | ${fmt(each * START_PRICE)} | ${fmt(counted)} | ${x(b)} (${x(dropBpsOf(b))}) | ${fmt(Math.max(0, each - BOOTROOM.MAX_LACE) * n)} |`);
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
  const out = [header, "", "RF payout is always 90%. Drops are valued at the $GBOOT TWAP, at the maximum lacing boost (×1.5):", "",
    "| $GBOOT price | Drop value, fixed schedule | Total, fixed | Drop value, auto-scaled | **Total, auto-scaled** |", "|---|---:|---:|---:|---:|"];
  for (const m of [0.1, 1, 10, 100]) {
    const twap = START_PRICE * m;
    const fixed = (scheduleBase(10) * AVG_DROP_MULT * 1.5 * twap) / 10, scaled = (baseDropAt(10, twap) * AVG_DROP_MULT * 1.5 * twap) / 10;
    out.push(`| ${m}× (${fmt(twap, 4)} RF) | ${(fixed * 100).toFixed(2)}% | ${((0.9 + fixed) * 100).toFixed(2)}% | ${(scaled * 100).toFixed(2)}% | **${((0.9 + scaled) * 100).toFixed(2)}%** |`);
    assert.ok(0.9 + scaled <= 0.93 + 1e-9, "auto-scaled farm check ≤ 93%");
  }
  out.push("", "### Wildcard farm check (RF cost per Golden Boot race point)", "",
    `A Park ball costs 10 RF and returns 9 RF on average plus its drop; a Wildcard costs ${WILDCARD.PRICE} $GBOOT and returns nothing. Both give ${RACE_EV} expected race points, and the lacing boost multiplies both equally.`, "",
    "| $GBOOT price | Park ball, net RF per point | Wildcard, RF per point | Cheaper route |", "|---|---:|---:|---|");
  for (const m of [0.5, 1, 10, 100]) {
    const twap = START_PRICE * m, drop = baseDropAt(10, twap) * AVG_DROP_MULT * twap;
    const ball = (10 * EDGE - drop) / RACE_EV, wildcard = (WILDCARD.PRICE * twap) / RACE_EV;
    out.push(`| ${m}× (${fmt(twap, 4)} RF) | ${fmt(ball, 2)} | ${fmt(wildcard, 2)} | ${wildcard > ball ? "balls" : "**WILDCARDS**"} |`);
    assert.ok(wildcard > ball, `Wildcards must not be the cheaper route at ${m}×`);
  }
  const k = scheduleBase(10) * AVG_DROP_MULT;
  const breakEven = (10 * EDGE) / (WILDCARD.PRICE * START_PRICE + k * START_PRICE);
  out.push("", `Break-even: 100·P = 1 − ${fmt(k, 3)}·P ⇒ Wildcards only become cheaper per point below P = ${fmt(START_PRICE * breakEven, 5)} RF (≈ ${breakEven.toFixed(3)}× launch). The weekly report flags any week where the TWAP is under it.`);
  blocks.farm = out;
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
  const out = [header, "", `Assumptions: ${MIX.map(m => `${m.share * 100}% of players at ${TIERS[m.tier].id} × ${m.balls} balls/day`).join(", ")}; ${CONCURRENCY * 100}% of a stadium's daily players have a ball in flight at the peak; ${FRESH_RF_SHARE * 100}% of RF spent is bought fresh with ETH. Burn and Cup figures use the realised surplus of the simulated week (luck included), after the 10% growth retention. Drops at ×1 boost, before and after the drop vault's week-0 and week-26 caps.`, "",
    "| Daily players | RF spent / wk | RF burned (40%) | $GBOOT bought & burned (30%) | Cup RF (30%) | Friend fees / wk | Drops / wk (uncapped) | Cap wk 0 / wk 26 binds? | Peak bank need vs opening bank |", "|---:|---:|---:|---:|---:|---:|---:|---|---|"];
  for (const players of [50, 500, 5000]) {
    const w = weekly(players, SMOKE ? 5 : 40, players);
    const burnRf = w.sweep * EDGE_SPLIT.burnBps / 1e4, swap = w.sweep * EDGE_SPLIT.buybackBps / 1e4, cup = w.sweep - burnRf - swap;
    const binds = [0, 26].map(week => (w.drops > capOf(VAULTS.drops, week) ? "yes" : "no")).join(" / ");
    out.push(`| ${fmt(players)} | ${fmt(w.spend)} RF (${usd(w.spend)}) | ${fmt(burnRf)} RF | ${fmt(swap * (1 - POOL.FEE) / START_PRICE)} | ${fmt(cup)} RF | ${w.feesEth.toFixed(3)} ETH | ${fmt(w.drops)} | ${binds} | ${w.need.map(n => fmt(n)).join(" / ")} vs ${TIERS.map(t => fmt(t.bank)).join(" / ")} |`);
  }
  out.push("", `Skill Cup (${SKILL_CUP.ENTRY} $GBOOT) and Wildcards (${WILDCARD.PRICE} $GBOOT) burn ${SKILL_CUP.BURN_SHARE * 100}% of every entry on top: each 1,000 entries burn ${fmt(1000 * SKILL_CUP.ENTRY * SKILL_CUP.BURN_SHARE)} $GBOOT.`);
  blocks.scale = out;
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
