import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed, canShoot, transition, describeState, FLOW_ACTIONS, INITIAL_FLOW, type FlowState, type FlowAction } from "../../games/penalty-kings/game/flow.ts";

// Every combination of the UI flags (3 screens × 3 phases × 8 booleans × 0/1/3 balls × 0/1 in flight).
function* allStates(): Generator<FlowState> {
  for (const screen of ["title", "modes", "play"] as const)
    for (const phase of ["idle", "aim", "shooting"] as const)
      for (let bits = 0; bits < 1 << 8; bits++)
        for (const balls of [0, 1, 3])
          for (const inFlight of [0, 1]) {
            const [session, match, menu, pack, carousel, busy, paused, stage] = Array.from({ length: 8 }, (_, i) => Boolean(bits & (1 << i)));
            if (match && !session) continue;
            yield { screen, phase, session, match, menu, pack, carousel, busy, paused, stage, balls, inFlight };
          }
}

test("every action in every state: nothing shoots while revealing, during the walkout, in a menu/carousel, paused, or mid-kick", () => {
  let checked = 0;
  for (const s of allStates()) for (const action of FLOW_ACTIONS) {
    checked++;
    const ok = allowed(s, action), where = `${action} in ${describeState(s)}`;
    if (action === "shoot" || action === "start-swipe" || action === "tick-clock") {
      if (s.pack || s.menu || s.carousel || s.paused || s.stage || s.phase !== "aim" || s.inFlight > 0 || !s.session || s.screen !== "play") assert.equal(ok, false, where);
    }
    // Mid-kick (walkout/celebration included: the phase stays "shooting" until the Stage is done).
    if (s.phase === "shooting" || s.inFlight > 0) {
      for (const blocked of ["shoot", "start-mode", "kick-with", "open-menu", "buy", "open-pack", "redeem", "open-carousel"] as FlowAction[]) if (action === blocked) assert.equal(ok, false, where);
    }
    if (s.balls === 0 && (action === "kick-with" || action === "redeem" || action === "choose-ball")) assert.equal(ok, false, where);
    if (s.paused && ["start-mode", "kick-with", "buy", "open-pack", "redeem"].includes(action)) assert.equal(ok, false, where);
    if (s.busy && ["start-mode", "kick-with", "buy", "open-pack", "redeem", "close-menu"].includes(action)) assert.equal(ok, false, where);
    if (ok && action !== "resolve") assert.doesNotThrow(() => transition(s, action), where);
  }
  assert.ok(checked > 50_000, `checked ${checked}`);
});

test("double release / double tap: the second shot of the same aim is always rejected", () => {
  let s: FlowState = transition(INITIAL_FLOW, "start-mode");
  assert.ok(canShoot(s));
  s = transition(s, "shoot");
  assert.equal(allowed(s, "shoot"), false);
  assert.throws(() => transition(s, "shoot"));
  assert.equal(allowed(s, "tick-clock"), false, "the shot clock stops once the kick is taken");
});

test("seeded random action sequences: ≤1 kick in flight, every kick resolves once, clock only runs while shootable", () => {
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let shots = 0, resolves = 0;
  for (let run = 0; run < 400; run++) {
    let s: FlowState = { ...INITIAL_FLOW, balls: Math.floor(random() * 3) };
    let flight = 0;
    for (let step = 0; step < 120; step++) {
      const action = FLOW_ACTIONS[Math.floor(random() * FLOW_ACTIONS.length)];
      if (!allowed(s, action)) continue;
      const before = s;
      s = transition(s, action, { sessionEnds: random() < 0.2, redeemsActiveBall: random() < 0.5 });
      if (action === "shoot") { shots++; flight++; }
      if (action === "resolve") { resolves++; flight--; }
      assert.ok(s.inFlight <= 1, describeState(s));
      assert.equal(s.inFlight, flight);
      if (action === "tick-clock") assert.ok(canShoot(before));
      if (action === "start-mode" || action === "kick-with") assert.equal(before.phase === "shooting", false, "no mode switch mid-kick");
    }
    // Drain: whatever is in flight resolves exactly once.
    if (s.inFlight) { s = transition(s, "resolve"); resolves++; }
  }
  assert.equal(shots, resolves);
  assert.ok(shots > 100, `only ${shots} shots were fuzzed`);
});

test("redeeming the ball you are aiming with cancels that aim; redeeming another does not", () => {
  const aiming: FlowState = { ...INITIAL_FLOW, screen: "play", session: true, match: true, phase: "aim", balls: 2, menu: true };
  assert.equal(transition(aiming, "redeem", { redeemsActiveBall: true }).phase, "idle");
  assert.equal(transition(aiming, "redeem", { redeemsActiveBall: false }).phase, "aim");
  assert.equal(allowed({ ...aiming, balls: 0 }, "kick-with"), false, "no kicking with 0 balls");
});
