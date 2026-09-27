import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeek, baseFor, dropBudget, edgeSplit, SCHEDULE } from "./compute.mjs";

const base = { park: 1, pro: 100, champions: 1000 };

test("drops follow base × rarity multiplier per stadium", () => {
  const { rows } = computeWeek({ base, settled: [{ tier: "park", friendId: "1", outcomeId: 1 }, { tier: "park", friendId: "1", outcomeId: 7 }, { tier: "pro", friendId: "2", outcomeId: 3 }] });
  assert.equal(rows.find(r => r.friendId === "1").drops, 1 + 15);
  assert.equal(rows.find(r => r.friendId === "2").drops, 100 * 2);
});

test("race points: Gold 1, Golden Boot 2, weighted by stadium", () => {
  const { cup } = computeWeek({ base, settled: [{ tier: "park", friendId: "1", outcomeId: 6 }, { tier: "pro", friendId: "2", outcomeId: 7 }] });
  assert.deepEqual(cup.map(r => [r.friendId, r.points]), [["2", 200], ["1", 1]]);
});

test("WildcardDrawn events count at the Park weight", () => {
  const { cup, rows } = computeWeek({ base, settled: [{ tier: "park", friendId: "1", outcomeId: 6 }], wildcards: [{ friendId: "1", points: 2 }, { friendId: "3", points: 1 }, { friendId: "4", points: 0 }] });
  assert.equal(cup.find(r => r.friendId === "1").points, 3, "1 ball point + 2 wildcard points");
  assert.equal(cup.find(r => r.friendId === "3").points, 1, "wildcard-only Friend enters the race");
  assert.equal(cup.find(r => r.friendId === "4"), undefined, "a 0-point draw adds nothing");
  assert.equal(rows.find(r => r.friendId === "3").drops, 0, "wildcards drop no $GBOOT");
});

test("ties go to the lower friendId; top 10 paid on the curve", () => {
  const settled = Array.from({ length: 12 }, (_, i) => ({ tier: "park", friendId: String(20 - i), outcomeId: 6 }));
  const { cup } = computeWeek({ base, settled, potRf: 1000 });
  assert.equal(cup.length, 10);
  assert.equal(cup[0].friendId, "9");
  assert.equal(cup.reduce((s, r) => s + r.shareBps, 0), 10000);
  assert.equal(cup[0].rf, 250);
});

test("Bootroom perk tiers never change drops, race points or Cup ranks", () => {
  const settled = [{ tier: "pro", friendId: "1", outcomeId: 7 }, { tier: "pro", friendId: "2", outcomeId: 7 }, { tier: "park", friendId: "3", outcomeId: 6 }];
  const plain = computeWeek({ base, settled, potRf: 1000 });
  const laced = computeWeek({ base, settled, potRf: 1000, perks: { 2: 3, 3: 2 } });
  assert.deepEqual(laced.rows.map(r => [r.friendId, r.drops, r.race]), plain.rows.map(r => [r.friendId, r.drops, r.race]));
  assert.deepEqual(laced.cup.map(r => [r.friendId, r.points, r.rf]), plain.cup.map(r => [r.friendId, r.points, r.rf]));
  assert.equal(laced.cup[0].friendId, "1", "ties still go to the lower friendId, not the higher tier");
  assert.equal(laced.rows.find(r => r.friendId === "2").xpBonusPct, 15, "tier 3: +15% XP (progression)");
  assert.deepEqual(laced.seeding.map(r => r.friendId), ["2", "3", "1"], "seeding: tier first, then friendId");
  assert.throws(() => computeWeek({ base, settled, perks: { 1: 4 } }), /perk tier out of range/);
});

test("drop budget scales every Friend down equally", () => {
  const settled = [{ tier: "pro", friendId: "1", outcomeId: 1 }, { tier: "pro", friendId: "2", outcomeId: 1 }, { tier: "pro", friendId: "2", outcomeId: 1 }];
  const { rows, scale } = computeWeek({ base, settled, budget: 150 });
  assert.equal(scale, 0.5);
  assert.deepEqual(rows.map(r => r.drops), [100, 50]);
});

test("halving budget mirrors EmissionVault.capOf and subtracts released[week]", () => {
  assert.equal(dropBudget(0).left, 2_500_000);
  assert.equal(dropBudget(3).left, 2_500_000);
  assert.equal(dropBudget(4).left, 1_250_000);
  assert.equal(dropBudget(24).left, 39_062.5);
  assert.equal(dropBudget(0, 500_000n * 10n ** 18n).left, 2_000_000);
  assert.equal(dropBudget(0, 3_000_000n * 10n ** 18n).left, 0);
});

test("edge split 40/30/30 with EdgeSplitter's integer rounding", () => {
  const s = edgeSplit(1001n);
  assert.deepEqual([s.burn, s.buyback, s.cup], [400n, 300n, 301n]);
});

test("drop base auto-scales with the TWAP and never exceeds the schedule", () => {
  assert.deepEqual(baseFor(undefined), SCHEDULE);
  assert.equal(baseFor(0.05).park, SCHEDULE.park, "below launch the schedule binds");
  assert.ok(Math.abs(baseFor(1).park - 0.093) < 1e-4, "10× launch → one tenth of the drop");
});
