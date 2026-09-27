// Fails on anything that looks like a wallet secret:
//  • 12+ consecutive BIP-39 English words (a mnemonic), and
//  • any 0x + 64-hex string (a private key) that is not in scripts/hex-allowlist.txt
//    (allowlisted: public tx hashes, pool ids, bytes32 constants).
// Usage: node scripts/secret-scan.mjs           (all tracked files)
//        node scripts/secret-scan.mjs --staged  (staged content, for the pre-commit hook)
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { english } from "viem/accounts";

const words = new Set(english);
const allow = new Set(existsSync("scripts/hex-allowlist.txt")
  ? readFileSync("scripts/hex-allowlist.txt", "utf8").split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => /^0x[0-9a-f]{64}$/.test(line)) : []);
const staged = process.argv.includes("--staged");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const files = (staged ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR") : git("ls-files")).split("\n").filter(Boolean)
  .filter(file => !/\.(tgz|png|jpg|webp|woff2|mp3|wav)$/i.test(file) && file !== "package-lock.json")
  // Vendored upstream Solidity (OpenZeppelin, forge-std) pinned by contracts/lib/provenance.json: its bytes32 constants are public.
  .filter(file => !file.startsWith("contracts/lib/"));
const problems = [];
for (const file of files) {
  let text;
  try { text = staged ? git("show", `:${file}`) : readFileSync(file, "utf8"); } catch { continue; }
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)) {
      if (!allow.has(match[0].toLowerCase())) problems.push(`${file}:${index + 1}: 32-byte hex not in scripts/hex-allowlist.txt (${match[0].slice(0, 10)}…)`);
    }
    // A mnemonic is 12/15/18/21/24 lowercase BIP-39 words separated by single spaces.
    for (const match of line.matchAll(/[a-z]+(?: [a-z]+){11,}/g)) {
      let run = 0;
      for (const token of match[0].split(" ")) { run = words.has(token) ? run + 1 : 0; if (run >= 12) break; }
      if (run >= 12) { problems.push(`${file}:${index + 1}: 12+ space-separated BIP-39 words (possible mnemonic)`); break; }
    }
  });
}
if (problems.length) { console.error(`SECRET SCAN FAILED\n${problems.join("\n")}`); process.exit(1); }
console.log(`PASS secret-scan: ${files.length} ${staged ? "staged " : ""}files clean`);
