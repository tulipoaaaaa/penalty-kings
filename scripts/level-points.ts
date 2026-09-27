// World Tour "points" objectives under the old and the C2 streak curve (see scripts/lib/level-points.ts).
// Usage: node --experimental-strip-types scripts/level-points.ts [--original <path to the pre-C2 levels.json>]
// Prints, per points objective: max, a 3-goal session, the good and strong players' expectations, and the
// rescaled threshold (lib rescale: the closest chance for a strong player to reach it, clean numbers).
import { readFileSync } from "node:fs";
import { maxPoints, threeGoalPoints, goodPlayer, rescale, STRONG_PLAYER } from "./lib/level-points.ts";

const args = process.argv.slice(2);
const file = args.includes("--original") ? args[args.indexOf("--original") + 1] : new URL("../games/penalty-kings/game/levels.json", import.meta.url);
const levels = JSON.parse(readFileSync(file, "utf8")) as { id: string; mode: string; keeper: never; kicks: number; objectives: { type: string; count: number }[] }[];
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log("| Level | Keeper | Kicks | Threshold old → new | Max old / new | 3 side goals old / new | Good E old / new | Strong E old / new | P(reach) strong: old@old / new@new | P(reach) good: old@old / new@new |");
console.log("|---|---|---:|---|---|---|---|---|---:|---:|");
for (const level of levels) for (const objective of level.objectives) {
  if (objective.type !== "points") continue;
  if (level.mode !== "penalty") throw new Error(`${level.id}: free-kick points objectives need the free-kick scoring model`);
  const eOld = goodPlayer(level.keeper, level.kicks, "old").expected, eNew = goodPlayer(level.keeper, level.kicks, "new").expected;
  const old = objective.count; // run with --original <pre-C2 levels.json> for the old → new table
  const rescaled = rescale(level.keeper, level.kicks, old);
  const s = (curve: "old" | "new", t: number) => goodPlayer(level.keeper, level.kicks, curve, t, STRONG_PLAYER), g = (curve: "old" | "new", t: number) => goodPlayer(level.keeper, level.kicks, curve, t);
  console.log(`| ${level.id} | ${level.keeper} | ${level.kicks} | ${old} → ${rescaled} | ${maxPoints(level.keeper, level.kicks, "old")} / ${maxPoints(level.keeper, level.kicks, "new")} | ${threeGoalPoints(level.keeper, level.kicks, "old")} / ${threeGoalPoints(level.keeper, level.kicks, "new")} | ${Math.round(eOld)} / ${Math.round(eNew)} | ${Math.round(s("old", 0).expected)} / ${Math.round(s("new", 0).expected)} | ${pct(s("old", old).reach)} / ${pct(s("new", rescaled).reach)} | ${pct(g("old", old).reach)} / ${pct(g("new", rescaled).reach)} |`);
}
