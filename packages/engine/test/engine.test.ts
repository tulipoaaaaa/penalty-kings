import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, resolveShot, kickSeed, shotTarget, streakMultiplier, goalPoints, keeperById } from "../src/index.ts";

test("resolution is deterministic for the same inputs and seed", () => {
  const shot = { aimX: 0.7, loft: 0.05, power: 0.8, curl: -0.3 };
  for (const keeper of KEEPERS) {
    const seed = kickSeed(42, 3, keeper.id);
    assert.deepEqual(resolveShot(shot, keeper, seed), resolveShot(shot, keeper, seed));
  }
});

test("overpowered shots clear the bar and wide shots miss", () => {
  const wall = keeperById("sumo");
  assert.equal(resolveShot({ aimX: 0.2, loft: 0, power: 1, curl: 0 }, wall, 1).result, "over");
  assert.equal(resolveShot({ aimX: 1.4, loft: 0, power: 0.7, curl: 0 }, wall, 1).result, "wide");
  assert.equal(resolveShot({ aimX: 1.0, loft: 0, power: 0.6, curl: 0 }, wall, 1).result, "post");
});

test("shot target moves with curl and power", () => {
  assert.ok(shotTarget({ aimX: 0, loft: 0, power: 0.8, curl: 1 }).x > shotTarget({ aimX: 0, loft: 0, power: 0.8, curl: 0 }).x);
  assert.ok(shotTarget({ aimX: 0, loft: 0, power: 0.9, curl: 0 }).time < shotTarget({ aimX: 0, loft: 0, power: 0.5, curl: 0 }).time);
});

test("streak caps at x3 and tougher keepers score more", () => {
  assert.equal(streakMultiplier(1), 1); assert.equal(streakMultiplier(3), 2); assert.equal(streakMultiplier(50), 3);
  assert.ok(goalPoints(keeperById("ghost"), 1, 1, false) > goalPoints(keeperById("squirrel"), 1, 1, false));
});

test("every keeper can be beaten and can save", () => {
  for (const keeper of KEEPERS) {
    const results = new Set<string>();
    for (let i = 0; i < 400; i++) results.add(resolveShot({ aimX: ((i % 21) - 10) / 11, loft: 0, power: 0.55 + (i % 7) * 0.05, curl: 0 }, keeper, kickSeed(i, 0, keeper.id)).result);
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
    const plan = resolveShot({ aimX: 0, loft: 0, power: 0.7, curl: 0 }, mime, seed).plan;
    const mid = (plan.wall![0] + plan.wall![1]) / 2;
    assert.equal(resolveShot({ aimX: mid, loft: 0, power: 0.7, curl: 0 }, mime, seed).result, "save");
  }
  const mouse = keeperById("mouse");
  let topGoals = 0;
  for (let seed = 0; seed < 200; seed++) if (resolveShot({ aimX: 0.8, loft: 0.05, power: 0.8, curl: 0 }, mouse, seed).result === "goal") topGoals++;
  assert.equal(topGoals, 200);
});

test("the robot learns a favourite corner from history", () => {
  const robot = keeperById("robot");
  let right = 0;
  for (let seed = 0; seed < 400; seed++) if (resolveShot({ aimX: 0.7, loft: 0, power: 0.75, curl: 0 }, robot, seed, { kickIndex: 3, history: [0.8, 0.7, 0.9] }).plan.x > 0) right++;
  assert.ok(right > 300, `robot dives to the learned side (${right}/400)`);
});

test("the boss has three phases by kick index", () => {
  const boss = keeperById("finalwall");
  assert.deepEqual([0, 2, 4].map(k => resolveShot({ aimX: 0.5, loft: 0, power: 0.7, curl: 0 }, boss, 1, { kickIndex: k, history: [] }).plan.phase), [1, 2, 3]);
});
