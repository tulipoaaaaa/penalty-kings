/**
 * Set-piece rendering: the free-kick camera, the wall (cast from the keeper roster), the wind
 * flag, target-practice targets, zone hints and the shot-clock ring.
 *
 * Free-kick camera: behind the ball on the ball→goal line, 1.6 m up and 14 m back. Its focal
 * length is chosen per distance so the goal ALWAYS lands exactly on the stadium's goal art
 * (horizontal 90 px per 3.66 m, vertical 80 px per 2.44 m), whatever the distance.
 */
import { GOAL_HALF_WIDTH, GOAL_HEIGHT, WALL_DISTANCE, type FreeKickSetup, type FlightSample, type KeeperId, type Zone } from "@penalty-kings/engine";
import { KEEPER_DESIGNS } from "./keepers.js";
import { sprite, drawSprite, clamp01, ease } from "./core.js";
import { GOAL, toScreen } from "./stadium.js";

const BACK = 14, HEIGHT = 1.6;
const PX_X = GOAL.unit / GOAL_HALF_WIDTH, PX_Y = (GOAL.unit * 0.89) / GOAL_HEIGHT;
const HORIZON = GOAL.line - PX_Y * HEIGHT;

export type Projected = { x: number; y: number; scale: number };

/** World point (metres; x across, y up, z from the ball towards goal) → screen. */
export function fkProject(setup: FreeKickSetup, point: { x: number; y: number; z: number }): Projected {
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance, dist = setup.distance;
  const ux = -x0 / dist, uz = depth / dist, nx = depth / dist, nz = x0 / dist;
  const rx = point.x - x0, rz = point.z;
  const forward = rx * ux + rz * uz, lateral = rx * nx + rz * nz;
  const cam = Math.max(0.5, forward + BACK), k = (dist + BACK) / cam;
  return { x: GOAL.cx + PX_X * lateral * k, y: HORIZON + PX_Y * (HEIGHT - point.y) * k, scale: k };
}
export const fkBall = (setup: FreeKickSetup) => fkProject(setup, { x: Math.sin(setup.angle) * setup.distance, y: 0.11, z: 0 });

const WALL_CAST: KeeperId[] = ["sumo", "robot", "octopus", "mime", "disco", "squirrel", "sloth", "peacock", "mouse", "chameleon", "ghost"];

/** The wall: 3–5 original characters shoulder to shoulder; they jump on the engine's timing. */
export function drawWall(c: CanvasRenderingContext2D, setup: FreeKickSetup, wall: { x: number; halfWidth: number } | null, sinceStrike: number | null, reduced: boolean) {
  if (!wall) return;
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance;
  const t = WALL_DISTANCE / setup.distance, z = depth * t;
  const jump = sinceStrike !== null && sinceStrike >= setup.wallJumpAt ? Math.sin(clamp01((sinceStrike - setup.wallJumpAt) / 0.5) * Math.PI) * 0.38 : 0;
  const width = (wall.halfWidth * 2) / setup.wallSize;
  for (let i = 0; i < setup.wallSize; i++) {
    const wx = wall.x - wall.halfWidth + width * (i + 0.5);
    const feet = fkProject(setup, { x: wx, y: jump, z }), head = fkProject(setup, { x: wx, y: 1.85 + jump, z });
    const id = WALL_CAST[(setup.seed + i * 3) % WALL_CAST.length], design = KEEPER_DESIGNS[id];
    const body = sprite(`keeper-${id}`, design.rows, design.palette);
    const scale = (feet.y - head.y) / body.height;
    // Shadow stays on the ground while they jump.
    const ground = fkProject(setup, { x: wx, y: 0, z });
    c.fillStyle = "#00000044"; c.beginPath(); c.ellipse(ground.x, ground.y, body.width * scale * 0.4, 3, 0, 0, Math.PI * 2); c.fill();
    drawSprite(c, body, feet.x, feet.y, { scale, sy: jump > 0.05 && !reduced ? 1.04 : 1 });
    // Hands protecting (arms up when airborne).
    c.fillStyle = design.glove;
    const hy = jump > 0.05 ? head.y - 2 : feet.y - (feet.y - head.y) * 0.45;
    c.fillRect(Math.round(feet.x - body.width * scale * 0.3), Math.round(hy), 3, 3); c.fillRect(Math.round(feet.x + body.width * scale * 0.3 - 3), Math.round(hy), 3, 3);
  }
  void x0;
}

/** Ball position along an engine flight path at time t (interpolated). */
export function pathAt(path: readonly FlightSample[], t: number): FlightSample {
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) if (path[i].t >= t) {
    const a = path[i - 1], b = path[i], k = (t - a.t) / (b.t - a.t || 1);
    return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
  }
  return path[path.length - 1];
}

/** Dotted predicted path (trajectory preview), faded by the assist level. */
export function drawPreview(c: CanvasRenderingContext2D, setup: FreeKickSetup, path: readonly FlightSample[], alpha: number) {
  if (alpha <= 0.02) return;
  c.fillStyle = `rgba(255,255,255,${0.7 * alpha})`;
  for (let i = 1; i < path.length; i += 1) { const p = fkProject(setup, path[i]); c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2); }
}

/** Wind flag: waving in the wind's direction with its strength. Outdoor stadiums only. */
export function drawWind(c: CanvasRenderingContext2D, wind: number, time: number, reduced: boolean) {
  if (!wind) return;
  const x = 444, y = 132, dir = Math.sign(wind), strength = Math.min(1, Math.abs(wind) / 6);
  c.fillStyle = "#e8e8e8"; c.fillRect(x, y, 2, 34);
  const wave = reduced ? 0 : Math.sin(time * (4 + strength * 8));
  c.fillStyle = "#ff5a6e";
  for (let i = 0; i < 6; i++) { const fx = x + 1 + dir * i * (2 + strength * 2), fy = y + 1 + Math.round(wave * (1 - strength) * i * 0.6 + (1 - strength) * i * 1.2); c.fillRect(Math.min(fx, fx + dir * 3), fy, 3, 5); }
  c.fillStyle = "#0b0d1acc"; c.fillRect(x - 22, y + 36, 46, 11);
  c.fillStyle = "#f7f7f2"; c.font = "8px PixelifySans, monospace"; c.textBaseline = "top";
  c.fillText(`${dir < 0 ? "←" : ""}${Math.abs(wind).toFixed(1)} m/s${dir > 0 ? "→" : ""}`, x - 20, y + 38); c.textBaseline = "alphabetic";
}

const ZONE_COLOURS: Record<Zone, string> = { centre: "#9aa3ad", side: "#7fd3ff", corner: "#ccff00", bin: "#ffd23f" };
/** Tutorial overlay: the scoring zones on the goal with their multipliers. */
export function drawZoneHints(c: CanvasRenderingContext2D, alpha: number) {
  if (alpha <= 0.02) return;
  const cell = (x1: number, x2: number, y1: number, y2: number, zone: Zone, label: string) => {
    const a = toScreen(x1, y2), b = toScreen(x2, y1);
    c.fillStyle = ZONE_COLOURS[zone] + Math.round(40 * alpha).toString(16).padStart(2, "0"); c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    c.fillStyle = `rgba(255,255,255,${0.9 * alpha})`; c.font = "8px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(label, (a.x + b.x) / 2, (a.y + b.y) / 2); c.textAlign = "left"; c.textBaseline = "alphabetic";
  };
  for (const side of [-1, 1]) {
    const [o1, o2] = side < 0 ? [-1, -0.66] : [0.66, 1], [s1, s2] = side < 0 ? [-0.66, -0.34] : [0.34, 0.66];
    cell(o1, o2, 0.66, 1, "bin", "×5"); cell(o1, o2, 0, 0.66, "corner", "×3"); cell(s1, s2, 0, 1, "side", "×2");
  }
  cell(-0.34, 0.34, 0, 1, "centre", "×1");
}

/** Target practice: rings on the goal plane, labelled with their value. */
export function drawTargets(c: CanvasRenderingContext2D, targets: ReadonlyArray<{ x: number; y: number; r: number; value: number; hit?: boolean }>, time: number, reduced: boolean) {
  for (const target of targets) {
    const centre = toScreen(target.x, target.y), rx = target.r * GOAL.unit, ry = target.r * GOAL.unit * 0.89;
    const pulse = reduced ? 0 : Math.sin(time * 6 + target.x * 3) * 1.5;
    c.fillStyle = target.hit ? "#ffffff88" : target.value === 5 ? "#ffd23f55" : target.value === 2 ? "#7fd3ff44" : "#ffffff33";
    c.beginPath(); c.ellipse(centre.x, centre.y, rx + pulse, ry + pulse, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = target.value === 5 ? "#ffd23f" : "#ffffff"; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.ellipse(centre.x, centre.y, rx * 0.45, ry * 0.45, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#0b0d1a"; c.font = "bold 8px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(`×${target.value}`, centre.x, centre.y); c.textAlign = "left"; c.textBaseline = "alphabetic";
  }
}
export function drawCrossbarGlow(c: CanvasRenderingContext2D, time: number) {
  const a = toScreen(-1, 1), b = toScreen(1, 1);
  c.fillStyle = `rgba(255,210,63,${0.25 + 0.15 * Math.sin(time * 5)})`; c.fillRect(a.x, a.y - 3, b.x - a.x, 5);
}

/** Shot clock: a ring around the ball that drains; red in the last 1.5 s. */
export function drawClock(c: CanvasRenderingContext2D, x: number, y: number, left: number, total: number, time: number) {
  const fraction = clamp01(left / total), urgent = left < 1.5;
  c.strokeStyle = "#00000066"; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = urgent ? (Math.floor(time * 8) % 2 ? "#ff5a6e" : "#ffffff") : "#ccff00";
  c.beginPath(); c.arc(x, y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction); c.stroke();
  c.fillStyle = "#f7f7f2"; c.font = "bold 8px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(String(Math.ceil(left)), x + 18, y - 10); c.textAlign = "left"; c.textBaseline = "alphabetic";
  void ease;
}
