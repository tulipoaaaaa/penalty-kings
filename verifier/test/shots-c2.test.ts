// C2: the Skill Cup referee applies the PERFECT strike, the streak table and the shot clock exactly as the game does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShot, keeperById, shotTarget, goalPoints, isPerfectStrike, streakMultiplier, shotClockSeconds, NEUTRAL, ZONE_MULT, POST_IN_BONUS } from "../../packages/engine/src/index.ts";
import { createReferee, memoryStore, diveSeed, replayEntry, scoreKick, SKILL_KEEPER, SKILL_SHOT_CLOCK_S, type Chain } from "../src/core.ts";

const secret = crypto.getRandomValues(new Uint8Array(32));
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const chain: Chain = { async entryFromTx(hash) { return { entryId: parseInt(hash, 16), friendId: "7730", player: "0x00000000000000000000000000000000000000aa", week: 1 }; } };
const hashFor = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

test("PERFECT strikes: the referee flags them and resolves them bit-for-bit like the client (faster ball included)", async () => {
  const ref = createReferee({ secret, week: 1, store: memoryStore(), chain, signingKey: keys.privateKey });
  const { entryId } = await ref.enter({ txHash: hashFor(41) });
  const inputs = [0.8, 0.7, 0.76, 0.84, 0.9].map((power, i) => ({ aimX: [0.8, -0.75, 0.6, -0.85, 0.7][i], aimY: 0.6, power, curl: 0, releaseMs: 800 }));
  for (let i = 0; i < 5; i++) {
    const response = await ref.kick({ entryId, kickIndex: i, input: inputs[i] });
    const local = resolveShot(inputs[i], keeperById("finalwall"), await diveSeed(secret, entryId, i), { kickIndex: i, history: inputs.slice(0, i).map(shot => shotTarget(shot).x) });
    assert.equal(response.result, local.result);
    assert.equal(response.perfect, isPerfectStrike(inputs[i].power), `kick ${i} perfect flag`);
  }
  const replay = await replayEntry(secret, entryId, inputs);
  assert.equal((await ref.leaderboard())[0].score, replay.score, "the public replay reproduces the score with perfect strikes in it");
  assert.deepEqual(replay.perfect, [true, false, true, true, false]);
});

test("streak table in the referee: x1.2 on the 3rd goal in a row, x1.5 on the 5th (points only)", () => {
  // Find seeds where the boss is beaten, then score the same goal at each streak position.
  let checked = 0;
  for (let seed = 0; seed < 400 && checked < 5; seed++) {
    const input = { aimX: 0.85, aimY: 0.85, power: 0.8, curl: 0 };
    const first = scoreKick(input, seed, 0, 4, []);
    if (first.result !== "goal") continue;
    const outcome = resolveShot(input, SKILL_KEEPER, seed, { kickIndex: 4, history: [] });
    const base = 100 * SKILL_KEEPER.mult * ZONE_MULT[outcome.zone] * (outcome.postIn ? POST_IN_BONUS : 1);
    for (const [goalsBefore, mult] of [[0, 1], [1, 1], [2, 1.2], [3, 1.2], [4, 1.5]] as const) {
      const scored = scoreKick(input, seed, goalsBefore, 4, []);
      assert.equal(scored.points, Math.round(base * mult), `seed ${seed}, streak ${goalsBefore + 1}`);
      assert.equal(scored.points, goalPoints(SKILL_KEEPER, 1, goalsBefore + 1, false, outcome.zone, outcome.postIn));
      assert.equal(streakMultiplier(goalsBefore + 1), mult);
    }
    checked++;
  }
  assert.ok(checked >= 3, `found ${checked} goals to check`);
});

test("Skill Cup shot clock: 6 s, the engine's NEUTRAL penalty clock (the game shows the same)", () => {
  assert.equal(SKILL_SHOT_CLOCK_S, 6);
  assert.equal(SKILL_SHOT_CLOCK_S, shotClockSeconds(NEUTRAL, "penalty"));
});
