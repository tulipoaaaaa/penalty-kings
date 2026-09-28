// DevSimulatedProvider: the happy path and every injected failure (D5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { DevSimulatedProvider, SimEconomy, FailureInjector, memoryStorage, safeStorage, deriveTestAddress, isWalletError, RF, FIXTURE_FRIEND_ID, formatRf, type LoginStep } from "../src/index.ts";

const USD_PER_RF = 0.0015; // any positive price: the app passes the game's on-chain snapshot price
const fast = { sleep: async () => {}, usdPerRf: () => USD_PER_RF, delayMs: 0 };
const make = (storage = memoryStorage(), extra: Partial<ConstructorParameters<typeof SimEconomy>[0]> = {}) =>
  new DevSimulatedProvider({ economy: new SimEconomy({ ...fast, storage, ...extra }) });
const login = (wallet: DevSimulatedProvider, email = "player@example.test", code = "123456", steps: LoginStep[] = []) =>
  wallet.login("email", { email, getCode: async () => code, onProgress: step => steps.push(step) });

test("email login: any 6-digit code, deterministic address, wallet created once", async () => {
  const wallet = make(), steps: LoginStep[] = [];
  const address = await login(wallet, "Player@Example.test", "000000", steps);
  assert.equal(address, deriveTestAddress("email:player@example.test"));
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.deepEqual(steps, ["sending-code", "verifying", "creating-wallet", "done"]);
  assert.equal(wallet.getAddress(), address);
  assert.equal(wallet.snapshot().status, "logged-in");
  assert.equal(wallet.snapshot().accountHint, "p•••@example.test", "a masked hint, never the full email");
  await wallet.logout();
  const again: LoginStep[] = [];
  assert.equal(await login(wallet, "player@example.test", "999999", again), address, "same account → same address");
  assert.ok(!again.includes("creating-wallet"), "the wallet already exists");
});

test("google login (simulated) and a different account give a different address", async () => {
  const wallet = make();
  const google = await wallet.login("google");
  assert.equal(google, deriveTestAddress("google:test-account"));
  await wallet.logout();
  assert.notEqual(await login(wallet, "other@example.test"), google);
});

test("full happy path: buy RF, loan the fixture Friend, hardwire, ownership gate passes", async () => {
  const wallet = make();
  const address = await login(wallet);
  const { rf, tx } = await wallet.buyRF(5);
  assert.equal(rf, BigInt(Math.floor((5 / USD_PER_RF) * 1e6)) * 10n ** 12n);
  assert.equal(tx.simulated, true);
  assert.match(tx.hash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(await wallet.getBalance(), { rf, simulated: true });
  assert.equal(formatRf(3333n * RF + 33n * 10n ** 16n), "3,333.33");

  const friend = await wallet.loanFriend();
  assert.deepEqual(friend, { id: FIXTURE_FRIEND_ID, label: "Friend #7730", relation: "loaned", hardwired: false, fixture: true, simulated: true });
  // Not hardwired yet: the SDK's own eligibility check refuses it.
  assert.equal((await readGenerationEligibility(wallet.identityClient() as never, 7730n, address)).eligible, false);
  const stages: string[] = [];
  const hardwire = await wallet.hardwire(FIXTURE_FRIEND_ID, p => stages.push(p.stage));
  assert.deepEqual(stages, ["signing", "sending", "confirming", "confirmed"]);
  assert.equal(hardwire.simulated, true);
  assert.equal((await wallet.getFriends())[0].hardwired, true);
  const gate = await readGenerationEligibility(wallet.identityClient() as never, 7730n, address);
  assert.equal(gate.eligible, true, "the real SDK ownership gate passes against the simulated identity client");
  assert.equal((await readGenerationEligibility(wallet.identityClient() as never, 3412n, address)).eligible, false, "other Friends are not owned");

  const signature = await wallet.signMessage("hello");
  assert.match(signature, /^0x[0-9a-f]{130}$/);
  const sent = await wallet.sendTransaction({ to: "0x0000000000000000000000000000000000000001", label: "test" });
  assert.equal(sent.simulated, true);
  assert.notEqual(sent.hash, hardwire.hash);
  wallet.economy.setBalance(address, 7n * RF);
  assert.equal((await wallet.getBalance()).rf, 7n * RF, "the game's preview ledger syncs back");
});

test("state persists: a new instance on the same storage restores the session; logout + relogin restores the account", async () => {
  const storage = memoryStorage();
  const first = make(storage);
  const address = await login(first);
  await first.buyRF(20); await first.loanFriend(); await first.hardwire(FIXTURE_FRIEND_ID);
  const balance = (await first.getBalance()).rf;
  const second = make(storage);
  assert.equal(second.getAddress(), address, "session restored after reload");
  assert.equal((await second.getBalance()).rf, balance);
  await second.logout();
  assert.equal(make(storage).getAddress(), null, "logged out stays logged out");
  const third = make(storage);
  await login(third);
  assert.equal((await third.getBalance()).rf, balance, "re-login restores RF");
  assert.equal((await third.getFriends())[0].hardwired, true, "re-login restores the hardwired Friend");
});

test("reset test account wipes RF, Friends and the session", async () => {
  const storage = memoryStorage();
  const wallet = make(storage);
  await login(wallet); await wallet.buyRF(5); await wallet.loanFriend();
  await wallet.resetTestAccount();
  assert.equal(wallet.getAddress(), null);
  const steps: LoginStep[] = [];
  await login(wallet, undefined, undefined, steps);
  assert.ok(steps.includes("creating-wallet"), "a fresh wallet is created again");
  assert.equal((await wallet.getBalance()).rf, 0n);
  assert.deepEqual(await wallet.getFriends(), []);
});

test("works without storage: a throwing localStorage falls back to memory", async () => {
  const throwing = safeStorage(() => { throw new Error("SecurityError"); });
  const wallet = make(throwing as never);
  await login(wallet);
  await wallet.buyRF(5);
  assert.ok((await wallet.getBalance()).rf > 0n);
  const brokenSet = safeStorage(() => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => {} }) as never);
  brokenSet.set("a", "1");
  assert.equal(brokenSet.get("a"), "1");
});

test("bad code and missing email are rejected with bad-code", async () => {
  const wallet = make();
  await assert.rejects(login(wallet, "player@example.test", "12ab"), error => isWalletError(error, "bad-code"));
  await assert.rejects(wallet.login("email", { email: "nope", getCode: async () => "123456" }), error => isWalletError(error, "bad-code"));
  assert.equal(wallet.snapshot().status, "logged-out");
});

test("failure injector: declined payment (then retry succeeds)", async () => {
  const wallet = make();
  await login(wallet);
  wallet.economy.failures.set("declined");
  await assert.rejects(wallet.buyRF(5), error => isWalletError(error, "declined") && /SIMULATED/.test((error as Error).message));
  assert.equal((await wallet.getBalance()).rf, 0n, "no RF after a declined payment");
  await wallet.buyRF(5);
  assert.ok((await wallet.getBalance()).rf > 0n, "retry works (a 'next' failure is consumed)");
});

test("failure injector: rejected signature and rejected transaction", async () => {
  const wallet = make();
  await login(wallet); await wallet.loanFriend();
  wallet.economy.failures.set("rejected");
  await assert.rejects(wallet.signMessage("x"), error => isWalletError(error, "rejected"));
  wallet.economy.failures.set("rejected");
  await assert.rejects(wallet.hardwire(FIXTURE_FRIEND_ID), error => isWalletError(error, "rejected"));
  assert.equal((await wallet.getFriends())[0].hardwired, false, "a rejected hardwire changes nothing");
  await wallet.hardwire(FIXTURE_FRIEND_ID);
  assert.equal((await wallet.getFriends())[0].hardwired, true);
});

test("failure injector: cancelled at login, payment and transaction", async () => {
  const wallet = make();
  wallet.economy.failures.set("cancelled");
  await assert.rejects(login(wallet), error => isWalletError(error, "cancelled"));
  assert.equal(wallet.getAddress(), null);
  await login(wallet);
  wallet.economy.failures.set("cancelled");
  await assert.rejects(wallet.buyRF(20), error => isWalletError(error, "cancelled"));
  wallet.economy.failures.set("cancelled");
  await assert.rejects(wallet.sendTransaction({ to: "0x0000000000000000000000000000000000000001" }), error => isWalletError(error, "cancelled"));
});

test("failure injector: offline (injected, and when the device reports offline)", async () => {
  let online = true;
  const wallet = make(memoryStorage(), { isOnline: () => online });
  wallet.economy.failures.set("offline");
  await assert.rejects(login(wallet), error => isWalletError(error, "offline"));
  await login(wallet);
  online = false;
  await assert.rejects(wallet.buyRF(5), error => isWalletError(error, "offline"));
  await assert.rejects(wallet.loanFriend(), error => isWalletError(error, "offline"));
  online = true;
  await wallet.loanFriend();
});

test("failure injector: 'always' keeps failing; a failure for another step stays armed", async () => {
  const failures = new FailureInjector();
  const wallet = make(memoryStorage(), { failures });
  await login(wallet);
  failures.set("declined", "always");
  await assert.rejects(wallet.buyRF(5), error => isWalletError(error, "declined"));
  await assert.rejects(wallet.buyRF(5), error => isWalletError(error, "declined"));
  failures.set(null);
  failures.set("declined");
  await wallet.signMessage("declined does not apply to signing");
  assert.deepEqual(failures.current(), { kind: "declined", always: false }, "still armed for the next payment");
  await assert.rejects(wallet.buyRF(5), error => isWalletError(error, "declined"));
  assert.equal(failures.current(), null);
});

test("calls before login fail with not-logged-in", async () => {
  const wallet = make();
  await assert.rejects(wallet.buyRF(5), error => isWalletError(error, "not-logged-in"));
  await assert.rejects(wallet.signMessage("x"), error => isWalletError(error, "not-logged-in"));
  await assert.rejects(wallet.getFriends(), error => isWalletError(error, "not-logged-in"));
});
