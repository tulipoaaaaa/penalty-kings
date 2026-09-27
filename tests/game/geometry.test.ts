import { test } from "node:test";
import assert from "node:assert/strict";
import { freeKickSetup } from "@penalty-kings/engine";
import { SPOT, penaltyY, GOAL, PENALTY_GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { PENALTY_CAMERA, PENALTY_SETUP, FK_CAMERA, unprojectDepth, goalTransform, cornerFlags, pitchMarkingsWorld, fkBall } from "../../games/penalty-kings/gfx/setpieces.ts";
import { STRIKER, KICK_SPOT } from "../../games/penalty-kings/gfx/stage.ts";

test("penalty view: 6-yard line < spot < 18-yard line, at real distances", () => {
  const line = penaltyY(0), sixYard = penaltyY(5.5), spot = penaltyY(11), box = penaltyY(16.5);
  assert.ok(line < sixYard && sixYard < spot && spot < box, `${line} < ${sixYard} < ${spot} < ${box}`);
  // Round 6 B1: a TV-style penalty. Spot deep in the frame, box line above the SDK badges, goal unit 65–70 px.
  assert.ok(SPOT.y >= 248 && SPOT.y <= 260, `spot at y ${SPOT.y}`);
  assert.ok(box <= 300, `18-yard line at y ${box.toFixed(1)} (visible)`);
  assert.equal(SPOT.y, Math.round(spot), "SPOT is derived from the projection");
  // Perspective-mapped: the spot is 11/16.5 of the way from the goal line to the box edge in METRES.
  const d = unprojectDepth(PENALTY_SETUP, SPOT.y, PENALTY_CAMERA);
  assert.ok(Math.abs(d / 16.5 - 11 / 16.5) < 0.01, `spot at ${d.toFixed(2)} m`);
  assert.ok(Math.abs(unprojectDepth(PENALTY_SETUP, penaltyY(16.5), PENALTY_CAMERA) - 16.5) < 1e-6);
  // The goal art (keeper, net, frame) is placed by the camera: 65–70 px per half-goal, on the goal line.
  const xf = goalTransform(PENALTY_SETUP, PENALTY_CAMERA), unit = xf.g * GOAL.unit;
  assert.ok(unit >= 65 && unit <= 70, `goal unit ${unit.toFixed(1)} px`);
  assert.ok(Math.abs(xf.y - line) < 0.5 && Math.abs(xf.g - PENALTY_GOAL.g) < 1e-9 && Math.abs(xf.y - PENALTY_GOAL.y) < 1e-9, JSON.stringify(xf));
});

test("the run-up starts at or inside the 18-yard line and the kick is taken at the spot", () => {
  const start = unprojectDepth(PENALTY_SETUP, STRIKER.y, PENALTY_CAMERA);
  assert.ok(start <= 16.5 && start > 11, `run-up from ${start.toFixed(2)} m`);
  const kick = unprojectDepth(PENALTY_SETUP, KICK_SPOT.y, PENALTY_CAMERA);
  assert.ok(kick > 11 && kick < 12.5, `kick taken ${kick.toFixed(2)} m out (just behind the ball)`);
});

test("the D is centred on the spot, 9.15 m, entirely beyond the box line", () => {
  for (const setup of [PENALTY_SETUP, freeKickSetup(3, { distance: 24, angle: 0.2 })]) {
    const m = pitchMarkingsWorld(setup);
    assert.ok(Math.abs(m.goalLine.z - m.spot.z - 11) < 1e-9);
    assert.ok(m.dArc.length > 3);
    for (const p of m.dArc) {
      assert.ok(Math.abs(Math.hypot(p.x - m.spot.x, p.z - m.spot.z) - 9.15) < 1e-9, "D radius 9.15 m from the spot");
      assert.ok(p.z < m.box.z, "D lies beyond the 18-yard line");
    }
  }
});

test("props only at real positions: corner flags at goal line × touchline, and only when in view", () => {
  const m = pitchMarkingsWorld(PENALTY_SETUP);
  assert.deepEqual(m.corners.map(c => [Math.abs(c.x), c.z]), [[34, 11], [34, 11]]);
  assert.equal(cornerFlags(PENALTY_SETUP, PENALTY_CAMERA).length, 0, "penalty camera: both corners off-screen, no flags");
  for (const distance of [18, 22, 25, 28, 32]) for (const angle of [-0.4, 0, 0.4]) {
    assert.equal(cornerFlags(freeKickSetup(1, { distance, angle }), FK_CAMERA).length, 0, `free kick ${distance} m / ${angle}: no flags in view`);
  }
});

test("free kicks are taken outside the box; their ball is on screen", () => {
  for (const distance of [18, 25, 32]) {
    const setup = freeKickSetup(1, { distance, angle: 0 });
    assert.ok(setup.distance > 16.5, "outside the penalty area");
    const ball = fkBall(setup);
    assert.ok(ball.y > 200 && ball.y < 320 && Math.abs(ball.x - 240) < 1);
  }
});

test("the free-kick wall is drawn at its real height (±6%) for every wall height and distance", async () => {
  const { fkProject, wallDrawScale } = await import("../../games/penalty-kings/gfx/setpieces.ts");
  const { freeKickSetup, WALL_DISTANCE, WALL_HEIGHTS } = await import("@penalty-kings/engine");
  for (const wallHeight of Object.values(WALL_HEIGHTS)) for (const distance of [18, 20, 22, 25, 28, 32]) for (const angle of [-0.3, 0, 0.3]) {
    const setup = freeKickSetup(11, { distance, angle, wallSize: 4, wallHeight });
    const z = Math.cos(setup.angle) * setup.distance * (WALL_DISTANCE / setup.distance);
    const target = fkProject(setup, { x: 0, y: 0, z }).y - fkProject(setup, { x: 0, y: wallHeight, z }).y;
    const drawn = wallDrawScale(target).height;
    assert.ok(Math.abs(drawn / target - 1) <= 0.06, `${wallHeight} m at ${distance} m: drawn ${drawn}px vs ${target.toFixed(1)}px`);
  }
});
