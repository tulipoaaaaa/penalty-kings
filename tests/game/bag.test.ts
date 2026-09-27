// Honesty tests for the Bag (games/penalty-kings/game/bag.ts): choosing or kicking a ball never
// touches rarity, season, tier, id or RF value; the Bag always mirrors the on-chain inventory;
// the pack summary reports true totals, losses included.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Zone } from "@penalty-kings/engine";
import { kickStyle, recordKick, syncBag, packSummary, addPulls, CURRENT_SEASON, type BallRecord } from "../../games/penalty-kings/game/bag.ts";
import { RARITIES } from "../../games/penalty-kings/economy.ts";
import park from "../../games/penalty-kings/tiers/park.json";

const DROP = RARITIES.map(r => r.dropMult);
const PRICE = BigInt(park.price);
const rewardOf = (rarity: number) => BigInt(park.outcomes[rarity].reward);
const ZONES: Zone[] = ["centre", "side", "corner", "bin"];
const SKILL_FIELDS = ["crowd", "fx", "intro", "luckyTrail", "scoreMult"];
const IDENTITY_FIELDS = ["id", "rarity", "season", "tier", "pulledAt", "lucky", "sample"] as const;

// Deterministic PRNG (mulberry32) so failures reproduce.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length)];
const deepFreeze = <T extends object>(o: T): T => Object.freeze(o);

function randomRecord(r: () => number, i: number): BallRecord {
  return {
    id: `r${i}`, rarity: Math.floor(r() * 7), season: pick(r, ["S0", "S1"] as const), tier: pick(r, ["park", "pro", "champions"] as const),
    pulledAt: 1_000 + i, kicks: Math.floor(r() * 50), goals: Math.floor(r() * 30), topBins: Math.floor(r() * 10), lucky: r() < 0.1,
    ...(r() < 0.1 ? { sample: true } : {}),
  };
}

test("kickStyle() returns only skill-layer fields and never reads or writes value", () => {
  const r = rng(1);
  assert.deepEqual(Object.keys(kickStyle(null, DROP)).sort(), SKILL_FIELDS);
  for (let i = 0; i < 500; i++) {
    const record = deepFreeze(randomRecord(r, i));
    const before = structuredClone(record);
    const style = kickStyle(record, DROP);
    assert.deepEqual(Object.keys(style).sort(), SKILL_FIELDS, "no rarity, value, odds or prize field");
    for (const forbidden of ["rarity", "reward", "value", "odds", "chanceBps", "season", "tier", "id"]) assert.ok(!(forbidden in style), forbidden);
    assert.equal(style.scoreMult, DROP[record.rarity], "score multiplier comes from the fixed rarity");
    assert.deepEqual(record, before, "the record is untouched");
    assert.equal(rewardOf(record.rarity), rewardOf(before.rarity), "RF value unchanged by choosing");
  }
});

test("recordKick() changes only kicks/goals/topBins", () => {
  const r = rng(2);
  for (let i = 0; i < 1_000; i++) {
    const record = deepFreeze(randomRecord(r, i));
    const kick = { goal: r() < 0.5, zone: pick(r, ZONES) };
    const after = recordKick(record, kick);
    for (const field of IDENTITY_FIELDS) assert.deepEqual(after[field], record[field], field);
    assert.equal(rewardOf(after.rarity), rewardOf(record.rarity), "RF value never changes");
    assert.deepEqual(Object.keys(after).sort(), Object.keys(record).sort(), "no new fields");
    assert.equal(after.kicks, record.kicks + 1);
    assert.equal(after.goals, record.goals + (kick.goal ? 1 : 0));
    assert.equal(after.topBins, record.topBins + (kick.goal && kick.zone === "bin" ? 1 : 0));
  }
  // A hundred kicks later a Scuffed Ball is still a Scuffed Ball.
  let ball = addPulls([], [0], "park", 5)[0];
  for (let i = 0; i < 100; i++) ball = recordKick(ball, { goal: true, zone: "bin" });
  assert.equal(ball.rarity, 0);
  assert.equal(ball.season, CURRENT_SEASON);
  assert.equal(ball.topBins, 100);
});

test("syncBag() always matches the inventory counts exactly", () => {
  const r = rng(3);
  for (let round = 0; round < 400; round++) {
    const records = Array.from({ length: Math.floor(r() * 25) }, (_, i) => randomRecord(r, round * 100 + i));
    const inventory = Array.from({ length: 7 }, () => BigInt(Math.floor(r() * 6)));
    const synced = syncBag(records, inventory, "park", 9_999);
    const real = synced.filter(record => !record.sample);
    for (let rarity = 0; rarity < 7; rarity++) {
      assert.equal(real.filter(record => record.rarity === rarity).length, Number(inventory[rarity]), `rarity ${rarity}`);
    }
    assert.equal(real.length, Number(inventory.reduce((a, b) => a + b, 0n)));
    // Samples are shown but never counted, and never dropped or invented.
    assert.deepEqual(synced.filter(record => record.sample), records.filter(record => record.sample));
    // Kept records are untouched; new ones start with clean stats in the current season.
    const known = new Map(records.map(record => [record.id, record]));
    for (const record of real) {
      if (known.has(record.id)) assert.deepEqual(record, known.get(record.id));
      else assert.deepEqual([record.kicks, record.goals, record.topBins, record.lucky, record.season], [0, 0, 0, false, CURRENT_SEASON]);
    }
    // Lucky balls are dropped last.
    for (let rarity = 0; rarity < 7; rarity++) {
      const mine = records.filter(record => !record.sample && record.rarity === rarity);
      const luckyHeld = mine.filter(record => record.lucky).length;
      const keptLucky = real.filter(record => record.rarity === rarity && record.lucky).length;
      assert.equal(keptLucky, Math.min(luckyHeld, Number(inventory[rarity])));
    }
    // Idempotent.
    assert.deepEqual(syncBag(synced, inventory, "park", 12_345), synced);
  }
  assert.deepEqual(syncBag([], [0n, 0n, 0n, 0n, 0n, 0n, 0n], "park", 1), []);
});

test("packSummary() reports true totals including losses", () => {
  // All Scuffed: the whole spend is lost and the summary says so.
  const lost = packSummary([0, 0, 0], PRICE, rewardOf);
  assert.deepEqual(lost, { spent: 3n * PRICE, pulled: 0n, net: -3n * PRICE, count: 3, best: 0 });
  // Training + Match: 5 + 10 RF back for 20 RF spent → −5 RF.
  const small = packSummary([1, 2], PRICE, rewardOf);
  assert.equal(small.net, -5n * 10n ** 18n);
  // Golden Boot: a win, reported as a win.
  assert.equal(packSummary([6, 0], PRICE, rewardOf).net, 80n * 10n ** 18n);
  assert.deepEqual(packSummary([], PRICE, rewardOf), { spent: 0n, pulled: 0n, net: 0n, count: 0, best: -1 });
  const r = rng(4);
  for (let i = 0; i < 500; i++) {
    const rarities = Array.from({ length: 1 + Math.floor(r() * 20) }, () => Math.floor(r() * 7));
    const summary = packSummary(rarities, PRICE, rewardOf);
    let pulled = 0n;
    for (const rarity of rarities) pulled += BigInt(park.outcomes[rarity].reward);
    assert.equal(summary.spent, PRICE * BigInt(rarities.length));
    assert.equal(summary.pulled, pulled);
    assert.equal(summary.net, pulled - summary.spent, "net is never rounded, hidden or clamped at zero");
    assert.equal(summary.count, rarities.length);
    assert.equal(summary.best, Math.max(...rarities));
  }
});
