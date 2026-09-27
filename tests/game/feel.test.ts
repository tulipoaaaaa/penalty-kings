import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, NEUTRAL, resolveShot, kickSeed, prng, type ShotOutcome } from "@penalty-kings/engine";
import { HIT_STOP, hitStopFor, shakeOffset, punchEnvelope, feverTier, feverStinger, SlowMoGate, slowMoRate, slowMoWindow, SLOWMO, isCloseCall, isFingertip, goalTrauma, CONFETTI } from "../../games/penalty-kings/gfx/feel.ts";
import { Camera } from "../../games/penalty-kings/gfx/core.ts";
import { Net, NET_TUNING } from "../../games/penalty-kings/gfx/net.ts";
import { Stage } from "../../games/penalty-kings/gfx/stage.ts";

// Part B game feel (B1 goal moment, B2 near-miss, B6 streak fever): the pure rules behind the juice.

test("hit-stop per event: 50 ms boot contact, 90 ms net, 120 ms post; all under 200 ms (longer reads as lag)", () => {
  assert.equal(hitStopFor("strike"), 0.05);
  assert.equal(hitStopFor("net"), 0.09);
  assert.equal(hitStopFor("post"), 0.12);
  for (const [event, seconds] of Object.entries(HIT_STOP)) assert.ok(seconds > 0 && seconds < 0.2, event);
  assert.ok(HIT_STOP.strike < HIT_STOP.net && HIT_STOP.net < HIT_STOP.post, "bigger moment, longer freeze");
});

test("shake: pixel-snapped, trauma² scaled, and off under reduced motion", () => {
  for (let t = 0; t < 3; t += 0.013) {
    const o = shakeOffset(0.9, t, false);
    assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y), "whole logical pixels");
    assert.ok(Math.abs(o.x) <= 5 && Math.abs(o.y) <= 4);
    assert.deepEqual(shakeOffset(1, t, true), { x: 0, y: 0 }, "reduced motion: no shake");
    assert.equal(Math.abs(shakeOffset(0.3, t, false).x) <= 1, true, "small trauma barely moves (trauma²)");
    assert.equal(shakeOffset(0.9, t, false, 0).y, 0, "a post shake can be horizontal only");
  }
  const cam = new Camera(); cam.reduced = true; cam.addTrauma(0.8); cam.punchAt(100, 100, 0.3);
  assert.equal(cam.trauma, 0, "reduced motion adds no trauma"); assert.equal(cam.punch, null, "and no zoom punch");
  assert.ok(goalTrauma(1, 3) > goalTrauma(0, 0), "a screamer on a streak shakes more than a tap-in");
});

test("zoom punch: rises in 80 ms, holds, eases back to nothing", () => {
  assert.equal(punchEnvelope(0, 0.8), 0); assert.equal(punchEnvelope(0.08, 0.8), 1); assert.equal(punchEnvelope(0.25, 0.8), 1);
  assert.ok(punchEnvelope(0.6, 0.8) < 0.5); assert.equal(punchEnvelope(0.8, 0.8), 0);
  const cam = new Camera(); cam.punchAt(300, 110, 0.22, 0.8);
  for (let i = 0; i < 60; i++) cam.update(1 / 60);
  assert.equal(cam.punch, null, "the punch ends");
});

test("fever tier from the game-owned streak: 3 / 5 / 10, stingers only on the step", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 10, 25].map(feverTier), [0, 0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual([2, 3, 4, 5, 6, 10, 11].map(feverStinger), [null, "stinger-3", null, "stinger-5", null, "stinger-10", null]);
});

test("slow-mo: at most 1 in any 3 kicks, never under reduced motion, 0.3× only on the last stretch", () => {
  const gate = new SlowMoGate(), used = Array.from({ length: 30 }, () => gate.allow(true, false));
  for (let i = 0; i + 3 <= used.length; i++) assert.ok(used.slice(i, i + 3).filter(Boolean).length <= 1, `window ${i}`);
  assert.equal(used.filter(Boolean).length, 10);
  const calm = new SlowMoGate();
  assert.equal(calm.allow(false, false), false, "no close call, no slow-mo");
  assert.equal(new SlowMoGate().allow(true, true), false, "reduced motion: never");
  assert.equal(slowMoRate(0.2, 0.45), 1); assert.equal(slowMoRate(0.45 - 0.05, 0.45), SLOWMO.rate); assert.equal(slowMoRate(0.45, 0.45), 1, "snaps back at impact");
  assert.ok(Math.abs(SLOWMO.window / SLOWMO.rate - 0.4) < 0.01, "≈ 400 ms of real time at most");
  for (let flight = 0.3; flight <= 0.95; flight += 0.05) { const w = slowMoWindow(flight); assert.ok(0.4 + HIT_STOP.strike + flight + w * (1 / SLOWMO.rate - 1) <= 1.15 + 1e-9 || w === 0, `release → result within budget at flight ${flight}`); }
  assert.ok(slowMoWindow(0.35) / SLOWMO.rate >= 0.35, "a rocket gets ~400 ms of slow-mo");
});

function outcomes(keeper = KEEPERS[1]) {
  const random = prng(0xfee1), list: ShotOutcome[] = [];
  for (let k = 0; k < 6000; k++) {
    const shot = { aimX: random() * 2.6 - 1.3, aimY: random() * 1.15, power: 0.3 + random() * 0.7, curl: random() * 2 - 1 };
    list.push(resolveShot(shot, keeper, kickSeed(k, 0, keeper.id), { kickIndex: k % 5, history: [] }, NEUTRAL));
  }
  return list;
}

test("close calls: every post is one, a fingertip is a glove save at the edge, plain goals and misses are not", () => {
  const keeper = KEEPERS[1], all = outcomes(keeper);
  for (const o of all.filter(o => o.result === "post")) assert.ok(isCloseCall(o, keeper.id));
  const gloves = all.filter(o => o.result === "save" && o.touch === "glove"), tips = gloves.filter(o => isFingertip(o, keeper.id));
  assert.ok(tips.length > 0 && tips.length < gloves.length, `fingertips ${tips.length} of ${gloves.length} glove saves`);
  assert.ok(all.filter(o => o.result !== "save").every(o => !isFingertip(o, keeper.id)));
  const close = all.filter(o => isCloseCall(o, keeper.id)).length;
  assert.ok(close < all.length * 0.5, `close calls are the exception (${close} of ${all.length})`);
});

test("net bulge: a goal peaks at 6–10 px and settles in 600–900 ms", () => {
  for (const [x, y, s] of [[240, 140, 1], [300, 110, 0.8], [170, 110, 1.1]]) {
    const net = new Net(); net.impulse(x, y, s);
    let peak = 0, settled = 0;
    for (let f = 0; f < 120; f++) { net.update(1 / 60); peak = Math.max(peak, net.peak); if (net.peak > 0.5) settled = (f + 1) / 60; }
    assert.ok(peak >= 6 && peak <= 10, `peak ${peak.toFixed(1)} px`);
    assert.ok(settled >= 0.6 && settled <= 0.9, `settled ${settled.toFixed(2)} s`);
  }
  assert.ok(NET_TUNING.damping > 0);
});

test("confetti tuned per stadium: Park modest < Pro floodlit < Champions gold", () => {
  assert.ok(CONFETTI.park.count < CONFETTI.pro.count && CONFETTI.pro.count < CONFETTI.champions.count);
  assert.equal(CONFETTI.park.glints, 0); assert.ok(CONFETTI.champions.glint.includes("#ffd23f"));
});

/** Headless canvas: the Crowd bakes sprites at construction; nothing here is drawn. */
function stubDocument() {
  if ((globalThis as { document?: unknown }).document) return;
  const context: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : () => context), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

test("Stage: sound contract names fire, the goal zooms IN, reduced motion has no shake or slow-mo", () => {
  stubDocument();
  const keeper = KEEPERS[1], all = outcomes(keeper);
  const goal = all.find(o => o.result === "goal")!, post = all.find(o => o.result === "post")!;
  const run = (reduced: boolean, list: ShotOutcome[], streakFrom = 0) => {
    const stage = new Stage({ keeper: keeper.id }); stage.setReduced(reduced);
    const sfx: string[] = []; let run = streakFrom, maxZoom = 0, maxTrauma = 0, slowFrames = 0;
    stage.onEvent = (event, data) => { if (event === "resolved") { run = data === "goal" ? run + 1 : 0; stage.streak = run; } if (event === "sfx") sfx.push(String(data)); };
    for (const o of list) {
      stage.cancel(); stage.play(o, 0);
      for (let i = 0; i < 300 && stage.busy; i++) {
        const before = (stage as unknown as { modeTime: number }).modeTime; stage.update(1 / 60);
        const advanced = (stage as unknown as { modeTime: number }).modeTime - before;
        if (advanced > 0 && advanced < 1 / 60 * 0.5) slowFrames++;
        const p = stage.camera.punch; maxZoom = Math.max(maxZoom, p ? 1 + p.amount : 0); maxTrauma = Math.max(maxTrauma, stage.camera.trauma);
      }
    }
    return { sfx, maxZoom, maxTrauma, slowFrames };
  };
  const full = run(false, [goal, goal, post, goal], 1);
  for (const name of ["net-ripple", "clang", "so-close", "roar-swell"]) assert.ok(full.sfx.includes(name), name);
  assert.ok(full.maxZoom > 1.15, "the goal punches in on the net point");
  assert.ok(full.slowFrames > 0, "the post (a close call) earned slow-mo");
  const fever = run(false, [goal, goal], 8);
  assert.ok(fever.sfx.includes("stinger-10") && fever.sfx.includes("chant"), "10 in a row: stinger and chant");
  const still = run(true, [goal, post, goal], 1);
  assert.equal(still.maxTrauma, 0, "reduced: no shake"); assert.equal(still.maxZoom, 0, "reduced: no zoom punch"); assert.equal(still.slowFrames, 0, "reduced: no slow-mo");
});
