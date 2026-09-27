import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, NEUTRAL, resolveShot, kickSeed, prng, type ShotOutcome } from "@penalty-kings/engine";
import { Stage } from "../../games/penalty-kings/gfx/stage.ts";

// BQ-P1-1: the game owns the streak. The shell (index.tsx onResolved, practice/main.ts onResolved) sets
// scene.streak inside the Stage's synchronous "resolved" event; the Stage must not count on top of it,
// or "2 IN A ROW", the chant and the heat shimmer fire after ONE goal.

function findOutcome(result: ShotOutcome["result"]): ShotOutcome {
  const random = prng(0x5741), keeper = KEEPERS[0];
  for (let k = 0; k < 5000; k++) {
    const shot = { aimX: random() * 2 - 1, aimY: random() * 0.95, power: 0.35 + random() * 0.65, curl: 0 };
    const outcome = resolveShot(shot, keeper, kickSeed(k, 0, keeper.id), { kickIndex: 0, history: [] }, NEUTRAL);
    if (outcome.result === result) return outcome;
  }
  throw new Error(`no ${result} found`);
}

/** Headless canvas: the Crowd bakes sprites at construction; nothing here is drawn. */
function stubDocument() {
  if ((globalThis as { document?: unknown }).document) return;
  const context: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : () => context), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

test("Stage streak follows the game's goal run: goals 1, 2, 3 → streak 1, 2, 3; chant only from the 2nd goal", () => {
  stubDocument();
  const stage = new Stage({ keeper: KEEPERS[0].id });
  const goal = findOutcome("goal"), save = findOutcome("save");
  let goalRun = 0; const chants: number[] = [];
  stage.onEvent = (event, data) => {
    // What the shell does (index.tsx onResolved): the scoreboard's "N IN A ROW" counts real goals.
    if (event === "resolved") { goalRun = data === "goal" ? goalRun + 1 : 0; stage.streak = goalRun; }
    if (event === "sfx" && data === "chant") chants.push(goalRun);
  };
  const kick = (outcome: ShotOutcome) => { stage.cancel(); stage.play(outcome, 0); for (let i = 0; i < 240 && stage.busy; i++) stage.update(1 / 60); return stage.streak; };
  assert.deepEqual([kick(goal), kick(goal), kick(goal)], [1, 2, 3], "streak after goals 1, 2, 3");
  assert.deepEqual(chants, [2, 3], "the chant starts on the 2nd goal in a row");
  assert.equal(kick(save), 0, "a save ends the run");
  assert.equal(kick(goal), 1, "the next goal starts again at 1");
});
