import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, KEEPER_RIGS, RIG_POSES, DIFFICULTY_LADDER, NEUTRAL, resolveShot, kickSeed, prng, type KeeperId, type ShotOutcome } from "@penalty-kings/engine";
import { KEEPER_DESIGNS, keeperArt, keeperRows, lookFor } from "../../games/penalty-kings/gfx/keepers.ts";
import { penaltyFlight, keeperClock, penaltyKeeperFrame, penaltyBallArt } from "../../games/penalty-kings/gfx/stage.ts";

// Round 6 B4: a penalty is saved ONLY when the rendered keeper touches the rendered ball at the crossing frame.
// This test rebuilds what the Stage DRAWS at that frame (the sprite's real pixels from the art, the arm lines,
// the glove squares, the trailing leg, the mime wall, and the ball circle) in goal-art px, with its own
// geometry code, and compares it with resolveShot over 2,000 seeded kicks.

test("the physics hit mask is the art: every keeper's opaque pixels per pose, scale, shoulder and arm length", () => {
  for (const [id, design] of Object.entries(KEEPER_DESIGNS) as [KeeperId, (typeof KEEPER_DESIGNS)[KeeperId]][]) {
    const rig = KEEPER_RIGS[id];
    for (const pose of RIG_POSES) {
      // The rows the Stage draws for this pose (keeperRows), read pixel by pixel through the palette.
      const drawn = keeperRows(id, pose).rows.map(row => [...row].map(ch => (design.palette[ch] ? "#" : ".")).join(""));
      assert.deepEqual(rig.poses[pose], drawn, `${id} ${pose} mask (run node scripts/gen-keeper-masks.mjs)`);
      assert.deepEqual([drawn.length, drawn[0].length], [design.rows.length, design.rows[0].length], `${id} ${pose}: every pose shares the body grid`);
    }
    assert.deepEqual([rig.scale, rig.shoulderY, rig.armLength], [design.scale, design.shoulderY, design.armLength], `${id} rig`);
  }
});

test("physics poses never depend on the clock: parts are frozen, animation only recolours opaque pixels", () => {
  for (const id of Object.keys(KEEPER_DESIGNS) as KeeperId[]) for (const pose of RIG_POSES) {
    const still = keeperRows(id, pose).rows;
    for (let phase = 0; phase < 6; phase++) assert.deepEqual(keeperRows(id, pose, phase, phase % 3 - 1).rows, still, `${id} ${pose} phase ${phase}`);
  }
});

type Art = ReturnType<typeof keeperArt>;
const segmentDistance = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const vx = b.x - a.x, vy = b.y - a.y, len = vx * vx + vy * vy, u = len ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
  return Math.hypot(p.x - a.x - vx * u, p.y - a.y - vy * u);
};
const rectDistance = (p: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number) => Math.hypot(p.x - Math.min(x1, Math.max(x0, p.x)), p.y - Math.min(y1, Math.max(y0, p.y)));

/** Does the drawn keeper overlap the drawn ball? Goal-art px, canvas y down. */
function renderedContact(id: KeeperId, art: Art, ball: { x: number; y: number; r: number }): string | null {
  if (art.wall && rectDistance(ball, art.wall.x0, art.wall.y0, art.wall.x1, art.wall.y1) <= ball.r) return "wall";
  // Into the body's canvas frame: drawKeeperFrame does translate(x, y) then rotate(rotate).
  const dx = ball.x - art.x, dy = ball.y - art.y, cos = Math.cos(art.rotate), sin = Math.sin(art.rotate);
  const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  for (const { hand } of art.arms) if (rectDistance(local, hand.x - art.glove / 2, hand.y - art.glove / 2, hand.x + art.glove / 2, hand.y + art.glove / 2) <= ball.r) return "glove";
  for (const { shoulder, hand } of art.arms) if (segmentDistance(local, shoulder, hand) <= ball.r + art.armWidth / 2) return "arm";
  // The body: the exact pixel rows drawn for this frame's pose (set / launch / stretch).
  const design = KEEPER_DESIGNS[id], s = design.scale, rows = art.rows;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    if (!design.palette[rows[r][c]]) continue;
    const x0 = -art.w / 2 + c * s, y0 = -art.h / 2 + r * s;
    if (rectDistance(local, x0, y0, x0 + s, y0 + s) <= ball.r) return "body";
  }
  if (art.leg && segmentDistance(ball, art.leg.hip, art.leg.foot) <= ball.r + art.leg.r) return "leg";
  return null;
}

test("render vs physics: 2,000 seeded kicks, the drawn keeper touches the drawn ball exactly when resolveShot saves", () => {
  const random = prng(0xb4b4);
  let kicks = 0, saves = 0, mismatches = 0;
  const parts: Record<string, number> = {}, poses: Record<string, number> = {};
  const failures: string[] = [];
  for (let k = 0; kicks < 2000; k++) {
    const keeper = KEEPERS[k % KEEPERS.length], difficulty = k % 3 === 0 ? NEUTRAL : DIFFICULTY_LADDER[k % DIFFICULTY_LADDER.length];
    const shot = { aimX: random() * 2 - 1, aimY: random() * 0.95, power: 0.35 + random() * 0.65, curl: random() * 2 - 1 };
    const history = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1].slice(0, k % 4);
    const outcome: ShotOutcome = resolveShot(shot, keeper, kickSeed(k, k % 5, keeper.id), { kickIndex: k % 5, history }, difficulty);
    if (outcome.result !== "goal" && outcome.result !== "save") continue;
    kicks++;
    // The crossing frame as the Stage plays it: flight 0.35–0.55 s after STRIKE_AT, keeper clock = engine time.
    const flight = penaltyFlight(outcome.target.time);
    assert.equal(keeperClock(outcome.target.time, flight, flight), outcome.target.time);
    const frame = penaltyKeeperFrame(keeper.id, outcome, flight, flight), art = keeperArt(frame), ball = penaltyBallArt(outcome.target, shot.curl, 1);
    poses[frame.pose] = (poses[frame.pose] ?? 0) + 1;
    const contact = renderedContact(keeper.id, art, ball), saved = outcome.result === "save";
    if (saved) saves++;
    if (contact) parts[contact] = (parts[contact] ?? 0) + 1;
    if (Boolean(contact) !== saved) { mismatches++; if (failures.length < 5) failures.push(`${keeper.id} kick ${k}: ${outcome.result} but drawn contact = ${contact}`); }
  }
  console.log(`keeper-sync: ${kicks} kicks, ${saves} saves, contacts ${JSON.stringify(parts)}, poses at the crossing ${JSON.stringify(poses)}, mismatches ${mismatches}`);
  assert.equal(mismatches, 0, failures.join("\n"));
  assert.ok(saves > 300 && saves < kicks - 300, `a real mix of saves (${saves}) and goals`);
  assert.ok((parts.leg ?? 0) > 0 && (parts.glove ?? 0) > 0 && (parts.body ?? 0) > 0, "legs, gloves and bodies all make saves");
  assert.ok((poses.set ?? 0) > 0 && (poses.launch ?? 0) > 0 && (poses.stretch ?? 0) > 0, "every body pose is on screen at some crossing");
});

test("keeper animation phase is a valid sprite frame (0–3) for any time, negative included", () => {
  for (const mood of ["idle", "set", "dive", "celebrate", "taunt", "sad"] as const)
    for (const time of [-5, -1.3, -0.01, 0, 0.37, 12.9]) {
      const { phase } = lookFor(mood, time);
      assert.ok(Number.isInteger(phase) && phase >= 0 && phase <= 3, `${mood} at t=${time}: phase ${phase}`);
    }
});
