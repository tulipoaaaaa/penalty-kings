import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { createReferee, memoryStore, type Chain } from "../src/core.ts";
import { rewardSigner } from "../src/index.ts";
import {
  REWARD_TYPES, REWARD_DOMAIN_NAME, REWARD_DOMAIN_VERSION, ENTRY_CAP_RF, STREAK_BONUS_RF, KIND_SKILL, KIND_STREAK,
  rewardDomain, rewardNonce, skillRewardRf, dayStreak, type RewardClaim,
} from "../src/rewards.ts";

const solidity = readFileSync(new URL("../../contracts/src/RewardsDistributor.sol", import.meta.url), "utf8");
const DISTRIBUTOR = "0x00000000000000000000000000000000000d1570" as const;
const RF = 10n ** 18n;

test("EIP-712 types and domain match RewardsDistributor.sol", () => {
  const typeString = `RewardClaim(${REWARD_TYPES.RewardClaim.map(f => `${f.type} ${f.name}`).join(",")})`;
  assert.ok(solidity.includes(`"${typeString}"`), `CLAIM_TYPEHASH string ${typeString}`);
  assert.ok(solidity.includes(`keccak256("${REWARD_DOMAIN_NAME}")`), "domain name");
  assert.ok(solidity.includes(`keccak256("${REWARD_DOMAIN_VERSION}")`), "domain version");
  assert.match(solidity, /ENTRY_CAP_BPS = 2_000;/);
  assert.match(solidity, /DAILY_CAP_RF = 3e18;/);
});

test("claims are signed with EIP-712 and recover to the reward signer; tampering fails", async () => {
  const signer = rewardSigner({ REWARD_KEY: generatePrivateKey(), REWARDS: DISTRIBUTOR, CHAIN_ID: "4663" })!;
  const claim: RewardClaim = { friendId: 7730n, entryId: 12n, kind: KIND_SKILL, rfValue: 3n * RF / 2n, nonce: rewardNonce(12, KIND_SKILL), deadline: 2_000_000_000n };
  const signature = await signer.sign(claim);
  const domain = rewardDomain(4663, DISTRIBUTOR);
  const recovered = await recoverTypedDataAddress({ domain, types: REWARD_TYPES, primaryType: "RewardClaim", message: claim, signature });
  assert.equal(recovered, signer.address);
  const forged = await recoverTypedDataAddress({ domain, types: REWARD_TYPES, primaryType: "RewardClaim", message: { ...claim, rfValue: 2n * RF }, signature });
  assert.notEqual(forged, signer.address);
  const otherChain = await recoverTypedDataAddress({ domain: rewardDomain(1, DISTRIBUTOR), types: REWARD_TYPES, primaryType: "RewardClaim", message: claim, signature });
  assert.notEqual(otherChain, signer.address, "bound to chain 4663");
  assert.equal(rewardSigner({ REWARD_KEY: generatePrivateKey() }), null, "no distributor address: nothing is signed");
});

test("reward table stays inside the on-chain per-entry cap", () => {
  const g = (n: number) => [...Array(5)].map((_, i) => (i < n ? "goal" : "save")) as never;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => skillRewardRf(g(n))), [0n, 0n, 0n, RF / 2n, RF, 3n * RF / 2n]);
  assert.ok(skillRewardRf(g(5)) + STREAK_BONUS_RF <= ENTRY_CAP_RF, "skill + streak ≤ 2 RF");
  assert.equal(dayStreak([10, 11, 12], 12), 3);
  assert.equal(dayStreak([10, 12], 12), 1);
  assert.equal(rewardNonce(12, KIND_STREAK), 49n);
});

const secret = crypto.getRandomValues(new Uint8Array(32));
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const hashFor = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const chain: Chain = { async entryFromTx(hash) { const n = parseInt(hash, 16); return { entryId: n, friendId: "7730", player: "0x00000000000000000000000000000000000000aa", week: 1 }; } };
const kicks = [0, 1, 2, 3, 4].map(i => ({ aimX: [0.8, -0.8, 0.7, -0.6, 0.9][i], aimY: 0.55, power: 0.8, curl: 0, releaseMs: 900 }));

test("the referee signs a streak claim on the first finished entry of the 3rd consecutive day", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signed: RewardClaim[] = [];
  let clock = Date.UTC(2026, 9, 1, 12);
  const store = memoryStore();
  const ref = createReferee({
    secret, week: 1, store, chain, signingKey: keys.privateKey, now: () => clock,
    signReward: async claim => { signed.push(claim); return account.signTypedData({ domain: rewardDomain(4663, DISTRIBUTOR), types: REWARD_TYPES, primaryType: "RewardClaim", message: claim }); },
  });
  const play = async (id: number) => {
    await ref.enter({ txHash: hashFor(id) });
    let last;
    for (let i = 0; i < 5; i++) last = await ref.kick({ entryId: id, kickIndex: i, input: kicks[i] });
    return last!;
  };
  const day1 = await play(1);
  clock += 86_400_000;
  await play(2);
  clock += 86_400_000;
  const day3 = await play(3);
  const again = await play(4); // same day: no second streak bonus
  const streaks = signed.filter(c => c.kind === KIND_STREAK);
  assert.equal(streaks.length, 1, "one streak bonus");
  assert.equal(streaks[0].entryId, 3n);
  assert.equal(streaks[0].rfValue, STREAK_BONUS_RF);
  assert.equal(streaks[0].deadline, BigInt(Math.floor(clock / 1000) + 3 * 86_400));
  assert.ok(day3.rewards!.some(r => r.claim.kind === String(KIND_STREAK)));
  assert.ok(!again.rewards!.some(r => r.claim.kind === String(KIND_STREAK)));
  // Every signed claim is within the per-entry cap and carries the (entry, kind) nonce.
  for (const claim of signed) {
    assert.ok(claim.rfValue <= ENTRY_CAP_RF);
    assert.equal(claim.nonce, rewardNonce(Number(claim.entryId), claim.kind));
  }
  // Skill claims appear exactly when 3+ of the 5 referee-judged kicks were goals.
  const goals = (await store.getEntry(1))!.kicks.filter(k => k.result === "goal").length;
  assert.equal(day1.rewards!.some(r => r.claim.kind === String(KIND_SKILL)), goals >= 3);
});

test("without a reward signer the referee signs no rewards", async () => {
  const ref = createReferee({ secret, week: 1, store: memoryStore(), chain, signingKey: keys.privateKey });
  await ref.enter({ txHash: hashFor(9) });
  let last;
  for (let i = 0; i < 5; i++) last = await ref.kick({ entryId: 9, kickIndex: i, input: kicks[i] });
  assert.deepEqual(last!.rewards, []);
});
