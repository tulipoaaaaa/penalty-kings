import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGroups, standings, knockoutPairs, advance, pairUp, decide, type Entrant, type Shootout } from "../../games/penalty-kings/game/bracket.ts";

const shoot = (points: number, goals = Math.round(points / 300), topBins = 0, submittedAt = 0): Shootout => ({ points, goals, topBins, submittedAt });

test("snake seeding spreads the strongest entrants across groups; no one is lost", () => {
  const entrants: Entrant[] = Array.from({ length: 16 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, seedScore: 1600 - i * 100 }));
  const groups = buildGroups(entrants);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.map(g => g[0].id).sort(), ["f0", "f1", "f2", "f3"], "each group gets one top seed");
  assert.equal(groups.flat().length, 16);
  assert.equal(new Set(groups.flat().map(e => e.id)).size, 16);
});

test("head-to-head: points, then goals, then top bins, then earlier submission", () => {
  assert.equal(decide(shoot(900), shoot(600)), "a");
  assert.equal(decide(shoot(900, 3), shoot(900, 4)), "b");
  assert.equal(decide(shoot(900, 3, 1), shoot(900, 3, 2)), "b");
  assert.equal(decide(shoot(900, 3, 1, 5), shoot(900, 3, 1, 9)), "a");
});

test("groups → knockouts → champion, deterministic", () => {
  const entrants: Entrant[] = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, seedScore: 800 - i }));
  const groups = buildGroups(entrants);
  const skill = (id: string) => 2000 - Number(id.slice(1)) * 150; // lower id = better player
  const results = new Map<string, Shootout>();
  for (const g of groups) for (const a of g) for (const b of g) if (a !== b) results.set(`${a.id}>${b.id}`, shoot(skill(a.id)));
  const tables = groups.map(g => standings(g, results));
  for (const t of tables) { assert.equal(t[0].played, 3); assert.ok(t[0].wins >= t[1].wins); }
  const pairs = knockoutPairs(tables);
  assert.equal(pairs.length, 2);
  for (const [a, b] of pairs) assert.ok(!groups.some(g => g.some(e => e.id === a) && g.some(e => e.id === b)), "group-mates never meet in round 1");
  const finalists = advance(pairs, new Map(pairs.flat().map(id => [id, shoot(skill(id))])));
  const [champion] = advance(pairUp(finalists), new Map(finalists.map(id => [id, shoot(skill(id))])));
  assert.equal(champion, "f0");
  assert.deepEqual(knockoutPairs(groups.map(g => standings(g, results))), pairs, "same inputs, same bracket");
});
