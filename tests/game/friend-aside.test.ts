import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, NEUTRAL, resolveShot, kickSeed, prng, freeKickSetup, type ShotOutcome } from "@penalty-kings/engine";
import { GOAL, PENALTY_GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { applyGoal } from "../../games/penalty-kings/gfx/setpieces.ts";
import { Stage, penaltyFlight } from "../../games/penalty-kings/gfx/stage.ts";
import { PENALTY_VIEW, freeKickView, plantSpot, legFrame, STRIKE_AT, friendAside, FRIEND_FLIGHT_ALPHA, FRIEND_RESTORE_AFTER, FRIEND_HOLD_AFTER, type KickView } from "../../games/penalty-kings/gfx/kick.ts";

// B11: after the strike the big foreground Friend fades to ~45 % and eases a few whole pixels aside for the ball's
// flight (it hid the left third of the goal: the arrival and the keeper's save there). Polish: it stays faded and
// aside through the payoff (the net ripple, the keeper's reaction) until 400 ms after the crossing, then eases back
// over 250 ms: full opacity and its planted spot 650 ms after the crossing, before the goal celebration (+1.0 s).
// The reaction beat (miss/save/post) still starts at +0.1 s; its pose plays under the fade. Layering only: the
// sprite and kickPose are untouched.

const VIEWS: Array<[string, KickView]> = [["penalty", PENALTY_VIEW], ["free kick 24 m", freeKickView(freeKickSetup(5, { distance: 24, angle: 0.2, wallSize: 4 }))]];
/** Penalty flights span 0.35–0.55 s; free kicks fly on the engine's clock (≈ 0.6–1.6 s). */
const FLIGHTS = [penaltyFlight(0.4), penaltyFlight(0.7), penaltyFlight(0.95), 0.8, 1.2, 1.6];
const DT = 1 / 120;

test("friendAside: full opacity and no offset before and at contact, through the contact frame", () => {
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale;
    for (const flight of FLIGHTS) for (const reduced of [false, true]) {
      for (let since = -STRIKE_AT; since <= 0.05; since += DT) {
        assert.deepEqual(friendAside(since, flight, scale, reduced), { alpha: 1, dx: 0, dy: 0 }, `${name} ${flight}s: ${since.toFixed(3)} s after contact`);
        if (since >= 0) assert.equal(legFrame(STRIKE_AT + since), "contact", "the fade never starts inside the contact frame");
      }
    }
  }
});

test("friendAside: eases to ≤ 0.5 alpha during the flight, holding through the crossing, whole-pixel offsets aside", () => {
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale;
    for (const flight of FLIGHTS) {
      const mid = friendAside(flight / 2 + 0.1, flight, scale), crossing = friendAside(flight, flight, scale);
      for (const [when, a] of [["mid-flight", mid], ["crossing", crossing]] as const) {
        assert.ok(a.alpha <= 0.5 && a.alpha >= FRIEND_FLIGHT_ALPHA - 1e-9, `${name} ${flight}s ${when}: alpha ${a.alpha.toFixed(2)}`);
        assert.ok(a.dx < 0 && a.dy > 0, `${name} ${flight}s ${when}: eased aside (left, down) ${a.dx},${a.dy}`);
        assert.ok(Math.abs(a.dx) <= 16 && a.dy <= 6, `${name}: only a few px (${a.dx},${a.dy})`);
      }
      // Eased: no step bigger than a couple of px or 0.12 alpha between 1/120 s samples, and monotone out then back.
      let prev = friendAside(0, flight, scale);
      for (let since = 0; since <= flight + FRIEND_RESTORE_AFTER + 0.1; since += DT) {
        const a = friendAside(since, flight, scale);
        assert.ok(Number.isInteger(a.dx) && Number.isInteger(a.dy), `${name}: whole pixels at ${since.toFixed(3)}`);
        assert.ok(Math.abs(a.dx - prev.dx) <= 2 && Math.abs(a.dy - prev.dy) <= 1 && Math.abs(a.alpha - prev.alpha) <= 0.12, `${name} ${flight}s: smooth at ${since.toFixed(3)}`);
        prev = a;
      }
    }
  }
});

test("friendAside: held faded and aside through the payoff, until 400 ms after the crossing", () => {
  assert.equal(FRIEND_HOLD_AFTER, 0.4); assert.equal(FRIEND_RESTORE_AFTER, 0.65);
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale, full = friendAside(1, 2, scale); // a long flight: fully out
    for (const flight of FLIGHTS) {
      for (let since = flight; since <= flight + FRIEND_HOLD_AFTER; since += DT) {
        const a = friendAside(since, flight, scale);
        assert.ok(a.alpha <= 0.5, `${name} ${flight}s: still faded ${((since - flight) * 1000).toFixed(0)} ms after the crossing (${a.alpha.toFixed(2)})`);
        assert.deepEqual([a.dx, a.dy], [full.dx, full.dy], `${name} ${flight}s: still aside ${((since - flight) * 1000).toFixed(0)} ms after the crossing`);
        const r = friendAside(since, flight, scale, true);
        assert.deepEqual(r, { alpha: FRIEND_FLIGHT_ALPHA, dx: 0, dy: 0 }, `${name}: reduced motion holds the static fade`);
      }
      // Then eases back over ~250 ms (not a snap): part-way at +525 ms.
      const mid = friendAside(flight + 0.525, flight, scale);
      assert.ok(mid.alpha > FRIEND_FLIGHT_ALPHA + 0.1 && mid.alpha < 0.95, `${name} ${flight}s: easing back at +525 ms (${mid.alpha.toFixed(2)})`);
    }
  }
});

test("friendAside: back to full opacity and the planted spot 650 ms after the crossing (before any celebration)", () => {
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale;
    for (const flight of FLIGHTS) for (const reduced of [false, true]) {
      for (const since of [flight + FRIEND_RESTORE_AFTER, flight + 0.8, flight + 1.0, flight + 1.3, 99]) {
        assert.deepEqual(friendAside(since, flight, scale, reduced), { alpha: 1, dx: 0, dy: 0 }, `${name} ${flight}s reduced=${reduced}: restored at ${since.toFixed(2)}`);
      }
    }
  }
});

test("friendAside, reduced motion: no positional movement, only a static fade for the flight", () => {
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale;
    for (const flight of FLIGHTS) {
      for (let since = -STRIKE_AT; since <= flight + FRIEND_RESTORE_AFTER + 0.2; since += DT) {
        const a = friendAside(since, flight, scale, true);
        assert.equal(a.dx, 0); assert.equal(a.dy, 0);
        assert.ok(a.alpha === 1 || a.alpha === FRIEND_FLIGHT_ALPHA, `${name}: static alpha ${a.alpha}`);
      }
      assert.equal(friendAside(flight / 2 + 0.1, flight, scale, true).alpha, FRIEND_FLIGHT_ALPHA, `${name}: faded in flight`);
    }
  }
});

test("penalty mid-flight: the Friend's drawn box no longer covers the left third of the goal at full opacity", () => {
  // The sprite (with its halo) spans ±9 cells around the feet, 16 cells up and 2 down (drawFriend).
  const plant = plantSpot(PENALTY_VIEW), s = plant.scale;
  const box = (dx: number, dy: number) => ({ x0: plant.x + dx - 9 * s, x1: plant.x + dx + 9 * s, y0: plant.y + dy - 16 * s, y1: plant.y + dy + 2 * s });
  const a = applyGoal(PENALTY_GOAL, { x: GOAL.left, y: GOAL.bar }), b = applyGoal(PENALTY_GOAL, { x: GOAL.left + (GOAL.right - GOAL.left) / 3, y: GOAL.line });
  const third = { x0: a.x, x1: b.x, y0: a.y, y1: b.y }, area = (third.x1 - third.x0) * (third.y1 - third.y0);
  const covered = (r: ReturnType<typeof box>) => Math.max(0, Math.min(r.x1, third.x1) - Math.max(r.x0, third.x0)) * Math.max(0, Math.min(r.y1, third.y1) - Math.max(r.y0, third.y0)) / area;
  const before = covered(box(0, 0));
  assert.ok(before > 0.1, `before: the planted Friend covers ${(before * 100).toFixed(0)} % of the left third`);
  for (const flight of FLIGHTS.slice(0, 3)) {
    const mid = friendAside(flight / 2 + 0.1, flight, s), after = covered(box(mid.dx, mid.dy));
    assert.ok(after <= before, "easing aside never covers more of it");
    // Opaque coverage (area × opacity) at most half what it was: the ball and the keeper read through the Friend.
    assert.ok(after * mid.alpha <= before * 0.5, `flight ${flight}s: opaque coverage ${(after * mid.alpha * 100).toFixed(0)} % vs ${(before * 100).toFixed(0)} %`);
  }
});

function outcome(want: "goal" | "save"): ShotOutcome {
  const random = prng(0xb11), keeper = KEEPERS[0];
  for (let k = 0; k < 5000; k++) {
    const shot = { aimX: -0.6 - random() * 0.4, aimY: random() * 0.9, power: 0.4 + random() * 0.6, curl: 0 };
    const out = resolveShot(shot, keeper, kickSeed(k, 0, keeper.id), { kickIndex: 0, history: [] }, NEUTRAL);
    if (out.result === want) return out;
  }
  throw new Error(`no ${want} found`);
}
function stubDocument() {
  if ((globalThis as { document?: unknown }).document) return;
  const context: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : () => context), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

/** The planted Friend's x on screen (the rest pose after the kick). */
const stage0X = () => new Stage({ keeper: KEEPERS[0].id }).kickPose(99).x;

test("Stage: the Friend eases aside live and in the instant replay alike, and is restored before reactions and celebrations", () => {
  stubDocument();
  for (const want of ["goal", "save"] as const) {
    const shot = outcome(want), flight = penaltyFlight(shot.target.time);
    const live = new Stage({ keeper: KEEPERS[0].id });
    live.play(shot, 0);
    const trace = (stage: Stage, from: number) => {
      const out = new Map<number, string>();
      for (let t = from; t < STRIKE_AT + flight + 2.2; t += 1 / 60) {
        const since = Math.round(((stage as unknown as { modeTime: number }).modeTime - STRIKE_AT) * 60);
        const a = stage.friendAsideNow; if (a) out.set(since, `${a.alpha.toFixed(3)} ${a.dx} ${a.dy}`);
        stage.update(1 / 60);
      }
      return out;
    };
    const liveTrace = trace(live, 0);
    const mid = [...liveTrace].find(([f]) => f === Math.round((flight / 2 + 0.1) * 60));
    assert.ok(mid && Number(mid[1].split(" ")[0]) <= 0.5, `${want}: faded live mid-flight (${mid?.[1]})`);
    // After the shot mode ends (reaction or celebration), no fade at all.
    assert.equal(live.friendAsideNow, null, `${want}: no fade after the shot`);
    for (const [f, v] of liveTrace) if (f >= Math.round((flight + FRIEND_RESTORE_AFTER) * 60) + 1) assert.equal(v, "1.000 0 0", `${want}: restored at frame ${f}`);

    // Celebrations keep their start (+1.0 s after the crossing) and begin at full opacity, well after the restore.
    if (want === "goal") assert.ok(1.0 > FRIEND_RESTORE_AFTER, "the goal celebration starts after the Friend is back");

    // The drawn Friend follows friendAsideNow, including under the save/miss/post reaction pose (which still starts
    // at +0.1 s): 300 ms after the crossing it is drawn aside; 700 ms after, at its spot.
    const drawnAt = (after: number) => {
      const stage = new Stage({ keeper: KEEPERS[0].id }); stage.play(shot, 0);
      while ((stage as unknown as { modeTime: number }).modeTime < STRIKE_AT + flight + after) stage.update(1 / 120);
      const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
      stage.render(context);
      const r = stage.stats.friendRect!, a = stage.friendAsideNow;
      return { centre: (r.x1 + r.x2) / 2, aside: a };
    };
    const rest = stage0X(), held = drawnAt(0.3), back = drawnAt(0.7);
    assert.ok(held.aside && held.aside.dx < 0 && held.aside.alpha <= 0.5, `${want}: faded and aside 300 ms after the crossing (${JSON.stringify(held.aside)})`);
    assert.ok(Math.abs(held.centre - (rest + held.aside!.dx)) <= 1, `${want}: drawn aside at +300 ms (centre ${held.centre}, spot ${rest}, dx ${held.aside!.dx})`);
    assert.ok(Math.abs(back.centre - rest) <= 1 && (!back.aside || back.aside.alpha === 1), `${want}: back at its spot at +700 ms (centre ${back.centre})`);

    // The net-cam replay plays the same shot clock (slowed), so each shot-clock instant matches the live frame.
    const replay = new Stage({ keeper: KEEPERS[0].id });
    replay.replay(shot, 0);
    let t = 0;
    while (replay.replayingNow && t < 10) {
      const clock = (replay as unknown as { modeTime: number }).modeTime - STRIKE_AT, a = replay.friendAsideNow;
      if (a) assert.deepEqual(a, friendAside(clock, flight, plantSpot(PENALTY_VIEW).scale), `${want} replay at ${clock.toFixed(3)}`);
      replay.update(1 / 60); t += 1 / 60;
    }
  }
});
