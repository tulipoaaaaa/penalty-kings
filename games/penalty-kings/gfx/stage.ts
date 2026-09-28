/**
 * The Stage: one scene engine used by the game and the dev Showroom.
 * Layers: sky → stands → crowd → boards → pitch → net → keeper → goal frame → ball → striker → FX → canvas UI.
 * Choreography: build-up → run-up → strike (hit-stop, flash, ring) → flight → outcome → celebration/reaction.
 */
import { keeperById, keeperAt, keeperFrame, freeKickKeeperFrame, FK_SHUFFLE_TIME, rigGeometry, flightAt, WALL_DISTANCE, BALL_RADIUS, GOAL_ASPECT, LEG_RADIUS, type KeeperId, type KeeperPlan, type KeeperFrame, type ShotResult, type ShotOutcome, type FreeKickSetup, type FreeKickOutcome, type FlightSample } from "@penalty-kings/engine";
import { W, H, ease, clamp01, lerp, Camera, Particles, Timeline, headFont, loadHeadFont, plainText } from "./core.js";
import { drawBackdrop, drawStadiumFx, drawBoards, drawPitch, drawWeather, drawHeatShimmer, drawGoalFrame, glyphText, glyphCols, GOAL, SPOT, THEMES, toScreen, PENALTY_GOAL, type StadiumId, type Weather } from "./stadium.js";
import { Crowd } from "./crowd.js";
import { atmosphereParams, drawAtmosphere, type Atmosphere } from "./atmosphere.js";
import { Net } from "./net.js";
import { drawKeeper, drawKeeperFrame, keeperArms, artPoint, KEEPER_DESIGNS, KEEPER_TAUNTS, GLINT_SECONDS, type KeeperPose } from "./keepers.js";
import { drawBall, emitTrail, emitLucky, seasonFx, RARITY_FX, flightRadius, ribbonFor, drawRibbon, type RibbonPoint } from "./ball.js";
import { drawFriend, drawKickLeg, drawContactFlash, celebrationBeat, reactionBeat, drawTrophy, CELEBRATIONS, type CelebrationId, type FriendLayers } from "./friend.js";
import { freshCommentary, drawCommentator, type CommentaryContext } from "./commentary.js";
import { fkProject, fkBall, drawWall, pathAt, drawPreview, drawZoneHints, drawTargets, drawCrossbarGlow, drawClock, goalTransform, applyGoal, drawPitchMarkings, PENALTY_SETUP, PENALTY_CAMERA } from "./setpieces.js";
import { STRIKE_AT, PENALTY_VIEW, freeKickView, kickPose, plantSpot, runupStart, friendAside, handoverAfter, FRIEND_CELL, type KickView, type KickPose, type FriendAside } from "./kick.js";
import type { RevealPlan } from "../game/reveal.js";
import { waitCue, WAIT_EVENTS, PACK_TEAR_MS, type WaitCue } from "../game/suspense.js";
import { drawBallWarmup, drawPenaltyWait, drawSealedPack, drawPackTear } from "./waits.js";
import { HUSH, type Sfx } from "../audio-core.js";
import { FeelFx, SlowMoGate, hitStopFor, goalTrauma, paceOf, feverTier, feverStinger, slowMoRate, isCloseCall, isFingertip, nearFrame, CONFETTI, TRAUMA, PUNCH, FEVER_AT, FX_LIFE } from "./feel.js";

export type Facing = "up" | "down" | "left" | "right";
export type RowsProvider = (facing: Facing, walking: boolean, frame: number) => readonly string[] | null;
/** Penalty view: how far the backdrop layer drops so the ad boards (bottom at y 102) end 30 px above the goal line. */
export const BACKDROP_DROP = Math.round(PENALTY_GOAL.y - 30 - 102);
/** Seconds from release to the strike (the run-up). Round 6 B3: ≤ 0.4 s. Defined in gfx/kick.ts. */
export { STRIKE_AT };
export type StageEvent = "sfx" | "strike" | "resolved" | "done" | "reveal-done" | "walkout-done" | "reveal" | "replay-done" | "walkon-done" | "wait";
/** FD-3b: a beat inside a wait for randomness (the shell plays the crowd drumroll and a Director moment). */
export type WaitBeatEvent = Readonly<{ kind: "penalty" | "pack"; beat: "drumroll" | "moment" | "hush"; level: number }>;
/** Every sound name (audio-core.ts SFX_NAMES); audio.ts gives each one a voice (BQ-X4). */
export type { Sfx };
/** B5 pack reveal cues (the pack tearing; one per TRUE rarity on a card flip), voiced in audio.ts. */
export type PackSfx = Extract<Sfx, "pack-tear" | `rarity-${number}`>;

const RARITY_NAMES = ["Scuffed Ball", "Training Ball", "Match Ball", "Pro Ball", "Silver Ball", "Gold Ball", "Golden Boot Ball", "Warm-up Ball"];
/** Penalty: the run-up starts 3 m behind and 1.3 m left of the plant (gfx/kick.ts); the Friend plants just left of the ball. */
const roundPoint = ({ x, y }: { x: number; y: number }) => ({ x: Math.round(x), y: Math.round(y) });
const STRIKER = roundPoint(runupStart(PENALTY_VIEW)), KICK_SPOT = roundPoint(plantSpot(PENALTY_VIEW));

// ── Penalty flight ↔ physics (round 6 B4): one clock, one ball, one keeper ────────────
/** C2 instant replay state: what to restore, real seconds played / allowed, and the camera's focus (where it went in). */
type InstantReplay = { restore: { kind: Stage["kind"]; freeKick: Stage["freeKick"] }; t: number; limit: number; focus: { x: number; y: number } };
/** Seconds the penalty flight takes on screen (round 6 B3: 0.35–0.55 s by pace; target.time 0.4–0.95). */
export const penaltyFlight = (targetTime: number) => 0.35 + 0.2 * clamp01((targetTime - 0.4) / 0.55);
/**
 * Keeper plan-time shown `flightT` seconds after the strike. The on-screen flight is a uniform
 * time-lapse of the engine's, so at the crossing (flightT = flight) the Stage draws
 * keeperFrame(plan, target.time): the frame resolveShot tested the ball against.
 */
export const keeperClock = (targetTime: number, flight: number, flightT: number) => Math.min(targetTime + 0.3, (flightT / flight) * targetTime);
/** The keeper the Stage draws `flightT` seconds after a penalty strike (Stage.keeperFrameNow). */
export const penaltyKeeperFrame = (id: KeeperId, outcome: ShotOutcome, flight: number, flightT: number): KeeperFrame =>
  keeperFrame(id, outcome.plan, keeperClock(outcome.target.time, flight, flightT));
/** The penalty ball in goal-art px at flight progress p: from the spot (p = 0) to the engine's crossing point at BALL_RADIUS (p = 1). */
export function penaltyBallArt(target: { x: number; y: number }, curl: number, p: number) {
  const xf = PENALTY_GOAL, home = { x: GOAL.cx + (SPOT.x - xf.x) / xf.g, y: GOAL.line + (SPOT.y - xf.y) / xf.g };
  const end = artPoint({ x: target.x, y: target.y * GOAL_ASPECT }), bow = p >= 1 ? 0 : (flightAt(target, curl, p).x - target.x * p) * GOAL.unit;
  return { x: home.x + (end.x - home.x) * p + bow, y: home.y + (end.y - home.y) * p - (p >= 1 ? 0 : Math.sin(Math.PI * p) * 12 / xf.g), r: lerp(4.5 / xf.g, BALL_RADIUS * GOAL.unit, p) };
}

/** B7: flight progress the ribbon trail spans behind the ball (half under reduced motion: a short static streak). */
export const RIBBON_SPAN = 0.24, RIBBON_POINTS = 6;
/**
 * B7: the penalty ball as DRAWN on screen at flight progress p (0..1): penaltyBallArt through the goal transform,
 * its radius boosted for readability by flightRadius, so at p = 1 it is exactly the physics disc (BALL_RADIUS).
 */
export function penaltyBallDrawn(target: { x: number; y: number }, curl: number, p: number, xf: { g: number; x: number; y: number } = PENALTY_GOAL) {
  const art = penaltyBallArt(target, curl, p), at = applyGoal(xf, art);
  return { x: at.x, y: at.y, r: flightRadius(Math.max(1.2, art.r * xf.g), p) };
}
/** B7: ribbon points (head → tail) behind a penalty ball at flight progress p. */
export function penaltyRibbon(target: { x: number; y: number }, curl: number, p: number, reduced: boolean, xf: { g: number; x: number; y: number } = PENALTY_GOAL): RibbonPoint[] {
  const out: RibbonPoint[] = [], span = reduced ? RIBBON_SPAN / 2 : RIBBON_SPAN;
  for (let k = 0; k <= RIBBON_POINTS; k++) { const q = Math.max(0, p - (span * k) / RIBBON_POINTS); out.push(penaltyBallDrawn(target, curl, q, xf)); if (q <= 0) break; }
  return out;
}

// ── Free-kick flight ↔ physics (round 6 B4b): same keeper rig, same contact test ─────────
/** Seconds the free-kick flight takes on screen: the engine's own clock (so the keeper clock is the engine time). */
export const freeKickFlight = (outcome: FreeKickOutcome) => Math.max(0.3, outcome.path[outcome.path.length - 1].t);
/** A free kick as the Stage plays it (a wall block plays as a save). */
export const freeKickShot = (outcome: FreeKickOutcome): ShotOutcome =>
  ({ result: outcome.result === "wall" ? "save" : outcome.result, target: outcome.target, plan: outcome.keeper, zone: outcome.zone, postIn: false, touch: outcome.touch, hitPost: outcome.hitPost, hitBar: outcome.hitBar });
/**
 * The free-kick keeper the Stage draws `flightT` s after the strike (negative: his run-up shuffle): the engine's
 * own freeKickKeeperFrame, on the engine's clock (the flight plays 1:1), so at the crossing it is exactly the frame
 * resolveFreeKick tested. Held 0.3 s after the crossing, like penalties.
 */
export const freeKickKeeperFrameAt = (id: KeeperId, outcome: FreeKickOutcome, flightT: number): KeeperFrame =>
  freeKickKeeperFrame(id, outcome.keeperMotion, Math.min(outcome.target.time + 0.3, flightT));
/** Seconds before the strike the free-kick keeper starts his shuffle (the Stage draws his engine frame from then on). */
export const freeKickShuffleLead = (outcome: FreeKickOutcome) => outcome.keeperMotion.steps * FK_SHUFFLE_TIME;
/** Drawing-only hop of a shuffle or cross-step, px (0 under reduced motion; never while the ball can be at the line). */
export function freeKickStepHop(outcome: FreeKickOutcome, flightT: number, reduced: boolean) {
  const m = outcome.keeperMotion, lead = m.steps * FK_SHUFFLE_TIME;
  if (reduced || flightT >= outcome.target.time - 0.15) return 0;
  if (flightT >= -lead && flightT < 0) return Math.round(Math.abs(Math.sin(Math.PI * (flightT + lead) / FK_SHUFFLE_TIME)) * 2);
  if (m.stepEnd > m.commit && flightT >= m.commit && flightT < m.stepEnd) return Math.round(Math.abs(Math.sin(Math.PI * 2 * (flightT - m.commit) / (m.stepEnd - m.commit))) * 2);
  return 0;
}
const FK_MIN_BALL_PX = 1.4;
/**
 * The free-kick ball on SCREEN `since` s after the strike: the engine path (pathAt) through the FK
 * camera, eased onto the engine's crossing point and BALL_RADIUS in the drawn goal (goalTransform), so
 * at the crossing it is exactly the disc resolveFreeKick tested against keeperFrame(plan, target.time).
 */
export function freeKickBall(setup: FreeKickSetup, outcome: FreeKickOutcome, since: number) {
  const last = outcome.path[outcome.path.length - 1], at = fkProject(setup, pathAt(outcome.path, since));
  let x = at.x, y = at.y, r = Math.max(FK_MIN_BALL_PX, 0.11 * at.pxPerM);
  if (outcome.result !== "wall" && last.z >= Math.cos(setup.angle) * setup.distance) {
    const xf = goalTransform(setup), end = applyGoal(xf, artPoint({ x: outcome.target.x, y: outcome.target.y * GOAL_ASPECT })), from = fkProject(setup, last);
    const w = clamp01(since / (last.t || 1)) ** 3;
    x += (end.x - from.x) * w; y += (end.y - from.y) * w; r += (BALL_RADIUS * GOAL.unit * xf.g - Math.max(FK_MIN_BALL_PX, 0.11 * from.pxPerM)) * w;
  }
  return { x, y, r };
}

export class Stage {
  camera = new Camera();
  particles = new Particles(520);
  net = new Net();
  crowd: Crowd;
  time = 0;
  stadium: StadiumId = "park"; weather: Weather = "sun"; keeper: KeeperId = "squirrel";
  reduced = false;
  rarity = 7; streak = 0; score = 0; // streak: goals in a row, set by the game in its "resolved" handler (the Stage never counts it)
  layers: FriendLayers = { halo: "#ffffff", boots: "#111111", headband: null, cape: false, laced: 0 };
  celebration: CelebrationId = "knee-slide";
  friendName = "Your Friend";
  rows: RowsProvider = () => null;
  onEvent: (event: StageEvent, data?: unknown) => void = () => {};
  /** Aim reticle shown before the kick (goal-plane units). */
  reticle: { x: number; y: number; power: number; curl: number; active: boolean; alpha?: number } | null = null;
  ballVisible = false;
  /** Readable pre-kick tell (lean, scan, wall) for the current keeper and ball. */
  tell: KeeperPlan | null = null;
  /** What is being played: penalties, a free kick, or target practice (no keeper). */
  kind: "penalty" | "freekick" | "target" = "penalty";
  /** Free-kick scene: setup + wall geometry (from the engine). */
  freeKick: { setup: FreeKickSetup; wall: { x: number; halfWidth: number; side: number } } | null = null;
  /** Trajectory preview for free kicks (engine path) and its opacity (assist level). */
  preview: { path: readonly FlightSample[]; alpha: number } | null = null;
  /** Zone hints overlay opacity (tutorial). */
  hints = 0;
  /** Target practice rings (goal units). */
  targets: ReadonlyArray<{ x: number; y: number; r: number; value: number; hit?: boolean }> = [];
  /** Shot clock (seconds left / total), drawn around the ball while aiming. */
  clock: { left: number; total: number } | null = null;
  /** Jumbotron text (Pro / Champions), from game/prizes.ts jumbotronSlides. */
  jumbotron = "";
  /** Ad-board texts (null = the stadium's usual jokes). The free practice page passes its own. */
  boardText: readonly string[] | null = null;
  /** The chosen Big Match ball: lucky trail and its seasonal edition print (skill layer only). */
  lucky = false;
  season: "S0" | "S1" = "S1";
  /** The Match Director's line for the next resolve (else the plain result line). */
  cue: CommentaryContext | null = null;
  /** In-play call-outs on the pitch (the keeper's trailing-leg "leg!" telegraph). The cold-open reel turns them off. */
  callouts = true;
  /** Where the crowd's text banners were drawn last frame, in logical screen px (the reel keeps its titles off them). */
  crowdText: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }> = [];
  /** DEV (Showroom): draw the keeper hitbox and the ball at arrival over the scene. */
  debugHitbox = false;
  /** What the viewer actually saw (the 90-second QA reads this). */
  stats = { lines: new Set<string>(), contexts: new Set<string>(), celebrations: new Set<string>(), keepers: new Set<string>(), waves: 0, taunts: 0, shots: 0, goals: 0, saves: 0, woodwork: 0, reveals: 0, walkouts: 0, sfx: 0, walkOns: 0, replays: 0,
    /** Every line shown, with real-time seconds (the QA checks 0 repeats within 60 s). Bounded. */
    lineLog: [] as { text: string; at: number }[],
    /** The Friend sprite's drawn box (logical px, halo and boots included) on the last frame: QA overlap checks. */
    friendRect: null as { x1: number; y1: number; x2: number; y2: number } | null,
    /** The canvas SCORE box was drawn on the last frame (QA-7: only in a session). */
    scoreboard: false };

  private mode: "idle" | "shot" | "celebrate" | "react" | "walkout" = "idle";
  private modeTime = 0;
  private timeline = new Timeline();
  private shot: { outcome: ShotOutcome; curl: number; flight: number; strikeAt: number } | null = null;
  /** The most recent kick (kept after it ends, for the hitbox overlay). */
  private lastShot: { outcome: ShotOutcome; curl: number; flight: number; strikeAt: number } | null = null;
  private fk: FreeKickOutcome | null = null;
  private ball = { x: SPOT.x, y: SPOT.y, r: 4.5, spin: 0, squash: 0 };
  private flash = 0; private ring: { x: number; y: number; t: number } | null = null;
  private postWobble = 0; private goalFlash = 0;
  private bubble: { text: string; t: number } | null = null;
  private said: { text: string; t: number } | null = null;
  /** Logical y of the commentator strip; the shell lowers it below the DOM pot banner when they would overlap (BQ-P1-11). */
  commentaryTop = 26;
  private reveal: { rarity: number; t: number; plan: RevealPlan } | null = null;
  /** B5: the sealed pack tearing open (fixed length and colours: it never depends on the outcome). */
  private packTear: { t: number; count: number; burst: boolean } | null = null;
  /** B5: one lower ball's card flip on the Stage (its TRUE settled rarity, from revealPlan). */
  private flip: { t: number; plan: RevealPlan } | null = null;
  private scoreFlip = { from: 0, t: 1 };
  private reaction: "miss" | "save" | "post" = "miss";
  /** Reused glove-glint point (no per-frame allocation). */
  private glint = { t: 0, x: 0, y: 0 };
  private fanCatch: { x: number; t: number } | null = null;
  private ballKid: { t: number; x: number } | null = null;
  private lastRealFrame = 0;
  /** A keeper walk-on (surprise keeper, substitution, boss): the old keeper walks off, the new one walks on, then a taunt. */
  private walkOn: { from: KeeperId; t: number } | null = null;
  private walkOnFade = 0;
  /** A net-cam slow-mo replay of a stored outcome (skill-layer visual only: no events, stats or lines). */
  private replaying: { slow: number; label: string; keeper: KeeperId; instant?: InstantReplay } | null = null;
  /**
   * FD-3b: a wait for randomness. PENALTY: the shot is committed and the keeper has not decided yet (the
   * beacon seeds only his dive); PACK: the pack is sealed until its roll lands. Nothing about the outcome
   * exists while this runs. Instant randomness never shows it (WAIT_GRACE_MS).
   */
  private waiting: { kind: "penalty" | "pack"; t: number; expected: number; count: number; fired: Set<string>; nextDrum: number; nextClap: number; nextBeat: number; locked: { x: number; y: number } | null } | null = null;
  private clapT = 9;
  /** Part B game feel (B1/B2/B6): short-lived FX, the slow-mo rate limit, and this kick's close-call flags. */
  private feel = new FeelFx();
  private slowGate = new SlowMoGate();
  private feelKick = { slowmo: false, fingertip: false };
  /** Seconds left of the commentator "losing it" (tier-3 streak fever). */
  private hype = 0;

  constructor(options: Partial<Pick<Stage, "stadium" | "weather" | "keeper" | "reduced">> = {}) {
    Object.assign(this, options);
    this.crowd = new Crowd(this.stadium);
    this.net.color = this.stadium === "pro" ? "#ccff00" : "#e8e8e8";
    loadHeadFont();
  }

  // ── Configuration ─────────────────────────────────────────────────────────
  setStadium(id: StadiumId) { this.stadium = id; this.crowd = new Crowd(id); }
  setReduced(value: boolean) { this.reduced = value; this.camera.reduced = value; this.particles.budget = value ? 0.25 : 1; }
  get busy() { return this.mode !== "idle" || Boolean(this.reveal); }
  /** A moment a kick must not cut short: the walkout or a pack reveal sequence. */
  get moment() { return this.mode === "walkout" || Boolean(this.reveal) || Boolean(this.walkOn) || Boolean(this.replaying); }
  /** Seconds since the current kick was released (null when no kick is playing). */
  get kickClock() { return this.mode === "shot" && this.shot ? this.modeTime : null; }
  /** Abandon an in-flight kick WITHOUT emitting resolved/done (mode switch, redeemed ball). */
  cancel() { this.timeline.reset(); this.mode = "idle"; this.shot = null; this.walkOn = null; this.replaying = null; this.camera.targetZoom = 1; this.camera.targetX = W / 2; this.camera.targetY = H / 2; this.fk = null; this.reticle = null; this.preview = null; this.clock = null; this.ballVisible = true; this.cue = null; this.reveal = null; this.waiting = null; this.packTear = null; this.flip = null; this.feel.clear(); this.camera.punch = null; }

  // ── Waits for randomness (FD-3b) ───────────────────────────────────────────
  /** Start a wait: `expectedMs` paces it (0 = instant: nothing shows unless it runs late). */
  startWait(kind: "penalty" | "pack", expectedMs: number, count = 1) {
    const locked = kind === "penalty" && this.reticle ? this.goalPoint(toScreen(this.reticle.x, this.reticle.y)) : null;
    this.waiting = { kind, t: 0, expected: Math.max(0, expectedMs), count, fired: new Set(), nextDrum: 0, nextClap: WAIT_EVENTS.clapFrom, nextBeat: 0, locked };
    if (kind === "penalty") { this.clock = null; this.preview = null; if (this.reticle) this.reticle = { ...this.reticle, active: false }; }
  }
  /** End the wait (the randomness landed, or it was cancelled). Returns the seconds it ran. */
  endWait() {
    const wait = this.waiting; this.waiting = null;
    if (!wait) return 0;
    if (wait.kind === "penalty") this.reticle = null;
    if (wait.kind === "pack" && !this.reduced && waitCue(wait.t * 1000, wait.expected).visible) this.flash = 0.3;
    return wait.t;
  }
  get waitingFor() { return this.waiting?.kind ?? null; }
  /** The current wait's cue (Showroom/QA read-only). */
  waitCueNow(): WaitCue | null { return this.waiting ? waitCue(this.waiting.t * 1000, this.waiting.expected) : null; }
  private updateWait(dt: number) {
    const wait = this.waiting; if (!wait) return;
    wait.t += dt;
    const cue = waitCue(wait.t * 1000, wait.expected), once = (key: string, run: () => void) => { if (!wait.fired.has(key)) { wait.fired.add(key); run(); } };
    if (!cue.visible) return;
    const beat = (b: WaitBeatEvent["beat"], level: number) => this.onEvent("wait", { kind: wait.kind, beat: b, level } satisfies WaitBeatEvent);
    once("start", () => { this.crowd.react("tense"); this.sfx("heartbeat"); if (wait.kind === "pack") this.say("pack-wait"); });
    if (cue.drumroll > 0 && wait.t >= wait.nextDrum) { wait.nextDrum = wait.t + WAIT_EVENTS.drumTickEvery; beat("drumroll", cue.drumroll); }
    if (cue.hush) {
      once("hush", () => { this.crowd.react("tense"); beat("hush", 1); });
      if (wait.t >= wait.nextBeat) { wait.nextBeat = wait.t + 0.9; this.sfx("heartbeat"); }
    }
    if (wait.kind === "penalty" && this.kind !== "target") {
      if (cue.deciding) once("deciding", () => this.say("keeper-deciding"));
      if (cue.mindGames) {
        if (wait.t >= WAIT_EVENTS.taunt) once("taunt", () => this.taunt());
        if (wait.t >= WAIT_EVENTS.directorMoment) once("moment", () => beat("moment", cue.drumroll));
        if (wait.t >= wait.nextClap) { wait.nextClap = wait.t + WAIT_EVENTS.clapEvery; this.gloveClap(); }
      }
    }
    if (wait.kind === "pack" && cue.mindGames && wait.t >= 5) once("tease", () => this.say("pack-wait-long"));
  }
  /** Keeper mind-games: a glove clap (sound + a little burst between the gloves). */
  private gloveClap() {
    this.sfx("glove"); this.clapT = 0;
    const at = this.goalPoint({ x: GOAL.cx + Math.sin(this.time * 2.6) * 10, y: GOAL.line - 46 });
    if (!this.reduced) this.particles.emit("spark", at.x, at.y, 6, { color: ["#ffffff", "#ffd23f"], speed: 40, spread: Math.PI * 2, life: 0.3, gravity: 0 });
  }

  // ── Moments ───────────────────────────────────────────────────────────────
  say(context: CommentaryContext) {
    const now = (typeof performance === "undefined" ? Date.now() : performance.now()) / 1000;
    const text = freshCommentary(context, { friend: this.friendName, keeper: keeperById(this.keeper).name }, now);
    if (text === null) return; // every candidate was on screen in the last 60 s: stay quiet rather than repeat
    this.said = { text, t: 0 }; this.stats.lines.add(text); this.stats.contexts.add(context);
    this.stats.lineLog.push({ text, at: Math.round(now * 100) / 100 }); if (this.stats.lineLog.length > 500) this.stats.lineLog.shift();
  }
  /** Seconds a keeper walk-on takes (walk off, then walk on). Reduced motion: an instant swap with a short hold for the taunt. */
  static readonly WALK_OFF = 0.4; static readonly WALK_ON = 1.05;
  /** Swap the keeper with a short walk-off / walk-on and a taunt (a protected moment: no kick meanwhile). */
  keeperWalkOn(id: KeeperId) {
    if (id === this.keeper) return;
    const from = this.walkOn && this.walkOn.t < Stage.WALK_OFF ? this.walkOn.from : this.keeper;
    this.keeper = id; this.stats.walkOns++;
    this.walkOn = { from, t: this.reduced ? Stage.WALK_ON - 0.45 : 0 };
    this.crowd.react("ooh");
  }
  /** A keeper taunt bubble with its signature sound. */
  taunt() {
    const taunts = KEEPER_TAUNTS[this.keeper]; this.bubble = { text: taunts[Math.floor(Math.random() * taunts.length)], t: 0 };
    this.stats.taunts++; this.stats.keepers.add(this.keeper); this.sfx(KEEPER_DESIGNS[this.keeper].sfx as Sfx);
  }

  /** Play the whole choreographed shot for an already-resolved outcome. */
  play(outcome: ShotOutcome, curl: number, flightOverride?: number) {
    this.timeline.reset(); this.mode = "shot"; this.modeTime = 0; this.ballVisible = true; this.reticle = null; this.clock = null; this.preview = null;
    const live = !this.replaying;
    if (live) { this.stats.shots++; if (this.kind !== "target") this.stats.keepers.add(this.keeper); }
    if (flightOverride === undefined) this.fk = null;
    // Snappy (round 6 B3): strike 0.4 s after release, flight 0.35–0.55 s by power (target.time 0.4–0.95).
    const flight = flightOverride ?? penaltyFlight(outcome.target.time);
    this.shot = this.lastShot = { outcome, curl, flight, strikeAt: STRIKE_AT };
    this.feelPlan(outcome, live, flightOverride !== undefined);
    this.crowd.react("tense");
    this.camera.targetZoom = this.reduced ? 1 : 1.06; this.camera.targetY = H / 2 - 6;
    this.sfx("heartbeat"); if (live && (!this.said || this.said.t > 1.5)) this.say(keeperById(this.keeper).boss ? "boss" : "buildup");
    this.timeline
      .at(0, () => this.sfx("whistle"))
      .at(STRIKE_AT - HUSH.seconds, () => this.sfx("hush")) // the crowd hushes over the 150 ms before the strike
      .at(0.1, () => this.stepDust(0.1)).at(0.19, () => this.stepDust(0.19)).at(0.28, () => this.stepDust(0.28))
      .at(STRIKE_AT, () => {
        const ball = this.ballHome();
        this.feelStrike(ball, outcome); this.ring = { x: ball.x, y: ball.y, t: 0 };
        this.ball.squash = 0.35; this.camera.targetZoom = this.reduced ? 1 : 1.12;
        this.particles.emit("grass", ball.x, ball.y + 3, 10, { color: ["#2e7d32", "#8bc34a"], speed: 50, spread: 1.4, life: 0.5 });
        this.sfx("kick"); this.sfx("whoosh"); if (live) this.onEvent("strike");
        const k = KEEPER_DESIGNS[this.keeper].sfx; if (k === "stomp") { this.camera.addTrauma(0.3); this.sfx("stomp"); }
      })
      .at(STRIKE_AT + flight, () => this.resolve())
      // Next kick ready fast: a goal hands back control after 1.0 s while the celebration keeps
      // playing (the next strike cuts it); a miss after 1.3 s (the reaction beat has played).
      .at(STRIKE_AT + flight + handoverAfter(outcome.result), () => {
        if (this.replaying) { this.endReplay(); return; }
        if (this.kind === "target" || outcome.result !== "goal") { this.finish(); return; }
        this.startCelebration(this.celebration); this.onEvent("done");
      });
  }

  /**
   * Net-cam slow-mo replay of an already-resolved, stored outcome (first session: the best goal so far).
   * A skill-layer visual only: it re-plays what the engine decided earlier, emits no strike/resolved/done
   * events, counts no stats and says no line. Reduced motion: normal speed, no zoom, still captioned.
   */
  replay(outcome: ShotOutcome, curl: number, keeper: KeeperId = this.keeper, label = "NET-CAM REPLAY") {
    this.replaying = { slow: this.reduced ? 1 : 0.4, label, keeper: this.keeper }; this.stats.replays++;
    this.keeper = keeper; // the keeper who faced that kick (restored when the replay ends)
    this.kind = "penalty"; this.freeKick = null;
    this.play(outcome, curl);
  }
  get replayingNow() { return Boolean(this.replaying); }

  // ── Instant replay (C2): a short slow-mo re-play of a great goal from the net-cam (helpers only) ─────────
  /**
   * Re-plays an already-resolved goal (a skill-layer visual: no strike/resolved/done events, stats or lines),
   * from just before the strike, zoomed on where the ball went in, slowed so it lasts `seconds` of real time.
   * A free kick is re-played with ITS setup; the live kind/setup/keeper come back when it ends. It is a Stage
   * moment (nothing can shoot) until it ends or skipReplay() cuts it; both emit "replay-done".
   */
  instantReplay(options: { outcome: ShotOutcome; curl: number; keeper: KeeperId; freeKick?: { outcome: FreeKickOutcome; setup: FreeKickSetup }; label: string; seconds: number }) {
    const restore = { kind: this.kind, freeKick: this.freeKick }, from = STRIKE_AT - 0.08;
    const flight = options.freeKick ? freeKickFlight(options.freeKick.outcome) : penaltyFlight(options.outcome.target.time);
    const slow = Math.min(1, Math.max(0.3, (STRIKE_AT + flight + 0.3 - from) / options.seconds));
    this.replaying = { slow, label: options.label, keeper: this.keeper, instant: { restore, t: 0, limit: options.seconds, focus: { x: 0, y: 0 } } };
    this.stats.replays++;
    this.keeper = options.keeper;
    if (options.freeKick) { this.kind = "freekick"; this.freeKick = { setup: options.freeKick.setup, wall: options.freeKick.outcome.wall }; this.playFreeKick(options.freeKick.outcome); }
    else { this.kind = "penalty"; this.freeKick = null; this.play(options.outcome, options.curl); }
    this.replaying.instant!.focus = this.goalPoint(toScreen(options.outcome.target.x, options.outcome.target.y));
    this.modeTime = from; this.timeline.advance(from); // the run-up already played live: cut in just before the strike
  }
  /** Tap to skip: ends a replay now (emits "replay-done"). */
  skipReplay() { if (this.replaying) this.endReplay(); }
  private endReplay() {
    const instant = this.replaying?.instant;
    if (this.replaying) this.keeper = this.replaying.keeper;
    if (instant) { this.kind = instant.restore.kind; this.freeKick = instant.restore.freeKick; this.fk = null; this.ballVisible = true; this.timeline.reset(); }
    else this.ballVisible = false;
    this.replaying = null; this.mode = "idle"; this.shot = null;
    this.camera.targetZoom = 1; this.camera.targetX = W / 2; this.camera.targetY = H / 2;
    this.onEvent("replay-done");
  }
  /** Real-time length of an instant replay (paused Stage: no time passes). */
  private tickReplay(realDt: number) {
    const instant = this.replaying?.instant;
    if (instant && (instant.t += realDt) >= instant.limit) this.endReplay();
  }

  /** Free kick: the engine's flight path is the animation; "wall" plays as a block. */
  playFreeKick(outcome: FreeKickOutcome) {
    this.play(freeKickShot(outcome), 0, freeKickFlight(outcome));
    this.fk = outcome;
  }

  /** Where the ball rests before the kick (penalty spot, or the free-kick spot through the FK camera). */
  ballHome() { return this.kind === "freekick" && this.freeKick ? fkBall(this.freeKick.setup) : { x: SPOT.x, y: SPOT.y, scale: 1 }; }
  /** The goal group's placement: identity for penalties, true perspective for free kicks. */
  goalXf() { return this.kind === "freekick" && this.freeKick ? goalTransform(this.freeKick.setup) : PENALTY_GOAL; }
  private atmos: { key: string; value: Atmosphere } | null = null;
  /** Static stadium lighting around the goal (gfx/atmosphere.ts): the crowd band behind it and the floodlight pool. Same under reduced motion. */
  atmosphere(): Atmosphere {
    const fk = this.kind === "freekick" && this.freeKick, xf = this.goalXf(), grassTop = (fk ? 0 : BACKDROP_DROP) + 102;
    const key = `${this.stadium}|${this.weather}|${xf.g}|${xf.x}|${xf.y}|${grassTop}`;
    if (this.atmos?.key !== key) this.atmos = { key, value: atmosphereParams(this.stadium, this.weather, xf, grassTop) };
    return this.atmos.value;
  }
  /** A point in goal-art coordinates → screen. */
  goalPoint(p: { x: number; y: number }) { return applyGoal(this.goalXf(), p); }

  private resolve() {
    const shot = this.shot!, result = shot.outcome.result, art = toScreen(shot.outcome.target.x, shot.outcome.target.y), end = this.goalPoint(art);
    if (this.fk?.result === "wall") {
      const hit = fkProject(this.freeKick!.setup, this.fk.path[this.fk.path.length - 1]);
      this.crowd.react("ooh"); this.say(this.cue ?? "wall"); this.cue = null; this.stats.saves++; this.onEvent("resolved", "wall"); this.reaction = "save";
      this.camera.addTrauma(0.3); this.camera.hitStop = 2 / 60; this.sfx("glove"); this.sfx("ooh");
      this.particles.emit("dust", hit.x, hit.y, 12, { color: ["#ffffff", "#c8b99a"], speed: 60, spread: Math.PI * 2, life: 0.4 });
      this.scoreFlip = { from: this.score, t: 0 };
      return;
    }
    this.crowd.react(result === "goal" ? "cheer" : result === "post" || result === "over" ? "ooh" : "groan");
    if (this.replaying) { // the replay: net ripple and confetti only (no line, no stats, no events)
      if (result === "goal") { this.net.impulse(art.x, art.y, 160); this.particles.emit("confetti", end.x, end.y - 10, 30, { color: THEMES[this.stadium].confetti, speed: 120, spread: Math.PI * 1.2, gravity: 70, life: 2 }); this.sfx("net"); }
      return;
    }
    // Woodwork: the crossbar when the engine says the ball touched it (round 6 C13; BQ-P2-8: its flag, not the height).
    const said = this.cue ?? this.feelLine(shot.outcome), bar = result === "post" && Boolean(shot.outcome.hitBar);
    this.say(bar && (said === "post" || said === "near-miss") ? "crossbar" : said); this.cue = null;
    if (result === "goal") this.stats.goals++; else if (result === "save") this.stats.saves++; else if (result === "post") this.stats.woodwork++;
    this.onEvent("resolved", result);
    this.camera.targetZoom = 1; this.camera.targetY = H / 2;
    if (this.kind === "target") {
      this.crowd.react(result === "goal" ? "cheer" : "ooh"); this.sfx(result === "goal" ? "net" : "ooh");
      if (result === "goal") this.particles.emit("confetti", end.x, end.y, 24, { color: THEMES[this.stadium].confetti, speed: 90, spread: Math.PI * 2, gravity: 60, life: 1.2 });
      return;
    }
    if (result === "goal") {
      this.goalFlash = 2;
      this.feelGoal(shot.outcome, art, end);
      this.particles.emit("thread", end.x, end.y, 8, { color: "#ffffff", speed: 60, life: 0.5, gravity: 60 });
      this.sfx("net"); this.sfx("roar");
      if (this.streak >= 2) this.sfx("chant"); // the game owns streak: its "resolved" handler has already set it (BQ-P1-1)
      this.feelFever();
    } else {
      this.reaction = result === "post" ? "post" : result === "save" ? "save" : "miss";
      if (result === "save") {
        this.particles.emit("spark", end.x, end.y, 16, { color: ["#ffffff", "#ffd23f"], speed: 90, spread: Math.PI * 2, life: 0.4, gravity: 0 });
        if (this.keeper === "octopus") this.particles.emit("ink", end.x, end.y, 20, { color: "#1a0f2e", speed: 40, spread: Math.PI * 2, life: 1, gravity: 20, size: 2 });
        const taunts = KEEPER_TAUNTS[this.keeper]; this.bubble = { text: taunts[Math.floor(Math.random() * taunts.length)], t: 0 }; this.stats.taunts++;
        this.sfx("glove"); this.sfx("groan"); this.sfx(KEEPER_DESIGNS[this.keeper].sfx as Sfx);
        this.feelSave(end);
      } else if (result === "post") {
        this.sfx("clang"); this.sfx("ooh");
        this.feelPost(shot.outcome, art);
      } else if (result === "over") { this.fanCatch = { x: end.x + (end.x - 240) * 0.5, t: 0 }; this.sfx("ooh"); }
      else { this.ballKid = { t: 0, x: end.x > 240 ? W + 10 : -10 }; this.sfx("groan"); }
      if ((result === "wide" || result === "over") && nearFrame(shot.outcome.target)) this.feelSoClose();
    }
    this.scoreFlip = { from: this.score, t: 0 };
  }

  startCelebration(id: CelebrationId) { this.celebration = id; this.mode = "celebrate"; this.modeTime = 0; this.ballVisible = false; this.crowd.react("cheer"); this.stats.celebrations.add(id); }
  react(kind: "miss" | "save" | "post") { this.reaction = kind; this.mode = "react"; this.modeTime = 0; }
  walkout(line: CommentaryContext = "walkout") { this.stats.walkouts++; this.mode = "walkout"; this.modeTime = 0; this.crowd.react("cheer"); this.sfx("chant"); this.say(line); }
  /** ETHICS: the reveal is driven ONLY by a RevealPlan built from the settled outcome (game/reveal.ts). */
  showReveal(plan: RevealPlan) {
    this.packTear = null; this.flip = null;
    this.reveal = { rarity: plan.rarity, t: 0, plan }; this.rarity = plan.rarity; this.stats.reveals++;
    this.onEvent("reveal", plan); this.sfx(plan.fullScreen ? "reveal-top" : "reveal");
    if (plan.rarity >= 5) this.say(plan.fullScreen ? "rarity-top" : "rarity-high");
    if (plan.fullScreen) { this.crowd.react("cheer"); this.sfx("roar"); }
  }
  /** B5: the sealed pack tears open (PACK_TEAR_MS). Same art, length and colours for every pack: it shows nothing of the outcome. */
  showPackTear(count: number) { this.reveal = null; this.flip = null; this.packTear = { t: 0, count, burst: false }; this.sfx("pack-tear"); }
  /** B5: a lower ball's card flips on the Stage: a quick pop with a glow in its TRUE rarity's colour (ETHICS: only `plan.rarity` is drawn). */
  flipBall(plan: RevealPlan) { this.packTear = null; this.flip = { t: 0, plan }; this.sfx(`rarity-${plan.rarity}` as PackSfx); }
  /** The Mexican wave; its line only when the box is free (a goal's result line is never cut short). */
  wave() { this.crowd.startWave(); this.crowd.react("cheer"); this.stats.waves++; if (!this.said || this.said.t > 1.2) this.say("wave"); }
  /** QA-7: the SCORE box belongs to a session; the shell hides it on the title, the modes screen and a pack reveal. */
  scoreboard = false;
  setScore(score: number) { if (score !== this.score) { this.scoreFlip = { from: this.score, t: 0 }; this.score = score; } }
  private finish() { this.mode = "idle"; this.shot = null; this.ballVisible = false; this.onEvent("done"); }
  /** The view the taker runs up in (the penalty camera, or this free kick's camera). */
  kickView(): KickView { return this.kind === "freekick" && this.freeKick ? freeKickView(this.freeKick.setup) : PENALTY_VIEW; }
  /** The taker's pose `t` s after release (the Showroom's slow replay and the geometry test read this). */
  kickPose(t: number): KickPose { return kickPose(this.kickView(), t); }
  /**
   * B11: the Friend's in-flight fade and whole-pixel offset now (null outside a shot). Live and replayed kicks
   * run the same shot clock, so a replay eases aside exactly like the live kick. It holds through the payoff and
   * the reaction beat (strike + flight + 0.1 s, drawn under it) while the result banner is up, until the shot hands
   * over: the celebration (which, like every react/celebrate mode, draws at full opacity) or the banner's end.
   */
  get friendAsideNow(): FriendAside | null {
    const shot = this.mode === "shot" ? this.shot : null;
    return shot ? friendAside(this.modeTime - shot.strikeAt, shot.flight, this.kickPose(this.modeTime).scale, this.reduced, handoverAfter(shot.outcome.result)) : null;
  }
  private stepDust(t: number) { const pose = this.kickPose(t); this.dust(pose.x, pose.y); }
  private dust(x: number, y: number) { this.particles.emit("dust", x, y, 5, { color: ["#c8b99a", "#a89878"], speed: 25, spread: 1.6, life: 0.5, gravity: -10 }); }
  private sfx(name: Sfx | PackSfx) { this.stats.sfx++; this.onEvent("sfx", name); }

  // ── Update ────────────────────────────────────────────────────────────────
  update(realDt: number) {
    this.updateWait(realDt); this.clapT += realDt; this.tickReplay(realDt);
    if (this.camera.hitStop > 0) { this.camera.hitStop -= realDt; return; }
    // Slow-mo (skill layer only, B2): 0.3× on the last ~400 ms of a genuine close call, at most 1 kick in 3, snapping back at impact.
    let slow = 1;
    const shot = this.shot;
    if (shot && this.mode === "shot" && this.feelKick.slowmo && !this.reduced) slow = slowMoRate(this.modeTime - shot.strikeAt, shot.flight, shot.strikeAt);
    if (this.replaying && this.mode === "shot") {
      slow = Math.min(slow, this.replaying.slow);
      if (!this.reduced) { const goal = this.replaying.instant?.focus ?? this.goalPoint(toScreen(0, 0.5)); this.camera.targetX = goal.x; this.camera.targetY = goal.y; this.camera.targetZoom = this.replaying.instant ? 1.7 : 1.5; }
    }
    const dt = realDt * this.camera.timeScale * slow;
    this.time += dt; this.modeTime += dt;
    if (this.mode === "shot") this.timeline.advance(dt);
    this.camera.update(dt); this.particles.update(dt); this.net.update(dt); this.crowd.update(dt);
    this.flash = Math.max(0, this.flash - dt * 3); this.postWobble = Math.max(0, this.postWobble - dt * 1.5); this.goalFlash = Math.max(0, this.goalFlash - dt);
    this.ball.squash = Math.max(0, this.ball.squash - dt * 4);
    this.feel.update(dt); this.hype = Math.max(0, this.hype - dt);
    if (this.ring) { this.ring.t += dt; if (this.ring.t > 0.5) this.ring = null; }
    if (this.bubble) { this.bubble.t += dt; if (this.bubble.t > 2.2) this.bubble = null; }
    if (this.said) { this.said.t += dt; if (this.said.t > 3.2) this.said = null; }
    if (this.scoreFlip.t < 1) this.scoreFlip.t += dt * 2.2;
    if (this.fanCatch) { this.fanCatch.t += dt; if (this.fanCatch.t > 2) this.fanCatch = null; }
    if (this.ballKid) { this.ballKid.t += dt; if (this.ballKid.t > 2.4) this.ballKid = null; }
    if (this.reveal) { this.reveal.t += dt; if (this.reveal.t > this.reveal.plan.duration) { this.reveal = null; this.onEvent("reveal-done"); } }
    if (this.packTear) {
      this.packTear.t += dt;
      if (!this.packTear.burst && this.packTear.t >= TEAR_OPEN) { this.packTear.burst = true; if (!this.reduced) this.particles.emit("sparkle", W / 2, PACK_Y - 36, 26, { color: ["#ffd23f", "#ffffff", "#ff8c00"], speed: 110, spread: Math.PI * 2, gravity: 60, life: 0.9 }); }
      if (this.packTear.t > TEAR_SECONDS + 0.35) this.packTear = null; // the halves finish falling away under the first flip
    }
    if (this.flip) { this.flip.t += dt; if (this.flip.t > FLIP_SECONDS) this.flip = null; }
    if (this.mode === "celebrate" && this.modeTime > 2.6) { this.mode = "idle"; this.shot = null; } // "done" was already sent
    if (this.mode === "react" && this.modeTime > 1.6) { this.mode = "idle"; this.onEvent("done"); }
    if (this.mode === "walkout" && this.modeTime > 3) { this.mode = "idle"; this.onEvent("walkout-done"); }
    if (this.walkOn) {
      this.walkOn.t += realDt;
      if (this.walkOn.t >= Stage.WALK_ON) { this.walkOn = null; this.walkOnFade = 0.9; this.taunt(); this.onEvent("walkon-done"); }
    } else if (this.walkOnFade > 0) this.walkOnFade = Math.max(0, this.walkOnFade - dt);
    if (this.keeper === "sloth" && Math.random() < dt * 0.6) { const z = this.goalPoint({ x: GOAL.cx + 14, y: GOAL.line - 60 }); this.particles.emit("zzz", z.x, z.y, 1, { color: "#ffffff", speed: 8, angle: -1.2, spread: 0.3, life: 1.5, gravity: -6 }); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  render(c: CanvasRenderingContext2D) {
    plainText(c); // no Pixelify fi/fl ligatures ("Arst go"): see core.ts
    c.save();
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b0d1a"; c.fillRect(0, 0, W, H);
    const screen = c.getTransform().inverse(); // device px → logical screen px (the crowd's banner rects)
    this.camera.apply(c, this.time);
    const pan = (this.camera.x - W / 2) * 2;
    const wind = this.kind === "freekick" && this.freeKick ? this.freeKick.setup.wind : 0;
    this.crowd.wind = wind; this.crowd.rows = this.rows; // the stands fill with little copies of the player's own Friend
    const fk = this.kind === "freekick" && this.freeKick ? this.freeKick : null;
    // Penalty camera (round 6 B1): the stands sit just behind the goal, so the whole backdrop layer
    // (sky, stands, crowd, boards, grass stripes) drops until the boards end ~30 px above the goal line.
    const drop = fk ? 0 : BACKDROP_DROP;
    if (drop) { c.fillStyle = THEMES[this.stadium].sky[0]; c.fillRect(-40, -40, W + 80, drop + 40); }
    c.save(); c.translate(0, drop);
    const backdropEvents = { goalFlash: this.goalFlash, jumbotron: this.jumbotron, wind, drop, reduced: this.reduced };
    drawBackdrop(c, this.stadium, this.weather, this.time, pan, backdropEvents);
    this.crowd.draw(c, this.time, pan, this.particles, this.reduced);
    this.crowdText = this.crowd.textRects.map(r => { const p = screen.transformPoint({ x: r.x1, y: r.y1 }), q = screen.transformPoint({ x: r.x2, y: r.y2 }); return { x1: p.x, y1: p.y, x2: q.x, y2: q.y }; })
      .filter(r => [r.x1, r.y1, r.x2, r.y2].every(Number.isFinite));
    this.drawFan(c);
    this.feel.drawChant(c, 72, this.time, this.reduced, this.stadium === "pro" ? "#ccff00" : "#ffd23f");
    drawBoards(c, this.stadium, this.time, pan, this.boardText ?? undefined);
    drawPitch(c, this.stadium, this.weather);
    drawStadiumFx(c, this.stadium, this.weather, this.time, pan, backdropEvents); // round 6 E22: stadium set pieces behind the goal
    c.restore();
    drawAtmosphere(c, this.atmosphere()); // darker crowd band behind the goal + floodlight pool on the goal mouth (pre-rendered, static)
    if (fk) drawPitchMarkings(c, fk.setup, THEMES[this.stadium].lines, fk.wall, this.time);
    else drawPitchMarkings(c, PENALTY_SETUP, THEMES[this.stadium].lines, null, this.time, PENALTY_CAMERA);
    drawHeatShimmer(c, this.reduced ? 0 : [0, 0.55, 0.85, 1][feverTier(this.streak)], this.time); // B6: from 3 in a row
    this.drawReferee(c);
    const xf = this.goalXf();
    c.save();
    if (xf.g !== 1) { c.translate(xf.x, xf.y); c.scale(xf.g, xf.g); c.translate(-GOAL.cx, -GOAL.line); }
    this.net.draw(c);
    drawZoneHints(c, this.hints);
    const ballBehind = !fk && this.ballBehindKeeper();
    if (ballBehind) this.drawBallLayer(c);
    if (this.kind !== "target") this.drawKeeperLayer(c);
    drawGoalFrame(c, this.reduced ? 0 : this.postWobble, this.time);
    if (this.kind === "target") { drawCrossbarGlow(c, this.time); drawTargets(c, this.targets, this.time, this.reduced); }
    c.restore();
    if (this.kind === "freekick" && this.freeKick) {
      const { setup, wall } = this.freeKick, since = this.shot && this.mode === "shot" ? this.modeTime - this.shot.strikeAt : null;
      const beyond = this.fk && since !== null && since >= 0 && pathAt(this.fk.path, since).z > Math.cos(setup.angle) * WALL_DISTANCE;
      if (beyond && !ballBehind) this.drawBallLayer(c);
      drawWall(c, setup, wall, since !== null && since >= 0 ? since : null, this.reduced, this.stadium, this.time);
      if (this.preview && this.mode === "idle") drawPreview(c, setup, this.preview.path, this.preview.alpha);
      if (!beyond && !ballBehind) this.drawBallLayer(c);
    }
    this.drawReticle(c);
    this.crowd.drawCat(c, 1 / 60);
    const friendFirst = ballBehind;
    if (friendFirst) this.drawFriendLayer(c);
    if (!ballBehind && this.kind !== "freekick") this.drawBallLayer(c);
    if (!friendFirst) this.drawFriendLayer(c);
    if (this.clock && this.mode === "idle" && this.ballVisible) { const home = this.ballHome(); drawClock(c, home.x, home.y - 4, this.clock.left, this.clock.total, this.time); }
    this.drawBallKid(c);
    this.particles.draw(c);
    this.feel.drawWorld(c, this.reduced);
    if (this.ring) { c.strokeStyle = `rgba(255,255,255,${1 - this.ring.t / 0.5})`; c.lineWidth = 2; c.beginPath(); c.ellipse(this.ring.x, this.ring.y, 6 + this.ring.t * 70, 3 + this.ring.t * 25, 0, 0, Math.PI * 2); c.stroke(); }
    drawWeather(c, this.weather, this.stadium, this.time, this.particles, 1 / 60, this.reduced);
    c.restore();
    // Screen-space UI on the canvas.
    this.drawScoreboard(c);
    this.drawCommentary(c);
    this.feel.drawUI(c, this.reduced, this.time);
    this.drawBubble(c);
    if (this.mode === "walkout") this.drawWalkout(c);
    if (this.replaying) this.drawReplayCaption(c);
    if (this.waiting) {
      const cue = waitCue(this.waiting.t * 1000, this.waiting.expected);
      if (this.waiting.kind === "pack" && cue.visible) drawSealedPack(c, cue, this.time, this.waiting.count, this.reduced, RARITY_FX[7] ?? RARITY_FX[0]);
      else if (this.waiting.kind === "penalty") drawPenaltyWait(c, cue, this.time, this.waiting.locked);
    }
    if (this.packTear) drawPackTear(c, this.packTear.t, this.packTear.count, this.time, this.reduced, RARITY_FX[7] ?? RARITY_FX[0]);
    if (this.flip) this.drawFlip(c);
    if ((this.packTear || this.flip) && !this.reveal) this.particles.draw(c); // the tear's sparkles over its dim layer
    if (this.reveal) this.drawReveal(c);
    if (this.flash > 0) { c.fillStyle = `rgba(255,255,255,${this.flash})`; c.fillRect(0, 0, W, H); }
    if (this.rarity === 6 && this.ballVisible && !this.reduced) { const glow = 0.25 + 0.15 * Math.sin(this.time * 6); c.strokeStyle = `rgba(255,140,0,${glow})`; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6); }
  }

  private ballBehindKeeper() {
    if (!this.shot || this.mode !== "shot") return false;
    const p = (this.modeTime - this.shot.strikeAt) / this.shot.flight;
    return p > 0.9 && this.shot.outcome.result === "goal";
  }

  private keeperPose(): KeeperPose {
    const profile = keeperById(this.keeper), design = KEEPER_DESIGNS[this.keeper];
    const shot = this.shot;
    const scaleMul = profile.boss ? 1 : 1;
    const start = this.kind === "freekick" && this.freeKick ? -this.freeKick.wall.side * 0.3 : 0;
    let gx = start + Math.sin(this.time * 2.2) * 0.1, gy = 0, rotate = 0, stretch = 1, mood: KeeperPose["mood"] = "idle", alpha = 1;
    const bounce = Math.abs(Math.sin(this.time * 5)) * 3;
    let lift = this.reduced ? 0 : bounce;
    if (this.tell && this.mode !== "shot") { gx += this.tell.lean * 0.15; if (this.keeper === "peacock" || this.keeper === "squirrel") mood = "taunt"; }
    // FD-3b mind-games while the keeper decides: a bigger sway, a taunt pose on every glove clap (no lean: nothing is decided yet).
    const deciding = this.waiting?.kind === "penalty" && this.mode === "idle" ? waitCue(this.waiting.t * 1000, this.waiting.expected) : null;
    if (deciding?.mindGames) { gx += this.reduced ? 0 : Math.sin(this.time * 2.6) * 0.14; if (this.clapT < 0.35) mood = "taunt"; }
    if (shot && this.mode === "shot") {
      const flightT = this.modeTime - shot.strikeAt;
      if (flightT < 0) {
        mood = this.modeTime < 0.7 ? "taunt" : "idle"; gx += shot.outcome.plan.lean * 0.12;
        // Settle onto the home spot during the run-up, so the dive starts from the physics' standing frame.
        const settle = 1 - clamp01(this.modeTime / shot.strikeAt); gx = start + (gx - start) * settle; lift *= settle;
        // The last beat before a penalty strike: the ready crouch, pixel-identical to the physics' set pose.
        if (!this.fk && this.modeTime > shot.strikeAt - 0.2) mood = "set";
      } else {
        // Free kicks (penalties draw the engine's KeeperFrame instead, see drawKeeperLayer).
        const hands = keeperAt(shot.outcome.plan, keeperClock(shot.outcome.target.time, shot.flight, flightT));
        gx = start + (shot.outcome.plan.x - start) * hands.progress * 0.85; gy = Math.max(0, hands.y - 0.45) * 0.7 * hands.progress; lift = gy * 60;
        rotate = Math.atan2(hands.x, 0.9) * hands.progress * 1.3; stretch = 1 + hands.progress * 0.15; mood = hands.progress > 0.05 ? "dive" : "idle";
        if (flightT > shot.flight + 0.2) mood = shot.outcome.result === "goal" ? "sad" : "celebrate";
        if (shot.outcome.plan.teleport && hands.progress > 0) rotate = 0;
      }
    }
    alpha = this.keeperAlpha();
    const [armL, armR] = keeperArms(this.keeper, mood, this.time, shot?.outcome.plan.x ?? 0, shot?.outcome.plan.y ?? 0.4);
    const { x } = toScreen(gx, 0);
    void design;
    return { x, y: GOAL.line - lift, rotate, stretch, armL, armR, alpha, scaleMul, mood, reduced: this.reduced, lean: this.tell?.lean ?? 0 };
  }

  private keeperAlpha() {
    const shot = this.shot;
    if (this.walkOn) return 1; // a walk-on is always visible (even Chroma), then fades back to its camouflage
    if (this.walkOnFade > 0 && this.keeper === "chameleon" && !(shot && this.mode === "shot")) return Math.max(0.12, this.walkOnFade / 0.9);
    if (this.keeper === "ghost") return 0.7 + 0.2 * Math.sin(this.time * 8);
    if (this.keeper === "chameleon") return shot && this.mode === "shot" && this.modeTime >= shot.strikeAt ? 1 : 0.12 + 0.06 * Math.sin(this.time * 3);
    return 1;
  }

  /** The keeper during a penalty or free-kick flight: the engine's KeeperFrame (null outside a shot in flight). */
  keeperFrameNow(): KeeperFrame | null {
    const shot = this.shot;
    if (!shot || this.mode !== "shot" || this.kind === "target" || Boolean(this.fk) !== (this.kind === "freekick")) return null;
    const flightT = this.modeTime - shot.strikeAt;
    if (this.fk) return flightT < -freeKickShuffleLead(this.fk) ? null : freeKickKeeperFrameAt(this.keeper, this.fk, flightT);
    return flightT < 0 ? null : penaltyKeeperFrame(this.keeper, shot.outcome, shot.flight, flightT);
  }

  private drawKeeperLayer(c: CanvasRenderingContext2D) {
    const frame = this.keeperFrameNow();
    if (frame) { this.drawDivingKeeper(c, frame); this.drawHitboxOverlay(c, frame); return; }
    const pose = this.keeperPose();
    if (this.walkOn) { // walk-off (the old keeper exits right), then walk-on (the new keeper enters from the left)
      const t = this.walkOn.t, off = t < Stage.WALK_OFF;
      const k = off ? ease.inQuad(clamp01(t / Stage.WALK_OFF)) : 1 - ease.outCubic(clamp01((t - Stage.WALK_OFF) / (Stage.WALK_ON - Stage.WALK_OFF - 0.15)));
      const gx = off ? k * 2.6 : -k * 2.6, dx = toScreen(gx, 0).x - toScreen(0, 0).x, step = this.reduced ? 0 : Math.abs(Math.sin(t * 14)) * 3;
      drawKeeper(c, off ? this.walkOn.from : this.keeper, { ...pose, x: pose.x + dx, y: pose.y - step, rotate: 0, stretch: 1, alpha: 1, mood: off ? "sad" : k > 0.05 ? "idle" : "taunt" }, this.time);
      return;
    }
    // Signature FX behind the keeper.
    // (Peacock's fan is part of his sprite now and leans with pose.lean, the tell.)
    if (this.keeper === "disco" && !this.reduced) { const colors = ["#ff4fd8", "#ccff00", "#7fd3ff"]; for (let i = 0; i < 6; i++) { c.fillStyle = colors[(Math.floor(this.time * 4) + i) % 3] + "55"; c.fillRect(GOAL.left + i * 30, GOAL.bar + ((i * 13 + Math.floor(this.time * 8)) % 60), 20, 3); } }
    if (this.keeper === "finalwall") { c.fillStyle = `rgba(255,59,31,${0.15 + 0.1 * Math.sin(this.time * 4)})`; c.fillRect(pose.x - 40, GOAL.bar, 80, GOAL.line - GOAL.bar); }
    const drawn = drawKeeper(c, this.keeper, pose, this.time);
    // Tells in front.
    if (this.keeper === "robot" && this.tell?.scan) { c.fillStyle = "#ff5a6e88"; const sx = GOAL.cx + this.tell.scan * 60; c.fillRect(sx - 30, GOAL.bar + ((this.time * 60) % (GOAL.line - GOAL.bar)), 60, 2); }
    if (this.keeper === "mime" && this.tell?.wall) this.drawMimeWall(c, this.tell.wall, 0);
    void drawn;
    this.drawHitboxOverlay(c, null);
  }

  /** Mime's wall: the faint shimmer tell; it flashes solid when it stops the ball. */
  private drawMimeWall(c: CanvasRenderingContext2D, wall: readonly [number, number], flash: number) {
    const x1 = toScreen(Math.max(-1, wall[0]), 0).x, x2 = toScreen(Math.min(1, wall[1]), 0).x;
    c.fillStyle = `rgba(255,255,255,${0.08 + 0.05 * Math.sin(this.time * 5) + 0.35 * flash})`; c.fillRect(x1, GOAL.bar, x2 - x1, GOAL.line - GOAL.bar);
    c.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * flash})`; c.fillRect(x1, GOAL.bar, 1, GOAL.line - GOAL.bar); c.fillRect(x2 - 1, GOAL.bar, 1, GOAL.line - GOAL.bar);
  }

  /** A penalty dive, drawn from the same KeeperFrame the physics resolved (sprite, arms, gloves, trailing leg, wall). */
  private drawDivingKeeper(c: CanvasRenderingContext2D, frame: KeeperFrame) {
    const shot = this.shot!, flightT = this.modeTime - shot.strikeAt, after = flightT - shot.flight, centre = artPoint(frame);
    if (this.keeper === "disco" && !this.reduced) { const colors = ["#ff4fd8", "#ccff00", "#7fd3ff"]; for (let i = 0; i < 6; i++) { c.fillStyle = colors[(Math.floor(this.time * 4) + i) % 3] + "55"; c.fillRect(GOAL.left + i * 30, GOAL.bar + ((i * 13 + Math.floor(this.time * 8)) % 60), 20, 3); } }
    if (this.keeper === "finalwall") { c.fillStyle = `rgba(255,59,31,${0.1 + 0.06 * Math.sin(this.time * 4)})`; c.fillRect(centre.x - 40, GOAL.bar, 80, GOAL.line - GOAL.bar); }
    if (frame.wall) this.drawMimeWall(c, frame.wall, after >= 0 && shot.outcome.touch === "wall" ? clamp01(1 - after / 0.8) : 0);
    const mood = after > 0.2 ? (shot.outcome.result === "goal" ? "sad" : "celebrate") : null;
    // A glove save glints on the glove that made it (a flourish on top: never part of the hitbox).
    let glint: { t: number; x: number; y: number } | undefined;
    if (shot.outcome.result === "save" && shot.outcome.touch === "glove" && after >= 0 && after < GLINT_SECONDS) {
      const ball = penaltyBallArt(shot.outcome.target, shot.curl, 1); glint = this.glint; glint.t = after; glint.x = ball.x; glint.y = ball.y;
    }
    // Free kicks: a small hop on each shuffle / cross-step (drawing only; never near the crossing, none under reduced motion).
    const hop = this.fk ? freeKickStepHop(this.fk, flightT, this.reduced) : 0;
    if (hop) { c.save(); c.translate(0, -hop); }
    drawKeeperFrame(c, frame, {
      alpha: this.keeperAlpha(), arms: mood ? keeperArms(this.keeper, mood, this.time, shot.outcome.plan.x, shot.outcome.plan.y) : undefined,
      after: after >= 0 ? after : undefined, mood: mood ?? undefined, time: flightT, reduced: this.reduced, glint,
    });
    if (hop) c.restore();
    // Tipped over: fingertip sparks where the ball met the glove (a flourish after the crossing, off under reduced motion).
    if (this.fk?.tipOver && !this.reduced && after >= 0 && after < 0.35) {
      const at = artPoint({ x: shot.outcome.target.x, y: shot.outcome.target.y * GOAL_ASPECT }), k = after / 0.35;
      c.fillStyle = `rgba(255,255,255,${1 - k})`;
      for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + (i - 1.5) * 0.6, d = 3 + k * 7; c.fillRect(Math.round(at.x + Math.cos(a) * d), Math.round(at.y + Math.sin(a) * d), 2, 2); }
    }
    // Telegraph the trailing leg: a "leg!" call-out on the boot whenever it is out, bold when it made the save.
    const legMade = this.modeTime - shot.strikeAt >= shot.flight && shot.outcome.touch === "leg";
    if (this.callouts && frame.leg && frame.progress > 0.35 && (legMade || Math.hypot(frame.leg.foot.x - frame.leg.hip.x, frame.leg.foot.y - frame.leg.hip.y) > 0.18)) {
      const foot = artPoint(frame.leg.foot), made = legMade;
      c.font = "10px PixelifySans, monospace"; c.textAlign = "center";
      c.fillStyle = made ? "#0b0d1a" : "#0b0d1a99"; c.fillText(made ? "LEG!" : "leg!", foot.x + 1, foot.y - 8);
      c.fillStyle = made ? "#ffd23f" : "#ffffffaa"; c.fillText(made ? "LEG!" : "leg!", foot.x, foot.y - 9);
      c.textAlign = "left";
    }
  }

  /**
   * Showroom debug overlay (stage.debugHitbox): the keeper hitbox now (cyan), the keeper at the
   * ball's arrival (magenta) and the ball at arrival (red = save, green = goal). Goal-art coords.
   */
  private drawHitboxOverlay(c: CanvasRenderingContext2D, now: KeeperFrame | null) {
    if (!this.debugHitbox || this.kind !== "penalty") return;
    const shot = this.lastShot;
    if (now) this.strokeFrame(c, now, "#00e5ff");
    if (!shot || this.fk) return;
    const arrival = keeperFrame(this.keeper, shot.outcome.plan, shot.outcome.target.time);
    this.strokeFrame(c, arrival, "#ff4fd8");
    const ball = penaltyBallArt(shot.outcome.target, shot.curl, 1), save = shot.outcome.result === "save";
    c.strokeStyle = save ? "#ff3b1f" : "#39ff14"; c.lineWidth = 1; c.beginPath(); c.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); c.stroke();
    c.font = "8px PixelifySans, monospace"; c.fillStyle = "#ffffff";
    c.fillText(`${shot.outcome.result}${shot.outcome.touch ? ` (${shot.outcome.touch})` : ""} @ ${shot.outcome.target.time.toFixed(2)} s`, GOAL.left, GOAL.bar - 4);
  }

  private strokeFrame(c: CanvasRenderingContext2D, frame: KeeperFrame, color: string) {
    const g = rigGeometry(frame.id, frame.pose), centre = artPoint(frame), u = GOAL.unit;
    c.save(); c.strokeStyle = color; c.lineWidth = 0.75;
    if (frame.wall) { const x1 = GOAL.cx + Math.max(-1, frame.wall[0]) * u, x2 = GOAL.cx + Math.min(1, frame.wall[1]) * u; c.strokeRect(x1, GOAL.line - GOAL_ASPECT * u, x2 - x1, GOAL_ASPECT * u); }
    if (frame.leg) {
      const hip = artPoint(frame.leg.hip), foot = artPoint(frame.leg.foot), r = LEG_RADIUS * u, a = Math.atan2(foot.y - hip.y, foot.x - hip.x);
      c.beginPath(); c.arc(hip.x, hip.y, r, a + Math.PI / 2, a - Math.PI / 2); c.arc(foot.x, foot.y, r, a - Math.PI / 2, a + Math.PI / 2); c.closePath(); c.stroke();
    }
    c.translate(centre.x, centre.y); c.rotate(frame.rotate);
    for (const [x0, y0, x1, y1] of g.runs) c.strokeRect(x0 * u, -y1 * u, (x1 - x0) * u, (y1 - y0) * u);
    for (const { shoulder, hand } of frame.arms) {
      const s = { x: shoulder.x * u, y: -shoulder.y * u }, h = { x: hand.x * u, y: -hand.y * u }, r = (frame.armWidth * u) / 2, a = Math.atan2(h.y - s.y, h.x - s.x);
      c.beginPath(); c.arc(s.x, s.y, r, a + Math.PI / 2, a - Math.PI / 2); c.arc(h.x, h.y, r, a - Math.PI / 2, a + Math.PI / 2); c.closePath(); c.stroke();
      c.strokeRect(h.x - (frame.glove * u) / 2, h.y - (frame.glove * u) / 2, frame.glove * u, frame.glove * u);
    }
    c.restore();
  }

  private friendBeat() {
    if (this.mode === "celebrate") {
      const at = plantSpot(this.kickView());
      return celebrationBeat(this.celebration, this.modeTime, this.reduced, this.particles, at, THEMES[this.stadium].confetti);
    }
    if (this.mode === "react") return reactionBeat(this.reaction, this.modeTime, this.reduced);
    if (this.mode === "shot" && this.shot && this.modeTime > this.shot.strikeAt + this.shot.flight + 0.1 && this.shot.outcome.result !== "goal") {
      return reactionBeat(this.shot.outcome.result === "post" ? "post" : this.shot.outcome.result === "save" ? "save" : "miss", this.modeTime - this.shot.strikeAt - this.shot.flight, this.reduced);
    }
    return null;
  }

  private drawFriendLayer(c: CanvasRenderingContext2D) {
    // Run-up, plant and strike in world metres through the view's camera (gfx/kick.ts): the sprite's
    // scale follows its depth, so the Friend is ~1.2 × a keeper's height in both views.
    const view = this.kickView(), shot = this.mode === "shot" ? this.shot : null;
    const kicking = Boolean(shot && this.modeTime < shot.strikeAt + shot.flight + 0.1);
    const pose = kickPose(view, kicking ? this.modeTime : this.mode === "idle" || this.mode === "walkout" ? 0 : 99);
    let { x, y, sx, sy, rotate } = pose, facing: Facing = "up", walking = pose.walking, flip = false, cape = this.layers.cape, trophy = false;
    const frame = this.reduced ? 0 : Math.floor(this.time * 9) % 8;
    const beat = this.friendBeat();
    if (beat) { x += beat.dx; y += beat.dy; rotate = beat.rotate; sx = beat.sx; sy = beat.sy; flip = beat.flip; facing = beat.facing; cape = cape || beat.cape; trophy = beat.trophy; }
    if (this.mode === "walkout") { const p = ease.outCubic(clamp01(this.modeTime / 2)); x = lerp(240, pose.x, p); y = lerp(360, pose.y, p); walking = p < 1; facing = "up"; }
    // B11: while the ball is in flight the whole Friend layer (sprite + leg overlay) fades and eases aside so the
    // left of the goal reads; it stays so through the payoff (over the reaction pose too) while the result banner is
    // up, and is back at full opacity when the celebration starts or the banner goes.
    const aside = this.friendAsideNow;
    if (aside) { x += aside.dx; y += aside.dy; }
    const rows = this.rows(facing, walking, frame);
    drawFriend(c, rows, { x, y, scale: pose.scale, rotate, sx, sy, flip, alpha: aside?.alpha ?? 1 }, { ...this.layers, cape }, this.time);
    { const s = pose.scale, w = 9 * s * Math.abs(sx || 1); this.stats.friendRect = { x1: Math.floor(x - w), y1: Math.floor(y - 16 * s * (sy || 1)), x2: Math.ceil(x + w), y2: Math.ceil(y + 3 * s) }; }
    // Overlays on top of the (unaltered) sprite: the kicking leg's pixel frames and the contact flash.
    if (kicking && pose.leg && !beat) {
      c.save();
      if (aside) { c.globalAlpha = aside.alpha; c.translate(aside.dx, aside.dy); }
      drawKickLeg(c, pose.leg, pose.scale, this.layers.halo, this.layers.boots);
      c.restore();
    }
    if (kicking && pose.flash > 0) drawContactFlash(c, view.ball.x, view.ball.y, view.ball.r, pose.flash, this.reduced);
    if (trophy) drawTrophy(c, x, y - FRIEND_CELL * pose.scale - 14);
  }

  private drawBallLayer(c: CanvasRenderingContext2D) {
    if (!this.ballVisible) return;
    const fx = seasonFx(this.season, this.rarity), onFire = feverTier(this.streak) >= 2; // B6: the "on fire" trail from 5 in a row
    const home = this.ballHome();
    let { x, y, r } = { x: home.x, y: home.y, r: "pxPerM" in home ? Math.max(2, 0.11 * home.pxPerM) : 4.5 }, spin = 0, ribbon: RibbonPoint[] | null = null;
    const shot = this.shot;
    if (shot && this.mode === "shot" && this.modeTime >= shot.strikeAt && this.fk && this.freeKick) {
      const since = this.modeTime - shot.strikeAt, last = this.fk.path[this.fk.path.length - 1];
      if (since <= last.t) {
        ({ x, y, r } = freeKickBall(this.freeKick.setup, this.fk, since)); spin = this.time * 14 * (Math.abs(this.fk.knuckle ? 0 : 1) || 0.1);
        if (this.fk.knuckle && !this.reduced) spin = Math.sin(this.time * 9) * 0.4;
        const ground = fkProject(this.freeKick.setup, { ...pathAt(this.fk.path, since), y: 0 });
        c.fillStyle = "#00000040"; c.beginPath(); c.ellipse(ground.x, ground.y, r, r * 0.35, 0, 0, Math.PI * 2); c.fill();
        // B7: bigger in-flight sprite (exact physics radius at the crossing) and a rarity ribbon behind it
        const total = last.t || 1, span = Math.min(RIBBON_SPAN * total, 0.16) / (this.reduced ? 2 : 1), setup = this.freeKick.setup, fk = this.fk, ribbon: RibbonPoint[] = [];
        for (let k = 0; k <= RIBBON_POINTS; k++) { const t = Math.max(0, since - (span * k) / RIBBON_POINTS), b = freeKickBall(setup, fk, t); ribbon.push({ x: b.x, y: b.y, r: flightRadius(b.r, t / total) }); if (t <= 0) break; }
        r = flightRadius(r, since / total);
        drawRibbon(c, ribbon, ribbonFor(fx));
        if (!this.reduced) { emitTrail(this.particles, fx, x, y, onFire); if (this.lucky) emitLucky(this.particles, x, y); }
        drawBall(c, x, y, r, fx, spin, this.ball.squash, onFire);
        return;
      }
      if (this.fk.result === "wall") {
        const hit = fkProject(this.freeKick.setup, last), q = clamp01((since - last.t) / 1.2);
        x = hit.x + (hit.x - 240) * 0.3 * q; y = hit.y + 60 * q - 40 * Math.sin(Math.PI * q); r = 3 + 2 * q;
        if (q >= 1) return;
        drawBall(c, x, y, r, fx, this.time * 12, 0, onFire);
        return;
      }
    }
    if (shot && this.mode === "shot" && this.modeTime >= shot.strikeAt) {
      // Penalties: the flight is computed in goal-art units from the spot, then placed with the goal transform.
      const xf = this.goalXf();
      const p = clamp01((this.modeTime - shot.strikeAt) / shot.flight), target = shot.outcome.target, end = toScreen(target.x, target.y);
      ({ x, y, r } = penaltyBallArt(target, shot.curl, p)); spin = this.time * 14 * (shot.curl || 0.4);
      if (p >= 1) {
        const q = clamp01((this.modeTime - shot.strikeAt - shot.flight) / 1.3), result = shot.outcome.result;
        if (result === "goal") { x = end.x + (240 - end.x) * 0.1 * q; y = end.y + ease.outBounce(q) * (GOAL.line - 4 - end.y); r = 2.3; }
        else if (result === "save" && this.fk?.tipOver) { x = end.x + (end.x - 240) * 0.15 * q; y = end.y - 34 * Math.sin(Math.PI * 0.5 * q) + 20 * q * q; r = 2.5 - 0.8 * q; spin = this.time * 20; } // tipped over the bar
        else if (result === "save" && this.feelKick.fingertip) ({ x, y, r, spin } = this.fingertipBall(end, q)); // B2: tipped round the post, spinning
        else if (result === "save") { const dir = end.x >= 240 ? 1 : -1; x = end.x + dir * 130 * q; y = end.y + 95 * q - 45 * Math.sin(Math.PI * q); r = 2.5 + 2 * q; spin = this.time * 20; }
        else if (result === "post") { x = end.x + (240 - end.x) * 0.5 * q; y = end.y + 120 * ease.outBounce(q) - 20 * Math.sin(Math.PI * Math.min(1, q * 2.5)); r = 2.5 + 2 * q; } // B2: rebounds from the contact point (no 20 px jump)
        else if (result === "over") { x = end.x + (end.x - 240) * 0.5 * q; y = end.y - 70 * q; r = 2.5 - 1.2 * q; }
        else { x = end.x + (end.x - 240) * 1.2 * q; y = end.y + 20 * q; r = 2.5; }
        if (q >= 1 && result !== "goal") return;
      }
      { const at = this.goalPoint({ x, y }); x = at.x; y = at.y; r = Math.max(1.2, r * xf.g); }
      if (p < 1) { r = flightRadius(r, p); ribbon = penaltyRibbon(target, shot.curl, p, this.reduced, xf); } // B7
      if (p < 1 && !this.reduced) { emitTrail(this.particles, fx, x, y, onFire); if (this.lucky) emitLucky(this.particles, x, y); }
    }
    c.fillStyle = "#00000040"; c.beginPath(); c.ellipse(x, Math.min(H - 2, Math.max(y + r, home.y + 5 - (home.y - y) * 0.2)), r, r * 0.35, 0, 0, Math.PI * 2); c.fill();
    if (ribbon) drawRibbon(c, ribbon, ribbonFor(fx));
    if (this.waiting?.kind === "penalty" && this.mode === "idle") spin = drawBallWarmup(c, x, y, r, waitCue(this.waiting.t * 1000, this.waiting.expected), this.time, this.reduced);
    drawBall(c, x, y, r, fx, spin, this.ball.squash, onFire);
  }

  private drawReticle(c: CanvasRenderingContext2D) {
    const reticle = this.reticle;
    if (!reticle || this.mode !== "idle" || this.kind === "freekick") return;
    const g = this.goalXf().g, { x, y } = this.goalPoint(toScreen(reticle.x, reticle.y)), color = reticle.y > 1 || Math.abs(reticle.x) > 1 ? "#ff5a6e" : "#ccff00";
    c.save(); c.globalAlpha = reticle.alpha ?? 1;
    c.strokeStyle = "#ffffff66"; c.setLineDash([2, 3]); c.beginPath();
    for (let i = 0; i <= 16; i++) { const p = i / 16, f = flightAt({ x: reticle.x, y: reticle.y }, reticle.curl, p), bow = (f.x - reticle.x * p) * GOAL.unit * g; const px = SPOT.x + (x - SPOT.x) * p + bow, py = SPOT.y + (y - SPOT.y) * p - Math.sin(Math.PI * p) * 12; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke(); c.setLineDash([]);
    const pulse = 1 + Math.sin(this.time * 8) * (this.reduced ? 0 : 1);
    c.strokeStyle = color; c.strokeRect(Math.round(x) - 5.5 - pulse, Math.round(y) - 5.5 - pulse, 11 + pulse * 2, 11 + pulse * 2);
    c.fillStyle = color; c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    if (reticle.active) {
      const mx = SPOT.x + 30, my = SPOT.y - 44, h = 48;
      c.fillStyle = "#0b0d1acc"; c.fillRect(mx - 1, my - 1, 9, h + 2);
      c.fillStyle = "#ff5a6e55"; c.fillRect(mx, my, 7, h * 0.1);
      c.fillStyle = "#ccff0044"; c.fillRect(mx, my + h * 0.1, 7, h * 0.3);
      c.fillStyle = reticle.power > 0.9 ? "#ff5a6e" : "#ccff00"; c.fillRect(mx, my + h * (1 - reticle.power), 7, h * reticle.power);
    }
    c.restore();
  }

  private drawReferee(c: CanvasRenderingContext2D) {
    const x = 96, y = 214, whistle = this.mode === "shot" && this.modeTime > 0.5 && this.modeTime < 0.8;
    c.fillStyle = "#00000044"; c.fillRect(x - 5, y, 10, 2);
    c.fillStyle = "#111"; c.fillRect(x - 3, y - 14, 6, 9); c.fillRect(x - 3, y - 5, 2, 5); c.fillRect(x + 1, y - 5, 2, 5);
    c.fillStyle = "#ffd23f"; c.fillRect(x - 3, y - 12, 6, 1);
    c.fillStyle = "#f2c79a"; c.fillRect(x - 2, y - 19, 4, 5);
    c.fillStyle = "#f2c79a"; if (whistle) c.fillRect(x + 3, y - 18, 2, 5); else c.fillRect(x + 3, y - 13, 1, 4);
    if (whistle) { c.fillStyle = "#c0c0c0"; c.fillRect(x + 2, y - 17, 2, 1); }
  }

  private drawBallKid(c: CanvasRenderingContext2D) {
    if (!this.ballKid) return;
    const t = this.ballKid.t, x = lerp(this.ballKid.x, this.ballKid.x > 240 ? W - 30 : 30, clamp01(t / 1.2)), y = 290;
    c.fillStyle = "#1d3557"; c.fillRect(x - 2, y - 8, 5, 6); c.fillStyle = "#f2c79a"; c.fillRect(x - 1, y - 11, 3, 3); c.fillStyle = "#111"; c.fillRect(x - 2, y - 2, 2, 2); c.fillRect(x + 1, y - 2, 2, 2);
    if (t > 1.2) drawBall(c, x + 5, y - 6, 2, RARITY_FX[this.rarity]);
  }

  private drawFan(c: CanvasRenderingContext2D) {
    if (!this.fanCatch) return;
    const t = this.fanCatch.t, x = Math.round(this.fanCatch.x), up = Math.round(ease.outBack(clamp01(t / 0.4)) * 6), y = 70 - up;
    c.fillStyle = "#e63946"; c.fillRect(x - 3, y, 6, 6); c.fillStyle = "#f2c79a"; c.fillRect(x - 2, y - 4, 4, 4); c.fillRect(x - 5, y - 6, 2, 5); c.fillRect(x + 3, y - 6, 2, 5);
    if (t > 0.3) drawBall(c, x, y - 8, 2, RARITY_FX[this.rarity]);
  }

  private drawScoreboard(c: CanvasRenderingContext2D) {
    this.stats.scoreboard = this.scoreboard;
    if (!this.scoreboard) return;
    const x = W - 92, y = 2, board = this.stadium === "park" ? "#6d4c41" : this.stadium === "pro" ? "#0b0d1a" : "#3d2600";
    c.fillStyle = "#0b0d1a"; c.fillRect(x - 1, y - 1, 90, 20); c.fillStyle = board; c.fillRect(x, y, 88, 18);
    // B4: crisp 4×5 bitmap glyphs (GLYPHS) instead of 8px fillText, which blurred into "SOORE" and S-shaped fives.
    glyphText(c, "SCORE", x + 3, y + 7, 1, this.stadium === "pro" ? "#ccff00" : this.stadium === "champions" ? "#ffd23f" : "#f7f7f2");
    const text = String(this.score).padStart(5, "0"), old = String(this.scoreFlip.from).padStart(5, "0"), digit = this.stadium === "pro" ? "#ccff00" : "#ffffff";
    for (let i = 0; i < 5; i++) {
      const dx = x + 31 + i * 11, flipping = text[i] !== old[i] && this.scoreFlip.t < 1;
      c.fillStyle = "#00000055"; c.fillRect(dx, y + 3, 10, 12);
      if (flipping) { const k = Math.abs(Math.cos(this.scoreFlip.t * Math.PI)); c.save(); c.translate(dx + 5, y + 9); c.scale(1, Math.max(0.1, k)); glyphText(c, this.scoreFlip.t < 0.5 ? old[i] : text[i], -4, -5, 2, digit); c.restore(); }
      else glyphText(c, text[i], dx + 1, y + 4, 2, digit);
    }
    if (this.streak >= 2) { const label = `${this.streak} IN A ROW`; glyphText(c, label, x + 4, y + 22, 1, "#0b0d1a"); glyphText(c, label, x + 3, y + 21, 1, "#ff8c00"); }
  }

  private drawCommentary(c: CanvasRenderingContext2D) {
    if (!this.said) return;
    const t = this.said.t, slide = ease.outBack(clamp01(t / 0.35)), fade = t > 2.8 ? 1 - (t - 2.8) / 0.4 : 1;
    const text = this.said.text.slice(0, Math.floor(t * 40)), width = Math.min(260, 30 + this.said.text.length * 4.6);
    c.globalAlpha = Math.max(0, fade);
    // B6 tier 3: the commentator loses it (the box shakes on the beat, the rule glows red). Still under reduced motion.
    const hype = this.hype > 0, shake = hype && !this.reduced ? Math.round(Math.sin(this.time * 60)) : 0;
    const x = Math.round(W / 2 - width / 2) + shake, y = Math.round(lerp(-28, this.commentaryTop, slide)) + (hype && !this.reduced ? Math.round(Math.sin(this.time * 47)) : 0);
    c.fillStyle = "#0b0d1ae6"; c.fillRect(x, y, width, 22); c.fillStyle = hype ? "#ff3b1f" : "#ffd23f"; c.fillRect(x, y + 21, width, hype ? 2 : 1);
    drawCommentator(c, x + 2, y + 2, text.length < this.said.text.length, this.time);
    c.fillStyle = "#f7f7f2"; c.font = "8px PixelifySans, monospace"; c.textBaseline = "middle"; c.fillText(text, x + 25, y + 11); c.textBaseline = "alphabetic";
    c.globalAlpha = 1;
  }

  private drawBubble(c: CanvasRenderingContext2D) {
    if (!this.bubble) return;
    const anchor = this.goalPoint({ x: GOAL.cx + 40, y: GOAL.bar - 6 });
    const pop = ease.outBack(clamp01(this.bubble.t / 0.3)), x = anchor.x, y = anchor.y, w = 10 + this.bubble.text.length * 5;
    c.save(); c.translate(x, y); c.scale(pop, pop);
    c.fillStyle = "#ffffff"; c.fillRect(0, -14, w, 13); c.fillRect(4, -2, 4, 3);
    c.fillStyle = "#0b0d1a"; c.font = "8px PixelifySans, monospace"; c.textBaseline = "middle"; c.fillText(this.bubble.text, 5, -7); c.textBaseline = "alphabetic";
    c.restore();
  }

  private drawReplayCaption(c: CanvasRenderingContext2D) {
    const label = this.replaying!.label, blink = this.reduced || Math.floor(this.time * 3) % 2 === 0;
    // Top right, under the kick counter (the discovery toast lives top left).
    const width = 16 + label.length * 5.2, x = Math.round(W - 8 - width), y = 66;
    c.fillStyle = "#0b0d1ad9"; c.fillRect(x, y, width, 14);
    if (blink) { c.fillStyle = "#ff3b1f"; c.fillRect(x + 4, y + 4, 6, 6); }
    c.fillStyle = "#f7f7f2"; c.font = "8px PixelifySans, monospace"; c.textBaseline = "middle"; c.fillText(label, x + 14, y + 7); c.textBaseline = "alphabetic";
  }

  private drawWalkout(c: CanvasRenderingContext2D) {
    const t = this.modeTime, dark = 0.55 * (1 - clamp01((t - 2.2) / 0.8));
    c.fillStyle = `rgba(0,0,0,${dark})`; c.fillRect(0, 0, W, H);
    const p = ease.outCubic(clamp01(t / 2)), start = this.kickPose(0), fx = lerp(240, start.x, p), fy = lerp(360, start.y, p);
    const g = c.createRadialGradient(fx, fy - 30, 4, fx, fy - 30, 70); g.addColorStop(0, "rgba(255,246,200,0.35)"); g.addColorStop(1, "rgba(255,246,200,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const banner = ease.outBack(clamp01((t - 0.6) / 0.5));
    c.save(); c.translate(W / 2, 150); c.scale(banner, banner);
    c.fillStyle = "#ffd23f"; c.fillRect(-110, -14, 220, 28); c.fillStyle = "#0b0d1a"; c.fillRect(-108, -12, 216, 24);
    c.fillStyle = "#ffd23f"; c.font = headFont(12); c.textAlign = "center"; c.textBaseline = "middle";
    const name = this.friendName.toUpperCase(); c.fillText(name, 0, 0); c.fillText(name, -1, 0); // two passes: PKHead has one weight
    c.textAlign = "left"; c.textBaseline = "alphabetic"; c.restore();
  }

  private drawReveal(c: CanvasRenderingContext2D) {
    const r = this.reveal!, t = r.t, top = r.plan.fullScreen, fx = RARITY_FX[r.rarity];
    c.fillStyle = `rgba(0,0,0,${Math.min(0.7, t * 2)})`; c.fillRect(0, 0, W, H);
    // Light cone.
    const cone = c.createLinearGradient(0, 0, 0, H); cone.addColorStop(0, fx.trail[0] + "aa"); cone.addColorStop(1, fx.trail[0] + "00");
    c.fillStyle = cone; c.beginPath(); c.moveTo(W / 2 - 20, 0); c.lineTo(W / 2 + 20, 0); c.lineTo(W / 2 + 70, REVEAL_Y + 60); c.lineTo(W / 2 - 70, REVEAL_Y + 60); c.fill();
    // B5: light rays for Gold and up (they used to be the Golden Boot's only). Reduced motion: a still glow, no turning rays.
    if (r.rarity >= 5) {
      if (!this.reduced) {
        c.save(); c.translate(W / 2, REVEAL_Y); c.rotate(t * (top ? 0.6 : 0.35));
        for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.fillStyle = i % 2 ? "#ff8c0055" : "#ffd23f44"; c.beginPath(); c.moveTo(0, 0); c.lineTo(-18, -300); c.lineTo(18, -300); c.fill(); }
        c.restore();
      } else drawRarityGlow(c, W / 2, REVEAL_Y, 70, fx.trail[0], 0.55);
      if (top && !this.reduced && Math.random() < 0.8) this.particles.emit("fire", W / 2 + (Math.random() - 0.5) * 40, REVEAL_Y + 10, 3, { color: ["#ff8c00", "#ff3b1f", "#ffd23f"], speed: 40, gravity: -60, life: 0.8, size: 2 });
    }
    const spinDown = Math.max(0, 1 - t / 1.2), spin = (1 - spinDown * spinDown) * 20 + t * 0.5;
    drawBall(c, W / 2, REVEAL_Y, 14, fx, this.reduced ? 0 : spin, 0, top);
    if (t > 1.1) {
      const slam = this.reduced ? 1 : ease.outBack(clamp01((t - 1.1) / 0.35));
      if (t < 1.2 && !this.reduced) { this.camera.addTrauma(0.15 * (1 + fx.tier)); this.particles.emit(fx.tier >= 4 ? "sparkle" : "confetti", W / 2, REVEAL_Y, 12 + fx.tier * 14, { color: fx.trail.concat(["#ffffff"]), speed: 90 + fx.tier * 20, spread: Math.PI * 2, gravity: 40, life: 1.4 }); }
      c.save(); c.translate(W / 2, REVEAL_Y + 58); c.scale(slam, slam);
      c.fillStyle = fx.accent; c.fillRect(-120, -16, 240, 32); c.fillStyle = "#0b0d1a"; c.fillRect(-117, -13, 234, 26);
      c.fillStyle = fx.base === "#ffffff" ? fx.accent : fx.base; c.font = headFont(16); c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(RARITY_NAMES[r.rarity].toUpperCase(), -1, 0); // the heading face has one weight: a second pass 1 px left
      c.fillText(RARITY_NAMES[r.rarity].toUpperCase(), 0, 0); c.textAlign = "left"; c.textBaseline = "alphabetic"; c.restore();
    }
    // The TRUE rarity's colour floods the frame edges (thicker for rarer balls).
    const flood = r.plan.beats.find(beat => beat.kind === "flood");
    if (flood && t >= flood.at) {
      const k = clamp01((t - flood.at) / 0.4) * (1 - clamp01((t - r.plan.duration + 0.5) / 0.5)), edge = 6 + r.plan.tier * 5;
      c.fillStyle = fx.base + Math.round(0x99 * k).toString(16).padStart(2, "0");
      c.fillRect(0, 0, W, edge); c.fillRect(0, H - edge, W, edge); c.fillRect(0, 0, edge, H); c.fillRect(W - edge, 0, edge, H);
    }
    this.particles.draw(c);
  }

  // ── Game feel (Part B: B1 goal moment, B2 near-miss drama, B6 streak fever) ────────────────
  // Kept together (and the rules in gfx/feel.ts) so gameplay-rule changes elsewhere in the Stage merge cleanly.
  // Visual only: the engine decided every outcome before play(); none of this changes a result.

  /** Before the kick: a fingertip save? And does this kick earn the slow-mo (a close call, at most 1 kick in 3)? */
  private feelPlan(outcome: ShotOutcome, live: boolean, freeKick: boolean) {
    const keeper = this.kind === "target" || freeKick ? null : this.keeper;
    this.feelKick.fingertip = keeper !== null && isFingertip(outcome, keeper);
    this.feelKick.slowmo = live && this.slowGate.allow(isCloseCall(outcome, keeper), this.reduced);
  }
  /** Showroom: let the next close call slow down again. */
  resetSlowMoGate() { this.slowGate.reset(); }
  /** B1 boot contact: a 50 ms freeze, a little trauma, and a local contact star with speed lines (no full-screen flash). */
  private feelStrike(ball: { x: number; y: number }, outcome: ShotOutcome) {
    this.camera.freeze(hitStopFor("strike")); this.camera.addTrauma(TRAUMA.strike);
    const end = this.goalPoint(toScreen(outcome.target.x, outcome.target.y));
    this.feel.contact(ball.x, ball.y - 1, end.x - ball.x, end.y - ball.y);
  }
  /** B1 goal: a 90 ms freeze, a zoom-in punch on the net point, shake by pace and fever, the net bulge, stadium confetti. */
  private feelGoal(outcome: ShotOutcome, art: { x: number; y: number }, end: { x: number; y: number }) {
    const pace = paceOf(outcome.target.time), tier = feverTier(this.streak), recipe = CONFETTI[this.stadium];
    this.camera.freeze(hitStopFor("net")); this.camera.addTrauma(goalTrauma(pace, tier));
    this.camera.punchAt(end.x, end.y, PUNCH.goal * (1 + 0.12 * tier), 0.85);
    this.net.impulse(art.x, art.y, 0.8 + 0.3 * pace); this.sfx("net-ripple");
    this.particles.emit("confetti", end.x, end.y - 10, recipe.count, { color: THEMES[this.stadium].confetti, speed: recipe.speed, spread: recipe.spread, gravity: 70, life: recipe.life });
    if (recipe.glints) this.particles.emit("sparkle", end.x, end.y - 10, recipe.glints, { color: [...recipe.glint], speed: recipe.speed * 0.8, spread: recipe.spread, gravity: 30, life: recipe.life * 0.6 });
  }
  /** B2 save: a short freeze and a small punch; a fingertip save gets its own beat (spark, deflection, "TIPPED!"). */
  private feelSave(end: { x: number; y: number }) {
    const tip = this.feelKick.fingertip;
    this.camera.freeze(hitStopFor(tip ? "fingertip" : "save")); this.camera.addTrauma(tip ? TRAUMA.fingertip : TRAUMA.save);
    this.camera.punchAt(end.x, end.y, PUNCH.save, 0.6);
    if (!tip) return;
    const dir = end.x >= 240 ? 1 : -1;
    this.feel.spark(end.x, end.y); this.ball.squash = 0.4; this.sfx("fingertip");
    this.particles.emit("spark", end.x, end.y, 8, { color: ["#ffffff", "#ffe27a"], speed: 70, angle: dir > 0 ? -0.5 : -Math.PI + 0.5, spread: 1, life: 0.3, gravity: 40 });
    this.feel.say("TIPPED!", "FINGERTIP SAVE");
  }
  /** B2 woodwork: a 120 ms freeze, a sideways tremor, a spark burst at the contact point, "CLANG!" then "SO CLOSE!". */
  private feelPost(outcome: ShotOutcome, art: { x: number; y: number }) {
    const bar = outcome.target.y > 0.9;
    const hit = this.goalPoint(bar ? { x: art.x, y: GOAL.bar - 2 } : { x: outcome.target.x < 0 ? GOAL.left - 2 : GOAL.right + 1, y: art.y });
    this.postWobble = 1.4; this.camera.freeze(hitStopFor("post")); this.camera.addTrauma(TRAUMA.post, 0.25);
    this.camera.punchAt(hit.x, hit.y, PUNCH.post, 0.6);
    this.feel.spark(hit.x, hit.y);
    this.particles.emit("spark", hit.x, hit.y, 14, { color: ["#ffffff", "#ffe27a", "#ffb347"], speed: 90, spread: Math.PI * 2, life: 0.35, gravity: 60 });
    this.feel.say("CLANG!", "SO CLOSE!"); this.sfx("so-close");
  }
  /** B2 a whisker wide or over. */
  private feelSoClose() { this.feel.say("SO CLOSE!", "BY A WHISKER"); this.sfx("so-close"); }
  /** The result line when the Director has none: the near-miss and fingertip lines, else the plain result. */
  private feelLine(outcome: ShotOutcome): CommentaryContext {
    if (outcome.result === "save" && this.feelKick.fingertip) return "fingertip";
    if ((outcome.result === "wide" || outcome.result === "over") && nearFrame(outcome.target)) return "so-close";
    return outcome.result;
  }
  /** The ball after a fingertip: deflected out round the post, spinning hard, then dropping. */
  private fingertipBall(end: { x: number; y: number }, q: number) {
    const dir = end.x >= 240 ? 1 : -1;
    return { x: end.x + dir * (26 * q + 40 * q * q), y: end.y - 22 * Math.sin(Math.PI * 0.6 * q) + 60 * q * q, r: 2.5 + 1.5 * q, spin: this.time * 42 * dir };
  }
  /**
   * B6 streak fever, on a goal (the game has already set this.streak: BQ-P1-1). 3: a louder crowd and the heat
   * shimmer; 5: the ball catches fire; 10: the whole stadium chants and the commentator loses it. Stingers mark each step.
   */
  private feelFever() {
    const tier = feverTier(this.streak), stinger = feverStinger(this.streak);
    if (tier >= 1) this.sfx("roar-swell");
    if (stinger) this.sfx(stinger);
    if (this.streak === FEVER_AT[0]) this.feel.say("HAT-TRICK!", "3 IN A ROW", true);
    if (this.streak === FEVER_AT[1]) { this.say("streak5"); this.feel.say("ON FIRE!", "5 IN A ROW", true); }
    if (tier === 3) {
      this.feel.chant = FX_LIFE.chant; this.hype = 3.2;
      if (this.streak % 5 === 0) { this.say("streak10"); this.crowd.startWave(); this.feel.say(`${this.streak} IN A ROW!`, "THE WHOLE STADIUM IS SINGING", true); }
    }
  }
  /** B5: a lower ball's card flip (up to FLIP_SECONDS; the next flip or the best reveal replaces it): the ball turns face-up with a glow sized and coloured by its TRUE rarity tier. */
  private drawFlip(c: CanvasRenderingContext2D) {
    const f = this.flip!, t = f.t, fx = RARITY_FX[f.plan.rarity], tier = f.plan.tier;
    const fade = 1 - clamp01((t - FLIP_SECONDS + 0.12) / 0.12);
    c.globalAlpha = fade;
    c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(0, 0, W, H);
    drawRarityGlow(c, W / 2, REVEAL_Y, 20 + tier * 6, fx.trail[0], 0.35 + tier * 0.08);
    if (tier >= 5) drawRarityGlow(c, W / 2, REVEAL_Y, 64, "#ffd23f", 0.3);
    const turn = this.reduced ? 1 : Math.abs(Math.cos(Math.PI / 2 * (1 - clamp01(t / 0.16)))), pop = this.reduced ? 1 : 1 + 0.25 * Math.sin(Math.PI * clamp01(t / 0.3));
    c.save(); c.translate(W / 2, REVEAL_Y); c.scale(Math.max(0.08, turn) * pop, pop);
    drawBall(c, 0, 0, 11, fx, 0, 0, tier === 6);
    c.restore();
    const name = RARITY_NAMES[f.plan.rarity].replace(" Ball", "").toUpperCase(), cols = glyphCols(name) * 2;
    glyphText(c, name, Math.round(W / 2 - cols / 2) + 1, REVEAL_Y + 21, 2, "#0b0d1a");
    glyphText(c, name, Math.round(W / 2 - cols / 2), REVEAL_Y + 20, 2, fx.base === "#ffffff" ? fx.accent : fx.base);
    c.globalAlpha = 1;
  }
}

/** B5: where the pack tears and the reveal ball sits (logical y). High enough that the collapsed DOM card strip (from y ≈ 192 down) never covers the ball or its banner. */
const REVEAL_Y = 112, PACK_Y = 142, FLIP_SECONDS = 0.7, TEAR_SECONDS = PACK_TEAR_MS / 1000, TEAR_OPEN = 0.45;
function drawRarityGlow(c: CanvasRenderingContext2D, x: number, y: number, radius: number, colour: string, alpha: number) {
  const g = c.createRadialGradient(x, y, 2, x, y, radius);
  g.addColorStop(0, colour + Math.round(0xff * Math.min(1, alpha)).toString(16).padStart(2, "0")); g.addColorStop(1, colour + "00");
  c.fillStyle = g; c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

export { CELEBRATIONS, RARITY_NAMES, STRIKER, KICK_SPOT };
export type { ShotResult };
