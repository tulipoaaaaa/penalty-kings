// The WalletProvider contract (D5): every provider must pass the same suite. PrivyProvider runs against a
// mocked Privy SDK; InjectedProvider against a mock EIP-1193 wallet. No network, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { DevSimulatedProvider, InjectedProvider, PrivyProvider, SimEconomy, memoryStorage, isWalletError, FIXTURE_FRIEND_ID, resolveWalletChoice, createProvider,
  type WalletProvider, type Eip1193, type PrivySdk, type PrivyClientLike, type IdentityReadClient, type WalletSnapshot } from "../src/index.ts";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const economy = () => new SimEconomy({ storage: memoryStorage(), sleep: async () => {}, delayMs: 0, usdPerRf: () => 0.002 });
/** Stands in for the real chain in contract tests: nothing is owned there. */
const offlineChain: IdentityReadClient = {
  getChainId: async () => 4663, getBlockNumber: async () => 1000n,
  readContract: async ({ functionName }) => (functionName === "ownerOf" ? "0x000000000000000000000000000000000000dEaD" : functionName === "generation" ? 0 : ADDRESS),
};

/** A mock EIP-1193 wallet (the shape Privy's embedded wallet and browser wallets expose). */
function mockEip1193({ reject = false } = {}) {
  const calls: string[] = [];
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  let chainId = "0x1";
  const provider: Eip1193 & { calls: string[]; emit(event: string, value: unknown): void } = {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (reject && (method === "personal_sign" || method === "eth_sendTransaction")) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDRESS];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") { chainId = (params as { chainId: string }[])[0].chainId; return null; }
      if (method === "personal_sign") return `0x${"ab".repeat(65)}`;
      if (method === "eth_sendTransaction") return `0x${"cd".repeat(32)}`;
      if (method === "wallet_revokePermissions") return null;
      throw new Error(`unexpected ${method}`);
    },
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    emit(event, value) { for (const listener of listeners.get(event) ?? []) listener(value); },
  };
  return provider;
}

/** A mocked @privy-io/js-sdk-core: email OTP, OAuth, embedded wallet creation, EIP-1193 provider. */
function mockPrivy(eth: Eip1193) {
  const log: string[] = [];
  let hasWallet = false;
  const user = () => ({ id: "did:privy:test", linked_accounts: hasWallet ? [{ type: "wallet", address: ADDRESS }] : [] });
  const client: PrivyClientLike = {
    initialize: async () => { log.push("initialize"); },
    setMessagePoster: () => { log.push("setMessagePoster"); },
    auth: {
      email: { sendCode: async email => { log.push(`sendCode:${email}`); }, loginWithCode: async (_email, code) => { if (code !== "424242") throw new Error("invalid code"); log.push("loginWithCode"); return user(); } },
      oauth: { generateURL: async (provider, redirect) => ({ url: `https://auth.example.test/${provider}?redirect=${redirect}` }), loginWithCode: async () => { log.push("oauthLogin"); return user(); } },
      logout: async () => { log.push("logout"); },
    },
    user: { get: async () => ({ user: null }) },
    embeddedWallet: {
      create: async () => { log.push("createWallet"); hasWallet = true; return user(); },
      getURL: () => "https://auth.example.test/embedded-wallets",
      onMessage: () => {},
      getEthereumProvider: async () => eth,
    },
  };
  const sdk: PrivySdk = {
    createClient: appId => { log.push(`client:${appId}`); return client; },
    getUserEmbeddedEthereumWallet: value => ((value?.linked_accounts as { address: string }[] | undefined)?.[0] ?? null),
    getEntropyDetailsFromUser: value => (value ? { entropyId: ADDRESS, entropyIdVerifier: "ethereum-address-verifier" } : null),
  };
  return { sdk, log };
}

type Harness = { name: string; make(opts?: { allowTransactions?: boolean; reject?: boolean }): { wallet: WalletProvider & { loanFriend(): Promise<unknown>; hardwire(id: string): Promise<unknown> }; login(): Promise<string>; realTx: boolean; after?: () => void } };
const HARNESSES: Harness[] = [
  { name: "DevSimulatedProvider", make: () => { const wallet = new DevSimulatedProvider({ economy: economy() }); return { wallet, realTx: false, login: () => wallet.login("email", { email: "player@example.test", getCode: async () => "123456" }) }; } },
  { name: "PrivyProvider (SDK mocked)", make: ({ allowTransactions = false, reject = false } = {}) => {
    const eth = mockEip1193({ reject }), { sdk, log } = mockPrivy(eth);
    const wallet = new PrivyProvider({ appId: "test-app-id", economy: economy(), loadSdk: async () => sdk, mountIframe: () => () => {}, readOAuthReturn: () => null,
      chainFriends: async () => [], identityFallback: () => offlineChain, allowTransactions });
    return { wallet, realTx: true, login: () => wallet.login("email", { email: "player@example.test", getCode: async () => "424242" }),
      after: () => assert.ok(log.includes("createWallet") && log.includes("client:test-app-id"), `privy calls: ${log}`) };
  } },
  { name: "InjectedProvider (mock EIP-1193)", make: ({ allowTransactions = false, reject = false } = {}) => {
    const eth = mockEip1193({ reject });
    const wallet = new InjectedProvider({ economy: economy(), getProvider: () => eth, chainFriends: async () => [], identityFallback: () => offlineChain, allowTransactions });
    return { wallet, realTx: true, login: () => wallet.login("injected"), after: () => assert.ok(eth.calls.includes("wallet_switchEthereumChain"), "switches to Robinhood (4663)") };
  } },
];

for (const harness of HARNESSES) {
  test(`${harness.name}: login → address, snapshot, onChange, logout`, async () => {
    const { wallet, login, after } = harness.make();
    assert.equal(typeof wallet.kind, "string"); assert.ok(wallet.label.length > 3);
    assert.equal(wallet.getAddress(), null);
    const seen: WalletSnapshot[] = [];
    const off = wallet.onChange(snapshot => seen.push(snapshot));
    const address = await login();
    assert.match(address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(wallet.getAddress(), address);
    assert.equal(wallet.snapshot().status, "logged-in");
    assert.equal(wallet.snapshot().kind, wallet.kind);
    assert.ok(seen.some(snapshot => snapshot.status === "logged-in" && snapshot.address === address), "onChange reports the login");
    off();
    const count = seen.length;
    await wallet.logout();
    assert.equal(wallet.getAddress(), null);
    assert.equal(seen.length, count, "unsubscribed listeners are not called");
    after?.();
  });

  test(`${harness.name}: sign, send (real sends blocked unless allowed), buy RF, Friends, ownership gate`, async () => {
    const { wallet, login, realTx } = harness.make();
    const address = await login();
    assert.match(await wallet.signMessage("Penalty Kings test"), /^0x[0-9a-f]+$/);
    const tx = { to: "0x0000000000000000000000000000000000000001" as const, value: 1n, label: "contract" };
    if (realTx) await assert.rejects(wallet.sendTransaction(tx), error => isWalletError(error, "blocked"), "real transactions are OFF in the test build");
    else assert.equal((await wallet.sendTransaction(tx)).simulated, true);
    const { rf } = await wallet.buyRF(5);
    assert.deepEqual(await wallet.getBalance(), { rf, simulated: true }, "RF top-ups are simulated for every provider");
    await wallet.loanFriend();
    assert.equal((await wallet.getFriends())[0].id, FIXTURE_FRIEND_ID);
    await wallet.hardwire(FIXTURE_FRIEND_ID);
    assert.equal((await readGenerationEligibility(wallet.identityClient() as never, 7730n, address as `0x${string}`)).eligible, true);
    assert.equal((await readGenerationEligibility(wallet.identityClient() as never, 3412n, address as `0x${string}`)).eligible, false);
  });

  if (harness.name !== "DevSimulatedProvider") test(`${harness.name}: wallet rejection (EIP-1193 4001) maps to "rejected"; allowed sends reach the wallet`, async () => {
    const rejecting = harness.make({ allowTransactions: true, reject: true });
    await rejecting.login();
    await assert.rejects(rejecting.wallet.signMessage("x"), error => isWalletError(error, "rejected"));
    await assert.rejects(rejecting.wallet.sendTransaction({ to: "0x0000000000000000000000000000000000000001" }), error => isWalletError(error, "rejected"));
    const allowed = harness.make({ allowTransactions: true });
    await allowed.login();
    const result = await allowed.wallet.sendTransaction({ to: "0x0000000000000000000000000000000000000001" });
    assert.equal(result.simulated, false);
    assert.match(result.explorerUrl ?? "", /^https:\/\/robinhoodchain\.blockscout\.com\/tx\/0x/);
  });
}

test("PrivyProvider: a wrong code is bad-code; Google redirects then completes on return", async () => {
  const eth = mockEip1193(), { sdk, log } = mockPrivy(eth);
  let navigated = "", back: { code: string; state: string } | null = null;
  const wallet = new PrivyProvider({ appId: "test-app-id", economy: economy(), loadSdk: async () => sdk, mountIframe: () => () => {},
    readOAuthReturn: () => back, navigate: url => { navigated = url; }, redirectUri: () => "https://app.example.test/", identityFallback: () => offlineChain });
  await assert.rejects(wallet.login("email", { email: "player@example.test", getCode: async () => "000000" }), error => isWalletError(error, "bad-code"));
  await assert.rejects(wallet.login("google"), error => isWalletError(error, "cancelled"));
  assert.match(navigated, /^https:\/\/auth\.example\.test\/google\?redirect=https:\/\/app\.example\.test\/$/);
  back = { code: "abc", state: "xyz" };
  assert.equal(await wallet.login("google"), ADDRESS);
  assert.ok(log.includes("oauthLogin"));
});

test("selection: Privy needs WALLET=privy AND an App ID, else DevSimulated with a banner; overrides only in test builds", () => {
  assert.deepEqual(resolveWalletChoice({ wallet: "privy", privyAppId: null, testBuild: true }).choice, "dev");
  assert.match(resolveWalletChoice({ wallet: "privy", privyAppId: null, testBuild: true }).banner ?? "", /no PRIVY_APP_ID/);
  assert.equal(resolveWalletChoice({ wallet: "privy", privyAppId: "app", testBuild: true }).choice, "privy");
  assert.equal(resolveWalletChoice({ wallet: "dev", privyAppId: null, testBuild: true }, "injected").choice, "injected");
  assert.equal(resolveWalletChoice({ wallet: "dev", privyAppId: null, testBuild: false }, "injected").choice, "dev", "no runtime switching outside test builds");
  assert.equal(createProvider("privy", { economy: economy(), privyAppId: null }).kind, "dev-simulated");
  assert.equal(createProvider("injected", { economy: economy(), privyAppId: null }).kind, "injected");
});
