// Bug Quest P2 (engine / difficulty): one test per item, each failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, resolveShot, kickSeed, prng, aimWobble, assistShot, keeperPlan, shotTarget, DIFFICULTY_LADDER } from "../src/index.ts";

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
