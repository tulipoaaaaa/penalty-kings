// FD-3b: the waits for randomness. The penalty and pack flows driven with simulated 0 / 5 / 15 s beacons
// (mocked timers): the beacon is requested only AFTER the shot commitment exists, the outcome is exactly
// resolveShot(shot, keeper, keeperSeed(beacon, commitment)), 0 s adds no timer, and a cancelled wait never scores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShot, keeperById, type ShotInput } from "@penalty-kings/engine";
import { commitShot, keeperSeed, simulatedBeacon, type RandomnessSource, type RollKind, type Hex32 } from "../../games/penalty-kings/game/randomness.ts";
import { rollKeeper, usesBeacon, isAbort, packCommitment, packRevealSequence, waitCue, WAIT_GRACE_MS } from "../../games/penalty-kings/game/suspense.ts";
import { revealPlan } from "../../games/penalty-kings/game/reveal.ts";

const shot: ShotInput = { aimX: 0.72, aimY: 0.55, power: 0.66, curl: 0.2 };
const ctx = { friendId: "336583", sessionId: "4242", kickIndex: 3 };

/** A simulated beacon that records the order of events (commit → request → answer). */
function spy(ms: number, events: string[]) {
  const inner = simulatedBeacon(ms);
  const calls: { kind: RollKind; commitment: Hex32 }[] = [];
  const source: RandomnessSource = {
    expectedWaitMs: () => inner.expectedWaitMs(),
    next: (kind, commitment, signal) => { events.push("beacon-requested"); calls.push({ kind, commitment }); return inner.next(kind, commitment, signal).then(beacon => { events.push("beacon-landed"); return beacon; }); },
  };
  return { source, calls };
}
/** Let the (real) WebCrypto hashing finish without advancing the mocked clock. */
const settle = async (until: () => boolean = () => false) => { for (let i = 0; i < 2000 && !until(); i++) await new Promise(resolve => setImmediate(resolve)); };

test("penalty roll at 0 / 5 / 15 s: commitment first, then the beacon; the outcome is resolveShot(shot, keeper, keeperSeed(beacon, commitment))", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const keeper = keeperById("peacock");
  for (const ms of [0, 5000, 15000]) {
    const events: string[] = [];
    const { source, calls } = spy(ms, events);
    let committed: Hex32 | null = null, done = false;
    const pending = rollKeeper(shot, ctx, source, undefined, commitment => { committed = commitment; events.push("committed"); }).then(roll => { done = true; events.push("resolved"); return roll; });
    await settle(() => events.includes("beacon-requested") && (ms > 0 || done));
    // The beacon request carries the commitment, and happens only after it exists.
    assert.deepEqual(events.slice(0, 2), ["committed", "beacon-requested"], `${ms} ms: commit before the beacon request`);
    assert.equal(calls.length, 1); assert.equal(calls[0].kind, "penalty");
    assert.equal(calls[0].commitment, committed); assert.equal(committed, await commitShot(shot, ctx), "the commitment is commitShot(shot, context)");
    if (ms > 0) {
      assert.equal(done, false, `${ms} ms: the keeper has not decided before the beacon`);
      t.mock.timers.tick(ms - 1); await settle();
      assert.equal(done, false, `${ms} ms: still waiting 1 ms before the beacon`);
      t.mock.timers.tick(1);
    }
    const roll = await pending;
    assert.equal(roll.commitment, committed);
    assert.equal(roll.seed, await keeperSeed(roll.beacon, roll.commitment));
    const outcome = resolveShot(shot, keeper, roll.seed, { kickIndex: ctx.kickIndex, history: [] });
    assert.deepEqual(outcome, resolveShot(shot, keeper, await keeperSeed(roll.beacon, await commitShot(shot, ctx)), { kickIndex: ctx.kickIndex, history: [] }), "replayable from (shot, beacon)");
    assert.deepEqual(events, ["committed", "beacon-requested", "beacon-landed", "resolved"]);
  }
  t.mock.timers.reset();
});

test("0 s adds no delay: no timer is armed, the roll lands after the hashing alone", async (t) => {
  const timers = t.mock.method(globalThis, "setTimeout");
  const started = performance.now();
  const roll = await rollKeeper(shot, ctx, simulatedBeacon(0));
  const pack = await simulatedBeacon(0).next("pack", await packCommitment(["1", "2"], { friendId: "336583" }));
  assert.equal(timers.mock.callCount(), 0, "no setTimeout on the instant path (penalty and pack)");
  assert.ok(performance.now() - started < 1000, "no waiting beyond the hashing");
  assert.match(roll.beacon.value, /^0x[0-9a-f]{64}$/); assert.match(pack.value, /^0x[0-9a-f]{64}$/);
  // The Stage's wait never shows for an instant roll (the grace window), and a 0 s pack reveal needs no ceremony wait.
  assert.equal(waitCue(0, 0).visible, false); assert.equal(waitCue(WAIT_GRACE_MS - 1, 0).visible, false);
});

test("a cancelled wait never scores (5 s and 15 s, aborted mid-wait; the beacon timer is cleared)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const ms of [5000, 15000]) {
    const controller = new AbortController();
    let scored = 0, requested = false;
    const pending = rollKeeper(shot, ctx, simulatedBeacon(ms), controller.signal, () => { requested = true; })
      .then(() => { scored++; }, error => { assert.ok(isAbort(error), "rejects with AbortError"); });
    await settle(() => requested);
    assert.equal(requested, true);
    t.mock.timers.tick(ms / 2);
    controller.abort(); // mode switch, pause or redeem
    await pending;
    t.mock.timers.tick(ms * 2); await settle();
    assert.equal(scored, 0, `${ms} ms: nothing scored after the abort`);
  }
  // Aborted before the commitment even finishes: the beacon is never requested.
  const controller = new AbortController(); let requested = false;
  const early = rollKeeper(shot, ctx, { expectedWaitMs: () => 0, next: () => { requested = true; return Promise.reject(new Error("must not be asked")); } }, controller.signal);
  controller.abort();
  await assert.rejects(early, error => isAbort(error));
  assert.equal(requested, false);
  t.mock.timers.reset();
});

test("only free play penalties and the Big Match use the beacon; the Skill Cup, tutorial, tour and daily keep their seeds", () => {
  assert.ok(usesBeacon("penalties")); assert.ok(usesBeacon("match"));
  for (const mode of ["skill", "tutorial", "tour", "daily", "freekicks", "target"]) assert.equal(usesBeacon(mode), false, mode);
});

test("pack flow at 0 / 5 / 15 s: sealed until the (simulated) roll lands, then lowest → highest with a sting before the best", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settled = [3, 0, 6, 1, 0];
  for (const ms of [0, 5000, 15000]) {
    const commitment = await packCommitment(["11", "12", "13", "14", "15"], { friendId: "336583" });
    let landed = false;
    const beacon = simulatedBeacon(ms).next("pack", commitment).then(value => { landed = true; return value; });
    if (ms > 0) { await settle(); assert.equal(landed, false, "sealed while waiting"); t.mock.timers.tick(ms); }
    await beacon;
    const plan = packRevealSequence(settled, ms);
    assert.deepEqual(plan.steps.map(step => step.index), [1, 4, 3, 0, 2], "lowest to highest, ties in card order");
    plan.steps.forEach(step => assert.equal(step.shows, settled[step.index], "every step shows its settled rarity"));
    assert.deepEqual(plan.steps.map(step => step.best), [false, false, false, false, true]);
    for (let i = 1; i < plan.steps.length; i++) assert.ok(plan.steps[i].at > plan.steps[i - 1].at && plan.steps[i].shows >= plan.steps[i - 1].shows);
    assert.ok(plan.stingAt !== null && plan.stingAt < plan.steps[4].at && plan.stingAt > plan.steps[3].at, "the sting sits between the last lower ball and the best");
    assert.equal(plan.stingLevel, 6, "the sting follows the TRUE best rarity");
    // The best ball's Stage reveal is the settled outcome's revealPlan (a Golden Boot keeps its full-screen moment).
    const best = revealPlan(plan.steps[4].shows + 1);
    assert.equal(best.fullScreen, true); assert.ok(best.beats.every(beat => beat.shows === 6));
  }
  t.mock.timers.reset();
  // A longer wait only lengthens the ceremony a little; the order and what shows never change.
  const quick = packRevealSequence(settled, 0), slow = packRevealSequence(settled, 15000);
  assert.deepEqual(quick.steps.map(s => [s.index, s.shows]), slow.steps.map(s => [s.index, s.shows]));
  assert.ok(slow.total > quick.total && slow.total < 6000);
  // One ball: the sting, then the ball. Invalid rarities are refused (never invent an outcome).
  const one = packRevealSequence([2]);
  assert.equal(one.steps.length, 1); assert.equal(one.steps[0].best, true); assert.ok(one.stingAt !== null && one.stingAt < one.steps[0].at);
  assert.throws(() => packRevealSequence([7])); assert.throws(() => packRevealSequence([1.5]));
  assert.deepEqual(packRevealSequence([]).steps, []);
});

test("wait pacing follows suspenseBeats: under 5 s drums; 5 s and 15 s add mind-games, the hush and 'deciding'; the meter never fills early", () => {
  const short = [1000, 2500, 2900].map(ms => waitCue(ms, 3000));
  assert.ok(short.every(cue => cue.visible && !cue.mindGames), "3 s: warm-up + drumroll, no mind-games");
  assert.ok(short[1].drumroll > 0);
  const five = (ms: number) => waitCue(ms, 5000);
  assert.equal(five(1200).mindGames, true, "5 s: the full show (suspenseBeats(5000) includes mind-games)");
  assert.ok(five(2500).drumroll > 0); assert.equal(five(4200).hush, true);
  const fifteen = (ms: number) => waitCue(ms, 15000);
  assert.equal(fifteen(1000).mindGames, true);
  assert.equal(fifteen(1000).deciding, false); assert.equal(fifteen(2000).deciding, true);
  assert.equal(fifteen(6000).hush, false); assert.equal(fifteen(13000).hush, true);
  assert.ok(fifteen(13000).drumroll > fifteen(6000).drumroll);
  for (const ms of [500, 5000, 14999, 30000]) assert.ok((fifteen(ms).meter ?? 0) < 1, "the meter never claims the beacon has landed");
  assert.ok(fifteen(10000).warm > fifteen(2000).warm, "the glow grows with the wait");
  // A beacon expected instantly but running late upgrades itself to the full show.
  assert.equal(waitCue(3000, 0).visible, true); assert.equal(waitCue(6000, 0).mindGames, true);
});
