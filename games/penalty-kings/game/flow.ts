/**
 * The action-flow state machine: which player actions are legal in which UI state.
 *
 * The shell (index.tsx) asks allowed() before every action, so these guards ARE the game's rules, and
 * tests/game/flow.test.ts tries every action in every reachable state. transition() models how the
 * legal actions move the state, so random action sequences can check the invariants:
 *  • at most one kick is in flight, and every kick resolves exactly once;
 *  • nothing can shoot while a pack is revealing, the keeper walks out, a menu or the carousel is open, or the runtime is paused;
 *  • the shot clock only runs while the player can actually shoot;
 *  • switching mode (or redeeming the ball being kicked) cancels the aim; it can never happen mid-kick.
 */
export type FlowPhase = "idle" | "aim" | "shooting";
export type FlowState = Readonly<{
  screen: "title" | "modes" | "play";
  phase: FlowPhase;
  /** A session (any mode) is running. */
  session: boolean;
  /** The running session is a Big Match (it kicks a chosen ball). */
  match: boolean;
  menu: boolean;
  pack: boolean;
  carousel: boolean;
  /** An SDK action (buy / open / redeem) is in progress. */
  busy: boolean;
  paused: boolean;
  /** The Stage is playing a moment that must not be cut (keeper walkout, a pack reveal sequence). */
  stage: boolean;
  /** Non-sample balls in the Bag. */
  balls: number;
  /** Kicks in flight (must never exceed 1). */
  inFlight: number;
}>;

export type FlowAction =
  | "shoot"          // swipe release, Space release or Quick shot
  | "start-swipe"    // pointer down on the pitch
  | "tick-clock"     // the shot clock advancing (and timing out)
  | "resolve"        // the Stage finished the kick
  | "open-menu"      // Menu button or the pot banner
  | "close-menu"
  | "start-mode"     // any new session, including the Skill Cup and World Tour levels
  | "choose-ball"    // pick a ball in the carousel / Bag
  | "kick-with"      // "Shoot this ball"
  | "open-carousel"
  | "close-carousel"
  | "buy" | "open-pack" | "close-pack" | "redeem"
  | "pause" | "resume"
  | "stage-moment" | "stage-idle"; // a walkout / reveal starts or ends

export const FLOW_ACTIONS: readonly FlowAction[] = ["shoot", "start-swipe", "tick-clock", "resolve", "open-menu", "close-menu", "start-mode", "choose-ball", "kick-with", "open-carousel", "close-carousel", "buy", "open-pack", "close-pack", "redeem", "pause", "resume", "stage-moment", "stage-idle"];

/** The player can aim and shoot right now (also: the shot clock may run). */
export const canShoot = (s: FlowState) => s.screen === "play" && s.session && s.phase === "aim" && !s.menu && !s.pack && !s.carousel && !s.paused && !s.stage && s.inFlight === 0;

export function allowed(s: FlowState, action: FlowAction): boolean {
  const kicking = s.phase === "shooting" || s.inFlight > 0;
  switch (action) {
    case "shoot": case "start-swipe": case "tick-clock": return canShoot(s);
    case "resolve": return s.inFlight > 0;
    case "open-menu": return !kicking && !s.menu;
    case "close-menu": return s.menu && !s.busy;
    case "start-mode": return !kicking && !s.busy && !s.pack && !s.paused;
    case "choose-ball": return !kicking && s.balls > 0;
    case "kick-with": return !kicking && !s.busy && !s.pack && !s.paused && s.balls > 0;
    case "open-carousel": return !kicking && s.match && s.phase === "idle" && !s.menu && !s.pack && !s.busy && !s.paused;
    case "close-carousel": return s.carousel;
    case "buy": case "open-pack": return !kicking && !s.busy && !s.paused && !s.pack;
    case "close-pack": return s.pack;
    case "redeem": return !kicking && !s.busy && !s.paused && s.balls > 0;
    case "pause": return !s.paused;
    case "resume": return s.paused;
    case "stage-moment": return !s.stage && !kicking;
    case "stage-idle": return s.stage;
  }
}

/** How a LEGAL action moves the state (the model the tests fuzz; the shell mirrors it). */
export function transition(s: FlowState, action: FlowAction, options: { sessionEnds?: boolean; redeemsActiveBall?: boolean; pulls?: number } = {}): FlowState {
  if (!allowed(s, action)) throw new Error(`illegal: ${action} in ${describeState(s)}`);
  switch (action) {
    case "shoot": return { ...s, phase: "shooting", inFlight: s.inFlight + 1 };
    case "start-swipe": case "tick-clock": return s;
    case "resolve":
      if (options.sessionEnds) return { ...s, phase: "idle", inFlight: 0, menu: true };
      return s.match ? { ...s, phase: "idle", inFlight: 0, carousel: s.balls > 0 } : { ...s, phase: "aim", inFlight: 0 };
    case "open-menu": return { ...s, menu: true };
    case "close-menu": return { ...s, menu: false };
    case "start-mode": return { ...s, screen: "play", session: true, match: false, phase: "aim", menu: false, carousel: false, inFlight: 0 };
    case "choose-ball": return s;
    case "kick-with": return { ...s, screen: "play", session: true, match: true, phase: "aim", menu: false, carousel: false };
    case "open-carousel": return { ...s, carousel: true };
    case "close-carousel": return { ...s, carousel: false };
    case "buy": return s;
    case "open-pack": return { ...s, pack: true, menu: false, screen: "play", balls: s.balls + (options.pulls ?? 2) };
    case "close-pack": return { ...s, pack: false, menu: true };
    case "redeem": {
      const balls = s.balls - 1;
      // Redeeming the ball being aimed with cancels that aim (you cannot kick a ball you no longer hold).
      if (options.redeemsActiveBall && s.match && s.phase === "aim") return { ...s, balls, phase: "idle", carousel: false };
      return { ...s, balls };
    }
    case "pause": return { ...s, paused: true };
    case "resume": return { ...s, paused: false };
    case "stage-moment": return { ...s, stage: true };
    case "stage-idle": return { ...s, stage: false };
  }
}

export const describeState = (s: FlowState) => `${s.screen}/${s.phase}${s.session ? (s.match ? "/match" : "/session") : ""}${s.menu ? "/menu" : ""}${s.pack ? "/pack" : ""}${s.carousel ? "/carousel" : ""}${s.busy ? "/busy" : ""}${s.paused ? "/paused" : ""}${s.stage ? "/stage" : ""} balls=${s.balls} inFlight=${s.inFlight}`;

export const INITIAL_FLOW: FlowState = { screen: "title", phase: "idle", session: false, match: false, menu: false, pack: false, carousel: false, busy: false, paused: false, stage: false, balls: 0, inFlight: 0 };
