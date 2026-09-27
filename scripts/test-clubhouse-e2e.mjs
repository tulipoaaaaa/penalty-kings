// END-TO-END test of the LIVE Clubhouse on a local fork of Robinhood mainnet (needs network).
// Real contracts (Launch.s.sol), the real referee code (local server), the real Clubhouse build,
// and a REAL hardwired Friend owner (#7730's current owner, impersonated on the fork only).
// Flow: connect → choose Friend → unlock a kit item (burn) → Skill Cup entry + 5 referee-judged
// kicks with a signed result → Wildcard draw request (Dice cannot fulfil on a private fork).
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, toHex, parseEther } from "viem";
import { buildClubhouse } from "./build-clubhouse.mjs";
import { launchEnv } from "./onchain/pool-plan.mjs";

const RPC = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const PORT = 8547, ANVIL = `http://127.0.0.1:${PORT}`, DEPLOYER = "0x00000000000000000000000000000000000de001";
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D", FRIEND = 7730n;
const children = [];
const stop = () => children.forEach(child => child.kill());
process.on("exit", stop);

const anvil = spawn("anvil", ["--fork-url", RPC, "--chain-id", "4663", "--port", String(PORT), "--auto-impersonate", "--silent"], { stdio: "ignore" });
children.push(anvil);
const client = createPublicClient({ transport: http(ANVIL) });
for (let i = 0; ; i++) { try { if ((await client.getChainId()) === 4663) break; } catch {} if (i > 60) throw new Error("anvil did not start"); await new Promise(r => setTimeout(r, 500)); }
const rpc = (method, params) => client.request({ method, params });
const owner = await client.readContract({ address: GENERATIONS, abi: parseAbi(["function ownerOf(uint256) view returns (address)"]), functionName: "ownerOf", args: [FRIEND] });
await rpc("anvil_setBalance", [DEPLOYER, toHex(parseEther("1"))]);
await rpc("anvil_setBalance", [owner, toHex(parseEther("1"))]);
console.log(`fork ready; Friend #${FRIEND} owner ${owner} (impersonated on the fork only)`);

// 1) Deploy the launch contracts with the real script.
const env = { ...process.env, ...Object.fromEntries(launchEnv(0n, 0n).map(line => line.split("="))) };
const out = execFileSync("forge", ["script", "script/Launch.s.sol", "--rpc-url", ANVIL, "--unlocked", "--sender", DEPLOYER, "--broadcast", "--slow", ...(process.env.SOLC ? ["--use", process.env.SOLC] : [])],
  { cwd: new URL("../contracts/", import.meta.url).pathname, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const grab = name => out.match(new RegExp(`${name}\\s+(0x[0-9a-fA-F]{40})`))?.[1];
const live = { gboot: grab("GBOOT"), kitShop: grab("KitShop"), skillCup: grab("SkillCup"), wildcards: grab("Wildcards") };
for (const [key, value] of Object.entries(live)) assert.ok(value, `deployed ${key}`);
console.log("deployed on fork:", live);
const gbootAbi = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const deployerWallet = createWalletClient({ account: { address: DEPLOYER, type: "json-rpc" }, transport: http(ANVIL) });
// v2: every non-pool $GBOOT sits in a capped vault; the operator releases Cup/event prizes from the Cups vault.
const cupsVault = grab("CupsVault");
assert.ok(cupsVault, "deployed CupsVault");
await client.waitForTransactionReceipt({ hash: await deployerWallet.writeContract({ address: cupsVault, abi: parseAbi(["function release(address,uint256)"]), functionName: "release", args: [owner, parseEther("500")], chain: null }) });
// Launch default: the sinks price through GBootFixedPrice (0.1 RF per $GBOOT; no hook, no TWAP). The
// 30-minute time skip is kept so the same test also covers a TWAP-priced (audited hook) deployment.
await rpc("evm_increaseTime", [toHex(31 * 60)]);
await rpc("evm_mine", []);

// 2) Referee (real Worker code) and the Clubhouse build.
const referee = spawn("node", ["--experimental-strip-types", "--no-warnings", "verifier/dev-server.ts", "--port", "8788", "--rpc", ANVIL, "--skill-cup", live.skillCup], { stdio: ["ignore", "inherit", "inherit"] });
children.push(referee);
const outdir = join(await mkdtemp(join(tmpdir(), "pk-club-")), "clubhouse");
await buildClubhouse(outdir, { ...live, refereeUrl: "http://127.0.0.1:8788", rpcUrl: ANVIL });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const file = join(outdir, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  try { const body = await readFile(file); res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }); res.end(body); } catch { res.writeHead(404); res.end(); }
}).listen(8790, "127.0.0.1");
await new Promise(r => setTimeout(r, 1500));

// 3) Drive the page with an injected provider that forwards to the fork (auto-impersonated owner).
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
await page.addInitScript(({ account, rpc }) => {
  let accounts = [];
  window.ethereum = {
    async request({ method, params }) {
      if (method === "eth_accounts") return accounts;
      if (method === "eth_requestAccounts") { accounts = [account]; return accounts; }
      if (method === "eth_chainId") return "0x1237";
      if (method === "wallet_switchEthereumChain") return null;
      const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const body = await response.json();
      if (body.error) throw Object.assign(new Error(body.error.message), body.error);
      return body.result;
    },
    on() {}, removeListener() {},
  };
}, { account: owner, rpc: ANVIL });
try {
  await page.goto("http://127.0.0.1:8790/");
  const button = name => page.getByRole("button", { name, exact: true });
  const confirmTx = async () => { await page.getByRole("dialog").waitFor(); await button("Confirm").click(); };
  await button("Connect wallet").click();
  await page.getByRole("button", { name: new RegExp(`^Friend #${FRIEND} `) }).click({ timeout: 120_000 });
  await button("Skill Cup").waitFor({ timeout: 60_000 });

  // Kit shop: unlock Volt boots (item 1: 0.6 RF = 6 $GBOOT at the fixed launch price, burned).
  const supplyBefore = await client.readContract({ address: live.gboot, abi: gbootAbi, functionName: "totalSupply" });
  const voltQuote = await client.readContract({ address: live.kitShop, abi: parseAbi(["function quote(uint256) view returns (uint256)"]), functionName: "quote", args: [1n] });
  assert.ok(voltQuote > parseEther("5.9") && voltQuote < parseEther("6.1"), `0.6 RF ≈ 6 $GBOOT at the launch price (${voltQuote})`);
  await button("Kit shop").click();
  await page.locator(".item").filter({ hasText: "Volt boots" }).getByRole("button").click();
  await confirmTx(); await confirmTx();
  await page.locator(".item").filter({ hasText: "Volt boots" }).getByText("unlocked").waitFor({ timeout: 60_000 });
  const unlocked = await client.readContract({ address: live.kitShop, abi: parseAbi(["function unlocked(uint256,uint256) view returns (bool)"]), functionName: "unlocked", args: [FRIEND, 1n] });
  assert.equal(unlocked, true, "KitShop unlock recorded on-chain");
  assert.equal(supplyBefore - await client.readContract({ address: live.gboot, abi: gbootAbi, functionName: "totalSupply" }), voltQuote, "the quote was burned");
  console.log(`PASS kit unlock: on-chain, ${voltQuote} wei $GBOOT (0.6 RF at the launch price) burned`);

  // Skill Cup: on-chain entry, then 5 flicks judged by the referee.
  await button("Skill Cup").click();
  await button("Enter · 10 RF in $GBOOT").click();
  await confirmTx(); await confirmTx();
  const canvas = page.locator(".pitch canvas");
  await canvas.waitFor({ timeout: 60_000 });
  for (let kick = 0; kick < 5; kick++) {
    if (kick > 0) await page.waitForTimeout(7000); // the pitch ignores swipes while the previous kick is still playing
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const sx = box.x + box.width * 0.5, sy = box.y + box.height * (246 / 320);
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(sx + (kick % 2 ? -1 : 1) * i * box.width * 0.012, sy - i * box.height * 0.035);
    await page.mouse.up();
    await page.getByText(kick < 4 ? `Kick ${kick + 2} of 5` : "Shootout complete.").waitFor({ timeout: 30_000 });
  }
  await page.getByText("signed by the referee").waitFor({ timeout: 30_000 });
  const board = await (await fetch("http://127.0.0.1:8788/leaderboard")).json();
  assert.equal(board.length, 1); assert.equal(board[0].friendId, FRIEND.toString());
  console.log(`PASS Skill Cup: on-chain entry, 5 referee-judged kicks, signed score ${board[0].score}`);

  // Wildcard: pays 10 RF in $GBOOT (100 $GBOOT at the fixed launch price) + Dice fee; the request is on-chain (delivery needs the live provider).
  await button("Wildcards").click();
  await button("Draw a wildcard").click();
  await confirmTx(); await confirmTx();
  await page.getByText(/waiting for Dice randomness/).waitFor({ timeout: 60_000 });
  console.log("PASS Wildcard: paid and requested Dice randomness on-chain");
  assert.deepEqual(errors, [], `page errors: ${errors.join("\n")}`);
  console.log("PASS clubhouse end-to-end on a mainnet fork");
} catch (error) {
  await page.screenshot({ path: "artifacts/clubhouse-e2e-failure.png", fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close(); server.close(); stop();
}
