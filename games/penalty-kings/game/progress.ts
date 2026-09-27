/**
 * Player progression for the FREE skill layer: XP, levels, stars, Scouting Book stamps, the
 * ball collection, daily streak and the invisible difficulty rung. Kept in localStorage when the
 * browser allows it (every access is guarded: the preview sandbox may not persist, which is fine).
 * Nothing here touches RF, balls or $GBOOT.
 */
import type { KeeperId, ShotRecord } from "@penalty-kings/engine";

export type Progress = {
  version: 1;
  xp: number;
  /** World Tour stars by level id (0–3). */
  stars: Record<string, number>;
  /** Scouting Book: keepers beaten (3+ goals in a 5-kick round). */
  stamps: KeeperId[];
  /** Ball Collection: rarity indexes pulled (0 Scuffed … 6 Golden Boot). */
  pulled: number[];
  /** Completed free matches (aim assist + trajectory preview fade out after 3). */
  matches: number;
  tutorialDone: boolean;
  /** Invisible dynamic difficulty rung and recent shots. */
  difficulty: number;
  history: ShotRecord[];
  daily: { date: string; attempts: number; best: number; played: string[] };
  best: { target: number; penalties: number; freekicks: number };
  /** Unlocked cosmetic rewards from stars (ids from economy COSMETICS). */
  rewards: string[];
};

export const STORAGE_KEY = "penalty-kings/progress/v1";
export const fresh = (): Progress => ({
  version: 1, xp: 0, stars: {}, stamps: [], pulled: [], matches: 0, tutorialDone: false, difficulty: 3, history: [],
  daily: { date: "", attempts: 0, best: 0, played: [] }, best: { target: 0, penalties: 0, freekicks: 0 }, rewards: [],
});

export function loadProgress(storage: Pick<Storage, "getItem"> | null = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return fresh();
    const value = JSON.parse(raw) as Partial<Progress>;
    return value.version === 1 ? { ...fresh(), ...value, daily: { ...fresh().daily, ...value.daily }, best: { ...fresh().best, ...value.best } } : fresh();
  } catch { return fresh(); }
}
export function saveProgress(progress: Progress, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify({ ...progress, history: progress.history.slice(-20) })); return true; } catch { return false; }
}
function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

// ── XP and levels ─────────────────────────────────────────────────────────
export const XP = { tutorial: 100, goal: 10, zoneBonus: { centre: 0, side: 2, corner: 5, bin: 10 }, star: 50, daily: 30, stamp: 80, target: 1 } as const;
/** Level 1 at 0 XP; each level costs 100 more than the last (100, 200, 300 …). */
export function levelFromXp(xp: number) {
  let level = 1, need = 100, left = xp;
  while (left >= need) { left -= need; level++; need += 100; }
  return { level, into: left, next: need };
}

// ── Modes and unlocks ─────────────────────────────────────────────────────
export type ModeId = "penalties" | "freekicks" | "tour" | "daily" | "target" | "match" | "skill";
export const MODES: ReadonlyArray<{ id: ModeId; name: string; blurb: string; level: number; paid?: boolean }> = [
  { id: "penalties", name: "Penalties", blurb: "Tutorial, then climb the keeper ladder.", level: 1 },
  { id: "freekicks", name: "Free Kicks", blurb: "18–32 m. Curl it, dip it, knuckle it.", level: 2 },
  { id: "tour", name: "World Tour", blurb: "30 levels, 3 stars each.", level: 2 },
  { id: "daily", name: "Daily Challenge", blurb: "Same scenario for everyone. 3 attempts.", level: 2 },
  { id: "target", name: "Target Practice", blurb: "60 seconds. Bins, bar, combos.", level: 2 },
  { id: "match", name: "Big Match", blurb: "RF balls: rarity by chance, $GBOOT drops. Optional.", level: 1, paid: true },
];
export const isUnlocked = (mode: ModeId, progress: Progress) => (MODES.find(item => item.id === mode)?.level ?? 1) <= levelFromXp(progress.xp).level;

/** The keeper ladder for Penalties: beat one to face the next. */
export const LADDER: readonly KeeperId[] = ["mouse", "squirrel", "sloth", "peacock", "octopus", "mime", "disco", "sumo", "chameleon", "robot", "ghost", "finalwall"];
export const nextRung = (progress: Progress): KeeperId => LADDER.find(id => !progress.stamps.includes(id)) ?? "finalwall";

/** Aim assist + trajectory preview: full for the tutorial and first 3 matches (and at Park), then fading over 3 more. */
export function assistLevel(progress: Progress, stadium: "park" | "pro" | "champions") {
  if (!progress.tutorialDone || progress.matches < 3) return 1;
  const faded = Math.max(0, 1 - (progress.matches - 3) / 3);
  return stadium === "park" ? Math.max(0.35, faded) : faded;
}

/** Stars needed to open each stadium in the World Tour (10 levels × 3 stars per stadium). */
export const STADIUM_STARS = { park: 0, pro: 12, champions: 30 } as const;
export const totalStars = (progress: Progress) => Object.values(progress.stars).reduce((sum, value) => sum + value, 0);
