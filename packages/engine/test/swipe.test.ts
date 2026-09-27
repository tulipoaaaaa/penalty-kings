// Regression table for the gesture → shot mapping: realistic recorded-style swipes (touch / mouse /
// trackpad, slow / normal / fast, straight / diagonal / natural thumb arc, jitter and a sloppy
// lift-off) must land where they were aimed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeToShot, shotTarget, shotZone, prng, CURL_DRIFT, OVERHIT, type SwipePoint, type InputKind } from "../src/index.ts";

const GOAL = { cx: 240, line: 176, unitX: 90, unitY: 80 }, BALL = { x: 240, y: 220 };
const DURATION = { slow: 400, normal: 200, fast: 100 } as const;
/** Display scale: a 360 px phone frame vs a 960 px desktop frame over the 480-unit canvas. */
const PX_PER_UNIT: Record<InputKind, number> = { touch: 0.75, mouse: 2, trackpad: 2 };

function gesture(target: { x: number; y: number }, input: InputKind, speed: keyof typeof DURATION, shape: "straight" | "diagonal" | "arced", seed: number, bend = 0): SwipePoint[] {
  const random = prng(seed);
  const start = { x: BALL.x + (random() - 0.5) * 12, y: BALL.y + 10 + random() * 30 };
  const aim = { x: GOAL.cx + target.x * GOAL.unitX, y: GOAL.line - target.y * GOAL.unitY };
  const end = { x: start.x + (aim.x - BALL.x), y: start.y + (aim.y - BALL.y) };
  const n = 12, duration = DURATION[speed] * (0.85 + random() * 0.3);
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  const hand = random() < 0.5 ? -1 : 1; // left- or right-handed thumb
  const arc = shape === "arced" ? 0.08 * hand : 0; // natural thumb arc: under the curl dead-zone
  const points: SwipePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, ease = speed === "fast" ? k : k * k * (3 - 2 * k);
    const nx = -(end.y - start.y) / chord, ny = (end.x - start.x) / chord, sag = Math.sin(Math.PI * k) * chord * (arc + bend);
    points.push({ x: start.x + (end.x - start.x) * ease + nx * sag + (random() - 0.5) * 3, y: start.y + (end.y - start.y) * ease + ny * sag + (random() - 0.5) * 3, t: duration * k });
  }
  // Sloppy lift-off: the last sample skids sideways.
  const last = points[n]; points[n] = { ...last, x: last.x + (random() - 0.5) * 10 };
  return points;
}
const options = (input: InputKind) => ({ width: 480, height: 320, pxPerUnit: PX_PER_UNIT[input], input, goal: GOAL, ball: BALL });

test("aimed top-left corner: every input, speed and shape lands in the left corner zone ≥ 90%, never over", () => {
  for (const input of ["touch", "mouse", "trackpad"] as const) for (const speed of ["slow", "normal", "fast"] as const) for (const shape of ["straight", "diagonal", "arced"] as const) {
    let corner = 0, over = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const shot = swipeToShot(gesture({ x: -0.8, y: shape === "diagonal" ? 0.75 : 0.55 }, input, speed, shape, seed * 97), options(input))!;
      const target = shotTarget(shot);
      if (target.y > 1) over++;
      if (target.x < 0 && (shotZone(target) === "corner" || shotZone(target) === "bin") && target.x >= -1 && target.y <= 1) corner++;
    }
    assert.equal(over, 0, `${input}/${speed}/${shape}: ${over} over the bar`);
    assert.ok(corner >= 36, `${input}/${speed}/${shape}: ${corner}/40 in the corner`);
  }
});

test("100–400 ms flicks aimed on target stay on target", () => {
  const random = prng(7);
  let on = 0, total = 0;
  for (const input of ["touch", "mouse", "trackpad"] as const) for (const speed of ["slow", "normal", "fast"] as const) for (let i = 0; i < 60; i++) {
    const target = { x: (random() * 2 - 1) * 0.8, y: 0.15 + random() * 0.7 };
    const landed = shotTarget(swipeToShot(gesture(target, input, speed, "straight", 1000 + i), options(input))!);
    total++; if (Math.abs(landed.x) <= 1 && landed.y <= 1) on++;
  }
  assert.ok(on / total >= 0.97, `${on}/${total} on target`);
});

test("pace comes from speed (not height); only an extreme overhit rises", () => {
  const slow = swipeToShot(gesture({ x: 0.5, y: 0.5 }, "touch", "slow", "straight", 3), options("touch"))!;
  const fast = swipeToShot(gesture({ x: 0.5, y: 0.5 }, "touch", "fast", "straight", 3), options("touch"))!;
  assert.ok(fast.power > slow.power, "faster flick, more pace");
  assert.ok(Math.abs(shotTarget(fast).y - shotTarget(slow).y) < 0.08, "same aim, same height");
  assert.ok(shotTarget({ aimX: 0, aimY: 0.9, power: 1, curl: 0 }).y > 1, "a full-power overhit aimed high clears the bar");
  assert.equal(shotTarget({ aimX: 0, aimY: 0.9, power: OVERHIT, curl: 0 }).y, 0.9, "no rise below the overhit threshold");
});

test("curl: natural thumb arcs (either hand) do not curl; a deliberate bend does; drift is capped", () => {
  for (let seed = 1; seed <= 30; seed++) assert.equal(swipeToShot(gesture({ x: 0.3, y: 0.5 }, "touch", "normal", "arced", seed), options("touch"))!.curl, 0, `seed ${seed}`);
  const bent = swipeToShot(gesture({ x: 0.3, y: 0.5 }, "touch", "normal", "straight", 5, 0.35), options("touch"))!;
  assert.ok(Math.abs(bent.curl) > 0.5, `deliberate bend curls (${bent.curl})`);
  const edge = shotTarget({ aimX: 0.95, aimY: 0.5, power: 0.6, curl: 1 });
  assert.ok(Math.abs(edge.x - 1) <= 0.05 && CURL_DRIFT <= 0.1, `max curl on an on-target aim lands within the post ± 0.05 (${edge.x})`);
});

test("the same gesture gives the same aim on a phone and a desktop (WYSIWYG, scale-free)", () => {
  const phone = swipeToShot(gesture({ x: -0.5, y: 0.6 }, "touch", "normal", "straight", 11), options("touch"))!;
  const desk = swipeToShot(gesture({ x: -0.5, y: 0.6 }, "mouse", "normal", "straight", 11), options("mouse"))!;
  assert.ok(Math.abs(phone.aimX - desk.aimX) < 1e-9 && Math.abs(phone.aimY - desk.aimY) < 1e-9);
});
