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
  const wall = keeperById("wall");
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
  assert.ok(goalPoints(keeperById("ghost"), 1, 1, false) > goalPoints(keeperById("showboat"), 1, 1, false));
});

test("every keeper can be beaten and can save", () => {
  for (const keeper of KEEPERS) {
    const results = new Set<string>();
    for (let i = 0; i < 400; i++) results.add(resolveShot({ aimX: ((i % 21) - 10) / 11, loft: 0, power: 0.55 + (i % 7) * 0.05, curl: 0 }, keeper, kickSeed(i, 0, keeper.id)).result);
    assert.ok(results.has("goal") && results.has("save"), keeper.name);
  }
});
