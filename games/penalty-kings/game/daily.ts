/**
 * Daily Challenge: one scenario seeded by the UTC date — the same for everyone — with 3 attempts
 * a day, a local best and a streak calendar. (A shared leaderboard needs the referee Worker; until
 * it is deployed, results are local plus a shareable card.)
 */
import { KEEPERS, freeKickSetup, type KeeperId, type FreeKickSetup } from "@penalty-kings/engine";

export const DAILY_ATTEMPTS = 3;
export type DailyScenario = { date: string; seed: number; mode: "penalty" | "freekick"; keeper: KeeperId; kicks: number; setup?: FreeKickSetup; title: string };

export const utcDate = (now = new Date()) => now.toISOString().slice(0, 10);
export function dateSeed(date: string) {
  let hash = 2166136261;
  for (const char of `penalty-kings-daily:${date}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function dailyScenario(date: string): DailyScenario {
  const seed = dateSeed(date);
  const pool = KEEPERS.filter(keeper => !keeper.boss);
  const keeper = pool[seed % pool.length].id;
  const freekick = (seed >>> 8) % 3 === 0;
  if (freekick) {
    const setup = freeKickSetup(seed, { maxWind: 3 });
    return { date, seed, mode: "freekick", keeper, kicks: 3, setup, title: `${setup.distance} m free kick · wall of ${setup.wallSize}` };
  }
  return { date, seed, mode: "penalty", keeper, kicks: 5, title: `5 penalties vs ${KEEPERS.find(item => item.id === keeper)!.name}` };
}

/** Attempts left today and the rolled-over record when the date changes. */
export function dailyState(record: { date: string; attempts: number; best: number; played: string[] }, today: string) {
  return record.date === today ? record : { date: today, attempts: 0, best: 0, played: record.played };
}

/** Consecutive days played up to today (or yesterday, if today is not played yet). */
export function dailyStreak(played: readonly string[], today: string) {
  const days = new Set(played);
  const day = new Date(`${today}T00:00:00Z`);
  if (!days.has(today)) day.setUTCDate(day.getUTCDate() - 1);
  let streak = 0;
  while (days.has(day.toISOString().slice(0, 10))) { streak++; day.setUTCDate(day.getUTCDate() - 1); }
  return streak;
}
