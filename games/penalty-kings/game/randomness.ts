/**
 * The two random rolls (see docs/RNG-INTEGRATION.md). Rare Friends' SDK v0.2.1 supplies a public random
 * beacon every ~15 s; this module is the game-side contract for it.
 *
 *  Roll 1 — PACK: one beacon value decides the rarity of every ball in a bought pack (on-chain, the
 *           ChanceGame / founder contract does this; the client only animates the settled result).
 *  Roll 2 — PENALTY: the player's shot is COMMITTED first (a hash of the sanitized input), then the next
 *           beacon value is mixed with that commitment to seed ONLY the keeper's dive. The engine is
 *           deterministic from (input, seed), so skill decides the shot and randomness decides the keeper.
 *
 * The preview has no beacon: `simulatedBeacon(delayMs)` stands in for it (any delay 0–15 s), and
 * `instantBeacon` gives today's behaviour. Nothing here changes odds or payouts.
 */
import type { ShotInput } from "@penalty-kings/engine";

export type Hex32 = `0x${string}`;
export type Beacon = Readonly<{ round: number; value: Hex32 }>;
export type RollKind = "pack" | "penalty";

/** Where randomness comes from. The SDK v0.2.1 adapter implements this over the real beacon. */
export interface RandomnessSource {
  /** Resolves with the first beacon published AFTER `commitment` was fixed (never an earlier one). */
  next(kind: RollKind, commitment: Hex32, signal?: AbortSignal): Promise<Beacon>;
  /** Expected wait for UI pacing (ms). A beacon every ~15 s → 0–15 000. */
  expectedWaitMs(): number;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
async function sha256(text: string): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))); }

/** Canonical form of a shot (fixed key order, 4-decimal rounding) so the client and referee hash the same bytes. */
export function canonicalShot(shot: ShotInput) {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return JSON.stringify({ aimX: r(shot.aimX), aimY: r(shot.aimY), power: r(shot.power), curl: r(shot.curl) });
}

/** The commitment to a kick: SHA-256 of (friend, session, kick index, canonical shot). Fixed BEFORE the beacon. */
export async function commitShot(shot: ShotInput, context: { friendId: string; sessionId: string; kickIndex: number }): Promise<Hex32> {
  return `0x${hex(await sha256(`${context.friendId}|${context.sessionId}|${context.kickIndex}|${canonicalShot(shot)}`))}`;
}

/** Keeper dive seed (uint32): the first 4 bytes of SHA-256(beacon value ‖ commitment). */
export async function keeperSeed(beacon: Beacon, commitment: Hex32): Promise<number> {
  const digest = await sha256(`${beacon.value}|${commitment}`);
  return ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
}

/** Pack roll helper for the preview/animation: per-ball uniform draws from one beacon (index-separated). */
export async function packDraws(beacon: Beacon, commitment: Hex32, count: number): Promise<number[]> {
  const draws: number[] = [];
  for (let i = 0; i < count; i++) { const d = await sha256(`${beacon.value}|${commitment}|${i}`); draws.push((((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0) / 2 ** 32); }
  return draws;
}

let simulatedRound = 0;
const randomHex = (): Hex32 => { const b = new Uint8Array(32); crypto.getRandomValues(b); return `0x${hex(b)}`; };

/** Preview stand-in: resolves after `delayMs` (0 = instant). Labelled SIMULATED in the UI. */
export function simulatedBeacon(delayMs: number | (() => number)): RandomnessSource {
  const wait = () => (typeof delayMs === "function" ? delayMs() : delayMs);
  return {
    expectedWaitMs: () => wait(),
    next: (_kind, _commitment, signal) => new Promise((resolve, reject) => {
      const ms = Math.max(0, wait());
      const done = () => resolve({ round: ++simulatedRound, value: randomHex() });
      if (ms === 0) { done(); return; }
      const id = setTimeout(done, ms);
      signal?.addEventListener("abort", () => { clearTimeout(id); reject(new DOMException("aborted", "AbortError")); }, { once: true });
    }),
  };
}
export const instantBeacon = simulatedBeacon(0);

/** Suspense beats for a wait of `ms` (UI pacing): short waits skip straight to the payoff. */
export function suspenseBeats(ms: number) {
  if (ms < 800) return ["payoff"] as const;
  if (ms < 5000) return ["warm-up", "drumroll", "payoff"] as const;
  return ["warm-up", "mind-games", "drumroll", "hush", "payoff"] as const;
}
