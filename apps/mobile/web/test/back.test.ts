// Android back button state machine (apps/mobile/web/src/back.ts): menus → Modes → confirm before leaving a match.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideBack, parseGameView, type BackState, type GameView } from "../src/back.ts";

const base: BackState = { step: "game", confirm: false, dev: false, sheet: false, menu: false, game: null };
const game = (view: Partial<GameView>): BackState => ({ ...base, game: { screen: "play", overlay: false, session: true, ...view } });

test("shell overlays close first, in order: leave-confirm, dev menu, payment sheet, account menu", () => {
  const all: BackState = { ...game({ overlay: true }), confirm: true, dev: true, sheet: true, menu: true };
  assert.equal(decideBack(all).type, "stay-in-match");
  assert.equal(decideBack({ ...all, confirm: false }).type, "close-dev");
  assert.equal(decideBack({ ...all, confirm: false, dev: false }).type, "close-sheet");
  assert.equal(decideBack({ ...all, confirm: false, dev: false, sheet: false }).type, "close-menu");
  assert.equal(decideBack({ ...all, confirm: false, dev: false, sheet: false, menu: false }).type, "game-close-overlay");
});

test("in the game: a game menu closes, then Modes, never leaving a match without a confirm", () => {
  assert.equal(decideBack(game({ overlay: true })).type, "game-close-overlay", "menus (hub, shop, Bag, Results, pack) close first");
  assert.equal(decideBack(game({ session: true })).type, "confirm-leave", "a running session asks first");
  assert.equal(decideBack(game({ session: false })).type, "game-to-modes", "no session on the pitch: straight back to Modes");
  assert.equal(decideBack(game({ screen: "modes", session: false })).type, "background", "Modes is the root: the app goes to the background");
  assert.equal(decideBack(game({ screen: "title", session: false })).type, "background");
  assert.equal(decideBack({ ...base, game: null }).type, "background", "game not loaded yet");
});

test("mid-match: no sequence of presses leaves the match without the confirm", () => {
  // Simulate presses: each confirm-leave opens the confirm; pressing back again = Stay (closes it), never leaves.
  let state: BackState = game({ session: true });
  for (let press = 0; press < 10; press++) {
    const action = decideBack(state);
    assert.notEqual(action.type, "game-to-modes");
    assert.notEqual(action.type, "background");
    state = { ...state, confirm: action.type === "confirm-leave" };
  }
});

test("onboarding steps go one step back; the first screens send the app to the background", () => {
  const step = (s: BackState["step"]) => decideBack({ ...base, step: s });
  assert.deepEqual(step("email"), { type: "step", to: "welcome" });
  assert.deepEqual(step("code"), { type: "cancel-code" });
  assert.deepEqual(step("rf"), { type: "step", to: "address" });
  assert.deepEqual(step("friend"), { type: "step", to: "rf" });
  for (const s of ["welcome", "creating", "address", "hardwire"] as const) assert.equal(step(s).type, "background", s);
  assert.equal(decideBack({ ...base, step: "rf", sheet: true }).type, "close-sheet", "the payment sheet closes before the step changes");
});

test("game state from the frame is untrusted: exact shape only", () => {
  assert.deepEqual(parseGameView({ screen: "play", overlay: false, session: true, extra: 1 }), { screen: "play", overlay: false, session: true });
  assert.equal(parseGameView({ screen: "shop", overlay: false, session: true }), null);
  assert.equal(parseGameView({ screen: "play", overlay: "no", session: true }), null);
  assert.equal(parseGameView(null), null);
  assert.equal(parseGameView("play"), null);
});
