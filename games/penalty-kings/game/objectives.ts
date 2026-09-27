/**
 * World Tour levels are DATA (levels.json) so more can be added without code. Each level has three
 * objectives: the first gives 1 star, the first two give 2 stars, all three give 3 stars.
 */
import type { KeeperId, Zone } from "@penalty-kings/engine";

export type Objective =
  | { type: "goals"; count: number }
  | { type: "zone"; zone: Zone; count: number }
  | { type: "zone-streak"; zone: Zone; count: number }
  | { type: "streak"; count: number }
  | { type: "points"; count: number }
  | { type: "no-miss" }
  | { type: "post-in"; count: number }
  | { type: "chip"; count: number }
  | { type: "knuckle"; count: number }
  | { type: "curl"; count: number; side?: "left" | "right"; zone?: Zone };

export type Level = {
  id: string;
  stadium: "park" | "pro" | "champions";
  /** World Tour city (1–6, five levels each; game/tour.ts). */
  chapter?: number;
  name: string;
  mode: "penalty" | "freekick";
  keeper: KeeperId;
  kicks: number;
  setup?: { distance: number; angle: number; wallSize: 3 | 4 | 5; wind?: number; wallHeight?: number };
  objectives: [Objective, Objective, Objective];
  /** Cosmetic unlocked at 3 stars (economy COSMETICS id), if any. */
  reward?: string;
};

/** What one kick produced, as far as objectives care. */
export type KickRecord = {
  result: "goal" | "save" | "post" | "over" | "wide" | "wall";
  zone: Zone;
  points: number;
  postIn?: boolean;
  /** Goal-plane crossing (goal units). */
  x: number;
  y: number;
  /** Free kicks: sidespin used and whether it was a knuckleball. */
  spin?: number;
  knuckle?: boolean;
  /** Free kicks: a goal from 28 m+ (SCREAMER, +50 %) and the distance it came from; a keeper's tip over the bar. */
  screamer?: boolean;
  distance?: number;
  tipOver?: boolean;
};

const goals = (kicks: readonly KickRecord[]) => kicks.filter(kick => kick.result === "goal");
const zoneAtLeast = (zone: Zone, wanted: Zone) => ({ centre: 0, side: 1, corner: 2, bin: 3 })[zone] >= ({ centre: 0, side: 1, corner: 2, bin: 3 })[wanted];
function longest(kicks: readonly KickRecord[], test: (kick: KickRecord) => boolean) {
  let best = 0, run = 0;
  for (const kick of kicks) { run = test(kick) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

export function met(objective: Objective, kicks: readonly KickRecord[]): boolean {
  switch (objective.type) {
    case "goals": return goals(kicks).length >= objective.count;
    case "zone": return goals(kicks).filter(kick => zoneAtLeast(kick.zone, objective.zone)).length >= objective.count;
    case "zone-streak": return longest(kicks, kick => kick.result === "goal" && zoneAtLeast(kick.zone, objective.zone)) >= objective.count;
    case "streak": return longest(kicks, kick => kick.result === "goal") >= objective.count;
    case "points": return kicks.reduce((sum, kick) => sum + kick.points, 0) >= objective.count;
    case "no-miss": return kicks.length > 0 && kicks.every(kick => kick.result === "goal");
    case "post-in": return goals(kicks).filter(kick => kick.postIn).length >= objective.count;
    case "chip": return goals(kicks).filter(kick => kick.zone === "centre" && kick.y >= 0.55).length >= objective.count;
    case "knuckle": return goals(kicks).filter(kick => kick.knuckle).length >= objective.count;
    case "curl": return goals(kicks).filter(kick => Math.abs(kick.spin ?? 0) >= 0.45
      && (!objective.side || (objective.side === "left" ? kick.x < 0 : kick.x > 0))
      && (!objective.zone || zoneAtLeast(kick.zone, objective.zone))).length >= objective.count;
  }
}

/** Stars are cumulative: star 2 needs objective 1 too, star 3 needs all three. */
export function starsFor(level: Level, kicks: readonly KickRecord[]) {
  let stars = 0;
  for (const objective of level.objectives) { if (!met(objective, kicks)) break; stars++; }
  return stars;
}

const ZONE_NAMES: Record<Zone, string> = { centre: "anywhere", side: "a side", corner: "a corner", bin: "a top bin" };
export function describe(objective: Objective, keeperName: string): string {
  switch (objective.type) {
    case "goals": return `Score ${objective.count} past ${keeperName}`;
    case "zone": return objective.zone === "bin" ? `${objective.count} top-bin goal${objective.count > 1 ? "s" : ""}` : `${objective.count} goal${objective.count > 1 ? "s" : ""} in ${ZONE_NAMES[objective.zone]} or better`;
    case "zone-streak": return `${objective.count} ${objective.zone === "bin" ? "top-bins" : `${objective.zone} goals`} in a row`;
    case "streak": return `${objective.count} goals in a row`;
    case "points": return `${objective.count.toLocaleString("en-US")} points`;
    case "no-miss": return "Don't miss a single kick";
    case "post-in": return `${objective.count} in off the post`;
    case "chip": return `${objective.count} chipped centre goal${objective.count > 1 ? "s" : ""} (Panenka)`;
    case "knuckle": return `${objective.count} knuckleball goal${objective.count > 1 ? "s" : ""}`;
    case "curl": return `Curl ${objective.count} round the wall${objective.side ? ` ${objective.zone === "bin" ? "top-" : ""}${objective.side}` : ""}${objective.zone && !objective.side ? ` into ${ZONE_NAMES[objective.zone]}` : ""}`;
  }
}
