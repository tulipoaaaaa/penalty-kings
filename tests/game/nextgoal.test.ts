import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextGoal } from "../../games/penalty-kings/game/nextgoal.ts";
import { fresh, LADDER, type Progress } from "../../games/penalty-kings/game/progress.ts";
import type { Level } from "../../games/penalty-kings/game/objectives.ts";

const LEVELS = JSON.parse(readFileSync(new URL("../../games/penalty-kings/game/levels.json", import.meta.url), "utf8")) as Level[];
const TODAY = "2026-09-27";
const at = (patch: Partial<Progress>): Progress => ({ ...fresh(), tutorialDone: true, ...patch });

test("next goal: always one concrete, free goal, in priority order", () => {
  const start = nextGoal(at({ xp: 40 }), LEVELS, TODAY);
  assert.match(start.text, /^60 XP to level 2: unlocks Free Kicks, World Tour, Daily Challenge, Target Practice$/);
  assert.equal(start.mode, "penalties");

  const daily = nextGoal(at({ xp: 150 }), LEVELS, TODAY);
  assert.equal(daily.mode, "daily"); assert.match(daily.text, /3 attempts left today/);
  const oneLeft = nextGoal(at({ xp: 150, daily: { date: TODAY, attempts: 2, best: 0, played: [] } }), LEVELS, TODAY);
  assert.match(oneLeft.text, /1 attempt left today/);

  const ladder = nextGoal(at({ xp: 150, daily: { date: TODAY, attempts: 3, best: 0, played: [] }, stamps: ["mouse"] }), LEVELS, TODAY);
  assert.equal(ladder.mode, "penalties"); assert.match(ladder.text, /Scouting Book stamp 2\/12/);

  const tour = nextGoal(at({ xp: 150, daily: { date: TODAY, attempts: 3, best: 0, played: [] }, stamps: [...LADDER] }), LEVELS, TODAY);
  assert.equal(tour.mode, "tour"); assert.match(tour.text, /^World Tour: First Touch \(0\/3 stars\)$/);

  const stars = Object.fromEntries(LEVELS.map(level => [level.id, 3]));
  const done = nextGoal(at({ xp: 150, daily: { date: TODAY, attempts: 3, best: 0, played: [] }, stamps: [...LADDER], stars, best: { target: 420, penalties: 0, freekicks: 0 } }), LEVELS, TODAY);
  assert.equal(done.mode, "target"); assert.match(done.text, /420/);

  // Yesterday's attempts don't count today.
  assert.equal(nextGoal(at({ xp: 150, daily: { date: "2026-09-26", attempts: 3, best: 0, played: [] } }), LEVELS, TODAY).mode, "daily");
  // Never a paid goal.
  for (const goal of [start, daily, ladder, tour, done]) assert.doesNotMatch(goal.text, /RF|pack|buy|Big Match/i);
});
