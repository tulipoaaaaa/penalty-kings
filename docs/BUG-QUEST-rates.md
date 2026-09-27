# Bug Quest: keeper goal rates before/after the engine fixes

Goal rate (%) per keeper (`node --experimental-strip-types scripts/keeper-goal-rates.ts` prints the JSON) at a fixed difficulty rung: `NEUTRAL` and `DIFFICULTY_LADDER` L0–L8. Shots are the
four `scripts/difficulty-sim.ts` bots (novice, casual, good, expert) in equal share, 20,000 shots per cell,
same seeds before and after (penalties, `resolveShot` with `assistShot` and the rung's wobble). Acceptance:
every keeper within ±2 pts of its old rate.

## BQ-P1-2: the keeper is tested before the frame

`resolveShot` now tests keeper contact before the post/bar/wide/over branch. Only shots that were
post/wide/over AND overlapped the drawn keeper change, and they become saves, so no goal is gained or lost:
every cell is identical (the in-off-the-post goals were already keeper-tested).

Fuzz in `tests/game/keeper-sync.test.ts` (48,000 kicks around the frame, every keeper × every rung):
post 11,015 → 9,673, wide 14,900 → 14,644, over 8,870 → 8,815, save 3,393 → 5,046; goals 9,822 → 9,822;
rendered-vs-physics mismatches 1,653 → 0.

| keeper | neutral | L0 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | max |Δ| |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mouse | 63.7 → 63.7 | 77.1 → 77.1 | 74.1 → 74.1 | 71.8 → 71.8 | 63.4 → 63.4 | 60.5 → 60.5 | 57.5 → 57.5 | 51.7 → 51.7 | 46.5 → 46.5 | 41.4 → 41.4 | 0.00 |
| squirrel | 61.6 → 61.6 | 75.2 → 75.2 | 72.7 → 72.7 | 69.7 → 69.7 | 61.7 → 61.7 | 58.7 → 58.7 | 55.5 → 55.5 | 49.3 → 49.3 | 42.8 → 42.8 | 36.4 → 36.4 | 0.00 |
| sloth | 74.6 → 74.6 | 89.6 → 89.6 | 83.4 → 83.4 | 79.3 → 79.3 | 75.4 → 75.4 | 73.7 → 73.7 | 72.4 → 72.4 | 69.1 → 69.1 | 65.6 → 65.6 | 62.7 → 62.7 | 0.00 |
| peacock | 61.9 → 61.9 | 78.2 → 78.2 | 75.0 → 75.0 | 69.6 → 69.6 | 61.0 → 61.0 | 58.2 → 58.2 | 55.2 → 55.2 | 48.8 → 48.8 | 41.8 → 41.8 | 35.8 → 35.8 | 0.00 |
| octopus | 60.7 → 60.7 | 86.6 → 86.6 | 81.2 → 81.2 | 70.5 → 70.5 | 60.7 → 60.7 | 57.2 → 57.2 | 53.4 → 53.4 | 47.0 → 47.0 | 40.3 → 40.3 | 33.8 → 33.8 | 0.00 |
| mime | 51.3 → 51.3 | 60.6 → 60.6 | 56.8 → 56.8 | 54.1 → 54.1 | 52.1 → 52.1 | 52.0 → 52.0 | 51.9 → 51.9 | 51.7 → 51.7 | 51.5 → 51.5 | 51.2 → 51.2 | 0.00 |
| disco | 62.1 → 62.1 | 77.0 → 77.0 | 71.8 → 71.8 | 69.2 → 69.2 | 61.4 → 61.4 | 58.5 → 58.5 | 55.6 → 55.6 | 49.4 → 49.4 | 43.4 → 43.4 | 37.8 → 37.8 | 0.00 |
| sumo | 67.2 → 67.2 | 89.7 → 89.7 | 84.5 → 84.5 | 78.2 → 78.2 | 69.3 → 69.3 | 64.6 → 64.6 | 60.8 → 60.8 | 53.9 → 53.9 | 46.9 → 46.9 | 39.9 → 39.9 | 0.00 |
| chameleon | 46.2 → 46.2 | 74.4 → 74.4 | 62.6 → 62.6 | 52.9 → 52.9 | 45.2 → 45.2 | 43.2 → 43.2 | 40.8 → 40.8 | 36.2 → 36.2 | 31.6 → 31.6 | 27.4 → 27.4 | 0.00 |
| robot | 54.5 → 54.5 | 81.5 → 81.5 | 72.4 → 72.4 | 62.8 → 62.8 | 54.4 → 54.4 | 51.3 → 51.3 | 48.1 → 48.1 | 42.0 → 42.0 | 36.4 → 36.4 | 30.1 → 30.1 | 0.00 |
| ghost | 44.5 → 44.5 | 59.1 → 59.1 | 49.4 → 49.4 | 46.1 → 46.1 | 44.5 → 44.5 | 44.4 → 44.4 | 44.4 → 44.4 | 45.0 → 45.0 | 45.9 → 45.9 | 46.1 → 46.1 | 0.00 |
| finalwall | 43.2 → 43.2 | 71.9 → 71.9 | 58.2 → 58.2 | 49.5 → 49.5 | 42.1 → 42.1 | 39.8 → 39.8 | 38.5 → 38.5 | 33.6 → 33.6 | 29.1 → 29.1 | 24.4 → 24.4 | 0.00 |

## BQ-P1-3: the mouse really cannot reach the top corners

A keeper whose `maxY` is under the top-bin line (`TOP_BIN_Y` = 0.66; only the mouse, maxY 0.58) is now
lowered each frame until his highest point (tipped body corner, glove corner, shoulder edge) is under the
lowest top-bin ball (`TOP_BIN_Y · GOAL_ASPECT − BALL_RADIUS`). No other keeper moves (every other row is
identical). Top-bin saves by the mouse (10,000 on-target top-bin shots per rung, the engine test's
generator): before N 8.1%, L0 2.9%, L1 3.1%, L2 2.8%, L3 8.6%, L4 11.3%, L5 14.1%, L6 18.4%, L7 20.6%,
L8 23.1%; after 0 at every rung.

The mouse's goal rate rises by more than 2 pts on the upper rungs. That is the tell becoming true, not a
retune: at L8 top-bin goals go 10.0 → 15.6 % of all shots (+5.6 of the +9.0 pts); the rest are other high
shots the lowered rig no longer reaches (at neutral: +1.6 of the +2.4 pts are top-bin goals). No compensating change was made; `npm run sim:difficulty` still settles every bot
profile inside the 55–65 % band (59.5 / 59.5 / 59.7 / 61.1 %).

| keeper | neutral | L0 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | max |Δ| |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mouse | 63.7 → 66.1 (+2.4) | 77.1 → 76.5 (-0.6) | 74.1 → 73.8 (-0.3) | 71.8 → 71.6 (-0.2) | 63.4 → 65.6 (+2.2) | 60.5 → 63.8 (+3.3) | 57.5 → 61.8 (+4.3) | 51.7 → 58.0 (+6.2) | 46.5 → 54.3 (+7.8) | 41.4 → 50.4 (+9.0) | 8.95 |
| squirrel | 61.6 → 61.6 | 75.2 → 75.2 | 72.7 → 72.7 | 69.7 → 69.7 | 61.7 → 61.7 | 58.7 → 58.7 | 55.5 → 55.5 | 49.3 → 49.3 | 42.8 → 42.8 | 36.4 → 36.4 | 0.00 |
| sloth | 74.6 → 74.6 | 89.6 → 89.6 | 83.4 → 83.4 | 79.3 → 79.3 | 75.4 → 75.4 | 73.7 → 73.7 | 72.4 → 72.4 | 69.1 → 69.1 | 65.6 → 65.6 | 62.7 → 62.7 | 0.00 |
| peacock | 61.9 → 61.9 | 78.2 → 78.2 | 75.0 → 75.0 | 69.6 → 69.6 | 61.0 → 61.0 | 58.2 → 58.2 | 55.2 → 55.2 | 48.8 → 48.8 | 41.8 → 41.8 | 35.8 → 35.8 | 0.00 |
| octopus | 60.7 → 60.7 | 86.6 → 86.6 | 81.2 → 81.2 | 70.5 → 70.5 | 60.7 → 60.7 | 57.2 → 57.2 | 53.4 → 53.4 | 47.0 → 47.0 | 40.3 → 40.3 | 33.8 → 33.8 | 0.00 |
| mime | 51.3 → 51.3 | 60.6 → 60.6 | 56.8 → 56.8 | 54.1 → 54.1 | 52.1 → 52.1 | 52.0 → 52.0 | 51.9 → 51.9 | 51.7 → 51.7 | 51.5 → 51.5 | 51.2 → 51.2 | 0.00 |
| disco | 62.1 → 62.1 | 77.0 → 77.0 | 71.8 → 71.8 | 69.2 → 69.2 | 61.4 → 61.4 | 58.5 → 58.5 | 55.6 → 55.6 | 49.4 → 49.4 | 43.4 → 43.4 | 37.8 → 37.8 | 0.00 |
| sumo | 67.2 → 67.2 | 89.7 → 89.7 | 84.5 → 84.5 | 78.2 → 78.2 | 69.3 → 69.3 | 64.6 → 64.6 | 60.8 → 60.8 | 53.9 → 53.9 | 46.9 → 46.9 | 39.9 → 39.9 | 0.00 |
| chameleon | 46.2 → 46.2 | 74.4 → 74.4 | 62.6 → 62.6 | 52.9 → 52.9 | 45.2 → 45.2 | 43.2 → 43.2 | 40.8 → 40.8 | 36.2 → 36.2 | 31.6 → 31.6 | 27.4 → 27.4 | 0.00 |
| robot | 54.5 → 54.5 | 81.5 → 81.5 | 72.4 → 72.4 | 62.8 → 62.8 | 54.4 → 54.4 | 51.3 → 51.3 | 48.1 → 48.1 | 42.0 → 42.0 | 36.4 → 36.4 | 30.1 → 30.1 | 0.00 |
| ghost | 44.5 → 44.5 | 59.1 → 59.1 | 49.4 → 49.4 | 46.1 → 46.1 | 44.5 → 44.5 | 44.4 → 44.4 | 44.4 → 44.4 | 45.0 → 45.0 | 45.9 → 45.9 | 46.1 → 46.1 | 0.00 |
| finalwall | 43.2 → 43.2 | 71.9 → 71.9 | 58.2 → 58.2 | 49.5 → 49.5 | 42.1 → 42.1 | 39.8 → 39.8 | 38.5 → 38.5 | 33.6 → 33.6 | 29.1 → 29.1 | 24.4 → 24.4 | 0.00 |

## BQ-P2-1: the mime and the ghost respond to the ladder

The mime (wall) and the ghost (teleport) skipped the keeper read in `adjustPlan`, so the rungs above L3 only
changed their reaction and arm length, which barely matters to a wall or a blink: the mime stayed flat
(52.3 % at L3, 51.8 % at L8) and the ghost got easier (44.3 → 45.8 %). They now get the ladder's EXTRA read
only (`difficulty.read`, 0.05 at L4 up to 0.4 at L8): the mime steps to your side of his wall, the ghost
appears where you aimed. `NEUTRAL` (the Skill Cup referee) and every rung with read ≤ 0 (L0–L3) draw no extra
roll, so those cells are identical, and no other keeper changes. Both now fall about as steeply as the rest of
the roster (L3 → L8: mime −19 pts, ghost −17 pts; squirrel −26, robot −25). `npm run sim:difficulty` is
unaffected (its keepers are the Park five).

Baseline = the current head before this fix (it includes BQ-P1-3 and C2's PERFECT strike, so a few cells differ
from the tables above by a few tenths). Test: `packages/engine/test/bq-p2.test.ts` (every keeper: each rung L3 →
L8 no easier than the one below it within 2 pts, and L8 at least 5 pts under L3; the mime failed before).

| keeper | neutral | L0 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | max |Δ| |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mouse | 66.1 → 66.1 | 76.3 → 76.3 | 73.6 → 73.6 | 71.4 → 71.4 | 65.8 → 65.8 | 63.9 → 63.9 | 62.0 → 62.0 | 58.4 → 58.4 | 54.7 → 54.7 | 50.9 → 50.9 | 0.00 |
| squirrel | 61.5 → 61.5 | 75.8 → 75.8 | 73.5 → 73.5 | 70.3 → 70.3 | 61.9 → 61.9 | 58.9 → 58.9 | 55.7 → 55.7 | 49.2 → 49.2 | 42.6 → 42.6 | 36.1 → 36.1 | 0.00 |
| sloth | 73.9 → 73.9 | 90.8 → 90.8 | 84.5 → 84.5 | 79.6 → 79.6 | 75.6 → 75.6 | 73.5 → 73.5 | 72.1 → 72.1 | 68.7 → 68.7 | 65.3 → 65.3 | 62.2 → 62.2 | 0.00 |
| peacock | 61.7 → 61.7 | 78.6 → 78.6 | 75.5 → 75.5 | 70.0 → 70.0 | 61.2 → 61.2 | 58.2 → 58.2 | 54.9 → 54.9 | 48.5 → 48.5 | 41.4 → 41.4 | 35.1 → 35.1 | 0.00 |
| octopus | 60.7 → 60.7 | 87.0 → 87.0 | 81.6 → 81.6 | 70.8 → 70.8 | 61.0 → 61.0 | 57.3 → 57.3 | 53.6 → 53.6 | 47.0 → 47.0 | 40.3 → 40.3 | 33.5 → 33.5 | 0.00 |
| mime | 51.4 → 51.4 | 61.2 → 61.2 | 57.5 → 57.5 | 54.6 → 54.6 | 52.3 → 52.3 | 52.4 → 50.4 (-2.0) | 52.3 → 47.9 (-4.5) | 52.1 → 43.1 (-9.1) | 52.0 → 38.0 (-14.0) | 51.8 → 33.2 (-18.6) | 18.56 |
| disco | 62.1 → 62.1 | 77.1 → 77.1 | 72.3 → 72.3 | 69.7 → 69.7 | 61.4 → 61.4 | 58.7 → 58.7 | 55.8 → 55.8 | 49.5 → 49.5 | 43.1 → 43.1 | 37.2 → 37.2 | 0.00 |
| sumo | 66.8 → 66.8 | 90.7 → 90.7 | 85.5 → 85.5 | 79.0 → 79.0 | 69.4 → 69.4 | 64.5 → 64.5 | 60.6 → 60.6 | 53.4 → 53.4 | 46.2 → 46.2 | 39.0 → 39.0 | 0.00 |
| chameleon | 46.0 → 46.0 | 75.0 → 75.0 | 62.8 → 62.8 | 52.5 → 52.5 | 44.6 → 44.6 | 42.5 → 42.5 | 40.3 → 40.3 | 35.7 → 35.7 | 30.8 → 30.8 | 26.5 → 26.5 | 0.00 |
| robot | 54.4 → 54.4 | 82.0 → 82.0 | 73.2 → 73.2 | 63.5 → 63.5 | 54.9 → 54.9 | 51.5 → 51.5 | 48.4 → 48.4 | 41.9 → 41.9 | 36.0 → 36.0 | 29.5 → 29.5 | 0.00 |
| ghost | 44.4 → 44.4 | 57.5 → 57.5 | 51.2 → 51.2 | 46.2 → 46.2 | 44.3 → 44.3 | 44.2 → 42.0 (-2.1) | 44.1 → 39.8 (-4.3) | 44.7 → 35.7 (-9.0) | 45.6 → 32.0 (-13.6) | 45.8 → 27.7 (-18.1) | 18.09 |
| finalwall | 39.8 → 39.8 | 70.8 → 70.8 | 55.9 → 55.9 | 46.4 → 46.4 | 38.9 → 38.9 | 36.5 → 36.5 | 35.2 → 35.2 | 30.5 → 30.5 | 25.9 → 25.9 | 21.6 → 21.6 | 0.00 |
