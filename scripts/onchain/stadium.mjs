// Deploy and fund one stadium's FriendSDK ChanceGame using the SDK's own contract source and
// deploy code (deployGame / fundDeployment from the package's scripts/contracts/deploy.mjs).
//   node scripts/onchain/stadium.mjs <park|pro|champions> <stakeRF> [--send]
// Without --send it only rehearses on a fork. Writes games/penalty-kings/deployments/<tier>.json
// (public fields only) after a confirmed mainnet deployment.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseUnits } from "viem";
import { parseChanceGame, maximumPrize } from "@rarefriends/friendsdk/game";
import { rehearseThenSend, forgeBuild } from "./lib.mjs";

const SDK = new URL("../../node_modules/@rarefriends/friendsdk/", import.meta.url);
const { deployGame, fundDeployment } = await import(new URL("scripts/contracts/deploy.mjs", SDK));
const { artifact, MAINNET } = await import(new URL("scripts/contracts/common.mjs", SDK));

const [tier, stakeArg] = process.argv.slice(2);
if (!["park", "pro", "champions"].includes(tier) || !/^\d+$/.test(stakeArg ?? "")) throw new Error("usage: stadium.mjs <park|pro|champions> <stakeRF> [--send]");
const definition = parseChanceGame(JSON.parse(await readFile(new URL(`../../games/penalty-kings/tiers/${tier}.json`, import.meta.url), "utf8")));
const stake = parseUnits(stakeArg, 18);
if (stake < maximumPrize(definition)) throw new Error("stake must cover the top prize");

forgeBuild(new URL("contracts", SDK).pathname);
const built = await artifact();

const manifest = await rehearseThenSend(`stadium:${tier}`, async ({ client, wallet, account, mainnet, plan, sent }) => {
  const saves = [];
  const save = async value => { saves.push(structuredClone(value)); };
  const deployed = await deployGame({ client, wallet, account, definition, built, initialStake: stake, save });
  const funded = await fundDeployment({ client, wallet, account, abi: built.abi, manifest: deployed, save });
  for (const [index, tx] of funded.transactions.entries()) {
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    if (!mainnet) plan({ purpose: `${tier} ChanceGame ${tx.step}`, to: index === 0 ? "(create)" : tx.step === "approval" ? MAINNET.rf : funded.game, fn: tx.step === "deploy" ? "constructor" : tx.step === "approval" ? "approve" : "fund", args: tx.step === "deploy" ? `${definition.name}` : `${stakeArg} RF`, gas: receipt.gasUsed.toString() });
    else await sent(`${tier} ChanceGame ${tx.step}`, receipt);
  }
  // Verify state: price, top prize, free stake.
  const read = functionName => client.readContract({ address: funded.game, abi: built.abi, functionName });
  const [price, maxPrize, freeStake] = await Promise.all([read("price"), read("maxPrize"), read("freeStake")]);
  if (price !== definition.price || maxPrize !== maximumPrize(definition) || freeStake !== stake) throw new Error(`FREEZE: ${tier} game state mismatch`);
  const receipt = await client.getTransactionReceipt({ hash: funded.transactions[0].hash });
  return { chainId: 4663, game: funded.game, rf: MAINNET.rf, generations: MAINNET.generations, entropy: MAINNET.entropy, provider: MAINNET.provider, deploymentBlock: receipt.blockNumber.toString() };
});

if (manifest) {
  await mkdir(new URL("../../games/penalty-kings/deployments/", import.meta.url), { recursive: true });
  await writeFile(new URL(`../../games/penalty-kings/deployments/${tier}.json`, import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote games/penalty-kings/deployments/${tier}.json`);
}
