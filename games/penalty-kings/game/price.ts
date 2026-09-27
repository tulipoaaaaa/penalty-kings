/**
 * Live RF → USD price. No fixed or fallback number exists anywhere in this file:
 * every USD figure in the game comes from two Uniswap v4 pool reads on Robinhood Chain (4663).
 *
 *   usdPerRf = (WETH per RF, RF/WETH pool) × (USDG per WETH, WETH/USDG pool)
 *
 * Both reads are `StateView.getSlot0(poolId)` eth_calls sent with fetch() to the chain's public RPC
 * (the SDK CSP allows connect-src to that host). Results are cached for 60 s. A failed read gives
 * status "error" and a dash on screen, never an old or invented number. Addresses and pool ids are
 * verified on-chain in docs/ADDRESSES.md.
 */
import { useEffect, useState } from "react";

export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
/** Uniswap v4 StateView (docs/ADDRESSES.md). */
export const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
/** RF/WETH v4 pool: currency0 = RF (18 decimals), currency1 = WETH (18 decimals). */
export const RF_WETH_POOL_ID = "0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240";
/** Deepest WETH/USDG v4 pool: currency0 = WETH (18 decimals), currency1 = USDG (6 decimals). */
export const WETH_USDG_POOL_ID = "0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593";
export const RF_DECIMALS = 18, WETH_DECIMALS = 18, USDG_DECIMALS = 6;
/** getSlot0(bytes32) selector. */
export const GET_SLOT0 = "0xc815641c";
/** A cached price is reused for 60 s, then re-read. */
export const PRICE_CACHE_MS = 60_000;
/** A price older than this is not shown (e.g. the tab slept and the refresh has not landed yet). */
export const PRICE_STALE_MS = 2 * PRICE_CACHE_MS;

export type RfPrice = { usdPerRf: number | null; fetchedAt: number | null; status: "live" | "error" };
/** Before the first read completes: no number. */
export const NO_PRICE: RfPrice = { usdPerRf: null, fetchedAt: null, status: "error" };

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** token1 per token0 in whole-token units, from a v4 sqrtPriceX96 and both tokens' decimals. */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number) {
  if (sqrtPriceX96 <= 0n) return null;
  const root = Number(sqrtPriceX96) / 2 ** 96;
  const price = root * root * 10 ** (decimals0 - decimals1);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** WETH per RF: RF is currency0 of the RF/WETH pool, so the pool price (token1/token0) is WETH per RF. */
export const wethPerRf = (sqrtRfWeth: bigint) => priceFromSqrtX96(sqrtRfWeth, RF_DECIMALS, WETH_DECIMALS);
/** USD per WETH: WETH is currency0 of the WETH/USDG pool, so the pool price is USDG per WETH (USDG ≈ $1). */
export const usdPerWeth = (sqrtWethUsdg: bigint) => priceFromSqrtX96(sqrtWethUsdg, WETH_DECIMALS, USDG_DECIMALS);

/** usdPerRf = (WETH per RF) × (USD per WETH); null when either read is unusable. */
export function usdPerRfFromPools(sqrtRfWeth: bigint, sqrtWethUsdg: bigint) {
  const a = wethPerRf(sqrtRfWeth), b = usdPerWeth(sqrtWethUsdg);
  return a === null || b === null ? null : a * b;
}

/** The first 32-byte word of getSlot0's return data is sqrtPriceX96 (uint160). */
export function decodeSqrtPriceX96(result: unknown) {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64,}$/.test(result)) return null;
  const value = BigInt(result.slice(0, 66));
  return value > 0n && value < 1n << 160n ? value : null;
}

/** eth_call data for StateView.getSlot0(poolId). */
export const slot0Call = (poolId: string) => ({ to: STATE_VIEW, data: `${GET_SLOT0}${poolId.slice(2).padStart(64, "0")}` });

/** True when the price can be shown right now. */
export const isShowable = (price: RfPrice, now: number) =>
  price.status === "live" && price.usdPerRf !== null && price.fetchedAt !== null && now - price.fetchedAt <= PRICE_STALE_MS;

/** "live · 12s ago", or "—" when there is no usable read. */
export function priceAgeLabel(price: RfPrice, now: number) {
  if (!isShowable(price, now)) return "—";
  return `live · ${Math.max(0, Math.round((now - price.fetchedAt!) / 1000))}s ago`;
}

/** A USD amount with "≈": whole dollars from $100, cents below, "< $0.01" for dust. */
export function formatUsd(usd: number) {
  if (!Number.isFinite(usd) || usd < 0) return "—";
  if (usd > 0 && usd < 0.01) return "≈ < $0.01";
  return `≈ $${usd >= 100 ? Math.round(usd).toLocaleString("en-US") : usd.toFixed(2)}`;
}

/** An RF amount in USD at the live price, or "—". */
export const usdForRf = (rf: number | null, price: RfPrice, now: number) =>
  rf === null || !isShowable(price, now) ? "—" : formatUsd(rf * price.usdPerRf!);

/** One RF in USD, e.g. "1 RF ≈ $0.00155", or "—". */
export function rfPriceText(price: RfPrice, now: number) {
  if (!isShowable(price, now)) return "—";
  const usd = price.usdPerRf!;
  return `1 RF ≈ $${usd >= 0.01 ? usd.toFixed(4) : usd.toPrecision(3)}`;
}

// ── Fetching (raw JSON-RPC, cached 60 s) ────────────────────────────────────

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ json(): Promise<unknown> }>;

async function readSlot0(poolId: string, id: number, fetchImpl: Fetch) {
  const response = await fetchImpl(RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_call", params: [slot0Call(poolId), "latest"] }) });
  const body = await response.json() as { result?: unknown; error?: unknown };
  const sqrt = body.error ? null : decodeSqrtPriceX96(body.result);
  if (sqrt === null) throw new Error("slot0 read failed");
  return sqrt;
}

/** One fresh read of both pools. Never throws: a failure returns status "error" with no number. */
export async function fetchRfPrice(fetchImpl: Fetch = fetch as unknown as Fetch, now: () => number = Date.now): Promise<RfPrice> {
  try {
    const [rfWeth, wethUsdg] = await Promise.all([readSlot0(RF_WETH_POOL_ID, 1, fetchImpl), readSlot0(WETH_USDG_POOL_ID, 2, fetchImpl)]);
    const usdPerRf = usdPerRfFromPools(rfWeth, wethUsdg);
    return usdPerRf === null ? { ...NO_PRICE, fetchedAt: now() } : { usdPerRf, fetchedAt: now(), status: "live" };
  } catch {
    return { ...NO_PRICE, fetchedAt: now() };
  }
}

let cached: RfPrice | null = null, inflight: Promise<RfPrice> | null = null;
/** The cached price if younger than 60 s, else a new read (concurrent callers share one request). */
export function getRfPrice(now = Date.now()): Promise<RfPrice> {
  if (cached && cached.fetchedAt !== null && now - cached.fetchedAt < PRICE_CACHE_MS) return Promise.resolve(cached);
  inflight ??= fetchRfPrice().then(price => { cached = price.status === "live" ? price : null; inflight = null; return price; });
  return inflight;
}

/** How often the hook asks for the price; the 60 s cache decides when the network is used. */
export const PRICE_POLL_MS = 15_000;
/** React: the live price, re-read once the cache is 60 s old (failed reads retry on the next poll). */
export function useRfPrice(): RfPrice {
  const [price, setPrice] = useState<RfPrice>(() => cached ?? NO_PRICE);
  useEffect(() => {
    let active = true;
    const refresh = () => { void getRfPrice().then(value => { if (active) setPrice(value); }); };
    refresh();
    const id = window.setInterval(refresh, PRICE_POLL_MS);
    return () => { active = false; window.clearInterval(id); };
  }, []);
  return price;
}
