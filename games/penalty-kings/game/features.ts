/**
 * EARLY ACCESS feature flags: the ONE place that says what each build preset shows (docs/EARLY-ACCESS.md).
 *
 * The preset is a build-time constant: `globalThis.PK_EARLY_ACCESS` (scripts/lib/preset.mjs defines it for
 * `npm run build:site` / `build:site:ea`; builds without the define, like the SDK's own CLI, get the full game).
 * Every consumer (menus, modes, NEXT GOAL, HUD, Results) reads it as `globalThis.PK_EARLY_ACCESS ? <early access> : <full>`,
 * which esbuild folds at build time, and asks THIS module what early access shows. Hidden features are hidden, never
 * deleted: switching one back on is one line here (plus, for a whole screen, the gate that renders it).
 *
 * Early access shows exactly four features:
 *   1. real-money balls: Big Match, Ball shop, My Bag, packs (odds) and redeem
 *   2. Practice: the public free practice page (site/practice/) and, in the game, the Penalties mode renamed "Practice"
 *      (the tutorial, then the 12-keeper ladder; free, no RF)
 *   3. Daily Challenge
 *   4. Scouting Book
 * Pure module: object literals and functions only (nothing runs at import, so the full build drops it entirely).
 */
import { keeperById } from "@penalty-kings/engine";
import { MODES, LADDER, levelFromXp, nextRung, type ModeId, type Progress } from "./progress.js";
import { DAILY_ATTEMPTS, dailyState } from "./daily.js";
import { nextGoal, type NextGoal } from "./nextgoal.js";
import type { Level } from "./objectives.js";

export type Preset = "full" | "early-access";

export type Feature =
  | "bigMatch" | "ballShop" | "bag" | "packs" | "redeem" | "practice" | "daily" | "scoutingBook"
  | "freeKicks" | "worldTour" | "target" | "skillCup" | "kitShop" | "cups" | "pot" | "championsNight"
  | "keeperOfTheWeek" | "challengeCodes" | "share" | "market" | "gboot";

/** Every feature, and whether early access shows it. The full preset shows everything. */
export const FEATURES: Readonly<Record<Feature, Readonly<{ label: string; earlyAccess: boolean }>>> = {
  bigMatch: { label: "Big Match (kick with your balls)", earlyAccess: true },
  ballShop: { label: "Ball shop", earlyAccess: true },
  bag: { label: "My Bag", earlyAccess: true },
  packs: { label: "Packs and their odds", earlyAccess: true },
  redeem: { label: "Redeem balls for RF", earlyAccess: true },
  practice: { label: "Practice (free penalties; the free practice page)", earlyAccess: true },
  daily: { label: "Daily Challenge", earlyAccess: true },
  scoutingBook: { label: "Scouting Book", earlyAccess: true },
  freeKicks: { label: "Free Kicks", earlyAccess: false },
  worldTour: { label: "World Tour", earlyAccess: false },
  target: { label: "Target Practice", earlyAccess: false },
  skillCup: { label: "Skill Cup", earlyAccess: false },
  kitShop: { label: "Kit shop", earlyAccess: false },
  cups: { label: "Cups (Golden Boot Cup race, Wildcards)", earlyAccess: false },
  pot: { label: "Cup pot banner and winners ticker", earlyAccess: false },
  championsNight: { label: "Champions Night", earlyAccess: false },
  keeperOfTheWeek: { label: "Keeper of the Week", earlyAccess: false },
  challengeCodes: { label: "Challenge codes (challenge a friend)", earlyAccess: false },
  share: { label: "Share cards (they carry challenge links)", earlyAccess: false },
  market: { label: "Market (coming soon)", earlyAccess: false },
  gboot: { label: "$GBOOT drops and balances (not in the Rare Friends pilot)", earlyAccess: false },
};

export const isOn = (preset: Preset, feature: Feature) => preset === "full" || FEATURES[feature].earlyAccess;
export const shownFeatures = (preset: Preset) => (Object.keys(FEATURES) as Feature[]).filter(feature => isOn(preset, feature));
export const hiddenFeatures = (preset: Preset) => (Object.keys(FEATURES) as Feature[]).filter(feature => !isOn(preset, feature));

/** The feature behind each play mode. */
export const MODE_FEATURE: Readonly<Record<ModeId, Feature>> = { penalties: "practice", freekicks: "freeKicks", tour: "worldTour", daily: "daily", target: "target", match: "bigMatch", skill: "skillCup" };
export const modeOn = (preset: Preset, mode: ModeId) => isOn(preset, MODE_FEATURE[mode]);

type ModeCard = (typeof MODES)[number];
/** Early access calls the Penalties mode "Practice" (the in-game half of the Practice feature). */
const EA_MODE_COPY: Partial<Record<ModeId, Pick<ModeCard, "name" | "blurb">>> = {
  penalties: { name: "Practice", blurb: "Free penalties: the tutorial, then climb the 12-keeper ladder. No RF." },
};
/** The mode cards a preset shows (full: MODES itself, unchanged). */
export function visibleModes(preset: Preset): readonly ModeCard[] {
  if (preset === "full") return MODES;
  return MODES.filter(mode => modeOn(preset, mode.id)).map(mode => ({ ...mode, ...EA_MODE_COPY[mode.id] }));
}
export const modeName = (preset: Preset, mode: ModeId) => visibleModes(preset).find(item => item.id === mode)?.name ?? MODES.find(item => item.id === mode)?.name ?? mode;

/** Menus (index.tsx `Menu`) and the feature each belongs to (null: always there). */
export type MenuId = "hub" | "balls" | "bag" | "market" | "odds" | "cups" | "shop" | "book" | "tour" | "daily" | "settings" | "rules" | "results";
export const MENU_FEATURE: Readonly<Record<MenuId, Feature | null>> = { hub: null, balls: "ballShop", bag: "bag", market: "market", odds: "packs", cups: "cups", shop: "kitShop", book: "scoutingBook", tour: "worldTour", daily: "daily", settings: null, rules: null, results: null };
export const menuOn = (preset: Preset, menu: MenuId) => { const feature = MENU_FEATURE[menu]; return feature === null || isOn(preset, feature); };

/** The in-game Menu (hub) buttons, in the full game's order. */
export const HUB_MENUS: readonly MenuId[] = ["balls", "bag", "cups", "book", "shop", "rules", "settings"];
export const hubMenus = (preset: Preset) => HUB_MENUS.filter(menu => menuOn(preset, menu));
/** The modes screen's button row, in the full game's order. */
export const MODES_SCREEN_MENUS: readonly MenuId[] = ["book", "balls", "bag", "shop", "cups", "rules", "settings"];
export const modesScreenMenus = (preset: Preset) => MODES_SCREEN_MENUS.filter(menu => menuOn(preset, menu));

/** Mode names that a level-up opens (the "Unlocked: …" toast), visible ones only. */
export const openedModes = (preset: Preset, before: number, after: number) => visibleModes(preset).filter(mode => mode.level > before && mode.level <= after).map(mode => mode.name);

/** Tutorial Results title (full: the original words). */
export function tutorialTitle(preset: Preset) {
  if (preset === "full") return "Tutorial complete! Level 2: Free Kicks, World Tour, Daily and Target Practice unlocked";
  const names = visibleModes(preset).filter(mode => !mode.paid && mode.level === 2).map(mode => mode.name);
  return `Tutorial complete! Level 2: ${names.join(", ")} unlocked`;
}
/** The first-session teaser under the scouted keeper's card (early access: the Daily Challenge, never Free Kicks). */
export const earlyAccessTeaser = (open: boolean) => (open ? "Next up: the Daily Challenge — the same scenario for everyone today." : "The Daily Challenge unlocks at level 2 — you're nearly there.");

/**
 * NEXT GOAL for a preset. Full: game/nextgoal.ts unchanged. Early access follows the same priority order but only
 * ever points at a visible mode: 1. the next visible mode to unlock, 2. today's Daily Challenge, 3. the next keeper to
 * stamp in the Scouting Book, 4. beat your Practice best. It never points at buying anything.
 */
export function nextGoalFor(preset: Preset, progress: Progress, levels: readonly Level[], today: string): NextGoal {
  if (preset === "full") return nextGoal(progress, levels, today);
  const { level, into, next } = levelFromXp(progress.xp);
  const cards = visibleModes(preset).filter(mode => !mode.paid);
  const locked = cards.filter(mode => mode.level > level).sort((a, b) => a.level - b.level)[0];
  if (locked) return { text: `${next - into} XP to level ${locked.level}: unlocks ${cards.filter(mode => mode.level === locked.level).map(mode => mode.name).join(", ")}`, mode: "penalties" };
  const daily = dailyState(progress.daily, today);
  if (daily.attempts < DAILY_ATTEMPTS) return { text: `Daily Challenge: ${DAILY_ATTEMPTS - daily.attempts} attempt${DAILY_ATTEMPTS - daily.attempts === 1 ? "" : "s"} left today`, mode: "daily" };
  if (progress.stamps.length < LADDER.length) return { text: `Beat ${keeperById(nextRung(progress)).name} (3 goals in a round) for Scouting Book stamp ${progress.stamps.length + 1}/${LADDER.length}`, mode: "penalties" };
  return { text: `Beat your Practice best: ${progress.best.penalties}`, mode: "penalties" };
}
