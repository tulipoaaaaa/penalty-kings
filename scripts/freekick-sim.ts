// Free-kick balance report (docs/DIFFICULTY.md "Free kicks"): flight time per distance, goal rate per distance
// for a "good swipe" bot with and without a keeper (wall always there, NEUTRAL difficulty), and the keeper's
// fastest lateral body speed over every simulated frame.
// Good swipe: picks a crossing point anywhere between x = ±0.25…0.85 and y = 0.45…0.9 (goal units), a natural
// pace (power 0.4–0.75) and a natural flick (topspin 0.2–0.7), no sidespin, with Gaussian aim noise σ = 0.08;
// the lift is solved from the aimed height exactly as the swipe/keyboard mapping does (keyFreeKick).
// Usage: node --experimental-strip-types scripts/freekick-sim.ts [--kicks 400] [--json]
import * as engine from "../packages/engine/src/index.ts";
import { KEEPERS, NEUTRAL, WALL_HEIGHTS, freeKickSetup, resolveFreeKick, solveLift, keeperFrame, prng, type KeeperProfile, type FreeKickSetup } from "../packages/engine/src/index.ts";

const args = process.argv.slice(2);
const KICKS = Number(args.includes("--kicks") ? args[args.indexOf("--kicks") + 1] : 400);
const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
const NONE: KeeperProfile = { id: "mouse", name: "none", bio: "", tell: "", mult: 1, reaction: 9, diveTime: 1, reach: 0, body: 0, maxY: 0, read: 0 };
const FIELD = KEEPERS.filter(keeper => !keeper.boss);
const GOAL_HALF = 3.66;
// The engine's free-kick keeper frame when it has one (after C1c), else the shared rig frame.
const fkFrame = (engine as unknown as { freeKickKeeperFrame?: (id: string, outcome: unknown, t: number) => { x: number } }).freeKickKeeperFrame;
const frameAt = (keeper: KeeperProfile, outcome: ReturnType<typeof resolveFreeKick>, t: number) =>
  fkFrame ? fkFrame(keeper.id, (outcome as unknown as { keeperMotion: unknown }).keeperMotion, t) : keeperFrame(keeper.id, outcome.keeper, t);

function shotFor(setup: FreeKickSetup, random: () => number) {
  const side = random() < 0.5 ? -1 : 1;
  const x = side * (0.25 + random() * 0.6) + gauss(random) * 0.08, y = 0.45 + random() * 0.45 + gauss(random) * 0.08;
  const power = 0.4 + random() * 0.35, top = 0.2 + random() * 0.5;
  const aimX = Math.max(-1.3, Math.min(1.3, x));
  return { aimX, lift: solveLift(setup, { aimX, aimY: y, power, top }), power, spin: 0, top };
}

export function freeKickReport(kicks = KICKS) {
  const bands = [[18, 20], [21, 24], [25, 27], [28, 32]] as const;
  const rows = bands.map(([lo, hi]) => {
    const random = prng(0xfc0 + lo);
    let open = 0, kept = 0, n = 0;
    for (let k = 0; k < kicks; k++) {
      const distance = lo + (k % (hi - lo + 1));
      const setup = freeKickSetup(0xa000 + lo * 1000 + k, { distance, wallHeight: WALL_HEIGHTS.pro });
      const shot = shotFor(setup, random), keeper = FIELD[k % FIELD.length];
      if (resolveFreeKick(setup, shot, NONE).result === "goal") open++;
      if (resolveFreeKick(setup, shot, keeper, NEUTRAL).result === "goal") kept++;
      n++;
    }
    return { distance: `${lo}–${hi} m`, noKeeper: open / n, withKeeper: kept / n };
  });
  // Flight time (strike → goal line) for an on-target, unspun shot at natural and full pace.
  const flight = [18, 21, 24, 28, 32].map(distance => {
    const setup = { ...freeKickSetup(7, { distance, angle: 0 }), wallHeight: 0.02 };
    const time = (power: number) => resolveFreeKick(setup, { aimX: 0.5, lift: solveLift(setup, { aimX: 0.5, aimY: 0.7, power, top: 0.3 }), power, spin: 0, top: 0.3 }, NONE).target.time;
    const speed = (engine as unknown as { freeKickSpeed?: (p: number, d: number) => number }).freeKickSpeed;
    return { distance, launchSoft: speed ? speed(0, distance) : 18, launchHard: speed ? speed(1, distance) : 32, soft: time(0.4), natural: time(0.6), hard: time(1) };
  });
  // Keeper: fastest lateral body speed (m/s) over every 1/240 s frame of 2,000 kicks.
  let maxSpeed = 0, all = 0, allGoals = 0;
  const random = prng(0x5eed);
  for (let k = 0; k < 2000; k++) {
    const setup = freeKickSetup(0xb000 + k, { wallHeight: WALL_HEIGHTS.pro }), keeper = FIELD[k % FIELD.length];
    const outcome = resolveFreeKick(setup, shotFor(setup, random), keeper, NEUTRAL);
    all++; if (outcome.result === "goal") allGoals++;
    let prev = frameAt(keeper, outcome, -0.6).x;
    for (let t = -0.6 + 1 / 240; t <= outcome.target.time + 0.3; t += 1 / 240) {
      const x = frameAt(keeper, outcome, t).x;
      maxSpeed = Math.max(maxSpeed, (Math.abs(x - prev) * GOAL_HALF) * 240);
      prev = x;
    }
  }
  return { rows, flight, keeperMaxSpeed: maxSpeed, overallWithKeeper: allGoals / all };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = freeKickReport();
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
    console.log("Goal rate, good swipe (wall always; keeper = the 11 field keepers in turn, NEUTRAL):");
    for (const row of report.rows) console.log(`  ${row.distance.padEnd(9)} no keeper ${pct(row.noKeeper).padStart(4)}   with keeper ${pct(row.withKeeper).padStart(4)}`);
    console.log(`  overall with keeper (18–32 m mix): ${pct(report.overallWithKeeper)}`);
    console.log("Flight time strike → goal line (s), unspun, top 0.3:");
    for (const f of report.flight) console.log(`  ${String(f.distance).padStart(2)} m  launch (power 0–1) ${f.launchSoft.toFixed(1)}–${f.launchHard.toFixed(1)} m/s   power 0.4: ${f.soft.toFixed(2)}  0.6: ${f.natural.toFixed(2)}  1.0: ${f.hard.toFixed(2)}`);
    console.log(`Keeper max lateral body speed: ${report.keeperMaxSpeed.toFixed(1)} m/s`);
  }
}
