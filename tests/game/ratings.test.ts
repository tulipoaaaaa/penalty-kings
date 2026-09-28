// EARLY ACCESS: per-Friend ratings (payout rate by Friend generation) and the odds generated from them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ratingConfig, ratingConfigErrors, parseRatingConfig, payoutBps, solveChances, chanceTableErrors, expectedReturnBps, expectedReturnX10,
  bankFigures, ratingOfTable, ratedDefinition, ratedVariants, bonusApplies, oddsLabel, percentToBps,
  BASE_CHANCES, MULTIPLES_X10, GENERATIONS, RATING_STEP_BPS, MIN_SOLVABLE_BPS, MAX_SOLVABLE_BPS, type RatingConfig,
} from "../../games/penalty-kings/game/ratings.ts";

const shipped = ratingConfig();
const withBonus = (patch: Partial<RatingConfig["bonus"]> = {}): RatingConfig => ({ ...shipped, bonus: { ...shipped.bonus, enabled: true, ...patch } });
const clone = () => JSON.parse(JSON.stringify(shipped));

test("ratings: the owner's table, gen-6 90% up to gen-1 95% (linear, 1 point per generation)", () => {
  assert.deepEqual(GENERATIONS.map(gen => payoutBps(shipped, gen)), [9500, 9400, 9300, 9200, 9100, 9000]);
  // linear between gen-5 (91%) and gen-1 (95%) gives exactly the listed values
  for (const gen of GENERATIONS) if (gen <= 5) assert.equal(payoutBps(shipped, gen), 9100 + (5 - gen) * 100);
  assert.equal(payoutBps(shipped, 7), null, "an unrated generation has no rating (buying is off)");
  assert.equal(shipped.bonus.enabled, false, "the cosmetic bonus is OFF by default");
  assert.equal(shipped.bonus.points, 0.5);
  assert.equal(shipped.previewGeneration, 3, "the preview Friend #7730 is generation 3 on-chain");
});

test("ratings: gen-6 is exactly today's judged table", () => {
  assert.deepEqual(solveChances(9000), [...BASE_CHANCES]);
  const park = JSON.parse(readFileSync(new URL("../../games/penalty-kings/tiers/park.json", import.meta.url), "utf8"));
  assert.deepEqual(park.outcomes.map((o: { chanceBps: number }) => o.chanceBps), [...BASE_CHANCES]);
});

test("ratings → odds: exact RTP, sum 10,000 bps, monotone, whole basis points, clean 10-bp steps per whole percent", () => {
  for (const gen of GENERATIONS) {
    const rtp = payoutBps(shipped, gen)!, chances = solveChances(rtp);
    assert.deepEqual(chanceTableErrors(chances, rtp), [], `gen-${gen}`);
    assert.equal(chances.reduce((a, b) => a + b, 0), 10000);
    assert.equal(expectedReturnBps(chances), rtp);
    assert.equal(expectedReturnX10(chances), rtp * 10);
    chances.forEach(chance => { assert.ok(Number.isInteger(chance) && chance >= 0); assert.equal(chance % 10, 0, "whole-percent ratings give multiples of 10 bps"); });
    for (let i = 1; i < chances.length; i++) assert.ok(chances[i] <= chances[i - 1], `gen-${gen} monotone at ${i}`);
    assert.deepEqual(chances.slice(5), [250, 100], "Gold and Golden Boot chances never move (jackpot odds and bank reserve are the same for everyone)");
  }
  assert.deepEqual(solveChances(9500), [2850, 2700, 2100, 1200, 800, 250, 100]);
  assert.deepEqual(solveChances(9300), [2970, 2700, 2060, 1160, 760, 250, 100]);
});

test("ratings → odds: a higher rating never lowers a paying chance; every 0.05% step is exact", () => {
  let previous = solveChances(MIN_SOLVABLE_BPS);
  for (let rtp = MIN_SOLVABLE_BPS; rtp <= MAX_SOLVABLE_BPS; rtp += RATING_STEP_BPS) {
    const chances = solveChances(rtp);
    assert.deepEqual(chanceTableErrors(chances, rtp), [], `rtp ${rtp}`);
    for (let i = 1; i < chances.length; i++) assert.ok(chances[i] >= previous[i], `rtp ${rtp}: rarity ${i}`);
    assert.ok(chances[0] <= previous[0]);
    previous = chances;
  }
  assert.throws(() => solveChances(MAX_SOLVABLE_BPS + RATING_STEP_BPS), /outside/);
  assert.throws(() => solveChances(MIN_SOLVABLE_BPS - RATING_STEP_BPS), /outside/);
  assert.throws(() => solveChances(9300.5), /multiple of 0.05%/);
  assert.throws(() => solveChances(9301), /multiple of 0.05%/);
});

test("bank: every rating's max payout is one Golden Boot (10× price), the reserve each ball holds until it settles", () => {
  for (const gen of GENERATIONS) for (const bonus of [false, true]) {
    const chances = solveChances(payoutBps(withBonus(), gen, bonus)!);
    assert.deepEqual(bankFigures(chances), { maxPayoutX: 10, reserveX: 10 });
    assert.equal(MULTIPLES_X10[6], 100);
  }
});

test("bonus: rating + cosmetic bonus stays strictly below 100% for every generation", () => {
  const on = withBonus();
  for (const gen of GENERATIONS) {
    const rtp = payoutBps(on, gen, true)!;
    assert.equal(rtp, payoutBps(on, gen)! + 50, `gen-${gen}: +0.5 points`);
    assert.ok(rtp < 10000, `gen-${gen}: ${rtp} bps must be below 100%`);
    assert.deepEqual(chanceTableErrors(solveChances(rtp), rtp), []);
  }
  // OFF (shipped): the bonus never applies, even with the cosmetic owned
  assert.equal(payoutBps(shipped, 1, true), 9500);
  assert.equal(bonusApplies(shipped, ["Lucky Laces"]), false);
  assert.equal(bonusApplies(on, ["Lucky Laces"]), true);
  assert.equal(bonusApplies(on, ["Volt boots"]), false);
  assert.equal(ratedVariants(shipped).length, 6);
  assert.equal(ratedVariants(on).length, 12, "an enabled bonus needs one more definition per generation");
});

test("config validator: accepts the shipped config, rejects ≥ 100%, < 0, rating + bonus ≥ 100% and malformed input", () => {
  assert.deepEqual(ratingConfigErrors(clone()), []);
  const bad = (edit: (config: any) => void, pattern: RegExp) => { const config = clone(); edit(config); const errors = ratingConfigErrors(config); assert.ok(errors.some(error => pattern.test(error)), `${pattern}: ${errors.join(" | ")}`); assert.throws(() => parseRatingConfig(config)); };
  bad(c => { c.generations["1"] = 100; }, /must be below 100%/);
  bad(c => { c.generations["1"] = 100.5; }, /must be below 100%/);
  bad(c => { c.generations["6"] = -1; }, /below 0%/);
  bad(c => { c.generations["2"] = 99; }, /outside 67\.50%–97\.50%/);
  bad(c => { c.generations["3"] = 93.125; }, /multiple of 0.05%/);
  bad(c => { c.generations["4"] = "92"; }, /must be a number/);
  bad(c => { delete c.generations["5"]; }, /generation 5 is missing/);
  bad(c => { c.bonus = { enabled: true, points: -0.5, cosmetic: "Lucky Laces" }; }, /bonus\.points must be ≥ 0/);
  bad(c => { c.generations["1"] = 97.5; c.bonus.enabled = true; c.bonus.points = 2.5; }, /must be below 100%/);
  bad(c => { c.generations["1"] = 97.5; c.bonus.enabled = true; c.bonus.points = 0.5; }, /above 97\.50%/);
  bad(c => { c.bonus.cosmetic = " "; }, /must name a cosmetic/);
  bad(c => { c.previewGeneration = 9; }, /previewGeneration/);
  assert.deepEqual(ratingConfigErrors(null), ["config must be an object"]);
  assert.equal(percentToBps(93.25), 9325);
  assert.equal(percentToBps(93.255), null);
  bad(c => { c.bonus.points = 0.33; }, /multiple of 0.05/);
});

test("the stadium's rolled definition tells its own rating; printed odds carry it", () => {
  const park = JSON.parse(readFileSync(new URL("../../games/penalty-kings/tiers/park.json", import.meta.url), "utf8"));
  for (const gen of GENERATIONS) {
    const def = ratedDefinition(park, `Gen ${gen}`, payoutBps(shipped, gen)!);
    const committed = JSON.parse(readFileSync(new URL(`../../games/penalty-kings/tiers/ratings/park-gen-${gen}.json`, import.meta.url), "utf8"));
    assert.deepEqual(committed, def, `tiers/ratings/park-gen-${gen}.json is generated from the config`);
    const chances = def.outcomes.map(o => o.chanceBps);
    assert.deepEqual(ratingOfTable(shipped, chances), { rtpBps: payoutBps(shipped, gen), generations: [gen], bonus: false });
    assert.equal(oddsLabel(chances), `Odds per ball (your rating ${(payoutBps(shipped, gen)! / 100).toFixed(2)}%):`);
    assert.deepEqual(def.outcomes.map(o => o.reward), park.outcomes.map((o: { reward: string }) => o.reward), "same prizes as today");
  }
});
