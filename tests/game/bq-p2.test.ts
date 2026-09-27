// Bug Quest P2 (engine / difficulty): game-side tests, each failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recordsDifficulty } from "../../games/penalty-kings/game/progress.ts";

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
