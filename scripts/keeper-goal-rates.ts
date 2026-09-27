// Goal rate per keeper × rung (NEUTRAL, L0–L8): the difficulty-sim bots (all four, equal share), fixed rung.
// Usage: node --experimental-strip-types scripts/keeper-goal-rates.ts [shotsPerCell]
import { KEEPERS, resolveShot, kickSeed, prng, aimWobble, DIFFICULTY_LADDER, NEUTRAL, assistShot } from "../packages/engine/src/index.ts";
import { BOTS } from "../scripts/difficulty-sim.ts";

const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
const shots = Number(process.argv[2] ?? 20000);
const rungs = [["neutral", NEUTRAL], ...DIFFICULTY_LADDER.map((d, i) => [`L${i}`, d])] as const;
const rows: Record<string, Record<string, number>> = {};
for (const keeper of KEEPERS) {
  rows[keeper.id] = {};
  for (const [name, difficulty] of rungs) {
    const random = prng(0xbeef + name.length * 31 + keeper.id.length);
    let goals = 0;
    for (let k = 0; k < shots; k++) {
      const bot = BOTS[k % BOTS.length];
      const side = random() < 0.5 ? -1 : 1, high = random() < bot.ambition * 0.6;
      const tx = side * (random() < bot.ambition ? 0.8 : 0.5), ty = high ? 0.78 : 0.3;
      const shot = { aimX: tx + gauss(random) * bot.aim + aimWobble(random() * 10, difficulty.wobble) * (1 - bot.timing), aimY: ty + gauss(random) * bot.power * 1.25, power: Math.min(1, Math.max(0, 0.62 + gauss(random) * bot.power)), curl: 0 };
      if (resolveShot(assistShot(shot, difficulty.assist), keeper, kickSeed(7, k, keeper.id), { kickIndex: k % 5, history: [] }, difficulty).result === "goal") goals++;
    }
    rows[keeper.id][name] = goals / shots;
  }
}
console.log(JSON.stringify(rows));
