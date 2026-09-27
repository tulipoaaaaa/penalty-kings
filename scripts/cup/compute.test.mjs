import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWeek } from "./compute.mjs";

const base = { park: 13, pro: 1395, champions: 13953 };

test("drops follow base × rarity multiplier per stadium", () => {
  const { rows } = computeWeek({ base, settled: [{ tier: "park", friendId: "1", outcomeId: 1 }, { tier: "park", friendId: "1", outcomeId: 7 }, { tier: "pro", friendId: "2", outcomeId: 3 }] });
  assert.equal(rows.find(r => r.friendId === "1").drops, 13 + 13 * 15);
  assert.equal(rows.find(r => r.friendId === "2").drops, 1395 * 2);
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
