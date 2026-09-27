import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEEPERS } from "@penalty-kings/engine";
import { FREE_PLAY_MODES } from "@penalty-kings/game-director";
import { CATALOGUE, MOMENT_STAGE, applyBeat, createGameDirector, playMoment, type Moment } from "../../games/penalty-kings/game/director.ts";
import { LADDER } from "../../games/penalty-kings/game/progress.ts";
import { commentary, cueLine, freshCommentary, NO_REPEAT_SECONDS, COMMENTARY_COUNT, ALL_COMMENTARY_COUNT } from "../../games/penalty-kings/gfx/commentary.ts";
import type { Stage } from "../../games/penalty-kings/gfx/stage.ts";

/** A Stage stand-in that records the calls the adapter makes (the real Stage needs a DOM). */
function fakeStage() {
  const calls: string[] = [];
  const scene = {
    keeper: "squirrel", weather: "sun", jumbotron: "",
    crowd: { catActive: false, catX: -40, react: (mood: string) => calls.push(`crowd:${mood}`) },
    camera: { addTrauma: () => calls.push("trauma") },
    particles: { emit: (kind: string) => calls.push(`particles:${kind}`) },
    onEvent: (event: string, data: unknown) => calls.push(`${event}:${data}`),
    say: (context: string) => calls.push(`say:${commentary(context, { friend: "Friend #7", keeper: "K" })}`),
    taunt: () => calls.push("taunt"), wave: () => calls.push("wave"), walkout: () => calls.push("walkout"),
    keeperWalkOn: (id: string) => { scene.keeper = id; calls.push(`walkon:${id}`); },
  };
  return { scene: scene as unknown as Stage, calls, raw: scene };
}
const now = (_ms: number, run: () => void) => run();

test("the game's LADDER is the Director's default ladder (the engine's keeper order)", () => {
  assert.deepEqual(KEEPERS.map(k => k.id), [...LADDER]);
});

test("every catalogue moment maps to Stage calls, with what is missing stated", () => {
  for (const { id } of CATALOGUE) {
    const staging = MOMENT_STAGE[id];
    assert.ok(staging, `no Stage mapping for ${id}`);
    if (staging.support !== "full") assert.ok(staging.missing, `${id}: say what the Stage lacks`);
  }
  assert.equal(Object.keys(MOMENT_STAGE).length, CATALOGUE.length);
});

test("playMoment drives the Stage: wave, cat, weather, keeper swap, jumbotron, lines verbatim", () => {
  const director = createGameDirector(3, { name: "Friend #7", number: "7" });
  director.startSession({ mode: "penalties", stadium: "pro", keeper: "disco" });
  const { scene, calls, raw } = fakeStage();
  playMoment(scene, director.trigger("mexican-wave")!, now);
  assert.ok(calls.includes("wave"));
  playMoment(scene, director.trigger("cat-invader")!, now);
  assert.equal(raw.crowd.catActive, true);
  playMoment(scene, director.trigger("golden-hour")!, now);
  assert.equal(raw.weather, "sunset");
  const sub = director.trigger("keeper-sub")!;
  playMoment(scene, sub, now);
  assert.equal(raw.keeper, sub.keeper);
  assert.ok(calls.includes(`walkon:${sub.keeper}`), "a substitution walks on");
  const chant = playMoment(scene, director.trigger("friend-chant")!, now);
  assert.match(chant.jumbotron!, /#7/);
  const banter: Moment = director.trigger("keeper-banter")!;
  calls.length = 0; playMoment(scene, banter, now);
  assert.equal(calls.filter(c => c.startsWith("say:")).length, 2);
  assert.ok(calls.some(c => c.includes(banter.lines[0].text)));
});

test("applyBeat applies keeper changes and hush, and says the beat's lines", () => {
  const director = createGameDirector(9, { name: "Friend #7", number: "7" });
  const { scene, calls } = fakeStage();
  applyBeat(scene, director.startSession({ mode: "penalties", stadium: "park", keeper: "mouse" }), undefined, now);
  for (let k = 0; k < 10; k++) { applyBeat(scene, director.beforeKick(), undefined, now); applyBeat(scene, director.afterKick({ kind: "penalty", result: k % 3 ? "goal" : "save", zone: "corner", x: 0.6, y: 0.4 }), undefined, now); }
  assert.ok(calls.filter(c => c.startsWith("say:")).length >= 10);
});

test("shell wiring (SIO-3): keeper kept in paid, ranked and scripted modes; rotated in Park free play; a line every kick", () => {
  const kick = (k: number) => ({ kind: "penalty" as const, result: (["goal", "save", "goal", "wide", "goal", "post"] as const)[k % 6], zone: "corner" as const, x: k % 6 === 3 ? 1.05 : 0.6, y: 0.4, now: k * 6 });
  for (const mode of ["match", "skill", "tour", "daily", "tutorial"] as const) {
    const director = createGameDirector(11, { name: "Friend #7", number: "7" });
    for (let round = 0; round < 6; round++) {
      const opening = director.startSession({ mode, stadium: "pro", keeper: "disco" });
      assert.equal(opening.keeper, "disco", `${mode}: session keeper kept`);
      for (let k = 0; k < 5; k++) {
        const n = round * 5 + k, before = director.beforeKick({ now: n * 6 - 3 });
        assert.equal(before.keeper, "disco", `${mode}: the Director never changes the keeper here`);
        const after = director.afterKick(kick(n));
        assert.equal(after.skillScoreMultiplier, 1, `${mode}: no Golden Hour points outside free play`);
        assert.ok(after.lines.length >= 1, `${mode}: a commentary line on every kick`);
      }
    }
  }
  // Park free play: the keeper rotates within a session (every 2–3 kicks), from the easy ladder only.
  const director = createGameDirector(5, { name: "Friend #7", number: "7" });
  const met = new Set<string>(), used: [string, number][] = [];
  director.startSession({ mode: "penalties", stadium: "park", keeper: "squirrel" });
  for (let n = 0; n < 10; n++) {
    const before = director.beforeKick({ now: n * 6 - 3 }); met.add(before.keeper);
    assert.ok(before.moments.some(m => m.tier === "micro" || m.tier === "set-piece"), "a moment before every kick");
    const after = director.afterKick(kick(n));
    assert.ok(after.moments.some(m => m.tier === "micro"), "a reaction micro-moment after every kick");
    for (const line of after.lines) { assert.ok(!used.some(([id, at]) => id === line.id && n * 6 - at < 60), `line ${line.id} repeated within 60 s`); used.push([line.id, n * 6]); }
  }
  assert.ok(met.size >= 2, `Park free play rotates keepers (${[...met]})`);
  assert.ok([...met].every(id => ["mouse", "squirrel", "sloth"].includes(id)), `Park keepers stay on the easy ladder (${[...met]})`);
});

test("shell wiring: Golden Hour doubles only FREE-PLAY skill points; the Director is never told about balls, RF or prizes", () => {
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  const direct = index.slice(index.indexOf("function direct("), index.indexOf("/** The countdown bar"));
  assert.match(direct, /skillScoreMultiplier === 2 && \(FREE_PLAY_MODES as readonly string\[\]\)\.includes\(current\.mode\)/, "the ×2 is gated on free play");
  assert.deepEqual([...FREE_PLAY_MODES].sort(), ["freekicks", "penalties"]);
  const calls = [...index.matchAll(/director\(\)\.(startSession|beforeKick|afterKick)\(([^;]*)\)/g)].map(match => match[2]);
  assert.ok(calls.length >= 4);
  for (const args of calls) assert.doesNotMatch(args, /rarity|rf|reward|prize|odds|price|outcomes|gboot|payout/i, `Director call carries money-shaped data: ${args}`);
  // The only paid-adjacent input is the cosmetic ball glow, derived for a commentary line (never a value).
  assert.match(index, /const glowOf = \(current: Session\): BallGlow =>/);
});

test("the Stage's line picker never shows the same text twice within 60 s (silence instead)", () => {
  const names = { friend: "Friend #7", keeper: "Squeak" }, shown: [string, number][] = [];
  for (let t = 0; t < 180; t += 1.5) for (const context of ["goal", "wave", "buildup", "here-comes-trouble"]) {
    const text = freshCommentary(context, names, t);
    if (text === null) continue;
    assert.ok(!shown.some(([seen, at]) => seen === text && t - at < NO_REPEAT_SECONDS), `"${text}" repeated within 60 s`);
    shown.push([text, t]);
  }
  const cue = cueLine({ id: "goal#3", text: "One of a kind." });
  assert.equal(freshCommentary(cue, names, 500), "One of a kind.");
  assert.equal(freshCommentary(cueLine({ id: "goal#3", text: "One of a kind." }), names, 530), null, "a Director line is not shown again inside the window");
  assert.equal(freshCommentary(cueLine({ id: "goal#3", text: "One of a kind." }), names, 561), "One of a kind.");
});

test("cueLine shows a Director line verbatim; legacy contexts still work", () => {
  assert.equal(commentary(cueLine({ id: "goal#1", text: "Exactly this." }), { friend: "F", keeper: "K" }), "Exactly this.");
  assert.ok(commentary("goal", { friend: "F", keeper: "K" }).length > 0);
  assert.ok(ALL_COMMENTARY_COUNT >= COMMENTARY_COUNT + 150);
});
