/**
 * PrivyProvider — Privy's official headless JS SDK (@privy-io/js-sdk-core, pinned 0.76.2) behind the
 * WalletProvider interface: email one-time-code login, Google OAuth login (redirect), embedded wallet
 * creation, personal_sign and eth_sendTransaction on Robinhood Chain (4663).
 *
 * OFF unless the build has WALLET=privy AND a PRIVY_APP_ID (public app id, injected at build time, never
 * committed; no secret exists in the client). The app falls back to DevSimulatedProvider otherwise.
 * The UI is ours (no Privy modal/branding). RF top-up, Friend loan and hardwire stay simulated in the
 * test build; real transactions are OFF unless `allowTransactions` (never in the test app).
 *
 * The founder's SDK v0.2.1 can replace this file entirely: the seam is the WalletProvider interface.
 */
import { toHex } from "viem";
import { ProviderBase, isEmail, maskEmail } from "./base.ts";
import { ROBINHOOD_CHAIN, explorerTx } from "./chain.ts";
import { mapProviderError, type Eip1193 } from "./injected.ts";
import { readChainFriends, realPublicClient, robinhood, type ChainFriendsReader } from "./real-chain.ts";
import { SimEconomy, type SimEconomyOptions } from "./sim-economy.ts";
import { WalletError, type FriendRef, type Hex, type IdentityReadClient, type LoginMethod, type LoginOptions, type TxRequest, type TxResult, type WalletProvider } from "./types.ts";

/** Pinned SDK version (package.json devDependencies, exact). */
export const PRIVY_SDK_VERSION = "0.76.2";

// ── The slice of @privy-io/js-sdk-core this provider uses (typed locally so tests can mock it) ──
type PrivyUser = { id: string; linked_accounts?: unknown[] } & Record<string, unknown>;
export type PrivyClientLike = {
  initialize(): Promise<void>;
  setMessagePoster(poster: { postMessage(message: unknown, targetOrigin: string, transfer?: Transferable): void; reload(): void }): void;
  auth: {
    email: { sendCode(email: string): Promise<unknown>; loginWithCode(email: string, code: string): Promise<PrivyUser> };
    oauth: { generateURL(provider: "google", redirectURI: string): Promise<{ url: string }>; loginWithCode(code: string, state: string, provider?: "google"): Promise<PrivyUser> };
    logout(o?: { userId?: string }): Promise<void>;
  };
  user: { get(): Promise<{ user: PrivyUser | null }> };
  embeddedWallet: {
    create(opts: Record<string, unknown>): Promise<PrivyUser>;
    getURL(): string;
    onMessage(event: unknown): void;
    getEthereumProvider(args: { wallet: unknown; entropyId: string; entropyIdVerifier: unknown }): Promise<Eip1193>;
  };
};
export type PrivySdk = {
  createClient(appId: string): PrivyClientLike;
  getUserEmbeddedEthereumWallet(user: PrivyUser | null): { address: string } | null;
  getEntropyDetailsFromUser(user: PrivyUser | null): { entropyId: string; entropyIdVerifier: unknown } | null;
};

/** The real SDK, loaded only in a WALLET=privy build (a separate chunk). */
export async function loadPrivySdk(): Promise<PrivySdk> {
  const sdk = await import("@privy-io/js-sdk-core");
  const Privy = sdk.default;
  return {
    createClient: appId => new Privy({ appId, storage: new sdk.LocalStorage(), supportedChains: [robinhood] as never }) as unknown as PrivyClientLike,
    getUserEmbeddedEthereumWallet: user => sdk.getUserEmbeddedEthereumWallet(user as never),
    getEntropyDetailsFromUser: user => sdk.getEntropyDetailsFromUser(user as never) as never,
  };
}

/** Browser wiring of the embedded wallet's secure iframe (Privy's documented js-sdk-core web setup). */
export function mountPrivyIframe(client: PrivyClientLike) {
  const iframe = document.createElement("iframe");
  iframe.src = client.embeddedWallet.getURL();
  iframe.title = "Embedded wallet";
  iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const listener = (event: MessageEvent) => { if (event.source === iframe.contentWindow) client.embeddedWallet.onMessage(event.data); };
  window.addEventListener("message", listener);
  client.setMessagePoster({
    postMessage: (message, origin, transfer) => iframe.contentWindow?.postMessage(message, origin, transfer ? [transfer] : undefined),
    reload: () => { iframe.src = client.embeddedWallet.getURL(); },
  });
  return () => { window.removeEventListener("message", listener); iframe.remove(); };
}

export type PrivyOptions = SimEconomyOptions & {
  appId: string;
  economy?: SimEconomy;
  loadSdk?: () => Promise<PrivySdk>;
  mountIframe?: (client: PrivyClientLike) => () => void;
  /** Where Google OAuth returns to (defaults to the current page). */
  redirectUri?: () => string;
  /** Reads the OAuth return (privy_oauth_code / privy_oauth_state) from the URL. */
  readOAuthReturn?: () => { code: string; state: string } | null;
  navigate?: (url: string) => void;
  chainFriends?: ChainFriendsReader;
  identityFallback?: () => IdentityReadClient;
  allowTransactions?: boolean;
};

export class PrivyProvider extends ProviderBase implements WalletProvider {
  readonly kind = "privy" as const;
  readonly label = "Privy embedded wallet";
  private readonly options: PrivyOptions;
  private client: PrivyClientLike | null = null;
  private sdk: PrivySdk | null = null;
  private eth: Eip1193 | null = null;
  private user: PrivyUser | null = null;
  private unmount: (() => void) | null = null;

  constructor(options: PrivyOptions) {
    super(options.economy ?? new SimEconomy(options));
    if (!options.appId) throw new WalletError("misconfigured", "PrivyProvider needs a PRIVY_APP_ID.");
    this.options = options;
  }

  private async ready(): Promise<{ client: PrivyClientLike; sdk: PrivySdk }> {
    if (this.client && this.sdk) return { client: this.client, sdk: this.sdk };
    try {
      this.sdk = await (this.options.loadSdk ?? loadPrivySdk)();
      this.client = this.sdk.createClient(this.options.appId);
      this.unmount = (this.options.mountIframe ?? mountPrivyIframe)(this.client);
      await this.client.initialize();
    } catch (error) { this.client = null; throw mapProviderError(error, "cancelled"); }
    return { client: this.client, sdk: this.sdk };
  }

  /** Restores a Privy session after reload, and completes a Google OAuth redirect if the URL carries one. */
  async restore() {
    const { client } = await this.ready();
    const oauth = (this.options.readOAuthReturn ?? readOAuthFromUrl)();
    if (oauth) { await this.login("google"); return; }
    const { user } = await client.user.get().catch(() => ({ user: null }));
    if (user) await this.finish(user, "email");
  }

  async login(method: LoginMethod, opts: LoginOptions = {}): Promise<Hex> {
    if (method === "injected") throw new WalletError("unsupported", "Use the browser-wallet provider for injected wallets.");
    const { client } = await this.ready();
    this.set({ status: "logging-in" });
    try {
      let user: PrivyUser;
      if (method === "email") {
        if (!opts.email || !isEmail(opts.email)) throw new WalletError("bad-code", "Enter an email address.");
        opts.onProgress?.("sending-code");
        await client.auth.email.sendCode(opts.email.trim());
        const code = (await (opts.getCode?.() ?? Promise.reject(new WalletError("cancelled", "No code entered.")))).trim();
        opts.onProgress?.("verifying");
        user = await client.auth.email.loginWithCode(opts.email.trim(), code).catch(error => { throw new WalletError("bad-code", "That code didn't work.", { cause: error }); });
        this.state = { ...this.state, accountHint: maskEmail(opts.email) };
      } else {
        const back = (this.options.readOAuthReturn ?? readOAuthFromUrl)();
        if (!back) {
          opts.onProgress?.("redirecting");
          const { url } = await client.auth.oauth.generateURL("google", (this.options.redirectUri ?? (() => location.href.split("?")[0]))());
          (this.options.navigate ?? (target => location.assign(target)))(url);
          throw new WalletError("cancelled", "Continuing with Google…");
        }
        user = await client.auth.oauth.loginWithCode(back.code, back.state, "google");
        this.state = { ...this.state, accountHint: "Google account" };
      }
      return await this.finish(user, method, opts);
    } catch (error) {
      this.set({ status: "logged-out", address: null, method: null });
      throw mapProviderError(error, "cancelled");
    }
  }

  /** Creates the embedded wallet on first login, then loads its EIP-1193 provider. */
  private async finish(user: PrivyUser, method: LoginMethod, opts: LoginOptions = {}): Promise<Hex> {
    const { client, sdk } = await this.ready();
    let wallet = sdk.getUserEmbeddedEthereumWallet(user);
    if (!wallet) {
      opts.onProgress?.("creating-wallet");
      user = await client.embeddedWallet.create({});
      wallet = sdk.getUserEmbeddedEthereumWallet(user);
      if (!wallet) throw new WalletError("unsupported", "Privy did not return an embedded wallet.");
    }
    const entropy = sdk.getEntropyDetailsFromUser(user);
    if (!entropy) throw new WalletError("unsupported", "Privy wallet has no entropy details.");
    this.eth = await client.embeddedWallet.getEthereumProvider({ wallet, ...entropy });
    this.user = user;
    this.loggedIn(wallet.address as Hex, method, this.state.accountHint ?? "Privy account");
    opts.onProgress?.("done");
    return wallet.address as Hex;
  }

  async logout() {
    try { await this.client?.auth.logout({ userId: this.user?.id }); } catch { /* local state is cleared anyway */ }
    this.eth = null; this.user = null;
    this.set({ status: "logged-out", address: null, method: null, accountHint: null });
  }

  dispose() { this.unmount?.(); this.unmount = null; }

  private provider(): Eip1193 { if (!this.eth) throw new WalletError("not-logged-in", "Log in first."); return this.eth; }

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

export function readOAuthFromUrl(): { code: string; state: string } | null {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  const code = params.get("privy_oauth_code"), state = params.get("privy_oauth_state");
  return code && state ? { code, state } : null;
}
