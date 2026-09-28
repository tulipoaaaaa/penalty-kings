/**
 * Provider selection. The build decides the default (WALLET=dev|privy|injected, PRIVY_APP_ID); a hidden dev
 * menu (5 taps on the version number, test builds only) can switch at runtime. Privy needs BOTH the flag
 * and an App ID: without one the app falls back to the simulated wallet and shows a banner saying so.
 */
import { DevSimulatedProvider } from "./dev-simulated.ts";
import { InjectedProvider } from "./injected.ts";
import { PrivyProvider, type PrivyOptions } from "./privy.ts";
import { SimEconomy } from "./sim-economy.ts";
import { STORAGE_PREFIX } from "./sim-economy.ts";
import type { StorageAdapter } from "./storage.ts";
import type { WalletProvider } from "./types.ts";

export type WalletChoice = "dev" | "privy" | "injected";
export const WALLET_CHOICES: readonly WalletChoice[] = ["dev", "privy", "injected"];

export type BuildWalletConfig = {
  /** WALLET build flag. */
  wallet: WalletChoice;
  /** PRIVY_APP_ID at build time (a public id, never a secret; never committed). */
  privyAppId: string | null;
  /** Only test builds get the dev menu and runtime switching. */
  testBuild: boolean;
};

export const OVERRIDE_KEY = `${STORAGE_PREFIX}:provider-override`;

export function parseChoice(value: unknown): WalletChoice | null {
  return typeof value === "string" && (WALLET_CHOICES as readonly string[]).includes(value) ? value as WalletChoice : null;
}

/** Which provider runs, and the banner to show when the requested one cannot. */
export function resolveWalletChoice(build: BuildWalletConfig, override: WalletChoice | null = null): { choice: WalletChoice; requested: WalletChoice; banner: string | null } {
  const requested = (build.testBuild ? override : null) ?? build.wallet;
  if (requested === "privy" && !build.privyAppId) {
    return { choice: "dev", requested, banner: "Privy is off in this build (no PRIVY_APP_ID). Using the simulated test wallet." };
  }
  return { choice: requested, requested, banner: null };
}

export type ProviderDeps = {
  economy: SimEconomy;
  privyAppId: string | null;
  privy?: Partial<PrivyOptions>;
};

export type AnyProvider = (DevSimulatedProvider | PrivyProvider | InjectedProvider) & WalletProvider;

export function createProvider(choice: WalletChoice, deps: ProviderDeps): AnyProvider {
  if (choice === "privy" && deps.privyAppId) return new PrivyProvider({ ...deps.privy, appId: deps.privyAppId, economy: deps.economy });
  if (choice === "injected") return new InjectedProvider({ economy: deps.economy });
  return new DevSimulatedProvider({ economy: deps.economy });
}

export const readOverride = (storage: StorageAdapter) => parseChoice(storage.get(OVERRIDE_KEY));
export const writeOverride = (storage: StorageAdapter, choice: WalletChoice | null) => (choice ? storage.set(OVERRIDE_KEY, choice) : storage.remove(OVERRIDE_KEY));
