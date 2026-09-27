/**
 * Prize visibility. EVERY pot / prize figure on screen is produced here from a data source:
 *  • preview (judged): the SDK's simulated ledger + simulated Cup ledger → always tagged SIMULATED,
 *    and the USD conversion is labelled "illustrative";
 *  • live: on-chain reads (Cup holder balance, stadium free stake, RF/WETH pool price) with a
 *    timestamp; a failed or stale (> 60 s) read shows "—", never an old or invented number.
 * Never "you will win", never a guaranteed return, never USD without "≈".
 */
export const PRICE_MAX_AGE_MS = 60_000;
/** Illustrative only (preview): the order of magnitude of RF in USD when this was built. */
export const ILLUSTRATIVE_USD_PER_RF = 0.0015;

export type PrizeSource =
  | { kind: "simulated"; potRF: number; topPrizeRF: number; freeStakeRF: number }
  | { kind: "live"; potRF: number | null; topPrizeRF: number | null; freeStakeRF: number | null; usdPerRF: number | null; readAt: number | null };

export type PrizeLine = { value: string; usd: string; tag: "SIMULATED" | "LIVE"; note: string };

const rfText = (value: number) => `${Math.round(value).toLocaleString("en-US")} RF`;
function usdText(rf: number, usdPerRF: number, illustrative: boolean) {
  const usd = rf * usdPerRF;
  const shown = usd >= 100 ? Math.round(usd).toLocaleString("en-US") : usd.toFixed(2);
  return `≈ $${shown}${illustrative ? " (illustrative)" : ""}`;
}

function fresh(source: Extract<PrizeSource, { kind: "live" }>, now: number) {
  return source.readAt !== null && now - source.readAt <= PRICE_MAX_AGE_MS;
}

/** One figure (pot, top prize or free stake) ready to render. */
export function prizeLine(source: PrizeSource, field: "potRF" | "topPrizeRF" | "freeStakeRF", now: number): PrizeLine {
  if (source.kind === "simulated") {
    const value = source[field];
    return { value: rfText(value), usd: usdText(value, ILLUSTRATIVE_USD_PER_RF, true), tag: "SIMULATED", note: "simulated preview figures" };
  }
  const value = source[field];
  if (value === null || !fresh(source, now)) return { value: "—", usd: "—", tag: "LIVE", note: "read unavailable" };
  const seconds = Math.max(0, Math.round((now - source.readAt!) / 1000));
  return { value: rfText(value), usd: source.usdPerRF === null ? "—" : usdText(value, source.usdPerRF, false), tag: "LIVE", note: `updated ${seconds}s ago` };
}

/** Next weekly Cup close: Monday 00:00 UTC (docs/WEEKLY.md). */
export function cupEndsAt(now: number) {
  const date = new Date(now);
  const days = (8 - date.getUTCDay()) % 7 || 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}
export function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(total / 1440)}d ${Math.floor((total % 1440) / 60)}h ${total % 60}m`;
}

/** The persistent pot banner line. */
export function potBanner(source: PrizeSource, now: number) {
  const pot = prizeLine(source, "potRF", now);
  const ends = `ends in ${countdown(cupEndsAt(now) - now)}`;
  return { ...pot, ends, text: `GOLDEN BOOT CUP · 🏆 ${pot.value} (${pot.usd}) · ${ends}` };
}

/** Jumbotron cycle (Pro / Champions): pot, top prize here, your race rank, the last big pull. */
export function jumbotronSlides(source: PrizeSource, now: number, extra: { rank: number | null; lastBigPull: string | null }) {
  const pot = prizeLine(source, "potRF", now), top = prizeLine(source, "topPrizeRF", now);
  const tag = source.kind === "simulated" ? " · SIMULATED" : "";
  return [
    `CUP POT ${pot.value} ${pot.usd}${tag}`,
    `TOP PRIZE THIS STADIUM ${top.value}${tag}`,
    extra.rank ? `YOUR RACE RANK #${extra.rank}${tag}` : `RACE: PULL GOLD TO SCORE${tag}`,
    extra.lastBigPull ? `${extra.lastBigPull}${tag}` : `ODDS + 90% AVERAGE RETURN: TAP SEE ODDS`,
  ];
}

/** Live RF→USD: RF/WETH pool price (StateView slot0) × an ETH/USD reference; null if either is missing. */
export function rfUsdFromPool(sqrtPriceX96: bigint, rfIsToken0: boolean, usdPerEth: number | null) {
  if (usdPerEth === null || sqrtPriceX96 === 0n) return null;
  const price = Number(sqrtPriceX96) / 2 ** 96, ratio = price * price; // token1 per token0
  const ethPerRF = rfIsToken0 ? ratio : 1 / ratio;
  return ethPerRF * usdPerEth;
}
