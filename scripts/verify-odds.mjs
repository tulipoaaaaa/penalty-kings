// Asserts every stadium tier: weights sum to 10,000 bps, rewards are the published
// multiples of the ball price, and expected return is exactly 90.00%.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
