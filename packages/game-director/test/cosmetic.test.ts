import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_PLAY_MODES, MOMENTS } from "../src/index.ts";
import { newDirector, simulate } from "./sim.ts";

/** Any key that could reach money, odds, prizes, rarity reveals or leaderboards. */
const PAYOUT_KEY = /^(rf|usd|odds?|prizes?|payouts?|price|rewards?|gboot|race|rarity|reveal|drop|dropMult|wager|stake|bps|ev|points|score|earned|pull|tier_?id|record(Id)?|token|wallet)$/i;

function keysOf(value: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item, i) => keysOf(item, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { out.push(key); keysOf(item, `${path}.${key}`, out); }
  return out;
}

test("no output field can affect payouts (beats, moments, lines, debug state, saves)", () => {
  for (const mode of ["penalties", "freekicks", "match", "daily", "tour", "skill"] as const) {
    const { steps, sessions, director } = simulate({ seed: 31, kicks: 60, mode, stadium: "champions", keeper: "robot" });
    director.noteBigPull();
    const everything = [steps.map(s => [s.before, s.after]), sessions, director.debugState(), director.save(), MOMENTS.map(m => director.trigger(m.id))];
    const bad = keysOf(everything).filter(key => PAYOUT_KEY.test(key));
    assert.deepEqual([...new Set(bad)], [], `${mode}: payout-shaped keys in Director output`);
  }
  // The only number that touches scoring is the Golden Hour skill multiplier, and it is 1 or 2.
  const beat = simulate({ seed: 1, kicks: 1 }).steps[0].before;
  assert.deepEqual(Object.keys(beat).sort(), ["hush", "intensity", "keeper", "keeperChanged", "kick", "kickInRound", "lines", "moments", "phase", "round", "shotClock", "skillScoreMultiplier"]);
});

test("Golden Hour doubles skill points in free play only; never in paid, ranked or scripted modes", () => {
  let sawDouble = false;
  for (const mode of ["penalties", "freekicks", "match", "daily", "tour", "skill", "tutorial", "target"] as const) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { steps } = simulate({ seed, kicks: 80, mode, stadium: "pro", keeper: "disco", timeOfDay: "evening" });
      for (const step of steps) for (const beat of [step.before, step.after]) {
        assert.ok(beat.skillScoreMultiplier === 1 || beat.skillScoreMultiplier === 2);
        if (!FREE_PLAY_MODES.includes(mode)) assert.equal(beat.skillScoreMultiplier, 1, `${mode}: Golden Hour multiplier leaked`);
        if (beat.skillScoreMultiplier === 2) sawDouble = true;
      }
    }
    // Even when forced on, a paid mode stays at ×1.
    const director = newDirector(1);
    director.startSession({ mode, stadium: "pro", keeper: "disco" });
    director.trigger("golden-hour");
    assert.equal(director.beforeKick().skillScoreMultiplier, FREE_PLAY_MODES.includes(mode) ? 2 : 1, mode);
  }
  assert.ok(sawDouble, "Golden Hour never played in free play");
});

test("the Director never reads or returns outcomes: the same kicks give the same results whatever it shows", () => {
  // Outcomes are inputs (facts); the Director has no API that takes or returns a shot, a seed for the engine, or a payout.
  const { steps } = simulate({ seed: 5, kicks: 30 });
  for (const step of steps) assert.equal(step.after.kick, step.before.kick);
  const director = newDirector(5) as unknown as Record<string, unknown>;
  for (const method of ["resolveShot", "odds", "prize", "reveal", "setOdds", "payout"]) assert.equal(director[method], undefined);
});
