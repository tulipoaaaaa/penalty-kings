// Generates the referee's long-lived reward-signing key (secp256k1), OUTSIDE the repo.
// Its ADDRESS is RewardsDistributor.referee (pass it to Launch.s.sol as REFEREE_SIGNER); the key is
// uploaded to the referee Worker as the REWARD_KEY secret. Unlike the weekly P-256 key
// (new-week.mjs), it cannot rotate without redeploying the distributor, so keep it offline.
// Prints only the address. The key is written to ~/.penalty-kings/reward-signer/REWARD_KEY (chmod 600).
//   node scripts/cup/reward-signer.mjs
import { mkdir, writeFile, chmod, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const dir = join(homedir(), ".penalty-kings", "reward-signer");
const file = join(dir, "REWARD_KEY");
if (await access(file).then(() => true, () => false)) throw new Error(`${file} already exists; refusing to overwrite a signer the distributor may already trust.`);
const key = generatePrivateKey();
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(file, key, { mode: 0o600 });
await chmod(dir, 0o700);
console.log(JSON.stringify({ rewardSigner: privateKeyToAccount(key).address }, null, 2));
console.log(`\nKey written to ${file} (not printed). Use the address as REFEREE_SIGNER for Launch.s.sol, then:\n  npx wrangler secret put REWARD_KEY < ${file}`);
