// Weekly $GBOOT drops, Golden Boot Cup table and edge-split plan (tokenomics v2), computed ONLY from
// on-chain reads: ChanceGame `Settled(playId, friendId, outcomeId)` events, Wildcards `WildcardDrawn`
// events, Bootroom.perkTier per Friend (reported for XP / cosmetics / Cup seeding only: it never
// changes drops, race points or ranks), the drop vault's capOf / released[week], the EdgeSplitter's RF
// balance and, when deployed, the RewardsDistributor's season budget. Anyone can re-run it and get the
// same result.
//
// DRY RUN ONLY. This script never signs and never sends: it holds no key, creates no wallet client and
// has no --send flag. Payments (vault release, EdgeSplitter.split, Cup payouts) are separate, rehearsed,
// logged transactions (README "Safety rules for live transactions").
//
//   node scripts/cup/weekly.mjs --from <block> --to <block> [--twap <RF per GBOOT>] [--pot-rf 500000] [--rpc URL]
//        [--base park=0.93,pro=93,champions=930] [--week <vault week>] [--edge-rf <RF>]
//   node scripts/cup/weekly.mjs --plan [--week <n>] [--edge-rf <RF>] [--twap <RF>]    offline: budget + split only
//
// Output: markdown for docs/WEEKLY.md and weekly-<from>-<to>.json (drops per Friend token-bound
// wallet, perk tiers and seeding, Cup winners, the vault budget, the rewards budget and the edge split plan).
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http, parseAbiItem, parseAbi, formatEther, parseEther } from "viem";
import { computeWeek, baseFor, dropBudget, edgeSplit } from "./compute.mjs";
import { EDGE_SPLIT, VAULTS } from "../lib/tokenomics.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => (value.startsWith("--") ? [...pairs, [value.slice(2), list[index + 1]?.startsWith("--") ? "true" : (list[index + 1] ?? "true")]] : pairs), []));
const fmt = n => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const twap = args.twap ? Number(args.twap) : undefined;
const base = args.base
  ? Object.fromEntries(args.base.split(",").map(pair => pair.split("=")).map(([k, v]) => [k, Number(v)]))
  : baseFor(twap);

function splitLines(edgeWei) {
  const s = edgeSplit(edgeWei);
  return [
    `Edge split plan (EdgeSplitter ${EDGE_SPLIT.burnBps / 100}/${EDGE_SPLIT.buybackBps / 100}/${EDGE_SPLIT.cupBps / 100}) of ${fmt(formatEther(edgeWei))} RF:`,
    `- RF burned: ${fmt(formatEther(s.burn))}`,
    `- RF → $GBOOT buy-and-burn: ${fmt(formatEther(s.buyback))}${twap ? ` (≈ ${fmt((Number(formatEther(s.buyback)) * 0.99) / twap)} $GBOOT at ${twap} RF, before price impact; split() takes minGbootOut from a fresh quote − 3%)` : ""}`,
    `- RF to the Golden Boot Cup: ${fmt(formatEther(s.cup))}`,
  ];
}
function budgetLines(week, releasedWei = 0n) {
  const b = dropBudget(week, releasedWei);
  return [`Drop vault week ${week}: capOf = ${fmt(formatEther(b.capWei))} $GBOOT (2,500,000 >> ⌊${week} / ${VAULTS.drops.halvingWeeks}⌋), already released ${fmt(formatEther(releasedWei))}, budget left **${fmt(b.left)}**.`];
}

console.log("DRY RUN: read-only. Nothing is signed or sent.\n");

if (args.plan) {
  const week = Number(args.week ?? 0);
  console.log(`Drop base: ${JSON.stringify(base)}${twap ? ` (TWAP ${twap} RF)` : " (launch schedule)"}`);
  console.log(budgetLines(week).join("\n"));
  if (args["edge-rf"]) console.log("\n" + splitLines(parseEther(args["edge-rf"])).join("\n"));
  process.exit(0);
}

const from = BigInt(args.from ?? 0), to = BigInt(args.to ?? 0);
if (!from || !to || to < from) throw new Error("usage: --from <block> --to <block> (or --plan for the offline budget and split)");
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const client = createPublicClient({ transport: http(args.rpc ?? process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com") });
const settled = parseAbiItem("event Settled(uint256 indexed playId, uint256 indexed friendId, uint256 indexed outcomeId)");

const dir = new URL("../../games/penalty-kings/deployments/", import.meta.url);
const tiers = [];
for (const file of (await readdir(dir).catch(() => [])).filter(name => name.endsWith(".json") && name !== "live.json")) {
  const deployment = JSON.parse(await readFile(new URL(file, dir), "utf8"));
  tiers.push({ tier: file.replace(".json", ""), game: deployment.game });
}
if (!tiers.length) throw new Error("No live stadium deployments in games/penalty-kings/deployments/.");
let live = {};
try { live = JSON.parse(await readFile(new URL("live.json", dir), "utf8")); } catch {}

const getLogs = async (address, event) => {
  const logs = [];
  for (let start = from; start <= to; start += 10_000n) {
    const end = start + 9_999n > to ? to : start + 9_999n;
    logs.push(...await client.getLogs({ address, event, fromBlock: start, toBlock: end, strict: true }));
  }
  return logs;
};
const settledEvents = [];
for (const { tier, game } of tiers) {
  for (const log of await getLogs(game, settled)) settledEvents.push({ tier, friendId: log.args.friendId.toString(), outcomeId: Number(log.args.outcomeId) });
}
const wildcardEvents = [];
if (live.wildcards) {
  const drawn = parseAbiItem("event WildcardDrawn(uint256 indexed drawId, uint256 indexed friendId, uint8 points)");
  for (const log of await getLogs(live.wildcards, drawn)) wildcardEvents.push({ friendId: log.args.friendId.toString(), points: Number(log.args.points) });
}
const friendIds = [...new Set([...settledEvents, ...wildcardEvents].map(e => e.friendId))];

// Bootroom perk tiers, read at the report's end block (a lace that expired before it gives tier 0).
// Progression only: they are published (XP bonus, cosmetics, next week's Cup seeding) and never
// enter the drop or race maths.
const notes = [];
const perks = {};
if (live.bootroom) {
  const abi = parseAbi(["function perkTier(uint256) view returns (uint8)"]);
  for (const id of friendIds) perks[id] = Number(await client.readContract({ address: live.bootroom, abi, functionName: "perkTier", args: [BigInt(id)], blockNumber: to }));
} else notes.push("No Bootroom in deployments/live.json: every Friend at perk tier 0.");

// Drop vault budget for the week: capOf(week) − released[week], read at the end block.
let week = args.week !== undefined ? Number(args.week) : undefined, releasedWei = 0n;
if (live.dropVault) {
  const abi = parseAbi(["function currentWeek() view returns (uint256)", "function released(uint256) view returns (uint256)", "function capOf(uint256) view returns (uint256)"]);
  if (week === undefined) week = Number(await client.readContract({ address: live.dropVault, abi, functionName: "currentWeek", blockNumber: to }));
  releasedWei = await client.readContract({ address: live.dropVault, abi, functionName: "released", args: [BigInt(week)], blockNumber: to });
  const onchainCap = await client.readContract({ address: live.dropVault, abi, functionName: "capOf", args: [BigInt(week)] });
  if (onchainCap !== dropBudget(week).capWei) throw new Error(`drop vault capOf(${week}) = ${onchainCap} does not match the v2 schedule`);
} else notes.push("No dropVault in deployments/live.json: budget from the v2 schedule, nothing released yet.");
week ??= 0;
const budget = dropBudget(week, releasedWei);

// Edge to split: --edge-rf, or the RF sitting in the EdgeSplitter now.
let edgeWei = args["edge-rf"] ? parseEther(args["edge-rf"]) : 0n;
if (!args["edge-rf"] && live.edgeSplitter && live.rf) edgeWei = await client.readContract({ address: live.rf, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [live.edgeSplitter] });

// Rewards season budget (RewardsDistributor): min(halving ceiling, previous season's sink burns, vault balance).
let rewards = null;
if (live.rewards) {
  const abi = parseAbi(["function currentSeason() view returns (uint256)", "function seasonCeiling(uint256) view returns (uint256)", "function sinkBurned(uint256) view returns (uint256)", "function seasons(uint256) view returns (bool set, uint128 budget, uint128 paid)"]);
  const read = (functionName, args = []) => client.readContract({ address: live.rewards, abi, functionName, args, blockNumber: to });
  const season = await read("currentSeason");
  const [ceiling, burnedPrev, [set, seasonBudget, paid]] = await Promise.all([read("seasonCeiling", [season]), season > 0n ? read("sinkBurned", [season - 1n]) : 0n, read("seasons", [season])]);
  rewards = { season: Number(season), ceilingWei: ceiling.toString(), sinkBurnedPrevWei: burnedPrev.toString(), set, budgetWei: seasonBudget.toString(), paidWei: paid.toString() };
} else notes.push("No RewardsDistributor in deployments/live.json: no $GBOOT rewards budget to report.");

const { rows, cup: cupRows, scale, wanted, seeding } = computeWeek({ settled: settledEvents, wildcards: wildcardEvents, base, potRf: Number(args["pot-rf"] ?? 0), perks, budget: budget.left });
const wallets = await Promise.all(rows.map(row => client.readContract({ address: GENERATIONS, abi: parseAbi(["function tokenBoundAccount(uint256) view returns (address)"]), functionName: "tokenBoundAccount", args: [BigInt(row.friendId)] })));
rows.forEach((row, index) => { row.wallet = wallets[index]; });
const cup = cupRows.map(row => ({ ...row, wallet: rows.find(r => r.friendId === row.friendId)?.wallet }));
const split = edgeSplit(edgeWei);
const output = {
  dryRun: true, blocks: [from.toString(), to.toString()], base, twap: twap ?? null, vaultWeek: week,
  dropBudget: { capWei: budget.capWei.toString(), releasedWei: releasedWei.toString(), left: budget.left, wanted, scale },
  edgeSplit: { totalWei: edgeWei.toString(), burnWei: split.burn.toString(), buybackWei: split.buyback.toString(), cupWei: split.cup.toString() },
  drops: rows, cup, seeding, rewards, wildcards: wildcardEvents.length, notes,
};
await writeFile(`weekly-${from}-${to}.json`, JSON.stringify(output, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(`## Week blocks ${from}–${to} (vault week ${week})\n`);
console.log(`Drop base: ${JSON.stringify(base)}${twap ? ` (TWAP ${twap} RF)` : " (launch schedule)"} · Friends: ${rows.length} · Balls settled: ${rows.reduce((s, r) => s + r.balls, 0)} · Wildcard draws: ${wildcardEvents.length}\n`);
console.log(budgetLines(week, releasedWei).join("\n"));
console.log(`Drops wanted ${fmt(wanted)} → paid ${fmt(rows.reduce((s, r) => s + r.drops, 0))}${scale < 1 ? ` (cap binds: every Friend ×${scale.toFixed(4)})` : ""}\n`);
if (rewards) console.log(`Rewards season ${rewards.season}: ceiling ${fmt(formatEther(BigInt(rewards.ceilingWei)))}, previous season's sink burns ${fmt(formatEther(BigInt(rewards.sinkBurnedPrevWei)))}, budget ${rewards.set ? fmt(formatEther(BigInt(rewards.budgetWei))) : "not set yet (setSeasonBudget is permissionless)"}, paid ${fmt(formatEther(BigInt(rewards.paidWei)))} $GBOOT.\n`);
console.log("| Rank | Friend | Race pts | Perk tier (not a multiplier) | Cup share | RF |\n|---:|---|---:|---:|---:|---:|");
for (const row of cup) console.log(`| ${row.rank} | #${row.friendId} | ${fmt(row.points)} | ${row.perkTier} | ${row.shareBps / 100}% | ${row.rf.toLocaleString("en-US")} |`);
console.log(`\nNext week's Cup seeding (perk tier, then friendId; display and draw order only): ${seeding.slice(0, 20).map(r => `#${r.friendId} (T${r.perkTier})`).join(", ") || "—"}`);
console.log("\n" + splitLines(edgeWei).join("\n"));
for (const note of notes) console.log(`\nNote: ${note}`);
console.log(`\nWritten: weekly-${from}-${to}.json (dry run; nothing sent)`);
