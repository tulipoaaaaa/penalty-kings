import { test } from "node:test";
import assert from "node:assert/strict";
import { freeKickSetup } from "@penalty-kings/engine";
import { SPOT, penaltyY, GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { PENALTY_CAMERA, PENALTY_SETUP, FK_CAMERA, unprojectDepth, goalTransform, cornerFlags, pitchMarkingsWorld, fkBall } from "../../games/penalty-kings/gfx/setpieces.ts";
import { STRIKER, KICK_SPOT } from "../../games/penalty-kings/gfx/stage.ts";

test("penalty view: 6-yard line < spot < 18-yard line, at real distances", () => {
  const sixYard = penaltyY(5.5), spot = penaltyY(11), box = penaltyY(16.5);
  assert.ok(GOAL.line < sixYard && sixYard < spot && spot < box, `${GOAL.line} < ${sixYard} < ${spot} < ${box}`);
  assert.equal(SPOT.y, Math.round(spot), "SPOT is derived from the projection");
  // Perspective-mapped: the spot is 11/16.5 of the way from the goal line to the box edge in METRES.
  const d = unprojectDepth(PENALTY_SETUP, SPOT.y, PENALTY_CAMERA);
  assert.ok(Math.abs(d / 16.5 - 11 / 16.5) < 0.01, `spot at ${d.toFixed(2)} m`);
  assert.ok(Math.abs(unprojectDepth(PENALTY_SETUP, penaltyY(16.5), PENALTY_CAMERA) - 16.5) < 1e-6);
  // The goal art stays exactly where the keeper/net/frame are drawn.
  const xf = goalTransform(PENALTY_SETUP, PENALTY_CAMERA);
  assert.ok(Math.abs(xf.g - 1) < 0.002 && Math.abs(xf.y - GOAL.line) < 0.5, JSON.stringify(xf));
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
