import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShot, keeperById } from "@penalty-kings/engine";
import { commitShot, keeperSeed, canonicalShot, simulatedBeacon, instantBeacon, packDraws, suspenseBeats } from "../../games/penalty-kings/game/randomness.ts";

const shot = { aimX: 0.61234567, aimY: 0.4, power: 0.7, curl: -0.1 };
const ctx = { friendId: "336583", sessionId: "s1", kickIndex: 2 };

test("roll 2: the shot is committed first; the beacon seeds only the keeper; replay is exact", async () => {
  const commitment = await commitShot(shot, ctx);
  assert.match(commitment, /^0x[0-9a-f]{64}$/);
  assert.equal(commitment, await commitShot({ ...shot, aimX: 0.61234999 }, ctx), "canonical 4-dp rounding: same bytes for the referee");
  assert.notEqual(commitment, await commitShot({ ...shot, aimX: 0.62 }, ctx));
  const beacon = { round: 7, value: `0x${"ab".repeat(32)}` as const };
  const seed = await keeperSeed(beacon, commitment);
  assert.equal(seed, await keeperSeed(beacon, commitment), "deterministic");
  const a = resolveShot(shot, keeperById("sloth"), seed), b = resolveShot(shot, keeperById("sloth"), seed);
  assert.deepEqual(a, b, "engine is deterministic from (input, seed): the referee can re-verify");
  assert.equal(canonicalShot(shot), '{"aimX":0.6123,"aimY":0.4,"power":0.7,"curl":-0.1}');
});

test("simulated beacon honours 0 / 5 / 15 s delays (timers mocked) and suspense scales with the wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const ms of [0, 5000, 15000]) {
    let done = false;
    const p = simulatedBeacon(ms).next("penalty", "0x00").then(b => { done = true; return b; });
    if (ms > 0) { await Promise.resolve(); assert.equal(done, false, `${ms} ms: not before the delay`); t.mock.timers.tick(ms); }
    const beacon = await p;
    assert.match(beacon.value, /^0x[0-9a-f]{64}$/);
  }
  t.mock.timers.reset();
  assert.deepEqual(suspenseBeats(0), ["payoff"]);
  assert.ok(suspenseBeats(5000).includes("drumroll"));
  assert.ok(suspenseBeats(15000).includes("mind-games"));
  assert.equal(instantBeacon.expectedWaitMs(), 0);
});

test("roll 1: one beacon gives independent per-ball draws in [0,1)", async () => {
  const draws = await packDraws({ round: 1, value: `0x${"12".repeat(32)}` }, "0x01", 5);
  assert.equal(draws.length, 5); assert.equal(new Set(draws).size, 5);
  for (const d of draws) assert.ok(d >= 0 && d < 1);
});
