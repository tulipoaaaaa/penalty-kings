import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShot, keeperById } from "../../packages/engine/src/index.ts";
import { createReferee, memoryStore, diveSeed, replayEntry, secretHash, entryMessage, HOUR, RefereeError, type Chain } from "../src/core.ts";

const OWNER = "0x00000000000000000000000000000000000000aa";
const secret = crypto.getRandomValues(new Uint8Array(32));
const chain = (overrides: Partial<{ owner: string; generation: number; valid: boolean }> = {}): Chain => ({
  async friend() { return { owner: overrides.owner ?? OWNER, generation: overrides.generation ?? 6 }; },
  async verifySignature(owner, message, signature) { return (overrides.valid ?? true) && signature === `signed:${owner}:${message}`; },
});
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
function referee(options: { chain?: Chain; now?: () => number; store?: ReturnType<typeof memoryStore> } = {}) {
  return createReferee({ secret, week: 1, store: options.store ?? memoryStore(), chain: options.chain ?? chain(), signingKey: keys.privateKey, now: options.now });
}
const enterBody = (friendId = "7730", nonce = "n1") => ({ friendId, owner: OWNER, nonce, signature: `signed:${OWNER}:${entryMessage(1, friendId, nonce)}` });
const kickInput = (i: number) => ({ aimX: [0.8, -0.8, 0.7, -0.6, 0.9][i], loft: 0, power: 0.8, curl: 0, releaseMs: 900 });

test("server replay matches the client engine bit-for-bit", async () => {
  const ref = referee();
  const { entryId } = await ref.enter(enterBody());
  for (let i = 0; i < 5; i++) {
    const response = await ref.kick({ entryId, kickIndex: i, input: kickInput(i) });
    const seed = await diveSeed(secret, entryId, i);
    const local = resolveShot(kickInput(i), keeperById("ghost"), seed);
    assert.equal(response.result, local.result);
    assert.deepEqual(response.dive, { x: local.plan.x, y: local.plan.y });
  }
  const replay = await replayEntry(secret, entryId, [0, 1, 2, 3, 4].map(kickInput));
  const final = await ref.kick({ entryId, kickIndex: 5, input: kickInput(0) }).catch(error => error);
  assert.ok(final instanceof RefereeError && final.status === 409, "no sixth kick");
  assert.ok(replay.score >= 0 && replay.results.length === 5);
});

test("the result is signed and verifiable with the published key", async () => {
  const ref = referee();
  const { entryId } = await ref.enter(enterBody());
  let last: Awaited<ReturnType<typeof ref.kick>> | undefined;
  for (let i = 0; i < 5; i++) last = await ref.kick({ entryId, kickIndex: i, input: kickInput(i) });
  assert.ok(last?.signed);
  const signature = Uint8Array.from(last!.signed!.signature.match(/../g)!.map(b => parseInt(b, 16)));
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, signature, new TextEncoder().encode(last!.signed!.payload));
  assert.ok(ok);
  const payload = JSON.parse(last!.signed!.payload);
  assert.equal(payload.score, last!.score);
  // A forged payload claiming more goals fails verification.
  const forged = JSON.stringify({ ...payload, score: payload.score + 1000, kicks: ["goal", "goal", "goal", "goal", "goal"] });
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, signature, new TextEncoder().encode(forged)), false);
});

test("a client cannot claim a goal: results come only from the referee's resolution", async () => {
  const ref = referee();
  const { entryId } = await ref.enter(enterBody());
  // Extra fields (e.g. a claimed result) are ignored; wide/over inputs stay misses.
  const response = await ref.kick({ entryId, kickIndex: 0, input: { aimX: 1.6, loft: 0.3, power: 1, curl: 1, releaseMs: 1, result: "goal", points: 9999 } as never });
  assert.notEqual(response.result, "goal");
  assert.equal(response.points, 0);
  await assert.rejects(ref.kick({ entryId, kickIndex: 1, input: { aimX: Number.NaN, loft: 0, power: 0.8, curl: 0, releaseMs: 1 } }), /finite/);
  await assert.rejects(ref.kick({ entryId, kickIndex: 3, input: kickInput(1) }), /Expected kick 1/);
});

test("a dive cannot be predicted before commit: it depends on the unpublished secret", async () => {
  const other = crypto.getRandomValues(new Uint8Array(32));
  const seeds = new Set<number>();
  for (let i = 0; i < 5; i++) seeds.add(await diveSeed(secret, 1, i));
  assert.equal(seeds.size, 5, "per-kick seeds differ");
  let differ = 0;
  for (let i = 0; i < 20; i++) if ((await diveSeed(secret, 1, i)) !== (await diveSeed(other, 1, i))) differ++;
  assert.equal(differ, 20, "a different secret gives different dives");
  const ref = referee();
  const entered = await ref.enter(enterBody());
  assert.deepEqual(Object.keys(entered).sort(), ["entryId", "secretHash", "week"], "entry reveals only the secret's hash");
  assert.equal(entered.secretHash, await secretHash(secret));
});

test("ownership, generation and signature are enforced", async () => {
  await assert.rejects(referee({ chain: chain({ owner: "0x00000000000000000000000000000000000000bb" }) }).enter(enterBody()), /does not own/);
  await assert.rejects(referee({ chain: chain({ generation: 0 }) }).enter(enterBody()), /hardwired/);
  await assert.rejects(referee({ chain: chain({ valid: false }) }).enter(enterBody()), /Signature/);
  await assert.rejects(referee().enter({ ...enterBody(), signature: "signed:someone-else" }), /Signature/);
});

test("rate limits hold: one per Friend per hour, 20 per week", async () => {
  let clock = 1_000_000;
  const store = memoryStore();
  const ref = referee({ store, now: () => clock });
  await ref.enter(enterBody("1", "a"));
  await assert.rejects(ref.enter(enterBody("1", "b")), /per hour/);
  await ref.enter(enterBody("2", "c")); // other Friends are unaffected
  for (let i = 0; i < 19; i++) { clock += HOUR; await ref.enter(enterBody("1", `x${i}`)); }
  clock += HOUR;
  await assert.rejects(ref.enter(enterBody("1", "last")), /Weekly limit/);
});
