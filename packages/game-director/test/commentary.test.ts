import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "../../engine/src/index.ts";
import { BANTER, BANTER_COUNT, Commentator, LINE_BANK, LINE_COUNT, REPEAT_LINES, REPEAT_SECONDS, Rng, lineTemplate } from "../src/index.ts";
import { simulate } from "./sim.ts";

test("150+ original lines, tagged by context, with no duplicates", () => {
  assert.ok(LINE_COUNT >= 150, `${LINE_COUNT} lines`);
  const texts = Object.values(LINE_BANK).flat().concat(Object.values(BANTER).flat(2));
  assert.equal(new Set(texts).size, texts.length, "duplicate line");
  for (const text of texts) {
    assert.ok(text.length > 2 && text.length <= 110, text);
    for (const [placeholder] of text.matchAll(/\{[a-z]+\}/g)) assert.ok(["{friend}", "{keeper}", "{number}"].includes(placeholder), `${placeholder} in ${text}`);
  }
  const tags = Object.keys(LINE_BANK);
  for (const prefix of ["goal:bin", "goal:panenka", "goal:vs:", "save:by:", "near-miss", "streak:", "glow:", "first:", "time:", "stadium:", "tell:"]) assert.ok(tags.some(tag => tag.startsWith(prefix)), prefix);
});

test("every keeper has a tell, a beaten line, a save line and two banter pairs", () => {
  for (const keeper of KEEPERS) {
    for (const context of [`tell:${keeper.id}`, `goal:vs:${keeper.id}`, `save:by:${keeper.id}`]) assert.ok(LINE_BANK[context]?.length, context);
    assert.equal(BANTER[keeper.id].length, 2, keeper.id);
  }
  assert.equal(BANTER_COUNT, KEEPERS.length * 2);
});

test("line ids resolve back to their templates", () => {
  assert.equal(lineTemplate("goal#0"), LINE_BANK.goal[0]);
  assert.equal(lineTemplate("banter:sumo#1:1"), BANTER.sumo[1][1]);
  assert.equal(lineTemplate("nope#3"), null);
  assert.equal(lineTemplate("goal"), null);
});

test("picks never repeat within 60 s or the last 40 lines (simulated sessions)", () => {
  for (const [seed, secondsPerKick] of [[1, 12], [2, 6], [3, 20], [4, 3]] as const) {
    const { steps } = simulate({ seed, kicks: 150, secondsPerKick, stadium: seed % 2 ? "park" : "pro", keeper: "sumo" });
    const said: { id: string; at: number }[] = [];
    for (const step of steps) for (const [beat, at] of [[step.session, (step.facts.now ?? 0) - secondsPerKick / 2], [step.before, (step.facts.now ?? 0) - secondsPerKick / 2], [step.after, step.facts.now ?? 0]] as const) {
      if (!beat) continue;
      for (const line of [...beat.lines, ...beat.moments.flatMap(m => m.lines)]) {
        const recent = said.slice(-REPEAT_LINES);
        assert.ok(!recent.some(s => s.id === line.id), `seed ${seed}: ${line.id} repeated within ${REPEAT_LINES} lines`);
        assert.ok(!said.some(s => s.id === line.id && at - s.at < REPEAT_SECONDS), `seed ${seed}: ${line.id} repeated within ${REPEAT_SECONDS} s`);
        said.push({ id: line.id, at });
      }
    }
  }
});

test("the picker falls back from specific to general, and stays quiet rather than repeat", () => {
  const c = new Commentator(), rng = new Rng(5), names = { friend: "F", keeper: "K", number: "7" };
  const a = c.pick(["goal:vs:sloth", "goal"], rng, names, 0)!;
  assert.equal(a.context, "goal:vs:sloth");
  const b = c.pick(["goal:vs:sloth", "goal"], rng, names, 1)!;
  assert.equal(b.context, "goal");
  assert.equal(c.pick(["goal:vs:sloth"], rng, names, 2), null);
  assert.equal(c.pick(["goal:vs:sloth"], rng, names, 3, true)!.id, "goal:vs:sloth#0");
  assert.equal(c.pick(["no-such-context"], rng, names, 4, true), null);
});
