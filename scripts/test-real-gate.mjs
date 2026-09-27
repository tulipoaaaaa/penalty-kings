// REAL ownership-gate test against Robinhood mainnet (read-only; needs network, runs in CI).
// No RPC mocks: the SDK runtime does its normal discovery and fresh readGenerationEligibility
// against the public RPC. The injected EIP-1193 provider only answers accounts/chain and refuses
// every signing or transaction method.
//   GATE_FRIEND_ID (default 7730, a hardwired Generations NFT) — its CURRENT owner is read on-chain.
//   Once the burner owns a hardwired Friend, set GATE_FRIEND_ID to it.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createPublicClient, http, parseAbi } from "viem";
import { buildGame } from "@rarefriends/friendsdk/build";
import { createGameServer } from "@rarefriends/friendsdk/serve";

const RPC = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const friendId = BigInt(process.env.GATE_FRIEND_ID ?? "7730");
const client = createPublicClient({ transport: http(RPC) });
const abi = parseAbi(["function ownerOf(uint256) view returns (address)", "function generation(uint256) view returns (uint8)"]);
const [owner, generation] = await Promise.all([
  client.readContract({ address: GENERATIONS, abi, functionName: "ownerOf", args: [friendId] }),
  client.readContract({ address: GENERATIONS, abi, functionName: "generation", args: [friendId] }),
]);
assert.ok(generation >= 1, `Friend #${friendId} must be hardwired (generation ${generation})`);
console.log(`Friend #${friendId}: generation ${generation}, owner ${owner} (read from mainnet)`);

const build = await buildGame(resolve("games/penalty-kings"), { outdir: join(await mkdtemp(join(tmpdir(), "pk-gate-")), "site") });
const server = createGameServer(build.outdir);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

async function visit(account) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const refused = [];
  await page.exposeFunction("__refused", method => refused.push(method));
  await page.addInitScript(({ account }) => {
    const listeners = new Map();
    let accounts = [];
    window.ethereum = {
      async request({ method }) {
        if (method === "eth_accounts") return accounts;
        if (method === "eth_requestAccounts") { accounts = [account]; return accounts; }
        if (method === "eth_chainId") return "0x1237";
        if (method === "wallet_switchEthereumChain") return null;
        window.__refused(method);
        throw Object.assign(new Error(`Read-only test provider refuses ${method}`), { code: 4200 });
      },
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
      removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    };
  }, { account });
  await page.goto(origin);
  await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
  return { page, refused };
}

try {
  // 1) The real owner of a hardwired Friend is admitted after the runtime's fresh on-chain check.
  const admitted = await visit(owner);
  await admitted.page.getByRole("button", { name: new RegExp(`^Friend #${friendId}\\b`) }).click({ timeout: 90_000 });
  await admitted.page.frameLocator("iframe").getByText("PARK · SIMULATED").waitFor({ timeout: 90_000 });
  assert.deepEqual(admitted.refused, [], "no signing or transaction requests");
  console.log(`PASS real gate admits the owner of hardwired Friend #${friendId}`);
  await admitted.page.close();

  // 2) A random address owns no Friend: the game never mounts.
  const random = `0x${[...crypto.getRandomValues(new Uint8Array(20))].map(b => b.toString(16).padStart(2, "0")).join("")}`;
  const rejected = await visit(random);
  await rejected.page.getByText("No playable Friends found.", { exact: true }).waitFor({ timeout: 90_000 });
  assert.equal(await rejected.page.locator("iframe").count(), 0, "no game frame for a non-owner");
  console.log(`PASS real gate rejects random address ${random}`);
} finally {
  await browser.close(); server.close(); await build.close();
}
