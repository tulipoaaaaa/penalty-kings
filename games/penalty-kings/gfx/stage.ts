/**
 * The Stage: one scene engine used by the game and the dev Showroom.
 * Layers: sky → stands → crowd → boards → pitch → net → keeper → goal frame → ball → striker → FX → canvas UI.
 * Choreography: build-up → run-up → strike (hit-stop, flash, ring) → flight → outcome → celebration/reaction.
 */
import { keeperById, keeperAt, keeperFrame, rigGeometry, flightAt, WALL_DISTANCE, BALL_RADIUS, GOAL_ASPECT, LEG_RADIUS, type KeeperId, type KeeperPlan, type KeeperFrame, type ShotResult, type ShotOutcome, type FreeKickSetup, type FreeKickOutcome, type FlightSample } from "@penalty-kings/engine";
import { W, H, ease, clamp01, lerp, Camera, Particles, Timeline } from "./core.js";
import { drawBackdrop, drawBoards, drawPitch, drawWeather, drawHeatShimmer, drawGoalFrame, GOAL, SPOT, THEMES, toScreen, penaltyY, PENALTY_GOAL, type StadiumId, type Weather } from "./stadium.js";
import { Crowd } from "./crowd.js";
import { Net } from "./net.js";
import { drawKeeper, drawKeeperFrame, keeperArms, artPoint, KEEPER_DESIGNS, KEEPER_TAUNTS, type KeeperPose } from "./keepers.js";
import { drawBall, emitTrail, emitLucky, seasonFx, RARITY_FX } from "./ball.js";
import { drawFriend, celebrationBeat, reactionBeat, drawTrophy, CELEBRATIONS, type CelebrationId, type FriendLayers } from "./friend.js";
import { commentary, drawCommentator, type CommentaryContext } from "./commentary.js";
import { fkProject, fkBall, drawWall, pathAt, drawPreview, drawZoneHints, drawTargets, drawCrossbarGlow, drawClock, goalTransform, applyGoal, drawPitchMarkings, PENALTY_SETUP, PENALTY_CAMERA } from "./setpieces.js";
import type { RevealPlan } from "../game/reveal.js";

export type Facing = "up" | "down" | "left" | "right";
export type RowsProvider = (facing: Facing, walking: boolean, frame: number) => readonly string[] | null;
/** Penalty view: how far the backdrop layer drops so the ad boards (bottom at y 102) end 30 px above the goal line. */
export const BACKDROP_DROP = Math.round(PENALTY_GOAL.y - 30 - 102);
/** Seconds from release to the strike (the run-up). Round 6 B3: ≤ 0.4 s. */
export const STRIKE_AT = 0.4;
export type StageEvent = "sfx" | "strike" | "resolved" | "done" | "reveal-done" | "walkout-done" | "reveal";
export type Sfx = "heartbeat" | "whistle" | "kick" | "whoosh" | "net" | "clang" | "glove" | "roar" | "groan" | "ooh" | "chant" | "reveal" | "reveal-top" | "stomp" | "boo" | "beep" | "honk" | "blub" | "squeak" | "yawn";

const RARITY_NAMES = ["Scuffed Ball", "Training Ball", "Match Ball", "Pro Ball", "Silver Ball", "Gold Ball", "Golden Boot Ball", "Warm-up Ball"];
/** Run-up starts at the 18-yard line (y≈306, 16.4 m out); the kick is taken just behind-left of the spot. */
const STRIKER = { x: 196, y: Math.round(penaltyY(16.4)) }, KICK_SPOT = { x: 206, y: Math.round(penaltyY(11.7)) };

// ── Penalty flight ↔ physics (round 6 B4): one clock, one ball, one keeper ────────────
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

export class Stage {
  camera = new Camera();
  particles = new Particles(520);
  net = new Net();
  crowd: Crowd;
  time = 0;
  stadium: StadiumId = "park"; weather: Weather = "sun"; keeper: KeeperId = "squirrel";
  reduced = false;
  rarity = 7; streak = 0; score = 0;
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
  /** The chosen Big Match ball: lucky trail and its seasonal edition print (skill layer only). */
  lucky = false;
  season: "S0" | "S1" = "S1";
  /** The Match Director's line for the next resolve (else the plain result line). */
  cue: CommentaryContext | null = null;
  /** DEV (Showroom): draw the keeper hitbox and the ball at arrival over the scene. */
  debugHitbox = false;
  /** What the viewer actually saw (the 90-second QA reads this). */
  stats = { lines: new Set<string>(), contexts: new Set<string>(), celebrations: new Set<string>(), keepers: new Set<string>(), waves: 0, taunts: 0, shots: 0, goals: 0, saves: 0, woodwork: 0, reveals: 0, walkouts: 0, sfx: 0 };

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
  private reveal: { rarity: number; t: number; plan: RevealPlan } | null = null;
  private scoreFlip = { from: 0, t: 1 };
  private reaction: "miss" | "save" | "post" = "miss";
  private fanCatch: { x: number; t: number } | null = null;
  private ballKid: { t: number; x: number } | null = null;
  private lastRealFrame = 0;

  constructor(options: Partial<Pick<Stage, "stadium" | "weather" | "keeper" | "reduced">> = {}) {
    Object.assign(this, options);
    this.crowd = new Crowd(this.stadium);
    this.net.color = this.stadium === "pro" ? "#ccff00" : "#e8e8e8";
  }

  // ── Configuration ─────────────────────────────────────────────────────────
  setStadium(id: StadiumId) { this.stadium = id; this.crowd = new Crowd(id); }
  setReduced(value: boolean) { this.reduced = value; this.camera.reduced = value; this.particles.budget = value ? 0.25 : 1; }
  get busy() { return this.mode !== "idle" || Boolean(this.reveal); }
  /** A moment a kick must not cut short: the walkout or a pack reveal sequence. */
  get moment() { return this.mode === "walkout" || Boolean(this.reveal); }
  /** Abandon an in-flight kick WITHOUT emitting resolved/done (mode switch, redeemed ball). */
  cancel() { this.timeline.reset(); this.mode = "idle"; this.shot = null; this.fk = null; this.reticle = null; this.preview = null; this.clock = null; this.ballVisible = true; this.cue = null; }

  // ── Moments ───────────────────────────────────────────────────────────────
  say(context: CommentaryContext) {
    const text = commentary(context, { friend: this.friendName, keeper: keeperById(this.keeper).name });
    this.said = { text, t: 0 }; this.stats.lines.add(text); this.stats.contexts.add(context);
  }
  /** A keeper taunt bubble with its signature sound. */
  taunt() {
    const taunts = KEEPER_TAUNTS[this.keeper]; this.bubble = { text: taunts[Math.floor(Math.random() * taunts.length)], t: 0 };
    this.stats.taunts++; this.sfx(KEEPER_DESIGNS[this.keeper].sfx as Sfx);
  }

  /** Play the whole choreographed shot for an already-resolved outcome. */
  play(outcome: ShotOutcome, curl: number, flightOverride?: number) {
    this.timeline.reset(); this.mode = "shot"; this.modeTime = 0; this.ballVisible = true; this.reticle = null; this.clock = null; this.preview = null;
    this.stats.shots++; if (this.kind !== "target") this.stats.keepers.add(this.keeper);
    if (flightOverride === undefined) this.fk = null;
    // Snappy (round 6 B3): strike 0.4 s after release, flight 0.35–0.55 s by power (target.time 0.4–0.95).
    const flight = flightOverride ?? penaltyFlight(outcome.target.time);
    this.shot = this.lastShot = { outcome, curl, flight, strikeAt: STRIKE_AT };
    this.crowd.react("tense");
    this.camera.targetZoom = this.reduced ? 1 : 1.06; this.camera.targetY = H / 2 - 6;
    this.sfx("heartbeat"); if (!this.said || this.said.t > 1.5) this.say(keeperById(this.keeper).boss ? "boss" : "buildup");
    this.timeline
      .at(0, () => this.sfx("whistle"))
      .at(0.12, () => this.dust(STRIKER.x + 8, STRIKER.y - 10)).at(0.22, () => this.dust(STRIKER.x + 14, STRIKER.y - 20)).at(0.32, () => this.dust(STRIKER.x + 20, STRIKER.y - 28))
      .at(STRIKE_AT, () => {
        const ball = this.ballHome();
        this.camera.hitStop = 2 / 60; this.flash = this.reduced ? 0 : 0.35; this.ring = { x: ball.x, y: ball.y, t: 0 };
        this.ball.squash = 0.35; this.camera.addTrauma(0.25); this.camera.targetZoom = this.reduced ? 1 : 1.12;
        this.particles.emit("grass", ball.x, ball.y + 3, 10, { color: ["#2e7d32", "#8bc34a"], speed: 50, spread: 1.4, life: 0.5 });
        this.sfx("kick"); this.sfx("whoosh"); this.onEvent("strike");
        const k = KEEPER_DESIGNS[this.keeper].sfx; if (k === "stomp") { this.camera.addTrauma(0.3); this.sfx("stomp"); }
      })
      .at(STRIKE_AT + flight, () => this.resolve())
      // Next kick ready fast: a goal hands back control after 1.0 s while the celebration keeps
      // playing (the next strike cuts it); a miss after 1.3 s (the reaction beat has played).
      .at(STRIKE_AT + flight + (outcome.result === "goal" ? 1.0 : 1.3), () => {
        if (this.kind === "target" || outcome.result !== "goal") { this.finish(); return; }
        this.startCelebration(this.celebration); this.onEvent("done");
      });
  }

  /** Free kick: the engine's flight path is the animation; "wall" plays as a block. */
  playFreeKick(outcome: FreeKickOutcome) {
    const result: ShotResult = outcome.result === "wall" ? "save" : outcome.result;
    this.play({ result, target: outcome.target, plan: outcome.keeper, zone: outcome.zone, postIn: false }, 0, Math.max(0.3, outcome.path[outcome.path.length - 1].t));
    this.fk = outcome;
  }

  /** Where the ball rests before the kick (penalty spot, or the free-kick spot through the FK camera). */
  ballHome() { return this.kind === "freekick" && this.freeKick ? fkBall(this.freeKick.setup) : { x: SPOT.x, y: SPOT.y, scale: 1 }; }
  /** The goal group's placement: identity for penalties, true perspective for free kicks. */
  goalXf() { return this.kind === "freekick" && this.freeKick ? goalTransform(this.freeKick.setup) : PENALTY_GOAL; }
  /** A point in goal-art coordinates → screen. */
  goalPoint(p: { x: number; y: number }) { return applyGoal(this.goalXf(), p); }

  private resolve() {
    const shot = this.shot!, result = shot.outcome.result, art = toScreen(shot.outcome.target.x, shot.outcome.target.y), end = this.goalPoint(art);
    if (this.fk?.result === "wall") {
      const hit = fkProject(this.freeKick!.setup, this.fk.path[this.fk.path.length - 1]);
      this.crowd.react("ooh"); this.say(this.cue ?? "wall"); this.cue = null; this.stats.saves++; this.onEvent("resolved", "wall"); this.streak = 0; this.reaction = "save";
      this.camera.addTrauma(0.3); this.camera.hitStop = 2 / 60; this.sfx("glove"); this.sfx("ooh");
      this.particles.emit("dust", hit.x, hit.y, 12, { color: ["#ffffff", "#c8b99a"], speed: 60, spread: Math.PI * 2, life: 0.4 });
      this.scoreFlip = { from: this.score, t: 0 };
      return;
    }
    this.crowd.react(result === "goal" ? "cheer" : result === "post" || result === "over" ? "ooh" : "groan");
    this.say(this.cue ?? result); this.cue = null;
    if (result === "goal") this.stats.goals++; else if (result === "save") this.stats.saves++; else if (result === "post") this.stats.woodwork++;
    this.onEvent("resolved", result);
    this.camera.targetZoom = 1; this.camera.targetY = H / 2;
    if (this.kind === "target") {
      this.crowd.react(result === "goal" ? "cheer" : "ooh"); this.sfx(result === "goal" ? "net" : "ooh");
      if (result === "goal") this.particles.emit("confetti", end.x, end.y, 24, { color: THEMES[this.stadium].confetti, speed: 90, spread: Math.PI * 2, gravity: 60, life: 1.2 });
      return;
    }
    if (result === "goal") {
      this.net.impulse(art.x, art.y, 160); this.camera.addTrauma(0.5); this.goalFlash = 2;
      this.particles.emit("confetti", end.x, end.y - 10, 60, { color: THEMES[this.stadium].confetti, speed: 140, spread: Math.PI * 1.2, gravity: 70, life: 2.4 });
      this.particles.emit("thread", end.x, end.y, 8, { color: "#ffffff", speed: 60, life: 0.5, gravity: 60 });
      this.sfx("net"); this.sfx("roar");
      this.streak += 1; if (this.streak >= 2) this.sfx("chant");
    } else {
      this.streak = 0; this.reaction = result === "post" ? "post" : result === "save" ? "save" : "miss";
      if (result === "save") {
        this.particles.emit("spark", end.x, end.y, 16, { color: ["#ffffff", "#ffd23f"], speed: 90, spread: Math.PI * 2, life: 0.4, gravity: 0 });
        if (this.keeper === "octopus") this.particles.emit("ink", end.x, end.y, 20, { color: "#1a0f2e", speed: 40, spread: Math.PI * 2, life: 1, gravity: 20, size: 2 });
        const taunts = KEEPER_TAUNTS[this.keeper]; this.bubble = { text: taunts[Math.floor(Math.random() * taunts.length)], t: 0 }; this.stats.taunts++;
        this.camera.hitStop = 0.07; this.camera.addTrauma(0.3); this.sfx("glove"); this.sfx("groan"); this.sfx(KEEPER_DESIGNS[this.keeper].sfx as Sfx);
      } else if (result === "post") {
        this.postWobble = 1.4; this.camera.addTrauma(0.45); this.sfx("clang"); this.sfx("ooh");
        this.particles.emit("spark", end.x, end.y, 10, { color: "#ffffff", speed: 70, spread: Math.PI * 2, life: 0.3, gravity: 0 });
      } else if (result === "over") { this.fanCatch = { x: end.x + (end.x - 240) * 0.5, t: 0 }; this.sfx("ooh"); }
      else { this.ballKid = { t: 0, x: end.x > 240 ? W + 10 : -10 }; this.sfx("groan"); }
    }
    this.scoreFlip = { from: this.score, t: 0 };
  }

  startCelebration(id: CelebrationId) { this.celebration = id; this.mode = "celebrate"; this.modeTime = 0; this.ballVisible = false; this.crowd.react("cheer"); this.stats.celebrations.add(id); }
  react(kind: "miss" | "save" | "post") { this.reaction = kind; this.mode = "react"; this.modeTime = 0; }
  walkout() { this.stats.walkouts++; this.mode = "walkout"; this.modeTime = 0; this.crowd.react("cheer"); this.sfx("chant"); this.say("walkout"); }
  /** ETHICS: the reveal is driven ONLY by a RevealPlan built from the settled outcome (game/reveal.ts). */
  showReveal(plan: RevealPlan) {
    this.reveal = { rarity: plan.rarity, t: 0, plan }; this.rarity = plan.rarity; this.stats.reveals++;
    this.onEvent("reveal", plan); this.sfx(plan.fullScreen ? "reveal-top" : "reveal");
    if (plan.rarity >= 5) this.say(plan.fullScreen ? "rarity-top" : "rarity-high");
    if (plan.fullScreen) { this.crowd.react("cheer"); this.sfx("roar"); }
  }
  wave() { this.crowd.startWave(); this.crowd.react("cheer"); this.stats.waves++; this.say("wave"); }
  setScore(score: number) { if (score !== this.score) { this.scoreFlip = { from: this.score, t: 0 }; this.score = score; } }
  private finish() { this.mode = "idle"; this.shot = null; this.ballVisible = false; this.onEvent("done"); }
  private dust(x: number, y: number) { this.particles.emit("dust", x, y, 5, { color: ["#c8b99a", "#a89878"], speed: 25, spread: 1.6, life: 0.5, gravity: -10 }); }
  private sfx(name: Sfx) { this.stats.sfx++; this.onEvent("sfx", name); }

  // ── Update ────────────────────────────────────────────────────────────────
  update(realDt: number) {
    if (this.camera.hitStop > 0) { this.camera.hitStop -= realDt; return; }
    // Slow-mo (skill layer only): a beat on the release, and near-misses (post, bar, just wide/over, fingertip saves).
    let slow = 1;
    const shot = this.shot;
    if (shot && this.mode === "shot" && !this.reduced) {
      const since = this.modeTime - shot.strikeAt, t = shot.outcome.target;
      const near = shot.outcome.result === "post" || (shot.outcome.result !== "goal" && (Math.abs(Math.abs(t.x) - 1) < 0.12 || Math.abs(t.y - 1) < 0.1));
      // Near-misses only (no default slow-mo), ≤ 0.5 s of real time.
      if (near && since > shot.flight * 0.85 && since < shot.flight + 0.1) slow = 0.5;
    }
    const dt = realDt * this.camera.timeScale * slow;
    this.time += dt; this.modeTime += dt;
    if (this.mode === "shot") this.timeline.advance(dt);
    this.camera.update(dt); this.particles.update(dt); this.net.update(dt); this.crowd.update(dt);
    this.flash = Math.max(0, this.flash - dt * 3); this.postWobble = Math.max(0, this.postWobble - dt * 1.5); this.goalFlash = Math.max(0, this.goalFlash - dt);
    this.ball.squash = Math.max(0, this.ball.squash - dt * 4);
    if (this.ring) { this.ring.t += dt; if (this.ring.t > 0.5) this.ring = null; }
    if (this.bubble) { this.bubble.t += dt; if (this.bubble.t > 2.2) this.bubble = null; }
    if (this.said) { this.said.t += dt; if (this.said.t > 3.2) this.said = null; }
    if (this.scoreFlip.t < 1) this.scoreFlip.t += dt * 2.2;
    if (this.fanCatch) { this.fanCatch.t += dt; if (this.fanCatch.t > 2) this.fanCatch = null; }
    if (this.ballKid) { this.ballKid.t += dt; if (this.ballKid.t > 2.4) this.ballKid = null; }
    if (this.reveal) { this.reveal.t += dt; if (this.reveal.t > this.reveal.plan.duration) { this.reveal = null; this.onEvent("reveal-done"); } }
    if (this.mode === "celebrate" && this.modeTime > 2.6) { this.mode = "idle"; this.shot = null; } // "done" was already sent
    if (this.mode === "react" && this.modeTime > 1.6) { this.mode = "idle"; this.onEvent("done"); }
    if (this.mode === "walkout" && this.modeTime > 3) { this.mode = "idle"; this.onEvent("walkout-done"); }
    if (this.keeper === "sloth" && Math.random() < dt * 0.6) { const z = this.goalPoint({ x: GOAL.cx + 14, y: GOAL.line - 60 }); this.particles.emit("zzz", z.x, z.y, 1, { color: "#ffffff", speed: 8, angle: -1.2, spread: 0.3, life: 1.5, gravity: -6 }); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  render(c: CanvasRenderingContext2D) {
    c.save();
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b0d1a"; c.fillRect(0, 0, W, H);
    this.camera.apply(c, this.time);
    const pan = (this.camera.x - W / 2) * 2;
    const wind = this.kind === "freekick" && this.freeKick ? this.freeKick.setup.wind : 0;
    this.crowd.wind = wind;
    const fk = this.kind === "freekick" && this.freeKick ? this.freeKick : null;
    // Penalty camera (round 6 B1): the stands sit just behind the goal, so the whole backdrop layer
    // (sky, stands, crowd, boards, grass stripes) drops until the boards end ~30 px above the goal line.
    const drop = fk ? 0 : BACKDROP_DROP;
    if (drop) { c.fillStyle = THEMES[this.stadium].sky[0]; c.fillRect(-40, -40, W + 80, drop + 40); }
    c.save(); c.translate(0, drop);
    drawBackdrop(c, this.stadium, this.weather, this.time, pan, { goalFlash: this.goalFlash, jumbotron: this.jumbotron, wind });
    this.crowd.draw(c, this.time, pan, this.particles, this.reduced);
    this.drawFan(c);
    drawBoards(c, this.stadium, this.time, pan);
    drawPitch(c, this.stadium, this.weather);
    c.restore();
    if (fk) drawPitchMarkings(c, fk.setup, THEMES[this.stadium].lines, fk.wall, this.time);
    else drawPitchMarkings(c, PENALTY_SETUP, THEMES[this.stadium].lines, null, this.time, PENALTY_CAMERA);
    drawHeatShimmer(c, this.streak >= 2 && !this.reduced ? Math.min(1, this.streak - 1) : 0, this.time);
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
    if (this.ring) { c.strokeStyle = `rgba(255,255,255,${1 - this.ring.t / 0.5})`; c.lineWidth = 2; c.beginPath(); c.ellipse(this.ring.x, this.ring.y, 6 + this.ring.t * 70, 3 + this.ring.t * 25, 0, 0, Math.PI * 2); c.stroke(); }
    drawWeather(c, this.weather, this.stadium, this.time, this.particles, 1 / 60, this.reduced);
    c.restore();
    // Screen-space UI on the canvas.
    this.drawScoreboard(c);
    this.drawCommentary(c);
    this.drawBubble(c);
    if (this.mode === "walkout") this.drawWalkout(c);
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
    if (shot && this.mode === "shot") {
      const flightT = this.modeTime - shot.strikeAt;
      if (flightT < 0) {
        mood = this.modeTime < 0.7 ? "taunt" : "idle"; gx += shot.outcome.plan.lean * 0.12;
        // Penalties: settle onto the line during the run-up, so the dive starts from the physics' standing frame.
        if (!this.fk) { const settle = 1 - clamp01(this.modeTime / shot.strikeAt); gx *= settle; lift *= settle; }
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
    return { x, y: GOAL.line - lift, rotate, stretch, armL, armR, alpha, scaleMul, mood };
  }

  private keeperAlpha() {
    const shot = this.shot;
    if (this.keeper === "ghost") return 0.7 + 0.2 * Math.sin(this.time * 8);
    if (this.keeper === "chameleon") return shot && this.mode === "shot" && this.modeTime >= shot.strikeAt ? 1 : 0.12 + 0.06 * Math.sin(this.time * 3);
    return 1;
  }

  /** The keeper during a penalty flight: the engine's KeeperFrame (null outside a penalty in flight). */
  keeperFrameNow(): KeeperFrame | null {
    const shot = this.shot;
    if (!shot || this.mode !== "shot" || this.fk || this.kind !== "penalty") return null;
    const flightT = this.modeTime - shot.strikeAt;
    return flightT < 0 ? null : penaltyKeeperFrame(this.keeper, shot.outcome, shot.flight, flightT);
  }

  private drawKeeperLayer(c: CanvasRenderingContext2D) {
    const frame = this.keeperFrameNow();
    if (frame) { this.drawDivingKeeper(c, frame); this.drawHitboxOverlay(c, frame); return; }
    const pose = this.keeperPose();
    // Signature FX behind the keeper.
    if (this.keeper === "peacock") { c.fillStyle = "#2a6fdb"; const lean = this.tell?.lean ?? 0; for (let i = -3; i <= 3; i++) { const a = -Math.PI / 2 + i * 0.28 + lean * 0.35; c.fillRect(Math.round(pose.x + Math.cos(a) * 26), Math.round(pose.y - 34 + Math.sin(a) * 24), 4, 4); c.fillStyle = i % 2 ? "#1d8a8a" : "#ffd23f"; } }
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
    drawKeeperFrame(c, frame, { alpha: this.keeperAlpha(), arms: mood ? keeperArms(this.keeper, mood, this.time, shot.outcome.plan.x, shot.outcome.plan.y) : undefined });
    // Telegraph the trailing leg: a "leg!" call-out on the boot whenever it is out, bold when it made the save.
    const legMade = this.modeTime - shot.strikeAt >= shot.flight && shot.outcome.touch === "leg";
    if (frame.leg && frame.progress > 0.35 && (legMade || Math.hypot(frame.leg.foot.x - frame.leg.hip.x, frame.leg.foot.y - frame.leg.hip.y) > 0.18)) {
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
    const g = rigGeometry(frame.id), centre = artPoint(frame), u = GOAL.unit;
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
      const at = { x: KICK_SPOT.x, y: KICK_SPOT.y };
      return celebrationBeat(this.celebration, this.modeTime, this.reduced, this.particles, at, THEMES[this.stadium].confetti);
    }
    if (this.mode === "react") return reactionBeat(this.reaction, this.modeTime, this.reduced);
    if (this.mode === "shot" && this.shot && this.modeTime > this.shot.strikeAt + this.shot.flight + 0.1 && this.shot.outcome.result !== "goal") {
      return reactionBeat(this.shot.outcome.result === "post" ? "post" : this.shot.outcome.result === "save" ? "save" : "miss", this.modeTime - this.shot.strikeAt - this.shot.flight, this.reduced);
    }
    return null;
  }

  private drawFriendLayer(c: CanvasRenderingContext2D) {
    const home = this.ballHome(), fkOffset = this.kind === "freekick" ? { x: home.x - SPOT.x, y: Math.min(0, home.y - SPOT.y) } : { x: 0, y: 0 };
    let x = STRIKER.x + fkOffset.x, y = STRIKER.y + fkOffset.y, facing: Facing = "up", walking = false, sx = 1, sy = 1, rotate = 0, flip = false, cape = this.layers.cape, trophy = false;
    const frame = this.reduced ? 0 : Math.floor(this.time * 9) % 8;
    if (this.mode === "shot" && this.shot) {
      const p = clamp01(this.modeTime / STRIKE_AT);
      x = lerp(STRIKER.x, KICK_SPOT.x, ease.inOutCubic(p)) + fkOffset.x; y = lerp(STRIKER.y, KICK_SPOT.y, ease.inOutCubic(p)) + fkOffset.y; walking = p > 0 && p < 1;
      if (walking) { const step = (this.modeTime * 6) % 1; sy = 1 - Math.abs(Math.sin(step * Math.PI)) * 0.08; sx = 2 - sy; }
      if (Math.abs(this.modeTime - STRIKE_AT) < 0.1) { sx = 1.12; sy = 0.9; rotate = -0.12; }
    }
    if (this.mode !== "idle" && this.mode !== "walkout" && !(this.mode === "shot" && this.shot && this.modeTime < this.shot.strikeAt + this.shot.flight + 0.1)) { x = KICK_SPOT.x + fkOffset.x; y = KICK_SPOT.y + fkOffset.y; }
    const beat = this.friendBeat();
    if (beat) { x += beat.dx; y += beat.dy; rotate = beat.rotate; sx = beat.sx; sy = beat.sy; flip = beat.flip; facing = beat.facing; cape = cape || beat.cape; trophy = beat.trophy; }
    if (this.mode === "walkout") { const p = ease.outCubic(clamp01(this.modeTime / 2)); x = lerp(240, STRIKER.x, p); y = lerp(360, STRIKER.y, p); walking = p < 1; facing = "up"; }
    const rows = this.rows(facing, walking, frame);
    drawFriend(c, rows, { x, y, scale: 4, rotate, sx, sy, flip, alpha: 1 }, { ...this.layers, cape }, this.time);
    if (trophy) drawTrophy(c, x, y - 78);
  }

  private drawBallLayer(c: CanvasRenderingContext2D) {
    if (!this.ballVisible) return;
    const fx = seasonFx(this.season, this.rarity), onFire = this.streak >= 3;
    const home = this.ballHome();
    let { x, y, r } = { x: home.x, y: home.y, r: "pxPerM" in home ? Math.max(2, 0.11 * home.pxPerM) : 4.5 }, spin = 0;
    const shot = this.shot;
    if (shot && this.mode === "shot" && this.modeTime >= shot.strikeAt && this.fk && this.freeKick) {
      const since = this.modeTime - shot.strikeAt, last = this.fk.path[this.fk.path.length - 1];
      if (since <= last.t) {
        const at = fkProject(this.freeKick.setup, pathAt(this.fk.path, since));
        x = at.x; y = at.y; r = Math.max(1.4, 0.11 * at.pxPerM); spin = this.time * 14 * (Math.abs(this.fk.knuckle ? 0 : 1) || 0.1);
        if (this.fk.knuckle && !this.reduced) spin = Math.sin(this.time * 9) * 0.4;
        const ground = fkProject(this.freeKick.setup, { ...pathAt(this.fk.path, since), y: 0 });
        c.fillStyle = "#00000040"; c.beginPath(); c.ellipse(ground.x, ground.y, r, r * 0.35, 0, 0, Math.PI * 2); c.fill();
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
        else if (result === "save") { const dir = end.x >= 240 ? 1 : -1; x = end.x + dir * 130 * q; y = end.y + 95 * q - 45 * Math.sin(Math.PI * q); r = 2.5 + 2 * q; spin = this.time * 20; }
        else if (result === "post") { x = end.x + (240 - end.x) * 0.5 * q; y = end.y + 120 * ease.outBounce(q) - 20; r = 2.5 + 2 * q; }
        else if (result === "over") { x = end.x + (end.x - 240) * 0.5 * q; y = end.y - 70 * q; r = 2.5 - 1.2 * q; }
        else { x = end.x + (end.x - 240) * 1.2 * q; y = end.y + 20 * q; r = 2.5; }
        if (q >= 1 && result !== "goal") return;
      }
      { const at = this.goalPoint({ x, y }); x = at.x; y = at.y; r = Math.max(1.2, r * xf.g); }
      if (p < 1 && !this.reduced) { emitTrail(this.particles, fx, x, y, onFire); if (this.lucky) emitLucky(this.particles, x, y); }
    }
    c.fillStyle = "#00000040"; c.beginPath(); c.ellipse(x, Math.min(H - 2, Math.max(y + r, home.y + 5 - (home.y - y) * 0.2)), r, r * 0.35, 0, 0, Math.PI * 2); c.fill();
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
    const x = W - 92, y = 2, board = this.stadium === "park" ? "#6d4c41" : this.stadium === "pro" ? "#0b0d1a" : "#3d2600";
    c.fillStyle = "#0b0d1a"; c.fillRect(x - 1, y - 1, 90, 20); c.fillStyle = board; c.fillRect(x, y, 88, 18);
    c.fillStyle = this.stadium === "pro" ? "#ccff00" : this.stadium === "champions" ? "#ffd23f" : "#f7f7f2";
    c.font = "8px PixelifySans, monospace"; c.textBaseline = "top";
    c.fillText("SCORE", x + 4, y + 5);
    const text = String(this.score).padStart(5, "0"), old = String(this.scoreFlip.from).padStart(5, "0");
    for (let i = 0; i < 5; i++) {
      const dx = x + 38 + i * 9, flipping = text[i] !== old[i] && this.scoreFlip.t < 1;
      c.fillStyle = "#00000055"; c.fillRect(dx - 1, y + 3, 8, 12);
      c.fillStyle = this.stadium === "pro" ? "#ccff00" : "#ffffff";
      if (flipping) { const k = Math.abs(Math.cos(this.scoreFlip.t * Math.PI)); c.save(); c.translate(dx + 3, y + 9); c.scale(1, Math.max(0.1, k)); c.fillText(this.scoreFlip.t < 0.5 ? old[i] : text[i], -2, -4); c.restore(); }
      else c.fillText(text[i], dx + 1, y + 5);
    }
    if (this.streak >= 2) { c.fillStyle = "#ff8c00"; c.fillText(`STREAK ×${Math.min(3, 1 + 0.5 * (this.streak - 1))}`, x + 4, y + 21); }
    c.textBaseline = "alphabetic";
  }

  private drawCommentary(c: CanvasRenderingContext2D) {
    if (!this.said) return;
    const t = this.said.t, slide = ease.outBack(clamp01(t / 0.35)), fade = t > 2.8 ? 1 - (t - 2.8) / 0.4 : 1;
    const text = this.said.text.slice(0, Math.floor(t * 40)), width = Math.min(260, 30 + this.said.text.length * 4.6);
    c.globalAlpha = Math.max(0, fade);
    const x = Math.round(W / 2 - width / 2), y = Math.round(lerp(-28, 26, slide));
    c.fillStyle = "#0b0d1ae6"; c.fillRect(x, y, width, 22); c.fillStyle = "#ffd23f"; c.fillRect(x, y + 21, width, 1);
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

  private drawWalkout(c: CanvasRenderingContext2D) {
    const t = this.modeTime, dark = 0.55 * (1 - clamp01((t - 2.2) / 0.8));
    c.fillStyle = `rgba(0,0,0,${dark})`; c.fillRect(0, 0, W, H);
    const p = ease.outCubic(clamp01(t / 2)), fx = lerp(240, STRIKER.x, p), fy = lerp(360, STRIKER.y, p);
    const g = c.createRadialGradient(fx, fy - 30, 4, fx, fy - 30, 70); g.addColorStop(0, "rgba(255,246,200,0.35)"); g.addColorStop(1, "rgba(255,246,200,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const banner = ease.outBack(clamp01((t - 0.6) / 0.5));
    c.save(); c.translate(W / 2, 150); c.scale(banner, banner);
    c.fillStyle = "#ffd23f"; c.fillRect(-110, -14, 220, 28); c.fillStyle = "#0b0d1a"; c.fillRect(-108, -12, 216, 24);
    c.fillStyle = "#ffd23f"; c.font = "bold 12px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(this.friendName.toUpperCase(), 0, 0);
    c.textAlign = "left"; c.textBaseline = "alphabetic"; c.restore();
  }

  private drawReveal(c: CanvasRenderingContext2D) {
    const r = this.reveal!, t = r.t, top = r.plan.fullScreen, fx = RARITY_FX[r.rarity];
    c.fillStyle = `rgba(0,0,0,${Math.min(0.7, t * 2)})`; c.fillRect(0, 0, W, H);
    // Light cone.
    const cone = c.createLinearGradient(0, 0, 0, H); cone.addColorStop(0, fx.trail[0] + "aa"); cone.addColorStop(1, fx.trail[0] + "00");
    c.fillStyle = cone; c.beginPath(); c.moveTo(W / 2 - 20, 0); c.lineTo(W / 2 + 20, 0); c.lineTo(W / 2 + 70, 200); c.lineTo(W / 2 - 70, 200); c.fill();
    if (top && !this.reduced) {
      c.save(); c.translate(W / 2, 140); c.rotate(t * 0.6);
      for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.fillStyle = i % 2 ? "#ff8c0055" : "#ffd23f44"; c.beginPath(); c.moveTo(0, 0); c.lineTo(-18, -300); c.lineTo(18, -300); c.fill(); }
      c.restore();
      if (Math.random() < 0.8) this.particles.emit("fire", W / 2 + (Math.random() - 0.5) * 40, 150, 3, { color: ["#ff8c00", "#ff3b1f", "#ffd23f"], speed: 40, gravity: -60, life: 0.8, size: 2 });
    }
    const spinDown = Math.max(0, 1 - t / 1.2), spin = (1 - spinDown * spinDown) * 20 + t * 0.5;
    drawBall(c, W / 2, 140, 14, fx, this.reduced ? 0 : spin, 0, top);
    if (t > 1.1) {
      const slam = ease.outBack(clamp01((t - 1.1) / 0.35));
      if (t < 1.2 && !this.reduced) { this.camera.addTrauma(0.15 * (1 + fx.tier)); this.particles.emit(fx.tier >= 4 ? "sparkle" : "confetti", W / 2, 140, 12 + fx.tier * 14, { color: fx.trail.concat(["#ffffff"]), speed: 90 + fx.tier * 20, spread: Math.PI * 2, gravity: 40, life: 1.4 }); }
      c.save(); c.translate(W / 2, 200); c.scale(slam, slam);
      c.fillStyle = fx.accent; c.fillRect(-120, -16, 240, 32); c.fillStyle = "#0b0d1a"; c.fillRect(-117, -13, 234, 26);
      c.fillStyle = fx.base === "#ffffff" ? fx.accent : fx.base; c.font = "bold 14px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
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
}

export { CELEBRATIONS, RARITY_NAMES, STRIKER, KICK_SPOT };
export type { ShotResult };
