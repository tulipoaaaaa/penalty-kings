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
| `reach` | multiplier on the keeper's arm length (drawn: the arms you see are the arms that save) |
| `read` | added to the keeper's own read probability (the chance it dives the right way) |
| `clock` | penalty shot clock, seconds (C2: 6 s; 5.5 s and 5 s on the two hardest rungs; free kicks +2 s: 8 s, never under 7 s; off in the tutorial, Target Practice and the first 3 matches) |
| `wobble` | aim-wobble amplitude; it grows +20 % per streak goal (max +100 %) |
| `assist` | invisible aim assist, only on the three easiest rungs |

Each keeper keeps its own personality on top: reaction, dive time, max height, its **read
probability** (Squeak 10 % … THE FINAL WALL 35 %), its **tell** (shown in the Scouting Book)
and its **body**, which is its art: the sprite's pixels, arm length and gloves.

## Saves need contact (round 6 B4)

A penalty is saved **only if the ball touches the keeper as drawn** when it crosses the line.
`keeperFrame(id, plan, t)` in `packages/engine` is the single source of truth: the sprite's
opaque pixels (`KEEPER_RIGS`, checked against the art), both arms, both gloves, the trailing
leg when the dive leaves one, and the mime's wall. `resolveShot` tests the ball (radius
`BALL_RADIUS`) against the frame at `target.time`; the Stage draws the keeper from the same
frame (its flight is a uniform time-lapse of the engine's, so the crossing frame is the same
instant). Dives travel and tip towards the dive point so both gloves arrive there; central
plans stand up big with the arms spread at the shot height. `tests/game/keeper-sync.test.ts`
rebuilds the drawn keeper and ball over 2,000 seeded kicks and requires 0 mismatches; the
Showroom's *Keeper hitbox* overlay shows the hitbox now, at arrival and the ball at arrival.

The ladder (`DIFFICULTY_LADDER`, easiest → hardest):

| Rung | reaction | reach | read | clock | wobble | assist |
|---|---|---|---|---|---|---|
| 0 | +0.30 s | ×0.55 | −0.30 | 6 s (FK 8 s) | 0 | 0.9 |
| 1 | +0.22 s | ×0.65 | −0.20 | 6 s (FK 8 s) | 0.02 | 0.6 |
| 2 | +0.15 s | ×0.75 | −0.10 | 6 s (FK 8 s) | 0.04 | 0.3 |
| 3 (start) | +0.08 s | ×0.85 | 0 | 6 s (FK 8 s) | 0.06 | 0 |
| 4 | +0.03 s | ×0.95 | +0.05 | 6 s (FK 8 s) | 0.08 | 0 |
| 5 | 0 | ×1.00 | +0.10 | 6 s (FK 8 s) | 0.10 | 0 |
| 6 | −0.03 s | ×1.10 | +0.20 | 5.5 s (FK 7.5 s) | 0.12 | 0 |
| 7 | −0.06 s | ×1.20 | +0.30 | 5 s (FK 7 s) | 0.14 | 0 |
| 8 | −0.10 s | ×1.30 | +0.40 | 5 s (FK 7 s) | 0.16 | 0 |

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
| Centre | \|x\| < 0.34 | 1× — 70 % of dives leave a visible trailing leg (with a "leg!" call-out) that stops ground shots through the middle; a chipped centre beats it |
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
novice      75.2%    41.3%  |    59.4%    3.39   PASS
casual      78.8%    40.0%  |    59.5%    3.57   PASS
good        82.8%    41.3%  |    59.6%    4.39   PASS
expert      86.4%    49.5%  |    60.6%    6.24   PASS
```

The fixed-difficulty columns show why the director is needed. At a fixed rung, rates range from
40 % to 86 %; with the director, every profile settles inside the band. CI fails if any
profile leaves it. (Before contact-only saves the keeper also saved balls it visibly missed,
which is why the old fixed-rung rates were lower: 22–92 %.)

## Free kicks (owner playtest C1)

Free kicks keep their range (18–32 m) and became a learnable long-range skill. Engine:
`packages/engine/src/freekick.ts` (flight) and `freekick-keeper.ts` (the keeper); numbers from
`node --experimental-strip-types scripts/freekick-sim.ts` (before = the same script at
`b517d77`).

- **Pace**: launch 24–36 m/s (was 18–32). Distance adds pace by itself (`freeKickSpeed`):
  24–28.8 m/s from 18 m, 31.2–36 m/s from 32 m, so a natural swipe from 30 m is struck harder
  than from 18 m. Topspin is a real dip (Magnus ∝ spin × speed; every non-knuckle strike carries
  a little), the long-range tool that lets a ball clear the wall and still drop under the bar.
- **Swipe → shot**: the swipe's height is still the crossing height (`solveLift`, WYSIWYG), now
  over a wider elevation range (0.03–0.53 rad), with the knuckleball solved without its wobble.
- **Preview**: the dotted arc is the real flight with the strike's own seed (`kickSetup`: the
  knuckleball wobble it draws is the one the ball flies) and ends in a ring where it crosses
  the goal line.
- **Reward**: goals from 28 m+ score +50 % and are called a SCREAMER (banner, commentary
  context `screamer`, Director lines `goal:screamer` / `first:screamer`).
- **Keeper**: shuffles 1–3 steps off his post as the kick is taken, reads the flight (later
  when the wall screens it; better the longer he watches it), cross-steps if the ball is beyond
  one dive, then ONE dive timed to the crossing: trapezoid speed profile capped at 4.2–6 m/s by
  personality (Squeak 6, Nibbles 5.8 and early, Snooze 4.2 on long arms, Big Bento 4.4, …),
  0.35–0.5 s in the air, gloves 2.4–2.8 m from take-off (the boss 3.4 m). A high ball close to
  him is a backpedal and an upward tip over the bar ("TIPPED OVER!"). The Stage draws exactly
  `freeKickKeeperFrame` (shuffle hops are drawing-only and off under reduced motion), and a ball
  the drawn keeper touches is always a save, round the post or over the bar included.

Good-swipe bot: crossing point anywhere between x = ±0.25…0.85 and y = 0.45…0.9, power 0.4–0.75,
topspin 0.2–0.7, no sidespin, aim noise σ = 0.08; wall always there (pro height); keeper = the
11 field keepers in turn at NEUTRAL.

| Distance | No keeper, before | No keeper, after | With keeper + wall, before | With keeper + wall, after |
|---|---|---|---|---|
| 18–20 m | 50 % | 78 % | 29 % | 45 % |
| 21–24 m | 72 % | 95 % | 42 % | 41 % |
| 25–27 m | 89 % | 96 % | 51 % | 42 % |
| 28–32 m | 88 % | 96 % | 49 % | 36 % |
| Overall (18–32 m mix) | | | 46 % | 41 % |

Long range is now the harder shot against a keeper (he watches it longer), which is what the
+50 % pays for; short range is no longer a wall lottery.

Flight time, strike → goal line (s), unspun, topspin 0.3, crossing at 0.7 of the bar height.
The Stage plays the flight 1:1 on the engine clock (release → result adds the 0.4 s run-up and a
33 ms hit-stop; near-miss slow-mo now starts only at the line for free kicks):

| Distance | Before: launch | Before: power 0.4 / 0.6 / 1.0 | After: launch | After: power 0.4 / 0.6 / 1.0 |
|---|---|---|---|---|
| 18 m | 18–32 m/s | 0.90 / 0.80 / 0.65 | 24.0–28.8 m/s | 0.84 / 0.80 / 0.74 |
| 21 m | 18–32 m/s | 1.09 / 0.95 / 0.77 | 25.5–30.3 m/s | 0.94 / 0.90 / 0.84 |
| 24 m | 18–32 m/s | 1.29 / 1.12 / 0.90 | 27.1–31.9 m/s | 1.04 / 1.00 / 0.93 |
| 28 m | 18–32 m/s | 1.56 / 1.37 / 1.09 | 29.1–33.9 m/s | 1.17 / 1.13 / 1.05 |
| 32 m | 18–32 m/s | 1.88 / 1.64 / 1.29 | 31.2–36.0 m/s | 1.30 / 1.25 / 1.17 |

Keeper's fastest lateral body speed over every 1/240 s frame of 2,000 kicks: **83.5 m/s before**
(the penalty dive curve: an ease-out over the keeper's penalty `diveTime`, as short as 0.1 s,
across up to 1.3 goal units) → **6.0 m/s after**
(the cap; `packages/engine/test/freekick.test.ts` checks every frame of 600 fuzzed kicks at
every difficulty).

Clips of the same three free kicks (18 m, 25 m, 32 m; Pro wall, Nibbles, NEUTRAL; the game's
Stage in full motion, `node scripts/record-freekicks.mjs --out …`): `docs/media/fk-before.webm`
and `docs/media/fk-after.webm`. Engine flight / measured on screen (strike → result): before
0.85 / 0.89 s, 1.21 / 1.27 s, 1.56 / 1.62 s; after 0.84 / 0.90 s, 1.08 / 1.14 s, 1.28 / 1.32 s.

Engine tests (`npm run test:engine`) also print the reachability table: for every distance
18–32 m and power 0 / 0.25 / 0.5 / 0.75 / 1, a natural swipe (topspin 0.4) aimed over a pro wall
of 5 has a non-empty band of crossing heights that scores (≥ 0.2 goal units at power ≤ 0.5).

## Input

- **One forgiving swipe** (`swipeToShot`): the release decides the shot. The direction of the
  last 100 ms (clamped to 80–120 ms) is blended with the whole swipe's chord, so a sloppy last
  frame still gives the intended shot. Speed sets power; a bowed path sets curl. Mouse and
  keyboard players drag the same way.
- **Aim assist + trajectory preview**: shown in the tutorial, the first 3 matches and at Park,
  then faded out.
- **Pressure**: shot clock of 6 s for penalties and 8 s for free kicks (a timeout counts as a miss; off in the tutorial, Target Practice and the first 3 matches), streak
  wobble, crowd noise.
- **Feel**: 2-frame hit-stop, slow-mo on the release and near-misses (skill layer only),
  `navigator.vibrate` on Android (skipped where unsupported). No energy or lives in any free mode.
