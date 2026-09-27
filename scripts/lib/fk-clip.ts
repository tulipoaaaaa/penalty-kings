// Free-kick clip harness (bundled by scripts/record-freekicks.mjs; never part of site/). It renders the SAME
// Stage the game uses, in full motion, and plays three fixed free kicks (18 m, 25 m, 32 m) through the real
// engine (resolveFreeKick with the shot the keyboard/swipe mapping produces), on a real-time clock, so the
// on-screen flight time is the engine's. window.__fkClip reports each kick (distance, engine flight time,
// on-screen flight time, result).
import { keeperById, resolveFreeKick, freeKickSetup, WALL_HEIGHTS, type FreeKickSetup } from "@penalty-kings/engine";
import { Stage } from "../../games/penalty-kings/gfx/stage.js";
import { W, H } from "../../games/penalty-kings/gfx/core.js";
import { keyFreeKick } from "../../games/penalty-kings/game/input.js";

type Kick = { distance: number; angle: number; wallSize: 3 | 4 | 5; seed: number; aim: { aimX: number; aimY: number; power: number; curl: number; top: number } };
const KICKS: Kick[] = [
  { distance: 18, angle: 0.2, wallSize: 4, seed: 1801, aim: { aimX: -0.6, aimY: 0.8, power: 0.55, curl: 0, top: 0.4 } },
  { distance: 25, angle: -0.15, wallSize: 5, seed: 2501, aim: { aimX: 0.5, aimY: 0.85, power: 0.6, curl: 0, top: 0.5 } },
  { distance: 32, angle: 0.05, wallSize: 4, seed: 3201, aim: { aimX: -0.5, aimY: 0.85, power: 0.7, curl: 0, top: 0.5 } },
];
const canvas = document.querySelector("canvas")!, context = canvas.getContext("2d")!, caption = document.querySelector("#caption")!;
canvas.width = W; canvas.height = H;
const stage = new Stage({ stadium: "pro", weather: "sun", keeper: "squirrel" });
stage.friendName = "Striker";
const report: Array<Record<string, unknown>> = [];
const state = { report, done: false };
(window as unknown as { __fkClip: typeof state }).__fkClip = state;
let index = -1, phase: "aim" | "shot" = "aim", phaseT = 0, strikeReal = 0;
let current: { setup: FreeKickSetup; outcome: ReturnType<typeof resolveFreeKick> } | null = null;
stage.onEvent = (event, data) => {
  if (event === "strike") strikeReal = performance.now();
  if (event === "resolved" && current) {
    const screenFlight = (performance.now() - strikeReal) / 1000;
    const row = { distance: current.setup.distance, engineFlight: +current.outcome.target.time.toFixed(3), screenFlight: +screenFlight.toFixed(3), result: String(data) };
    report.push(row);
    caption.textContent = `${row.distance} m · flight ${row.engineFlight.toFixed(2)} s (engine) / ${row.screenFlight.toFixed(2)} s (on screen) · ${row.result.toUpperCase()}`;
  }
};
function next() {
  index++;
  if (index >= KICKS.length) { state.done = true; return; }
  const k = KICKS[index], keeper = keeperById("squirrel");
  const setup = { ...freeKickSetup(k.seed, { distance: k.distance, angle: k.angle, wallSize: k.wallSize, wallHeight: WALL_HEIGHTS.pro }), wind: 0 };
  const shot = keyFreeKick(k.aim, setup), outcome = resolveFreeKick(setup, shot, keeper);
  current = { setup, outcome };
  stage.cancel(); stage.kind = "freekick"; stage.ballVisible = true;
  stage.freeKick = { setup, wall: outcome.wall };
  stage.preview = { path: outcome.path, alpha: 1 };
  caption.textContent = `Free kick ${index + 1}/3 · ${k.distance} m`;
  phase = "aim"; phaseT = 0;
}
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; phaseT += dt;
  if (phase === "aim" && phaseT > 0.9 && current) { stage.playFreeKick(current.outcome); phase = "shot"; phaseT = 0; }
  else if (phase === "shot" && current && phaseT > 0.4 + current.outcome.target.time + 1.35) next();
  stage.update(dt); stage.render(context);
  requestAnimationFrame(frame);
}
next();
requestAnimationFrame(frame);
