import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_COSMETICS } from "../../games/penalty-kings/economy.ts";
import { skillZoneOf, streakAfter, checkIn, challengeStreak, canClaim, nextClaimIn, CLAIM_EVERY_MS, LOGIN_TRACK } from "../../games/penalty-kings/game/rewards.ts";

test("Skill Zones: top bin / post-in / bar-in, and they extend the streak by an extra step", () => {
  assert.equal(skillZoneOf({ goal: true, zone: "bin" }), "top-bin");
  assert.equal(skillZoneOf({ goal: true, zone: "side", postIn: true }), "post-in");
  assert.equal(skillZoneOf({ goal: true, zone: "centre", postIn: true, hitBar: true }), "bar-in");
  assert.equal(skillZoneOf({ goal: false, zone: "bin" }), null);
  // BQ-P2-8: in off the bar is the engine's hitBar flag (see tests/game/bq-p2.test.ts), never a height guess.
  assert.equal(skillZoneOf({ goal: true, zone: "bin", postIn: true }), "post-in");
  assert.equal(skillZoneOf({ goal: true, zone: "bin", postIn: true, hitBar: true }), "bar-in");
  assert.equal(streakAfter(1, "top-bin"), 3); assert.equal(streakAfter(1, null), 2);
});

test("7-day login track: consecutive days advance, a gap restarts, once per day, day 7 unlocks a cosmetic", () => {
  let track = { lastDay: "", day: 0 };
  const days = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
  let last = null;
  for (const d of days) { const r = checkIn(track, d); track = r.track; last = r.reward; }
  assert.equal(track.day, 7); assert.equal(last?.cosmetic, LOGIN_TRACK[6].cosmetic);
  assert.equal(checkIn(track, "2026-09-27").reward, null, "once per day");
  assert.equal(checkIn(track, "2026-09-29").track.day, 1, "missed a day: restart");
  for (const step of LOGIN_TRACK) if (step.cosmetic) assert.ok(ALL_COSMETICS.some(c => c.id === step.cosmetic), `real cosmetic id ${step.cosmetic}`);
});

test("challenge streak: one freeze per ISO week bridges a single missed day", () => {
  const s = challengeStreak({ days: ["2026-09-21", "2026-09-22", "2026-09-24", "2026-09-25"], freezesUsed: [] }, "2026-09-25");
  assert.equal(s.streak, 4); assert.equal(s.freezesUsed.length, 1);
  const noFreeze = challengeStreak({ days: ["2026-09-21", "2026-09-22", "2026-09-24", "2026-09-25"], freezesUsed: s.freezesUsed }, "2026-09-25");
  assert.equal(noFreeze.streak, 2, "the week's freeze is already used");
});

test("4 h claim timer, and rewards are progression only (no currency anywhere)", () => {
  assert.equal(canClaim(0, CLAIM_EVERY_MS - 1), false); assert.equal(canClaim(0, CLAIM_EVERY_MS), true);
  assert.equal(nextClaimIn(1000, 1000), CLAIM_EVERY_MS);
  const src = readFileSync(new URL("../../games/penalty-kings/game/rewards.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /\bcoins?\b/i);
});
