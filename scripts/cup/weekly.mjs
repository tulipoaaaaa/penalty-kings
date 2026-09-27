// Weekly $GBOOT drops and Golden Boot Cup table, computed ONLY from on-chain ChanceGame
// `Settled(playId, friendId, outcomeId)` events. Anyone can re-run it and get the same result.
//
//   node scripts/cup/weekly.mjs --from <block> --to <block> [--base park=13,pro=1395,champions=13953] [--pot-rf 500000] [--rpc URL]
//
// Output: markdown for docs/WEEKLY.md and a JSON payout file (drops per Friend canonical wallet,
// Cup winners). It only reads; payments are separate, logged transactions.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http, parseAbiItem, parseAbi } from "viem";
import { computeWeek } from "./compute.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => (value.startsWith("--") ? [...pairs, [value.slice(2), list[index + 1]]] : pairs), []));
const from = BigInt(args.from ?? 0), to = BigInt(args.to ?? 0);
if (!from || !to || to < from) throw new Error("usage: --from <block> --to <block>");
const base = Object.fromEntries((args.base ?? "park=13,pro=1395,champions=13953").split(",").map(pair => pair.split("=")).map(([k, v]) => [k, Number(v)]));
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const client = createPublicClient({ transport: http(args.rpc ?? process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com") });
const settled = parseAbiItem("event Settled(uint256 indexed playId, uint256 indexed friendId, uint256 indexed outcomeId)");

const dir = new URL("../../games/penalty-kings/deployments/", import.meta.url);
const tiers = [];
for (const file of (await readdir(dir).catch(() => [])).filter(name => name.endsWith(".json"))) {
  const deployment = JSON.parse(await readFile(new URL(file, dir), "utf8"));
  tiers.push({ tier: file.replace(".json", ""), game: deployment.game });
}
if (!tiers.length) throw new Error("No live deployments in games/penalty-kings/deployments/.");

const settledEvents = [];
const getLogs = async (address, event) => {
  const logs = [];
  for (let start = from; start <= to; start += 10_000n) {
    const end = start + 9_999n > to ? to : start + 9_999n;
    logs.push(...await client.getLogs({ address, event, fromBlock: start, toBlock: end, strict: true }));
  }
  return logs;
};
for (const { tier, game } of tiers) {
  for (const log of await getLogs(game, settled)) settledEvents.push({ tier, friendId: log.args.friendId.toString(), outcomeId: Number(log.args.outcomeId) });
}
// Wildcards: extra Cup draws with Dice randomness (deployments/live.json).
const wildcardEvents = [];
let live = {};
try { live = JSON.parse(await readFile(new URL("../../games/penalty-kings/deployments/live.json", import.meta.url), "utf8")); } catch {}
if (live.wildcards) {
  const drawn = parseAbiItem("event WildcardDrawn(uint256 indexed drawId, uint256 indexed friendId, uint8 points)");
  for (const log of await getLogs(live.wildcards, drawn)) wildcardEvents.push({ friendId: log.args.friendId.toString(), points: Number(log.args.points) });
}
const { rows, cup: cupRows } = computeWeek({ settled: settledEvents, wildcards: wildcardEvents, base, potRf: Number(args["pot-rf"] ?? 0) });
const wallets = await Promise.all(rows.map(row => client.readContract({ address: GENERATIONS, abi: parseAbi(["function tokenBoundAccount(uint256) view returns (address)"]), functionName: "tokenBoundAccount", args: [BigInt(row.friendId)] })));
rows.forEach((row, index) => { row.wallet = wallets[index]; });
const cup = cupRows.map(row => ({ ...row, wallet: rows.find(r => r.friendId === row.friendId)?.wallet }));
const output = { blocks: [from.toString(), to.toString()], base, drops: rows, cup, wildcards: wildcardEvents.length };
await writeFile(`weekly-${from}-${to}.json`, JSON.stringify(output, null, 2));
console.log(`## Week blocks ${from}–${to}\n\nDrop base: ${JSON.stringify(base)} · Friends: ${rows.length} · Balls settled: ${rows.reduce((s, r) => s + r.balls, 0)}\n`);
console.log("| Rank | Friend | Race pts | Cup share | RF |\n|---:|---|---:|---:|---:|");
for (const row of cup) console.log(`| ${row.rank} | #${row.friendId} | ${row.points} | ${row.shareBps / 100}% | ${row.rf.toLocaleString("en-US")} |`);
console.log(`\nTotal $GBOOT drops: ${rows.reduce((s, r) => s + r.drops, 0).toLocaleString("en-US")} → weekly-${from}-${to}.json`);
