/**
 * Prize visibility. EVERY pot / prize figure on screen is produced here from a data source:
 *  • preview (judged): the SDK's simulated ledger + simulated Cup ledger → amounts always tagged
 *    SIMULATED; the USD conversion still uses the LIVE RF price (game/price.ts);
 *  • live: on-chain reads (Cup holder balance, stadium free stake) with a timestamp; a failed or
 *    stale (> 60 s) read shows "—", never an old or invented number.
 * USD always comes from the live RF/USD read (RF/WETH × WETH/USDG pools); no read → "—".
 * Never "you will win", never a guaranteed return, never USD without "≈".
 */
import { NO_PRICE, priceAgeLabel, priceFreshness, usdForRf, type RfPrice } from "./price.js";

export const PRICE_MAX_AGE_MS = 60_000;

export type PrizeSource =
  | { kind: "simulated"; potRF: number; topPrizeRF: number; freeStakeRF: number; price?: RfPrice }
  | { kind: "live"; potRF: number | null; topPrizeRF: number | null; freeStakeRF: number | null; readAt: number | null; price?: RfPrice };

/** usd: "≈ $X" at the live RF price, or "—"; priceNote: "live · Xs ago", or "—". */
/** usdAge: "live · updated Xs ago" / "on-chain snapshot" next to the USD figure ("" with no price). */
export type PrizeLine = { value: string; usd: string; usdAge: string; usdAgeShort: string; priceNote: string; tag: "SIMULATED" | "LIVE"; note: string };

const rfText = (value: number) => `${Math.round(value).toLocaleString("en-US")} RF`;

function fresh(source: Extract<PrizeSource, { kind: "live" }>, now: number) {
  return source.readAt !== null && now - source.readAt <= PRICE_MAX_AGE_MS;
}

/** One figure (pot, top prize or free stake) ready to render. */
export function prizeLine(source: PrizeSource, field: "potRF" | "topPrizeRF" | "freeStakeRF", now: number): PrizeLine {
  const price = source.price ?? NO_PRICE, priceNote = priceAgeLabel(price, now), usdAge = priceFreshness(price, now), usdAgeShort = priceFreshness(price, now, true);
  if (source.kind === "simulated") {
    const value = source[field];
    return { value: rfText(value), usd: usdForRf(value, price, now), usdAge, usdAgeShort, priceNote, tag: "SIMULATED", note: "simulated preview figures" };
  }
  const value = source[field];
  if (value === null || !fresh(source, now)) return { value: "—", usd: "—", usdAge: "", usdAgeShort: "", priceNote, tag: "LIVE", note: "read unavailable" };
  const seconds = Math.max(0, Math.round((now - source.readAt!) / 1000));
  return { value: rfText(value), usd: usdForRf(value, price, now), usdAge, usdAgeShort, priceNote, tag: "LIVE", note: `updated ${seconds}s ago` };
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
  return { ...pot, ends, text: `GOLDEN BOOT CUP · 🏆 ${pot.value} (${pot.usd} · ${pot.priceNote}) · ${ends}` };
}

/** Jumbotron cycle (Pro / Champions): pot, top prize here, your race rank, the last big pull. */
export function jumbotronSlides(source: PrizeSource, now: number, extra: { rank: number | null; lastBigPull: string | null }) {
  const pot = prizeLine(source, "potRF", now), top = prizeLine(source, "topPrizeRF", now);
  const tag = source.kind === "simulated" ? " · SIMULATED" : "";
  return [
    `CUP POT ${pot.value} ${pot.usd}${tag}`,
    `TOP PRIZE THIS STADIUM ${top.value} ${top.usd}${tag}`,
    extra.rank ? `YOUR RACE RANK #${extra.rank}${tag}` : `RACE: PULL GOLD TO SCORE${tag}`,
    extra.lastBigPull ? `${extra.lastBigPull}${tag}` : `ODDS + 90% AVERAGE RETURN: TAP SEE ODDS`,
  ];
}
