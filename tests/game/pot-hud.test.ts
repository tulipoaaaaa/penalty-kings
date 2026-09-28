import { test } from "node:test";
import assert from "node:assert/strict";
import { potBanner, potHudTail } from "../../games/penalty-kings/game/prizes.ts";

const now = Date.UTC(2026, 8, 28, 12), draw = "Cup draw in 6d 22h";
const pot = (price?: { usdPerRf: number | null; fetchedAt: number | null; status: "live" | "error" | "snapshot"; block?: number }) =>
  potBanner({ kind: "simulated", potRF: 500000, topPrizeRF: 100, freeStakeRF: 2000, price }, now);
const shown = (tail: { tag: string; detail: string }) => [tail.tag, tail.detail].filter(Boolean).join(" | ");

test("QA-6: the HUD pot says 'on-chain snapshot' once, with the block, and no dangling separator", () => {
  const tail = potHudTail(pot({ usdPerRf: 0.0016, fetchedAt: now - 1000, status: "snapshot", block: 73949883 }), draw);
  const text = shown(tail);
  assert.equal(text.match(/snapshot/g)?.length, 1, text);
  assert.match(text, /block 73,949,883/);
  assert.equal(tail.detail, "block 73,949,883 · Cup draw in 6d 22h");
});

test("QA-6: a live price is not repeated either; no price leaves just the draw line", () => {
  const live = potHudTail(pot({ usdPerRf: 0.0016, fetchedAt: now - 12_000, status: "live" }), draw);
  assert.equal(live.tag, "live · updated 12s ago");
  assert.equal(live.detail, draw);
  const none = potHudTail(pot(), draw);
  assert.deepEqual(none, { tag: "", detail: draw });
  for (const tail of [live, none]) assert.doesNotMatch(tail.detail, /^\s*·|·\s*$|—/);
});
