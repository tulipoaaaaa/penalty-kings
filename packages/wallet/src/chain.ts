/**
 * Robinhood Chain (4663) as already used in this repo: RPC from games/penalty-kings/game/price.ts and
 * scripts/onchain/lib.mjs, explorer from scripts/build-clubhouse.mjs, Generations collection from the
 * FriendSDK's GENERATION_SPRITE_MANIFEST (docs/ADDRESSES.md).
 */
export const ROBINHOOD_CHAIN = Object.freeze({
  id: 4663,
  hexId: "0x1237",
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  nativeCurrency: Object.freeze({ name: "Ether", symbol: "ETH", decimals: 18 }),
});

/** Rare Friends Generations collection (public, read-only here). */
export const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D" as const;

/** The FriendSDK test fixture Friend: its recorded canonical art ships with the SDK (examples/fishing/sample-sprites.ts). */
export const FIXTURE_FRIEND_ID = "7730";

export const RF_DECIMALS = 18;
export const RF = 10n ** 18n;

/** "12.5" style display of an RF wei amount (max 2 decimals, trailing zeros trimmed). */
export function formatRf(wei: bigint) {
  const negative = wei < 0n, abs = negative ? -wei : wei;
  const whole = abs / RF, cents = (abs % RF) / 10n ** 16n;
  const text = cents === 0n ? whole.toLocaleString("en-US") : `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${negative ? "-" : ""}${text}`;
}

/** RF wei for a dollar amount at a USD-per-RF price (floored to 1e-6 RF). */
export function rfForUsd(usd: number, usdPerRf: number) {
  if (!Number.isFinite(usd) || usd <= 0) throw new RangeError("amount must be a positive number of dollars");
  if (!Number.isFinite(usdPerRf) || usdPerRf <= 0) throw new RangeError("no RF price available");
  return BigInt(Math.floor((usd / usdPerRf) * 1e6)) * 10n ** 12n;
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const explorerTx = (hash: string) => `${ROBINHOOD_CHAIN.explorer}/tx/${hash}`;
export const explorerAddress = (address: string) => `${ROBINHOOD_CHAIN.explorer}/address/${address}`;
