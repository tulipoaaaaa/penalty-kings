/**
 * The attract showreel as a real montage (round 6 E24): quick cuts between the three stadiums,
 * keepers, rarity reveals and goals, with camera push-ins and big type moments, cut on the music's
 * beat and ending on the player's Friend. It lasts 20–30 s, is skippable, and the title panels never
 * cover the action (the Stage keeps its safe area).
 *
 * HONESTY: the reveal cut is an EXAMPLE of the reveal animation, labelled on screen ("example
 * reveal"). It never implies a pull happened or will happen. Shots are engine-resolved skill moments.
 */
import type { KeeperId } from "@penalty-kings/engine";
import type { StadiumId, Weather } from "./stadium.js";

/** The chiptune loop steps every 180 ms; a beat is 4 steps. */
export const BEAT = 0.72;

export type CutKind = "logo" | "signature" | "stadium" | "goal" | "top-bin" | "save" | "freekick" | "reveal" | "commentator" | "walkout" | "friend";
export type Cut = Readonly<{
  beats: number;
  kind: CutKind;
  stadium: StadiumId;
  weather: Weather;
  keeper: KeeperId;
  /** Big type moment, drawn in the top safe band only (never over the action). */
  title?: string;
  /** Caption (always on, for muted players). */
  caption?: string;
  /** Camera push-in during the cut. */
  push?: boolean;
  /** Rarity for the example reveal cut (0–6). */
  rarity?: number;
}>;

/**
 * The cold open (first view, ~26 s): floodlight thunk + roar → logo slam; keeper signature moves;
 * the three stadiums with a weather change; a Golden Boot reveal flash (labelled example);
 * the commentator; the player's Friend walks out → TAP TO PLAY.
 */
export const MONTAGE: readonly Cut[] = [
  { beats: 3, kind: "logo", stadium: "champions", weather: "sun", keeper: "finalwall", title: "PENALTY KINGS", caption: "*floodlights thunk on* · the crowd roars", push: true },
  { beats: 2, kind: "signature", stadium: "park", weather: "sun", keeper: "octopus", title: "OCTAVIA", caption: "ink puff!" },
  { beats: 2, kind: "signature", stadium: "park", weather: "fog", keeper: "ghost", title: "BOO", caption: "blink… where did he go?" },
  { beats: 2, kind: "signature", stadium: "pro", weather: "sun", keeper: "sumo", title: "BIG BENTO", caption: "STOMP!", push: true },
  { beats: 2, kind: "signature", stadium: "pro", weather: "rain", keeper: "chameleon", title: "CHROMA", caption: "now you see her…" },
  { beats: 3, kind: "signature", stadium: "champions", weather: "sun", keeper: "finalwall", title: "THE FINAL WALL", caption: "the boss awaits", push: true },
  { beats: 2, kind: "stadium", stadium: "park", weather: "sunset", keeper: "mouse", title: "PARK", caption: "where it all starts" },
  { beats: 2, kind: "top-bin", stadium: "pro", weather: "rain", keeper: "peacock", title: "PRO", caption: "floodlights and flares", push: true },
  { beats: 2, kind: "goal", stadium: "champions", weather: "snow", keeper: "robot", title: "CHAMPIONS", caption: "fireworks night" },
  { beats: 3, kind: "reveal", stadium: "champions", weather: "sun", keeper: "disco", rarity: 6, title: "example reveal", caption: "Golden Boot ball (example: rarity is decided on-chain)" },
  { beats: 3, kind: "commentator", stadium: "pro", weather: "sun", keeper: "squirrel", caption: "\"What a strike!\"", push: true },
  { beats: 5, kind: "friend", stadium: "park", weather: "sun", keeper: "mouse", title: "TAP TO PLAY", caption: "your Friend walks out" },
];

/** After the first view: a shorter attract loop (~10 s): a random keeper vs a ghost striker, commentary on. */
export const ATTRACT: readonly Cut[] = [
  { beats: 4, kind: "goal", stadium: "park", weather: "sun", keeper: "squirrel", caption: "Easy to play. Hard to master." },
  { beats: 3, kind: "save", stadium: "pro", weather: "rain", keeper: "octopus" },
  { beats: 7, kind: "friend", stadium: "park", weather: "sun", keeper: "mouse", title: "TAP TO PLAY" },
];

export const MONTAGE_SECONDS = MONTAGE.reduce((sum, cut) => sum + cut.beats * BEAT, 0);
export const ATTRACT_SECONDS = ATTRACT.reduce((sum, cut) => sum + cut.beats * BEAT, 0);

/** The cut playing at `t` seconds (looping), its index and how far into it we are (0..1). */
export function cutAt(t: number, reel: readonly Cut[] = MONTAGE) {
  const total = reel.reduce((sum, cut) => sum + cut.beats * BEAT, 0);
  let at = ((t % total) + total) % total;
  for (let index = 0; index < reel.length; index++) {
    const length = reel[index].beats * BEAT;
    if (at < length) return { cut: reel[index], index, progress: at / length, started: t - at };
    at -= length;
  }
  return { cut: reel[reel.length - 1], index: reel.length - 1, progress: 1, started: t };
}
