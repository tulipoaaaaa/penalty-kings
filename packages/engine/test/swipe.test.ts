// Regression table for the gesture → shot mapping, on the round 6 penalty camera (goal unit 68 px,
// goal line y ≈ 210.3, bar 60.5 px above it, ball on the spot at y 250 of the 480×320 canvas).
// Gestures are recorded-style swipes in CSS px (the finger does not know the display scale): touch /
// mouse, slow / normal / fast, straight / diagonal / natural thumb arc, jitter and a sloppy lift-off,
// replayed on 360 / 800 / 960 CSS-px wide displays. They must land where they were aimed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  swipeToShot, shotTarget, shotZone, prng, resolveShot, keeperById, kickSeed, aimedShot, reticleTarget, aimWobble,
  DIFFICULTY_LADDER, CURL_DRIFT, OVERHIT, AIM_CEILING, AIM_LIFT_CSS, AIM_POST_DEG, KEEPERS,
  type SwipePoint, type InputKind, type Zone,
} from "../src/index.ts";

/** The penalty camera's goal face and spot (games/penalty-kings/gfx/stadium.ts, PENALTY_GOAL / SPOT). */
const LINE = 210.32519237203076;
const GOAL = { cx: 240, line: LINE, unitX: 68, unitY: 68 * 0.89 }, BALL = { x: 240, y: 250 };
/** CSS px per canvas unit for a 360 px phone, an 800 px tablet/laptop and a 960 px desktop frame. */
const DISPLAYS = { 360: 360 / 480, 800: 800 / 480, 960: 960 / 480 } as const;
type Display = keyof typeof DISPLAYS;
const DURATION = { slow: 400, normal: 220, fast: 120 } as const;
type Speed = keyof typeof DURATION;
type Shape = "straight" | "diagonal" | "arced";
const options = (display: Display, input: InputKind) => ({ width: 480, height: 320, pxPerUnit: DISPLAYS[display], input, goal: GOAL, ball: BALL });

/** Aimed targets per zone (goal units) and the zone the player intends. */
const AIMS: readonly { zone: Zone; x: number; y: number }[] = [
  { zone: "centre", x: 0, y: 0.5 },
  { zone: "side", x: -0.5, y: 0.4 }, { zone: "side", x: 0.5, y: 0.4 },
  { zone: "corner", x: -0.82, y: 0.3 }, { zone: "corner", x: 0.82, y: 0.3 },
  { zone: "bin", x: -0.8, y: 0.85 }, { zone: "bin", x: 0.8, y: 0.85 },
];

/**
 * The swipe (CSS px, up = positive) a player uses for a target: upward travel for the height and the
 * direction for across (they learn both from the WYSIWYG reticle, which shows the landing point live).
 */
function intendedSwipe(target: { x: number; y: number }) {
  const [lo, hi] = AIM_LIFT_CSS;
  const up = lo + (Math.min(target.y, AIM_CEILING) / AIM_CEILING) * (hi - lo);
  return { dx: Math.tan((target.x * AIM_POST_DEG * Math.PI) / 180) * up, up };
}

const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());

/**
 * A human swipe of `swipe` CSS px, recorded on a display with `px` CSS px per canvas unit. Noise: aim
 * direction (σ 2°), length (−15 … +25 %: people overshoot), 1.5 px finger jitter per sample, a skidding
 * last sample, the thumb starting anywhere on/under the ball. Diagonal: the thumb comes in from the side
 * (start offset 20–40 px, a 2.5° hand tilt the other way). Arced: a natural thumb arc under the curl dead-zone.
 */
function gesture(swipe: { dx: number; up: number }, px: number, speed: Speed, shape: Shape, seed: number, bend = 0, exact = false): SwipePoint[] {
  const random = prng(seed);
  const hand = random() < 0.5 ? -1 : 1;
  const tilt = (exact ? 0 : gauss(random)) * (2 * Math.PI / 180) + (shape === "diagonal" ? -hand * 2.5 * Math.PI / 180 : 0);
  const scale = exact ? 1 : 0.85 + random() * 0.4;
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  const vx = (swipe.dx * cos + swipe.up * sin) * scale, vy = (-swipe.dx * sin + swipe.up * cos) * scale; // CSS px, up positive
  const start = { x: BALL.x * px + (random() - 0.5) * 16 + (shape === "diagonal" ? hand * (20 + random() * 20) : 0), y: BALL.y * px + 8 + random() * 30 };
  const n = 14, duration = DURATION[speed] * (0.85 + random() * 0.3);
  const chord = Math.hypot(vx, vy) || 1, nx = vy / chord, ny = vx / chord;
  const arc = shape === "arced" ? 0.08 * hand : 0;
  const points: SwipePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, ease = speed === "fast" ? k : k * k * (3 - 2 * k), sag = Math.sin(Math.PI * k) * chord * (arc + bend);
    const cx = start.x + vx * ease + nx * sag + (random() - 0.5) * 3, cy = start.y - vy * ease + ny * sag + (random() - 0.5) * 3;
    points.push({ x: cx / px, y: cy / px, t: duration * k });
  }
  const last = points[n]; points[n] = { ...last, x: last.x + ((random() - 0.5) * 8) / px };
  return points;
}

const inZone = (landed: { x: number; y: number }, aim: { zone: Zone; x: number }) =>
  shotZone(landed) === aim.zone && (aim.zone === "centre" || Math.sign(landed.x) === Math.sign(aim.x)) && Math.abs(landed.x) < 0.93 && landed.y < 0.93;

test("regression matrix: 360/800/960 px × touch/mouse × slow/normal/fast × straight/diagonal/arced — ≥ 90 % in the aimed zone, 0 over the bar", () => {
  const rows: string[] = [];
  const zoneTotals = new Map<Zone, [number, number]>();
  const failures: string[] = [];
  let worst = 1, all = 0, hits = 0;
  for (const display of [360, 800, 960] as const) for (const input of ["touch", "mouse"] as const) for (const speed of ["slow", "normal", "fast"] as const) {
    const cells: string[] = [];
    for (const shape of ["straight", "diagonal", "arced"] as const) {
      let ok = 0, over = 0, total = 0;
      AIMS.forEach((aim, a) => {
        for (let seed = 1; seed <= 12; seed++) {
          const shot = swipeToShot(gesture(intendedSwipe(aim), DISPLAYS[display], speed, shape, seed * 131 + a * 17 + display), options(display, input))!;
          const landed = shotTarget(shot);
          total++;
          if (landed.y > 1) over++;
          const good = inZone(landed, aim);
          if (!good && process.env.SWIPE_DEBUG) console.log(display, input, speed, shape, aim, landed.x.toFixed(3), landed.y.toFixed(3));
          if (good) ok++;
          const z = zoneTotals.get(aim.zone) ?? [0, 0]; zoneTotals.set(aim.zone, [z[0] + (good ? 1 : 0), z[1] + 1]);
        }
      });
      if (over > 0) failures.push(`${display}/${input}/${speed}/${shape}: ${over} over the bar`);
      if (ok / total < 0.9) failures.push(`${display}/${input}/${speed}/${shape}: ${ok}/${total} in the aimed zone`);
      worst = Math.min(worst, ok / total); all += total; hits += ok;
      cells.push(`${shape} ${((100 * ok) / total).toFixed(0)}% (over ${over})`);
    }
    rows.push(`${display} px | ${input.padEnd(5)} | ${speed.padEnd(6)} | ${cells.join(" | ")}`);
  }
  console.log(["display | input | speed | straight | diagonal | arced", ...rows].join("\n"));
  console.log([...zoneTotals].map(([zone, [ok, n]]) => `${zone}: ${ok}/${n} (${((100 * ok) / n).toFixed(1)}%)`).join(", "), `| overall ${hits}/${all} (${((100 * hits) / all).toFixed(1)}%), worst cell ${(100 * worst).toFixed(1)}%`);
  assert.deepEqual(failures, []);
});

test("a normal 150–300 CSS-px flick never clears the bar, in any direction, on any display, at any speed", () => {
  const random = prng(99);
  for (const display of [360, 800, 960] as const) for (const input of ["touch", "mouse", "trackpad"] as const) for (const speed of ["slow", "normal", "fast"] as const) {
    for (let i = 0; i < 60; i++) {
      const length = 150 + random() * 150, angle = (random() * 2 - 1) * (50 * Math.PI / 180);
      const swipe = { dx: Math.sin(angle) * length, up: Math.cos(angle) * length };
      const shot = swipeToShot(gesture(swipe, DISPLAYS[display], speed, "straight", 5000 + i, 0, true), options(display, input))!;
      const landed = shotTarget(shot);
      assert.ok(shot.power <= OVERHIT + 1e-9, `${display}/${input}/${speed} ${length.toFixed(0)} px: power ${shot.power.toFixed(3)} is an overhit`);
      assert.ok(landed.y <= AIM_CEILING + 1e-9 && landed.y < 1, `${display}/${input}/${speed} ${length.toFixed(0)} px: y ${landed.y.toFixed(3)}`);
    }
  }
});

test("scale-free: the same CSS-px gesture gives the same shot on a 360, 800 and 960 px display", () => {
  for (const aim of AIMS) {
    const shots = ([360, 800, 960] as const).map(display => swipeToShot(gesture(intendedSwipe(aim), DISPLAYS[display], "normal", "straight", 11), options(display, "touch"))!);
    for (const shot of shots.slice(1)) for (const key of ["aimX", "aimY", "power", "curl"] as const) assert.ok(Math.abs(shot[key] - shots[0][key]) < 1e-9, `${aim.zone} ${key}`);
  }
});

test("extra length and speed are pace, not height; only a truly huge overhit rises", () => {
  const top = { dx: 0, up: 300 }, longer = { dx: 0, up: 420 };
  const normal = swipeToShot(gesture(top, 0.75, "normal", "straight", 3, 0, true), options(360, "touch"))!;
  const long = swipeToShot(gesture(longer, 0.75, "normal", "straight", 3, 0, true), options(360, "touch"))!;
  assert.ok(long.power > normal.power, "a longer flick in the same time has more pace");
  assert.equal(shotTarget(long).y, shotTarget(normal).y, "and the same height (saturated under the bar)");
  const slow = swipeToShot(gesture({ dx: 60, up: 180 }, 2, "slow", "straight", 4), options(960, "mouse"))!;
  const fast = swipeToShot(gesture({ dx: 60, up: 180 }, 2, "fast", "straight", 4), options(960, "mouse"))!;
  assert.ok(fast.power > slow.power && Math.abs(shotTarget(fast).y - shotTarget(slow).y) < 0.03, "faster flick: more pace, same height");
  // A truly huge overhit: 520 CSS px in ~80 ms.
  const huge = swipeToShot(gesture({ dx: 0, up: 520 }, 0.75, "fast", "straight", 5).map(p => ({ ...p, t: p.t * 0.65 })), options(360, "touch"))!;
  assert.ok(huge.power > OVERHIT && shotTarget(huge).y > 1, `huge overhit (${huge.power.toFixed(2)}) clears the bar`);
  assert.equal(shotTarget({ aimX: 0, aimY: 0.9, power: OVERHIT, curl: 0 }).y, 0.9, "no rise at the overhit threshold");
});

test("curl: natural thumb arcs (either hand) do not curl; a deliberate bend does; drift is capped", () => {
  for (let seed = 1; seed <= 30; seed++) assert.equal(swipeToShot(gesture(intendedSwipe({ x: 0.3, y: 0.5 }), 0.75, "normal", "arced", seed), options(360, "touch"))!.curl, 0, `seed ${seed}`);
  const bent = swipeToShot(gesture(intendedSwipe({ x: 0.3, y: 0.5 }), 0.75, "normal", "straight", 5, 0.35), options(360, "touch"))!;
  assert.ok(Math.abs(bent.curl) > 0.5, `deliberate bend curls (${bent.curl})`);
  const edge = shotTarget({ aimX: 0.95, aimY: 0.5, power: 0.6, curl: 1 });
  assert.ok(Math.abs(edge.x - 1) <= 0.05 && CURL_DRIFT <= 0.1, `max curl on an on-target aim lands within the post ± 0.05 (${edge.x})`);
});

test("WYSIWYG reticle: the reticle target equals the resolved outcome target for the same inputs (wobble + assist)", () => {
  const random = prng(21);
  for (let i = 0; i < 400; i++) {
    const raw = { aimX: (random() * 2 - 1) * 1.3, aimY: random() * 1.2, power: 0.35 + random() * 0.65, curl: random() < 0.5 ? 0 : random() * 2 - 1 };
    const difficulty = DIFFICULTY_LADDER[i % DIFFICULTY_LADDER.length];
    const wobble = aimWobble(random() * 10, difficulty.wobble * 1.4), assist = [0, difficulty.assist, 0.45, 1][i % 4];
    const keeper = KEEPERS[i % KEEPERS.length];
    const shown = reticleTarget(raw, wobble, assist);
    const outcome = resolveShot(aimedShot(raw, wobble, assist), keeperById(keeper.id), kickSeed(3, i, keeper.id), { kickIndex: i % 5, history: [] }, difficulty);
    assert.deepEqual(shown, outcome.target, `case ${i}`);
  }
});
