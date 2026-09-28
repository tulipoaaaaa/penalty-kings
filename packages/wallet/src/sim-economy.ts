/**
 * The simulated test economy shared by every provider in the TEST APP: RF top-ups, the Friend loan,
 * the hardwire, fake transactions and the failure injector. Nothing here touches a chain, a payment
 * processor or a key. Fake transaction hashes are keccak256("SIMULATED:…") and every result carries
 * `simulated: true`, so the UI labels them.
 */
import { getAddress, keccak256, stringToHex } from "viem";
import { FIXTURE_FRIEND_ID, GENERATIONS, ROBINHOOD_CHAIN, rfForUsd } from "./chain.ts";
import { readJson, writeJson, memoryStorage, type StorageAdapter } from "./storage.ts";
import { WalletError, ERROR_COPY, type FailureKind, type FriendRef, type Hex, type IdentityReadClient, type TxResult } from "./types.ts";

export const STORAGE_PREFIX = "pk-test-wallet:v1";

/** Which injected failures can happen during which operation (others stay armed for a later step). */
export const FAILURES_FOR = {
  login: ["offline", "cancelled"],
  payment: ["declined", "cancelled", "offline"],
  sign: ["rejected", "cancelled", "offline"],
  tx: ["rejected", "cancelled", "offline"],
  friend: ["offline", "cancelled"],
} as const satisfies Record<string, readonly FailureKind[]>;
export type SimOperation = keyof typeof FAILURES_FOR;

/** The dev menu's failure injector: arm one failure for the next matching step, or keep it on ("always"). */
export class FailureInjector {
  private armed: { kind: FailureKind; always: boolean } | null = null;
  private listeners = new Set<() => void>();
  set(kind: FailureKind | null, mode: "next" | "always" = "next") { this.armed = kind ? { kind, always: mode === "always" } : null; this.emit(); }
  current() { return this.armed ? { ...this.armed } : null; }
  /** Throws the armed failure if it applies to this operation (consuming a "next" failure). */
  check(operation: SimOperation, isOnline: () => boolean = () => true) {
    if (!isOnline() && (FAILURES_FOR[operation] as readonly FailureKind[]).includes("offline")) throw simulatedError("offline");
    const armed = this.armed;
    if (!armed || !(FAILURES_FOR[operation] as readonly FailureKind[]).includes(armed.kind)) return;
    if (!armed.always) { this.armed = null; this.emit(); }
    throw simulatedError(armed.kind);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
}

export const simulatedError = (kind: FailureKind) => new WalletError(kind, `${ERROR_COPY[kind]} [SIMULATED]`);

export type SimEconomyOptions = {
  storage?: StorageAdapter;
  /** Fake network delay for payments and transactions (ms). */
  delayMs?: number;
  /** USD per RF (the app passes the game's on-chain snapshot price). */
  usdPerRf?: () => number | null;
  sleep?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
  failures?: FailureInjector;
};

type AccountState = { rf: bigint; friends: FriendRef[]; nonce: number; txs: { hash: Hex; label: string; at: number }[] };
const EMPTY = (): AccountState => ({ rf: 0n, friends: [], nonce: 0, txs: [] });

/** A deterministic 20-byte address from a test seed (never a key: nothing can sign for it). */
export function deriveTestAddress(seed: string): Hex {
  return getAddress(`0x${keccak256(stringToHex(`penalty-kings-test-account:${seed}`)).slice(-40)}`) as Hex;
}

export type TxProgress = { stage: "signing" | "sending" | "confirming" | "confirmed"; progress: number };

export class SimEconomy {
  readonly storage: StorageAdapter;
  readonly failures: FailureInjector;
  private readonly delayMs: number;
  private readonly usdPerRf: () => number | null;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly isOnline: () => boolean;
  private listeners = new Set<() => void>();

  constructor(options: SimEconomyOptions = {}) {
    this.storage = options.storage ?? memoryStorage();
    this.failures = options.failures ?? new FailureInjector();
    this.delayMs = options.delayMs ?? 600;
    this.usdPerRf = options.usdPerRf ?? (() => null);
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.isOnline = options.isOnline ?? (() => (typeof navigator === "undefined" || navigator.onLine !== false));
  }

  private key(address: string) { return `${STORAGE_PREFIX}:account:${address.toLowerCase()}`; }
  hasAccount(address: string) { return this.storage.get(this.key(address)) !== null; }
  account(address: string): AccountState { return readJson<AccountState>(this.storage, this.key(address)) ?? EMPTY(); }
  private save(address: string, state: AccountState) { writeJson(this.storage, this.key(address), state); this.emit(); }
  /** Creates the (empty) account record: the "Creating your wallet…" step. */
  create(address: string) { if (!this.hasAccount(address)) this.save(address, EMPTY()); }
  reset(address: string) { this.storage.remove(this.key(address)); this.emit(); }

  check(operation: SimOperation) { this.failures.check(operation, this.isOnline); }
  quote(usd: number) { const price = this.usdPerRf(); if (price === null) throw new WalletError("offline", "No RF price available."); return rfForUsd(usd, price); }

  /** A fake transaction: failure check, staged fake delay, a hash that says SIMULATED. */
  async fakeTx(address: string, label: string, onProgress?: (p: TxProgress) => void): Promise<TxResult> {
    onProgress?.({ stage: "signing", progress: 0.1 });
    this.check("tx");
    const step = Math.max(0, Math.round(this.delayMs / 3));
    onProgress?.({ stage: "sending", progress: 0.4 }); await this.sleep(step);
    if (!this.isOnline()) throw simulatedError("offline");
    onProgress?.({ stage: "confirming", progress: 0.75 }); await this.sleep(step);
    const state = this.account(address);
    const hash = keccak256(stringToHex(`SIMULATED:${address.toLowerCase()}:${state.nonce}:${label}`)) as Hex;
    state.nonce += 1; state.txs = [{ hash, label, at: Date.now() }, ...state.txs].slice(0, 20);
    this.save(address, state);
    onProgress?.({ stage: "confirmed", progress: 1 });
    return { hash, simulated: true };
  }

  async buyRF(address: string, amountUsd: number) {
    this.check("payment");
    const rf = this.quote(amountUsd);
    await this.sleep(this.delayMs);
    if (!this.isOnline()) throw simulatedError("offline");
    const tx = await this.fakeTx(address, `Buy ${amountUsd} USD of RF (simulated payment)`);
    const state = this.account(address); state.rf += rf; this.save(address, state);
    return { rf, tx };
  }

  balance(address: string) { return this.account(address).rf; }
  /** The game's preview ledger reports its balance back (packs bought in-game spend RF). */
  setBalance(address: string, rf: bigint) { const state = this.account(address); if (state.rf !== rf) { state.rf = rf; this.save(address, state); } }

  friends(address: string) { return this.account(address).friends; }
  private async addFriend(address: string, relation: FriendRef["relation"]) {
    this.check("friend");
    await this.sleep(Math.round(this.delayMs / 2));
    const state = this.account(address);
    const existing = state.friends.find(friend => friend.id === FIXTURE_FRIEND_ID);
    const friend: FriendRef = { id: FIXTURE_FRIEND_ID, label: `Friend #${FIXTURE_FRIEND_ID}`, relation, hardwired: existing?.hardwired ?? false, fixture: true, simulated: true };
    state.friends = [friend, ...state.friends.filter(value => value.id !== FIXTURE_FRIEND_ID)];
    this.save(address, state);
    return friend;
  }
  /** "Loan a Friend (free)": the SDK fixture Friend, simulated. */
  loanFriend(address: string) { return this.addFriend(address, "loaned"); }
  /** "I already own one" in the simulated wallet: the fixture Friend, marked owned (simulated). */
  claimOwnedFriend(address: string) { return this.addFriend(address, "owned"); }
  async hardwire(address: string, friendId: string, onProgress?: (p: TxProgress) => void) {
    if (!this.account(address).friends.some(friend => friend.id === friendId)) throw new WalletError("unsupported", `Friend #${friendId} is not in this test wallet.`);
    const tx = await this.fakeTx(address, `Hardwire Friend #${friendId}`, onProgress);
    const state = this.account(address);
    state.friends = state.friends.map(friend => (friend.id === friendId ? { ...friend, hardwired: true } : friend));
    this.save(address, state);
    return tx;
  }
  txs(address: string) { return this.account(address).txs; }

  /** Is this Friend a simulated, hardwired Friend of this address? (the identity client answers it locally) */
  simulatedOwner(address: string, friendId: string) {
    return this.account(address).friends.some(friend => friend.id === friendId && friend.hardwired && friend.simulated);
  }

  /**
   * The SDK ownership gate's reads, answered from the simulated ledger for simulated Friends. `fallback`
   * (a real public client, read-only) answers everything else; without one, other Friends are unowned.
   */
  identityClient(getAddress: () => Hex | null, fallback?: IdentityReadClient): IdentityReadClient {
    let block = 0x100000n;
    const NOBODY = "0x000000000000000000000000000000000000dEaD";
    return {
      getChainId: async () => ROBINHOOD_CHAIN.id,
      getBlockNumber: async args => (fallback ? fallback.getBlockNumber(args) : ++block),
      readContract: async args => {
        const address = getAddress();
        const tokenId = args.args?.[0];
        const id = typeof tokenId === "bigint" ? tokenId.toString() : String(tokenId);
        const simulated = address !== null && args.address.toLowerCase() === GENERATIONS.toLowerCase() && this.simulatedOwner(address, id);
        if (!simulated && fallback) return fallback.readContract(args);
        if (args.functionName === "ownerOf") return simulated ? address : NOBODY;
        if (args.functionName === "generation") return simulated ? 1 : 0;
        if (args.functionName === "tokenBoundAccount") return deriveTestAddress(`tba:${id}:${address ?? ""}`);
        if (args.functionName === "balanceOf") return BigInt(address ? this.account(address).friends.filter(f => f.hardwired).length : 0);
        throw new WalletError("unsupported", `Simulated identity client cannot answer ${args.functionName}.`);
      },
    };
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
}
