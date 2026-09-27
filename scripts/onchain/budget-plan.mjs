// Budget per launch size (STOP 1), from the recorded market snapshot (or live reads when an RPC is reachable).
import { ethToBuyRf, priceImpact, rfPerEth, rfUsd, SNAPSHOT } from "../lib/market.mjs";

const GAS_PRICE_GWEI = 0.0229;        // eth_gasPrice at the snapshot
const DICE_FEE = 0.000025;            // getFeeV2(provider, 200000) at the snapshot
const GAS_UNITS = { starter: 12_000_000, launch: 30_000_000, big: 40_000_000 }; // deploys + funding + pool + smoke tests (upper estimate; fork-measured later)
const SIZES = {
  starter: { park: 20_000, pro: 0, champions: 0, cup: 0, floor: 0, tests: 20_000 },
  launch: { park: 20_000, pro: 200_000, champions: 0, cup: 500_000, floor: 250_000, tests: 30_000 },
  big: { park: 20_000, pro: 200_000, champions: 2_000_000, cup: 1_000_000, floor: 1_000_000, tests: 30_000 },
};
const HARDWIRE_GEN6 = 1, GEN1_ADDON = 100_000;
const fmt = n => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

console.log(`Snapshot block ${SNAPSHOT.block}: 1 ETH = ${fmt(rfPerEth)} RF, 1 RF = $${rfUsd.toFixed(5)}, ETH = $${SNAPSHOT.ethUsd}\n`);
const rows = [];
for (const [name, s] of Object.entries(SIZES)) {
  const rf = s.park + s.pro + s.champions + s.cup + s.floor + s.tests + HARDWIRE_GEN6;
  const chunks = priceImpact(rf) > 0.03 ? Math.ceil(priceImpact(rf) / 0.025) : 1;
  const eth = ethToBuyRf(rf);                       // includes 5% market fee and price impact
  const slippage = eth * 0.03;                      // worst-case allowance per the 3% limit
  const gas = (GAS_UNITS[name] * GAS_PRICE_GWEI) / 1e9;
  const dice = 12 * DICE_FEE;
  const subtotal = eth + slippage + gas + dice;
  const total = subtotal * 1.2 + 0.003;              // 20% buffer + 0.003 ETH reserve
  rows.push({ name, rf, eth, slippage, gas, dice, total, chunks, impact: priceImpact(rf), s });
  console.log(`${name.toUpperCase()}: buy ${fmt(rf)} RF → ${eth.toFixed(4)} ETH (impact ${(priceImpact(rf) * 100).toFixed(2)}%${chunks > 1 ? `, split into ${chunks} buys` : ""}) + slippage ${slippage.toFixed(4)} + gas ${gas.toFixed(5)} + Dice ${dice.toFixed(5)} → with 20% buffer + reserve: **${total.toFixed(3)} ETH** (≈ $${(total * SNAPSHOT.ethUsd).toFixed(0)})`);
  console.log(`   parked (withdrawable free stake): ${fmt(s.park + s.pro + s.champions)} RF · spent: Cup ${fmt(s.cup)} RF + hardwire 1 RF + test balls' edge/fees · market risk: floor ${fmt(s.floor)} RF + all RF held (RF price)`);
}
const gen1 = ethToBuyRf(GEN1_ADDON) * 1.03 * 1.2;
console.log(`GEN 1 SHOWCASE add-on: 100,000 RF hardwire → ${gen1.toFixed(4)} ETH (spent on hardwiring)`);
