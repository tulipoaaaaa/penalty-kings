# Difficulty: easy to play, hard to master

Free modes (Penalties, Free Kicks, World Tour, Daily, Target Practice) use an **invisible
dynamic difficulty** so that a first-timer and a veteran both score about **55–65 %** of their
shots. The paid RF ball layer is not affected: RF prizes and $GBOOT drops come only from
on-chain randomness, never from your kick or from difficulty.

All rules live in `packages/engine` (pure, deterministic, unit-tested) and are shared by the
game and the Skill Cup referee.

## The knobs (one small parameter set)

| Parameter | Meaning |
|---|---|
| `reaction` | seconds added to the keeper's reaction (negative = sharper) |
| `reach` | multiplier on the keeper's save radius |
| `read` | added to the keeper's own read probability (the chance it dives the right way) |
| `clock` | shot clock, seconds (5 s; 4 s on the hardest rungs; off in the tutorial) |
| `wobble` | aim-wobble amplitude; it grows +20 % per streak goal (max +100 %) |
| `assist` | invisible aim assist, only on the three easiest rungs |

Each keeper keeps its own personality on top: reaction, dive time, reach, body, max height,
its **read probability** (Squeak 10 % … THE FINAL WALL 35 %) and its **tell** (shown in the
Scouting Book).

The ladder (`DIFFICULTY_LADDER`, easiest → hardest):

| Rung | reaction | reach | read | clock | wobble | assist |
|---|---|---|---|---|---|---|
| 0 | +0.30 s | ×0.55 | −0.30 | 5 s | 0 | 0.9 |
| 1 | +0.22 s | ×0.65 | −0.20 | 5 s | 0.02 | 0.6 |
| 2 | +0.15 s | ×0.75 | −0.10 | 5 s | 0.04 | 0.3 |
| 3 (start) | +0.08 s | ×0.85 | 0 | 5 s | 0.06 | 0 |
| 4 | +0.03 s | ×0.95 | +0.05 | 5 s | 0.08 | 0 |
| 5 | 0 | ×1.00 | +0.10 | 5 s | 0.10 | 0 |
| 6 | −0.03 s | ×1.10 | +0.20 | 4.5 s | 0.12 | 0 |
| 7 | −0.06 s | ×1.20 | +0.30 | 4 s | 0.14 | 0 |
| 8 | −0.10 s | ×1.30 | +0.40 | 4 s | 0.16 | 0 |

## The director

`nextDifficultyLevel(level, history)`:

- runs **only between rounds** (after every 5 shots); nothing changes mid-shot;
- looks at the **last 10 shots** and needs at least 5;
- goal rate above 65 % → one rung harder; below 55 % → one rung easier; else unchanged.

Zone accuracy and streak feed in through placement scoring and streak wobble. They are not
hidden rubber-banding.

## Scoring by placement (skill layer)

| Zone | Where | Multiplier |
|---|---|---|
| Centre | \|x\| < 0.34 | 1× — low centre shots meet a trailing leg 70 % of the time; a chipped centre can beat it |
| Side | 0.34 ≤ \|x\| < 0.66 | 2× |
| Corner | \|x\| ≥ 0.66, low | 3× |
| Top bin | \|x\| ≥ 0.66, high | 5× |
| In off the post | clips the inside of the frame and goes in (50 %) | +50 % |

## Proof: `npm run sim:difficulty` (runs in CI)

The simulation has four bot profiles (aim noise, power noise, wobble timing, ambition), a
Park keeper rotation, 4,000 five-shot rounds × 10 seeds per bot, and discards the first 20
rounds:

```
bot       easiest  hardest  | with director: goal rate  mean level
novice      66.1%    22.4%  |    57.3%    1.29   PASS
casual      73.5%    23.2%  |    58.8%    1.90   PASS
good        82.9%    26.6%  |    59.5%    3.00   PASS
expert      91.6%    33.9%  |    59.6%    4.77   PASS
```

The fixed-difficulty columns show why the director is needed. At a fixed rung, rates range from
22 % to 92 %; with the director, every profile settles inside the band. CI fails if any
profile leaves it.

## Input

- **One forgiving swipe** (`swipeToShot`): the release decides the shot. The direction of the
  last 100 ms (clamped to 80–120 ms) is blended with the whole swipe's chord, so a sloppy last
  frame still gives the intended shot. Speed sets power; a bowed path sets curl. Mouse and
  keyboard players drag the same way.
- **Aim assist + trajectory preview**: shown in the tutorial, the first 3 matches and at Park,
  then faded out.
- **Pressure**: 5 s shot clock (a timeout counts as a miss; off in the tutorial), streak
  wobble, crowd noise.
- **Feel**: 2-frame hit-stop, slow-mo on the release and near-misses (skill layer only),
  `navigator.vibrate` on Android (skipped where unsupported). No energy or lives in any free mode.
