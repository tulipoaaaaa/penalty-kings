import { test } from "node:test";
import assert from "node:assert/strict";
import { freeKickSetup, resolveFreeKick, isKnuckle, keeperById, KEEPERS, DIFFICULTY_LADDER, WALL_HEIGHTS, prng, solveLift, freeKickSpeed, freeKickWall, freeKickKeeperFrame, toWorld, FK_KEEPER_SPEED_CAP, FK_KEEPER_STYLE, FK_AIR_MIN, FK_AIR_MAX, SCREAMER_DISTANCE, SCREAMER_BONUS, type FreeKickShot } from "../src/index.ts";

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

// ── Owner playtest C1: pace, reachability, the free-kick keeper ─────────────────────────
const NONE = { id: "mouse", name: "none", bio: "", tell: "", mult: 1, reaction: 9, diveTime: 1, reach: 0, body: 0, maxY: 0, read: 0 } as const;

test("C1a: launch speed 24–36 m/s, rising with power AND distance", () => {
  for (let d = 18; d <= 32; d++) for (let p = 0; p <= 1; p += 0.1) {
    const v = freeKickSpeed(p, d);
    assert.ok(v >= 24 && v <= 36, `${d} m power ${p.toFixed(1)}: ${v}`);
    assert.ok(freeKickSpeed(p + 0.1, d) >= v && freeKickSpeed(p, d + 1) >= v);
  }
  assert.equal(freeKickSpeed(0, 18), 24);
  assert.equal(freeKickSpeed(1, 32), 36);
});

test("C1a: flight time strike → goal line: 0.7–1.2 s from 18–24 m (0.75–1.1 s at a natural pace), 1.0–1.4 s from 30–32 m", () => {
  const rows: string[] = [];
  for (const d of [18, 20, 22, 24, 30, 31, 32]) {
    const s = { ...freeKickSetup(7, { distance: d, angle: 0.1 }), wallHeight: 0.02 };
    const times = [0, 0.25, 0.4, 0.6, 0.75, 1].map(power => {
      const aimX = 0.5, top = 0.3;
      return resolveFreeKick(s, { aimX, lift: solveLift(s, { aimX, aimY: 0.7, power, top }), power, spin: 0, top }, NONE).target.time;
    });
    rows.push(`${d} m: ${times.map(t => t.toFixed(2)).join(" ")}`);
    const [lo, hi] = d <= 24 ? [0.7, 1.2] : [1.0, 1.4];
    for (const t of times) assert.ok(t >= lo && t <= hi, `${d} m: ${t.toFixed(2)} s outside ${lo}–${hi}`);
    if (d <= 24) for (const t of times.slice(2, 5)) assert.ok(t >= 0.75 && t <= 1.1, `${d} m natural pace: ${t.toFixed(2)} s`);
  }
  console.log("flight times (power 0 / .25 / .4 / .6 / .75 / 1):\n  " + rows.join("\n  "));
});

test("C1b: reachability — at every distance and pace a natural swipe (topspin 0.4) has a scoring band OVER the wall", () => {
  // The swipe's height is the crossing height (solveLift): the band of heights that clear a pro wall of 5 and dip under the bar.
  const table: string[] = [];
  for (let d = 18; d <= 32; d++) {
    const cells: string[] = [];
    for (const power of [0, 0.25, 0.5, 0.75, 1]) {
      const s = { ...freeKickSetup(11, { distance: d, angle: 0.25, wallSize: 5, wallHeight: WALL_HEIGHTS.pro }), wallJumpAt: 0.2 };
      const aimX = 0.7 * Math.sign(s.angle), top = 0.4;
      const w = freeKickWall(s), x0 = Math.sin(s.angle) * d, through = x0 + (aimX * 3.66 - x0) * (9.15 / d);
      assert.ok(Math.abs(through - w.x) < w.halfWidth, `${d} m: the aim is through the wall's shadow`);
      let lo = -1, hi = -1;
      for (let y = 0; y <= 1.0001; y += 0.02) {
        const o = resolveFreeKick(s, { aimX, lift: solveLift(s, { aimX, aimY: y, power, top }), power, spin: 0, top }, NONE);
        if (o.result === "goal") { if (lo < 0) lo = y; hi = y; }
      }
      cells.push(lo < 0 ? "none" : `${lo.toFixed(2)}–${hi.toFixed(2)}`);
      assert.ok(lo >= 0, `${d} m power ${power}: no scoring height over the wall`);
      // Comfortable: a soft-to-natural swipe has a band ≥ 0.2 goal units (≈0.5 m) from every distance.
      if (power <= 0.5) assert.ok(hi - lo >= 0.2 - 1e-9, `${d} m power ${power}: band ${lo.toFixed(2)}–${hi.toFixed(2)} too narrow`);
    }
    table.push(`${String(d).padStart(2)} m  ${cells.map(c => c.padEnd(10)).join(" ")}`);
  }
  console.log("scoring crossing heights over a pro wall of 5 (power 0 / .25 / .5 / .75 / 1):\n  " + table.join("\n  "));
});

test("C1b: topspin is a long-range tool — it dips a 30 m ball more than an 18 m ball", () => {
  const drop = (d: number) => {
    const s = { ...freeKickSetup(3, { distance: d, angle: 0 }), wallHeight: 0.02 };
    const hit = (top: number) => resolveFreeKick(s, { aimX: 0.3, lift: 0.6, power: 0.6, spin: 0, top }, NONE).target.y;
    return hit(0) - hit(1);
  };
  assert.ok(drop(30) > drop(18) && drop(30) > 0.8, `dip 18 m ${drop(18).toFixed(2)}, 30 m ${drop(30).toFixed(2)} goal units`);
});

test("C1b: the knuckleball's lift is solved without its wobble (the seed only moves the strike, which the preview shares)", () => {
  const s = freeKickSetup(21, { distance: 28, angle: 0 });
  assert.equal(solveLift(s, { aimX: 0.2, aimY: 0.6, power: 0.9, top: 0 }), solveLift({ ...s, seed: 999 }, { aimX: 0.2, aimY: 0.6, power: 0.9, top: 0 }));
});

test("C1c: the free-kick keeper never moves his body sideways faster than 6 m/s — every keeper, difficulty and frame", () => {
  const random = prng(0xc1c);
  let fastest = 0, dives = 0;
  for (let k = 0; k < 600; k++) {
    const keeper = KEEPERS[k % KEEPERS.length], difficulty = DIFFICULTY_LADDER[k % DIFFICULTY_LADDER.length];
    const s = freeKickSetup(0x900 + k, { maxWind: 3 });
    const aimX = random() * 2.2 - 1.1, power = random(), top = random();
    const o = resolveFreeKick(s, { aimX, lift: solveLift(s, { aimX, aimY: random() * 1.1, power, top }), power, spin: random() * 2 - 1, top }, keeper, difficulty);
    const m = o.keeperMotion;
    if (m.dives) { dives++; assert.ok(m.plan.diveTime >= FK_AIR_MIN - 1e-9 && m.plan.diveTime <= FK_AIR_MAX + 1e-9, `airtime ${m.plan.diveTime}`); }
    let prev = freeKickKeeperFrame(keeper.id, m, -0.6).x;
    for (let t = -0.6 + 1 / 480; t <= o.target.time + 0.4; t += 1 / 480) {
      const x = freeKickKeeperFrame(keeper.id, m, t).x, speed = Math.abs(x - prev) * 3.66 * 480;
      fastest = Math.max(fastest, speed); prev = x;
      assert.ok(speed <= Math.min(FK_KEEPER_SPEED_CAP, FK_KEEPER_STYLE[keeper.id].speed) * 1.01, `${keeper.id} ${speed.toFixed(2)} m/s at t = ${t.toFixed(3)}`);
    }
  }
  console.log(`fastest keeper frame: ${fastest.toFixed(2)} m/s over ${dives} dives`);
  assert.ok(fastest > 5, "the dive is still explosive");
});

test("C1c: one dive reaches ≈2.2–3 m from take-off at full stretch (gloves), never more", () => {
  const reaches: string[] = [];
  for (const k of KEEPERS) {
    const s = freeKickSetup(5, { distance: 30, angle: 0.3, wallSize: 4 });
    // A low ball far across the goal: he dives at full stretch.
    const o = resolveFreeKick(s, { aimX: 0.98, lift: solveLift(s, { aimX: 0.98, aimY: 0.3, power: 0.3, top: 0.3 }), power: 0.3, spin: 0, top: 0.3 }, k);
    const m = o.keeperMotion, full = freeKickKeeperFrame(k.id, m, m.plan.reaction + m.plan.diveTime);
    const gloves = Math.max(...full.arms.map(arm => Math.abs(toWorld(full, arm.hand).x - m.stepTo))) * 3.66;
    reaches.push(`${k.id} ${gloves.toFixed(2)}`);
    assert.ok(gloves <= (k.boss ? 3.5 : 3.1), `${k.id}: ${gloves.toFixed(2)} m`);
  }
  console.log("one-dive glove reach (m): " + reaches.join(", "));
});

test("C1c: saves come from position and timing — balls at him are saved, a placed top corner beats him", () => {
  let nearSaved = 0, near = 0, binGoals = 0, bins = 0;
  const random = prng(77);
  for (let k = 0; k < 400; k++) {
    const k0 = KEEPERS[k % KEEPERS.length];
    if (k0.boss) continue;
    const s = freeKickSetup(0x400 + k, { distance: 26 + (k % 6), wallHeight: 1.8 });
    const side = freeKickWall(s).side;
    // At him: a waist-high ball close to where he is set.
    const at = -side * 0.2 + (random() - 0.5) * 0.2;
    const o1 = resolveFreeKick(s, { aimX: at, lift: solveLift(s, { aimX: at, aimY: 0.35, power: 0.5, top: 0.3 }), power: 0.5, spin: 0, top: 0.3 }, k0);
    if (Math.abs(o1.target.x) < 1 && o1.result !== "wall") { near++; if (o1.result === "save") nearSaved++; }
    // The far top corner on the wall side (over the wall), well placed.
    const bx = side * 0.9;
    const o2 = resolveFreeKick(s, { aimX: bx, lift: solveLift(s, { aimX: bx, aimY: 0.88, power: 0.6, top: 0.6 }), power: 0.6, spin: 0, top: 0.6 }, k0);
    if (o2.result === "goal" || o2.result === "save") { bins++; if (o2.result === "goal") binGoals++; }
  }
  assert.ok(nearSaved / near > 0.75, `balls at him saved ${nearSaved}/${near}`);
  assert.ok(binGoals / bins > 0.7, `placed top corners scored ${binGoals}/${bins}`);
});

test("C1c: a high ball over his head is tipped over the bar (an upward leap), and the outcome says so", () => {
  let tips = 0;
  for (let k = 0; k < 400 && tips === 0; k++) {
    const k0 = KEEPERS[k % 6];
    const s = freeKickSetup(0x700 + k, { distance: 24, angle: 0.3, wallSize: 3 });
    const x = -freeKickWall(s).side * 0.2 + ((k % 5) - 2) * 0.04;
    const o = resolveFreeKick(s, { aimX: x, lift: solveLift(s, { aimX: x, aimY: 0.97, power: 0.5, top: 0.4 }), power: 0.5, spin: 0, top: 0.4 }, k0);
    if (o.result === "save" && o.tipOver) { tips++; assert.ok(o.keeperMotion.tip); }
  }
  assert.ok(tips > 0);
});

test("C1c: a ball blocked by the wall: the keeper stays set (no dive)", () => {
  const w = resolveFreeKick(setup, shot({ aimX: freeKickWall(setup).side * 0.55, lift: 0.05, power: 0.6 }), keeper);
  assert.equal(w.result, "wall");
  assert.equal(w.keeperMotion.dives, false);
});

test("C1b: long range (28 m+) is flagged for the SCREAMER bonus", () => {
  assert.equal(resolveFreeKick(freeKickSetup(1, { distance: 28 }), shot({}), keeper).longRange, true);
  assert.equal(resolveFreeKick(freeKickSetup(1, { distance: 27 }), shot({}), keeper).longRange, false);
  assert.equal(SCREAMER_DISTANCE, 28); assert.equal(SCREAMER_BONUS, 1.5);
});
