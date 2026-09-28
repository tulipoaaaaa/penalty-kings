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
  assert.ok(MONTAGE[0].beats * BEAT <= 1.5, "the logo slam is short");
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

test("B8: the cold open leads with a goal (logo → top-bin goal with the net-cam push → keepers) and a decluttered first 2 s", () => {
  assert.deepEqual(MONTAGE.map(c => c.kind), ["logo", "top-bin", "signature", "signature", "signature", "signature", "stadium", "goal", "signature", "reveal", "commentator", "friend"]);
  const starts = MONTAGE.map((_, i) => MONTAGE.slice(0, i).reduce((sum, c) => sum + c.beats * BEAT, 0));
  const firstGoal = MONTAGE.findIndex(c => c.kind === "goal" || c.kind === "top-bin");
  assert.ok(starts[firstGoal] <= 4, `first goal cut starts at ${starts[firstGoal].toFixed(2)} s`);
  assert.equal(MONTAGE[firstGoal].kind, "top-bin");
  assert.ok(MONTAGE[firstGoal].netcam, "the opening goal gets the net-cam push");
  assert.equal(cutAt(starts[firstGoal] + 0.01).cut.kind, "top-bin");
  // Keepers come right after the goal; the Final Wall is still the button before the reveal.
  assert.equal(MONTAGE[firstGoal + 1].kind, "signature");
  assert.equal(MONTAGE.findLast(c => c.kind === "signature")?.keeper, "finalwall");
  // First 2 s: at most two overlay texts per cut (the logo cut says no commentator line: see the ReelPlayer test).
  for (let i = 0; starts[i] < 2; i++) assert.ok(Number(Boolean(MONTAGE[i].title)) + Number(Boolean(MONTAGE[i].caption)) <= (MONTAGE[i].kind === "logo" ? 2 : 1), `cut ${i} text count`);
  // The logo never plays in Champions (its jumbotron spells PENALTY KINGS too).
  assert.notEqual(MONTAGE[0].stadium, "champions");
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
    stadium: "park", weather: "sun", keeper: "mouse", kind: "penalty", freeKick: null, cue: null, busy: false, reduced, camera: { targetZoom: 1, targetX: 240, targetY: 160, trauma: 0, addTrauma(amount: number) { this.trauma += amount; } },
    goalPoint(p: { x: number; y: number }) { return p; },
    setStadium(id: string) { this.stadium = id; calls.push(`stadium:${id}`); }, say(ctx: string) { calls.push(`say:${ctx}`); }, taunt() { calls.push("taunt"); },
    play() { calls.push("play"); }, walkout() { calls.push("walkout"); }, wave() { calls.push("wave"); }, showReveal() { calls.push("reveal"); },
    startCelebration() {}, cancel() {},
  });
  const stage = fake(false);
  const cuts: number[] = [];
  const player = new ReelPlayer(stage as never, reel, { loop: false, friendName: "Friend #1", onCut: (_c, i) => cuts.push(i) });
  const logoEnd = reel[0].beats * BEAT;
  for (let t = 0; t < logoEnd - 0.1; t += 0.05) player.update(0.05);
  assert.ok(!calls.some(c => c.startsWith("say:")), "no commentator line over the logo");
  assert.ok(stage.camera.trauma > 0, "the logo lands with a shake");
  for (let t = 0; t < 1.2; t += 0.05) player.update(0.05);
  assert.equal(player.current?.kind, "top-bin");
  assert.ok(calls.includes("play") && calls.includes("say:showreel"), "the goal cut plays a shot and welcomes");
  assert.ok(stage.camera.targetZoom >= 1.5, "net-cam push");
  for (let t = 0; t < 40; t += 0.05) player.update(0.05);
  assert.deepEqual(cuts, reel.map((_, i) => i), "every cut, in order, once");
  assert.ok(player.done);
  for (const want of ["reveal", "walkout", "play", "taunt", "stadium:pro", "stadium:champions"]) assert.ok(calls.includes(want), want);
  calls.length = 0;
  const still = fake(true), calm = new ReelPlayer(still as never, reel, { loop: false, friendName: "F" });
  for (let t = 0; t < 40; t += 0.05) calm.update(0.05);
  assert.equal(still.camera.targetZoom, 1, "reduced motion: no pushes");
  assert.equal(still.camera.trauma, 0, "reduced motion: no shake");
  assert.ok(!calls.includes("play") && !calls.includes("reveal"), "reduced motion: no shots or reveal flashes");
  assert.ok(calls.includes("taunt"), "reduced motion still introduces the keepers");
  assert.ok(findShot("mouse", "goal"), "engine finds a skill goal");
});

test("cut dissolve: every block covers at the start, clears by the end, and never re-covers", async () => {
  const { wipeCovered, wipeThreshold, WIPE_BLOCK, WIPE_SECONDS } = await import("../../games/penalty-kings/gfx/reelplayer.ts");
  const cols = Math.ceil(480 / WIPE_BLOCK), rows = Math.ceil(320 / WIPE_BLOCK);
  assert.ok(WIPE_SECONDS > 0 && WIPE_SECONDS < 0.4, "a quick cut, well inside the shortest (2-beat) cut");
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    const t = wipeThreshold(bx, by);
    assert.ok(t >= 0 && t < 1, `threshold ${bx},${by}`);
    assert.ok(wipeCovered(bx, by, 0), "all covered at k = 0");
    assert.ok(!wipeCovered(bx, by, 1), "all clear at k = 1");
    let was = true;
    for (let k = 0; k <= 1; k += 0.05) { const now = wipeCovered(bx, by, k); assert.ok(was || !now, "a cleared block stays clear"); was = now; }
  }
});

// Polish (cold open): the TOP BIN! title landed on the Pro crowd's pink "KINGS" banner (the net-cam push brings it to
// the top centre), and the keeper's raw "leg!" call-out showed on the pitch. The title now drops just below any crowd
// text banner it would cover (the Stage reports where it drew them), still above the crossbar; the reel turns the
// in-play call-outs off.
type Box = { x1: number; y1: number; x2: number; y2: number };
/** A 2D context that records fillText (with its font) and measures text as 0.6 em per character. */
function recorder() {
  const texts: Array<{ text: string; x: number; y: number; px: number; width: number }> = [];
  const state: Record<string, unknown> = { font: "10px monospace" };
  const px = () => Number(/(\d+)px/.exec(String(state.font))?.[1] ?? 10);
  const context: unknown = new Proxy({}, {
    get: (_t, key) => key === "fillText" ? (text: string, x: number, y: number) => { texts.push({ text, x, y, px: px(), width: text.length * px() * 0.6 }); }
      : key === "measureText" ? (text: string) => ({ width: text.length * px() * 0.6 })
      : key === "canvas" ? {} : typeof key === "string" && key in state ? state[key] : () => context,
    set: (_t, key, value) => { state[key as string] = value; return true; },
  });
  return { context: context as CanvasRenderingContext2D, texts };
}
const hits = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

test("cold open: the TOP BIN! title lands clear of the crowd's KINGS banner, above the crossbar, goal inside ~4 s", async () => {
  const { ReelPlayer, TITLE_Y } = await import("../../games/penalty-kings/gfx/reelplayer.ts");
  // Where the net-cam push put the KINGS banner in the audit frame (01-cold-t02500: screen 632-742 × 125-157 at 2×).
  const KINGS: Box = { x1: 236, y1: 62, x2: 291, y2: 79 };
  const titleBox = (crowdText: Box[]) => {
    const stage = {
      stadium: "park", weather: "sun", keeper: "mouse", kind: "penalty", freeKick: null, cue: null, busy: false, reduced: false, callouts: true, crowdText,
      camera: { targetZoom: 1, targetX: 240, targetY: 160, trauma: 0, addTrauma() {} }, goalPoint: (p: unknown) => p,
      setStadium(id: string) { this.stadium = id; }, say() {}, taunt() {}, play() {}, walkout() {}, wave() {}, showReveal() {}, startCelebration() {}, cancel() {},
    };
    const player = new ReelPlayer(stage as never, MONTAGE, { loop: false, friendName: "Friend #1" });
    const start = MONTAGE[0].beats * BEAT, top = MONTAGE[1];
    assert.equal(top.kind, "top-bin"); assert.ok(start + (top.titleAt ?? 0) <= 4, "the TOP BIN! payoff lands inside ~4 s");
    for (let t = 0; t < start + (top.titleAt ?? 0) + 0.6; t += 1 / 60) player.update(1 / 60);
    assert.equal(player.current?.kind, "top-bin");
    assert.equal(stage.callouts, false, "the reel turns the in-play call-outs (the raw \"leg!\") off");
    const { context, texts } = recorder();
    player.drawOverlay(context);
    const fills = texts.filter(t => t.text === "TOP BIN!");
    assert.ok(fills.length > 0, "the title is drawn");
    // Every fill (shadow, outline, face) and the accent rule 10–12 px under the baseline centre.
    const box = fills.reduce<Box>((b, t) => ({ x1: Math.min(b.x1, t.x - t.width / 2), y1: Math.min(b.y1, t.y - t.px / 2), x2: Math.max(b.x2, t.x + t.width / 2), y2: Math.max(b.y2, t.y + 13) }), { x1: 999, y1: 999, x2: -999, y2: -999 });
    return { box, y: fills[fills.length - 1].y };
  };
  assert.equal(titleBox([]).y, TITLE_Y, "nothing under it: the title keeps its place");
  const clear = titleBox([KINGS]);
  assert.ok(!hits(clear.box, KINGS), `TOP BIN! ${JSON.stringify(clear.box)} overlaps the KINGS banner ${JSON.stringify(KINGS)}`);
  assert.ok(clear.box.y2 <= 118, `the title stays above the net-cam crossbar (${clear.box.y2})`);
  // A banner off to the side does not move it.
  assert.equal(titleBox([{ x1: 380, y1: 62, x2: 440, y2: 79 }]).y, TITLE_Y);
});

test("cold open: no raw \"leg!\" call-out on the pitch while the reel plays (the live game keeps its telegraph)", async () => {
  const { KEEPERS: keepers, resolveShot, keeperById } = await import("@penalty-kings/engine");
  const { Stage } = await import("../../games/penalty-kings/gfx/stage.ts");
  if (!(globalThis as { document?: unknown }).document) {
    const stub: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : () => stub), set: () => true });
    (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => stub }) };
  }
  // A penalty the keeper saves with the trailing leg (the call-out's "LEG!" case; the leg is out, so "leg!" before).
  let found: { keeper: string; outcome: ReturnType<typeof resolveShot> } | null = null;
  for (const keeper of keepers) for (let i = 0; i < 3000 && !found; i++) {
    const shot = { aimX: (i % 21) / 10 - 1, aimY: ((i * 7) % 10) / 10, power: 0.4 + ((i * 3) % 7) / 10, curl: 0 };
    const outcome = resolveShot(shot, keeperById(keeper.id), i * 7919);
    if (outcome.result === "save" && outcome.touch === "leg") found = { keeper: keeper.id, outcome };
  }
  assert.ok(found, "a leg save exists");
  const callouts = (off: boolean) => {
    const stage = new Stage({ keeper: found!.keeper as never });
    if (off) (stage as unknown as { callouts: boolean }).callouts = false;
    stage.play(found!.outcome, 0);
    const { context, texts } = recorder();
    for (let t = 0; t < 2; t += 1 / 60) { stage.update(1 / 60); stage.render(context); }
    return texts.filter(t => /^leg!$/i.test(t.text)).length;
  };
  assert.ok(callouts(false) > 0, "the live game still telegraphs the trailing leg");
  assert.equal(callouts(true), 0, "with the call-outs off (the reel), no \"leg!\"");
});
