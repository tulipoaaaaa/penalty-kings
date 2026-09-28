/**
 * C4 social loop, with NO backend (the SDK sandbox is allow-scripts only; its CSP connects to the chain RPC
 * and nothing else). Points and XP only: nothing here touches RF, balls or $GBOOT.
 *
 *  • CHALLENGE A FRIEND: "Send a code; your friend kicks the same kicks against the same keeper and tries to beat
 *    your score." A challenge code carries the mode (5 penalties or 3 free kicks), the keeper, the seed and the
 *    score. The kicks are deterministic (engine kickSeed / keeperPlan / freeKickSetup from the seed; no beacon),
 *    so the same code always brings the same keeper plans. The sandbox cannot read the host page's URL (opaque
 *    origin, no-referrer), so the code is pasted into a Challenge box, like the save code.
 *  • The checksum rejects typos and casual edits (a changed score). It is NOT a signature: a key in client code
 *    cannot sign anything. That only affects bragging rights, never money.
 *  • KEEPER OF THE WEEK: one keeper per UTC ISO week; 3+ goals in a round against them pays double XP.
 *  • DAY N: the D18 check-in track's day, shown while the run is alive (checked in today or yesterday).
 */
import { KEEPERS, freeKickSetup, keeperById, type KeeperId, type FreeKickSetup } from "@penalty-kings/engine";
import { weekKey, LOGIN_TRACK, type LoginTrack } from "./rewards.js";

/** The public game (GitHub Pages). A challenge link adds ?challenge=<code>; the host page shows the code to paste. */
export const PUBLIC_URL = "https://tulipoaaaaa.github.io/penalty-kings/";
export const CHALLENGE_PREFIX = "pkc1";
export type ChallengeKind = "penalty" | "freekick";
/** `wall`: the free-kick wall height in metres when it is not the default CHALLENGE_WALL (a Daily free kick's wall varies by day). */
export type Challenge = Readonly<{ kind: ChallengeKind; keeper: KeeperId; seed: number; kicks: number; score: number; from: string; wall?: number }>;
/** The wall of a free-kick challenge whose code carries no wall (every code made before walls were encoded). */
export const CHALLENGE_WALL = 1.65;
const WALL_CM = { min: 155, max: 195 }; // the engine's wall range (freeKickSetup clamps to 1.55–1.95 m)
/** The wall in whole centimetres, or null for the default (so a default-wall code stays the original 7-part code). */
const wallCm = (challenge: Pick<Challenge, "kind" | "wall">) => {
  if (challenge.kind !== "freekick" || challenge.wall === undefined || !Number.isFinite(challenge.wall)) return null;
  const cm = Math.max(WALL_CM.min, Math.min(WALL_CM.max, Math.round(challenge.wall * 100)));
  return cm === Math.round(CHALLENGE_WALL * 100) ? null : cm;
};
/** Kicks per challenge round: the game's own round sizes. */
export const CHALLENGE_KICKS: Readonly<Record<ChallengeKind, number>> = { penalty: 5, freekick: 3 };
const MAX_SCORE = 10_000_000;

/** CRC-32 (IEEE) of a salted string, as 8 hex digits. Typo / casual-edit detection only. */
function crc32(text: string) {
  let crc = ~0;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc >>> 0).toString(16).padStart(8, "0");
}
const check = (body: string) => crc32(`penalty-kings-challenge:${body}`);
const keeperIds = new Set<string>(KEEPERS.map(keeper => keeper.id));

/**
 * "pkc1.p.sumo.<seed36>.<score36>.<friend36>.<crc>" — short enough to paste, all lower-case. A free kick with a
 * non-default wall adds ".w<cm>" before the checksum (covered by it): "pkc1.f.sumo.….w173.<crc>".
 */
export function encodeChallenge(challenge: Challenge) {
  const from = /^\d+$/.test(challenge.from) ? BigInt(challenge.from).toString(36) : "0";
  const wall = wallCm(challenge);
  const body = [CHALLENGE_PREFIX, challenge.kind === "freekick" ? "f" : "p", challenge.keeper, (challenge.seed >>> 0).toString(36), Math.max(0, Math.min(MAX_SCORE, Math.round(challenge.score))).toString(36), from, ...(wall === null ? [] : [`w${wall}`])].join(".");
  return `${body}.${check(body)}`;
}

export type DecodedChallenge = { ok: true; challenge: Challenge } | { ok: false; reason: string };
export function decodeChallenge(raw: string): DecodedChallenge {
  // Accept a whole link too (…?challenge=CODE), and stray spaces or capitals from a chat app.
  const text = raw.trim().replace(/^.*[?&]challenge=/i, "").replace(/[\s&#].*$/, "").toLowerCase();
  const parts = text.split(".");
  if ((parts.length !== 7 && parts.length !== 8) || parts[0] !== CHALLENGE_PREFIX) return { ok: false, reason: "That doesn't look like a Penalty Kings challenge code." };
  const [, mode, keeper, seed36, score36, from36] = parts, sum = parts[parts.length - 1], wallPart = parts.length === 8 ? parts[6] : null;
  if (check(parts.slice(0, -1).join(".")) !== sum) return { ok: false, reason: "This challenge code was changed or mistyped." };
  const cm = wallPart === null ? null : /^w\d{3}$/.test(wallPart) ? Number(wallPart.slice(1)) : NaN;
  if (cm !== null && (mode !== "f" || !(cm >= WALL_CM.min && cm <= WALL_CM.max))) return { ok: false, reason: "This challenge code is damaged." };
  if ((mode !== "p" && mode !== "f") || !keeperIds.has(keeper) || ![seed36, score36, from36].every(part => /^[0-9a-z]{1,14}$/.test(part))) return { ok: false, reason: "This challenge code is damaged." };
  const seed = parseInt(seed36, 36), score = parseInt(score36, 36);
  if (!Number.isSafeInteger(seed) || seed > 0xffffffff || !Number.isSafeInteger(score) || score > MAX_SCORE) return { ok: false, reason: "This challenge code is damaged." };
  let from = "0";
  for (const char of from36) from = (BigInt(from) * 36n + BigInt(parseInt(char, 36))).toString();
  const kind: ChallengeKind = mode === "f" ? "freekick" : "penalty";
  return { ok: true, challenge: { kind, keeper: keeper as KeeperId, seed, kicks: CHALLENGE_KICKS[kind], score, from, ...(cm === null ? {} : { wall: cm / 100 }) } };
}

export const challengeLink = (code: string) => `${PUBLIC_URL}?challenge=${code}`;
/** The challenger's display name (Friends are named by number; never a real name). */
export const challengerName = (challenge: Pick<Challenge, "from">) => `Friend #${challenge.from}`;
const points = (value: number) => value.toLocaleString("en-US");

/** The one-line verdict after playing a challenge. */
export function challengeVerdict(challenge: Challenge, myScore: number) {
  const name = challengerName(challenge);
  if (myScore > challenge.score) return { won: true, text: `You beat ${name}'s ${points(challenge.score)}!` };
  if (myScore === challenge.score) return { won: false, text: `Level with ${name} on ${points(challenge.score)}. Try again to win it.` };
  return { won: false, text: `${name} still leads by ${points(challenge.score - myScore)}.` };
}
/** One sentence for a new player, shown with the Challenge box and on the challenge brief. */
export const CHALLENGE_RULE = "Send a code; your friend kicks the same kicks against the same keeper and tries to beat your score.";
export const challengeBrief = (challenge: Challenge) => `${challengerName(challenge)} scored ${points(challenge.score)} in ${challenge.kicks} ${challenge.kind === "freekick" ? "free kicks" : "penalties"} against ${keeperById(challenge.keeper).name}. Beat it!`;

/**
 * The free-kick setup of a challenge: a pure function of the seed and the wall (same code, same wall, distance,
 * angle and wind). The Daily builds its free kick the same way (daily.ts), so a Daily code replays that exact kick.
 */
export const challengeSetup = (seed: number, wall = CHALLENGE_WALL): FreeKickSetup => freeKickSetup(seed >>> 0, { maxWind: 3, wallHeight: wall });

// ── The share card's round data ────────────────────────────────────────────
/** What the Results screen knows about the round that just ended. */
export type ShareRound = {
  friendId: string; score: number; goals: number; kicks: number; bestStreak: number; subtitle?: string;
  /** A challenge others can play from this round (null for modes that cannot be replayed exactly). */
  replay: Omit<Challenge, "score" | "from"> | null;
  /** The challenge this round answered, if any (for the verdict line). */
  answered?: Challenge | null;
};

/** Modes whose rounds can be replayed as a challenge (penalty or free-kick rounds with a seed and a keeper). */
const CHALLENGE_MODES = new Set(["penalties", "freekicks", "daily", "challenge"]);
/**
 * The share data for a finished round, or null (the Big Match and the Skill Cup are paid/ranked: no share card
 * there, so nothing ever sits next to money). Target Practice and the tour share a card without a challenge.
 */
export function shareRoundOf(session: { friendId: string; mode: string; kind: string; keeper: KeeperId; seed: number; points: number; kicks: readonly { result: string }[]; bestStreak: number; setup?: { wallHeight: number }; challenge?: { vs: Challenge | null } }): ShareRound | null {
  if (session.mode === "match" || session.mode === "skill") return null;
  const kind: ChallengeKind | null = session.kind === "freekick" ? "freekick" : session.kind === "penalty" ? "penalty" : null;
  const wall = kind === "freekick" && session.setup ? wallCm({ kind, wall: session.setup.wallHeight }) : null; // the round's own wall (a Daily's varies by day)
  const replay = kind && CHALLENGE_MODES.has(session.mode) ? { kind, keeper: session.keeper, seed: session.seed >>> 0, kicks: CHALLENGE_KICKS[kind], ...(wall === null ? {} : { wall: wall / 100 }) } : null;
  const goals = session.kicks.filter(kick => kick.result === "goal").length;
  return {
    friendId: session.friendId, score: session.points, goals, kicks: session.kicks.length, bestStreak: session.bestStreak,
    subtitle: replay ? `${replay.kicks} ${kind === "freekick" ? "free kicks" : "penalties"} vs ${keeperById(session.keeper).name}` : undefined,
    replay, answered: session.challenge?.vs ?? null,
  };
}

/** What the Daily record keeps about today's best round, so the Daily menu can share it later. */
export type DailyBestRound = { goals: number; kicks: number; bestStreak: number };
/**
 * The share data for today's best Daily round (the Daily menu's "Share result card"), or null before a scored round
 * today. Built through shareRoundOf, so the card, the challenge code (today's keeper and seed) and the no-money rule
 * match the Results share. A best stored before rounds were kept (no `bestRound`) shares the score alone (kicks 0).
 */
export function dailyShareRound(friendId: string, daily: { date: string; best: number; bestRound?: DailyBestRound }, scenario: { date: string; seed: number; mode: "penalty" | "freekick"; keeper: KeeperId; setup?: { wallHeight: number } }): ShareRound | null {
  if (daily.date !== scenario.date || !(daily.best > 0)) return null;
  const count = (value: unknown, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0); // a pasted save code is not trusted
  const total = count(daily.bestRound?.kicks, 20), goals = count(daily.bestRound?.goals, total);
  const kicks = Array.from({ length: total }, (_, index) => ({ result: index < goals ? "goal" : "miss" }));
  const round = shareRoundOf({ friendId, mode: "daily", kind: scenario.mode, keeper: scenario.keeper, seed: scenario.seed, setup: scenario.setup, points: daily.best, kicks, bestStreak: count(daily.bestRound?.bestStreak, total) });
  return round && { ...round, subtitle: `Daily ${scenario.date}${round.subtitle ? ` · ${round.subtitle}` : ""}` };
}

// ── Keeper of the Week ─────────────────────────────────────────────────────
export const WEEKLY_XP_MULTIPLIER = 2;
export const WEEKLY_GOALS = 3;
/** The regular keepers (the Skill Cup boss is never featured). */
const WEEKLY_POOL: readonly KeeperId[] = KEEPERS.filter(keeper => !keeper.boss).map(keeper => keeper.id);
/** The featured keeper for the UTC ISO week of `day` (YYYY-MM-DD): a pure function, the same for everyone. */
export function keeperOfTheWeek(day: string): KeeperId {
  const week = weekKey(day);
  let hash = 2166136261;
  for (const char of `penalty-kings-kotw:${week}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return WEEKLY_POOL[(hash >>> 0) % WEEKLY_POOL.length];
}
/** Extra XP for a Keeper of the Week round: the round's XP again (×2 in all) when 3+ goals went in. */
export const weeklyBonusXp = (roundXp: number, goals: number) => (goals >= WEEKLY_GOALS ? roundXp * (WEEKLY_XP_MULTIPLIER - 1) : 0);
export const weeklyLine = (keeper: KeeperId) => `KEEPER OF THE WEEK: ${keeperById(keeper).name}. Score ${WEEKLY_GOALS} in a round for ×${WEEKLY_XP_MULTIPLIER} XP`;

// ── Day N (the D18 check-in track) ─────────────────────────────────────────
const dayBefore = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
/** The check-in day to show ("Day N"), or null when the run has lapsed (last check-in before yesterday) or never began. */
export function streakDay(login: LoginTrack, today: string): number | null {
  if (!login.lastDay || login.day < 1) return null;
  return login.lastDay === today || login.lastDay === dayBefore(today) ? login.day : null;
}
/** "Come back tomorrow for day N+1" once today's check-in is done (the 7-day track wraps to day 1). */
export function comeBackLine(login: LoginTrack, today: string) {
  if (login.lastDay !== today || login.day < 1) return null;
  return `Come back tomorrow for day ${(login.day % LOGIN_TRACK.length) + 1}.`;
}
