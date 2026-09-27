// Penalty Kings economy simulator.
// Monte Carlo over players × tiers × balls. Validates prize-bank solvency, capacity growth,
// pool growth, the farm check, treasury runway and the weekly scale table, then writes the
// generated tables into docs/ECONOMY.md between the SIM markers.
//
//   node scripts/economy-sim.mjs          full run, rewrites docs/ECONOMY.md tables
//   node scripts/economy-sim.mjs --smoke  quick assertions only (CI)
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { rfUsd, rfPerEth, MARKET_FEE, SNAPSHOT } from "./lib/market.mjs";

const SMOKE = process.argv.includes("--smoke");

// ── Game constants (must match games/penalty-kings/tiers/*.json; verify-odds asserts those) ──
export const CHANCES = [3150, 2700, 2000, 1100, 700, 250, 100];
export const PAYOUT_X = [0, 0.5, 1, 1.5, 2.5, 5, 10];
export const DROP_MULT = [1, 1.5, 2, 3, 5, 8, 15];
export const RACE_POINTS = [0, 0, 0, 0, 0, 1, 2];
export const TIERS = [
  { id: "park", price: 10, bank: 20_000, raceWeight: 1 },
  { id: "pro", price: 1_000, bank: 200_000, raceWeight: 100 },
  { id: "champions", price: 10_000, bank: 2_000_000, raceWeight: 1000 },
];
// ── Economy parameters ──
export const EDGE = 0.1;                 // 1 − 90% RTP
export const RETAIN_WHILE_GROWING = 0.1; // share of weekly surplus kept in the bank until a tier hits its capacity target
export const BURN_SHARE = 0.5, CUP_SHARE = 0.5; // of the distributed surplus
export const GBOOT_SUPPLY = 1_000_000_000, POOL_GBOOT = 600_000_000, TREASURY_GBOOT = 300_000_000, CUP_GBOOT = 100_000_000;
export const START_PRICE = 0.01, TOP_PRICE = 10; // RF per $GBOOT, position A range
export const POOL_FEE = 0.01;
export const DROP_TARGET = 0.03;          // average drop value ≤ 3% of ball price
export const WEEKLY_TREASURY_BUDGET = TREASURY_GBOOT / 52; // drops never exceed 1/52 of the starting treasury per week
export const AVG_DROP_MULT = CHANCES.reduce((s, c, i) => s + c * DROP_MULT[i], 0) / 10000; // 2.15

const mean = PAYOUT_X.reduce((s, x, i) => s + x * CHANCES[i], 0) / 10000;
const variance = PAYOUT_X.reduce((s, x, i) => s + (x - mean) ** 2 * CHANCES[i], 0) / 10000;
const SD = Math.sqrt(variance);
assert.ok(Math.abs(mean - 0.9) < 1e-12, "RTP 90%");
assert.ok(Math.abs(AVG_DROP_MULT - 2.15) < 1e-12);

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CUM = CHANCES.reduce((a, c) => [...a, (a.at(-1) ?? 0) + c], []);
const draw = random => { const roll = Math.floor(random() * 10000); return CUM.findIndex(c => roll < c); };

// ── 1. Solvency: P(bank ever falls N ball-prices below its start), bank keeps the full edge below its start ──
function ruinProbability(barrier, runs, horizon, seed) {
  const random = rng(seed); let hits = 0;
  for (let run = 0; run < runs; run++) {
    let bank = 0;
    for (let ball = 0; ball < horizon; ball++) { bank += 1 - PAYOUT_X[draw(random)]; if (bank <= -barrier) { hits++; break; } }
  }
  return hits / runs;
}
const theory = barrier => Math.exp((-2 * EDGE * barrier) / variance);
/** Exact Lundberg exponent for this payout table: E[exp(−θ·(1 − payout))] = 1. Gives a rigorous upper bound exp(−θ·N). */
const THETA = (() => {
  const f = t => PAYOUT_X.reduce((sum, x, i) => sum + (CHANCES[i] / 10000) * Math.exp(-t * (1 - x)), 0) - 1;
  let lo = 0.01, hi = 0.5;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
})();
const lundberg = barrier => Math.exp(-THETA * barrier);

// ── 2. Pool maths: single-sided $GBOOT from START_PRICE to TOP_PRICE (price = RF per $GBOOT) ──
const L_A = POOL_GBOOT / (1 / Math.sqrt(START_PRICE) - 1 / Math.sqrt(TOP_PRICE));
/** Gross RF a buyer must pay (1% fee included) to move the price from START_PRICE to START_PRICE × m. */
export const rfToMultiply = m => (L_A * (Math.sqrt(START_PRICE * m) - Math.sqrt(START_PRICE))) / (1 - POOL_FEE);
const gbootOutFor = m => L_A * (1 / Math.sqrt(START_PRICE) - 1 / Math.sqrt(START_PRICE * m));

// ── 3. Drops ──
export const baseDropAt = (price, twap) => Math.min(scheduleBase(price), (DROP_TARGET * price) / twap / AVG_DROP_MULT);
function scheduleBase(price) { return Math.floor((DROP_TARGET * price) / START_PRICE / AVG_DROP_MULT); } // 13 / 1,395 / 13,953 at launch
const fixedBase = price => Math.floor((DROP_TARGET * price) / START_PRICE / AVG_DROP_MULT);

// ── 4. Weekly scale model ──
const MIX = [ // share of daily players, balls per player per day
  { tier: 0, share: 0.8, balls: 15 },
  { tier: 1, share: 0.18, balls: 3 },
  { tier: 2, share: 0.02, balls: 1 },
];
const CONCURRENCY = 0.05;         // share of a tier's daily players with a ball in flight at the same moment
const FRESH_RF_SHARE = 0.25;      // share of RF spend bought fresh with ETH (the rest is recycled redemptions)

function weekly(dailyPlayers, runs = 200, seed = 7) {
  const random = rng(seed);
  const totals = { spend: 0, payouts: 0, balls: [0, 0, 0], drops: 0, gold: 0 };
  for (let run = 0; run < runs; run++) {
    for (const mix of MIX) {
      const tier = TIERS[mix.tier], balls = Math.round(dailyPlayers * mix.share * mix.balls * 7);
      totals.balls[mix.tier] += balls / runs;
      for (let i = 0; i < balls; i++) {
        const outcome = draw(random);
        totals.spend += tier.price / runs; totals.payouts += (PAYOUT_X[outcome] * tier.price) / runs;
        totals.drops += (scheduleBase(tier.price) * DROP_MULT[outcome]) / runs;
        totals.gold += (RACE_POINTS[outcome] * tier.raceWeight) / runs;
      }
    }
  }
  const surplus = totals.spend - totals.payouts;
  const distributed = Math.max(0, surplus) * (1 - RETAIN_WHILE_GROWING);
  const freshRf = totals.spend * FRESH_RF_SHARE;
  const protocolFeesEth = (freshRf / rfPerEth) * MARKET_FEE / (1 - MARKET_FEE);
  const need = MIX.map(mix => Math.ceil(dailyPlayers * mix.share * CONCURRENCY) * 10 * TIERS[mix.tier].price);
  return {
    dailyPlayers, spend: totals.spend, payouts: totals.payouts, burned: distributed * BURN_SHARE, cup: distributed * CUP_SHARE,
    retained: Math.max(0, surplus) * RETAIN_WHILE_GROWING, protocolFeesEth, drops: totals.drops, balls: totals.balls,
    need, available: TIERS.map(t => t.bank),
  };
}

const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = rf => `$${fmt(rf * rfUsd, rf * rfUsd < 100 ? 2 : 0)}`;

// ── Run ──
const out = [];
const runs = SMOKE ? 2000 : 20000, horizon = SMOKE ? 4000 : 20000;
const barriers = SMOKE ? [10, 20] : [10, 20, 30, 40];
out.push(`Generated by \`node scripts/economy-sim.mjs\` (market snapshot: block ${SNAPSHOT.block.toLocaleString("en-US")}, 1 RF = $${rfUsd.toFixed(5)}, 1 ETH = ${fmt(rfPerEth)} RF).`, "");
out.push("### Solvency (simulated vs. theory)", "",
  `Per ball, in units of the ball price: mean payout ${mean.toFixed(2)}, standard deviation **${SD.toFixed(3)}**, edge **${EDGE.toFixed(2)}**, variance ${variance.toFixed(3)}.`, "",
  "| Loss barrier (ball prices) | Simulated P(ever reached) | Normal approx. exp(−2·edge·N/σ²) | Exact upper bound exp(−θ·N), θ = " + THETA.toFixed(4) + " |", "|---:|---:|---:|---:|");
const fits = [];
for (const barrier of barriers) {
  const p = ruinProbability(barrier, runs, horizon, 1000 + barrier);
  fits.push({ barrier, p }); out.push(`| ${barrier} | ${p.toExponential(2)} | ${theory(barrier).toExponential(2)} | ${lundberg(barrier).toExponential(2)} |`);
}
out.push(`| **100** | (too rare to sample) | ${theory(100).toExponential(2)} | **${lundberg(100).toExponential(2)}** |`, "",
  `${fmt(runs)} runs × ${fmt(horizon)} balls per barrier. The simulation shows the normal approximation is **optimistic** here: rare 10× Golden Boot payouts fatten the loss tail. The exact Lundberg bound for this payout table always sits above the simulated values, so the honest figure for "the bank ever falls 100 ball prices below its start" is **at most ≈ ${lundberg(100).toExponential(0)}** (the brief's 1e-5 used the normal approximation). The bank only distributes surplus above its opening level (high-water sweep), so this drift always applies below the start.`, "");
for (const { barrier, p } of fits) assert.ok(p <= lundberg(barrier) * 1.1 + 5 / runs, `solvency at ${barrier}: sim ${p} exceeds Lundberg bound ${lundberg(barrier)}`);

out.push("### Capacity (balls in flight = free bank ÷ top prize)", "", "| Stadium | Ball | Top prize | Opening bank | Balls in flight |", "|---|---:|---:|---:|---:|");
for (const t of TIERS) out.push(`| ${t.id} | ${fmt(t.price)} RF | ${fmt(t.price * 10)} RF | ${fmt(t.bank)} RF | ${fmt(t.bank / (t.price * 10))} |`);
out.push("", `Capacity growth: while a bank is below its target, ${RETAIN_WHILE_GROWING * 100}% of the weekly surplus stays in the bank, i.e. on average **${(EDGE * RETAIN_WHILE_GROWING * 100).toFixed(0)}% of the ball price per ball** (+0.1 ball of capacity per 100 balls played at that stadium).`, "",
  "| Balls played per day (one stadium) | +capacity after 4 weeks | after 12 weeks | after 26 weeks |", "|---:|---:|---:|---:|");
for (const perDay of [100, 1000, 10000]) {
  const grow = weeks => (perDay * 7 * weeks * EDGE * RETAIN_WHILE_GROWING) / 10;
  out.push(`| ${fmt(perDay)} | +${fmt(grow(4), 1)} balls | +${fmt(grow(12), 1)} balls | +${fmt(grow(26), 1)} balls |`);
}

out.push("", "### $GBOOT pool: RF needed to move the price", "",
  `Position A: ${fmt(POOL_GBOOT)} $GBOOT single-sided from ${START_PRICE} RF to ${TOP_PRICE} RF per $GBOOT (1,000×). Liquidity L = ${fmt(L_A)}. Start FDV = ${fmt(GBOOT_SUPPLY * START_PRICE)} RF (${usd(GBOOT_SUPPLY * START_PRICE)}). The 1% swap fee is included.`, "",
  "| Price move | New price (RF) | RF that must flow in | ≈ USD | $GBOOT bought out |", "|---|---:|---:|---:|---:|");
for (const m of [2, 10, 100]) out.push(`| ×${m} | ${fmt(START_PRICE * m, 2)} | ${fmt(rfToMultiply(m))} | ${usd(rfToMultiply(m))} | ${fmt(gbootOutFor(m))} |`);
assert.ok(Math.abs(rfToMultiply(2) / 1e6 - 2.59) < 0.05 && Math.abs(rfToMultiply(10) / 1e6 - 13.54) < 0.1 && Math.abs(rfToMultiply(100) / 1e6 - 56.3) < 0.3, "pool maths");

out.push("", "### Farm check (value returned per ball ÷ ball price)", "",
  "RF payout is always 90%. The drop is valued at the $GBOOT time-weighted price.", "",
  "| $GBOOT price | Drop value, fixed launch schedule | Total, fixed | Drop value, auto-scaled rate | **Total, auto-scaled** |", "|---|---:|---:|---:|---:|");
for (const m of [1, 10, 100]) {
  const twap = START_PRICE * m, price = 10;
  const fixed = (fixedBase(price) * AVG_DROP_MULT * twap) / price, scaled = (baseDropAt(price, twap) * AVG_DROP_MULT * twap) / price;
  out.push(`| ${m}× (${fmt(twap, 2)} RF) | ${(fixed * 100).toFixed(1)}% | ${((0.9 + fixed) * 100).toFixed(1)}% | ${(scaled * 100).toFixed(2)}% | **${((0.9 + scaled) * 100).toFixed(2)}%** |`);
  assert.ok(0.9 + scaled <= 0.93 + 1e-9, "auto-scaled farm check ≤ 93%");
}
out.push("", "The fixed schedule would become a farm (>100%) once $GBOOT trades ~4× above launch. The live rule `base = min(schedule, 3% × ball price ÷ TWAP ÷ 2.15)` keeps every ball at **≤ 93%**.");

out.push("", "### Weekly scale table (mixed stadiums)", "",
  `Assumptions: ${MIX.map(m => `${m.share * 100}% of players at ${TIERS[m.tier].id} × ${m.balls} balls/day`).join(", ")}; ${CONCURRENCY * 100}% of a stadium's daily players have a ball in flight at the peak; ${FRESH_RF_SHARE * 100}% of RF spent is bought fresh with ETH (the rest is recycled redemptions); drops at the launch schedule.`, "",
  "| Daily players | RF spent / wk | RF burned / wk | Golden Boot Cup / wk | Protocol fees to Friends / wk | $GBOOT drops / wk (after treasury cap) | Treasury runway | Peak bank need (Park / Pro / Champ) vs opening bank | Top-up needed |", "|---:|---:|---:|---:|---:|---:|---:|---|---|");
for (const players of [50, 500, 5000]) {
  const w = weekly(players, SMOKE ? 5 : 40, players);
  const paid = Math.min(w.drops, WEEKLY_TREASURY_BUDGET), scale = paid / w.drops;
  const runway = TREASURY_GBOOT / paid;
  const gaps = w.need.map((need, i) => Math.max(0, need - w.available[i]));
  const topUpRf = gaps.reduce((a, b) => a + b, 0);
  out.push(`| ${fmt(players)} | ${fmt(w.spend)} RF (${usd(w.spend)}) | ${fmt(w.burned)} RF | ${fmt(w.cup)} RF | ${w.protocolFeesEth.toFixed(3)} ETH | ${fmt(paid)}${scale < 1 ? ` (rate ×${scale.toFixed(2)})` : ""} | ${runway >= 520 ? "10+ years" : `${fmt(runway, 1)} weeks`} | ${w.need.map(n => fmt(n)).join(" / ")} vs ${w.available.map(n => fmt(n)).join(" / ")} | ${topUpRf ? `${fmt(topUpRf)} RF (≈ ${(topUpRf / rfPerEth).toFixed(2)} ETH)` : "none"} |`);
}
out.push("", `Drops are capped at ${fmt(WEEKLY_TREASURY_BUDGET)} $GBOOT per week (1/52 of the ${fmt(TREASURY_GBOOT)} treasury), so the treasury always lasts at least a year; when the cap binds, the weekly base rate is scaled down for everyone equally.`, "Treasury runway is otherwise at the launch drop rate; the auto-scaled rate falls as $GBOOT rises, so runway only lengthens. Burn and Cup figures use the realised surplus of the simulated week (luck included).");

if (SMOKE) { console.log(out.join("\n")); console.log("\nPASS economy-sim smoke"); process.exit(0); }
const path = new URL("../docs/ECONOMY.md", import.meta.url);
const doc = await readFile(path, "utf8");
const start = "<!-- SIM:START -->", end = "<!-- SIM:END -->";
assert.ok(doc.includes(start) && doc.includes(end), "ECONOMY.md markers");
await writeFile(path, doc.slice(0, doc.indexOf(start) + start.length) + "\n" + out.join("\n") + "\n" + doc.slice(doc.indexOf(end)));
console.log(out.join("\n")); console.log("\nPASS economy-sim: tables written to docs/ECONOMY.md");
