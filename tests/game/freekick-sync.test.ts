import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, DIFFICULTY_LADDER, NEUTRAL, WALL_HEIGHTS, resolveFreeKick, freeKickSetup, solveLift, prng, type KeeperId, type FreeKickOutcome, type FreeKickSetup } from "@penalty-kings/engine";
import { KEEPER_DESIGNS, keeperArt } from "../../games/penalty-kings/gfx/keepers.ts";
import { GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { goalTransform } from "../../games/penalty-kings/gfx/setpieces.ts";
import { freeKickBall, freeKickShot, freeKickFlight, keeperClock, penaltyKeeperFrame } from "../../games/penalty-kings/gfx/stage.ts";

// Round 6 B4b: a free kick is saved ONLY when the rendered keeper touches the rendered ball at the crossing
// frame, exactly like penalties (tests/game/keeper-sync.test.ts). This test rebuilds what the Stage DRAWS at
// that frame: the keeper (sprite pixels, arms, gloves, trailing leg) inside the goal group placed with
// goalTransform(setup), and the ball the Stage draws on screen from the engine path (freeKickBall), mapped
// back into goal-art px. It compares that contact with resolveFreeKick over 1,000 seeded kicks.

type Art = ReturnType<typeof keeperArt>;
type P = { x: number; y: number };
const segmentDistance = (p: P, a: P, b: P) => {
  const vx = b.x - a.x, vy = b.y - a.y, len = vx * vx + vy * vy, u = len ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
  return Math.hypot(p.x - a.x - vx * u, p.y - a.y - vy * u);
};
const rectDistance = (p: P, x0: number, y0: number, x1: number, y1: number) => Math.hypot(p.x - Math.min(x1, Math.max(x0, p.x)), p.y - Math.min(y1, Math.max(y0, p.y)));

/** Does the drawn keeper overlap the drawn ball? Goal-art px, canvas y down. */
function renderedContact(id: KeeperId, art: Art, ball: P & { r: number }): string | null {
  if (art.wall && rectDistance(ball, art.wall.x0, art.wall.y0, art.wall.x1, art.wall.y1) <= ball.r) return "wall";
  const dx = ball.x - art.x, dy = ball.y - art.y, cos = Math.cos(art.rotate), sin = Math.sin(art.rotate);
  const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  for (const { hand } of art.arms) if (rectDistance(local, hand.x - art.glove / 2, hand.y - art.glove / 2, hand.x + art.glove / 2, hand.y + art.glove / 2) <= ball.r) return "glove";
  for (const { shoulder, hand } of art.arms) if (segmentDistance(local, shoulder, hand) <= ball.r + art.armWidth / 2) return "arm";
  const design = KEEPER_DESIGNS[id], s = design.scale;
  for (let r = 0; r < design.rows.length; r++) for (let c = 0; c < design.rows[r].length; c++) {
    if (!design.palette[design.rows[r][c]]) continue;
    const x0 = -art.w / 2 + c * s, y0 = -art.h / 2 + r * s;
    if (rectDistance(local, x0, y0, x0 + s, y0 + s) <= ball.r) return "body";
  }
  if (art.leg && segmentDistance(ball, art.leg.hip, art.leg.foot) <= ball.r + art.leg.r) return "leg";
  return null;
}

/** The ball the Stage draws at the crossing (screen px), back in goal-art px through the goal group's transform. */
function drawnBallInGoalArt(setup: FreeKickSetup, outcome: FreeKickOutcome) {
  const flight = freeKickFlight(outcome), screen = freeKickBall(setup, outcome, flight), xf = goalTransform(setup);
  return { x: GOAL.cx + (screen.x - xf.x) / xf.g, y: GOAL.line + (screen.y - xf.y) / xf.g, r: screen.r / xf.g };
}

test("free kicks, render vs physics: 1,000 seeded kicks, the drawn keeper touches the drawn ball exactly when resolveFreeKick saves", () => {
  const random = prng(0xf4b4);
  let kicks = 0, saves = 0, mismatches = 0;
  const parts: Record<string, number> = {}, distances = new Set<number>(), failures: string[] = [];
  for (let k = 0; kicks < 1000 && k < 20000; k++) {
    const keeper = KEEPERS[k % KEEPERS.length], difficulty = k % 3 === 0 ? NEUTRAL : DIFFICULTY_LADDER[k % DIFFICULTY_LADDER.length];
    const distance = 18 + (k % 15), angle = (random() - 0.5) * 1;
    const setup = freeKickSetup(0xf00 + k, { distance, angle, maxWind: 3, wallHeight: [WALL_HEIGHTS.park, WALL_HEIGHTS.pro, WALL_HEIGHTS.champions][k % 3] });
    const aimX = random() * 1.9 - 0.95, aimY = 0.05 + random() * 0.9, power = 0.4 + random() * 0.6, top = random() * 0.6;
    const shot = { aimX, lift: solveLift(setup, { aimX, aimY, power, top }), power, spin: k % 2 ? random() * 1.6 - 0.8 : 0, top };
    const outcome = resolveFreeKick(setup, shot, keeper, difficulty);
    if (outcome.result !== "goal" && outcome.result !== "save") continue;
    kicks++; distances.add(setup.distance);
    // The crossing frame as the Stage plays it: keeper clock = engine time at the end of the flight.
    const flight = freeKickFlight(outcome), played = freeKickShot(outcome);
    assert.equal(keeperClock(outcome.target.time, flight, flight), outcome.target.time);
    const art = keeperArt(penaltyKeeperFrame(keeper.id, played, flight, flight)), ball = drawnBallInGoalArt(setup, outcome);
    const contact = renderedContact(keeper.id, art, ball), saved = outcome.result === "save";
    if (saved) saves++;
    if (contact) parts[contact] = (parts[contact] ?? 0) + 1;
    if (Boolean(contact) !== saved) { mismatches++; if (failures.length < 5) failures.push(`${keeper.id} kick ${k} (${setup.distance} m): ${outcome.result} but drawn contact = ${contact}`); }
  }
  console.log(`freekick-sync: ${kicks} kicks, ${saves} saves, contacts ${JSON.stringify(parts)}, mismatches ${mismatches}`);
  assert.equal(kicks, 1000, "enough on-target kicks");
  assert.equal(mismatches, 0, failures.join("\n"));
  assert.ok(saves > 150 && saves < kicks - 150, `a real mix of saves (${saves}) and goals`);
  assert.equal(distances.size, 15, "every distance 18–32 m");
  assert.ok((parts.glove ?? 0) > 0 && (parts.body ?? 0) > 0, "gloves and bodies both make saves");
});

test("free kicks: the keeper stands where the Stage shows him (off-centre, away from the wall) before the dive", () => {
  const setup = freeKickSetup(7, { distance: 24, angle: 0.3, wallSize: 4 });
  const outcome = resolveFreeKick(setup, { aimX: 0.5, lift: 0.5, power: 0.6, spin: 0, top: 0 }, KEEPERS[0]);
  const standing = penaltyKeeperFrame(KEEPERS[0].id, freeKickShot(outcome), freeKickFlight(outcome), 0);
  assert.equal(standing.progress, 0);
  assert.equal(standing.x, -outcome.wall.side * 0.3);
});
