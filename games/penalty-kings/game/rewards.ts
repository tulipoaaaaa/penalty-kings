/**
 * Retention rewards (round 6 D17/D18), paid in PROGRESSION only: XP and cosmetic unlocks. No
 * off-chain currency exists. $GBOOT rewards are only paid on-chain by the farm-proofed
 * RewardsDistributor (hardwired Friend Gen ≤ 4, per-Friend daily caps, referee-verified claims,
 * a season budget); this module never promises them.
 */

// ── D17 Skill Zones: top bins / in off the post / crossbar-in extend the streak and pay XP ──────
export type SkillZone = "top-bin" | "post-in" | "bar-in";
export const SKILL_ZONE_XP: Readonly<Record<SkillZone, number>> = { "top-bin": 15, "post-in": 20, "bar-in": 25 };
export function skillZoneOf(kick: { goal: boolean; zone: string; postIn?: boolean; y: number }): SkillZone | null {
  if (!kick.goal) return null;
  if (kick.postIn && kick.y >= 0.9) return "bar-in";
  if (kick.postIn) return "post-in";
  return kick.zone === "bin" ? "top-bin" : null;
}
/** A Skill Zone goal extends the streak by one extra step (the Flick Kick hook); the score multiplier stays capped by streakMultiplier. */
export const streakAfter = (streak: number, zone: SkillZone | null) => Math.min(zone ? streak + 2 : streak + 1, 10);

// ── D18 Daily loop: 7-day login track, challenge streak with a weekly freeze, a 4 h claim ────────
export type LoginTrack = { lastDay: string; day: number };
/** Day 1..7 rewards: XP, with a cosmetic unlock on day 7 (the preview's free Park ball is simulated only). */
export const LOGIN_TRACK: readonly { xp: number; cosmetic?: string }[] = [
  { xp: 20 }, { xp: 25 }, { xp: 30 }, { xp: 35 }, { xp: 40 }, { xp: 50 }, { xp: 80, cosmetic: "net-lime" },
];
const dayAfter = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** Check in for `today` (UTC date). Consecutive days advance the track; a missed day restarts it; once a day. */
export function checkIn(track: LoginTrack, today: string): { track: LoginTrack; reward: (typeof LOGIN_TRACK)[number] | null } {
  if (track.lastDay === today) return { track, reward: null };
  const day = track.lastDay && dayAfter(track.lastDay) === today ? (track.day % 7) + 1 : 1;
  return { track: { lastDay: today, day }, reward: LOGIN_TRACK[day - 1] };
}

export type ChallengeStreak = { days: string[]; freezesUsed: string[] };
/** ISO week key (UTC) for the one-freeze-per-week rule. */
export function weekKey(day: string) {
  const d = new Date(`${day}T00:00:00Z`), dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d.getTime() - first.getTime()) / 86_400_000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
}
/**
 * Current daily-challenge streak ending today or yesterday. A single missed day inside the streak is
 * bridged by that week's freeze if it is still unused (one per ISO week), and the freeze is recorded.
 */
export function challengeStreak(state: ChallengeStreak, today: string): { streak: number; freezesUsed: string[] } {
  const played = new Set(state.days), used = new Set(state.freezesUsed);
  const back = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  let day = played.has(today) ? today : back(today), streak = 0;
  if (!played.has(day)) return { streak: 0, freezesUsed: [...used] };
  while (true) {
    if (played.has(day)) { streak++; day = back(day); continue; }
    const week = weekKey(day);
    if (!used.has(week) && played.has(back(day))) { used.add(week); day = back(day); continue; } // freeze bridges one gap
    break;
  }
  return { streak, freezesUsed: [...used] };
}

/** A free XP claim every 4 hours (progression only). */
export const CLAIM_EVERY_MS = 4 * 3_600_000, CLAIM_XP = 15;
export const canClaim = (lastClaim: number, now: number) => now - lastClaim >= CLAIM_EVERY_MS;
export const nextClaimIn = (lastClaim: number, now: number) => Math.max(0, lastClaim + CLAIM_EVERY_MS - now);
