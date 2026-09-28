import type { SimEconomy, TxProgress } from "./sim-economy.ts";
import { WalletError, type Balance, type FriendRef, type Hex, type LoginMethod, type WalletKind, type WalletSnapshot } from "./types.ts";

/** Listener plumbing and the simulated-economy helpers every provider shares. */
export abstract class ProviderBase {
  abstract readonly kind: WalletKind;
  abstract readonly label: string;
  readonly economy: SimEconomy;
  protected state: Omit<WalletSnapshot, "kind"> = { status: "logged-out", address: null, method: null, accountHint: null };
  private listeners = new Set<(snapshot: WalletSnapshot) => void>();

  constructor(economy: SimEconomy) {
    this.economy = economy;
    economy.subscribe(() => this.emit());
  }

  snapshot(): WalletSnapshot { return { kind: this.kind, ...this.state }; }
  getAddress(): Hex | null { return this.state.status === "logged-in" ? this.state.address : null; }
  onChange(callback: (snapshot: WalletSnapshot) => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }
  protected set(next: Partial<Omit<WalletSnapshot, "kind">>) { this.state = { ...this.state, ...next }; this.emit(); }
  protected emit() { const snapshot = this.snapshot(); for (const listener of [...this.listeners]) listener(snapshot); }
  protected requireAddress(): Hex {
    const address = this.getAddress();
    if (!address) throw new WalletError("not-logged-in", "Log in first.");
    return address;
  }
  protected loggedIn(address: Hex, method: LoginMethod, accountHint: string | null) {
    this.set({ status: "logged-in", address, method, accountHint });
  }

  // ── The simulated economy (RF top-ups, Friend loan, hardwire): identical for every provider in the test app ──
  // SDK v0.2.1 INTEGRATION POINT: buyRF (payments), loanFriend / claimOwnedFriend (the loaned Friend) and hardwire are
  // simulated here for every provider. loanFriend, claimOwnedFriend and hardwire are NOT on the WalletProvider interface
  // (types.ts); a v0.2.1 provider must supply them (apps/mobile/web/src/app.tsx calls them). docs/HANDOFF-RF.md.
  async getBalance(): Promise<Balance> { return { rf: this.economy.balance(this.requireAddress()), simulated: true }; }
  async buyRF(amountUsd: number) { return this.economy.buyRF(this.requireAddress(), amountUsd); }
  loanFriend(): Promise<FriendRef> { return this.economy.loanFriend(this.requireAddress()); }
  claimOwnedFriend(): Promise<FriendRef> { return this.economy.claimOwnedFriend(this.requireAddress()); }
  hardwire(friendId: string, onProgress?: (p: TxProgress) => void) { return this.economy.hardwire(this.requireAddress(), friendId, onProgress); }
  /** Wipes this test account's simulated data (RF, Friends, transactions) and logs out. */
  async resetTestAccount() {
    const address = this.getAddress();
    if (address) this.economy.reset(address);
    await this.logout();
  }
  abstract logout(): Promise<void>;
}

/** "p•••@example.test": never the full address, never a name. */
export function maskEmail(email: string) {
  const [user = "", domain = ""] = email.trim().toLowerCase().split("@");
  return `${user.slice(0, 1) || "?"}•••@${domain || "?"}`;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
