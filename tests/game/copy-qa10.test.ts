import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Results, type SessionSummary } from "../../games/penalty-kings/ui.tsx";
import { cupWeightsLine } from "../../games/penalty-kings/game/weekly.ts";

const render = (summary: SessionSummary) => renderToStaticMarkup(createElement(Results, { summary, onAgain: () => {}, onModes: () => {}, reduced: true }));

test("QA-10: Results hide 'BEST STREAK: 0 in a row' (a Daily with no goals); a real streak still shows", () => {
  const none = render({ title: "Daily: 0 pts", kicks: 5, goals: 0, points: 0, xp: 0, bestStreak: 0, newBest: false });
  assert.doesNotMatch(none, /BEST STREAK/);
  const two = render({ title: "Full time", kicks: 5, goals: 3, points: 500, xp: 20, bestStreak: 2, newBest: false });
  assert.match(two, /BEST STREAK: <b>2<\/b> in a row/);
});

test("QA-10: the Cups weights follow Champions Night, like the Ball shop (×2 'tonight')", () => {
  const night = Date.UTC(2026, 9, 3, 19, 30), day = Date.UTC(2026, 9, 3, 12);
  assert.equal(cupWeightsLine(day, true), "Park ×1, Pro ×100, Champions ×1,000");
  assert.equal(cupWeightsLine(night, true), "Park ×2, Pro ×200, Champions ×2,000 tonight");
  // Live stadiums: the weekly Cup report never doubles, so neither does the copy.
  assert.equal(cupWeightsLine(night, false), "Park ×1, Pro ×100, Champions ×1,000");
});
