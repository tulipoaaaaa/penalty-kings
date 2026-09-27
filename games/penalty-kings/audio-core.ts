/**
 * The AudioContext-free core of the sound pass (B3): every Stage/Director sound name, the dedupe gate that
 * keeps one roar per event (BQ-X5), and the mix envelopes (the pre-kick crowd hush and the goal roar swell).
 * Pure data and functions, so the unit tests read the same numbers audio.ts plays (research R5).
 */

/** Every sound name the Stage, the Director and the shell may fire. audio.ts gives each one a voice (BQ-X4). */
export const SFX_NAMES = [
  // the kick and the ball
  "kick", "perfect", "whoosh", "net", "net-ripple", "clang", "glove", "fingertip", "stomp",
  // the crowd and the match
  "heartbeat", "hush", "whistle", "roar", "roar-swell", "groan", "ooh", "so-close", "chant", "beep", "honk",
  // reveals and streak stingers
  "reveal", "reveal-top", "stinger-3", "stinger-5", "stinger-10",
  // the pack reveal (B5): the tear, and one chime per TRUE rarity on a card flip (higher rarity, higher pitch)
  "pack-tear", "rarity-0", "rarity-1", "rarity-2", "rarity-3", "rarity-4", "rarity-5", "rarity-6",
  // the 12 keepers' signature voices (gfx/keepers.ts KEEPER_DESIGNS[..].sfx)
  "squeak", "chitter", "yawn", "blub", "mime", "disco", "hiss", "boo", "rumble",
] as const;
export type Sfx = typeof SFX_NAMES[number];
export const isSfx = (name: string): name is Sfx => (SFX_NAMES as readonly string[]).includes(name);

/** Decibels → linear gain. */
export const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * The crowd hush before each kick: the crowd/music bus ducks 12 dB and low-passes to 800 Hz over the
 * 150 ms before the strike, then lifts on the result (or by itself after `holdS`).
 */
export const HUSH = { db: -12, lowpassHz: 800, openHz: 18000, seconds: 0.15, holdS: 1.4, liftS: 0.3 } as const;
/** The goal roar: +18 dB above the hushed bed (bus back to 0 dB plus a roar voice 6 dB over the bed), 150 ms attack. */
export const SWELL = { db: 18, attackS: 0.15, holdS: 2.4, releaseS: 2 } as const;
/** The roar voice's peak over the full bed, so hushed bed → roar peak is SWELL.db. */
export const ROAR_OVER_BED_DB = SWELL.db + HUSH.db;

/** The crowd bus gain `t` seconds after a hush starts (no lift): a linear duck, then the hold, then the self-lift. */
export function hushGainAt(t: number): number {
  const low = dbToGain(HUSH.db);
  if (t <= 0) return 1;
  if (t < HUSH.seconds) return 1 + (low - 1) * (t / HUSH.seconds);
  if (t < HUSH.holdS) return low;
  return 1 + (low - 1) * Math.exp(-(t - HUSH.holdS) / HUSH.liftS);
}

/** Streak stingers: the same short arpeggio, transposed +2 semitones per tier (3 → 5 → 10 in a row). */
export const STINGER_TIERS = { "stinger-3": 0, "stinger-5": 1, "stinger-10": 2 } as const;
export const STINGER_STEPS = [0, 4, 7, 12] as const;
export function stingerNotes(name: keyof typeof STINGER_TIERS, base = 523.25): number[] {
  const shift = STINGER_TIERS[name] * 2;
  return STINGER_STEPS.map(step => base * 2 ** ((step + shift) / 12));
}

/** Post clang: a free–free bar's inharmonic partial ratios, with decays that shorten up the series. */
export const CLANG_PARTIALS = [[1, 1.5, 0.22], [2.76, 0.9, 0.11], [5.4, 0.5, 0.06], [8.93, 0.3, 0.035]] as const;

/**
 * Dedupe groups: names in one group share a window (ms). Every roar-like name is one group, so a goal that
 * fires roar + chant + roar-swell, or a Golden Boot reveal that roars twice, roars once.
 */
export const DEDUPE: Readonly<Record<string, number>> = { roar: 1500, stinger: 600, default: 60 };
export const dedupeGroup = (name: string) => (name === "roar" || name === "roar-swell" ? "roar" : name.startsWith("stinger") ? "stinger" : name);

/** A gate that lets one sound per group through per window. `now` is in ms. */
export function createGate(windows: Readonly<Record<string, number>> = DEDUPE) {
  const last = new Map<string, number>();
  return {
    allow(name: string, now: number): boolean {
      const group = dedupeGroup(name), window = windows[group] ?? windows.default ?? 0, at = last.get(group);
      if (at !== undefined && now - at < window) return false;
      last.set(group, now); return true;
    },
    reset() { last.clear(); },
  };
}

/** ±`spread` random variation around `value` (pitch ±5 %, gain ±1.5 dB ≈ ±16 %). */
export const vary = (value: number, spread: number, random = Math.random) => value * (1 + (random() * 2 - 1) * spread);
