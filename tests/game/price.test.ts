import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceFromSqrtX96, wethPerRf, usdPerWeth, usdPerRfFromPools, decodeSqrtPriceX96, slot0Call, priceAgeLabel, formatUsd, usdForRf,
  rfPriceText, isShowable, fetchRfPrice, NO_PRICE, PRICE_STALE_MS, RF_WETH_POOL_ID, WETH_USDG_POOL_ID, STATE_VIEW, RPC_URL, type RfPrice,
} from "../../games/penalty-kings/game/price.ts";

const Q96 = 1n << 96n;
const close = (actual: number | null, expected: number, rel = 1e-9) => {
  assert.ok(actual !== null, "expected a number");
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * rel, `${actual} ≉ ${expected}`);
};
// Reads taken from Robinhood Chain (4663) StateView.getSlot0 at block 73,793,321.
const RF_WETH_SQRT = 59977880447322165122003233n, WETH_USDG_SQRT = 4129642798072125940494846n;

test("PRICE: sqrtPriceX96 → token1 per token0, with decimals", () => {
  close(priceFromSqrtX96(Q96, 18, 18), 1);
  close(priceFromSqrtX96(Q96 * 2n, 18, 18), 4);
  close(priceFromSqrtX96(Q96, 18, 6), 1e12, 1e-12);
  close(priceFromSqrtX96(Q96 / 2n, 6, 18), 0.25e-12);
  assert.equal(priceFromSqrtX96(0n, 18, 18), null);
});

test("PRICE: RF/WETH × WETH/USDG gives USD per RF (token order and decimals)", () => {
  // RF is currency0 of the RF/WETH pool (both 18 decimals): pool price = WETH per RF.
  close(wethPerRf(RF_WETH_SQRT), (Number(RF_WETH_SQRT) / 2 ** 96) ** 2);
  // WETH (18) is currency0 of the WETH/USDG (6) pool: pool price × 10^12 = USDG per WETH.
  const eth = usdPerWeth(WETH_USDG_SQRT)!;
  assert.ok(eth > 2000 && eth < 4000, `USD per WETH ${eth}`);
  const usd = usdPerRfFromPools(RF_WETH_SQRT, WETH_USDG_SQRT)!;
  close(usd, wethPerRf(RF_WETH_SQRT)! * eth);
  assert.ok(usd > 0.001 && usd < 0.003, `USD per RF ${usd}`);
  assert.equal(usdPerRfFromPools(0n, WETH_USDG_SQRT), null);
});

test("PRICE: slot0 calldata and decoding", () => {
  assert.deepEqual(slot0Call(RF_WETH_POOL_ID), { to: STATE_VIEW, data: `0xc815641c${RF_WETH_POOL_ID.slice(2)}` });
  assert.equal(slot0Call(WETH_USDG_POOL_ID).data.length, 2 + 8 + 64);
  const word = (value: bigint) => value.toString(16).padStart(64, "0");
  assert.equal(decodeSqrtPriceX96(`0x${word(RF_WETH_SQRT)}${word(0n)}${word(0n)}${word(0n)}`), RF_WETH_SQRT);
  assert.equal(decodeSqrtPriceX96("0x"), null);
  assert.equal(decodeSqrtPriceX96(`0x${word(0n)}`), null, "an uninitialised pool is not a price");
  assert.equal(decodeSqrtPriceX96(undefined), null);
});

test("PRICE: age label, formatting and dashes", () => {
  const now = 1_000_000_000;
  const live: RfPrice = { usdPerRf: 0.00155, fetchedAt: now - 7_400, status: "live" };
  assert.equal(priceAgeLabel(live, now), "live · 7s ago");
  assert.equal(priceAgeLabel(live, live.fetchedAt! - 500), "live · 0s ago");
  assert.equal(priceAgeLabel({ ...live, fetchedAt: now - PRICE_STALE_MS - 1 }, now), "—", "stale price is not shown");
  assert.equal(priceAgeLabel({ usdPerRf: null, fetchedAt: now, status: "error" }, now), "—");
  assert.equal(priceAgeLabel(NO_PRICE, now), "—");
  assert.equal(isShowable(live, now), true);
  assert.equal(formatUsd(775.4), "≈ $775"); assert.equal(formatUsd(12_345.6), "≈ $12,346"); assert.equal(formatUsd(1.5), "≈ $1.50");
  assert.equal(formatUsd(0.001), "≈ < $0.01"); assert.equal(formatUsd(0), "≈ $0.00"); assert.equal(formatUsd(Number.NaN), "—");
  assert.equal(usdForRf(500_000, live, now), "≈ $775");
  assert.equal(usdForRf(500_000, NO_PRICE, now), "—");
  assert.equal(usdForRf(null, live, now), "—");
  assert.equal(rfPriceText(live, now), "1 RF ≈ $0.00155");
  assert.equal(rfPriceText(NO_PRICE, now), "—");
});

test("PRICE: fetch reads both pools over JSON-RPC; any failure is status error with no number", async () => {
  const word = (value: bigint) => value.toString(16).padStart(64, "0");
  const calls: { url: string; body: { method: string; params: [{ to: string; data: string }, string] } }[] = [];
  const ok = async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    const sqrt = body.params[0].data.endsWith(RF_WETH_POOL_ID.slice(2)) ? RF_WETH_SQRT : WETH_USDG_SQRT;
    return { json: async () => ({ jsonrpc: "2.0", id: body.id, result: `0x${word(sqrt)}${word(0n)}${word(0n)}${word(0n)}` }) };
  };
  const price = await fetchRfPrice(ok, () => 42);
  assert.equal(price.status, "live"); assert.equal(price.fetchedAt, 42);
  close(price.usdPerRf, usdPerRfFromPools(RF_WETH_SQRT, WETH_USDG_SQRT)!);
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.equal(call.url, RPC_URL); assert.equal(call.body.method, "eth_call"); assert.equal(call.body.params[0].to, STATE_VIEW); }
  const rpcError = async () => ({ json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } }) });
  assert.deepEqual(await fetchRfPrice(rpcError, () => 7), { usdPerRf: null, fetchedAt: 7, status: "error" });
  const offline = async () => { throw new Error("offline"); };
  assert.deepEqual(await fetchRfPrice(offline, () => 8), { usdPerRf: null, fetchedAt: 8, status: "error" });
});

test("the SDK preview uses the labelled on-chain snapshot (no network), matching the recorded pool reads", async () => {
  const { snapshotPrice, SNAPSHOT_BLOCK } = await import("../../games/penalty-kings/game/price.ts");
  const snap = snapshotPrice();
  assert.equal(snap.status, "snapshot");
  assert.ok(Math.abs(snap.usdPerRf! - 0.0014565) < 0.000005, `snapshot ${snap.usdPerRf}`);
  assert.equal(priceAgeLabel(snap, Date.now()), `on-chain snapshot · block ${SNAPSHOT_BLOCK.toLocaleString("en-US")}`);
  assert.equal(usdForRf(500_000, snap, Date.now()), "≈ $728");
});
