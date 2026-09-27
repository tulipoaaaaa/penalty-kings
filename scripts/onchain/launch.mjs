// $GBOOT launch via contracts/script/Launch.s.sol, with the project's spend-safety rules:
//   1. `forge script` SIMULATES against a fork of mainnet (same script, same env) — nothing sent.
//   2. Budget check on the simulated gas; every planned tx is written to docs/TX-LOG.md.
//   3. Only with --send: `forge script --broadcast` with the pk-burner keystore.
//   4. Every receipt must be status 1; addresses go to games/penalty-kings/deployments/live.json.
//
//   node scripts/onchain/launch.mjs <floorRF> <smokeRF> [--send]
// e.g. Starter: 0 1000 · Launch: 250000 1000 · Big: 1000000 1000
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { launchEnv } from "./pool-plan.mjs";
import { authorize, record } from "../lib/budget.mjs";
import { RPC_URL, clients, logPlanned, logSent, EXPLORER } from "./lib.mjs";

const [floorArg, smokeArg] = process.argv.slice(2);
if (!/^\d+$/.test(floorArg ?? "") || !/^\d+$/.test(smokeArg ?? "")) throw new Error("usage: launch.mjs <floorRF> <smokeRF> [--send]");
const send = process.argv.includes("--send");
const { client } = { client: (await import("viem")).createPublicClient({ transport: (await import("viem")).http(RPC_URL) }) };
// Dry runs may simulate as REHEARSE_AS (no key needed); --send always uses the loaded burner key.
const account = !send && process.env.REHEARSE_AS ? { address: process.env.REHEARSE_AS } : clients(RPC_URL).account;
const env = { ...process.env, ...Object.fromEntries(launchEnv(BigInt(floorArg), BigInt(smokeArg)).map(line => line.split("="))) };
const CONTRACTS = new URL("../../contracts/", import.meta.url).pathname;
const forge = args => execFileSync("forge", ["script", "script/Launch.s.sol", "--sender", account.address, ...args], { cwd: CONTRACTS, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

console.log(`[launch] simulating on a fork of Robinhood mainnet as ${account.address}…`);
const simulated = forge(["--fork-url", RPC_URL]);
console.log(simulated.split("\n").filter(line => /GBOOT|KitShop|LiquidityLock|PoolSwapper|SkillCup|Wildcards|positionA|unlockTime|Estimated|gas/i.test(line)).join("\n"));
const dry = JSON.parse(await readFile(join(CONTRACTS, "broadcast/Launch.s.sol/4663/dry-run/run-latest.json"), "utf8"));
const planned = dry.transactions.map((tx, index) => ({
  purpose: `launch ${index + 1}/${dry.transactions.length} ${tx.contractName ?? ""} ${tx.function ?? "create"}`.trim(),
  to: tx.contractAddress ?? tx.transaction.to ?? "(create)", fn: tx.function ?? "constructor", args: (tx.arguments ?? []).join(", ").slice(0, 120),
  gas: BigInt(tx.transaction.gas ?? "0x0").toString(),
}));
console.log(`[launch] rehearsal PASSED: ${planned.length} transactions`);
if (!send) { console.log(planned.map(tx => `  ${tx.purpose} gas≈${tx.gas}`).join("\n")); process.exit(0); }

const gasPrice = await client.getGasPrice();
for (const tx of planned) {
  await authorize({ step: tx.purpose, gasLimit: BigInt(tx.gas), maxFeePerGas: gasPrice * 2n });
  await logPlanned({ ...tx, rehearsal: "passed (forge fork simulation)" });
}
console.log("[launch] broadcasting on MAINNET…");
const output = execFileSync("forge", ["script", "script/Launch.s.sol", "--rpc-url", RPC_URL, "--account", "pk-burner", "--sender", account.address, "--broadcast", "--slow"],
  { cwd: CONTRACTS, env: { ...env, ETH_PASSWORD: join(homedir(), ".burner-pass") /* password FILE path (forge --password-file) */ }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const run = JSON.parse(await readFile(join(CONTRACTS, "broadcast/Launch.s.sol/4663/run-latest.json"), "utf8"));
for (const [index, receipt] of run.receipts.entries()) {
  const ok = receipt.status === "0x1";
  await record({ step: planned[index].purpose, hash: receipt.transactionHash, spentWei: BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) });
  await logSent({ purpose: planned[index].purpose, hash: receipt.transactionHash, status: ok ? "success" : "REVERTED" });
  if (!ok) throw new Error(`FREEZE: ${receipt.transactionHash} reverted — investigate read-only before anything else (${EXPLORER}/tx/${receipt.transactionHash}).`);
}
const grab = name => output.match(new RegExp(`${name}\\s+(0x[0-9a-fA-F]{40})`))?.[1];
const live = { chainId: 4663, gboot: grab("GBOOT"), kitShop: grab("KitShop"), liquidityLock: grab("LiquidityLock"), poolSwapper: grab("PoolSwapper"), skillCup: grab("SkillCup"), wildcards: grab("Wildcards"),
  bootroom: grab("Bootroom"), dropVault: grab("DropVault"), cupsVault: grab("CupsVault"), bountyVault: grab("BountyVault"), friendsAirdrop: grab("FriendsAirdrop"), edgeSplitter: grab("EdgeSplitter"),
  rf: "0x0779369854d3EcdEA927206718FFD7730C67B71f",
  positionA: output.match(/positionA\s+(\d+)/)?.[1], unlockTime: output.match(/unlockTime\s+(\d+)/)?.[1], launchBlock: BigInt(run.receipts[0].blockNumber).toString() };
for (const [key, value] of Object.entries(live)) if (!value) throw new Error(`FREEZE: could not read ${key} from the broadcast output`);
for (const key of ["gboot", "kitShop", "liquidityLock", "poolSwapper", "skillCup", "wildcards", "bootroom", "dropVault", "cupsVault", "bountyVault", "friendsAirdrop", "edgeSplitter"]) {
  const code = await client.getCode({ address: live[key] });
  if (!code || code === "0x") throw new Error(`FREEZE: no code at ${key} ${live[key]}`);
}
await mkdir(new URL("../../games/penalty-kings/deployments/", import.meta.url), { recursive: true });
await writeFile(new URL("../../games/penalty-kings/deployments/live.json", import.meta.url), JSON.stringify(live, null, 2) + "\n");
console.log("[launch] MAINNET done; wrote games/penalty-kings/deployments/live.json", live);
