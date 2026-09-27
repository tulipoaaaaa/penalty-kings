import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "@penalty-kings/engine";
import { FIRST_SESSION, FIRST_UNLOCK, bestGoal } from "../../games/penalty-kings/game/firstsession.ts";
import { commentaryContexts } from "../../games/penalty-kings/gfx/commentary.ts";

test("first session: easy Squeak with assist, Chroma surprise, net-cam replay; skill layer only", () => {
  assert.equal(FIRST_SESSION.length, 3);
  assert.equal(FIRST_SESSION[0].keeper, "mouse"); assert.ok(FIRST_SESSION[0].assist >= 0.8 && FIRST_SESSION[0].bigCelebration);
  assert.ok(FIRST_SESSION[1].surprise && FIRST_SESSION[1].keeper === "chameleon");
  assert.ok(FIRST_SESSION[2].replayBest);
  for (const kick of FIRST_SESSION) { assert.ok(KEEPERS.some(k => k.id === kick.keeper)); assert.ok(commentaryContexts().includes(kick.intro), kick.intro); }
  for (const key of Object.keys(FIRST_SESSION[0])) assert.ok(!/rf|rarity|odds|prize|ball/i.test(key), key);
  assert.ok(KEEPERS.some(k => k.id === FIRST_UNLOCK.keeper));
  assert.equal(bestGoal([{ result: "goal", points: 100 }, { result: "save", points: 0 }, { result: "goal", points: 300 }])?.points, 300);
  assert.equal(bestGoal([{ result: "save", points: 0 }]), null);
});
