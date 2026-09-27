// Per-keeper save rates and body-mask area: a dev check for keeper art changes (each keeper's
// size/reach class must hold). Usage: node --experimental-strip-types scripts/keeper-balance.ts
import { KEEPERS, KEEPER_RIGS, NEUTRAL, resolveShot, kickSeed, prng } from "../packages/engine/src/index.ts";

const random = prng(0x6e23);
const shots = Array.from({ length: 6000 }, () => ({ aimX: random() * 2 - 1, aimY: random() * 0.95, power: 0.35 + random() * 0.65, curl: random() * 2 - 1 }));
const area = (mask: readonly string[]) => [...mask.join("")].filter(ch => ch === "#").length;
console.log("keeper      saves   body   mask px per pose");
for (const keeper of KEEPERS) {
  let saves = 0, body = 0, n = 0;
  shots.forEach((shot, k) => {
    const outcome = resolveShot(shot, keeper, kickSeed(k, k % 5, keeper.id), { kickIndex: k % 5, history: [] }, NEUTRAL);
    if (outcome.result !== "goal" && outcome.result !== "save") return;
    n++;
    if (outcome.result === "save") { saves++; if (outcome.touch === "body") body++; }
  });
  const rig = KEEPER_RIGS[keeper.id] as { mask: readonly string[]; poses?: Readonly<Record<string, readonly string[]>> };
  const masks = rig.poses ? Object.entries(rig.poses).map(([pose, mask]) => `${pose} ${area(mask)}`).join(", ") : `set ${area(rig.mask)}`;
  console.log(`${keeper.id.padEnd(10)} ${((saves / n) * 100).toFixed(1).padStart(5)}% ${((body / n) * 100).toFixed(1).padStart(5)}%   ${masks}`);
}
