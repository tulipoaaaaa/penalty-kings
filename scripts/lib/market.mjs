// Market snapshot used by the economy simulator and budget planner (offline docs only: the game
// itself reads the price live, see games/penalty-kings/game/price.ts).
// Source: Robinhood mainnet (4663) public RPC reads, block 73,793,321 (2026-09-27):
//   StateView 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b .getSlot0 / .getLiquidity on the RF/WETH pool id
//   0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240
//   sqrtPriceX96 = 59977880447322165122003233, tick = -143730, liquidity = 147865847752143433133351
//   RF.totalSupply() = 951,192,000.34 RF (1.024B minted; the difference has been burned)
// ETH/USD from StateView.getSlot0 on the deepest WETH/USDG pool (docs/ADDRESSES.md), same block:
//   0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593, sqrtPriceX96 = 4129642798072125940494846
//   → (sqrt / 2^96)^2 × 10^12 = 2,716.85 USDG per WETH.
export const SNAPSHOT = {
  block: 73_793_321,
  sqrtPriceX96: 59977880447322165122003233n,
  liquidity: 147865847752143433133351n,
  rfSupply: 951_192_000.34,
  ethUsd: 2716.85,
};
const Q96 = 2 ** 96;
/** ETH per RF (token0 = RF, token1 = ETH side). */
export const ethPerRf = (Number(SNAPSHOT.sqrtPriceX96) / Q96) ** 2;
export const rfPerEth = 1 / ethPerRf;
export const rfUsd = ethPerRf * SNAPSHOT.ethUsd;
/** Virtual reserves at the current price (full-range-equivalent depth). */
export const virtualRf = Number(SNAPSHOT.liquidity) / (Number(SNAPSHOT.sqrtPriceX96) / Q96) / 1e18;
export const virtualEth = Number(SNAPSHOT.liquidity) * (Number(SNAPSHOT.sqrtPriceX96) / Q96) / 1e18;
/** Rare Friends market fee on the WETH side of buys and sells (rarefriends.com/docs). */
export const MARKET_FEE = 0.05;
/** ETH needed to buy `rf` RF from the pool: constant-product within the active range, plus the 5% fee. */
export function ethToBuyRf(rf) {
  const x = virtualRf, y = virtualEth;
  if (rf >= x) return Infinity;
  const ethIn = (x * y) / (x - rf) - y;
  return ethIn / (1 - MARKET_FEE);
}
export const priceImpact = rf => { const x = virtualRf; return (x / (x - rf)) ** 2 - 1; };
