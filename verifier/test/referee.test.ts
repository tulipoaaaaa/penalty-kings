import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShot, keeperById } from "../../packages/engine/src/index.ts";
import { createReferee, memoryStore, diveSeed, replayEntry, secretHash, RefereeError, type Chain } from "../src/core.ts";

const secret = crypto.getRandomValues(new Uint8Array(32));
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const hashFor = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
/** Fake chain: tx hash n ↦ on-chain Entered(entryId n, friend 7730, week 1); hash 0 ↦ no entry. */
const chain = (week = 1): Chain => ({
  async entryFromTx(hash) { const n = parseInt(hash, 16); return n ? { entryId: n, friendId: "7730", player: "0x00000000000000000000000000000000000000aa", week } : null; },
});
const referee = (options: { chain?: Chain; store?: ReturnType<typeof memoryStore> } = {}) =>
  createReferee({ secret, week: 1, store: options.store ?? memoryStore(), chain: options.chain ?? chain(), signingKey: keys.privateKey });
const kickInput = (i: number) => ({ aimX: [0.8, -0.8, 0.7, -0.6, 0.9][i], loft: 0, power: 0.8, curl: 0, releaseMs: 900 });

test("server replay matches the client engine bit-for-bit", async () => {
  const ref = referee();
  const { entryId } = await ref.enter({ txHash: hashFor(1) });
  for (let i = 0; i < 5; i++) {
    const response = await ref.kick({ entryId, kickIndex: i, input: kickInput(i) });
    const local = resolveShot(kickInput(i), keeperById("ghost"), await diveSeed(secret, entryId, i));
    assert.equal(response.result, local.result);
    assert.deepEqual(response.dive, { x: local.plan.x, y: local.plan.y });
  }
  const replay = await replayEntry(secret, entryId, [0, 1, 2, 3, 4].map(kickInput));
  const board = await ref.leaderboard();
  assert.equal(board[0].score, replay.score, "public replay reproduces the referee's score");
  const sixth = await ref.kick({ entryId, kickIndex: 5, input: kickInput(0) }).catch(error => error);
  assert.ok(sixth instanceof RefereeError && sixth.status === 409, "no sixth kick");
});

test("the result is signed and verifiable with the published key; forged payloads fail", async () => {
  const ref = referee();
  const { entryId } = await ref.enter({ txHash: hashFor(2) });
  let last: Awaited<ReturnType<typeof ref.kick>> | undefined;
  for (let i = 0; i < 5; i++) last = await ref.kick({ entryId, kickIndex: i, input: kickInput(i) });
  const signature = Uint8Array.from(last!.signed!.signature.match(/../g)!.map(b => parseInt(b, 16)));
  const verify = (payload: string) => crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, signature, new TextEncoder().encode(payload));
  assert.ok(await verify(last!.signed!.payload));
  const payload = JSON.parse(last!.signed!.payload);
  assert.equal(await verify(JSON.stringify({ ...payload, score: payload.score + 1000, kicks: Array(5).fill("goal") })), false);
});

test("a client cannot claim a goal", async () => {
  const ref = referee();
  const { entryId } = await ref.enter({ txHash: hashFor(3) });
  const response = await ref.kick({ entryId, kickIndex: 0, input: { aimX: 1.6, loft: 0.3, power: 1, curl: 1, releaseMs: 1, result: "goal", points: 9999 } as never });
  assert.notEqual(response.result, "goal");
  assert.equal(response.points, 0);
  await assert.rejects(ref.kick({ entryId, kickIndex: 1, input: { aimX: Number.NaN, loft: 0, power: 0.8, curl: 0, releaseMs: 1 } }), /finite/);
  await assert.rejects(ref.kick({ entryId, kickIndex: 3, input: kickInput(1) }), /Expected kick 1/);
  await assert.rejects(ref.kick({ entryId: 999, kickIndex: 0, input: kickInput(0) }), /Unknown entry/);
});

test("a dive cannot be predicted before commit", async () => {
  const other = crypto.getRandomValues(new Uint8Array(32));
  const seeds = new Set<number>();
  for (let i = 0; i < 5; i++) seeds.add(await diveSeed(secret, 1, i));
  assert.equal(seeds.size, 5);
  let differ = 0;
  for (let i = 0; i < 20; i++) if ((await diveSeed(secret, 1, i)) !== (await diveSeed(other, 1, i))) differ++;
  assert.equal(differ, 20);
  const entered = await referee().enter({ txHash: hashFor(4) });
  assert.deepEqual(Object.keys(entered).sort(), ["entryId", "secretHash", "week"], "entry reveals only the secret's hash");
  assert.equal(entered.secretHash, await secretHash(secret));
});

test("only confirmed on-chain entries count, once, for the current week", async () => {
  const store = memoryStore();
  const ref = referee({ store });
  await assert.rejects(ref.enter({ txHash: "0x1234" }), /Invalid transaction/);
  await assert.rejects(ref.enter({ txHash: hashFor(0) }), /No confirmed SkillCup entry/);
  await ref.enter({ txHash: hashFor(5) });
  await assert.rejects(ref.enter({ txHash: hashFor(5) }), /already registered/);
  await assert.rejects(referee({ chain: chain(2) }).enter({ txHash: hashFor(6) }), /week 2/);
});

test("leaderboard: best score first, ties to the earlier entry", async () => {
  const ref = referee();
  for (const n of [7, 8]) {
    const { entryId } = await ref.enter({ txHash: hashFor(n) });
    for (let i = 0; i < 5; i++) await ref.kick({ entryId, kickIndex: i, input: { aimX: 1.6, loft: 0, power: 0.8, curl: 0, releaseMs: 1 } });
  }
  const board = await ref.leaderboard();
  assert.deepEqual(board.map(row => row.entryId), [7, 8], "equal scores: earlier on-chain entry wins");
});
