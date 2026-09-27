// $GBOOT/RF Uniswap v4 pool plan: prints and asserts sqrtPriceX96, ticks and amounts.
//   node scripts/onchain/pool-plan.mjs [gbootAddress] [floorRF]
// Fee 1% (10000), tick spacing 200, no hook. Start ≈ 0.1 RF per $GBOOT (FDV ≈ 10M RF on 100M supply).
// Position A: 55,000,000 $GBOOT (55% of supply) single-sided from the start price up to ~1,000×.
// Position B (optional): floorRF RF single-sided from ~0.1× up to just below the start price.
import assert from "node:assert/strict";
import { getSqrtPriceAtTick, liquidityForAmount0, liquidityForAmount1, amount0ForLiquidity, amount1ForLiquidity } from "../lib/tickmath.mjs";

export const RF = "0x0779369854d3EcdEA927206718FFD7730C67B71f";
export const FEE = 10000, TICK_SPACING = 200, HOOKS = "0x0000000000000000000000000000000000000000";
/** Tokenomics v2: 100M supply, 55% in the pool. */
export const TOTAL_SUPPLY = 100_000_000n, POOL_GBOOT = 55_000_000n;
const E18 = 10n ** 18n;
const snap = (tick, mode) => (mode === "down" ? Math.floor(tick / TICK_SPACING) : Math.ceil(tick / TICK_SPACING)) * TICK_SPACING;
const tickFor = price => Math.log(price) / Math.log(1.0001); // price = token1 per token0 (both 18 decimals)
const priceAt = tick => 1.0001 ** tick;

export function planPool(gboot, floorRf = 0n) {
  const gbootIsToken0 = BigInt(gboot) < BigInt(RF);
  const [currency0, currency1] = gbootIsToken0 ? [gboot, RF] : [RF, gboot];
  // Price expressed as token1 per token0.
  // gboot = token1: GBOOT per RF = 10 at start; buying GBOOT lowers it. A sits BELOW the start tick.
  // gboot = token0: RF per GBOOT = 0.1 at start; buying GBOOT raises it. A sits ABOVE the start tick.
  const startTick = gbootIsToken0 ? snap(tickFor(0.1), "up") : snap(tickFor(10), "down");
  const sqrtStart = getSqrtPriceAtTick(startTick);
  const gbootPerRfStart = gbootIsToken0 ? 1 / priceAt(startTick) : priceAt(startTick);
  const A = gbootIsToken0
    ? { tickLower: startTick, tickUpper: snap(tickFor(100), "down") }        // RF/GBOOT 0.1 → 100
    : { tickLower: snap(tickFor(0.01), "up"), tickUpper: startTick };          // GBOOT/RF 10 → 0.01
  const gbootAmount = POOL_GBOOT * E18;
  const sa = getSqrtPriceAtTick(A.tickLower), sb = getSqrtPriceAtTick(A.tickUpper);
  const liquidityA = gbootIsToken0 ? liquidityForAmount0(sa, sb, gbootAmount) : liquidityForAmount1(sa, sb, gbootAmount);
  const needA = gbootIsToken0 ? amount0ForLiquidity(sa, sb, liquidityA) : amount1ForLiquidity(sa, sb, liquidityA);
  assert.ok(needA <= gbootAmount && gbootAmount - needA < E18, "A uses ≤ 55M $GBOOT (within 1 token)");
  // Single-sided: the start price must sit exactly on the edge on the GBOOT side.
  assert.equal(gbootIsToken0 ? A.tickLower : A.tickUpper, startTick);
  const rangeMultiple = gbootIsToken0 ? priceAt(A.tickUpper) / priceAt(A.tickLower) : priceAt(A.tickUpper) / priceAt(A.tickLower);
  assert.ok(rangeMultiple > 950 && rangeMultiple < 1050, `A spans ~1000× (${rangeMultiple})`);
  let B = null;
  if (floorRf > 0n) {
    // RF-only range strictly on the other side of the start tick: GBOOT price 0.1× … just below start.
    B = gbootIsToken0
      ? { tickLower: snap(tickFor(0.01), "up"), tickUpper: startTick - TICK_SPACING }
      : { tickLower: startTick + TICK_SPACING, tickUpper: snap(tickFor(100), "down") };
    const ba = getSqrtPriceAtTick(B.tickLower), bb = getSqrtPriceAtTick(B.tickUpper), amount = floorRf * E18;
    B.liquidity = gbootIsToken0 ? liquidityForAmount1(ba, bb, amount) : liquidityForAmount0(ba, bb, amount);
    B.rfNeeded = gbootIsToken0 ? amount1ForLiquidity(ba, bb, B.liquidity) : amount0ForLiquidity(ba, bb, B.liquidity);
    assert.ok(B.rfNeeded <= amount, "B uses ≤ floor RF");
    B.gbootPriceRange = gbootIsToken0 ? [priceAt(B.tickLower), priceAt(B.tickUpper)] : [1 / priceAt(B.tickUpper), 1 / priceAt(B.tickLower)];
  }
  return {
    poolKey: { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: HOOKS },
    gbootIsToken0, startTick, sqrtPriceX96: sqrtStart,
    startPriceRfPerGboot: 1 / gbootPerRfStart, startFdvRf: Number(TOTAL_SUPPLY) / gbootPerRfStart,
    positionA: { ...A, liquidity: liquidityA, gbootNeeded: needA, gbootPriceRange: gbootIsToken0 ? [priceAt(A.tickLower), priceAt(A.tickUpper)] : [1 / priceAt(A.tickUpper), 1 / priceAt(A.tickLower)] },
    positionB: B,
  };
}

/** Exact-input RF → $GBOOT output at the start price, inside position A (1% fee), rounded down. */
export function gbootOutForRf(plan, rfIn) {
  const Q96 = 1n << 96n, L = plan.positionA.liquidity, s = plan.sqrtPriceX96, dx = (rfIn * 99n) / 100n;
  if (!plan.gbootIsToken0) { // RF is token0: price (token1/token0) falls; out = L·(√P − √P')
    const next = (L * s) / (L + (dx * s) / Q96);
    return (L * (s - next)) / Q96;
  }
  // RF is token1: √P rises by dx/L; out(token0) = L·(1/√P − 1/√P')·Q96
  const next = s + (dx * Q96) / L;
  return (L * Q96 * (next - s)) / (s * next);
}

/** Env lines for contracts/script/Launch.s.sol, for both orderings. */
export function launchEnv(floorRf, smokeRf) {
  const lines = [];
  for (const [prefix, probe] of [["PLAN_T1_", "0xffffffffffffffffffffffffffffffffffffffff"], ["PLAN_T0_", "0x0000000000000000000000000000000000000001"]]) {
    const plan = planPool(probe, floorRf);
    lines.push(`${prefix}SQRT_START=${plan.sqrtPriceX96}`, `${prefix}A_LOWER=${plan.positionA.tickLower}`, `${prefix}A_UPPER=${plan.positionA.tickUpper}`, `${prefix}A_LIQUIDITY=${plan.positionA.liquidity}`);
    if (plan.positionB) lines.push(`${prefix}B_LOWER=${plan.positionB.tickLower}`, `${prefix}B_UPPER=${plan.positionB.tickUpper}`, `${prefix}B_LIQUIDITY=${plan.positionB.liquidity}`);
    if (smokeRf > 0n) lines.push(`${prefix}SMOKE_MIN_GBOOT=${(gbootOutForRf(plan, smokeRf * E18) * 97n) / 100n}`);
  }
  if (floorRf > 0n) lines.push(`FLOOR_RF_WEI=${floorRf * E18}`);
  if (smokeRf > 0n) lines.push(`SMOKE_RF=${smokeRf * E18}`);
  return lines;
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--env") {
  console.log(launchEnv(BigInt(process.argv[3] ?? "0"), BigInt(process.argv[4] ?? "0")).join("\n"));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const json = value => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  const floor = BigInt(process.argv[3] ?? "250000");
  const examples = process.argv[2] ? [process.argv[2]] : ["0xffffffffffffffffffffffffffffffffffffffff", "0x0000000000000000000000000000000000000001"];
  for (const gboot of examples) {
    const plan = planPool(gboot, floor);
    console.log(`\n$GBOOT ${gboot} (${plan.gbootIsToken0 ? "token0" : "token1"}):\n${json(plan)}`);
  }
  console.log("\nPASS pool-plan assertions");
}
