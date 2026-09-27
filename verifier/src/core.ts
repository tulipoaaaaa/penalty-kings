/**
 * Skill Cup referee (5 kicks vs THE FINAL WALL) — pure logic, no platform APIs beyond WebCrypto.
 *
 * Protocol (one entry = one 5-kick shootout vs Ghost):
 *  1. Week start: the referee publishes sha256(weekSecret). The secret stays private until week end.
 *  2. POST entry {txHash}: the player's on-chain SkillCup.enter transaction is the entry. The
 *     contract already enforced hardwired ownership, the 100 $GBOOT fee (50% burned, 50% pot) and
 *     the rate limits (1 per Friend per hour, 20 per week). The referee reads the verified
 *     `Entered` event and registers that entryId once.
 *  3. POST kick: the client sends its kick inputs. The referee STORES them first, then derives the
 *     keeper's dive seed = HMAC-SHA256(weekSecret, entryId ‖ kickIndex) and resolves the kick with
 *     the shared engine. The client can never supply or claim a result.
 *  4. After kick 5 the referee signs {week, entryId, friendId, score, kicks} with its ECDSA key.
 *  5. Week end: the secret is revealed; anyone can recompute every dive and score from the
 *     published inputs (see replayEntry).
 */
import { KEEPERS, keeperById, resolveShot, shotTarget, goalPoints, clamp, type ShotInput, type ShotResult } from "../../packages/engine/src/index.ts";

export const KICKS_PER_ENTRY = 5;
export const SKILL_KEEPER = keeperById("finalwall");

export type KickInput = ShotInput & { /** ms from aim start to release; recorded for review, not used by physics. */ releaseMs: number };
export type Entry = { id: number; week: number; friendId: string; owner: string; createdAt: number; kicks: { input: KickInput; result: ShotResult; points: number }[]; score: number; signature?: string };

export interface Store {
  getEntry(id: number): Promise<Entry | null>;
  putEntry(entry: Entry): Promise<void>;
  /** All entries of a week (for the leaderboard). */
  weekEntries(week: number): Promise<Entry[]>;
}
export interface Chain {
  /** Reads a confirmed SkillCup.enter receipt and returns its Entered event, or null. */
  entryFromTx(txHash: string): Promise<{ entryId: number; friendId: string; player: string; week: number } | null>;
}

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function secretHash(secret: Uint8Array<ArrayBuffer>) { return "0x" + hex(await crypto.subtle.digest("SHA-256", secret)); }

/** Keeper dive seed for a committed kick. uint32 from the first 4 bytes of the HMAC. */
export async function diveSeed(secret: Uint8Array<ArrayBuffer>, entryId: number, kickIndex: number) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${entryId}|${kickIndex}`)));
  return ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
}

export function sanitize(input: KickInput): KickInput {
  const num = (value: unknown, min: number, max: number) => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new RefereeError(400, "Kick inputs must be finite numbers.");
    return clamp(value, min, max);
  };
  return { aimX: num(input.aimX, -1.6, 1.6), loft: num(input.loft, -0.3, 0.3), power: num(input.power, 0, 1), curl: num(input.curl, -1, 1), releaseMs: num(input.releaseMs, 0, 600_000) };
}

/** Pure scoring shared by the live referee and public replays. */
export function scoreKick(input: ShotInput, seed: number, goalsBefore: number, kickIndex: number, previous: readonly ShotInput[]) {
  const outcome = resolveShot(input, SKILL_KEEPER, seed, { kickIndex, history: previous.map(shot => shotTarget(shot).x) });
  const streak = outcome.result === "goal" ? goalsBefore + 1 : 0;
  return { result: outcome.result, points: outcome.result === "goal" ? goalPoints(SKILL_KEEPER, 1, streak, false, outcome.zone, outcome.postIn) : 0, plan: outcome.plan };
}

export class RefereeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}


export function createReferee(options: { secret: Uint8Array<ArrayBuffer>; week: number; store: Store; chain: Chain; signingKey: CryptoKey; now?: () => number }) {
  const now = options.now ?? Date.now;
  const { secret, week, store, chain } = options;

  async function sign(entry: Entry) {
    const payload = JSON.stringify({ week: entry.week, entryId: entry.id, friendId: entry.friendId, score: entry.score, kicks: entry.kicks.map(k => k.result) });
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, options.signingKey, enc.encode(payload));
    return { payload, signature: hex(signature) };
  }

  return {
    async hash() { return secretHash(secret); },

    /** Finished entries this week: best score first, ties to the earlier (lower) on-chain entryId. */
    async leaderboard() {
      return (await store.weekEntries(week)).filter(e => e.kicks.length === KICKS_PER_ENTRY)
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .map(e => ({ entryId: e.id, friendId: e.friendId, score: e.score, kicks: e.kicks.map(k => k.result), signature: e.signature }));
    },

    async enter(body: { txHash: string }) {
      const hash = String(body.txHash ?? "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new RefereeError(400, "Invalid transaction hash.");
      const entered = await chain.entryFromTx(hash);
      if (!entered) throw new RefereeError(404, "No confirmed SkillCup entry in that transaction.");
      if (entered.week !== week) throw new RefereeError(409, `That entry belongs to week ${entered.week}.`);
      if (await store.getEntry(entered.entryId)) throw new RefereeError(409, "Entry already registered.");
      const entry: Entry = { id: entered.entryId, week, friendId: entered.friendId, owner: entered.player.toLowerCase(), createdAt: now(), kicks: [], score: 0 };
      await store.putEntry(entry);
      return { entryId: entry.id, week, secretHash: await secretHash(secret) };
    },

    /** Commit the inputs, then derive the dive and resolve. Inputs arrive before any secret-derived value exists for this kick. */
    async kick(body: { entryId: number; kickIndex: number; input: KickInput }) {
      const entry = await store.getEntry(Number(body.entryId));
      if (!entry || entry.week !== week) throw new RefereeError(404, "Unknown entry.");
      if (entry.kicks.length >= KICKS_PER_ENTRY) throw new RefereeError(409, "This shootout is finished.");
      if (body.kickIndex !== entry.kicks.length) throw new RefereeError(409, `Expected kick ${entry.kicks.length}.`);
      const input = sanitize(body.input);
      const seed = await diveSeed(secret, entry.id, body.kickIndex);
      const goals = entry.kicks.reduce((streak, kick) => (kick.result === "goal" ? streak + 1 : 0), 0);
      const scored = scoreKick(input, seed, goals, body.kickIndex, entry.kicks.map(kick => kick.input));
      entry.kicks.push({ input, result: scored.result, points: scored.points });
      entry.score += scored.points;
      let signed: { payload: string; signature: string } | undefined;
      if (entry.kicks.length === KICKS_PER_ENTRY) { signed = await sign(entry); entry.signature = signed.signature; }
      await store.putEntry(entry);
      return { kickIndex: body.kickIndex, result: scored.result, points: scored.points, dive: { x: scored.plan.x, y: scored.plan.y }, score: entry.score, signed };
    },
  };
}

/** Public replay: recompute an entry from its published inputs and the revealed secret. */
export async function replayEntry(secret: Uint8Array<ArrayBuffer>, entryId: number, inputs: ShotInput[]) {
  let score = 0, goals = 0; const results: ShotResult[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const scored = scoreKick(inputs[index], await diveSeed(secret, entryId, index), goals, index, inputs.slice(0, index));
    goals = scored.result === "goal" ? goals + 1 : 0; score += scored.points; results.push(scored.result);
  }
  return { score, results };
}

export function memoryStore(): Store {
  const entries = new Map<number, Entry>();
  return {
    async weekEntries(week) { return [...entries.values()].filter(e => e.week === week).map(e => structuredClone(e)); },
    async getEntry(key) { const found = entries.get(key); return found ? structuredClone(found) : null; },
    async putEntry(entry) { entries.set(entry.id, structuredClone(entry)); },
  };
}

export { KEEPERS };
