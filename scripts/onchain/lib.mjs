// Shared helpers for mainnet step scripts: fork rehearsal, clients, receipts and TX-LOG.
// Every step runs FIRST on an anvil fork of Robinhood mainnet with the same code and args;
// mainnet runs only with --send, only after the rehearsal passed, and only within budget.
import { spawn, execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, defineChain, http, formatEther } from "viem";
import { loadBurner } from "../lib/wallet.mjs";
import { authorize, record } from "../lib/budget.mjs";

export const RPC_URL = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const chainFor = url => defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });

export function clients(url) {
  const chain = chainFor(url);
  // Fork-only rehearsal as an address whose key is not loaded (anvil impersonation).
  const impersonate = process.env.REHEARSE_AS && url.startsWith("http://127.0.0.1");
  const account = impersonate ? { address: process.env.REHEARSE_AS, type: "json-rpc" } : loadBurner();
  return { account, chain, client: createPublicClient({ chain, transport: http(url) }), wallet: createWalletClient({ account, chain, transport: http(url) }) };
}

/** Start an anvil fork of mainnet at the latest block. Returns { url, stop }. */
export async function startFork(port = 8546) {
  const child = spawn("anvil", ["--fork-url", RPC_URL, "--chain-id", "4663", "--port", String(port), "--silent", ...(process.env.REHEARSE_AS ? ["--auto-impersonate"] : [])], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const probe = createPublicClient({ transport: http(url) });
      if ((await probe.getChainId()) === 4663) { await fundFork(url); return { url, stop: () => child.kill() }; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  child.kill(); throw new Error("anvil fork did not start (is the Robinhood RPC reachable?)");
}

/**
 * CI / pre-funding rehearsals only: when FORK_FUND_RF is set, give the burner ETH and RF on the
 * FORK (anvil cheat RPCs). Never touches mainnet. RF is OpenZeppelin ERC20: balances at slot 0.
 */
async function fundFork(url) {
  const rf = process.env.FORK_FUND_RF, eth = process.env.FORK_FUND_ETH;
  if (eth && !rf) {
    const { toHex, parseEther } = await import("viem");
    const { account } = clients(url);
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [account.address, toHex(parseEther(eth))] }) });
    console.log(`[fork] funded ${account.address} with ${eth} ETH (fork only)`);
    return;
  }
  if (!rf) return;
  const { keccak256, encodeAbiParameters, pad, toHex, parseAbi } = await import("viem");
  const { account, client } = clients(url);
  const rpc = (method, params) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then(r => r.json());
  await rpc("anvil_setBalance", [account.address, toHex(10n ** 19n)]);
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account.address, 0n]));
  const amount = BigInt(rf) * 10n ** 18n;
  await rpc("anvil_setStorageAt", [RF_ADDRESS, slot, pad(toHex(amount), { size: 32 })]);
  const balance = await client.readContract({ address: RF_ADDRESS, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [account.address] });
  if (balance !== amount) throw new Error("fork funding failed: RF balance slot mismatch");
  console.log(`[fork] funded ${account.address} with 10 ETH and ${rf} RF (fork only)`);
}
const RF_ADDRESS = "0x0779369854d3EcdEA927206718FFD7730C67B71f";

/** Receipt with status check; freezes (throws, no retry) on anything unexpected. */
export async function confirmed(client, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`FREEZE: ${hash} reverted. Investigate read-only before any further transaction.`);
  return receipt;
}

const LOG = new URL("../../docs/TX-LOG.md", import.meta.url);
/** Append the pre-send entry (purpose, target, function, args, value, gas estimate). */
export async function logPlanned({ purpose, to, fn, args, valueWei = 0n, gas, rehearsal }) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  await appendFile(LOG, `| ${now} | ${purpose} | \`${to}\` | \`${fn}(${args})\` | ${formatEther(valueWei)} ETH | ${gas} | ${rehearsal} | PENDING | planned |\n`);
}
/** Replace the matching PENDING row with the hash, Blockscout link and status. */
export async function logSent({ purpose, hash, status }) {
  const text = await readFile(LOG, "utf8");
  const lines = text.split("\n"), index = lines.findIndex(line => line.includes(`| ${purpose} |`) && line.includes("| PENDING |"));
  if (index < 0) throw new Error(`TX-LOG row for ${purpose} missing`);
  lines[index] = lines[index].replace("| PENDING | planned |", `| [${hash.slice(0, 10)}…](${EXPLORER}/tx/${hash}) | ${status} |`);
  await writeFile(LOG, lines.join("\n"));
}

/**
 * Run `step(ctx)` on a fork; if it passes and --send was given, re-run the identical step on
 * mainnet within budget. `step` receives { client, wallet, account, mainnet, plan(tx) }.
 */
export async function rehearseThenSend(name, step) {
  const send = process.argv.includes("--send");
  const fork = await startFork();
  const planned = [];
  try {
    console.log(`[${name}] rehearsing on anvil fork of Robinhood mainnet…`);
    const result = await step({ ...clients(fork.url), mainnet: false, plan: tx => planned.push(tx) });
    console.log(`[${name}] rehearsal PASSED`, result ?? "");
  } finally { fork.stop(); }
  if (!send) { console.log(`[${name}] dry run only (no --send). Planned txs:`, planned.map(tx => `${tx.purpose} gas≈${tx.gas}`)); return; }
  const live = clients(RPC_URL);
  const gasPrice = await live.client.getGasPrice();
  for (const tx of planned) {
    await authorize({ step: tx.purpose, valueWei: tx.valueWei ?? 0n, gasLimit: BigInt(Math.ceil(Number(tx.gas) * 1.3)), maxFeePerGas: gasPrice * 2n, ...tx.budget });
    await logPlanned({ ...tx, rehearsal: "passed" });
  }
  console.log(`[${name}] sending on MAINNET (${planned.length} txs)…`);
  const result = await step({ ...live, mainnet: true, plan: () => {}, sent: async (purpose, receipt) => {
    await record({ step: purpose, hash: receipt.transactionHash, spentWei: receipt.gasUsed * receipt.effectiveGasPrice });
    await logSent({ purpose, hash: receipt.transactionHash, status: receipt.status });
  } });
  console.log(`[${name}] MAINNET done`, result ?? "");
  return result;
}

export function forgeBuild(root) {
  const args = ["build", "--root", root];
  if (process.env.SOLC) args.push("--use", process.env.SOLC, "--offline");
  execFileSync("forge", args, { stdio: "inherit" });
}
