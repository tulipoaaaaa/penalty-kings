/**
 * Original Penalty Kings pixel art (16 × 16 masks, same grid as the canonical
 * Friend walking sprites). Drawn for this game; no third-party artwork.
 * '#' = body, 'o' = glove/accent, '.' = empty.
 */

const pad = (rows: readonly string[]) => rows.map(row => row.padEnd(16, ".").slice(0, 16));


/** 9 × 9 football. '#' = panel, 'o' = rarity accent. */
export const BALL_ROWS = [
  "..#####..",
  ".#..o..#.",
  "#..ooo..#",
  "#.o...o.#",
  "#oo...oo#",
  "#.o...o.#",
  "#..ooo..#",
  ".#..o..#.",
  "..#####..",
];

/** Kit-bag icon for the HUD. */
export const BAG_ROWS = [
  "...####...",
  "..#....#..",
  "##########",
  "#........#",
  "#.##..##.#",
  "#........#",
  "##########",
];
