import { test } from "node:test";
import assert from "node:assert/strict";
import { GameDirector, MOMENTS, MOMENT_COUNT, CATALOGUE, LINE_BANK, encodeSeen, decodeSeen, discovery } from "../src/index.ts";
import { KEEPERS } from "../../engine/src/index.ts";
import { LADDER, newDirector, simulate } from "./sim.ts";

test("same seed and inputs give the same outputs; another seed differs", () => {
  const a = simulate({ seed: 7, kicks: 50 }), b = simulate({ seed: 7, kicks: 50 });
  assert.deepEqual(a.steps, b.steps);
  assert.deepEqual(a.sessions, b.sessions);
  assert.deepEqual(a.director.debugState(), b.director.debugState());
  const director = newDirector(8), other = simulate({ seed: 7, kicks: 50, director });
  assert.notDeepEqual(a.steps.map(s => s.after.moments), other.steps.map(s => s.after.moments));
});

test("save() and restore mid-session continue exactly as an uninterrupted director", () => {
  const whole = simulate({ seed: 21, kicks: 40 });
  const first = simulate({ seed: 21, kicks: 40 });
  // Re-run: 17 kicks, save, restore into a fresh instance, then drive the rest with the same inputs.
  const live = newDirector(21), steps = simulate({ seed: 21, kicks: 40, director: live }).steps;
  assert.deepEqual(steps, whole.steps);
  const partial = newDirector(21);
  const script = first.steps;
  for (let k = 0; k < 17; k++) {
    if (k % 5 === 0) partial.startSession({ mode: "penalties", stadium: "park", keeper: "squirrel", weather: "sun", timeOfDay: "evening" });
    partial.beforeKick({ now: (k + 1) * 12 - 6, suddenDeath: false }); partial.afterKick(script[k].facts);
  }
  const saved = JSON.parse(JSON.stringify(partial.save()));
  const restored = new GameDirector({ seed: 999, keepers: KEEPERS, ladder: LADDER, friendName: "Friend #336583", friendNumber: "336583", state: saved });
  assert.deepEqual(restored.save(), partial.save());
  assert.deepEqual(restored.debugState(), partial.debugState());
  const x = partial.beforeKick({ now: 500 }), y = restored.beforeKick({ now: 500 });
  assert.deepEqual(x, y);
  assert.deepEqual(partial.afterKick(script[17].facts), restored.afterKick(script[17].facts));
});

test("the catalogue: ~60 moments with unique ids, human names, three tiers and a line each", () => {
  assert.ok(MOMENT_COUNT >= 60, `${MOMENT_COUNT} moments`);
  assert.equal(new Set(MOMENTS.map(m => m.id)).size, MOMENT_COUNT);
  assert.equal(CATALOGUE.length, MOMENT_COUNT);
  for (const tier of ["micro", "notable", "set-piece"] as const) assert.ok(MOMENTS.filter(m => m.tier === tier).length >= 10, tier);
  for (const m of MOMENTS) {
    assert.ok(m.name.length > 3 && /^[a-z0-9-]+$/.test(m.id), m.id);
    assert.ok(m.weight > 0 && m.cooldown >= 0 && m.phases.length > 0, m.id);
    if (m.id !== "keeper-banter") assert.ok(LINE_BANK[`moment:${m.id}`]?.length, `no line for ${m.id}`); // banter speaks from BANTER pairs
  }
});

test("trigger() stages every moment on demand and marks it seen", () => {
  const director = newDirector(1);
  director.startSession({ mode: "penalties", stadium: "pro", keeper: "disco" });
  for (const m of MOMENTS) {
    const moment = director.trigger(m.id)!;
    assert.equal(moment.id, m.id); assert.equal(moment.name, m.name); assert.equal(moment.tier, m.tier);
  }
  assert.equal(director.discovery().seen, MOMENT_COUNT);
  assert.equal(director.trigger("nope"), null);
  assert.equal(director.trigger("keeper-sub")!.keeper !== undefined, true);
  assert.equal(director.trigger("golden-hour")!.weather, "sunset");
  assert.match(director.trigger("friend-chant")!.jumbotron!, /336583/);
});

test("seen ids serialise compactly and round-trip (for progress and save codes)", () => {
  const ids = ["crowd-hush", "cat-invader", "golden-hour", "thunderstorm", "var-check"];
  const code = encodeSeen(ids);
  assert.match(code, /^[A-Za-z0-9_-]{0,10}$/);
  assert.deepEqual(new Set(decodeSeen(code)), new Set(ids));
  assert.equal(encodeSeen([]), "");
  assert.equal(encodeSeen(MOMENTS.map(m => m.id)).length, Math.ceil(MOMENT_COUNT / 6));
  assert.deepEqual(decodeSeen("!!"), []);
  assert.equal(discovery(ids).label, `Seen 5/${MOMENT_COUNT} moments`);
  const director = new GameDirector({ seed: 1, keepers: KEEPERS, seen: code });
  assert.equal(director.discovery().seen, 5);
  assert.equal(director.seenCode(), code);
});

test("debugState(): phase, intensity (with its parts), next moment, cooldowns", () => {
  const { director } = simulate({ seed: 3, kicks: 13 });
  const state = director.debugState();
  assert.ok(["build-up", "peak", "relax"].includes(state.phase));
  assert.ok(state.intensity >= 0 && state.intensity <= 1);
  assert.deepEqual(Object.keys(state.intensityParts).sort(), ["bigPull", "missesInRow", "nearMiss", "sinceMoment", "streak"]);
  assert.ok(state.nextMoment && typeof state.nextMoment.id === "string");
  assert.ok(Object.keys(state.cooldowns).length > 0);
  assert.equal(state.kick, 13);
  // debugState() is read-only: it does not advance the seeded stream.
  const again = director.debugState();
  assert.deepEqual(again, state);
});

test("intensity rises with streaks, near misses and big pulls", () => {
  const director = newDirector(2);
  director.startSession({ mode: "penalties", stadium: "park", keeper: "mouse" });
  const calm = director.intensity();
  for (let k = 0; k < 4; k++) { director.beforeKick(); director.afterKick({ kind: "penalty", result: "goal", zone: "corner", x: 0.7, y: 0.4 }); }
  const hot = director.intensity();
  assert.ok(hot > calm + 0.3, `${calm} → ${hot}`);
  const other = newDirector(2);
  other.startSession({ mode: "penalties", stadium: "park", keeper: "mouse" });
  other.beforeKick(); other.afterKick({ kind: "penalty", result: "post", zone: "corner", x: 1, y: 0.5 });
  const post = other.intensity();
  other.noteBigPull();
  assert.ok(other.intensity() > post && post > calm);
});

test("keeper banter, first-time lines and the boss cameo", () => {
  const director = newDirector(12);
  director.startSession({ mode: "penalties", stadium: "pro", keeper: "robot" });
  director.beforeKick();
  const first = director.afterKick({ kind: "penalty", result: "goal", zone: "bin", x: 0.8, y: 0.9 });
  assert.equal(first.lines[0].context.startsWith("first:"), true, first.lines[0].context);
  const banter = director.trigger("keeper-banter")!;
  assert.equal(banter.lines.length, 2);
  assert.deepEqual(banter.lines.map(l => l.by), ["commentator", "keeper"]);
});

test("a long-range free-kick goal is a SCREAMER line (first time, then the screamer bank)", () => {
  const director = newDirector(21);
  director.startSession({ mode: "freekicks", stadium: "pro", keeper: "squirrel" });
  director.afterKick({ kind: "freekick", result: "goal", zone: "side", x: 0.5, y: 0.5 }); // the first goal line is used up
  director.beforeKick();
  const first = director.afterKick({ kind: "freekick", result: "goal", zone: "corner", x: 0.8, y: 0.4, screamer: true });
  assert.equal(first.lines[0].context, "first:screamer");
  director.beforeKick();
  const next = director.afterKick({ kind: "freekick", result: "goal", zone: "corner", x: -0.8, y: 0.4, screamer: true, now: 100 });
  assert.equal(next.lines[0].context, "goal:screamer");
  assert.ok(LINE_BANK["goal:screamer"].length >= 4);
});

test("BQ-P2-8: crossbar and in-off-the-bar lines come from the engine's hitBar flag, never the crossing height", () => {
  const start = () => { const d = newDirector(3); d.startSession({ mode: "penalties", stadium: "pro", keeper: "sloth" }); d.beforeKick(); return d; };
  const miss = (hitBar?: boolean) => start().afterKick({ kind: "penalty", result: "post", zone: "corner", x: 1.05, y: 0.95, hitBar }).lines[0].context;
  assert.equal(miss(), "post"); // high up, outside the end of the bar: the post
  assert.equal(miss(true), "crossbar");
  const goal = (hitBar?: boolean) => {
    const d = start(); d.afterKick({ kind: "penalty", result: "goal", zone: "side", x: 0.5, y: 0.5 }); d.beforeKick();
    return d.afterKick({ kind: "penalty", result: "goal", zone: "centre", x: 0.3, y: 0.95, postIn: true, hitBar, now: 100 }).lines[0].context;
  };
  assert.equal(goal(true), "first:bar-in");
  assert.equal(goal(), "first:post-in");
  assert.ok(LINE_BANK["goal:bar-in"].length >= 3 && LINE_BANK["first:bar-in"].length >= 1);
});
