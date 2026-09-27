import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "@penalty-kings/engine";
import { MONTAGE, MONTAGE_SECONDS, ATTRACT_SECONDS, BEAT, cutAt } from "../../games/penalty-kings/gfx/showreel.ts";

test("cold open: 20–30 s, quick beat-synced cuts, all stadiums, many keepers, ends on the Friend", () => {
  assert.ok(MONTAGE_SECONDS >= 20 && MONTAGE_SECONDS <= 30, `${MONTAGE_SECONDS.toFixed(1)} s`);
  for (const cut of MONTAGE) { assert.ok(Number.isInteger(cut.beats) && cut.beats >= 2 && cut.beats * BEAT <= 3.6, `cut ${cut.kind}: ${cut.beats} beats`); assert.ok(KEEPERS.some(k => k.id === cut.keeper), cut.keeper); }
  assert.deepEqual(new Set(MONTAGE.map(c => c.stadium)), new Set(["park", "pro", "champions"]));
  assert.ok(new Set(MONTAGE.map(c => c.keeper)).size >= 8);
  assert.equal(MONTAGE[0].kind, "logo", "opens on the logo slam");
  assert.ok(MONTAGE.filter(c => c.kind === "signature").length >= 4, "keeper signature moves");
  for (const kind of ["reveal", "commentator", "stadium"]) assert.ok(MONTAGE.some(c => c.kind === kind), kind);
  for (const cut of MONTAGE) assert.ok(cut.caption || cut.title, "captions always on");
  assert.ok(ATTRACT_SECONDS >= 8 && ATTRACT_SECONDS <= 12, `attract ${ATTRACT_SECONDS.toFixed(1)} s`);
  assert.equal(MONTAGE[MONTAGE.length - 1].kind, "friend", "ends on the player's Friend");
  assert.ok(MONTAGE.filter(c => c.push).length >= 3, "camera push-ins");
  assert.match(MONTAGE[MONTAGE.length - 1].title ?? "", /TAP TO PLAY/);
  // Honesty: the reveal cut is labelled as an example.
  for (const cut of MONTAGE.filter(c => c.kind === "reveal")) assert.match(cut.title ?? "", /example/i);
});

test("cutAt walks the montage in order and loops", () => {
  assert.equal(cutAt(0).index, 0);
  assert.equal(cutAt(MONTAGE[0].beats * BEAT + 0.01).index, 1);
  assert.equal(cutAt(MONTAGE_SECONDS + 0.01).index, 0);
  assert.ok(cutAt(1).progress > 0 && cutAt(1).progress < 1);
});

test("ReelPlayer drives the stage cut by cut, ends once (no loop), and reduced motion is a calm slideshow", async () => {
  const { ReelPlayer, findShot, reelKeepersValid } = await import("../../games/penalty-kings/gfx/reelplayer.ts");
  const { MONTAGE: reel } = await import("../../games/penalty-kings/gfx/showreel.ts");
  assert.ok(reelKeepersValid(reel));
  const calls: string[] = [];
  const fake = (reduced: boolean) => ({
    stadium: "park", weather: "sun", keeper: "mouse", kind: "penalty", freeKick: null, cue: null, busy: false, reduced, camera: { targetZoom: 1 },
    setStadium(id: string) { this.stadium = id; calls.push(`stadium:${id}`); }, say(ctx: string) { calls.push(`say:${ctx}`); }, taunt() { calls.push("taunt"); },
    play() { calls.push("play"); }, walkout() { calls.push("walkout"); }, wave() { calls.push("wave"); }, showReveal() { calls.push("reveal"); },
    startCelebration() {}, cancel() {},
  });
  const stage = fake(false);
  const cuts: number[] = [];
  const player = new ReelPlayer(stage as never, reel, { loop: false, friendName: "Friend #1", onCut: (_c, i) => cuts.push(i) });
  for (let t = 0; t < 40; t += 0.05) player.update(0.05);
  assert.deepEqual(cuts, reel.map((_, i) => i), "every cut, in order, once");
  assert.ok(player.done);
  for (const want of ["reveal", "walkout", "play", "taunt", "stadium:pro", "stadium:champions"]) assert.ok(calls.includes(want), want);
  calls.length = 0;
  const calm = new ReelPlayer(fake(true) as never, reel, { loop: false, friendName: "F" });
  for (let t = 0; t < 40; t += 0.05) calm.update(0.05);
  assert.ok(!calls.includes("play") && !calls.includes("reveal"), "reduced motion: no shots or reveal flashes");
  assert.ok(findShot("mouse", "goal"), "engine finds a skill goal");
});
