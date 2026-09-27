/**
 * Set-piece rendering: the free-kick camera, pitch markings in perspective, the wall, the wind
 * flag, target-practice targets, zone hints and the shot-clock ring.
 *
 * Free-kick camera: a fixed broadcast camera 14 m behind the ball, 3.6 m up, on the line from the
 * ball to the centre of the goal. The goal really shrinks with distance (≈120 px wide at 18 m,
 * ≈100 px at 25 m, ≈85 px at 32 m, versus 180 px for a penalty): the whole goal group (net, keeper,
 * frame) is drawn through goalTransform(), which is exactly consistent with fkProject().
 */
import { GOAL_HALF_WIDTH, GOAL_HEIGHT, WALL_DISTANCE, JUMP_HEIGHT, JUMP_TIME, type FreeKickSetup, type FlightSample, type Zone } from "@penalty-kings/engine";
import { sprite, clamp01, ease } from "./core.js";
import { GOAL, toScreen, CAM_FX, CAM_FY, PENALTY_CAMERA, type PitchCamera } from "./stadium.js";

const FX = CAM_FX, FY = CAM_FY;
/** Free-kick broadcast camera: 14 m behind the ball, 3.6 m up. */
export const FK_CAMERA: PitchCamera = { back: 14, height: 3.6, horizon: 101 };
export { PENALTY_CAMERA };
/** The penalty spot as a "setup" for the shared projection: 11 m straight out from the goal. */
export const PENALTY_SETUP: FreeKickSetup = { distance: 11, angle: 0, wallSize: 3, wallHeight: 1.8, wallJumpAt: 0, wind: 0, seed: 0 };
/** Pitch: 68 m wide (touchlines at x = ±34 m). */
export const HALF_PITCH_WIDTH = 34;

export type Projected = { x: number; y: number; scale: number; pxPerM: number };

function frame(setup: FreeKickSetup) {
  const x0 = Math.sin(setup.angle) * setup.distance, depth = Math.cos(setup.angle) * setup.distance, dist = setup.distance;
  return { x0, depth, dist, ux: -x0 / dist, uz: depth / dist, nx: depth / dist, nz: x0 / dist };
}

/** World point (metres on the pitch: x across the goal line, y up, z from the ball's line towards goal) → screen. */
export function fkProject(setup: FreeKickSetup, point: { x: number; y: number; z: number }, camera: PitchCamera = FK_CAMERA): Projected {
  const f = frame(setup), rx = point.x - f.x0, rz = point.z;
  const forward = rx * f.ux + rz * f.uz, lateral = rx * f.nx + rz * f.nz;
  const cam = Math.max(0.5, forward + camera.back);
  return { x: GOAL.cx + (FX * lateral) / cam, y: camera.horizon + (FY * (camera.height - point.y)) / cam, scale: (setup.distance + camera.back) / cam, pxPerM: FX / cam };
}
export const fkBall = (setup: FreeKickSetup, camera: PitchCamera = FK_CAMERA) => fkProject(setup, { x: Math.sin(setup.angle) * setup.distance, y: 0.11, z: 0 }, camera);
/** Metres from the goal line along the centre line for a screen y (inverse projection, for tests). */
export function unprojectDepth(setup: FreeKickSetup, screenY: number, camera: PitchCamera) {
  const cam = (FY * camera.height) / (screenY - camera.horizon);
  return setup.distance + camera.back - cam;
}

/** Where the penalty-view goal art (centre-bottom at GOAL.cx, GOAL.line) lands, and its scale, for this camera. */
export function goalTransform(setup: FreeKickSetup, camera: PitchCamera = FK_CAMERA) {
  const cam = setup.distance + camera.back;
  return { g: (FX * GOAL_HALF_WIDTH) / (cam * GOAL.unit), x: GOAL.cx, y: camera.horizon + (FY * camera.height) / cam };
}

/** Corner flags exist only where the goal line meets a touchline, and are drawn only when that point is on screen. */
export function cornerFlags(setup: FreeKickSetup, camera: PitchCamera = FK_CAMERA) {
  const depth = Math.cos(setup.angle) * setup.distance;
  return [-HALF_PITCH_WIDTH, HALF_PITCH_WIDTH].map(x => fkProject(setup, { x, y: 0, z: depth }, camera)).filter(p => p.x >= 0 && p.x <= 480 && p.y >= 0 && p.y <= 320);
}
export const applyGoal = (xf: { g: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: xf.x + (p.x - GOAL.cx) * xf.g, y: xf.y + (p.y - GOAL.line) * xf.g });

/** Pitch markings in perspective: goal line, 6-yard box, penalty area, spot, the D, and the ref's vanishing spray. */
/** Every pitch marking in WORLD metres (x across, z from the ball's line; goal line at z = depth). Pure, for tests. */
export function pitchMarkingsWorld(setup: FreeKickSetup) {
  const gz = Math.cos(setup.angle) * setup.distance;
  const spot = { x: 0, z: gz - 11 };
  const dArc: Array<{ x: number; z: number }> = [];
  for (let a = 0; a <= 32; a++) { const t = -0.93 + (1.86 * a) / 32, x = Math.sin(t) * 9.15, z = spot.z - Math.cos(t) * 9.15; if (z < gz - 16.5) dArc.push({ x, z }); }
  return {
    goalLine: { z: gz }, sixYard: { z: gz - 5.5, halfWidth: 9.16 }, box: { z: gz - 16.5, halfWidth: 20.16 }, spot, dArc,
    corners: [{ x: -HALF_PITCH_WIDTH, z: gz }, { x: HALF_PITCH_WIDTH, z: gz }],
  };
}

export function drawPitchMarkings(c: CanvasRenderingContext2D, setup: FreeKickSetup, colour: string, wall: { x: number; halfWidth: number } | null, time: number, camera: PitchCamera = FK_CAMERA) {
  const f = frame(setup), gz = f.depth;
  const poly = (points: Array<[number, number]>, dashed = false) => {
    c.beginPath(); let started = false;
    for (const [x, z] of points) {
      const p = fkProject(setup, { x, y: 0, z }, camera);
      if (p.scale > 2.6 || p.y > 330) { started = false; continue; }
      started ? c.lineTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5) : c.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5); started = true;
    }
    if (dashed) c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);
  };
  const line = (x1: number, z1: number, x2: number, z2: number) => poly(Array.from({ length: 13 }, (_, i) => [x1 + ((x2 - x1) * i) / 12, z1 + ((z2 - z1) * i) / 12] as [number, number]));
  c.strokeStyle = colour; c.lineWidth = 1;
  line(-40, gz, 40, gz);
  line(-9.16, gz, -9.16, gz - 5.5); line(9.16, gz, 9.16, gz - 5.5); line(-9.16, gz - 5.5, 9.16, gz - 5.5);
  line(-20.16, gz, -20.16, gz - 16.5); line(20.16, gz, 20.16, gz - 16.5); line(-20.16, gz - 16.5, 20.16, gz - 16.5);
  poly(pitchMarkingsWorld(setup).dArc.map(p => [p.x, p.z] as [number, number]));
  const spot = fkProject(setup, { x: 0, y: 0, z: gz - 11 }, camera); c.fillStyle = colour;
  if (spot.y < 330) { const w = Math.max(3, Math.round(spot.pxPerM * 0.22)); c.fillRect(Math.round(spot.x - w / 2), Math.round(spot.y) + 1, w, Math.max(1, Math.round(w / 3))); }
  // Corner flags only at real corners, only when in view.
  for (const flag of cornerFlags(setup, camera)) { c.fillStyle = "#e8e8e8"; c.fillRect(Math.round(flag.x), Math.round(flag.y) - 14, 1, 14); c.fillStyle = "#ff5a6e"; c.fillRect(Math.round(flag.x) + 1, Math.round(flag.y) - 14, 5, 3); }
  // Vanishing spray: the 9.15 m line in front of the wall, and the ball's spot.
  if (wall) {
    const z = gz * (WALL_DISTANCE / setup.distance) - 0.35;
    c.strokeStyle = `rgba(255,255,255,${0.75 + 0.1 * Math.sin(time * 2)})`;
    poly(Array.from({ length: 16 }, (_, i) => [wall.x - wall.halfWidth - 0.9 + ((wall.halfWidth * 2 + 1.8) * i) / 15, z] as [number, number]), true);
    const ball = fkBall(setup); c.strokeStyle = "#ffffffaa"; c.beginPath(); c.ellipse(ball.x, ball.y + 3, 7, 2, 0, 0, Math.PI * 2); c.stroke();
  }
}

// ── The wall: pixel-art footballers (one team kit, cast-style animal heads) ──────────────
/** Heads 10 × 9 ('#' outline, 'a' main, 'b' secondary, 'e' eye, 'w' white, 'n' nose/mouth). */
const WALL_HEADS: ReadonlyArray<{ rows: string[]; palette: Record<string, string> }> = [
  { rows: [".##....##.", "#aa#..#aa#", "#aaaaaaaa#", "#aaaaaaaa#", "#aewaawea#", "#aaaaaaaa#", "#aaabbaaa#", ".#aannaa#.", "..######.."], palette: { a: "#8d5a2b", b: "#d9a066", e: "#111111", w: "#ffffff", n: "#3b2414" } }, // bear
  { rows: ["#a#....#a#", "#aa#..#aa#", "#aaaaaaaa#", "#aaaaaaaa#", "#aeaaaaea#", "#aaaaaaaa#", "#aaanaaaa#", ".#abbbba#.", "..######.."], palette: { a: "#f2a33a", b: "#fff2d6", e: "#1f7a1f", w: "#ffffff", n: "#ff8fab" } }, // cat
  { rows: [".##....##.", "#we#..#we#", "#aaaaaaaa#", "#aaaaaaaa#", "#aaaaaaaa#", "#annnnnna#", "#aaaaaaaa#", ".#bbbbbb#.", "..######.."], palette: { a: "#4caf50", b: "#a5d66f", e: "#111111", w: "#ffffff", n: "#1b5e20" } }, // frog
  { rows: ["....##....", "...#bb#...", ".########.", "#aaaaaaaa#", "#awwwwwwa#", "#aweewewa#", "#aaaaaaaa#", "#abababa.#", ".########."], palette: { a: "#9aa3ad", b: "#ff5a6e", e: "#ff5a6e", w: "#0b0d1a", n: "#111111" } }, // robot
  { rows: ["##......##", "#b#....#b#", "#aa####aa#", "#aaaaaaaa#", "#aewaawea#", "#aaaaaaaa#", "#aaaanaaa#", ".#aaaaaa#.", "..######.."], palette: { a: "#b9c2cc", b: "#ff8fab", e: "#111111", w: "#ffffff", n: "#ff5a6e" } }, // mouse
  { rows: ["#b#....#b#", "#bb#..#bb#", "#aaaaaaaa#", "#aaaaaaaa#", "#aeaaaaea#", "#aaaaaaaa#", "#aaannaaa#", ".#aawwaa#.", "..######.."], palette: { a: "#c9a36b", b: "#6b4a2b", e: "#111111", w: "#ff8fab", n: "#111111" } }, // dog
];
/** Bodies 10 wide: 'k' shirt, 'K' shirt shade, 'c' crest, 's' shorts, 'o' socks, 'b' boots, 'h' hands, '#' outline. */
const BODY_PROTECT = [
  "..######..", ".#kkkkkk#.", "#kkkkkkkk#", "#kKkkkkck#", "#kKkkkkkk#", "#kKkkkkkk#", "#kK#hh#kk#", ".#k#hh#k#.",
  ".#ssssss#.", ".#ssssss#.", ".#ss##ss#.", "..#o##o#..", "..#o##o#..", "..#o##o#..", "..#o##o#..", ".#bb##bb#.", ".########.",
];
const BODY_JUMP = [
  "#h######h#", "#k#kkkk#k#", "#k#kkkk#k#", "#kkkkkkck#", "#kKkkkkkk#", ".#Kkkkkk#.", ".#kkkkkk#.", ".#ssssss#.",
  ".#ssssss#.", "#ss#..#ss#", "#oo#..#oo#", "#bb#..#bb#", "####..####",
];
const KITS: Record<string, { k: string; K: string; c: string; s: string; o: string; b: string }> = {
  park: { k: "#d62839", K: "#9e1b2a", c: "#ffd23f", s: "#ffffff", o: "#d62839", b: "#111111" },
  pro: { k: "#16181f", K: "#0b0d12", c: "#ccff00", s: "#16181f", o: "#ccff00", b: "#ffffff" },
  champions: { k: "#1d3557", K: "#12233b", c: "#ffd23f", s: "#ffffff", o: "#1d3557", b: "#111111" },
};
/** Sock rows are added or removed so every wall height is drawn exactly at an integer pixel scale. */
function wallSprite(head: number, jumping: boolean, kit: string, legs = 0) {
  const h = WALL_HEADS[head % WALL_HEADS.length], k = KITS[kit] ?? KITS.park;
  const body = jumping ? BODY_JUMP : [...BODY_PROTECT.slice(0, 11), ...Array.from({ length: Math.max(1, 4 + legs) }, () => "..#o##o#.."), ...BODY_PROTECT.slice(15)];
  const rows = [...h.rows.map(row => row.replace(/[abewn]/g, ch => ({ a: "1", b: "2", e: "3", w: "4", n: "5" })[ch]!)), ...body];
  const palette = { "#": "#0b0d1a", "1": h.palette.a, "2": h.palette.b, "3": h.palette.e, "4": h.palette.w, "5": h.palette.n, k: k.k, K: k.K, c: k.c, s: k.s, o: k.o, b: k.b, h: h.palette.a };
  return sprite(`wall-${head}-${jumping ? "j" : "p"}-${kit}-${legs}`, rows, palette);
}

/** Rows of a standing wall sprite with no extra sock rows (head + body). */
export const WALL_BASE_ROWS = WALL_HEADS[0].rows.length + BODY_PROTECT.length;
/** Integer pixel scale + sock rows so a wall player's drawn height matches `target` px (its real height at the wall's depth). */
export function wallDrawScale(target: number) {
  const scale = Math.max(1, Math.floor(target / (WALL_BASE_ROWS - 3)));
  const legs = Math.max(-3, Math.min(4, Math.round(target / scale) - WALL_BASE_ROWS));
  return { scale, legs, height: (WALL_BASE_ROWS + legs) * scale };
}

/**
 * The wall: 3–5 players shoulder to shoulder in one team kit, 1.85 m tall at the wall's depth,
 * drawn at an integer pixel scale. They jump on the engine's timing (arms up, knees tucked) while
 * their shadows stay on the grass.
 */
export function drawWall(c: CanvasRenderingContext2D, setup: FreeKickSetup, wall: { x: number; halfWidth: number } | null, sinceStrike: number | null, reduced: boolean, kit = "park", time = 0) {
  if (!wall) return;
  const depth = Math.cos(setup.angle) * setup.distance, z = depth * (WALL_DISTANCE / setup.distance), height = setup.wallHeight ?? 1.85;
  const jump = sinceStrike !== null && sinceStrike >= setup.wallJumpAt ? Math.sin(clamp01((sinceStrike - setup.wallJumpAt) / JUMP_TIME) * Math.PI) * JUMP_HEIGHT : 0;
  const slot = (wall.halfWidth * 2) / setup.wallSize, jumping = jump > 0.06 && !reduced;
  const ground0 = fkProject(setup, { x: wall.x, y: 0, z }), head0 = fkProject(setup, { x: wall.x, y: height, z });
  const { scale, legs } = wallDrawScale(ground0.y - head0.y);
  c.imageSmoothingEnabled = false;
  // Draw outer players first so the middle ones overlap them (a tight, organised wall).
  const order = Array.from({ length: setup.wallSize }, (_, i) => i).sort((a, b) => Math.abs(b - (setup.wallSize - 1) / 2) - Math.abs(a - (setup.wallSize - 1) / 2));
  for (const i of order) {
    const wx = wall.x - wall.halfWidth + slot * (i + 0.5);
    const ground = fkProject(setup, { x: wx, y: 0, z }), lift = jumping ? Math.round((fkProject(setup, { x: wx, y: 0, z }).y - fkProject(setup, { x: wx, y: jump, z }).y)) : 0;
    const image = wallSprite((setup.seed + i * 5) % WALL_HEADS.length, jumping, kit, legs); // step 5 ⟂ 6 heads: all different
    const w = image.width * scale, h = image.height * scale;
    const shadow = 1 - Math.min(0.5, lift / 40);
    c.fillStyle = "#00000055"; c.beginPath(); c.ellipse(Math.round(ground.x), Math.round(ground.y), (w / 2) * shadow, Math.max(1, scale * 1.2) * shadow, 0, 0, Math.PI * 2); c.fill();
    // Idle life before the kick: a one-pixel breathing bob, out of step along the wall.
    const bob = sinceStrike === null && !reduced ? Math.round((Math.sin(time * 2.4 + i * 1.7) + 1) * 0.5) * Math.max(1, scale - 1) : 0;
    c.drawImage(image, Math.round(ground.x - w / 2), Math.round(ground.y - h - lift + bob), w, h);
  }
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

/** HUD wind label (the chip in the top-right cluster; flags on the stands show it too). */
export const windLabel = (wind: number) => (wind ? `${wind < 0 ? "←" : "→"} ${Math.abs(wind).toFixed(1)} m/s` : "no wind");

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
  // Telegraph: low shots down the middle meet the keeper's trailing leg (a boot sticking out).
  const leg = toScreen(0.12, 0.08);
  c.fillStyle = `rgba(17,17,17,${0.8 * alpha})`; c.fillRect(Math.round(leg.x) - 2, Math.round(leg.y) - 10, 4, 10); c.fillRect(Math.round(leg.x) - 2, Math.round(leg.y) - 2, 12, 4);
  c.fillStyle = `rgba(255,255,255,${0.9 * alpha})`; c.font = "7px PixelifySans, monospace"; c.textAlign = "center";
  c.fillText("leg!", leg.x + 4, leg.y - 13); c.textAlign = "left";
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
