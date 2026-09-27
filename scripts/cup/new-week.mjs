// Generates a Skill Cup week secret and referee signing key, OUTSIDE the repo.
// Prints only public values (the secret's hash and the public key). The private values are
// written to ~/.penalty-kings/week-<n>/ (chmod 600) for `wrangler secret put`, and the secret is
// revealed publicly in docs/WEEKLY.md after the week ends.
//   node scripts/cup/new-week.mjs <week>
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const week = Number(process.argv[2]);
if (!Number.isInteger(week) || week < 1) throw new Error("usage: node scripts/cup/new-week.mjs <week>");
const secret = crypto.getRandomValues(new Uint8Array(32));
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const hash = "0x" + hex(await crypto.subtle.digest("SHA-256", secret));
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
const dir = join(homedir(), ".penalty-kings", `week-${week}`);
await mkdir(dir, { recursive: true, mode: 0o700 });
await writeFile(join(dir, "WEEK_SECRET"), hex(secret), { mode: 0o600 });
await writeFile(join(dir, "SIGNING_KEY"), JSON.stringify(privateJwk), { mode: 0o600 });
await chmod(dir, 0o700);
console.log(JSON.stringify({ week, secretHash: hash, publicKey: publicJwk }, null, 2));
console.log(`\nPrivate values written to ${dir} (not printed). Upload with:\n  npx wrangler secret put WEEK_SECRET < ${dir}/WEEK_SECRET\n  npx wrangler secret put SIGNING_KEY < ${dir}/SIGNING_KEY`);
