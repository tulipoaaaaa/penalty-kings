// Test helper: simulated sessions driving a GameDirector with a seeded fake player.
import { KEEPERS } from "../../engine/src/index.ts";
import { GameDirector, Rng, type Beat, type KickFacts, type PlayMode, type StadiumId, type TimeOfDay, type Weather } from "../src/index.ts";
import type { KeeperId, Zone } from "../src/types.ts";

export const LADDER: readonly KeeperId[] = ["mouse", "squirrel", "sloth", "peacock", "octopus", "mime", "disco", "sumo", "chameleon", "robot", "ghost", "finalwall"];

export type Step = { session: Beat | null; before: Beat; after: Beat; facts: KickFacts };
export type SimOptions = { seed: number; kicks: number; mode?: PlayMode; stadium?: StadiumId; keeper?: KeeperId; perSession?: number; timeOfDay?: TimeOfDay; weather?: Weather; friendNumber?: string; director?: GameDirector; secondsPerKick?: number;
  /** The shell's shot clock is running for these kicks (QA-5: the shot-clock moment needs it). */
  shotClock?: boolean };

export const newDirector = (seed: number, friendNumber = "336583") => new GameDirector({ seed, keepers: KEEPERS, ladder: LADDER, friendName: "Friend #336583", friendNumber });

/** A deterministic fake player: ~55 % goals, the rest saves, woodwork and misses, some near the post. */
export function fakeKick(rng: Rng, kind: KickFacts["kind"], now: number): KickFacts {
  const r = rng.next();
  const zones: Zone[] = ["centre", "side", "corner", "bin"];
  if (r < 0.55) { const zone = zones[rng.int(4)]; return { kind, result: "goal", zone, x: rng.next() * 1.8 - 0.9, y: rng.next(), postIn: rng.next() < 0.08, spin: rng.next() * 2 - 1, knuckle: kind === "freekick" && rng.next() < 0.1, now }; }
  if (r < 0.75) return { kind, result: "save", zone: zones[rng.int(4)], x: rng.next() * 1.6 - 0.8, y: rng.next(), now };
  if (r < 0.82) return { kind, result: "post", zone: "corner", x: rng.next() < 0.5 ? -1 : 1, y: rng.next(), now };
  if (r < 0.91) return { kind, result: "wide", zone: "corner", x: (rng.next() < 0.5 ? -1 : 1) * (1.02 + rng.next() * 0.3), y: rng.next(), now };
  return { kind, result: kind === "freekick" && rng.next() < 0.4 ? "wall" : "over", zone: "bin", x: rng.next() * 1.6 - 0.8, y: 1.02 + rng.next() * 0.2, now };
}

export function simulate(options: SimOptions): { director: GameDirector; steps: Step[]; sessions: Beat[] } {
  const director = options.director ?? newDirector(options.seed, options.friendNumber);
  const rng = new Rng(options.seed * 7919 + 13), mode = options.mode ?? "penalties", kind = mode === "freekicks" ? "freekick" : "penalty";
  const perSession = options.perSession ?? (mode === "freekicks" ? 3 : 5), secondsPerKick = options.secondsPerKick ?? 12;
  const steps: Step[] = [], sessions: Beat[] = [];
  for (let k = 0; k < options.kicks; k++) {
    let session: Beat | null = null;
    if (k % perSession === 0) sessions.push(session = director.startSession({ mode, stadium: options.stadium ?? "park", keeper: options.keeper ?? "squirrel", weather: options.weather ?? "sun", timeOfDay: options.timeOfDay ?? "evening" }));
    const now = (k + 1) * secondsPerKick;
    const before = director.beforeKick({ now: now - secondsPerKick / 2, suddenDeath: k % perSession === perSession - 1 && rng.next() < 0.3, shotClock: options.shotClock });
    const facts = fakeKick(rng, kind, now);
    const after = director.afterKick(facts);
    steps.push({ session, before, after, facts });
  }
  return { director, steps, sessions };
}

export const tiersOf = (step: Step) => [...step.before.moments, ...step.after.moments].map(m => m.tier);
