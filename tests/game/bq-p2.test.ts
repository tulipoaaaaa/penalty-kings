// Bug Quest P2 (engine / difficulty): game-side tests, each failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recordsDifficulty } from "../../games/penalty-kings/game/progress.ts";
import { keeperHistory } from "../../games/penalty-kings/game/shots.ts";
import { keeperPlan, keeperById, type ShotResult } from "@penalty-kings/engine";

const index = () => readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");

test("BQ-P2-2: only ladder-mode kicks feed the difficulty history (never Skill Cup, Big Match, Target or the tutorial)", () => {
  for (const mode of ["penalties", "tour", "daily"] as const) assert.equal(recordsDifficulty(mode, "penalty"), true, mode);
  assert.equal(recordsDifficulty("freekicks", "freekick"), true);
  for (const mode of ["skill", "match", "tutorial"] as const) assert.equal(recordsDifficulty(mode, "penalty"), false, mode);
  assert.equal(recordsDifficulty("target", "target"), false);
  assert.equal(recordsDifficulty("penalties", "target"), false);
  // The shell's one history write is behind the guard.
  const writes = index().split("\n").filter(line => /history: \[\.\.\.p\.history/.test(line));
  assert.equal(writes.length, 1);
  assert.match(writes[0], /if \(recordsDifficulty\(current\.mode, current\.kind\)\)/);
});

test("BQ-P2-6: a shot-clock timeout never enters the robot keeper's kick history", () => {
  const kick = (x: number) => ({ result: "goal" as ShotResult, zone: "corner" as const, points: 100, x, y: 0.3 });
  const timeout = { result: "wide" as ShotResult, zone: "centre" as const, points: 0, x: 0, y: 0, timedOut: true };
  const kicks = [kick(0.7), kick(0.8), timeout, timeout, timeout];
  assert.deepEqual(keeperHistory(kicks), [0.7, 0.8]);
  // The robot still knows your favourite side after three timeouts (with x: 0 in his memory he forgot it).
  const robot = keeperById("robot"), scans = new Set<number | undefined>();
  for (let seed = 1; seed <= 200; seed++) scans.add(keeperPlan(robot, seed, { x: 0, y: 0.5 }, { kickIndex: 5, history: keeperHistory(kicks) }).scan);
  assert.ok(scans.has(1), "the robot scans the learned (right) side");
  // The shell: the timeout record is flagged, and both keeper-history reads go through keeperHistory.
  const source = index();
  assert.match(source, /record: \{ result: "wide", zone: "centre", points: 0, x: 0, y: 0, timedOut: true \}/);
  assert.equal((source.match(/history: keeperHistory\(current\.kicks\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /history: current\.kicks\.map\(kick => kick\.x\)/);
});
