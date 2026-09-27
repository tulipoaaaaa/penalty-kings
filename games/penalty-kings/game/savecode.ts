/**
 * Save codes (round 6 B6): the SDK sandbox has no storage (no allow-same-origin), so the preview cannot
 * keep progress between visits. The player can copy a save code and paste it back later.
 *
 * HONESTY
 *  • A save code carries PROGRESSION only (XP, stars, stamps, bests, unlocked cosmetics, the daily
 *    record). Never RF, balls or $GBOOT: those always come from the chain (the Bag syncs with the
 *    on-chain inventory).
 *  • It is bound to one Friend and checksummed against typos. It is NOT a signature: a key shipped in
 *    client code cannot sign anything, so a determined player could edit their own XP. That only
 *    affects cosmetic progression, never money.
 */
import { fresh, type Progress } from "./progress.js";

const PREFIX = "PK1";

/** CRC-32 (IEEE), for typo detection only. */
function crc32(text: string) {
  let crc = ~0;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc >>> 0).toString(16).padStart(8, "0");
}
const toBase64Url = (text: string) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/"))));

/** What a save code keeps (the shot history for the difficulty director is rebuilt by playing). */
type Saved = Pick<Progress, "xp" | "stars" | "stamps" | "pulled" | "matches" | "tutorialDone" | "difficulty" | "daily" | "best" | "rewards" | "directorSeen" | "keepersSeen" | "stadiumsSeen" | "login">;
const STADIUMS = ["park", "pro", "champions"];

export function encodeSaveCode(progress: Progress, friendId: bigint | string) {
  const saved: Saved = { xp: progress.xp, stars: progress.stars, stamps: progress.stamps, pulled: progress.pulled, matches: progress.matches, tutorialDone: progress.tutorialDone, difficulty: progress.difficulty, daily: progress.daily, best: progress.best, rewards: progress.rewards, directorSeen: progress.directorSeen, keepersSeen: progress.keepersSeen, stadiumsSeen: progress.stadiumsSeen, login: progress.login };
  const payload = toBase64Url(JSON.stringify(saved));
  return `${PREFIX}.${payload}.${crc32(`${friendId}:${payload}`)}`;
}

export type Restored = { ok: true; progress: Progress } | { ok: false; reason: string };
export function decodeSaveCode(code: string, friendId: bigint | string): Restored {
  const parts = code.trim().replace(/\s+/g, "").split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "That doesn't look like a Penalty Kings save code." };
  const [, payload, check] = parts;
  if (crc32(`${friendId}:${payload}`) !== check) return { ok: false, reason: "This code belongs to another Friend, or it was mistyped." };
  try {
    const saved = JSON.parse(fromBase64Url(payload)) as Partial<Saved>;
    const base = fresh();
    const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
    return { ok: true, progress: {
      ...base,
      xp: num(saved.xp, 0), matches: num(saved.matches, 0), difficulty: Math.min(8, num(saved.difficulty, base.difficulty)),
      tutorialDone: saved.tutorialDone === true,
      stars: typeof saved.stars === "object" && saved.stars ? Object.fromEntries(Object.entries(saved.stars).map(([id, stars]) => [id, Math.min(3, num(stars, 0))])) : {},
      stamps: Array.isArray(saved.stamps) ? saved.stamps.filter(id => typeof id === "string") : [],
      pulled: Array.isArray(saved.pulled) ? saved.pulled.filter(r => Number.isInteger(r) && r >= 0 && r <= 6) : [],
      rewards: Array.isArray(saved.rewards) ? saved.rewards.filter(id => typeof id === "string") : [],
      daily: { ...base.daily, ...(saved.daily ?? {}) },
      best: { ...base.best, ...(saved.best ?? {}) },
      // Discovery meter (added later: older codes without these fields restore with empty discovery).
      directorSeen: typeof saved.directorSeen === "string" && /^[A-Za-z0-9_-]{0,32}$/.test(saved.directorSeen) ? saved.directorSeen : "",
      keepersSeen: Array.isArray(saved.keepersSeen) ? saved.keepersSeen.filter(id => typeof id === "string") : [],
      stadiumsSeen: Array.isArray(saved.stadiumsSeen) ? saved.stadiumsSeen.filter(id => STADIUMS.includes(id)) : [],
      // D18 check-in track (added later: older codes restore with a fresh track).
      login: saved.login && typeof saved.login.lastDay === "string" && /^(\d{4}-\d{2}-\d{2})?$/.test(saved.login.lastDay) ? { lastDay: saved.login.lastDay, day: Math.min(7, Math.floor(num(saved.login.day, 0))) } : base.login,
    } };
  } catch { return { ok: false, reason: "This save code is damaged." }; }
}

/** True when this browser can keep progress by itself (false in the SDK sandbox). */
export function canPersist() {
  try { const key = "penalty-kings/probe"; localStorage.setItem(key, "1"); localStorage.removeItem(key); return true; } catch { return false; }
}
