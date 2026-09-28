/**
 * The wallet seam of the Penalty Kings TEST APP (apps/mobile/web). Every provider — the default
 * DevSimulatedProvider, the Privy embedded wallet, the injected browser wallet, and later the founder's
 * SDK v0.2.1 — implements this one interface; the app never talks to a wallet SDK directly.
 * See docs/WALLETS.md ("Test app wallet seam").
 */
export type Hex = `0x${string}`;
export type LoginMethod = "email" | "google" | "injected";
export type WalletKind = "dev-simulated" | "privy" | "injected";

export type LoginOptions = {
  /** Email login: the address the one-time code goes to. */
  email?: string;
  /** Email login: asked for the 6-digit code once it has been sent (the UI shows the code screen). */
  getCode?: () => Promise<string>;
  /** Progress lines for the UI ("Sending code…", "Creating your wallet…"). */
  onProgress?: (step: LoginStep) => void;
};
export type LoginStep = "sending-code" | "verifying" | "redirecting" | "creating-wallet" | "done";

export type TxRequest = {
  to: Hex;
  data?: Hex;
  value?: bigint;
  /** Human label shown on the progress screen, e.g. "Hardwire Friend #7730". */
  label?: string;
};
export type TxResult = {
  hash: Hex;
  /** True for every DevSimulated transaction: the hash is fake and nothing was broadcast. */
  simulated: boolean;
  explorerUrl?: string;
};

export type Balance = {
  /** RF in wei (18 decimals). */
  rf: bigint;
  /** True when the RF figure comes from the simulated test ledger, not the chain. */
  simulated: boolean;
};

export type FriendRef = {
  id: string;
  label: string;
  /** "loaned": a free test loan; "owned": the player says they own it (simulated) or the chain says so. */
  relation: "loaned" | "owned";
  hardwired: boolean;
  /** The SDK fixture Friend (#7730) whose recorded art the test app reuses. */
  fixture: boolean;
  simulated: boolean;
};

export type WalletSnapshot = {
  kind: WalletKind;
  status: "logged-out" | "logging-in" | "logged-in";
  address: Hex | null;
  method: LoginMethod | null;
  /** A masked account hint for the UI (never a real name), e.g. "p•••@example.test". */
  accountHint: string | null;
};

/** Read-only identity client for the SDK's ConnectedGameHost (viem PublicClient subset). */
export type IdentityReadClient = {
  getChainId(): Promise<number>;
  getBlockNumber(args?: { cacheTime?: number }): Promise<bigint>;
  readContract(args: { address: Hex; abi: unknown; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<any>;
};

export interface WalletProvider {
  readonly kind: WalletKind;
  /** Short UI label, e.g. "Test wallet (simulated)". */
  readonly label: string;
  login(method: LoginMethod, opts?: LoginOptions): Promise<Hex>;
  logout(): Promise<void>;
  getAddress(): Hex | null;
  getBalance(): Promise<Balance>;
  getFriends(): Promise<FriendRef[]>;
  signMessage(message: string): Promise<Hex>;
  sendTransaction(tx: TxRequest): Promise<TxResult>;
  /** Top up RF with dollars. Simulated in every test build (see docs/WALLETS.md). */
  buyRF(amountUsd: number): Promise<{ rf: bigint; tx: TxResult }>;
  onChange(callback: (snapshot: WalletSnapshot) => void): () => void;
  snapshot(): WalletSnapshot;
  /** The identity client the game host uses for the SDK's ownership gate. */
  identityClient(): IdentityReadClient;
}

export type FailureKind = "declined" | "rejected" | "offline" | "cancelled";
export type WalletErrorCode = FailureKind | "not-logged-in" | "bad-code" | "unsupported" | "blocked" | "no-wallet" | "wrong-network" | "misconfigured";

/** Every provider error the UI can show (with retry) carries one of these codes. */
export class WalletError extends Error {
  readonly code: WalletErrorCode;
  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WalletError";
    this.code = code;
  }
}

export const isWalletError = (value: unknown, code?: WalletErrorCode): value is WalletError =>
  value instanceof WalletError && (code === undefined || value.code === code);

/** Friendly copy for each error code (the onboarding screens show it with a Retry button). */
export const ERROR_COPY: Record<WalletErrorCode, string> = {
  declined: "Payment declined (simulated). No money moved.",
  rejected: "Signature rejected. Nothing was signed.",
  offline: "You look offline. Check your connection and try again.",
  cancelled: "Cancelled. You can try again whenever you like.",
  "not-logged-in": "Log in first.",
  "bad-code": "That code didn't work. Check it and try again.",
  unsupported: "Not available with this wallet in the test build.",
  blocked: "Real transactions are switched off in the test build.",
  "no-wallet": "No browser wallet found on this device.",
  "wrong-network": "Switch your wallet to Robinhood Chain (4663).",
  misconfigured: "This wallet isn't configured for this build.",
};
