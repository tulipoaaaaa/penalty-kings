// Bug Quest P2 (engine / difficulty): one test per item, each failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, resolveShot, kickSeed, prng, aimWobble, assistShot, keeperPlan, shotTarget, DIFFICULTY_LADDER, swipeToShot, releasePoint, OVERHIT, MIN_SWIPE_MS, freeKickSetup, resolveFreeKick, freeKickWall, FK_BALL_RADIUS, JUMP_HEIGHT, JUMP_TIME } from "../src/index.ts";

const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());

/** Goal rate of a mixed-skill player (the difficulty-sim bots, compressed) against one keeper at one rung. */
function goalRate(keeperIndex: number, rung: number, shots: number) {
  const keeper = KEEPERS[keeperIndex], difficulty = DIFFICULTY_LADDER[rung], random = prng(0xbeef + keeperIndex);
  const bots = [{ aim: 0.34, power: 0.2, timing: 0.1, ambition: 0.2 }, { aim: 0.24, power: 0.14, timing: 0.4, ambition: 0.4 }, { aim: 0.15, power: 0.09, timing: 0.7, ambition: 0.6 }, { aim: 0.07, power: 0.045, timing: 0.9, ambition: 0.85 }];
  let goals = 0;
  for (let k = 0; k < shots; k++) {
    const bot = bots[k % bots.length];
    const side = random() < 0.5 ? -1 : 1, high = random() < bot.ambition * 0.6;
    const tx = side * (random() < bot.ambition ? 0.8 : 0.5), ty = high ? 0.78 : 0.3;
    const shot = { aimX: tx + gauss(random) * bot.aim + aimWobble(random() * 10, difficulty.wobble) * (1 - bot.timing), aimY: ty + gauss(random) * bot.power * 1.25, power: Math.min(1, Math.max(0, 0.62 + gauss(random) * bot.power)), curl: 0 };
    if (resolveShot(assistShot(shot, difficulty.assist), keeper, kickSeed(7, k, keeper.id), { kickIndex: k % 5, history: [] }, difficulty).result === "goal") goals++;
  }
  return goals / shots;
}

test("BQ-P2-1: every keeper gets harder up the ladder (L3 → L8 never easier within noise, L8 clearly harder), mime and ghost included", () => {
  KEEPERS.forEach((keeper, i) => {
    const rates = [3, 4, 5, 6, 7, 8].map(rung => goalRate(i, rung, 4000));
    for (let r = 1; r < rates.length; r++) assert.ok(rates[r] <= rates[r - 1] + 0.02, `${keeper.id}: L${r + 3} ${(rates[r] * 100).toFixed(1)}% vs L${r + 2} ${(rates[r - 1] * 100).toFixed(1)}%`);
    assert.ok(rates[5] <= rates[0] - 0.05, `${keeper.id}: L8 ${(rates[5] * 100).toFixed(1)}% is not clearly under L3 ${(rates[0] * 100).toFixed(1)}%`);
  });
});

test("BQ-P2-3: after the read, the squirrel's and disco's lean and the robot's scan point the way the final dive goes", () => {
  const random = prng(33);
  let reversed = 0; // reads that sent the keeper against his base plan's side: the case under test
  for (const id of ["squirrel", "disco", "robot"] as const) {
    const keeper = KEEPERS.find(k => k.id === id)!;
    for (let k = 0; k < 4000; k++) {
      const shot = { aimX: (random() * 2 - 1) * 0.95, aimY: random() * 0.9, power: 0.4 + random() * 0.5, curl: 0 };
      const context = { kickIndex: k % 5, history: id === "robot" ? [random() < 0.5 ? -0.7 : 0.7, random() < 0.5 ? -0.6 : 0.6, 0.5] : [] };
      const seed = kickSeed(5, k, id), plan = resolveShot(shot, keeper, seed, context, DIFFICULTY_LADDER[8]).plan;
      if (Math.sign(keeperPlan(keeper, seed, shotTarget(shot), context).x) !== Math.sign(plan.x)) reversed++;
      if (id === "robot") assert.ok(plan.scan === 0 || plan.scan === Math.sign(plan.x), `robot scan ${plan.scan} vs dive x ${plan.x}`);
      else assert.equal(Math.sign(plan.lean), Math.sign(plan.x), `${id} lean ${plan.lean} vs dive x ${plan.x}`);
    }
  }
  assert.ok(reversed > 500, `only ${reversed} reversing reads`);
});

test("BQ-P2-4: swipes with NaN/Infinity are rejected; a near-zero or backwards duration is never an overhit", () => {
  const swipe = (dy: number, ms: number) => Array.from({ length: 8 }, (_, i) => ({ x: 240 + i * 2, y: 250 - (dy * i) / 7, t: 1000 + (ms * i) / 7 }));
  const opts = { width: 480, height: 320 };
  assert.ok(swipeToShot(swipe(200, 150), opts)); // a normal flick still kicks
  for (const key of ["x", "y", "t"] as const) for (const bad of [NaN, Infinity, -Infinity]) {
    for (const at of [0, 3, 7]) {
      const points = swipe(200, 150); points[at] = { ...points[at], [key]: bad };
      assert.equal(swipeToShot(points, opts), null, `${key}=${bad} at sample ${at}`);
    }
  }
  assert.equal(swipeToShot(swipe(200, 150), { ...opts, pxPerUnit: NaN }), null);
  const mixed = swipe(200, 150); mixed[4] = { ...mixed[4], x: NaN };
  const release = releasePoint(mixed);
  assert.ok(Number.isFinite(release.x) && Number.isFinite(release.y), "releasePoint ignores the NaN sample");
  for (const input of ["touch", "mouse", "trackpad"] as const) for (const ms of [0, 5, 20, -40]) {
    const shot = swipeToShot(swipe(260, ms), { ...opts, input })!;
    assert.ok(shot && shot.power <= OVERHIT, `${input} ${ms} ms: power ${shot?.power}`);
    assert.ok(shotTarget(shot).y <= shot.aimY + 1e-9, `${input} ${ms} ms: an overhit's rise`);
  }
  // A genuinely fast (≥ MIN_SWIPE_MS) huge flick can still overhit: the cap is only for untrustworthy timing.
  assert.ok(swipeToShot(swipe(400, MIN_SWIPE_MS + 10), opts)!.power > OVERHIT);
});

test("BQ-P2-8: the engine flags which woodwork a shot touched (hitPost / hitBar), deterministically", () => {
  const random = prng(0xba5), keeper = KEEPERS.find(k => k.id === "sloth")!;
  const seen = { post: 0, bar: 0, both: 0, barIn: 0, postIn: 0 };
  for (let k = 0; k < 20000; k++) {
    // Around the frame: near the posts and the bar, inside and outside.
    const shot = { aimX: (random() < 0.5 ? -1 : 1) * (0.85 + random() * 0.25), aimY: random() < 0.5 ? random() * 1.1 : 0.85 + random() * 0.25, power: 0.3 + random() * 0.6, curl: 0 };
    const o = resolveShot(shot, keeper, kickSeed(9, k, keeper.id));
    assert.deepEqual(resolveShot(shot, keeper, kickSeed(9, k, keeper.id)), o);
    const framed = o.result === "post" || o.postIn;
    assert.equal(Boolean(o.hitPost || o.hitBar), framed, `k ${k}: ${o.result} postIn ${o.postIn} flags ${o.hitPost}/${o.hitBar}`);
    if (!framed) continue;
    const ax = Math.abs(o.target.x);
    assert.equal(Boolean(o.hitBar), Math.abs(o.target.y - 1) < 0.07 && ax < 1.045, `k ${k}: bar flag at ${o.target.x.toFixed(3)}, ${o.target.y.toFixed(3)}`);
    assert.equal(Boolean(o.hitPost), Math.abs(ax - 1) < 0.07 && o.target.y < 1.045, `k ${k}: post flag at ${o.target.x.toFixed(3)}, ${o.target.y.toFixed(3)}`);
    if (o.hitPost && o.hitBar) seen.both++; else if (o.hitBar) seen.bar++; else seen.post++;
    if (o.postIn) { if (o.hitBar) seen.barIn++; else seen.postIn++; }
  }
  for (const [kind, n] of Object.entries(seen)) assert.ok(n > 20, `${kind}: ${n}`);
  // Outside the end of the bar, high up: the POST, not the bar (a label reading "y > 0.93 → bar" got this wrong).
  const outside = resolveShot({ aimX: 1.05, aimY: 0.95, power: 0.6, curl: 0 }, keeper, 1);
  assert.equal(outside.result, "post"); assert.equal(outside.hitPost, true); assert.equal(outside.hitBar, false);
  // Free kicks flag their woodwork too.
  let fkPosts = 0;
  for (let k = 0; k < 3000 && fkPosts < 20; k++) {
    const setup = { ...freeKickSetup(0xa00 + k, { distance: 20 + (k % 10), angle: 0 }), wallHeight: 0.02 };
    const fk = resolveFreeKick(setup, { aimX: (k % 2 ? 1 : -1) * (0.9 + (k % 13) * 0.015), lift: 0.05 + (k % 17) * 0.02, power: 0.5, spin: 0, top: 0.3 }, keeper);
    if (fk.result !== "post") { assert.ok(!fk.hitPost && !fk.hitBar); continue; }
    fkPosts++; assert.ok(fk.hitPost || fk.hitBar);
  }
  assert.ok(fkPosts > 0, "free-kick woodwork found");
});

test("BQ-P2-5: a free kick only gets past the wall when the whole BALL clears it (end, heads, boots), not just its centre", () => {
  const random = prng(0x5a11);
  let passed = 0;
  for (let k = 0; k < 4000; k++) {
    const setup = freeKickSetup(0x900 + k, { distance: 18 + (k % 15), angle: (random() - 0.5) * 0.9, maxWind: 3, wallHeight: [1.65, 1.8, 1.9][k % 3] });
    const shot = { aimX: random() * 2 - 1, lift: random() * 0.6, power: random(), spin: random() * 1.6 - 0.8, top: random() * 0.8 };
    const outcome = resolveFreeKick(setup, shot, KEEPERS[k % KEEPERS.length]);
    if (outcome.result === "wall") continue;
    const wall = freeKickWall(setup), path = outcome.path;
    const i = path.findIndex(p => p.z >= wall.z);
    if (i < 1) continue;
    const a = path[i - 1], b = path[i], u = (wall.z - a.z) / (b.z - a.z || 1);
    const cx = a.x + (b.x - a.x) * u, cy = a.y + (b.y - a.y) * u, t = a.t + (b.t - a.t) * u;
    const jump = t >= setup.wallJumpAt ? Math.sin(Math.min(1, (t - setup.wallJumpAt) / JUMP_TIME) * Math.PI) * JUMP_HEIGHT : 0;
    const tol = 0.02; // the 30 Hz path is interpolated here; the engine tests every 240 Hz step
    const beside = Math.abs(cx - wall.x) >= wall.halfWidth + FK_BALL_RADIUS - tol, over = cy - FK_BALL_RADIUS >= setup.wallHeight + jump - tol;
    const under = jump > 0.12 && cy + FK_BALL_RADIUS <= jump + tol;
    passed++;
    assert.ok(beside || over || under, `kick ${k}: ${outcome.result} but the ball met the wall (centre ${cx.toFixed(2)}, ${cy.toFixed(2)} m; wall ${wall.x.toFixed(2)} ± ${wall.halfWidth.toFixed(2)}, top ${(setup.wallHeight + jump).toFixed(2)} m)`);
  }
  assert.ok(passed > 1000, `${passed} kicks past the wall`);
});
