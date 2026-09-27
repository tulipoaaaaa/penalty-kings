import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "../../engine/src/index.ts";
import { ROUND_KICKS } from "../src/index.ts";
import { LADDER, simulate, tiersOf } from "./sim.ts";
import type { PlayMode, StadiumId } from "../src/types.ts";

const SETTINGS: { mode: PlayMode; stadium: StadiumId }[] = [
  { mode: "penalties", stadium: "park" }, { mode: "penalties", stadium: "pro" }, { mode: "penalties", stadium: "champions" },
  { mode: "freekicks", stadium: "park" }, { mode: "match", stadium: "pro" }, { mode: "daily", stadium: "park" }, { mode: "tour", stadium: "champions" },
];
const runs = () => SETTINGS.flatMap(setting => [1, 2, 3, 42, 99, 2024].map(seed => ({ ...setting, seed, ...simulate({ ...setting, seed, kicks: 80, keeper: "peacock" }) })));

test("every kick has at least one micro-moment and a commentator line", () => {
  for (const run of runs()) run.steps.forEach((step, k) => {
    assert.ok(tiersOf(step).includes("micro"), `${run.mode}/${run.stadium} seed ${run.seed} kick ${k}: no micro-moment`);
    assert.ok(step.after.lines.length >= 1, `kick ${k}: no line`);
  });
});

test("a notable moment every 3–4 kicks", () => {
  for (const run of runs()) {
    const kicks = run.steps.flatMap((step, k) => (tiersOf(step).includes("notable") ? [k] : []));
    assert.ok(kicks[0] === 2 || kicks[0] === 3, `first notable at ${kicks[0]}`);
    for (let i = 1; i < kicks.length; i++) assert.ok([3, 4].includes(kicks[i] - kicks[i - 1]), `${run.mode}/${run.stadium} seed ${run.seed}: notable gap ${kicks[i] - kicks[i - 1]} at kick ${kicks[i]}`);
    assert.ok(run.steps.length - 1 - kicks[kicks.length - 1] <= 3);
    for (const step of run.steps) assert.ok(tiersOf(step).filter(t => t === "notable").length <= 1);
  }
});

test("a set piece every round (at most 5 kicks apart, at least 4), always at PEAK", () => {
  for (const run of runs()) {
    const kicks = run.steps.flatMap((step, k) => (tiersOf(step).includes("set-piece") ? [k] : []));
    assert.ok(kicks[0] <= ROUND_KICKS - 1, `first set piece at ${kicks[0]}`);
    for (let i = 1; i < kicks.length; i++) assert.ok([4, 5].includes(kicks[i] - kicks[i - 1]), `set-piece gap ${kicks[i] - kicks[i - 1]}`);
    for (let start = 0; start + ROUND_KICKS <= run.steps.length; start++) assert.ok(kicks.some(k => k >= start && k < start + ROUND_KICKS), `no set piece in kicks ${start}–${start + 4}`);
    run.steps.forEach((step, k) => assert.equal(step.before.phase === "peak", kicks.includes(k), `kick ${k}: phase ${step.before.phase}`));
  }
});

test("phase cycle: BUILD-UP → PEAK → RELAX → BUILD-UP", () => {
  for (const run of runs()) {
    const phases = run.steps.map(step => step.before.phase);
    phases.forEach((phase, k) => {
      if (k === 0) return;
      if (phases[k - 1] === "peak") assert.equal(phase, "relax", `kick ${k} after a peak`);
      if (phase === "peak") assert.notEqual(phases[k - 1], "peak");
    });
    assert.ok(phases.includes("build-up") && phases.includes("relax") && phases.includes("peak"));
    // build-up moments are pressure; relax moments are flavour
    for (const step of run.steps) {
      const before = step.before.moments.filter(m => m.tier === "micro").map(m => m.id);
      if (step.before.phase === "relax") assert.ok(!before.some(id => ["shot-clock", "drumbeat", "keeper-tell"].includes(id)), `pressure in relax: ${before}`);
    }
  }
});

test("Park rotation: the same keeper for at most 3 kicks in a row, and the player meets the cast", () => {
  for (const seed of [1, 5, 9, 77, 1234]) {
    const { steps } = simulate({ seed, kicks: 60, mode: "penalties", stadium: "park", keeper: "octopus" });
    let run = 1, longest = 1;
    for (let k = 1; k < steps.length; k++) { run = steps[k].before.keeper === steps[k - 1].before.keeper ? run + 1 : 1; longest = Math.max(longest, run); }
    assert.ok(longest <= 3, `seed ${seed}: ${longest} kicks in a row against one keeper`);
    const met = new Set(steps.map(step => step.before.keeper));
    assert.ok(met.size >= 5, `seed ${seed}: only met ${[...met]}`);
    for (const id of met) assert.ok(LADDER.indexOf(id) <= LADDER.indexOf("mime"), `${id} is beyond the next rung`);
  }
  // A brand-new player (ladder at the mouse) still alternates between two keepers.
  const fresh = simulate({ seed: 3, kicks: 12, mode: "penalties", stadium: "park", keeper: "mouse" }).steps.map(step => step.before.keeper);
  assert.deepEqual(new Set(fresh), new Set(["mouse", "squirrel"]));
});

test("Pro and Champions keep the harder ladders", () => {
  const mult = (id: string) => KEEPERS.find(k => k.id === id)!.mult;
  for (const [stadium, floor] of [["pro", 1.25], ["champions", 1.5]] as const) {
    const { steps } = simulate({ seed: 11, kicks: 60, mode: "penalties", stadium, keeper: "ghost" });
    for (const step of steps) assert.ok(mult(step.before.keeper) >= floor || step.before.keeper === "ghost", `${stadium}: ${step.before.keeper}`);
    assert.ok(new Set(steps.map(s => s.before.keeper)).size >= 3);
  }
});

test("outside free play the shell's keeper is never changed", () => {
  for (const mode of ["match", "daily", "tour", "skill"] as const) {
    const { steps } = simulate({ seed: 8, kicks: 40, mode, stadium: "pro", keeper: "sumo" });
    for (const step of steps) { assert.equal(step.before.keeper, "sumo", mode); assert.equal(step.after.keeper, "sumo", mode); }
    for (const step of steps) assert.ok(![...step.before.moments, ...step.after.moments].some(m => m.id === "keeper-sub" || m.id === "boss-appearance"));
  }
});

test("the deck prefers unseen moments: a long session discovers most of the catalogue", () => {
  const director = simulate({ seed: 4, kicks: 60, stadium: "park", mode: "penalties", keeper: "disco" }).director;
  simulate({ seed: 5, kicks: 60, stadium: "pro", mode: "penalties", keeper: "disco", director, timeOfDay: "night" });
  simulate({ seed: 6, kicks: 60, stadium: "champions", mode: "freekicks", keeper: "robot", director, weather: "rain" });
  const found = director.discovery();
  assert.ok(found.seen >= 48, `${found.label}; missing ${found.missing.map(m => m.id)}`);
});
