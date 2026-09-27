/**
 * FD-3b: the waits for randomness (see game/randomness.ts). The founder's SDK v0.2.1 beacon lands every
 * ~15 s, so a roll can take 0–15 s. This module is the ONE game-side path for both rolls plus the pure
 * pacing the Stage and the shell use to make that wait fun. Nothing here changes odds, payouts or what a
 * reveal shows: the penalty's keeper seed comes from (beacon, commitment) only, and a pack reveal is a
 * pure function of the settled rarities (the ethics rule in game/reveal.ts).
 *
 *  PENALTY  the shot is fixed → commitShot → THEN the beacon is requested → keeperSeed → resolveShot.
 *  PACK     the SDK's play + settle is the roll (the preview can add a simulated beacon delay on top).
 *
 * Instant randomness (the preview default) adds no timer at all: only the hashing (microseconds).
 */
import { suspenseBeats, commitShot, keeperSeed, type Beacon, type Hex32, type RandomnessSource } from "./randomness.js";
import type { ShotInput } from "@penalty-kings/engine";

/** Penalties whose keeper dive is seeded by the beacon: free play penalties and the Big Match. */
export const BEACON_MODES: readonly string[] = ["penalties", "match"];
/** The Skill Cup keeps the referee's seed path; the tutorial, World Tour and Daily keep their fixed seeds (Daily is the same for everyone). */
export const usesBeacon = (mode: string) => BEACON_MODES.includes(mode);

export type KeeperRoll = Readonly<{ commitment: Hex32; beacon: Beacon; seed: number }>;
/** Aborted waits reject with this (a DOMException named "AbortError"). */
export const isAbort = (error: unknown) => error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string } | null)?.name === "AbortError";
const abortError = () => new DOMException("aborted", "AbortError");

/**
 * Roll 2, the ONE path for beacon penalties: commit the (already fixed) shot, THEN ask for the first
 * beacon after that commitment, THEN mix them into the keeper seed. `onCommitted` fires before the
 * beacon is requested (the UI starts its wait there). Rejects with an AbortError when `signal` aborts.
 */
export async function rollKeeper(shot: ShotInput, context: { friendId: string; sessionId: string; kickIndex: number }, source: RandomnessSource,
  signal?: AbortSignal, onCommitted?: (commitment: Hex32) => void): Promise<KeeperRoll> {
  if (signal?.aborted) throw abortError();
  const commitment = await commitShot(shot, context);
  if (signal?.aborted) throw abortError();
  onCommitted?.(commitment);
  const beacon = await source.next("penalty", commitment, signal);
  if (signal?.aborted) throw abortError();
  const seed = await keeperSeed(beacon, commitment);
  if (signal?.aborted) throw abortError();
  return { commitment, beacon, seed };
}

/** Roll 1 in the preview: the settled plays are the roll; this waits for the (simulated) beacon on top. */
export async function packCommitment(playIds: readonly (string | number | bigint)[], context: { friendId: string }): Promise<Hex32> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${context.friendId}|pack|${playIds.map(String).join(",")}`)));
  return `0x${Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")}`;
}

// ── Wait pacing (pure; the Stage draws it, the tests read it) ────────────────────────────────
/** Nothing shows for this long, so an instant (or near-instant) beacon never flashes a wait on screen. */
export const WAIT_GRACE_MS = 250;
export type WaitCue = Readonly<{
  /** 0 = nothing to show yet (instant beacons stay here). */
  visible: boolean;
  /** Ball warm-up glow / pack glow, 0–1 (grows with the wait). */
  warm: number;
  /** Crowd drumroll level, 0 (off) – 1 (the hush before the payoff). */
  drumroll: number;
  /** Keeper mind-games (taunt, sway, glove claps, a Director moment): long waits only. */
  mindGames: boolean;
  /** The last stretch: the crowd hushes, heartbeat. */
  hush: boolean;
  /** "The keeper is deciding…" copy (long waits, or any wait that runs past 2.5 s). */
  deciding: boolean;
  /** Suspense meter fill 0–1 (never full before the beacon lands), or null when hidden. */
  meter: number | null;
}>;

/**
 * What the wait shows `elapsedMs` into a wait expected to take `expectedMs`. A wait that runs longer
 * than expected upgrades itself (the beats follow suspenseBeats(max(expected, elapsed))).
 */
export function waitCue(elapsedMs: number, expectedMs: number): WaitCue {
  const t = Math.max(0, elapsedMs), span = Math.max(expectedMs, t), beats = suspenseBeats(span) as readonly string[];
  if (t < WAIT_GRACE_MS) return { visible: false, warm: 0, drumroll: 0, mindGames: false, hush: false, deciding: false, meter: null };
  const long = beats.includes("mind-games");
  // Progress towards the expected arrival; unknown (0 s expected, but late): an easing curve that never reaches 1.
  const progress = expectedMs > 0 ? Math.min(0.94, t / expectedMs) : 0.94 * (1 - Math.exp(-t / 5000));
  const warm = Math.min(1, 0.25 + progress * 0.85);
  const drumStart = long ? Math.min(expectedMs * 0.35, 5000) : 400;
  const hushFrom = long ? Math.max(expectedMs - 2500, expectedMs * 0.8) : Infinity;
  const hush = long && t >= hushFrom;
  const drumroll = beats.includes("drumroll") && t >= drumStart ? Math.min(1, hush ? 1 : 0.3 + progress * 0.7) : 0;
  return { visible: true, warm, drumroll, mindGames: long, hush, deciding: long ? t >= 1500 : t >= 2500, meter: t >= 400 ? progress : null };
}

/** Timed one-off beats inside a wait (seconds): the Stage fires each once as the wait passes it. */
export const WAIT_EVENTS = { taunt: 1.0, directorMoment: 3.0, clapEvery: 1.8, clapFrom: 2.0, drumTickEvery: 0.45 } as const;

// ── Pack reveal sequencing (pure function of the SETTLED rarities) ──────────────────────────
export type PackStep = Readonly<{
  /** Card index in the pack. */
  index: number;
  /** The settled rarity this step shows (0 Scuffed … 6 Golden Boot): the only rarity ever drawn for it. */
  shows: number;
  /** Milliseconds after the sequence starts. */
  at: number;
  /** The best ball: a pause and a building sting before it, then the Stage's full reveal (revealPlan). */
  best: boolean;
}>;
export type PackSequence = Readonly<{ steps: readonly PackStep[]; stingAt: number | null; stingMs: number; stingLevel: number; total: number }>;

/**
 * Lowest to highest (ties in card order), a pause with a building sting, then the best ball. The sting's
 * strength rises with the TRUE best rarity (like revealPlan's tier) and never shows another rarity.
 * `waitedMs` (how long the roll took) only paces the ceremony: a long wait earns a slightly longer build.
 */
export function packRevealSequence(rarities: readonly number[], waitedMs = 0): PackSequence {
  if (!rarities.length) return { steps: [], stingAt: null, stingMs: 0, stingLevel: 0, total: 0 };
  for (const rarity of rarities) if (!Number.isInteger(rarity) || rarity < 0 || rarity > 6) throw new Error(`invalid settled rarity ${rarity}`);
  const long = (suspenseBeats(waitedMs) as readonly string[]).includes("drumroll");
  const gap = long ? 600 : 450, stingMs = long ? 1100 : 750;
  const order = rarities.map((shows, index) => ({ index, shows })).sort((a, b) => a.shows - b.shows || a.index - b.index);
  const steps: PackStep[] = [];
  let at = 300;
  order.forEach((card, i) => {
    const best = i === order.length - 1;
    if (best) { steps.push({ ...card, at: at + stingMs, best }); }
    else { steps.push({ ...card, at, best }); at += gap; }
  });
  const stingAt = at;
  return { steps, stingAt, stingMs, stingLevel: order[order.length - 1].shows, total: stingAt + stingMs };
}
