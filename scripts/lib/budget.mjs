// Hard spend caps for every mainnet transaction. Scripts must call `authorize` before sending
// and `record` after the receipt. The ledger lives outside the repo (~/.penalty-kings/spend.json).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const RESERVE_WEI = 3_000_000_000_000_000n; // 0.003 ETH always left in the burner
export const MAX_SLIPPAGE_BPS = 300n;               // 3%
const DIR = join(homedir(), ".penalty-kings"), FILE = join(DIR, "spend.json");

export async function loadLedger() {
  try { const raw = JSON.parse(await readFile(FILE, "utf8")); return { fundedWei: BigInt(raw.fundedWei), spentWei: BigInt(raw.spentWei), rfSwapCaps: raw.rfSwapCaps ?? {}, entries: raw.entries ?? [] }; }
  catch { return { fundedWei: 0n, spentWei: 0n, rfSwapCaps: {}, entries: [] }; }
}
async function save(ledger) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(FILE, JSON.stringify(ledger, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2), { mode: 0o600 });
}
/** Set once when the owner funds the burner (and the per-step RF swap plan). */
export async function setFunding(fundedWei, rfSwapCaps) { const ledger = await loadLedger(); ledger.fundedWei = fundedWei; ledger.rfSwapCaps = rfSwapCaps; await save(ledger); }

/** Throws unless the tx fits: cumulative ETH (value + max gas) ≤ funded − reserve; swaps within plan and slippage. */
export async function authorize({ step, valueWei = 0n, gasLimit, maxFeePerGas, rfSwapOut, minOut, quoteOut }) {
  const ledger = await loadLedger();
  if (ledger.fundedWei === 0n) throw new Error("BUDGET: funding not recorded; refusing to send.");
  const worst = valueWei + BigInt(gasLimit) * BigInt(maxFeePerGas);
  if (ledger.spentWei + worst > ledger.fundedWei - RESERVE_WEI) throw new Error(`BUDGET: ${step} would exceed funded − 0.003 ETH reserve.`);
  if (rfSwapOut !== undefined) {
    const cap = ledger.rfSwapCaps[step];
    if (cap === undefined || BigInt(rfSwapOut) > BigInt(cap)) throw new Error(`BUDGET: RF swap ${step} exceeds its planned cap.`);
    if (minOut === undefined || quoteOut === undefined || BigInt(minOut) * 10000n < BigInt(quoteOut) * (10000n - MAX_SLIPPAGE_BPS)) throw new Error(`BUDGET: ${step} minOut is looser than 3% slippage from a fresh quote.`);
  }
  return worst;
}
export async function record({ step, hash, spentWei }) {
  const ledger = await loadLedger();
  ledger.spentWei += BigInt(spentWei); ledger.entries.push({ step, hash, spentWei: String(spentWei), at: new Date().toISOString() });
  await save(ledger);
}
