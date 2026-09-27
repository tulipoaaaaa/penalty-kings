// C2: the World Tour "points" objectives after the streak-curve change (x1.2 at 3, x1.5 at 5, x2 at 10, cap x2).
import { test } from "node:test";
import assert from "node:assert/strict";
import levels from "../../games/penalty-kings/game/levels.json" with { type: "json" };
import type { Level } from "../../games/penalty-kings/game/objectives.ts";
import { maxPoints, threeGoalPoints, goodPlayer, rescale, STRONG_PLAYER, sessionPoints } from "../../scripts/lib/level-points.ts";
import { goalPoints, keeperById } from "@penalty-kings/engine";

const LEVELS = levels as unknown as Level[];
const pointsObjectives = LEVELS.flatMap(level => level.objectives.filter(o => o.type === "points").map(o => ({ level, count: (o as { count: number }).count })));
/** The thresholds as tuned against the OLD curve (x1.5 at 2, x2 at 3, cap x3), before C2. */
const PRE_C2: Record<string, number> = { "park-3": 1500, "park-6": 2500, "park-10": 4000, "pro-8": 5000, "pro-10": 7000, "champions-8": 9000 };

test("the level-points model scores exactly like the engine's goalPoints (new curve)", () => {
  const kicks = [{ goal: true, zone: "side", postIn: false }, { goal: true, zone: "bin", postIn: false }, { goal: true, zone: "corner", postIn: true }, { goal: false }, { goal: true, zone: "corner", postIn: false }] as const;
  const keeper = keeperById("peacock");
  // Streak paid (streak + 1): side at 1 (→ 1), top bin at 2 (Skill Zone: → 3), post-in at 4 (→ 5), miss (→ 0), corner at 1.
  const expected = goalPoints(keeper, 1, 1, false, "side") + goalPoints(keeper, 1, 2, false, "bin") + goalPoints(keeper, 1, 4, false, "corner", true) + goalPoints(keeper, 1, 1, false, "corner");
  assert.equal(sessionPoints("peacock", kicks as never, "new"), expected);
});

test("every World Tour points objective is reachable and more than a plain 3-goal session", () => {
  assert.deepEqual(pointsObjectives.map(o => o.level.id).sort(), Object.keys(PRE_C2).sort(), "the known points objectives");
  for (const { level, count } of pointsObjectives) {
    assert.equal(level.mode, "penalty", `${level.id}: the model scores penalties`);
    const max = maxPoints(level.keeper, level.kicks, "new"), three = threeGoalPoints(level.keeper, level.kicks, "new");
    assert.ok(count <= max, `${level.id}: ${count} ≤ max ${max}`);
    assert.ok(count > three, `${level.id}: ${count} > a plain 3-goal session (${three})`);
    assert.equal(count % 250, 0, `${level.id}: a clean number`);
  }
});

test("points thresholds keep their pre-C2 difficulty: a strong player reaches each as often as before (±10 points of %)", () => {
  for (const { level, count } of pointsObjectives) {
    const before = goodPlayer(level.keeper, level.kicks, "old", PRE_C2[level.id], STRONG_PLAYER).reach;
    const now = goodPlayer(level.keeper, level.kicks, "new", count, STRONG_PLAYER).reach;
    assert.ok(Math.abs(now - before) <= 0.1, `${level.id}: ${count} reached ${(now * 100).toFixed(0)}% vs ${(before * 100).toFixed(0)}% before`);
    assert.equal(count, rescale(level.keeper, level.kicks, PRE_C2[level.id]), `${level.id}: the rescaled threshold`);
  }
});
