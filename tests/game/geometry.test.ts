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

// ── Round 6 B5: the taker's run-up, strike and scale (gfx/kick.ts, drawn by Stage.drawFriendLayer) ──
import { GOAL_HALF_WIDTH, KEEPERS } from "@penalty-kings/engine";
import { fkProject } from "../../games/penalty-kings/gfx/setpieces.ts";
import { KEEPER_DESIGNS } from "../../games/penalty-kings/gfx/keepers.ts";
import { STRIKE_AT as STAGE_STRIKE_AT } from "../../games/penalty-kings/gfx/stage.ts";
import { PENALTY_VIEW, freeKickView, kickPose, plantSpot, runupStart, legFrame, STRIKE_AT, FRIEND_CELL, type KickView } from "../../games/penalty-kings/gfx/kick.ts";

const KICK_VIEWS: Array<[string, KickView]> = [["penalty", PENALTY_VIEW]];
for (const distance of [18, 24, 32]) for (const angle of [-0.35, 0, 0.2]) KICK_VIEWS.push([`free kick ${distance} m / ${angle}`, freeKickView(freeKickSetup(5, { distance, angle, wallSize: 4 }))]);
/** Ground (y = 0) under the ball, on screen. */
const ballGround = (view: KickView) => fkProject(view.setup, { x: Math.sin(view.setup.angle) * view.setup.distance, y: 0, z: 0 }, view.camera);

test("contact frame: the kick-leg overlay's foot is at the ball (≤ 3 px), in both views", () => {
  assert.equal(STAGE_STRIKE_AT, STRIKE_AT);
  for (const [name, view] of KICK_VIEWS) {
    const pose = kickPose(view, STRIKE_AT);
    assert.equal(pose.leg?.frame, "contact", `${name}: contact frame at the strike`);
    const d = Math.hypot(pose.leg!.foot.x - view.ball.x, pose.leg!.foot.y - view.ball.y);
    assert.ok(d <= 3, `${name}: foot ${d.toFixed(2)} px from the ball`);
    // The leg swings through pixel frames around the strike, and a contact flash starts at it.
    assert.deepEqual([STRIKE_AT - 0.1, STRIKE_AT - 0.04, STRIKE_AT, STRIKE_AT + 0.1].map(legFrame), ["back", "swing", "contact", "through"]);
    assert.ok(pose.flash > 0.9 && kickPose(view, STRIKE_AT - 0.01).flash === 0);
  }
});

test("the Friend runs in on a slight angle and plants BESIDE the ball (non-kicking side), never over it", () => {
  for (const [name, view] of KICK_VIEWS) {
    const ground = ballGround(view), plant = plantSpot(view), start = runupStart(view);
    // Beside: same depth band as the ball (≤ 0.5 m behind, never past it), sprite + halo left of the ball.
    assert.ok(plant.forward <= 0 && plant.forward >= -0.5, `${name}: plants ${plant.forward} m from the ball's line`);
    assert.ok(plant.x + 9 * plant.scale <= view.ball.x - view.ball.r + 0.5, `${name}: sprite clears the ball on the left`);
    // A slight angle: from behind-left, mostly straight (< 40° off the ball's line).
    const angle = Math.atan2(plant.right - start.right, plant.forward - start.forward);
    assert.ok(angle > 0 && angle < (40 * Math.PI) / 180, `${name}: run-up angle ${(angle * 57.3).toFixed(0)}°`);
    // Every frame of the kick: feet never beyond the ball's ground line (no "jumping over" it), start on screen.
    for (let t = 0; t <= 1.2; t += 1 / 60) {
      const pose = kickPose(view, t);
      assert.ok(pose.y >= ground.y - 0.5, `${name}: t ${t.toFixed(2)} feet at y ${pose.y.toFixed(1)} vs ball ground ${ground.y.toFixed(1)}`);
      assert.ok(pose.y <= 312 && pose.y - FRIEND_CELL * pose.scale >= 0, `${name}: in frame at t ${t.toFixed(2)}`);
    }
    assert.ok(kickPose(view, STRIKE_AT - 0.12).x === plant.x, `${name}: planted before the leg swings`);
  }
});

test("the Friend's scale is perspective-consistent with the keepers (1.2 × a keeper's height at the same depth, ±20%)", () => {
  for (const [name, view] of KICK_VIEWS) {
    // Keepers are drawn in the goal group: art height × goalTransform(setup, camera).g at the goal line.
    const xf = goalTransform(view.setup, view.camera);
    const goalPxPerM = fkProject(view.setup, { x: 0, y: 0, z: Math.cos(view.setup.angle) * view.setup.distance }, view.camera).pxPerM;
    assert.ok(Math.abs(xf.g - (goalPxPerM * GOAL_HALF_WIDTH) / GOAL.unit) < 1e-9, `${name}: goal group scale = camera px/m at the goal`);
    for (const t of [0, 0.15, STRIKE_AT, 2]) {
      const pose = kickPose(view, t), friend = FRIEND_CELL * pose.scale;
      for (const keeper of KEEPERS) {
        const d = KEEPER_DESIGNS[keeper.id], keeperAtGoal = d.rows.length * d.scale * xf.g, keeperHere = keeperAtGoal * (pose.pxPerM / goalPxPerM);
        const ratio = friend / (1.2 * keeperHere);
        assert.ok(ratio >= 0.8 && ratio <= 1.2, `${name} t ${t}: Friend ${friend.toFixed(1)} px vs 1.2 × ${keeper.id} ${keeperHere.toFixed(1)} px (×${ratio.toFixed(2)})`);
      }
    }
  }
});
