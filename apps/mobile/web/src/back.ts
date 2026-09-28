/**
 * The Android back button (and the web test hook window.__pkTestBack), as a pure state machine.
 *
 *   shell overlays first (leave-confirm → dev menu → payment sheet → account menu),
 *   onboarding steps go one step back,
 *   in the game: a game menu / pack / ball picker closes → a running session asks "Leave the match?" (never leaves
 *   without a confirm) → Results etc. go back to Modes → at Modes (or the title) the app is sent to the background.
 *
 * The game's state comes from the sandboxed game frame (apps/mobile/web/frame-bridge.js posts it to the shell).
 */

export type ShellStep = "welcome" | "email" | "code" | "creating" | "address" | "rf" | "friend" | "hardwire" | "game";

/** What the game frame reports (a subset of the game's read-only __pkFlow QA hook). */
export type GameView = Readonly<{
  screen: "title" | "modes" | "play";
  /** A game menu (hub, shop, Bag, Results, …), a pack opening, the ball picker or the share card is open. */
  overlay: boolean;
  /** A session (any mode) is running. */
  session: boolean;
}>;

export type BackState = Readonly<{
  step: ShellStep;
  confirm: boolean;
  dev: boolean;
  sheet: boolean;
  menu: boolean;
  /** Latest state reported by the game frame (null until the game has loaded). */
  game: GameView | null;
}>;

export type BackAction =
  | { type: "stay-in-match" }      // the leave-confirm is open: back = "Stay"
  | { type: "close-dev" }
  | { type: "close-sheet" }
  | { type: "close-menu" }
  | { type: "step"; to: ShellStep }
  | { type: "cancel-code" }
  | { type: "game-close-overlay" }
  | { type: "confirm-leave" }       // ask first; only "Leave" sends game-to-modes
  | { type: "game-to-modes" }
  | { type: "background" };         // Android: move the app to the background (never quits mid-match)

const PREVIOUS: Partial<Record<ShellStep, ShellStep>> = { email: "welcome", rf: "address", friend: "rf" };

export function decideBack(state: BackState): BackAction {
  if (state.confirm) return { type: "stay-in-match" };
  if (state.dev) return { type: "close-dev" };
  if (state.sheet) return { type: "close-sheet" };
  if (state.menu) return { type: "close-menu" };
  if (state.step !== "game") {
    if (state.step === "code") return { type: "cancel-code" };
    const to = PREVIOUS[state.step];
    return to ? { type: "step", to } : { type: "background" };
  }
  const game = state.game;
  if (!game) return { type: "background" };
  if (game.overlay) return { type: "game-close-overlay" };
  if (game.screen === "play") return game.session ? { type: "confirm-leave" } : { type: "game-to-modes" };
  return { type: "background" };
}

/** Validates a game-state message from the frame (it is untrusted input: exact shape only). */
export function parseGameView(value: unknown): GameView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as Record<string, unknown>;
  if (!["title", "modes", "play"].includes(view.screen as string) || typeof view.overlay !== "boolean" || typeof view.session !== "boolean") return null;
  return { screen: view.screen as GameView["screen"], overlay: view.overlay, session: view.session };
}
