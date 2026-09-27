/**
 * The keeper's body at time t: ONE source of truth for physics AND rendering (round 6 B4).
 *
 * resolveShot saves a shot only when the ball touches this geometry at the crossing time, and the
 * Stage draws the keeper from exactly the same frame (sprite, arms, gloves, trailing leg, mime wall),
 * so "saved" always means "the ball visibly hit the keeper" and a goal never passes through him.
 *
 * Units: "iso goal units". x is the goal-face x (posts at ±1); y is HEIGHT measured in the same unit
 * (1 unit = half the goal width = 90 goal-art px), so shapes are round on screen. The crossbar is at
 * y = GOAL_ASPECT (the goal art is 180 × 80 px). A goal-plane point (gx, gy) is (gx, gy·GOAL_ASPECT).
 */
import type { KeeperId, KeeperPlan } from "./index.ts";

/** Crossbar height in iso units (goal art: 80 px bar height over a 90 px half-width). */
export const GOAL_ASPECT = 0.89;
/** Goal-art px per goal unit (gfx/stadium.ts GOAL.unit). */
export const ART_UNIT = 90;
/** Ball radius at the goal line, goal units (the Stage draws the ball this size at the crossing). */
export const BALL_RADIUS = 0.045;
/** Lowest height (goal units) of the top-bin zone: |x| ≥ 0.66 and y ≥ TOP_BIN_Y (shotZone "bin"). */
export const TOP_BIN_Y = 0.66;
/**
 * A keeper whose maxY is under TOP_BIN_Y "cannot reach the top corners": his whole rig (tipped body, arms,
 * gloves) stays strictly under the lowest top-bin ball, so no top-bin shot can touch him (BQ-P1-3).
 */
const TOP_BIN_CEILING = TOP_BIN_Y * GOAL_ASPECT - BALL_RADIUS - 1e-3;
/** Trailing leg: radius of the leg capsule (a boot is drawn inside it), iso units. */
export const LEG_RADIUS = 0.05;
/** Chance a diving keeper leaves a trailing leg across the middle (decided per kick, drawn when present). */
export const LEG_CHANCE = 0.7;
/** Arm angle when standing (radians above the local horizontal, outward). In a dive the arms swing up and in until the gloves meet on the body axis. */
const ARM_IDLE = -0.35;

/**
 * The keeper art the physics uses: sprite scale (goal-art px per sprite pixel), shoulder row, arm
 * length (sprite px) and the opaque-pixel mask of each body pose the Stage can draw while a ball is
 * in flight. gfx/keepers.ts draws these exact pixels; the masks below are GENERATED from that art by
 * scripts/gen-keeper-masks.mjs (run it after any keeper art change), and tests/game/keeper-sync.test.ts
 * fails if the art and these masks ever differ.
 *
 * Poses (round 6 E23): "set" (the ready crouch, standing / stand-up block / ghost blink), "launch"
 * (legs tucked, first part of a dive) and "stretch" (full-length dive). All poses share one grid.
 */
export type RigPose = "set" | "launch" | "stretch";
export const RIG_POSES: readonly RigPose[] = ["set", "launch", "stretch"];
/** Dive progress where the body switches set → launch → stretch (a dive, never a stand-up block or blink). */
export const LAUNCH_AT = 0.12, STRETCH_AT = 0.55;
export type KeeperRig = Readonly<{ scale: number; shoulderY: number; armLength: number; poses: Readonly<Record<RigPose, readonly string[]>> }>;
export const KEEPER_RIGS: Readonly<Record<KeeperId, KeeperRig>> = {
  // <generated:keeper-masks> by scripts/gen-keeper-masks.mjs from games/penalty-kings/gfx/keepers.ts; do not edit by hand.
  mouse: { scale: 2.2, shoulderY: 9, armLength: 6, poses: {
    set: [
      "................",
      "..###......###..",
      ".#####....#####.",
      ".##############.",
      ".##############.",
      "..############..",
      "...##########...",
      "...##########...",
      ".##############.",
      "...##########...",
      "....########..##",
      "...###########..",
      "...###########..",
      "...##########...",
      "....###..###....",
      "...####..####...",
    ],
    launch: [
      "................",
      ".###........###.",
      "#####......#####",
      "################",
      ".##############.",
      "..############..",
      "...##########...",
      "...##########...",
      ".##############.",
      "...##########...",
      "....########....",
      "....########....",
      "....#########...",
      ".....#######....",
      "......#####.....",
      "......####......",
    ],
    stretch: [
      ".###........###.",
      "#####......#####",
      "################",
      ".##############.",
      "..############..",
      "...##########...",
      "...##########...",
      ".##############.",
      "...##########...",
      "....########....",
      "....########....",
      "....########.#..",
      ".....######.#...",
      ".....#######....",
      "......#####.....",
      "......####......",
    ],
  } },
  squirrel: { scale: 2.8, shoulderY: 8, armLength: 7, poses: {
    set: [
      ".................",
      "...##......######",
      "..####....#######",
      "..###############",
      "...###########.##",
      "...##############",
      "...##############",
      "...##############",
      "....#############",
      "...##############",
      "..###############",
      "..##############.",
      "..#############..",
      "...####...####...",
      "..#####...#####..",
    ],
    launch: [
      ".................",
      "..##........##...",
      "..####....####...",
      "..#############..",
      "...###########...",
      "...############..",
      "...#############.",
      "...#############.",
      "....############.",
      "....############.",
      "...#############.",
      "...############..",
      "....##########...",
      ".....#######.....",
      ".....#######.....",
    ],
    stretch: [
      "..##........##...",
      "..####....####...",
      "..#############..",
      "...###########...",
      "...###########...",
      "...############..",
      "...############..",
      "....###########..",
      "....###########..",
      "...############..",
      "...###########...",
      "....##########...",
      "....#########....",
      ".....#######.....",
      ".....#######.....",
    ],
  } },
  sloth: { scale: 3, shoulderY: 8, armLength: 11, poses: {
    set: [
      "................",
      "...#.######.###.",
      "...############.",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...####..####...",
      "..#####..#####..",
    ],
    launch: [
      "................",
      "...#.######.###.",
      "...############.",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "....########....",
      "....########....",
    ],
    stretch: [
      "...#.######.##..",
      "...############.",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "....########....",
      "....########....",
      "....########....",
    ],
  } },
  peacock: { scale: 2.8, shoulderY: 8, armLength: 7, poses: {
    set: [
      "................",
      "......#.#.#.....",
      "......#.#.#.....",
      "......####......",
      ".....######.....",
      "....########....",
      ".....######.....",
      "......####......",
      "......####......",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "......#..#......",
      ".....###.###....",
    ],
    launch: [
      "................",
      ".......#.#.#....",
      "......####.#....",
      ".....######.....",
      "....########....",
      ".....######.....",
      "......####......",
      "......####......",
      "....########....",
      "...##########...",
      "...##########...",
      "...##########...",
      "....########....",
      "....#######.....",
      "...#######......",
      "....#.####......",
    ],
    stretch: [
      "......#.#.#.....",
      "......####......",
      ".....######.....",
      "....########....",
      ".....######.....",
      "......####......",
      "......####......",
      "....########....",
      "...##########...",
      "...##########...",
      "...##########...",
      "....########....",
      "...########.....",
      "...########.....",
      "...########.....",
      "...########.....",
    ],
  } },
  octopus: { scale: 2.8, shoulderY: 9, armLength: 9, poses: {
    set: [
      "................",
      ".....######.....",
      "....########....",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "....########....",
      "..############..",
      "..##.##.##.##...",
      "..##.##.##.##...",
      "..####..##..##..",
      "..####...##.##..",
    ],
    launch: [
      "................",
      ".....######.....",
      "....########....",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "....########....",
      "...##########...",
      "....##.##.##....",
      "....##.##.##....",
      "....##.##.##....",
      "...##..##.##....",
    ],
    stretch: [
      ".....######.....",
      "....########....",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "....########....",
      "....########....",
      "...##########...",
      "....##.##.##....",
      "....##.##.##....",
      "....##.##.##....",
      "....##.##.##....",
    ],
  } },
  mime: { scale: 2.8, shoulderY: 8, armLength: 7, poses: {
    set: [
      "................",
      ".......#........",
      "....########....",
      "...###########..",
      "....########....",
      "....########....",
      "....########....",
      "....########....",
      ".....########...",
      "....##########..",
      "...############.",
      "...#############",
      "...#############",
      "....########..#.",
      "...####..####...",
    ],
    launch: [
      "................",
      ".......#........",
      "....########....",
      "...###########..",
      "....########....",
      "....########....",
      "....########....",
      "....########....",
      ".....#######....",
      "....#########...",
      "....##########..",
      "....##########..",
      "....#########...",
      ".....######.....",
      ".....######.....",
    ],
    stretch: [
      ".......#........",
      "....########....",
      "...###########..",
      "....########....",
      "....########....",
      "....########....",
      "....########....",
      ".....#######....",
      "....##########..",
      "....###########.",
      "....############",
      "....########.##.",
      ".....######.....",
      ".....######.....",
      ".....######.....",
    ],
  } },
  disco: { scale: 2.8, shoulderY: 9, armLength: 7, poses: {
    set: [
      "................",
      "...###.##.###...",
      "..############..",
      ".##############.",
      "################",
      ".##############.",
      "..############..",
      "...##########...",
      "...##########...",
      "..############..",
      "...##########...",
      "...##########...",
      "...##########...",
      ".##############.",
      ".######..######.",
    ],
    launch: [
      "................",
      "...###.##.###...",
      "..############..",
      ".##############.",
      "################",
      ".##############.",
      "..############..",
      "...##########...",
      "...##########...",
      "..############..",
      "...##########...",
      "...##########...",
      "....########....",
      "...##########...",
      "...####..####...",
    ],
    stretch: [
      "...###.##.###...",
      "..############..",
      ".##############.",
      "################",
      ".##############.",
      "..############..",
      "...##########...",
      "...##########...",
      "..############..",
      "...##########...",
      "...##########...",
      "....########....",
      "....########....",
      "...##########...",
      "...####..####...",
    ],
  } },
  sumo: { scale: 3.2, shoulderY: 7, armLength: 7, poses: {
    set: [
      "................",
      "......####......",
      ".....######.....",
      "....########....",
      "...##########...",
      "...##########...",
      "..############..",
      ".##############.",
      "################",
      "################",
      "################",
      "################",
      ".####.#.#.#####.",
      ".####.#.#.#####.",
    ],
    launch: [
      "................",
      "......####......",
      ".....######.....",
      "....########....",
      "...##########...",
      "...##########...",
      "..############..",
      ".##############.",
      "################",
      "################",
      "################",
      "################",
      "..#####.######..",
      "..#####.######..",
    ],
    stretch: [
      "......####......",
      ".....######.....",
      "....########....",
      "...##########...",
      "...##########...",
      "..############..",
      ".##############.",
      "################",
      "################",
      "################",
      "################",
      ".##############.",
      "..#####.######..",
      "..#####.######..",
    ],
  } },
  chameleon: { scale: 2.8, shoulderY: 8, armLength: 7, poses: {
    set: [
      "................",
      "...#####........",
      "..#######.......",
      "..###########...",
      ".#############..",
      ".##############.",
      ".###############",
      "..##############",
      "...#############",
      "...############.",
      "...###########..",
      "...############.",
      "....####.####...",
      "...####..####...",
    ],
    launch: [
      "................",
      "...#####........",
      "..#######.......",
      "..###########...",
      ".#############..",
      ".##############.",
      ".##############.",
      "..#############.",
      "...#############",
      "...#############",
      "...#############",
      "....###########.",
      ".....#######....",
      ".....######.....",
    ],
    stretch: [
      "...#####........",
      "..#######.......",
      "..###########...",
      ".#############..",
      ".##############.",
      ".##############.",
      "..#############.",
      "...#############",
      "...#############",
      "...############.",
      "....##########..",
      "....#########...",
      ".....#######....",
      ".....######.....",
    ],
  } },
  robot: { scale: 2.8, shoulderY: 8, armLength: 7, poses: {
    set: [
      "................",
      "........#.......",
      "........#.......",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      ".....######.....",
      ".##############.",
      ".#############..",
      "...##########...",
      "...##########...",
      "....###..###....",
      "...####..####...",
    ],
    launch: [
      "................",
      "........#.......",
      ".......#........",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      ".....######.....",
      ".##############.",
      ".#############..",
      "...##########...",
      "....########....",
      ".....######.....",
      ".....######.....",
    ],
    stretch: [
      "......#.........",
      ".......#........",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      ".....######.....",
      ".##############.",
      ".#############..",
      "...##########...",
      "....########....",
      ".....######.....",
      ".....######.....",
      ".....######.....",
    ],
  } },
  ghost: { scale: 2.8, shoulderY: 8, armLength: 6, poses: {
    set: [
      ".....######.....",
      "....########....",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..#..#..#..#....",
    ],
    launch: [
      "................",
      ".....######.....",
      "....########....",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "...##########...",
      ".....#..#..#....",
    ],
    stretch: [
      ".....######.....",
      "....########....",
      "...##########...",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "..############..",
      "...##########...",
      "...##########...",
      "...##########...",
      "....#..#..#.....",
    ],
  } },
  finalwall: { scale: 3.4, shoulderY: 7, armLength: 9, poses: {
    set: [
      "...#.#.#.#.#....",
      "...##########...",
      "..###########...",
      ".#############..",
      ".#############..",
      ".#############..",
      ".#############..",
      "################",
      "################",
      "################",
      "################",
      ".#############..",
      ".#####...#####..",
      ".#####...#####..",
    ],
    launch: [
      "...#.#.#.#.#....",
      "...##########...",
      "..###########...",
      ".#############..",
      ".#############..",
      ".#############..",
      ".#############..",
      "################",
      "################",
      "################",
      "################",
      ".#############..",
      ".#####...#####..",
      ".#####...#####..",
    ],
    stretch: [
      "...#.#.#.#.#....",
      "...##########...",
      "..###########...",
      ".#############..",
      ".#############..",
      ".#############..",
      ".#############..",
      "################",
      "################",
      "################",
      "################",
      ".#############..",
      ".#####...#####..",
      ".#####...#####..",
    ],
  } },
  // </generated:keeper-masks>
};

export type Point = Readonly<{ x: number; y: number }>;
type Box = readonly [number, number, number, number]; // x0, y0, x1, y1 (y up)

type RigGeometry = Readonly<{
  /** Sprite size and one sprite pixel, iso units. */
  w: number; h: number; px: number;
  shoulderX: number; shoulderY: number; arm: number; armWidth: number; glove: number;
  /** Opaque runs of the body mask in the local frame (origin = sprite centre, y up). */
  runs: readonly Box[]; bounds: Box;
}>;
const geometryCache = new Map<string, RigGeometry>();
/** Sizes derived from the art for one body pose, iso units. Arm width and glove size match gfx/keepers.ts drawKeeper. */
export function rigGeometry(id: KeeperId, pose: RigPose = "set"): RigGeometry {
  const key = `${id}:${pose}`, cached = geometryCache.get(key);
  if (cached) return cached;
  const rig = KEEPER_RIGS[id], mask = rig.poses[pose], px = rig.scale / ART_UNIT, cols = mask[0].length, rows = mask.length;
  const w = cols * px, h = rows * px, runs: Box[] = [];
  mask.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "#") continue;
      let end = c; while (row[end + 1] === "#") end++;
      runs.push([-w / 2 + c * px, h / 2 - (r + 1) * px, -w / 2 + (end + 1) * px, h / 2 - r * px]);
      c = end;
    }
  });
  const bounds: Box = [Math.min(...runs.map(b => b[0])), Math.min(...runs.map(b => b[1])), Math.max(...runs.map(b => b[2])), Math.max(...runs.map(b => b[3]))];
  const geometry: RigGeometry = {
    w, h, px, shoulderX: w * 0.3, shoulderY: h / 2 - rig.shoulderY * px, arm: rig.armLength * px,
    armWidth: Math.max(2, Math.round(rig.scale * 1.2)) / ART_UNIT,
    glove: (Math.max(3, Math.round(rig.scale * 2)) + 2) / ART_UNIT, // outer size: the glove plus its 1 px outline
    runs, bounds,
  };
  geometryCache.set(key, geometry);
  return geometry;
}

export type KeeperArm = Readonly<{ shoulder: Point; hand: Point }>;
/** Everything the keeper occupies at one instant. Physics tests the ball against it; the Stage draws it. */
export type KeeperFrame = Readonly<{
  id: KeeperId;
  /** Dive progress 0 … 1. */
  progress: number;
  /** Which body sprite is drawn AND hit-tested: the set crouch, the launch tuck or the full stretch. */
  pose: RigPose;
  /** Body sprite centre (iso units) and rotation (radians; + tips the top of the body towards +x). */
  x: number; y: number; rotate: number;
  /** Arms in the keeper's LOCAL frame (origin = sprite centre, +y = up the body): shoulder → glove centre. */
  arms: readonly [KeeperArm, KeeperArm];
  /** Arm thickness and the glove's outer size, iso units. */
  armWidth: number; glove: number;
  /** Trailing leg in WORLD iso units: a capsule hip → boot with radius LEG_RADIUS. */
  leg: Readonly<{ hip: Point; foot: Point }> | null;
  /** Mime: the invisible wall's x-interval (full goal height). */
  wall: readonly [number, number] | null;
}>;
export type KeeperPart = "wall" | "glove" | "arm" | "body" | "leg";

/** Local (keeper frame) → world (iso goal units). */
export function toWorld(frame: Pick<KeeperFrame, "x" | "y" | "rotate">, local: Point): Point {
  const cos = Math.cos(frame.rotate), sin = Math.sin(frame.rotate);
  return { x: frame.x + local.x * cos + local.y * sin, y: frame.y - local.x * sin + local.y * cos };
}
function toLocal(frame: Pick<KeeperFrame, "x" | "y" | "rotate">, world: Point): Point {
  const cos = Math.cos(frame.rotate), sin = Math.sin(frame.rotate), dx = world.x - frame.x, dy = world.y - frame.y;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}
const boxDistance = (p: Point, [x0, y0, x1, y1]: Box) => Math.hypot(p.x - Math.min(x1, Math.max(x0, p.x)), p.y - Math.min(y1, Math.max(y0, p.y)));
function segmentDistance(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x, vy = b.y - a.y, len = vx * vx + vy * vy;
  const u = len ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
  return Math.hypot(p.x - a.x - vx * u, p.y - a.y - vy * u);
}

/**
 * The keeper at time t after the strike (seconds of plan time). Pure and deterministic.
 * Standing: feet on the goal line at x = plan.home (0 unless a free kick), arms low. Diving: the body travels and tips towards the plan
 * point (plan.x, plan.y) so the gloves arrive there at full progress (hands never above maxY), never
 * sinking below the ground. A central plan (|x| < 0.12) stays upright and spreads the arms at the
 * plan height. A teleport (ghost) snaps upright to the point halfway through the dive.
 */
export function keeperFrame(id: KeeperId, plan: KeeperPlan, t: number): KeeperFrame {
  const g = rigGeometry(id), arm = g.arm * (plan.armScale ?? 1);
  const raw = Math.min(1, Math.max(0, (t - plan.reaction) / plan.diveTime));
  const p = plan.teleport ? (raw > 0.5 ? 1 : 0) : 1 - (1 - raw) ** 2;
  const aim = { x: plan.x, y: Math.min(plan.y, plan.maxY) * GOAL_ASPECT };
  const start = { x: plan.home ?? 0, y: g.h / 2 };
  const dx = aim.x - start.x, dy = aim.y - start.y;
  // A central plan (|dx| < 0.12) is a stand-up block: shuffle across, arms spread sideways at the shot height ("make yourself big").
  const upright = !plan.teleport && Math.abs(dx) < 0.12;
  const tip = plan.teleport || upright ? 0 : Math.atan2(dx, Math.max(dy, 0));
  // Fully stretched: both gloves side by side on the body axis, so the ball aimed at the dive point meets them.
  const inward = Math.max(0, g.shoulderX - g.glove / 2), armDive = Math.atan2(Math.sqrt(Math.max(0, arm * arm - inward * inward)), -Math.min(inward, arm));
  const reachAlong = g.shoulderY + arm * Math.sin(armDive);
  const end = upright ? { x: aim.x, y: start.y } : { x: aim.x - Math.sin(tip) * reachAlong, y: aim.y - Math.cos(tip) * reachAlong };
  const armEnd = upright ? Math.min(Math.PI / 2 - 0.2, Math.max(ARM_IDLE, Math.asin(Math.max(-1, Math.min(1, (aim.y - start.y - g.shoulderY) / arm))))) : armDive;
  const rotate = tip * p;
  // The body sprite: all poses share one grid, so only the opaque pixels (and the ground clearance) change.
  const pose: RigPose = plan.teleport || upright || p < LAUNCH_AT ? "set" : p < STRETCH_AT ? "launch" : "stretch";
  let x = start.x + (end.x - start.x) * p, y = start.y + (end.y - start.y) * p;
  // Never below the grass: lift the body until its lowest pixel is on the ground.
  const [bx0, by0, bx1, by1] = rigGeometry(id, pose).bounds, sin = Math.sin(rotate), cos = Math.cos(rotate);
  const lowest = Math.min(...[[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].map(([lx, ly]) => -lx * sin + ly * cos));
  const angle = ARM_IDLE + (armEnd - ARM_IDLE) * p;
  const armFor = (side: number): KeeperArm => {
    const shoulder = { x: side * g.shoulderX, y: g.shoulderY };
    return { shoulder, hand: { x: shoulder.x + side * Math.cos(angle) * arm, y: shoulder.y + Math.sin(angle) * arm } };
  };
  const arms: [KeeperArm, KeeperArm] = [armFor(-1), armFor(1)];
  if (plan.maxY < TOP_BIN_Y) {
    // Cannot reach the top corners: lower the rig until its highest point (a tipped body corner, a glove's
    // outer corner or a shoulder's arm edge) is under the lowest top-bin ball.
    const up = (lx: number, ly: number) => -lx * sin + ly * cos, half = g.glove / 2;
    const highest = Math.max(...[[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]].map(([lx, ly]) => up(lx, ly)),
      ...arms.flatMap(({ shoulder, hand }) => [up(shoulder.x, shoulder.y) + g.armWidth / 2, ...[[-half, -half], [half, -half], [-half, half], [half, half]].map(([ox, oy]) => up(hand.x + ox, hand.y + oy))]));
    y = Math.min(y, TOP_BIN_CEILING - highest);
  }
  if (y + lowest < 0) y = -lowest;
  let leg: KeeperFrame["leg"] = null;
  if (plan.leg && !plan.teleport && tip !== 0 && p > 0) {
    // The trailing leg: from the hip back towards where he stood (the middle for penalties), along the grass.
    const hip = toWorld({ x, y, rotate }, { x: 0, y: -g.h * 0.35 });
    const target = { x: start.x - Math.sign(dx) * 0.02, y: LEG_RADIUS };
    const vx = target.x - hip.x, vy = target.y - hip.y, length = Math.hypot(vx, vy) || 1, k = Math.min(1, (g.h * 1.25) / length) * p;
    leg = { hip, foot: { x: hip.x + vx * k, y: hip.y + vy * k } };
  }
  return { id, progress: p, pose, x, y, rotate, arms, armWidth: g.armWidth, glove: g.glove, leg, wall: plan.wall ?? null };
}

/**
 * Which part of the keeper (if any) the ball touches: a disc of radius r at `ball` (iso units).
 * The ONLY save test for penalties and free kicks: the same shapes the Stage draws.
 */
export function keeperTouch(frame: KeeperFrame, ball: Point, r = BALL_RADIUS): KeeperPart | null {
  if (frame.wall && boxDistance(ball, [Math.max(-1, frame.wall[0]), 0, Math.min(1, frame.wall[1]), GOAL_ASPECT]) <= r) return "wall";
  const g = rigGeometry(frame.id, frame.pose), local = toLocal(frame, ball), half = frame.glove / 2;
  for (const { hand } of frame.arms) if (boxDistance(local, [hand.x - half, hand.y - half, hand.x + half, hand.y + half]) <= r) return "glove";
  for (const { shoulder, hand } of frame.arms) if (segmentDistance(local, shoulder, hand) <= r + frame.armWidth / 2) return "arm";
  if (boxDistance(local, g.bounds) <= r) for (const run of g.runs) if (boxDistance(local, run) <= r) return "body";
  if (frame.leg && segmentDistance(ball, frame.leg.hip, frame.leg.foot) <= r + LEG_RADIUS) return "leg";
  return null;
}
