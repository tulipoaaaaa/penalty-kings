// C2 "Shots that feel amazing": the PERFECT strike, the streak multiplier table and the shot clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../src/index.ts";

const squirrel = E.keeperById("squirrel");

test("PERFECT strike: a swipe-speed (power) band, decided by the shot inputs alone", () => {
  assert.deepEqual([...E.PERFECT_BAND], [0.74, 0.84]);
  for (const power of [0.74, 0.79, 0.84]) assert.equal(E.isPerfectStrike(power), true, `power ${power}`);
  for (const power of [0.35, 0.7, 0.739, 0.841, 0.9, 1, Number.NaN]) assert.equal(E.isPerfectStrike(power), false, `power ${power}`);
  // Quick shot (0.7) is never perfect: the bonus needs a real flick.
  assert.equal(E.isPerfectStrike(0.7), false);
});

test("PERFECT strike: a slightly faster ball, same landing point", () => {
  const plain = E.shotTarget({ aimX: 0.6, aimY: 0.5, power: 0.73, curl: 0 });
  const perfect = E.shotTarget({ aimX: 0.6, aimY: 0.5, power: 0.79, curl: 0 });
  const expected = (0.95 - 0.55 * 0.79) * E.PERFECT_PACE;
  assert.ok(Math.abs(perfect.time - expected) < 1e-12, `perfect time ${perfect.time}`);
  assert.ok(perfect.time < plain.time - 0.05, "noticeably quicker than a near-miss of the band");
  assert.equal(perfect.x, plain.x); assert.equal(perfect.y, plain.y);
  assert.ok(E.PERFECT_PACE >= 0.9 && E.PERFECT_PACE < 1, "the bonus stays small");
});

test("PERFECT strike: tighter aim wobble, applied by aimedShot (reticle and kick alike)", () => {
  assert.equal(E.strikeWobble(0.1, 0.79), 0.1 * E.PERFECT_WOBBLE);
  assert.equal(E.strikeWobble(0.1, 0.6), 0.1);
  const perfect = E.aimedShot({ aimX: 0.5, aimY: 0.5, power: 0.8, curl: 0 }, 0.1, 0);
  const plain = E.aimedShot({ aimX: 0.5, aimY: 0.5, power: 0.6, curl: 0 }, 0.1, 0);
  assert.ok(Math.abs(perfect.aimX - 0.55) < 1e-12); assert.ok(Math.abs(plain.aimX - 0.6) < 1e-12);
});

test("PERFECT strike: deterministic in resolveShot and resolveFreeKick; a perfect free kick is struck harder", () => {
  const shot = { aimX: 0.7, aimY: 0.6, power: 0.8, curl: 0.2 };
  for (let seed = 0; seed < 50; seed++) assert.deepEqual(E.resolveShot(shot, squirrel, seed), E.resolveShot(shot, squirrel, seed));
  assert.equal(E.resolveShot(shot, squirrel, 7).target.time, E.shotTarget(shot).time);
  const setup = E.freeKickSetup(99, { distance: 24, angle: 0, wallSize: 4 });
  const perfect = E.resolveFreeKick(setup, { aimX: 0.6, lift: 0.3, power: 0.8, spin: 0, top: 0.3 }, squirrel);
  const again = E.resolveFreeKick(setup, { aimX: 0.6, lift: 0.3, power: 0.8, spin: 0, top: 0.3 }, squirrel);
  assert.deepEqual(perfect, again);
  // Just under the band: 0.739 vs 0.74 differ in pace by far more than the power step alone explains.
  const under = E.resolveFreeKick(setup, { aimX: 0.6, lift: 0.3, power: 0.739, spin: 0, top: 0.3 }, squirrel);
  const inBand = E.resolveFreeKick(setup, { aimX: 0.6, lift: 0.3, power: 0.74, spin: 0, top: 0.3 }, squirrel);
  if (under.result !== "wall" && inBand.result !== "wall") assert.ok(inBand.target.time < under.target.time * 0.985, `perfect FK quicker: ${inBand.target.time} vs ${under.target.time}`);
});

test("streak multiplier (points only): x1.2 at 3, x1.5 at 5, x2 at 10", () => {
  const table = [0, 1, 2, 3, 4, 5, 9, 10, 11, 50].map(n => [n, E.streakMultiplier(n)]);
  assert.deepEqual(table, [[0, 1], [1, 1], [2, 1], [3, 1.2], [4, 1.2], [5, 1.5], [9, 1.5], [10, 2], [11, 2], [50, 2]]);
  assert.equal(E.STREAK_CAP, 2);
  // goalPoints applies it exactly once.
  assert.equal(E.goalPoints(squirrel, 1, 1, false, "corner"), 300);
  assert.equal(E.goalPoints(squirrel, 1, 3, false, "corner"), 360);
  assert.equal(E.goalPoints(squirrel, 1, 5, false, "corner"), 450);
  assert.equal(E.goalPoints(squirrel, 1, 10, false, "corner"), 600);
});

test("shot clock: penalties 6 s, free kicks 8 s, tightening only on the hardest rungs to no less than 5 s / 7 s", () => {
  const pens = E.DIFFICULTY_LADDER.map(d => E.shotClockSeconds(d, "penalty"));
  const fks = E.DIFFICULTY_LADDER.map(d => E.shotClockSeconds(d, "freekick"));
  assert.deepEqual(pens, [6, 6, 6, 6, 6, 6, 5.5, 5, 5]);
  assert.deepEqual(fks, [8, 8, 8, 8, 8, 8, 7.5, 7, 7]);
  assert.ok(pens.every(s => s >= 5) && fks.every(s => s >= 7));
  assert.equal(E.shotClockSeconds(E.NEUTRAL, "penalty"), 6, "the Skill Cup (NEUTRAL) clock");
  assert.equal(E.shotClockSeconds({ ...E.NEUTRAL, clock: 0 }, "freekick"), 0, "0 stays off");
});
