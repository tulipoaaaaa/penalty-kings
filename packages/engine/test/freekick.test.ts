import { test } from "node:test";
import assert from "node:assert/strict";
import { freeKickSetup, resolveFreeKick, isKnuckle, keeperById, KEEPERS, type FreeKickShot } from "../src/index.ts";

const keeper = keeperById("squirrel");
const setup = freeKickSetup(3, { distance: 24, angle: 0.2, wallSize: 4 });
const shot = (o: Partial<FreeKickShot>): FreeKickShot => ({ aimX: 0, lift: 0.5, power: 0.6, spin: 0, top: 0, ...o });

test("setups stay in range: 18-32 m, wall of 3-5, wind only outdoors", () => {
  for (let seed = 0; seed < 300; seed++) {
    const s = freeKickSetup(seed, { maxWind: seed % 2 ? 6 : 0 });
    assert.ok(s.distance >= 18 && s.distance <= 32);
    assert.ok([3, 4, 5].includes(s.wallSize));
    if (seed % 2 === 0) assert.equal(s.wind, 0); else assert.ok(Math.abs(s.wind) <= 6);
  }
});

test("free kicks are deterministic, including the knuckleball wobble", () => {
  const knuckle = shot({ power: 0.9, lift: 0.45 });
  assert.ok(isKnuckle(knuckle));
  assert.deepEqual(resolveFreeKick(setup, knuckle, keeper), resolveFreeKick(setup, knuckle, keeper));
  const other = resolveFreeKick({ ...setup, seed: setup.seed + 1 }, knuckle, keeper);
  assert.notDeepEqual(resolveFreeKick(setup, knuckle, keeper).path, other.path, "the wobble is seeded per kick");
});

test("Magnus: sidespin bends the ball, topspin makes it dip, wind pushes it", () => {
  const plain = resolveFreeKick(setup, shot({}), keeper).path.at(-1)!;
  const right = resolveFreeKick(setup, shot({ spin: 0.8 }), keeper).path.at(-1)!;
  const left = resolveFreeKick(setup, shot({ spin: -0.8 }), keeper).path.at(-1)!;
  assert.ok(right.x > plain.x && left.x < plain.x);
  const noDip = resolveFreeKick(setup, shot({ lift: 0.9 }), keeper), dip = resolveFreeKick(setup, shot({ lift: 0.9, top: 1 }), keeper);
  assert.ok(dip.target.y < noDip.target.y, "topspin dips");
  const windy = resolveFreeKick({ ...setup, wind: 5 }, shot({ lift: 0.9 }), keeper);
  assert.ok(windy.target.x > noDip.target.x, "wind drifts");
});

test("the wall blocks a low straight shot at it; curling round or over it can score", () => {
  const w = resolveFreeKick(setup, shot({ lift: 0.3 }), keeper).wall;
  const atWall = resolveFreeKick(setup, shot({ aimX: w.side * 0.55, lift: 0.1, power: 0.6 }), keeper);
  assert.equal(atWall.result, "wall");
  let curled = false, dipped = false;
  for (let a = -1; a <= 1; a += 0.05) for (let l = 0.2; l <= 1; l += 0.05) {
    if (resolveFreeKick(setup, shot({ aimX: a, lift: l, spin: -w.side * 0.9, power: 0.55 }), keeper).result === "goal") curled = true;
    if (resolveFreeKick(setup, shot({ aimX: a, lift: l, top: 1, power: 0.8 }), keeper).result === "goal") dipped = true;
  }
  assert.ok(curled, "a curler around the wall scores");
  assert.ok(dipped, "a dipping shot over the wall scores");
});

test("a taller wall blocks more; heights stay in range", () => {
  let short = 0, tall = 0;
  for (let l = 0.3; l <= 0.9; l += 0.02) for (let a = -0.8; a <= 0.8; a += 0.1) {
    const shot = { aimX: a, lift: l, power: 0.6, spin: 0, top: 0 };
    if (resolveFreeKick({ ...setup, wallHeight: 1.6 }, shot, keeper).result === "wall") short++;
    if (resolveFreeKick({ ...setup, wallHeight: 1.95 }, shot, keeper).result === "wall") tall++;
  }
  assert.ok(tall > short, `tall ${tall} vs short ${short}`);
  assert.equal(freeKickSetup(1, { wallHeight: 3 }).wallHeight, 1.95);
});

test("the keeper starts on the side the wall does not cover", () => {
  for (const angle of [-0.3, 0.3]) {
    const s = freeKickSetup(9, { distance: 22, angle, wallSize: 4 });
    const o = resolveFreeKick(s, shot({ aimX: 0, lift: 0.95 }), keeper);
    assert.equal(o.wall.side, Math.sign(angle));
  }
});

test("every keeper can concede a free kick", () => {
  for (const k of KEEPERS) {
    let goal = false;
    for (let a = -0.95; a <= 0.95 && !goal; a += 0.1) for (let l = 0.3; l <= 1 && !goal; l += 0.1) for (const sp of [-0.9, 0.9]) {
      if (resolveFreeKick(setup, shot({ aimX: a, lift: l, spin: sp, top: 0.5, power: 0.6 }), k).result === "goal") { goal = true; break; }
    }
    assert.ok(goal, k.name);
  }
});
