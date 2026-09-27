/**
 * Platform adapter: the ONLY seams the Rare Friends SDK v0.2.1 fork needs to fill.
 *
 * FOUNDER DECISION: we do not build onboarding. SDK v0.2.1 provides Google sign-up, embedded Privy
 * wallets, a semi-custodial loaned Friend, Apple/Google Pay and a managed Nakama backend. The game keeps
 * three thin interfaces with today's (SDK v0.1.2) behaviour behind them:
 *
 *   ┌──────────────┬─────────────────────────────────────────┬─────────────────────────────────────────┐
 *   │ seam         │ today (v0.1.2)                          │ INTEGRATION POINT (v0.2.1)              │
 *   ├──────────────┼─────────────────────────────────────────┼─────────────────────────────────────────┤
 *   │ Identity     │ GameComponentProps.friendId + client     │ same props; loaned Friends are just a   │
 *   │              │ (the SDK runtime verifies ownership)     │ friendId the runtime has verified       │
 *   │ Persistence  │ save code + localStorage when allowed    │ Nakama storage (per player, per game)   │
 *   │ Randomness   │ SDK play/settle (packs); engine seeds    │ the ~15 s public beacon                 │
 *   │              │ (penalties)                              │ (game/randomness.ts RandomnessSource)   │
 *   └──────────────┴─────────────────────────────────────────┴─────────────────────────────────────────┘
 *
 * Wallets, payments and sign-up never enter the game: the SDK runtime owns them outside the sandbox.
 */
import type { Progress } from "./progress.js";
import { encodeSaveCode, decodeSaveCode, canPersist } from "./savecode.js";
import { loadProgress, saveProgress } from "./progress.js";
import type { RandomnessSource } from "./randomness.js";
import { instantBeacon } from "./randomness.js";

/** Progression storage (never money). INTEGRATION POINT (v0.2.1): back this with Nakama storage objects. */
export interface ProgressStore {
  load(): Promise<Progress>;
  save(progress: Progress): Promise<boolean>;
  /** Portable copy for players without a backend (the preview's save code). */
  exportCode(progress: Progress): string;
  importCode(code: string): { ok: true; progress: Progress } | { ok: false; reason: string };
  /** True when progress survives a reload without a code. */
  readonly durable: boolean;
}

/** v0.1.2 store: localStorage when the browser allows it (not in the SDK sandbox), plus save codes. */
export function localProgressStore(friendId: bigint | string): ProgressStore {
  return {
    durable: canPersist(),
    load: async () => loadProgress(),
    save: async progress => saveProgress(progress),
    exportCode: progress => encodeSaveCode(progress, friendId),
    importCode: code => decodeSaveCode(code, friendId),
  };
}

/**
 * INTEGRATION POINT (v0.2.1): Nakama-backed store. The fork supplies `read`/`write` from its Nakama
 * client (storage collection "penalty-kings", key "progress", owner = the player). Kept as a factory so
 * this file never imports a backend SDK.
 */
export function remoteProgressStore(friendId: bigint | string, backend: { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> }): ProgressStore {
  const local = localProgressStore(friendId);
  return {
    durable: true,
    load: async () => { const raw = await backend.read(`progress:${friendId}`); if (!raw) return local.load(); const restored = decodeSaveCode(raw, friendId); return restored.ok ? restored.progress : local.load(); },
    save: async progress => { await backend.write(`progress:${friendId}`, encodeSaveCode(progress, friendId)); return true; },
    exportCode: local.exportCode,
    importCode: local.importCode,
  };
}

/** The platform the shell runs on. Defaults = today's behaviour; the fork swaps implementations. */
export type Platform = Readonly<{ progress: ProgressStore; randomness: RandomnessSource }>;
export const defaultPlatform = (friendId: bigint | string): Platform => ({ progress: localProgressStore(friendId), randomness: instantBeacon });
