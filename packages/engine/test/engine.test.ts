import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, resolveShot, kickSeed, shotTarget, streakMultiplier, goalPoints, keeperById } from "../src/index.ts";

test("resolution is deterministic for the same inputs and seed", () => {
  const shot = { aimX: 0.7, aimY: 0.9, power: 0.8, curl: -0.3 };
  for (const keeper of KEEPERS) {
    const seed = kickSeed(42, 3, keeper.id);
    assert.deepEqual(resolveShot(shot, keeper, seed), resolveShot(shot, keeper, seed));
  }
});

test("overpowered shots clear the bar and wide shots miss", () => {
  const wall = keeperById("sumo");
  assert.equal(resolveShot({ aimX: 0.2, aimY: 1.1, power: 1, curl: 0 }, wall, 1).result, "over");
  assert.equal(resolveShot({ aimX: 1.4, aimY: 0.725, power: 0.7, curl: 0 }, wall, 1).result, "wide");
  assert.equal(resolveShot({ aimX: 1.0, aimY: 0.6, power: 0.6, curl: 0 }, wall, 1).result, "post");
});

test("shot target moves with curl and power", () => {
  assert.ok(shotTarget({ aimX: 0, aimY: 0.85, power: 0.8, curl: 1 }).x > shotTarget({ aimX: 0, aimY: 0.85, power: 0.8, curl: 0 }).x);
  assert.ok(shotTarget({ aimX: 0, aimY: 0.975, power: 0.9, curl: 0 }).time < shotTarget({ aimX: 0, aimY: 0.475, power: 0.5, curl: 0 }).time);
});

test("streak caps at x3 and tougher keepers score more", () => {
  assert.equal(streakMultiplier(1), 1); assert.equal(streakMultiplier(3), 2); assert.equal(streakMultiplier(50), 3);
  assert.ok(goalPoints(keeperById("ghost"), 1, 1, false) > goalPoints(keeperById("squirrel"), 1, 1, false));
});

test("every keeper can be beaten and can save", () => {
  for (const keeper of KEEPERS) {
    const results = new Set<string>();
    for (let i = 0; i < 400; i++) results.add(resolveShot({ aimX: ((i % 21) - 10) / 11, aimY: 1.25 * (0.55 + (i % 7) * 0.05) - 0.15 + 0.0, power: 0.55 + (i % 7) * 0.05, curl: 0 }, keeper, kickSeed(i, 0, keeper.id)).result);
    assert.ok(results.has("goal") && results.has("save"), keeper.name);
  }
});

test("there are 12 original keepers with distinct ids, one boss", () => {
  assert.equal(KEEPERS.length, 12);
  assert.equal(new Set(KEEPERS.map(k => k.id)).size, 12);
  assert.equal(KEEPERS.filter(k => k.boss).length, 1);
});

test("mime wall saves shots into its third; mouse cannot reach the top corners", () => {
  const mime = keeperById("mime");
  for (let seed = 0; seed < 50; seed++) {
    const plan = resolveShot({ aimX: 0, aimY: 0.725, power: 0.7, curl: 0 }, mime, seed).plan;
    const mid = (plan.wall![0] + plan.wall![1]) / 2;
    assert.equal(resolveShot({ aimX: mid, aimY: 0.725, power: 0.7, curl: 0 }, mime, seed).result, "save");
  }
  const mouse = keeperById("mouse");
  let topGoals = 0;
  for (let seed = 0; seed < 200; seed++) if (resolveShot({ aimX: 0.8, aimY: 0.9, power: 0.8, curl: 0 }, mouse, seed).result === "goal") topGoals++;
  assert.equal(topGoals, 200);
});

test("the robot learns a favourite corner from history", () => {
  const robot = keeperById("robot");
  let right = 0;
  for (let seed = 0; seed < 400; seed++) if (resolveShot({ aimX: 0.7, aimY: 0.7875, power: 0.75, curl: 0 }, robot, seed, { kickIndex: 3, history: [0.8, 0.7, 0.9] }).plan.x > 0) right++;
  assert.ok(right > 300, `robot dives to the learned side (${right}/400)`);
});

test("the boss has three phases by kick index", () => {
  const boss = keeperById("finalwall");
  assert.deepEqual([0, 2, 4].map(k => resolveShot({ aimX: 0.5, aimY: 0.725, power: 0.7, curl: 0 }, boss, 1, { kickIndex: k, history: [] }).plan.phase), [1, 2, 3]);
});

import { shotZone, ZONE_MULT, swipeToShot, assistShot, nextDifficultyLevel, DIFFICULTY_LADDER, NEUTRAL, type ShotRecord } from "../src/index.ts";

test("placement zones: centre 1x, side 2x, corner 3x, top bin 5x; in off the post +50%", () => {
  assert.equal(shotZone({ x: 0.1, y: 0.3 }), "centre");
  assert.equal(shotZone({ x: -0.5, y: 0.3 }), "side");
  assert.equal(shotZone({ x: 0.8, y: 0.3 }), "corner");
  assert.equal(shotZone({ x: -0.85, y: 0.8 }), "bin");
  assert.deepEqual([ZONE_MULT.centre, ZONE_MULT.corner, ZONE_MULT.bin], [1, 3, 5]);
  const squirrel = keeperById("squirrel");
  assert.equal(goalPoints(squirrel, 1, 1, false, "bin"), 500);
  assert.equal(goalPoints(squirrel, 1, 1, false, "corner", true), 450);
});

test("low centre shots are usually saved; a chipped centre can beat the trailing leg", () => {
  const mouse = keeperById("mouse");
  let lowSaved = 0, chipGoals = 0;
  for (let seed = 0; seed < 400; seed++) {
    if (resolveShot({ aimX: 0.05, aimY: 0.4125, power: 0.45, curl: 0 }, mouse, seed).result === "save") lowSaved++;
    if (resolveShot({ aimX: 0.05, aimY: 0.75, power: 0.72, curl: 0 }, mouse, seed).result === "goal") chipGoals++;
  }
  assert.ok(lowSaved > 250, `low centre saved ${lowSaved}/400`);
  assert.ok(chipGoals > 0, `chip scored ${chipGoals}/400`);
});

test("clipping the inside of the post sometimes goes in (and is flagged), never from outside", () => {
  const keeper = keeperById("sloth");
  let inside = 0, outsideIn = 0;
  for (let seed = 0; seed < 300; seed++) {
    const a = resolveShot({ aimX: 0.97, aimY: 0.475, power: 0.5, curl: 0 }, keeper, seed);
    if (a.postIn) { inside++; assert.equal(a.result, "goal"); }
    if (resolveShot({ aimX: 1.02, aimY: 0.475, power: 0.5, curl: 0 }, keeper, seed).postIn) outsideIn++;
  }
  assert.ok(inside > 60 && inside < 240, `inside post-ins ${inside}/300`);
  assert.equal(outsideIn, 0);
});

test("difficulty only changes the keeper through its parameters and is deterministic", () => {
  const shot = { aimX: 0.6, aimY: 0.6, power: 0.6, curl: 0 };
  for (const keeper of KEEPERS) for (const d of DIFFICULTY_LADDER) {
    const seed = kickSeed(7, 1, keeper.id);
    assert.deepEqual(resolveShot(shot, keeper, seed, undefined, d), resolveShot(shot, keeper, seed, undefined, d));
  }
  // NEUTRAL is the referee's setting: identical to omitting the argument.
  assert.deepEqual(resolveShot(shot, keeperById("finalwall"), 9), resolveShot(shot, keeperById("finalwall"), 9, undefined, NEUTRAL));
});

test("taps and downward swipes do nothing", () => {
  const size = { width: 480, height: 320 };
  assert.equal(swipeToShot([{ x: 240, y: 220, t: 0 }, { x: 241, y: 219, t: 50 }], size), null);
  assert.equal(swipeToShot([{ x: 240, y: 200, t: 0 }, { x: 240, y: 300, t: 100 }], size), null);
});

test("aim assist pulls towards zone centres and keeps power below an overhit", () => {
  const assisted = assistShot({ aimX: 0.7, aimY: 1.05, power: 0.98, curl: 0 }, 1);
  assert.ok(Math.abs(assisted.aimX - 0.8) < Math.abs(0.7 - 0.8));
  assert.ok(assisted.aimY <= 0.9 + 1e-9 && assisted.power < 0.9);
  assert.deepEqual(assistShot({ aimX: 0.7, aimY: 0.5, power: 0.98, curl: 0 }, 0), { aimX: 0.7, aimY: 0.5, power: 0.98, curl: 0 });
});

test("dynamic difficulty moves one rung between rounds, only with evidence", () => {
  const goals = (n: number, of: number): ShotRecord[] => Array.from({ length: of }, (_, i) => ({ goal: i < n, zone: "corner" as const }));
  assert.equal(nextDifficultyLevel(3, goals(3, 4)), 3, "needs 5 shots");
  assert.equal(nextDifficultyLevel(3, goals(9, 10)), 4);
  assert.equal(nextDifficultyLevel(3, goals(2, 10)), 2);
  assert.equal(nextDifficultyLevel(3, goals(6, 10)), 3);
  assert.equal(nextDifficultyLevel(DIFFICULTY_LADDER.length - 1, goals(10, 10)), DIFFICULTY_LADDER.length - 1);
  assert.equal(nextDifficultyLevel(0, goals(0, 10)), 0);
});
