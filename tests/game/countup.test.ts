import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNT_UP_MS, COUNT_TICKS, countUp, countUpText, easeOut, ticksAt } from "../../games/penalty-kings/game/countup.ts";
import { formatNumber } from "../../games/penalty-kings/economy.ts";
import { SFX_NAMES } from "../../games/penalty-kings/audio-core.ts";

// B9 UI feel: the Results count-up only changes what is shown on the way; it always ends on the true figure.

const samples = (n = 400) => Array.from({ length: n + 1 }, (_, i) => i / n);

test("countUp: starts on `from`, ends exactly on `to`, integer steps, monotonic, never past the target", () => {
  for (const [from, to] of [[0, 1], [0, 7], [0, 450], [0, 1_234_567], [10, 3], [0, 0], [5, 5], [-3, 12]]) {
    assert.equal(countUp(from, to, 0), from, `${from}→${to} at t=0`);
    assert.equal(countUp(from, to, 1), to, `${from}→${to} at t=1`);
    assert.equal(countUp(from, to, 1.7), to, "past the end is still the end");
    assert.equal(countUp(from, to, -1), from);
    let last = from;
    for (const t of samples()) {
      const value = countUp(from, to, t);
      assert.ok(Number.isInteger(value), `${from}→${to} at ${t}: ${value} is a whole number`);
      if (to >= from) assert.ok(value >= last && value <= to, `${from}→${to} rises: ${last} → ${value}`);
      else assert.ok(value <= last && value >= to, `${from}→${to} falls: ${last} → ${value}`);
      last = value;
    }
    assert.equal(last, to);
  }
  assert.equal(countUp(0, 10, Number.NaN), 0, "NaN progress shows the start");
});

test("countUp: eased out (most of the count happens early) and decimal steps stay on the grid", () => {
  assert.ok(countUp(0, 1000, 0.5) > 500, "past halfway at half time");
  assert.ok(easeOut(0.25) > 0.25 && easeOut(1) === 1 && easeOut(0) === 0);
  for (const t of samples(97)) {
    const value = countUp(0, 12.34, t, 0.01);
    assert.equal(Math.round(value * 100) / 100, value, `${value} has at most 2 decimals`);
    assert.ok(value <= 12.34);
  }
  assert.equal(countUp(0, 12.34, 1, 0.01), 12.34);
});

test("countUpText: same format as the final figure on the way, and the final text verbatim at the end", () => {
  for (const final of ["0", "7", "450", formatNumber(1234), formatNumber(1_234_567.5), formatNumber(0.25), "12.50", "1,000,000"]) {
    assert.equal(countUpText(final, 1), final);
    assert.equal(countUpText(final, 0).replace(/[1-9]/g, "0"), countUpText(final, 0), `${final} starts at zero`);
    let last = -1;
    for (const t of samples(50)) {
      const text = countUpText(final, t), value = Number(text.replace(/,/g, ""));
      assert.ok(Number.isFinite(value) && value >= last, `${final} at ${t}: "${text}" rises`);
      assert.equal(text.includes("."), final.includes("."), `"${text}" keeps the decimal point of "${final}"`);
      if (final.includes(".")) assert.equal(text.split(".")[1].length, final.split(".")[1].length, `"${text}" keeps the decimals of "${final}"`);
      last = value;
    }
  }
  assert.equal(countUpText("n/a", 0.3), "n/a", "not a number: shown as is");
});

test("rising ticks: one per step up to COUNT_TICKS, the last one on landing, all voiced rarity chimes", () => {
  assert.equal(ticksAt(0), 0);
  assert.equal(ticksAt(1), COUNT_TICKS);
  let last = 0;
  for (const t of samples()) { const n = ticksAt(t); assert.ok(n >= last && n <= COUNT_TICKS); last = n; }
  for (let i = 0; i < COUNT_TICKS; i++) assert.ok((SFX_NAMES as readonly string[]).includes(`rarity-${i}`), `rarity-${i} is an Sfx name`);
  assert.ok(COUNT_UP_MS >= 500 && COUNT_UP_MS <= 1200, "short enough to never hold up Play again");
});
