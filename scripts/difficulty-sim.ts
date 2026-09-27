// Proves the invisible dynamic difficulty keeps free-mode goal rates in the 55–65 % band for
// very different players. Bots aim at a zone with Gaussian aim/power noise and imperfect
// wobble timing; the director (engine nextDifficultyLevel) adjusts ONLY between 5-shot rounds.
// Usage: node --experimental-strip-types scripts/difficulty-sim.ts [--smoke]
import {
  KEEPERS, keeperById, resolveShot, kickSeed, prng, aimWobble, wobbleFor, nextDifficultyLevel,
  DIFFICULTY_LADDER, TARGET_BAND, assistShot, type KeeperId, type ShotRecord,
} from "../packages/engine/src/index.ts";

type Bot = { name: string; aim: number; power: number; timing: number; ambition: number };
export const BOTS: Bot[] = [
  { name: "novice", aim: 0.34, power: 0.2, timing: 0.1, ambition: 0.2 },
  { name: "casual", aim: 0.24, power: 0.14, timing: 0.4, ambition: 0.4 },
  { name: "good", aim: 0.15, power: 0.09, timing: 0.7, ambition: 0.6 },
  { name: "expert", aim: 0.07, power: 0.045, timing: 0.9, ambition: 0.85 },
];
const PARK: KeeperId[] = ["mouse", "squirrel", "sloth", "peacock", "octopus"];
const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());

export function simulate(bot: Bot, rounds: number, seed: number) {
  const random = prng(seed);
  const history: ShotRecord[] = [];
  let level = 3, goals = 0, counted = 0, streak = 0, kick = 0;
  const levels: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const keeper = keeperById(PARK[round % PARK.length]);
    const difficulty = DIFFICULTY_LADDER[level];
    for (let i = 0; i < 5; i++, kick++) {
      // Pick a target: ambitious players go for corners/bins, others for sides.
      const side = random() < 0.5 ? -1 : 1, high = random() < bot.ambition * 0.6;
      const tx = side * (random() < bot.ambition ? 0.8 : 0.5), ty = high ? 0.78 : 0.3;
      const wobble = aimWobble(random() * 10, wobbleFor(difficulty, streak)) * (1 - bot.timing);
      const shot = { aimX: tx + gauss(random) * bot.aim + wobble, loft: 0, power: (ty + 0.15) / 1.25 + gauss(random) * bot.power, curl: 0 };
      const outcome = resolveShot(assistShot(shot, difficulty.assist), keeper, kickSeed(seed, kick, keeper.id), { kickIndex: i, history: [] }, difficulty);
      const goal = outcome.result === "goal";
      history.push({ goal, zone: outcome.zone });
      streak = goal ? streak + 1 : 0;
      if (round >= 20) { counted++; if (goal) goals++; }
    }
    level = nextDifficultyLevel(level, history); // between rounds only
    levels.push(level);
  }
  return { rate: goals / counted, meanLevel: levels.slice(20).reduce((a, b) => a + b, 0) / (levels.length - 20) };
}

/** Fixed-difficulty goal rate: shows the band is only reachable because the director moves. */
export function fixedRate(bot: Bot, level: number, shots: number, seed: number) {
  const random = prng(seed); let goals = 0;
  for (let k = 0; k < shots; k++) {
    const keeper = keeperById(PARK[k % PARK.length]);
    const side = random() < 0.5 ? -1 : 1, high = random() < bot.ambition * 0.6;
    const tx = side * (random() < bot.ambition ? 0.8 : 0.5), ty = high ? 0.78 : 0.3;
    const shot = { aimX: tx + gauss(random) * bot.aim + aimWobble(random() * 10, DIFFICULTY_LADDER[level].wobble) * (1 - bot.timing), loft: 0, power: (ty + 0.15) / 1.25 + gauss(random) * bot.power, curl: 0 };
    if (resolveShot(assistShot(shot, DIFFICULTY_LADDER[level].assist), keeper, kickSeed(seed, k, keeper.id), { kickIndex: k % 5, history: [] }, DIFFICULTY_LADDER[level]).result === "goal") goals++;
  }
  return goals / shots;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const smoke = process.argv.includes("--smoke");
  const rounds = smoke ? 600 : 4000, seeds = smoke ? 3 : 10;
  let failed = false;
  console.log(`Target band ${TARGET_BAND.map(x => `${Math.round(x * 100)}%`).join("–")}; ${rounds} rounds × ${seeds} seeds per bot; first 20 rounds discarded.\n`);
  console.log("bot       easiest  hardest  | with director: goal rate  mean level");
  for (const bot of BOTS) {
    const runs = Array.from({ length: seeds }, (_, s) => simulate(bot, rounds, 1000 + s));
    const rate = runs.reduce((a, r) => a + r.rate, 0) / runs.length, level = runs.reduce((a, r) => a + r.meanLevel, 0) / runs.length;
    const easy = fixedRate(bot, 0, 20000, 7), hard = fixedRate(bot, DIFFICULTY_LADDER.length - 1, 20000, 7);
    const ok = rate >= TARGET_BAND[0] && rate <= TARGET_BAND[1];
    if (!ok) failed = true;
    console.log(`${bot.name.padEnd(9)} ${(easy * 100).toFixed(1).padStart(6)}%  ${(hard * 100).toFixed(1).padStart(6)}%  |  ${(rate * 100).toFixed(1).padStart(6)}%   ${level.toFixed(2).padStart(5)}   ${ok ? "PASS" : "FAIL"}`);
  }
  if (failed) { console.error("\nFAIL: a bot profile settles outside the target band"); process.exit(1); }
  console.log("\nPASS: every profile settles inside the band");
}
