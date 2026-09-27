// Market snapshot used by the economy simulator and budget planner.
// Source: Robinhood mainnet (4663) reads via QuickNode, block 73,657,545 (2026-09-27 ~04:35 UTC):
//   StateView 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b .getSlot0 / .getLiquidity on the RF/WETH pool id
//   0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240
//   sqrtPriceX96 = 59949106155254258080182211, tick = -143740, liquidity = 147865847752143433133351
//   RF.totalSupply() = 951,420,552.59 RF (1.024B minted; the difference has been burned)
// ETH/USD from CoinGecko at the same time. Scripts that can reach an RPC re-read these live.
export const SNAPSHOT = {
  block: 73_657_545,
  sqrtPriceX96: 59949106155254258080182211n,
  liquidity: 147865847752143433133351n,
  rfSupply: 951_420_552.59,
  ethUsd: 2691.77,
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
