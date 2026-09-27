// Loads the burner signer for chain scripts. Order: BURNER_MNEMONIC env → Foundry keystore
// "pk-burner" (password in ~/.burner-pass). Never logs, prints or writes the secret.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

export function loadBurner() {
  const mnemonic = process.env.BURNER_MNEMONIC?.trim();
  if (mnemonic) return mnemonicToAccount(mnemonic);
  // Password passed via environment (not argv), output captured in memory only.
  const password = readFileSync(join(homedir(), ".burner-pass"), "utf8").trim();
  const key = execFileSync("cast", ["wallet", "decrypt-keystore", "pk-burner"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, CAST_UNSAFE_PASSWORD: password } }).match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (!key) throw new Error("Burner keystore could not be decrypted.");
  return privateKeyToAccount(key);
}
export const BURNER_ADDRESS_FILE = join(homedir(), ".penalty-kings", "burner-address");
