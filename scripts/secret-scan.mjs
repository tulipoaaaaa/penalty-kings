// Fails on anything that looks like a wallet secret:
//  • 12+ consecutive BIP-39 English words (a mnemonic), and
//  • any 0x + 64-hex string (a private key) that is not in scripts/hex-allowlist.txt
//    (allowlisted: public tx hashes, pool ids, bytes32 constants), and
//  • any personal string listed (hashed) in scripts/blocklist.sha256 — in files and, for a full
//    scan, in every commit message and author/committer name.
// Usage: node scripts/secret-scan.mjs           (all tracked files)
//        node scripts/secret-scan.mjs --staged  (staged content, for the pre-commit hook)
//        node scripts/secret-scan.mjs --hash "token"  (prints the line to add to the blocklist)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { english } from "viem/accounts";

const blockHash = token => createHash("sha256").update(`penalty-kings/blocklist/v1:${token.toLowerCase()}`).digest("hex");
if (process.argv.includes("--hash")) { console.log(blockHash(process.argv[process.argv.indexOf("--hash") + 1] ?? "")); process.exit(0); }
const blocked = new Set(existsSync("scripts/blocklist.sha256")
  ? readFileSync("scripts/blocklist.sha256", "utf8").split(/\r?\n/).map(line => line.trim()).filter(line => /^[0-9a-f]{64}$/.test(line)) : []);
const blockedIn = text => {
  for (const match of text.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+|[a-z0-9_]+/g)) if (blocked.has(blockHash(match[0]))) return true;
  return false;
};
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
    if (blockedIn(line)) problems.push(`${file}:${index + 1}: blocked personal string (scripts/blocklist.sha256)`);
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
if (!staged) {
  // History metadata: personal strings must not appear in commit messages or identities either.
  git("log", "--all", "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e").split("\x1e").forEach(entry => {
    const [hash, ...rest] = entry.trim().split("\x00");
    if (hash && blockedIn(rest.join("\n"))) problems.push(`commit ${hash.slice(0, 10)}: blocked personal string in message or identity`);
  });
}
if (problems.length) { console.error(`SECRET SCAN FAILED\n${problems.join("\n")}`); process.exit(1); }
console.log(`PASS secret-scan: ${files.length} ${staged ? "staged " : ""}files clean`);
