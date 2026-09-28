/**
 * InjectedProvider — the existing desktop path: an EIP-1193 browser wallet (window.ethereum / EIP-6963),
 * the same provider shape FriendSDK v0.1.2's GameHost uses (`FriendWalletProvider`). Owned Friends and the
 * ownership gate are read from Robinhood Chain (read-only); the RF top-up, Friend loan and hardwire stay in
 * the simulated test economy. Real transactions are OFF unless `allowTransactions` is set (never in the
 * test app).
 */
import { toHex } from "viem";
import { ProviderBase } from "./base.ts";
import { ROBINHOOD_CHAIN, explorerTx } from "./chain.ts";
import { readChainFriends, realPublicClient, type ChainFriendsReader } from "./real-chain.ts";
import { SimEconomy, type SimEconomyOptions } from "./sim-economy.ts";
import { WalletError, type FriendRef, type Hex, type IdentityReadClient, type LoginMethod, type TxRequest, type TxResult, type WalletProvider } from "./types.ts";

/** EIP-1193 (the subset FriendSDK's FriendWalletProvider requires). */
export type Eip1193 = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
};

export type InjectedOptions = SimEconomyOptions & {
  economy?: SimEconomy;
  /** Defaults to window.ethereum. */
  getProvider?: () => Eip1193 | undefined;
  chainFriends?: ChainFriendsReader;
  identityFallback?: () => IdentityReadClient;
  /** Real eth_sendTransaction. False in every test build. */
  allowTransactions?: boolean;
};

/** Maps EIP-1193 errors (4001 user rejected, offline fetch failures) to WalletError codes. */
export function mapProviderError(error: unknown, fallback: "rejected" | "cancelled" = "rejected"): WalletError {
  if (error instanceof WalletError) return error;
  const code = (error as { code?: number })?.code;
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  if (code === 4001 || /reject|denied/i.test(message)) return new WalletError(fallback, "Rejected in your wallet.", { cause: error });
  if (/network|fetch|offline|timeout/i.test(message)) return new WalletError("offline", "Network error.", { cause: error });
  return new WalletError("unsupported", message, { cause: error });
}

export class InjectedProvider extends ProviderBase implements WalletProvider {
  readonly kind = "injected" as const;
  readonly label = "Browser wallet";
  private readonly options: InjectedOptions;
  private detach: (() => void) | null = null;

  constructor(options: InjectedOptions = {}) {
    super(options.economy ?? new SimEconomy(options));
    this.options = options;
  }

  private provider(): Eip1193 {
    const provider = this.options.getProvider?.() ?? (globalThis as { ethereum?: Eip1193 }).ethereum;
    if (!provider) throw new WalletError("no-wallet", "No browser wallet found on this device.");
    return provider;
  }

  /** Silent reconnect (eth_accounts, no prompt) after a reload. */
  async restore() {
    try {
      const accounts = await this.provider().request({ method: "eth_accounts" }) as string[];
      if (accounts?.[0]) { this.attach(); this.loggedIn(accounts[0] as Hex, "injected", "Browser wallet"); }
    } catch { /* no wallet: stay logged out */ }
  }

  async login(method: LoginMethod): Promise<Hex> {
    if (method !== "injected") throw new WalletError("unsupported", "A browser wallet logs in with the wallet itself, not email or Google.");
    const provider = this.provider();
    this.set({ status: "logging-in" });
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new WalletError("cancelled", "No account shared.");
      await this.ensureChain(provider);
      this.attach();
      this.loggedIn(accounts[0] as Hex, "injected", "Browser wallet");
      return accounts[0] as Hex;
    } catch (error) {
      this.set({ status: "logged-out", address: null, method: null, accountHint: null });
      throw mapProviderError(error, "cancelled");
    }
  }

  private async ensureChain(provider: Eip1193) {
    const chainId = await provider.request({ method: "eth_chainId" });
    if (typeof chainId === "string" && chainId.toLowerCase() === ROBINHOOD_CHAIN.hexId) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_CHAIN.hexId }] });
    } catch (error) {
      if ((error as { code?: number })?.code !== 4902) throw new WalletError("wrong-network", "Switch your wallet to Robinhood Chain (4663).", { cause: error });
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ROBINHOOD_CHAIN.hexId, chainName: ROBINHOOD_CHAIN.name,
        nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency, rpcUrls: [ROBINHOOD_CHAIN.rpcUrl], blockExplorerUrls: [ROBINHOOD_CHAIN.explorer] }] });
    }
  }

  private attach() {
    if (this.detach) return;
    const provider = this.provider();
    const onAccounts = (accounts: string[]) => {
      if (accounts?.[0]) this.loggedIn(accounts[0] as Hex, "injected", "Browser wallet");
      else this.set({ status: "logged-out", address: null, method: null, accountHint: null });
    };
    provider.on?.("accountsChanged", onAccounts);
    this.detach = () => provider.removeListener?.("accountsChanged", onAccounts);
  }

  async logout() {
    this.detach?.(); this.detach = null;
    // EIP-1193 has no standard disconnect; the app forgets the account (wallet_revokePermissions where supported).
    try { await this.provider().request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch { /* optional */ }
    this.set({ status: "logged-out", address: null, method: null, accountHint: null });
  }

  async getFriends(): Promise<FriendRef[]> {
    const address = this.requireAddress();
    const simulated = this.economy.friends(address);
    let real: FriendRef[] = [];
    try { real = await (this.options.chainFriends ?? readChainFriends)(address); }
    catch (error) { if (!simulated.length) throw mapProviderError(error); }
    return [...simulated, ...real.filter(friend => !simulated.some(value => value.id === friend.id))];
  }

  async signMessage(message: string): Promise<Hex> {
    const address = this.requireAddress();
    try { return await this.provider().request({ method: "personal_sign", params: [toHex(message), address] }) as Hex; }
    catch (error) { throw mapProviderError(error); }
  }

  async sendTransaction(tx: TxRequest): Promise<TxResult> {
    const address = this.requireAddress();
    if (!this.options.allowTransactions) throw new WalletError("blocked", "Real transactions are switched off in the test build.");
    try {
      const hash = await this.provider().request({ method: "eth_sendTransaction", params: [{ from: address, to: tx.to, data: tx.data,
        value: tx.value === undefined ? undefined : toHex(tx.value), chainId: ROBINHOOD_CHAIN.hexId }] }) as Hex;
      return { hash, simulated: false, explorerUrl: explorerTx(hash) };
    } catch (error) { throw mapProviderError(error); }
  }

  identityClient(): IdentityReadClient {
    return this.economy.identityClient(() => this.getAddress(), (this.options.identityFallback ?? realPublicClient)());
  }
}
