import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "@penalty-kings/engine";
import { FIRST_SESSION, FIRST_UNLOCK, bestGoal } from "../../games/penalty-kings/game/firstsession.ts";
import { readFileSync } from "node:fs";
import { commentary, commentaryContexts } from "../../games/penalty-kings/gfx/commentary.ts";

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

test("first session wiring (SIO-2): the shell follows the plan, assist is aim-only, the replay re-plays a stored outcome", () => {
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  // Aim assist comes from the plan for the tutorial and feeds only aimedShot (the reticle uses the same value).
  assert.match(index, /current\.mode === "tutorial"\s*\? FIRST_SESSION\[[^\]]+\]\.assist/);
  // The surprise keeper walks on after "Here comes trouble…"; the replay uses the stored engine outcome (no new resolveShot).
  const aim = index.slice(index.indexOf("function startAim("), index.indexOf("// ── Shooting"));
  assert.match(aim, /plan\.surprise/); assert.match(aim, /keeperWalkOn\(plan\.keeper\)/);
  const done = index.slice(index.indexOf("function onKickDone("), index.indexOf("function addXp("));
  assert.match(done, /bestGoal\(tutorialShots\.current\)/); assert.match(done, /\.replay\(best\.outcome, best\.curl, best\.keeper\)/);
  assert.doesNotMatch(done, /resolveShot|resolveFreeKick\(best/, "the replay never re-decides a kick");
  // The unlock card and teasers carry no money words; both teaser variants name Free Kicks.
  for (const [key, value] of Object.entries(FIRST_UNLOCK)) { assert.ok(!/rf|coin|gboot|prize|odds|\$/i.test(String(value)), `${key}: ${value}`); }
  assert.match(FIRST_UNLOCK.teaser, /Free Kicks/); assert.match(FIRST_UNLOCK.teaserOpen, /Free Kicks/);
  assert.match(commentary("first-walkout", { friend: "Friend #7", keeper: "Squeak" }), /Friend #7/, "the commentator introduces YOUR Friend");
});
