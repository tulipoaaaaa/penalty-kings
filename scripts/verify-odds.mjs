// Asserts every stadium tier: weights sum to 10,000 bps, rewards are the published
// multiples of the ball price, and expected return is exactly 90.00%.
// EARLY ACCESS: then every per-Friend rating (games/penalty-kings/config/ratings.json), with and without the
// cosmetic bonus: exact expected payout, chances summing to exactly 10,000 bps, monotone odds (down the ladder and
// across ratings), the per-ball maximum payout and the prize bank reserve, and that tiers/ratings/*.json is current.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseChanceGame, expectedReward, maximumPrize, outcomeForRoll } from "@rarefriends/friendsdk/game";
import { ratingConfig, payoutBps, percentToBps, solveChances, chanceTableErrors, bankFigures, bpsToPercent, ratedVariants, GENERATIONS, MULTIPLES_X10 as RATED_MULTIPLES } from "../games/penalty-kings/game/ratings.ts";
import { expectedFiles, TIERS as RATED_TIERS } from "./gen-ratings.mjs";

const MULTIPLES_X10 = [0n, 5n, 10n, 15n, 25n, 50n, 100n];
const CHANCES = [3150, 2700, 2000, 1100, 700, 250, 100];
const NAMES = ["Scuffed Ball", "Training Ball", "Match Ball", "Pro Ball", "Silver Ball", "Gold Ball", "Golden Boot Ball"];
const PRICES = { park: 10n, pro: 1000n, champions: 10000n };
const RF = 10n ** 18n;

for (const [tier, priceRF] of Object.entries(PRICES)) {
  const game = JSON.parse(await readFile(new URL(`../games/penalty-kings/tiers/${tier}.json`, import.meta.url), "utf8"));
  const price = BigInt(game.price);
  assert.equal(price, priceRF * RF, `${tier}: price`);
  assert.equal(game.consumable, "Ball");
  assert.deepEqual(game.outcomes.map(o => o.name), NAMES, `${tier}: outcome names/order`);
  assert.deepEqual(game.outcomes.map(o => o.chanceBps), CHANCES, `${tier}: chances`);
  assert.equal(game.outcomes.reduce((sum, o) => sum + o.chanceBps, 0), 10000, `${tier}: weights sum`);
  game.outcomes.forEach((o, i) => assert.equal(BigInt(o.reward), price * MULTIPLES_X10[i] / 10n, `${tier}: ${o.name} reward`));
  const ev = game.outcomes.reduce((sum, o) => sum + BigInt(o.reward) * BigInt(o.chanceBps), 0n);
  assert.equal(ev * 100n, price * 10000n * 90n, `${tier}: EV must be exactly 90.00%`);
  const maxPrize = game.outcomes.reduce((m, o) => (BigInt(o.reward) > m ? BigInt(o.reward) : m), 0n);
  console.log(`${tier.padEnd(9)} price ${priceRF} RF · EV 90.00% · max prize ${maxPrize / RF} RF (${Number(maxPrize / price)}× price) · weights 10000 bps`);
}
const root = await readFile(new URL("../games/penalty-kings/game.json", import.meta.url), "utf8");
const park = await readFile(new URL("../games/penalty-kings/tiers/park.json", import.meta.url), "utf8");
assert.equal(root, park, "games/penalty-kings/game.json must equal tiers/park.json");
console.log("PASS verify-odds: all tiers exact");

// ── EARLY ACCESS: per-Friend ratings ─────────────────────────────────────────────────────────────────────────────
const config = ratingConfig();
assert.deepEqual(RATED_MULTIPLES, MULTIPLES_X10.map(Number), "ratings.ts uses the published prize multiples");
const bonusBps = percentToBps(config.bonus.points);
const rows = [];
let previous = null;
for (const generation of [...GENERATIONS].reverse()) { // gen-6 (lowest rating) → gen-1
  for (const withBonus of [false, true]) {
    const base = payoutBps(config, generation);
    const rtp = withBonus ? base + bonusBps : base; // the bonus is proven even while it is switched off
    assert.ok(rtp >= 0 && rtp < 10000, `gen-${generation}${withBonus ? " + bonus" : ""}: payout ${bpsToPercent(rtp)} must be in [0, 100%)`);
    const chances = solveChances(rtp);
    assert.deepEqual(chanceTableErrors(chances, rtp), [], `gen-${generation}${withBonus ? " + bonus" : ""}`);
    assert.equal(chances.reduce((a, b) => a + b, 0), 10000, "sum");
    for (let i = 1; i < chances.length; i++) assert.ok(chances[i] <= chances[i - 1], `monotone at rarity ${i}`);
    if (withBonus && bonusBps > 0) for (let i = 1; i < chances.length; i++) assert.ok(chances[i] >= solveChances(base)[i], `bonus never lowers a paying chance (rarity ${i})`);
    for (const [tier, priceRF] of Object.entries(PRICES)) {
      const price = priceRF * RF;
      const game = parseChanceGame({ name: `check ${tier}`, consumable: "Ball", price: price.toString(), outcomes: chances.map((chanceBps, i) => ({ name: NAMES[i], chanceBps, reward: (price * MULTIPLES_X10[i] / 10n).toString() })) });
      const ev = game.outcomes.reduce((sum, o) => sum + o.reward * BigInt(o.chanceBps), 0n);
      assert.equal(ev, price * BigInt(rtp), `${tier} gen-${generation}: EV must be exactly ${bpsToPercent(rtp)}`);
      assert.equal(expectedReward(game) * 10000n, price * BigInt(rtp), `${tier} gen-${generation}: SDK expectedReward agrees`);
      const top = maximumPrize(game), { maxPayoutX, reserveX } = bankFigures(chances);
      assert.equal(top, price * 10n, `${tier} gen-${generation}: max payout is the Golden Boot (10× price)`);
      assert.equal(BigInt(maxPayoutX * 10) * price / 10n, top, "bankFigures max payout");
      assert.equal(BigInt(reserveX * 10) * price / 10n, top, "bank reserve = one top prize per ball in flight");
      assert.ok(top <= price * 10n, "no rating raises the reserve above today's 10× price");
      // The SDK's roll → outcome mapping covers each bucket of 10,000 exactly as the chances say.
      const counts = new Array(chances.length).fill(0);
      for (let roll = 0; roll < 10000; roll++) counts[outcomeForRoll(game, roll) - 1]++;
      assert.deepEqual(counts, chances, `${tier} gen-${generation}: roll buckets`);
    }
    if (!withBonus) {
      if (previous) { // across ratings: a higher rating never lowers a paying chance
        assert.ok(rtp >= previous.rtp, "ratings rise from gen-6 to gen-1");
        for (let i = 1; i < chances.length; i++) assert.ok(chances[i] >= previous.chances[i], `gen-${generation} vs lower rating: rarity ${i}`);
      }
      previous = { rtp, chances };
    }
    rows.push({ label: `gen-${generation}${withBonus ? ` + ${config.bonus.cosmetic} (+${config.bonus.points} pts${config.bonus.enabled ? "" : ", OFF"})` : ""}`, rtp, chances, bank: bankFigures(chances) });
  }
}
const pct = bps => `${(bps / 100).toFixed(2)}%`.padStart(7);
console.log("\nPer-Friend ratings (chance per ball; prizes 0 / 0.5 / 1 / 1.5 / 2.5 / 5 / 10 × price):");
console.log(`${"rating".padEnd(40)} ${"RTP".padStart(7)}  ${NAMES.map(name => name.replace(" Ball", "").slice(0, 8).padStart(8)).join(" ")}  sum    max/ball  reserve/ball  Park bank 20,000 RF`);
for (const row of rows) console.log(`${row.label.padEnd(40)} ${pct(row.rtp)}  ${row.chances.map(c => pct(c).padStart(8)).join(" ")}  ${row.chances.reduce((a, b) => a + b, 0)}  ${`${row.bank.maxPayoutX}× price`.padStart(9)}  ${`${row.bank.reserveX}× price`.padStart(12)}  ${Math.floor(20000 / (10 * row.bank.reserveX))} balls in flight`);
// The committed per-rating ChanceGame definitions are exactly what the config generates.
const files = await expectedFiles();
assert.equal(Object.keys(files).length, RATED_TIERS.length * ratedVariants(config).length);
for (const [name, text] of Object.entries(files)) {
  const committed = await readFile(new URL(`../games/penalty-kings/tiers/ratings/${name}`, import.meta.url), "utf8").catch(() => null);
  assert.equal(committed, text, `tiers/ratings/${name} is stale or missing: run npm run gen:ratings`);
  const game = JSON.parse(committed);
  const tier = name.split("-")[0], base = JSON.parse(await readFile(new URL(`../games/penalty-kings/tiers/${tier}.json`, import.meta.url), "utf8"));
  assert.equal(game.price, base.price); assert.deepEqual(game.outcomes.map(o => [o.name, o.reward]), base.outcomes.map(o => [o.name, o.reward]), `${name}: same prizes as tiers/${tier}.json`);
}
console.log(`\nPASS verify-odds (ratings): ${rows.length} rating tables exact (sum 10,000 bps, monotone, exact RTP, reserve = 10× price); ${Object.keys(files).length} rated definitions current`);
