/**
 * The attract showreel as a real montage (round 6 E24): quick cuts between the three stadiums,
 * keepers, rarity reveals and goals, with camera push-ins and big type moments, cut on the music's
 * beat and ending on the player's Friend. It lasts 25–35 s, is skippable, and the title panels never
 * cover the action (the Stage keeps its safe area).
 *
 * HONESTY: the reveal cut is an EXAMPLE of the reveal animation, labelled on screen ("example
 * reveal"). It never implies a pull happened or will happen. Shots are engine-resolved skill moments.
 */
import type { KeeperId } from "@penalty-kings/engine";
import type { StadiumId, Weather } from "./stadium.js";

/** The chiptune loop steps every 180 ms; a beat is 4 steps. */
export const BEAT = 0.72;

export type CutKind = "walkout" | "goal" | "top-bin" | "save" | "post" | "freekick" | "reveal" | "celebration" | "wave" | "friend";
export type Cut = Readonly<{
  beats: number;
  kind: CutKind;
  stadium: StadiumId;
  weather: Weather;
  keeper: KeeperId;
  /** Big type moment, drawn in the top safe band only. */
  title?: string;
  /** Camera push-in during the cut. */
  push?: boolean;
  /** Rarity for the example reveal cut (0–6). */
  rarity?: number;
}>;

export const MONTAGE: readonly Cut[] = [
  { beats: 4, kind: "walkout", stadium: "park", weather: "sun", keeper: "mouse", title: "YOUR FRIEND" },
  { beats: 3, kind: "goal", stadium: "park", weather: "sun", keeper: "squirrel", push: true },
  { beats: 2, kind: "save", stadium: "park", weather: "sunset", keeper: "sloth" },
  { beats: 3, kind: "top-bin", stadium: "pro", weather: "rain", keeper: "peacock", title: "TOP BINS", push: true },
  { beats: 3, kind: "freekick", stadium: "pro", weather: "rain", keeper: "octopus", title: "BEND IT" },
  { beats: 2, kind: "post", stadium: "pro", weather: "fog", keeper: "mime" },
  { beats: 3, kind: "reveal", stadium: "pro", weather: "sun", keeper: "disco", rarity: 5, title: "example reveal" },
  { beats: 3, kind: "goal", stadium: "champions", weather: "sun", keeper: "sumo", push: true },
  { beats: 2, kind: "save", stadium: "champions", weather: "snow", keeper: "chameleon" },
  { beats: 3, kind: "top-bin", stadium: "champions", weather: "sun", keeper: "robot", title: "12 KEEPERS", push: true },
  { beats: 3, kind: "wave", stadium: "champions", weather: "sun", keeper: "ghost" },
  { beats: 4, kind: "celebration", stadium: "champions", weather: "sun", keeper: "finalwall", title: "BEAT THE FINAL WALL" },
  { beats: 5, kind: "friend", stadium: "park", weather: "sun", keeper: "mouse", title: "KICK OFF", push: true },
];

export const MONTAGE_SECONDS = MONTAGE.reduce((sum, cut) => sum + cut.beats * BEAT, 0);

/** The cut playing at `t` seconds (looping), its index and how far into it we are (0..1). */
export function cutAt(t: number) {
  let at = ((t % MONTAGE_SECONDS) + MONTAGE_SECONDS) % MONTAGE_SECONDS;
  for (let index = 0; index < MONTAGE.length; index++) {
    const length = MONTAGE[index].beats * BEAT;
    if (at < length) return { cut: MONTAGE[index], index, progress: at / length, started: t - at };
    at -= length;
  }
  return { cut: MONTAGE[MONTAGE.length - 1], index: MONTAGE.length - 1, progress: 1, started: t };
}
