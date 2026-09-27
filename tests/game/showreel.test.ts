import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "@penalty-kings/engine";
import { MONTAGE, MONTAGE_SECONDS, BEAT, cutAt } from "../../games/penalty-kings/gfx/showreel.ts";

test("showreel montage: 25–35 s, quick beat-synced cuts, all stadiums, many keepers, ends on the Friend", () => {
  assert.ok(MONTAGE_SECONDS >= 25 && MONTAGE_SECONDS <= 35, `${MONTAGE_SECONDS.toFixed(1)} s`);
  for (const cut of MONTAGE) { assert.ok(Number.isInteger(cut.beats) && cut.beats >= 2 && cut.beats * BEAT <= 3.6, `cut ${cut.kind}: ${cut.beats} beats`); assert.ok(KEEPERS.some(k => k.id === cut.keeper), cut.keeper); }
  assert.deepEqual(new Set(MONTAGE.map(c => c.stadium)), new Set(["park", "pro", "champions"]));
  assert.ok(new Set(MONTAGE.map(c => c.keeper)).size >= 8);
  for (const kind of ["goal", "save", "reveal", "freekick"]) assert.ok(MONTAGE.some(c => c.kind === kind), kind);
  assert.equal(MONTAGE[MONTAGE.length - 1].kind, "friend", "ends on the player's Friend");
  assert.ok(MONTAGE.filter(c => c.push).length >= 3, "camera push-ins");
  // Honesty: the reveal cut is labelled as an example.
  for (const cut of MONTAGE.filter(c => c.kind === "reveal")) assert.match(cut.title ?? "", /example/i);
});

test("cutAt walks the montage in order and loops", () => {
  assert.equal(cutAt(0).index, 0);
  assert.equal(cutAt(MONTAGE[0].beats * BEAT + 0.01).index, 1);
  assert.equal(cutAt(MONTAGE_SECONDS + 0.01).index, 0);
  assert.ok(cutAt(1).progress > 0 && cutAt(1).progress < 1);
});
