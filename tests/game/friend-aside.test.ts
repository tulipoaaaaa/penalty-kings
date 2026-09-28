import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, NEUTRAL, resolveShot, kickSeed, prng, freeKickSetup, type ShotOutcome } from "@penalty-kings/engine";
import { GOAL, PENALTY_GOAL } from "../../games/penalty-kings/gfx/stadium.ts";
import { applyGoal } from "../../games/penalty-kings/gfx/setpieces.ts";
import { Stage, penaltyFlight } from "../../games/penalty-kings/gfx/stage.ts";
import { PENALTY_VIEW, freeKickView, plantSpot, legFrame, STRIKE_AT, friendAside, handoverAfter, FRIEND_FLIGHT_ALPHA, HANDOVER_AFTER, type KickView } from "../../games/penalty-kings/gfx/kick.ts";

// B11: after the strike the big foreground Friend fades to ~45 % and eases a few whole pixels aside for the ball's
// flight (it hid the left third of the goal: the arrival and the keeper's save there). Polish: it stays faded and
// aside through the whole payoff, while the DOM result banner (GOAL! / OFF THE POST!) is up: until the shot hands
// over, when a goal's celebration pose starts (+1.0 s after the crossing) or a miss/save/post clears the banner
// (+1.3 s). It was back opaque, centre-front over the keeper, at +0.65 s with the banner still up. Celebrations
// draw it at full opacity from their first frame. The reaction beat (miss/save/post) still starts at +0.1 s; its
// pose plays under the fade. Layering only: the sprite and kickPose are untouched.

const VIEWS: Array<[string, KickView]> = [["penalty", PENALTY_VIEW], ["free kick 24 m", freeKickView(freeKickSetup(5, { distance: 24, angle: 0.2, wallSize: 4 }))]];
/** Penalty flights span 0.35–0.55 s; free kicks fly on the engine's clock (≈ 0.6–1.6 s). */
const FLIGHTS = [penaltyFlight(0.4), penaltyFlight(0.7), penaltyFlight(0.95), 0.8, 1.2, 1.6];
const DT = 1 / 120;
const HANDOVERS = [HANDOVER_AFTER.goal, HANDOVER_AFTER.other];

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
      for (let since = 0; since < flight + HANDOVER_AFTER.goal; since += DT) {
        const a = friendAside(since, flight, scale);
        assert.ok(Number.isInteger(a.dx) && Number.isInteger(a.dy), `${name}: whole pixels at ${since.toFixed(3)}`);
        assert.ok(Math.abs(a.dx - prev.dx) <= 2 && Math.abs(a.dy - prev.dy) <= 1 && Math.abs(a.alpha - prev.alpha) <= 0.12, `${name} ${flight}s: smooth at ${since.toFixed(3)}`);
        prev = a;
      }
    }
  }
});

test("friendAside: held faded (≤ 60 %) and aside while the result banner is up, until the handover", () => {
  assert.equal(HANDOVER_AFTER.goal, 1.0); assert.equal(HANDOVER_AFTER.other, 1.3);
  assert.equal(handoverAfter("goal"), 1.0); for (const r of ["save", "miss", "post"]) assert.equal(handoverAfter(r), 1.3);
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale, full = friendAside(1, 2, scale); // a long flight: fully out
    for (const flight of FLIGHTS) for (const handover of HANDOVERS) {
      for (let since = flight; since < flight + handover - 1e-9; since += DT) {
        const a = friendAside(since, flight, scale, false, handover), ms = ((since - flight) * 1000).toFixed(0);
        assert.ok(a.alpha <= 0.6, `${name} ${flight}s: still faded ${ms} ms after the crossing (${a.alpha.toFixed(2)})`);
        assert.deepEqual([a.dx, a.dy], [full.dx, full.dy], `${name} ${flight}s: still aside ${ms} ms after the crossing`);
        const r = friendAside(since, flight, scale, true, handover);
        assert.deepEqual(r, { alpha: FRIEND_FLIGHT_ALPHA, dx: 0, dy: 0 }, `${name}: reduced motion holds the static fade`);
      }
      // The evidence frame: ~1.5 s after release (+0.65 s after a 0.45 s crossing) it was back opaque over the keeper.
      assert.ok(friendAside(flight + 0.65, flight, scale, false, handover).alpha <= 0.6, `${name} ${flight}s: faded at +650 ms`);
    }
  }
});

test("friendAside: back to full opacity and the planted spot at the handover (the celebration's first frame)", () => {
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale;
    for (const flight of FLIGHTS) for (const handover of HANDOVERS) for (const reduced of [false, true]) {
      for (const since of [flight + handover, flight + handover + 0.3, 99]) {
        assert.deepEqual(friendAside(since, flight, scale, reduced, handover), { alpha: 1, dx: 0, dy: 0 }, `${name} ${flight}s reduced=${reduced}: restored at ${since.toFixed(2)}`);
      }
    }
  }
});

test("friendAside, reduced motion: no positional movement, only a static fade for the flight", () => {
  for (const [name, view] of VIEWS) {
    const scale = plantSpot(view).scale;
    for (const flight of FLIGHTS) {
      for (let since = -STRIKE_AT; since <= flight + HANDOVER_AFTER.other + 0.2; since += DT) {
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

test("Stage: the Friend stays aside while the result banner is up, live and in the replay alike; full opacity once a celebration starts", () => {
  stubDocument();
  for (const want of ["goal", "save", "post"] as const) {
    const shot = outcome(want), flight = penaltyFlight(shot.target.time), handover = handoverAfter(shot.result);
    // Live: the DOM banner is up from "resolved" (the crossing) to "done" (index.tsx clears it there). The drawn
    // Friend's alpha is friendAsideNow's (1 outside a shot): ≤ 60 % for that whole window, drawn aside.
    const live = new Stage({ keeper: KEEPERS[0].id });
    let bannerUp = false, doneAt = -1, resolvedAt = -1, frames = 0, celebrating = 0, shotClock = 0;
    const clock = () => (live as unknown as { modeTime: number }).modeTime;
    // "done" fires inside update(): a goal's celebration has already reset modeTime, so take the last shot-clock frame.
    live.onEvent = event => { if (event === "resolved") { bannerUp = true; resolvedAt = clock(); } if (event === "done") { bannerUp = false; doneAt = shotClock; } };
    live.play(shot, 0);
    const rest = stage0X(), context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    for (let t = 0; t < STRIKE_AT + flight + 2.2; t += 1 / 120) {
      if ((live as unknown as { mode: string }).mode === "shot") shotClock = clock();
      live.update(1 / 120);
      const mode = (live as unknown as { mode: string }).mode, a = live.friendAsideNow, alpha = a?.alpha ?? 1;
      if (bannerUp) {
        frames++;
        assert.ok(alpha <= 0.6, `${want}: Friend at ${(alpha * 100).toFixed(0)} % with the banner up (+${(clock() - STRIKE_AT - flight).toFixed(2)} s after the crossing)`);
        if (clock() > STRIKE_AT + flight + 0.2) { live.render(context); const r = live.stats.friendRect!; assert.ok((r.x1 + r.x2) / 2 < rest - 1 || want !== "goal", `${want}: drawn aside with the banner up`); }
      }
      if (mode === "celebrate") { celebrating++; assert.equal(a, null); assert.equal(alpha, 1, `${want}: a celebration draws the Friend at full opacity`); }
    }
    assert.ok(frames > 100, `${want}: the banner was up (${frames} frames)`);
    assert.ok(Math.abs(doneAt - resolvedAt - handover) < 0.02, `${want}: the handover matches the banner's end (${(doneAt - resolvedAt).toFixed(2)} s)`);
    assert.equal(celebrating > 0, want === "goal", `${want}: celebrates only a goal`);
    assert.equal(live.friendAsideNow, null, `${want}: no fade after the shot`);

    // The net-cam replay plays the same shot clock (slowed), so each shot-clock instant matches the live frame.
    const replay = new Stage({ keeper: KEEPERS[0].id });
    replay.replay(shot, 0);
    let t = 0;
    while (replay.replayingNow && t < 10) {
      const at = (replay as unknown as { modeTime: number }).modeTime - STRIKE_AT, a = replay.friendAsideNow;
      if (a) assert.deepEqual(a, friendAside(at, flight, plantSpot(PENALTY_VIEW).scale, false, handover), `${want} replay at ${at.toFixed(3)}`);
      replay.update(1 / 60); t += 1 / 60;
    }
  }
});

test("Stage, reduced motion: the Friend never moves aside, only the static fade while the banner is up", () => {
  stubDocument();
  for (const want of ["goal", "save"] as const) {
    const shot = outcome(want), stage = new Stage({ keeper: KEEPERS[0].id, reduced: true });
    stage.play(shot, 0);
    for (let t = 0; t < 3; t += 1 / 120) { stage.update(1 / 120); const a = stage.friendAsideNow; if (a) { assert.equal(a.dx, 0); assert.equal(a.dy, 0); } }
  }
});
