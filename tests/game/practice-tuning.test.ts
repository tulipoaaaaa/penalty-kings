// Free practice balance (owner: "naive swipes must not score 5/5; about 3/5 for a careless player; keep it
// welcoming"). Plays seeded five-kick practice rounds with the page's own calls: the game's Director picks each
// kick's keeper (startSession / beforeKick / afterKick, exactly as site-src/practice/main.ts), and
// site-src/practice/tuning.ts practiceKick resolves the kick. Three player profiles:
//   careless: straight-up swipes (a few degrees either way), random length (height) and random speed (power);
//   casual:   picks a side about as often as the middle, loose aim;
//   good:     aims for the corners (low or high), firm and steady.
// PK_PRACTICE_REPORT=1 prints the before/after table and the careless goals-out-of-5 distribution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kickSeed, prng, type KeeperId, type ShotInput } from "@penalty-kings/engine";
import { createGameDirector } from "../../games/penalty-kings/game/director.ts";
import { practiceKick, missHint, BASELINE_TUNING, PRACTICE_TUNING, type PracticeTuning } from "../../site-src/practice/tuning.ts";

type Profile = "careless" | "casual" | "good";
const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
const uniform = (random: () => number, lo: number, hi: number) => lo + (hi - lo) * random();

function gesture(profile: Profile, random: () => number): ShotInput {
  const side = random() < 0.5 ? -1 : 1;
  if (profile === "careless") return { aimX: gauss(random) * 0.12, aimY: uniform(random, 0, 0.9), power: uniform(random, 0.35, 1), curl: 0 };
  if (profile === "casual") {
    const middle = random() < 0.4;
    return { aimX: (middle ? 0 : side * 0.55) + gauss(random) * 0.2, aimY: uniform(random, 0.1, 0.75), power: clamp01(0.65 + gauss(random) * 0.12), curl: 0 };
  }
  const high = random() < 0.4;
  return { aimX: side * 0.8 + gauss(random) * 0.08, aimY: (high ? 0.74 : 0.25) + gauss(random) * 0.06, power: clamp01(0.72 + gauss(random) * 0.06), curl: 0 };
}
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** One practice round (5 kicks) on `seed`, as the page plays it. Returns the goals scored. */
export function playRound(seed: number, next: (index: number) => ShotInput, tuning: PracticeTuning = PRACTICE_TUNING) {
  const director = createGameDirector(seed, { name: "The Trialist", number: "" });
  let keeper: KeeperId = director.startSession({ mode: "penalties", stadium: "park", keeper: "mouse", weather: "sun" }).keeper;
  const history: number[] = [], results: string[] = [], keepers: KeeperId[] = [];
  let goals = 0;
  for (let index = 0; index < 5; index++) {
    keeper = director.beforeKick({ now: index * 8 }).keeper;
    const kick = practiceKick(next(index), 0, keeper, kickSeed(seed, index, keeper), index, history, tuning);
    const { outcome } = kick;
    director.afterKick({ kind: "penalty", result: outcome.result, zone: outcome.zone, x: outcome.target.x, y: outcome.target.y, postIn: outcome.postIn, now: index * 8 + 4 });
    history.push(outcome.target.x); results.push(outcome.result); keepers.push(keeper);
    if (outcome.result === "goal") goals++;
  }
  return { goals, results, keepers };
}

function measure(profile: Profile, tuning: PracticeTuning, rounds = 2000, base = 1) {
  const distribution = [0, 0, 0, 0, 0, 0];
  let goals = 0;
  for (let round = 0; round < rounds; round++) {
    const seed = (base * 7919 + round * 104729) >>> 0, random = prng(seed ^ 0xa5a5a5);
    const { goals: scored } = playRound(seed, () => gesture(profile, random), tuning);
    distribution[scored]++; goals += scored;
  }
  return { rate: goals / (rounds * 5), distribution: distribution.map(n => n / rounds) };
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
if (process.env.PK_PRACTICE_REPORT) {
  for (const [label, tuning] of [["before", BASELINE_TUNING], ["after", PRACTICE_TUNING]] as const) {
    for (const profile of ["careless", "casual", "good"] as const) {
      const { rate, distribution } = measure(profile, tuning, 4000, 3);
      console.log(`${label.padEnd(6)} ${profile.padEnd(8)} ${pct(rate).padStart(6)}  goals/5 0..5: ${distribution.map(pct).join(" ")}`);
    }
  }
}

/** Straight-up (centre) blasts at one height and pace, the audit's "naive swipe" (1280x800 drags land near y 0.58). */
function blaster(aimY: number, power: number, tuning: PracticeTuning, rounds = 2000) {
  const distribution = [0, 0, 0, 0, 0, 0];
  for (let round = 0; round < rounds; round++) distribution[playRound((round * 104729 + 17) >>> 0, () => ({ aimX: 0, aimY, power, curl: 0 }), tuning).goals]++;
  return { rate: distribution.reduce((sum, n, goals) => sum + n * goals, 0) / (rounds * 5), perfect: distribution[5] / rounds, poor: (distribution[0] + distribution[1]) / rounds };
}
if (process.env.PK_PRACTICE_REPORT) {
  for (const [label, tuning] of [["before", BASELINE_TUNING], ["after", PRACTICE_TUNING]] as const) for (const aimY of [0.2, 0.4, 0.58, 0.75]) {
    const { rate, perfect, poor } = blaster(aimY, 0.46, tuning);
    console.log(`${label.padEnd(6)} centre blast y${aimY}: ${pct(rate)} goals, 5/5 in ${pct(perfect)}, 0-1 in ${pct(poor)}`);
  }
}

/** scripts/test-practice.mjs plays ?seed=BROWSER_SEED at 1280x800: its swipes map to aimY ~0.58, power ~0.46-0.5. */
const BROWSER_SEED = 194426;

test("practice: a careless player scores about 3 of 5, not a guaranteed 5 of 5", () => {
  const { rate, distribution } = measure("careless", PRACTICE_TUNING);
  assert.ok(rate >= 0.45 && rate <= 0.7, `careless goal rate ${pct(rate)} (want 45-70%)`);
  assert.ok(distribution[5] < 0.15, `careless 5/5 in ${pct(distribution[5])} of rounds`);
  // Welcoming: a careless player usually still scores at least two.
  assert.ok(distribution[0] + distribution[1] < 0.2, `careless 0-1 goals in ${pct(distribution[0] + distribution[1])} of rounds`);
});

test("practice: aiming pays (casual in between, corners score at least 80%)", () => {
  const careless = measure("careless", PRACTICE_TUNING).rate, casual = measure("casual", PRACTICE_TUNING).rate, good = measure("good", PRACTICE_TUNING).rate;
  assert.ok(good >= 0.8, `good goal rate ${pct(good)}`);
  assert.ok(casual > careless && casual < good, `casual ${pct(casual)} between careless ${pct(careless)} and good ${pct(good)}`);
});

test("practice: before the tuning, centre swipes nearly always scored (the regression this guards)", () => {
  assert.ok(measure("careless", BASELINE_TUNING).rate > 0.8);
});

test("practice: centre blasting at any low-to-mid height is not a guaranteed 5/5, yet still scores most rounds", () => {
  for (const aimY of [0.2, 0.4, 0.58]) {
    const { rate, perfect, poor } = blaster(aimY, 0.46, PRACTICE_TUNING);
    assert.ok(rate >= 0.45 && rate <= 0.7 && perfect < 0.2 && poor < 0.2, `centre blast y${aimY}: ${pct(rate)}, 5/5 ${pct(perfect)}, 0-1 ${pct(poor)}`);
  }
});

test("practice: the browser test's seed is robust (centre swipes <= 3, corner swipes >= 4, whatever the exact pace)", () => {
  for (const aimY of [0.5, 0.54, 0.58, 0.62]) for (const power of [0.42, 0.46, 0.5, 0.55]) {
    const centre = playRound(BROWSER_SEED, () => ({ aimX: 0, aimY, power, curl: 0 }));
    const corners = playRound(BROWSER_SEED, index => ({ aimX: index % 2 ? -0.76 : 0.76, aimY, power, curl: 0 }));
    assert.ok(centre.goals <= 3, `centre y${aimY} p${power}: ${centre.results.join(" ")}`);
    assert.ok(corners.goals >= 4, `corners y${aimY} p${power}: ${corners.results.join(" ")}`);
  }
});

test("practice: deterministic, and a miss always gets a short friendly tip", () => {
  const a = playRound(12345, () => ({ aimX: 0, aimY: 0.3, power: 0.7, curl: 0 })), b = playRound(12345, () => ({ aimX: 0, aimY: 0.3, power: 0.7, curl: 0 }));
  assert.deepEqual(a, b);
  for (const result of ["save", "post", "over", "wide"] as const) for (const x of [0, 0.8]) {
    const tip = missHint(result, x);
    assert.ok(tip.length > 0 && tip.length <= 60, `${result}: "${tip}"`);
    assert.ok(!/\bRF\b|GBOOT|prize|jackpot|\bpot\b/i.test(tip));
  }
  assert.equal(missHint("goal", 0), "");
  assert.match(missHint("save", 0), /corner/);
});
