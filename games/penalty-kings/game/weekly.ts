/**
 * The weekly clock around the ONE shared Golden Boot Cup (C3b/C3c). Pure functions of a UTC timestamp:
 *  • Champions Night: a fixed 2-hour window every Saturday, 19:00–21:00 UTC (UTC has no DST, so the window
 *    never moves): the Champions stadium look on every tier and double Cup points (preview: simulated race points);
 *  • the countdown to the weekly Cup draw (Monday 00:00 UTC, game/prizes.ts cupEndsAt);
 *  • last week's winners (SIMULATED preview figures: generic "Friend #NNNN" names, never a real person);
 *  • "Your Cup entries this week" on Results.
 * Every string here is explainable in one sentence to a new player; none promises a win.
 */
import { CUP_CURVE, SIM_CUP_SEED_RF, TIERS, type Tier } from "../economy.js";
import { cupEndsAt } from "./prizes.js";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR, WEEK = 7 * DAY;

/** Champions Night: Saturday (UTC day 6) from 19:00 for 2 hours, every week. */
export const CHAMPIONS_NIGHT = { weekday: 6, startHourUTC: 19, hours: 2 } as const;
/** Cup points (race points) are doubled on every tier during Champions Night. */
export const NIGHT_RACE_MULTIPLIER = 2;

export type NightWindow = { active: boolean; startsAt: number; endsAt: number };

/** The Champions Night window that is running now, or the next one. */
export function championsNight(now: number): NightWindow {
  const date = new Date(now), length = CHAMPIONS_NIGHT.hours * HOUR;
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let startsAt = today + ((CHAMPIONS_NIGHT.weekday - date.getUTCDay() + 7) % 7) * DAY + CHAMPIONS_NIGHT.startHourUTC * HOUR;
  if (startsAt + length <= now) startsAt += WEEK; // this week's night is over: the next one
  return { active: now >= startsAt && now < startsAt + length, startsAt, endsAt: startsAt + length };
}
export const isChampionsNight = (now: number) => championsNight(now).active;
/** ×2 during Champions Night, ×1 otherwise. */
export const racePointMultiplier = (now: number) => (isChampionsNight(now) ? NIGHT_RACE_MULTIPLIER : 1);

/** "2d 4h" / "1h 12m" / "7m" (minutes rounded up, so a running window never reads "0m"). */
export function shortCountdown(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / MINUTE));
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * The Champions Night strip. `doubled` is true where the doubling is applied (the preview's simulated race);
 * live stadiums show the golden night only (the weekly Cup report's weights are not changed from here).
 */
export function championsNightLine(now: number, doubled: boolean) {
  const night = championsNight(now);
  if (night.active) return `CHAMPIONS NIGHT · ${doubled ? "double Cup points" : "golden stadium"} · ends in ${shortCountdown(night.endsAt - now)}`;
  return `Champions Night in ${shortCountdown(night.startsAt - now)}`;
}

/** "Cup draw in 2d 4h": the weekly Cup closes Monday 00:00 UTC. */
export const cupDrawLine = (now: number) => `Cup draw in ${shortCountdown(cupEndsAt(now) - now)}`;

/** One line for a stadium card: bigger stadium, more Cup points per ball (weights 1 / 100 / 1,000). `doubled` as in championsNightLine: only the preview's simulated race doubles on Champions Night. */
export function stadiumRaceLine(tier: Pick<Tier, "raceWeight">, now: number, doubled: boolean) {
  const weight = tier.raceWeight * (doubled ? racePointMultiplier(now) : 1);
  return `Cup points ×${weight.toLocaleString("en-US")} per ball${weight !== tier.raceWeight ? " tonight" : ""}`;
}
/** The shop's one-sentence rule. */
export const STADIUM_RACE_RULE = `Bigger stadium, more Cup points per ball (${TIERS.map(tier => `${tier.name} ×${tier.raceWeight.toLocaleString("en-US")}`).join(", ")}): every stadium races for the same Golden Boot Cup.`;

/** A tiny seeded PRNG (mulberry32) so a week's simulated winners are stable across reloads. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export type Winner = { rank: number; name: string; amountRF: number; badge: number };
/**
 * Last week's top Cup finishers (SIMULATED): generic Friend numbers and the published payout curve applied to
 * the simulated opening pot. Stable for a whole week (seeded by the week that closed).
 */
export function lastWeekWinners(now: number, count = 5, potRF = SIM_CUP_SEED_RF): Winner[] {
  const closed = cupEndsAt(now) - WEEK, random = prng(Math.floor(closed / WEEK));
  const used = new Set<number>();
  return CUP_CURVE.slice(0, count).map((share, index) => {
    let id = 0; do id = 1000 + Math.floor(random() * 9000); while (used.has(id)); used.add(id);
    return { rank: index + 1, name: `Friend #${id}`, amountRF: Math.round(potRF * share / 100), badge: Math.floor(random() * 6) };
  });
}

/** Results: "Your Cup entries this week: N · your rank ~#X" (preview, from the simulated race table); live: null (omitted). */
export function cupEntriesLine(entries: number, rank: number, simulated: boolean) {
  if (!simulated) return null;
  const n = Math.round(entries).toLocaleString("en-US");
  return entries > 0 ? `Your Cup entries this week: ${n} · your rank ~#${rank}` : "Your Cup entries this week: 0 · pull a Gold or Golden Boot ball to enter";
}

/** Count-up easing for the pot counter: from → to at progress k ∈ [0, 1] (ease-out cubic). */
export function countUpValue(from: number, to: number, k: number) {
  const t = Math.max(0, Math.min(1, k));
  return from + (to - from) * (1 - (1 - t) ** 3);
}

/** Preview only: a simulated rival Friend buys a Pro ball every 15 s, so the simulated pot visibly ticks up. */
export const SIM_TRICKLE_MS = 15_000;

/** The Cups page's stadium weights (QA-10): the same numbers as the shop's stadiumRaceLine, "tonight" on Champions Night. */
export function cupWeightsLine(now: number, doubled: boolean) {
  const multiplier = doubled ? racePointMultiplier(now) : 1;
  return `${TIERS.map(tier => `${tier.name} ×${(tier.raceWeight * multiplier).toLocaleString("en-US")}`).join(", ")}${multiplier !== 1 ? " tonight" : ""}`;
}
