import { test } from "node:test";
import assert from "node:assert/strict";
import { CELEBRATIONS, celebrationPose, celebrationBeat, reactionBeat, track, CELEBRATION_SETTLE, REACTION_SETTLE, ROTATE_STEP, type Beat, type CelebrationId } from "../../games/penalty-kings/gfx/friend.ts";
import type { Particles } from "../../games/penalty-kings/gfx/core.ts";

// B12: celebrations with follow-through. Every beat is anticipation → action → overshoot → settle,
// pixel-snapped, and a single static pose under reduced motion. Stage timings are unchanged
// (celebrate mode 2.6 s, react mode 1.6 s), so each pose must be settled before those end.

const DT = 1 / 120, CELEBRATE_MODE = 2.6, REACT_MODE = 1.6;
const ids = CELEBRATIONS.map(c => c.id) as CelebrationId[];
const samples = (end: number) => Array.from({ length: Math.round(end / DT) + 1 }, (_, i) => i * DT);
/** Squash/stretch independent of any uniform scale: < 1 squashed (crouch/landing), > 1 stretched. */
const squash = (b: Beat) => b.sy / b.sx;
const channels = { squash, dy: (b: Beat) => b.dy, rotate: (b: Beat) => b.rotate };
const EPS = { squash: 0.03, dy: 2, rotate: 0.04 };

/** Anticipation: a crouch (≤ 0.85) with no rise yet, strictly BEFORE the first stretch into the action (≥ 1.1). Returns the stretch time. */
function assertAnticipation(name: string, at: (t: number) => Beat, end: number) {
  const ts = samples(end), stretchT = ts.find(t => squash(at(t)) >= 1.1);
  assert.ok(stretchT !== undefined, `${name}: stretches into the action`);
  const crouchT = ts.find(t => squash(at(t)) <= 0.85);
  assert.ok(crouchT !== undefined && crouchT < stretchT, `${name}: crouches (anticipation) at ${crouchT} before the action at ${stretchT}`);
  for (const t of ts.filter(t => t <= crouchT!)) assert.ok(at(t).dy >= 0, `${name}: the anticipation dips, never rises (t=${t})`);
  return stretchT;
}
/** Overshoot: after the action, some channel swings past its rest value on BOTH sides before settling. */
function assertOvershoot(name: string, at: (t: number) => Beat, from: number, end: number) {
  const rest = at(end), ts = samples(end).filter(t => t > from && t < end);
  const passed = (Object.keys(channels) as (keyof typeof channels)[]).filter(ch => {
    const f = channels[ch], r = f(rest), first = ts.findIndex(t => Math.abs(f(at(t)) - r) > EPS[ch]);
    if (first < 0) return false;
    const side = Math.sign(f(at(ts[first])) - r);
    return ts.slice(first).some(t => Math.sign(f(at(t)) - r) === -side && Math.abs(f(at(t)) - r) > EPS[ch]);
  });
  assert.ok(passed.length > 0, `${name}: overshoots its rest pose and comes back (follow-through)`);
}
/** Settle: exactly the rest pose from `end` to the end of the Stage mode, with no residual squash, and no pop into it. */
function assertSettles(name: string, at: (t: number) => Beat, end: number, modeEnd: number) {
  const rest = at(end);
  for (let t = end; t <= modeEnd + 1e-9; t += DT) assert.deepEqual(at(t), rest, `${name}: at rest at t=${t.toFixed(3)}`);
  assert.equal(squash(rest), 1, `${name}: rests with no squash/stretch`);
  const before = at(end - 1 / 60);
  assert.ok(Math.abs(before.dy - rest.dy) <= 1 && Math.abs(before.dx - rest.dx) <= 1 && Math.abs(squash(before) - 1) <= 0.03 && Math.abs(before.rotate - rest.rotate) <= 0.05, `${name}: eases into rest (no pop)`);
}

test("every celebration: anticipation dip before the action, an overshoot, then exactly at rest before the celebrate mode ends", () => {
  assert.ok(CELEBRATION_SETTLE < CELEBRATE_MODE);
  for (const id of ids) {
    const at = (t: number) => celebrationPose(id, t, false);
    assert.deepEqual({ ...at(0), facing: "down", flip: false, cape: false, trophy: false }, { dx: 0, dy: 0, rotate: 0, sx: 1, sy: 1, flip: false, facing: "down", cape: false, trophy: false }, `${id}: starts from the neutral pose`);
    const stretchT = assertAnticipation(id, at, CELEBRATION_SETTLE);
    assertOvershoot(id, at, stretchT, CELEBRATION_SETTLE);
    assertSettles(id, at, CELEBRATION_SETTLE, CELEBRATE_MODE);
  }
});

test("pixel-snapped: whole-pixel offsets, rotation in π/64 steps, squash/stretch in 1/64 steps", () => {
  const check = (name: string, b: Beat) => {
    assert.ok(Number.isInteger(b.dx) && Number.isInteger(b.dy), `${name}: integer offsets`);
    assert.ok(Math.abs(b.rotate / ROTATE_STEP - Math.round(b.rotate / ROTATE_STEP)) < 1e-9, `${name}: rotation step`);
    for (const s of [b.sx, b.sy]) assert.ok(Math.abs(s * 64 - Math.round(s * 64)) < 1e-9, `${name}: scale step`);
    assert.ok(!Object.is(b.dx, -0) && !Object.is(b.dy, -0));
  };
  for (const t of samples(CELEBRATE_MODE)) {
    for (const id of ids) for (const reduced of [false, true]) check(`${id}@${t}`, celebrationPose(id, t, reduced));
    for (const kind of ["miss", "save", "post"] as const) for (const reduced of [false, true]) check(`${kind}@${t}`, reactionBeat(kind, t, reduced));
  }
});

test("knee slide leans BACK (not forward, not fallen) through a decelerating slide, then gets up", () => {
  const at = (t: number) => celebrationPose("knee-slide", t, false);
  // Facing right: a negative rotation tips the head back, away from the direction of travel.
  for (const t of samples(2.0).filter(t => t >= 0.46)) {
    const b = at(t);
    assert.equal(b.facing, "right");
    assert.ok(b.rotate < 0, `leans back at t=${t.toFixed(2)} (rotate ${b.rotate.toFixed(3)})`);
    assert.ok(b.rotate > -0.4, `upright enough to read as kneeling, not lying down (t=${t.toFixed(2)})`);
    assert.ok(squash(b) >= 0.78 && b.dy >= 0 && b.dy <= 3, `on the knees, not flattened (t=${t.toFixed(2)})`);
  }
  // The run-up leans INTO the sprint before the drop: the change of lean is what sells the slide.
  assert.ok(at(0.36).rotate > 0, "leans forward in the sprint");
  // Decelerates: covers more ground in the first half of the slide than the second, and never slides back.
  const x = (t: number) => at(t).dx;
  assert.ok(x(0.94) - x(0.38) > 2 * (x(1.5) - x(0.94)), "fast then slow");
  for (const t of samples(1.5).filter(t => t >= 0.38)) assert.ok(x(t + DT) >= x(t), "never slides backwards");
  assert.equal(x(CELEBRATION_SETTLE), 70, "ends where the slide stopped");
  // Follow-through at the stop: the torso pitches forward from the lean and rocks back past it.
  const lean = samples(2.0).filter(t => t >= 1.5).map(t => at(t).rotate);
  assert.ok(Math.max(...lean) > -0.2 && Math.min(...lean) < -0.28, "the stop rocks the torso");
});

test("knee slide FX: a turf spray and a dust puff at the stop; none of it under reduced motion", () => {
  const record = () => { const kinds: string[] = []; return { kinds, particles: { emit: (kind: string) => { kinds.push(kind); } } as unknown as Particles }; };
  const full = record(), reduced = record();
  const random = Math.random; Math.random = () => 0;
  try {
    for (const t of samples(CELEBRATE_MODE)) {
      celebrationBeat("knee-slide", t, false, full.particles, { x: 100, y: 200 }, ["#fff"]);
      celebrationBeat("knee-slide", t, true, reduced.particles, { x: 100, y: 200 }, ["#fff"]);
    }
  } finally { Math.random = random; }
  assert.ok(full.kinds.includes("grass") && full.kinds.includes("dust"));
  assert.deepEqual(reduced.kinds, [], "reduced motion: no dust or turf");
});

test("reduced motion: every celebration and reaction is one static pose, with no squash/stretch", () => {
  for (const id of ids) {
    const still = celebrationPose(id, 0, true);
    assert.equal(still.sx, 1); assert.equal(still.sy, 1);
    for (const t of samples(CELEBRATE_MODE)) assert.deepEqual(celebrationPose(id, t, true), still, `${id} static at t=${t}`);
  }
  for (const kind of ["miss", "save", "post"] as const) {
    const still = reactionBeat(kind, 0, true);
    assert.equal(still.sx, 1); assert.equal(still.sy, 1);
    for (const t of samples(REACT_MODE)) assert.deepEqual(reactionBeat(kind, t, true), still, `${kind} static`);
  }
});

test("reactions: anticipation, overshoot, then exactly at rest before the react mode ends", () => {
  assert.ok(REACTION_SETTLE < REACT_MODE);
  for (const kind of ["miss", "save", "post"] as const) {
    const at = (t: number) => reactionBeat(kind, t, false);
    // Anticipation is the opposite of the main beat: a stretch before a slump, a flinch before a jolt.
    const first = samples(0.14).map(t => squash(at(t))), main = samples(0.6).filter(t => t > 0.14).map(t => squash(at(t)));
    if (kind === "post") assert.ok(Math.min(...first) < 0.95 && Math.max(...main) > 1.1, "post: flinch, then jolted up");
    else assert.ok(Math.max(...first) > 1.03 && Math.min(...main) < 0.85, `${kind}: up on the toes, then the slump`);
    assertOvershoot(kind, at, 0.14, REACTION_SETTLE);
    const rest = at(REACTION_SETTLE);
    for (let t = REACTION_SETTLE; t <= REACT_MODE + 1e-9; t += DT) assert.deepEqual(at(t), rest, `${kind}: at rest`);
  }
});

test("track: eases between keys and holds outside them", () => {
  const keys = [[0, 0], [1, 10], [2, 4, "in"]] as const;
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  assert.equal(track(keys, -1), 0); near(track(keys, 0.5), 5); assert.equal(track(keys, 1), 10);
  near(track(keys, 1.5), 10 - 6 * 0.25); assert.equal(track(keys, 5), 4);
});
