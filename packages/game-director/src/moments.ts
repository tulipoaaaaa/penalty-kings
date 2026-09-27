/**
 * The moment catalogue: everything the Director can put on screen, with its tier, slot, phase affinity,
 * weight, cooldown (in kicks) and eligibility. Ids are permanent: they go into save codes (seen.ts
 * encodes them by catalogue index), so NEVER reorder or remove entries; append new ones at the end.
 */
import type { KeeperId, KickResult, MomentSlot, MomentTier, Phase, PlayMode, StadiumId, TimeOfDay, Weather, BallGlow } from "./types.ts";

/** What a moment's eligibility can look at. */
export type MomentContext = Readonly<{
  phase: Phase; intensity: number; mode: PlayMode; stadium: StadiumId; weather: Weather; timeOfDay: TimeOfDay;
  keeper: KeeperId; kickInRound: number; streak: number; misses: number;
  /** Set after the kick only. */
  result: KickResult | null; nearMiss: boolean; closePost: boolean; zone: string | null;
  suddenDeath: boolean; freePlay: boolean; friendNumber: string; glow: BallGlow;
  /** The keeper rotation wants a new keeper for the next kick. */
  keeperChangeDue: boolean;
}>;

export type MomentDef = Readonly<{
  id: string; name: string; tier: MomentTier; slot: MomentSlot;
  phases: readonly Phase[]; weight: number; cooldown: number;
  when?: (ctx: MomentContext) => boolean;
}>;

const miss = (c: MomentContext) => c.result !== null && c.result !== "goal";
const goal = (c: MomentContext) => c.result === "goal";
const ALL: readonly Phase[] = ["build-up", "peak", "relax"];

export const MOMENTS: readonly MomentDef[] = [
  // ── Micro (every kick) ─────────────────────────────────────────────────────
  { id: "crowd-hush", name: "Crowd hush", tier: "micro", slot: "before", phases: ["build-up", "peak"], weight: 3, cooldown: 1 },
  { id: "keeper-taunt", name: "Keeper taunt", tier: "micro", slot: "before", phases: ["build-up", "peak"], weight: 3, cooldown: 1 },
  { id: "keeper-tell", name: "Keeper tell", tier: "micro", slot: "before", phases: ["build-up"], weight: 2, cooldown: 3 },
  { id: "shot-clock", name: "Shot clock pressure", tier: "micro", slot: "before", phases: ["build-up"], weight: 2, cooldown: 2, when: c => c.mode !== "tutorial" },
  { id: "drumbeat", name: "Drummer in the stands", tier: "micro", slot: "before", phases: ["build-up"], weight: 1, cooldown: 4 },
  { id: "ref-whistle", name: "Ref points to the spot", tier: "micro", slot: "before", phases: ["build-up", "relax"], weight: 1, cooldown: 4 },
  { id: "keeper-banter", name: "Keeper banter", tier: "micro", slot: "before", phases: ["relax", "build-up"], weight: 2, cooldown: 3 },
  { id: "commentator-banter", name: "Commentator banter", tier: "micro", slot: "before", phases: ["relax"], weight: 3, cooldown: 2 },
  { id: "vuvuzela", name: "Trumpet solo", tier: "micro", slot: "before", phases: ["relax"], weight: 1, cooldown: 5 },
  { id: "jumbotron-fact", name: "Jumbotron fun fact", tier: "micro", slot: "before", phases: ["relax"], weight: 2, cooldown: 4 },
  { id: "ball-glow", name: "Match-ball admiration", tier: "micro", slot: "before", phases: ALL, weight: 1, cooldown: 8, when: c => c.glow !== "standard" },
  { id: "keeper-stretch", name: "Keeper limbers up", tier: "micro", slot: "before", phases: ["relax"], weight: 1, cooldown: 5 },
  { id: "crowd-roar", name: "Crowd roar", tier: "micro", slot: "reaction", phases: ALL, weight: 3, cooldown: 0, when: goal },
  { id: "crowd-ooh", name: "Crowd ooh", tier: "micro", slot: "reaction", phases: ALL, weight: 4, cooldown: 0, when: c => miss(c) && (c.nearMiss || c.result === "post") },
  { id: "crowd-groan", name: "Crowd groan", tier: "micro", slot: "reaction", phases: ALL, weight: 3, cooldown: 0, when: miss },
  { id: "keeper-gloat", name: "Keeper gloat", tier: "micro", slot: "reaction", phases: ALL, weight: 2, cooldown: 1, when: c => c.result === "save" },
  { id: "streak-chant", name: "Streak chant", tier: "micro", slot: "reaction", phases: ALL, weight: 3, cooldown: 1, when: c => goal(c) && c.streak >= 2 },
  { id: "fan-catch", name: "Souvenir catch", tier: "micro", slot: "reaction", phases: ALL, weight: 3, cooldown: 2, when: c => c.result === "over" },
  { id: "ball-kid", name: "Ball kid sprint", tier: "micro", slot: "reaction", phases: ALL, weight: 3, cooldown: 2, when: c => c.result === "wide" },
  { id: "scarf-twirl", name: "Scarf twirl", tier: "micro", slot: "reaction", phases: ALL, weight: 2, cooldown: 2, when: goal },
  { id: "air-horn", name: "Air horn", tier: "micro", slot: "reaction", phases: ALL, weight: 1, cooldown: 3, when: goal },
  { id: "slow-clap", name: "Slow clap for the keeper", tier: "micro", slot: "reaction", phases: ALL, weight: 1, cooldown: 3, when: c => c.result === "save" },
  { id: "chin-up", name: "Crowd lifts the striker", tier: "micro", slot: "reaction", phases: ALL, weight: 4, cooldown: 2, when: c => miss(c) && c.misses >= 2 },
  { id: "photo-flash", name: "Photographers' flashes", tier: "micro", slot: "reaction", phases: ALL, weight: 3, cooldown: 3, when: c => goal(c) && (c.zone === "bin" || c.zone === "corner") },
  // ── Notable (every 3–4 kicks) ──────────────────────────────────────────────
  { id: "keeper-sub", name: "Keeper substitution", tier: "notable", slot: "between", phases: ALL, weight: 6, cooldown: 2, when: c => c.keeperChangeDue },
  { id: "weather-rain", name: "Rain rolls in", tier: "notable", slot: "between", phases: ["build-up"], weight: 2, cooldown: 10, when: c => c.weather === "sun" },
  { id: "weather-snow", name: "Snow flurry", tier: "notable", slot: "between", phases: ["build-up", "relax"], weight: 1, cooldown: 12, when: c => c.weather === "sun" && c.stadium !== "park" },
  { id: "weather-fog", name: "Fog bank", tier: "notable", slot: "between", phases: ["build-up"], weight: 1, cooldown: 12, when: c => c.weather === "sun" },
  { id: "weather-clear", name: "Skies clear", tier: "notable", slot: "between", phases: ["relax", "build-up"], weight: 3, cooldown: 4, when: c => c.weather === "rain" || c.weather === "snow" || c.weather === "fog" },
  { id: "cat-invader", name: "Pitch-invader cat", tier: "notable", slot: "between", phases: ["relax"], weight: 2, cooldown: 12 },
  { id: "mexican-wave", name: "Mexican wave", tier: "notable", slot: "reaction", phases: ["peak", "relax"], weight: 3, cooldown: 6, when: c => goal(c) && c.streak >= 2 },
  { id: "jumbotron-replay", name: "Jumbotron replay", tier: "notable", slot: "between", phases: ALL, weight: 2, cooldown: 5, when: c => goal(c) || c.result === "post" },
  { id: "kiss-cam", name: "Kiss Cam", tier: "notable", slot: "between", phases: ["relax"], weight: 2, cooldown: 12 },
  { id: "var-check", name: "VAR check", tier: "notable", slot: "reaction", phases: ALL, weight: 8, cooldown: 6, when: c => c.closePost },
  { id: "mascot-race", name: "Half-time mascot race", tier: "notable", slot: "between", phases: ["relax", "build-up"], weight: 5, cooldown: 12, when: c => c.kickInRound === 2 },
  { id: "fireworks", name: "Streak fireworks", tier: "notable", slot: "reaction", phases: ["peak", "build-up"], weight: 6, cooldown: 6, when: c => goal(c) && c.streak >= 3 },
  { id: "beach-ball", name: "Beach ball in the stands", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 12 },
  { id: "pigeon", name: "Pigeon on the crossbar", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 14, when: c => c.stadium === "park" || c.timeOfDay !== "night" },
  { id: "floodlight-flicker", name: "Floodlight flicker", tier: "notable", slot: "between", phases: ["build-up"], weight: 1, cooldown: 12, when: c => c.stadium !== "park" && c.timeOfDay !== "morning" },
  { id: "conga", name: "Conga line in the family stand", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 14 },
  { id: "tifo", name: "Tifo banner", tier: "notable", slot: "between", phases: ["build-up"], weight: 1, cooldown: 14, when: c => c.stadium !== "park" },
  { id: "drone-cam", name: "Drone camera flyover", tier: "notable", slot: "between", phases: ["build-up", "relax"], weight: 1, cooldown: 12 },
  { id: "brass-band", name: "Brass band strikes up", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 12 },
  { id: "ref-cards", name: "Ref drops his cards", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 16 },
  { id: "rainbow", name: "Rainbow after the rain", tier: "notable", slot: "between", phases: ["relax", "build-up"], weight: 4, cooldown: 12, when: c => c.weather === "rain" && c.timeOfDay !== "night" },
  { id: "keeper-mind-games", name: "Keeper mind games", tier: "notable", slot: "between", phases: ["build-up"], weight: 2, cooldown: 6 },
  { id: "sprinklers", name: "Sprinkler malfunction", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 16, when: c => c.stadium === "park" },
  { id: "selfie-cam", name: "Selfie Cam", tier: "notable", slot: "between", phases: ["relax"], weight: 1, cooldown: 12 },
  // ── Set pieces (every round of 5 kicks) ─────────────────────────────────────
  { id: "boss-appearance", name: "Boss keeper appears", tier: "set-piece", slot: "before", phases: ["peak"], weight: 2, cooldown: 15, when: c => c.freePlay && c.stadium !== "park" },
  { id: "golden-hour", name: "Golden Hour", tier: "set-piece", slot: "before", phases: ["peak"], weight: 3, cooldown: 10, when: c => c.weather !== "sunset" && c.timeOfDay !== "morning" },
  { id: "lights-out", name: "Lights-out spotlight kick", tier: "set-piece", slot: "before", phases: ["peak"], weight: 3, cooldown: 10, when: c => c.suddenDeath || c.stadium !== "park" },
  { id: "friend-chant", name: "Crowd chants your Friend's number", tier: "set-piece", slot: "before", phases: ["peak"], weight: 3, cooldown: 10, when: c => c.friendNumber !== "" },
  { id: "walkout", name: "Hero walk-out", tier: "set-piece", slot: "before", phases: ["peak"], weight: 2, cooldown: 15 },
  { id: "card-mosaic", name: "Card mosaic", tier: "set-piece", slot: "before", phases: ["peak"], weight: 1, cooldown: 15, when: c => c.stadium !== "park" },
  { id: "anthem", name: "Stadium anthem", tier: "set-piece", slot: "before", phases: ["peak"], weight: 1, cooldown: 15 },
  { id: "trophy-lap", name: "The trophy comes out", tier: "set-piece", slot: "before", phases: ["peak"], weight: 1, cooldown: 20, when: c => c.stadium === "champions" || c.streak >= 3 },
  { id: "midnight-fireworks", name: "Midnight fireworks", tier: "set-piece", slot: "before", phases: ["peak"], weight: 3, cooldown: 15, when: c => c.timeOfDay === "night" },
  { id: "legend-in-stands", name: "Legend in the stands", tier: "set-piece", slot: "before", phases: ["peak"], weight: 1, cooldown: 20 },
  { id: "duel-cam", name: "Split-screen showdown", tier: "set-piece", slot: "before", phases: ["peak"], weight: 2, cooldown: 10 },
  { id: "thunderstorm", name: "Thunderstorm", tier: "set-piece", slot: "before", phases: ["peak"], weight: 1, cooldown: 20, when: c => c.weather === "sun" || c.weather === "rain" },
];

export const MOMENT_COUNT = MOMENTS.length;
export const momentById = (id: string) => MOMENTS.find(moment => moment.id === id);
/** The Discovery meter's catalogue: id + human name, in permanent order. */
export const CATALOGUE: readonly { id: string; name: string; tier: MomentTier }[] = MOMENTS.map(({ id, name, tier }) => ({ id, name, tier }));
