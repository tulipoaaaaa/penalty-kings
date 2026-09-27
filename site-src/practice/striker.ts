/**
 * The practice striker: an original, generic 16 × 16 pixel silhouette of a footballer (head,
 * shoulders, arms, shorts, legs). It is NOT a Rare Friends sprite; the free practice page never loads
 * Friend art. The Stage draws it exactly like a Friend mask ('#' = a black pixel with a kit-coloured
 * halo), through its `rows` provider.
 */
import type { RowsProvider } from "../../games/penalty-kings/gfx/stage.js";

const TOP = [
  "................",
  "......####......",
  ".....######.....",
  ".....######.....",
  "......####......",
  "....########....",
  "...##########...",
  "..###.####.###..",
  "..##..####..##..",
  "..##..####..##..",
  "......####......",
];
/** Legs: standing, and two walking frames. */
const STAND = [".....##..##.....", ".....##..##.....", ".....##..##.....", ".....##..##.....", "................"];
const STEP_A = ["....##....##....", "....##....##....", "...##......##...", "...##.......##..", "................"];
const STEP_B = [".....##..##.....", "......####......", "......##.##.....", ".....##...##....", "................"];

export const STRIKER_STAND: readonly string[] = [...TOP, ...STAND];
const WALK: readonly (readonly string[])[] = [[...TOP, ...STEP_A], STRIKER_STAND, [...TOP, ...STEP_B], STRIKER_STAND];

/** Same silhouette for every facing (it reads the same from behind or in front); walking alternates the legs. */
export const strikerRows: RowsProvider = (_facing, walking, frame) => (walking ? WALK[Math.floor(frame / 2) % WALK.length] : STRIKER_STAND);
