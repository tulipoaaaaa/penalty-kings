/**
 * World Tour chapters (round 6 C16): the 30 levels in levels.json, re-grouped as 6 cities × 5 levels
 * (level ids unchanged; each level carries its `chapter`). A city opens when the previous one holds
 * ~60% of its stars (9 of 15). Pure: everything is derived from the level list and the player's stars.
 */
import type { Level } from "./objectives.js";
import type { Progress } from "./progress.js";

export type City = Readonly<{ chapter: number; name: string; stadium: Level["stadium"] }>;
export const CITIES: readonly City[] = [
  { chapter: 1, name: "Lisbon", stadium: "park" },
  { chapter: 2, name: "Buenos Aires", stadium: "park" },
  { chapter: 3, name: "Lagos", stadium: "pro" },
  { chapter: 4, name: "Seoul", stadium: "pro" },
  { chapter: 5, name: "Rio de Janeiro", stadium: "champions" },
  { chapter: 6, name: "London", stadium: "champions" },
];
export const LEVELS_PER_CITY = 5;
/** Share of a city's stars that opens the next city. */
export const CHAPTER_UNLOCK_SHARE = 0.6;
export const starsToOpen = (levelsInCity = LEVELS_PER_CITY) => Math.ceil(levelsInCity * 3 * CHAPTER_UNLOCK_SHARE);

export const chapterOf = (level: Level) => level.chapter ?? 1;
export const cityLevels = (levels: readonly Level[], chapter: number) => levels.filter(level => chapterOf(level) === chapter);
export const cityStars = (levels: readonly Level[], chapter: number, progress: Pick<Progress, "stars">) =>
  cityLevels(levels, chapter).reduce((sum, level) => sum + (progress.stars[level.id] ?? 0), 0);

/** City 1 is always open; every later city needs starsToOpen() stars in the city before it. */
export function cityOpen(levels: readonly Level[], chapter: number, progress: Pick<Progress, "stars">): boolean {
  if (chapter <= 1) return true;
  return cityOpen(levels, chapter - 1, progress) && cityStars(levels, chapter - 1, progress) >= starsToOpen(cityLevels(levels, chapter - 1).length);
}

/** The level to highlight: the first open level without a star, else the first open one below 3 stars. */
export function nextLevel(levels: readonly Level[], progress: Pick<Progress, "stars">): Level | null {
  const open = levels.filter(level => cityOpen(levels, chapterOf(level), progress));
  return open.find(level => !progress.stars[level.id]) ?? open.find(level => (progress.stars[level.id] ?? 0) < 3) ?? null;
}

/** "Next level" after finishing `level`: the following level in tour order, or why it is still closed. */
export function levelAfter(levels: readonly Level[], level: Level, progress: Pick<Progress, "stars">): { level: Level } | { locked: string } | null {
  const following = levels[levels.findIndex(item => item.id === level.id) + 1];
  if (!following) return null;
  const chapter = chapterOf(following);
  if (cityOpen(levels, chapter, progress)) return { level: following };
  const before = CITIES.find(city => city.chapter === chapter - 1), city = CITIES.find(item => item.chapter === chapter);
  const need = starsToOpen(cityLevels(levels, chapter - 1).length) - cityStars(levels, chapter - 1, progress);
  return { locked: `Get ${need} more ★ in ${before?.name ?? "this city"} to open ${city?.name ?? "the next city"}.` };
}
