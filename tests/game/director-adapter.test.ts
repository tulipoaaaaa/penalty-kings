import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS } from "@penalty-kings/engine";
import { CATALOGUE, MOMENT_STAGE, applyBeat, createGameDirector, playMoment, type Moment } from "../../games/penalty-kings/game/director.ts";
import { LADDER } from "../../games/penalty-kings/game/progress.ts";
import { commentary, cueLine, COMMENTARY_COUNT, ALL_COMMENTARY_COUNT } from "../../games/penalty-kings/gfx/commentary.ts";
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

test("cueLine shows a Director line verbatim; legacy contexts still work", () => {
  assert.equal(commentary(cueLine({ id: "goal#1", text: "Exactly this." }), { friend: "F", keeper: "K" }), "Exactly this.");
  assert.ok(commentary("goal", { friend: "F", keeper: "K" }).length > 0);
  assert.ok(ALL_COMMENTARY_COUNT >= COMMENTARY_COUNT + 150);
});
