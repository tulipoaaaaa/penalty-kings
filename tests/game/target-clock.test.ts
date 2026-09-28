import { test } from "node:test";
import assert from "node:assert/strict";
import { gameClockRunning, TARGET_SECONDS, type ClockGate } from "../../games/penalty-kings/game/target.ts";
import { MODES } from "../../games/penalty-kings/game/progress.ts";

// Polish: Target Practice's "60 seconds" took 3+ minutes of real time because the countdown only ran while aiming.
// The clock now runs through the ball's flight, the result banner, replays and walk-ons, and stops only while a
// menu or overlay is open, the tab is hidden, the game is paused or the rotate card is up (BQ-P1-4).

const aiming: ClockGate = { kind: "target", frozen: false, menu: false, overlay: false, moment: false, inFlight: false };

test("Target Practice: the 60 s clock runs while aiming, during the flight, the result banner and Stage moments", () => {
  assert.equal(gameClockRunning(aiming), true, "aiming");
  assert.equal(gameClockRunning({ ...aiming, inFlight: true }), true, "ball in flight / result banner");
  assert.equal(gameClockRunning({ ...aiming, moment: true }), true, "a replay or a keeper walk-on");
  assert.equal(gameClockRunning({ ...aiming, inFlight: true, moment: true }), true);
});

test("Target Practice: the clock stops for menus, overlays, a hidden tab, pause and the rotate card", () => {
  assert.equal(gameClockRunning({ ...aiming, frozen: true }), false, "paused, rotate card (BQ-P1-4) or hidden tab");
  assert.equal(gameClockRunning({ ...aiming, menu: true }), false, "a menu");
  assert.equal(gameClockRunning({ ...aiming, overlay: true }), false, "a pack reveal or the ball carousel");
  assert.equal(gameClockRunning({ ...aiming, inFlight: true, frozen: true }), false, "paused mid-flight");
});

test("other modes keep their shot clock rule: frozen in menus, overlays and protected Stage moments", () => {
  for (const kind of ["penalty", "freekick"]) {
    const gate = { ...aiming, kind };
    assert.equal(gameClockRunning(gate), true, kind);
    assert.equal(gameClockRunning({ ...gate, inFlight: true }), true, `${kind}: no shot clock runs mid-flight anyway`);
    assert.equal(gameClockRunning({ ...gate, moment: true }), false, `${kind}: walkout / replay`);
    for (const key of ["frozen", "menu", "overlay"] as const) assert.equal(gameClockRunning({ ...gate, [key]: true }), false, `${kind}: ${key}`);
  }
});

test("the copy still says 60 seconds and the round is 60 s", () => {
  assert.equal(TARGET_SECONDS, 60);
  assert.match(MODES.find(mode => mode.id === "target")!.blurb, /^60 seconds\./);
});
