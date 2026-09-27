// Exact port of Uniswap v4-core TickMath.getSqrtPriceAtTick (src/libraries/TickMath.sol) and
// LiquidityAmounts helpers, using bigint. Verified against the live RF/WETH pool in pool-plan.mjs.
const Q128 = 1n << 128n, MAX_U256 = (1n << 256n) - 1n;
export const MIN_TICK = -887272, MAX_TICK = 887272;
const MULS = [
  [0x2n, 0xfff97272373d413259a46990580e213an], [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn], [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n], [0x20n, 0xff973b41fa98c081472e6896dfb254c0n], [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n], [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n], [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n], [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n], [0x20000n, 0x5d6af8dedb81196699c329225ee604n], [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];
export function getSqrtPriceAtTick(tick) {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new Error(`invalid tick ${tick}`);
  const abs = BigInt(Math.abs(tick));
  let price = abs & 1n ? 0xfffcb933bd6fad37aa2d162d1a594001n : Q128;
  for (const [bit, mul] of MULS) if (abs & bit) price = (price * mul) >> 128n;
  if (tick > 0) price = MAX_U256 / price;
  return (price + (1n << 32n) - 1n) >> 32n;
}
const Q96 = 1n << 96n;
/** Liquidity for an amount of token0 between two sqrt prices (rounded down). */
export const liquidityForAmount0 = (sa, sb, amount0) => { if (sa > sb) [sa, sb] = [sb, sa]; return (amount0 * ((sa * sb) / Q96)) / (sb - sa); };
/** Liquidity for an amount of token1 between two sqrt prices (rounded down). */
export const liquidityForAmount1 = (sa, sb, amount1) => { if (sa > sb) [sa, sb] = [sb, sa]; return (amount1 * Q96) / (sb - sa); };
/** Token amounts required for liquidity L (rounded up, as the pool charges). */
export const amount0ForLiquidity = (sa, sb, L) => { if (sa > sb) [sa, sb] = [sb, sa]; const n = (L << 96n) * (sb - sa); const d = sb * sa; return (n + d - 1n) / d; };
export const amount1ForLiquidity = (sa, sb, L) => { if (sa > sb) [sa, sb] = [sb, sa]; const n = L * (sb - sa); return (n + Q96 - 1n) / Q96; };
