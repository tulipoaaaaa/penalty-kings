import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAfterKick, matchResultTitle } from "../../games/penalty-kings/game/match.ts";

const k = (s: string) => [...s].map(c => ({ result: c === "g" ? "goal" : "saved" }));

test("Big Match: 4 goals then a miss on kick 5 starts sudden death (kick 6 is played)", () => {
  assert.deepEqual(matchAfterKick(k("ggggm"), false), { suddenDeath: true, starts: true, over: false, done: false });
  assert.equal(matchResultTitle(k("ggggm"), true), "Full time: 4 of 5 scored, sudden death reached");
});

test("Big Match: 3 goals then a miss on kick 5 starts sudden death", () => {
  assert.deepEqual(matchAfterKick(k("gmggm"), false), { suddenDeath: true, starts: true, over: false, done: false });
});

test("Big Match: 3 goals with kick 5 scored also starts sudden death", () => {
  assert.deepEqual(matchAfterKick(k("mmggg"), false), { suddenDeath: true, starts: true, over: false, done: false });
});

test("Big Match: 2 goals after 5 kicks ends at full time with no sudden death", () => {
  assert.deepEqual(matchAfterKick(k("gmgmm"), false), { suddenDeath: false, starts: false, over: false, done: true });
  assert.equal(matchResultTitle(k("gmgmm"), false), "Full time: 2 of 5 scored (3 goals start sudden death)");
});

test("Big Match: under 5 kicks the match goes on", () => {
  assert.deepEqual(matchAfterKick(k("gggm"), false), { suddenDeath: false, starts: false, over: false, done: false });
});

test("Big Match: a goal in sudden death keeps it going; a miss ends it", () => {
  assert.deepEqual(matchAfterKick(k("ggggmg"), true), { suddenDeath: true, starts: false, over: false, done: false });
  assert.deepEqual(matchAfterKick(k("ggggmgm"), true), { suddenDeath: true, starts: false, over: true, done: true });
  assert.equal(matchResultTitle(k("ggggmgm"), true), "Sudden death over: missed");
});
