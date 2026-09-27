import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, NEUTRAL, resolveShot, resolveFreeKick, freeKickSetup, kickSeed, prng, keeperById, type ShotOutcome } from "@penalty-kings/engine";
import { Stage } from "../../games/penalty-kings/gfx/stage.ts";

// C2 instant replay: a 1.5 s slow-mo net-cam re-play of a great goal. It is a Stage moment (no shooting) for at
// most its length in real time, a tap skips it, it never emits strike/resolved/done, and the live scene
// (keeper, kind, free-kick setup) comes back exactly as it was.

function goal(): ShotOutcome {
  const random = prng(0xc2), keeper = KEEPERS[0];
  for (let k = 0; k < 5000; k++) {
    const shot = { aimX: random() * 2 - 1, aimY: random() * 0.95, power: 0.35 + random() * 0.65, curl: 0 };
    const outcome = resolveShot(shot, keeper, kickSeed(k, 0, keeper.id), { kickIndex: 0, history: [] }, NEUTRAL);
    if (outcome.result === "goal") return outcome;
  }
  throw new Error("no goal found");
}
function stubDocument() {
  if ((globalThis as { document?: unknown }).document) return;
  const context: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : () => context), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

test("instant replay: a moment for 1.5 s of real time, no live events, then the live scene is back", () => {
  stubDocument();
  const stage = new Stage({ keeper: "robot" });
  const events: string[] = [];
  stage.onEvent = event => { if (event !== "sfx") events.push(event); };
  stage.instantReplay({ outcome: goal(), curl: 0, keeper: KEEPERS[0].id, label: "INSTANT REPLAY", seconds: 1.5 });
  assert.equal(stage.moment, true, "nothing can shoot during the replay");
  assert.equal(stage.keeper, KEEPERS[0].id, "the keeper who faced the kick is in goal");
  let t = 0;
  while (stage.replayingNow && t < 5) { stage.update(1 / 60); t += 1 / 60; }
  assert.ok(Math.abs(t - 1.5) < 0.05, `ended after ${t.toFixed(2)} s of real time`);
  assert.deepEqual(events, ["replay-done"], "no strike/resolved/done from a replay");
  assert.equal(stage.moment, false); assert.equal(stage.keeper, "robot"); assert.equal(stage.kind, "penalty"); assert.equal(stage.ballVisible, true);
});

test("instant replay: skipReplay() ends it at once; a free kick replays with its own setup and the live one comes back", () => {
  stubDocument();
  const stage = new Stage({ keeper: "mouse" });
  const live = freeKickSetup(5, { distance: 20 }), old = freeKickSetup(9, { distance: 30 });
  stage.kind = "freekick"; stage.freeKick = { setup: live, wall: resolveFreeKick(live, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeperById("mouse")).wall };
  const outcome = resolveFreeKick(old, { aimX: 0.7, lift: 0.4, power: 0.8, spin: 0.3, top: 0.4 }, keeperById("sloth"));
  let done = 0;
  stage.onEvent = event => { if (event === "replay-done") done++; };
  stage.instantReplay({ outcome: { result: "goal", target: outcome.target, plan: outcome.keeper, zone: outcome.zone, postIn: false }, curl: 0, keeper: "sloth", freeKick: { outcome, setup: old }, label: "INSTANT REPLAY", seconds: 1.5 });
  assert.equal(stage.freeKick?.setup, old, "the replayed kick's own setup");
  for (let i = 0; i < 10; i++) stage.update(1 / 60);
  stage.skipReplay();
  assert.equal(done, 1); assert.equal(stage.replayingNow, false); assert.equal(stage.moment, false);
  assert.equal(stage.freeKick?.setup, live, "the live setup is back"); assert.equal(stage.kind, "freekick"); assert.equal(stage.keeper, "mouse");
  stage.skipReplay(); assert.equal(done, 1, "skipping twice does nothing");
});
