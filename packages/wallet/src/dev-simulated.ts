/**
 * DevSimulatedProvider — the DEFAULT provider of the test app. Everything is simulated:
 * - the address is derived from a test account id (email or the fixed Google test account), never a key;
 * - "any 6-digit code" logs in (dev mode);
 * - RF, the Friend loan and the hardwire live in the SimEconomy (persisted through a storage adapter);
 * - signatures and transaction hashes are keccak256("SIMULATED:…") and flagged `simulated: true`.
 */
import { keccak256, stringToHex } from "viem";
import { ProviderBase, isEmail, maskEmail, normalizeEmail } from "./base.ts";
import { SimEconomy, deriveTestAddress, STORAGE_PREFIX, type SimEconomyOptions } from "./sim-economy.ts";
import { readJson, writeJson } from "./storage.ts";
import { WalletError, type Hex, type IdentityReadClient, type LoginMethod, type LoginOptions, type TxRequest, type TxResult, type WalletProvider } from "./types.ts";

const SESSION_KEY = `${STORAGE_PREFIX}:session`;
type Session = { address: Hex; method: LoginMethod; accountHint: string };

export type DevSimulatedOptions = SimEconomyOptions & { economy?: SimEconomy };

export class DevSimulatedProvider extends ProviderBase implements WalletProvider {
  readonly kind = "dev-simulated" as const;
  readonly label = "Test wallet (simulated)";

  constructor(options: DevSimulatedOptions = {}) {
    super(options.economy ?? new SimEconomy(options));
    const session = readJson<Session>(this.economy.storage, SESSION_KEY);
    if (session?.address && this.economy.hasAccount(session.address)) this.state = { status: "logged-in", ...session };
  }

  async login(method: LoginMethod, opts: LoginOptions = {}): Promise<Hex> {
    const previous = this.state;
    this.set({ status: "logging-in" });
    try {
      this.economy.check("login");
      let seed: string, hint: string;
      if (method === "email") {
        if (!opts.email || !isEmail(opts.email)) throw new WalletError("bad-code", "Enter an email address.");
        seed = `email:${normalizeEmail(opts.email)}`; hint = maskEmail(opts.email);
        opts.onProgress?.("sending-code");
        const code = (await (opts.getCode?.() ?? Promise.reject(new WalletError("cancelled", "No code entered.")))).trim();
        opts.onProgress?.("verifying");
        this.economy.check("login");
        if (!/^\d{6}$/.test(code)) throw new WalletError("bad-code", "Enter the 6-digit code.");
      } else if (method === "google") {
        seed = "google:test-account"; hint = "Google test account";
        opts.onProgress?.("redirecting");
      } else {
        seed = "injected:test-account"; hint = "Simulated browser wallet";
      }
      const address = deriveTestAddress(seed);
      if (!this.economy.hasAccount(address)) { opts.onProgress?.("creating-wallet"); this.economy.create(address); }
      writeJson(this.economy.storage, SESSION_KEY, { address, method, accountHint: hint } satisfies Session);
      this.loggedIn(address, method, hint);
      opts.onProgress?.("done");
      return address;
    } catch (error) {
      this.set(previous.status === "logging-in" ? { status: "logged-out" } : previous);
      throw error;
    }
  }

  async logout() {
    this.economy.storage.remove(SESSION_KEY);
    this.set({ status: "logged-out", address: null, method: null, accountHint: null });
  }

  async getFriends() { return this.economy.friends(this.requireAddress()); }

  async signMessage(message: string): Promise<Hex> {
    const address = this.requireAddress();
    this.economy.check("sign");
    // A fake 65-byte "signature": deterministic, obviously not ECDSA (it cannot be verified by anyone).
    const body = keccak256(stringToHex(`SIMULATED-SIGNATURE:${address}:${message}`)).slice(2);
    return `0x${body}${body}1b` as Hex;
  }

  async sendTransaction(tx: TxRequest): Promise<TxResult> {
    const address = this.requireAddress();
    return this.economy.fakeTx(address, tx.label ?? `Transaction to ${tx.to}`);
  }

  identityClient(): IdentityReadClient { return this.economy.identityClient(() => this.getAddress()); }
}
