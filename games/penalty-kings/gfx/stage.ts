/**
 * The Stage: one scene engine used by the game and the dev Showroom.
 * Layers: sky → stands → crowd → boards → pitch → net → keeper → goal frame → ball → striker → FX → canvas UI.
 * Choreography: build-up → run-up → strike (hit-stop, flash, ring) → flight → outcome → celebration/reaction.
 */
import { keeperById, keeperAt, flightAt, type KeeperId, type KeeperPlan, type ShotResult, type ShotOutcome } from "@penalty-kings/engine";
import { W, H, ease, clamp01, lerp, Camera, Particles, Timeline } from "./core.js";
import { drawBackdrop, drawBoards, drawPitch, drawWeather, drawHeatShimmer, drawGoalFrame, GOAL, SPOT, THEMES, toScreen, type StadiumId, type Weather } from "./stadium.js";
import { Crowd } from "./crowd.js";
import { Net } from "./net.js";
import { drawKeeper, keeperArms, KEEPER_DESIGNS, KEEPER_TAUNTS, type KeeperPose } from "./keepers.js";
import { drawBall, emitTrail, RARITY_FX } from "./ball.js";
import { drawFriend, celebrationBeat, reactionBeat, drawTrophy, CELEBRATIONS, type CelebrationId, type FriendLayers } from "./friend.js";
import { commentary, drawCommentator, type CommentaryContext } from "./commentary.js";

export type Facing = "up" | "down" | "left" | "right";
export type RowsProvider = (facing: Facing, walking: boolean, frame: number) => readonly string[] | null;
export type StageEvent = "sfx" | "strike" | "resolved" | "done" | "reveal-done" | "walkout-done";
export type Sfx = "heartbeat" | "whistle" | "kick" | "whoosh" | "net" | "clang" | "glove" | "roar" | "groan" | "ooh" | "chant" | "reveal" | "reveal-top" | "stomp" | "boo" | "beep" | "honk" | "blub" | "squeak" | "yawn";

const RARITY_NAMES = ["Scuffed Ball", "Training Ball", "Match Ball", "Pro Ball", "Silver Ball", "Gold Ball", "Golden Boot Ball", "Warm-up Ball"];
const STRIKER = { x: 206, y: 306 }, KICK_SPOT = { x: 228, y: 274 };

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
  reticle: { x: number; y: number; power: number; curl: number; active: boolean } | null = null;
  ballVisible = false;
  /** Readable pre-kick tell (lean, scan, wall) for the current keeper and ball. */
  tell: KeeperPlan | null = null;

  private mode: "idle" | "shot" | "celebrate" | "react" | "walkout" = "idle";
  private modeTime = 0;
  private timeline = new Timeline();
  private shot: { outcome: ShotOutcome; curl: number; flight: number; strikeAt: number } | null = null;
  private ball = { x: SPOT.x, y: SPOT.y, r: 4.5, spin: 0, squash: 0 };
  private flash = 0; private ring: { x: number; y: number; t: number } | null = null;
  private postWobble = 0; private goalFlash = 0;
  private bubble: { text: string; t: number } | null = null;
  private said: { text: string; t: number } | null = null;
  private reveal: { rarity: number; t: number } | null = null;
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

  // ── Moments ───────────────────────────────────────────────────────────────
  say(context: CommentaryContext) { this.said = { text: commentary(context, { friend: this.friendName, keeper: keeperById(this.keeper).name }), t: 0 }; }

  /** Play the whole choreographed shot for an already-resolved outcome. */
  play(outcome: ShotOutcome, curl: number) {
    this.timeline.reset(); this.mode = "shot"; this.modeTime = 0; this.ballVisible = true; this.reticle = null;
    const flight = Math.max(0.45, outcome.target.time * 1.6);
    this.shot = { outcome, curl, flight, strikeAt: 1.2 };
    this.crowd.react("tense");
    this.camera.targetZoom = this.reduced ? 1 : 1.06; this.camera.targetY = H / 2 - 6;
    this.sfx("heartbeat"); this.say(keeperById(this.keeper).boss ? "boss" : "buildup");
    this.timeline
      .at(0.35, () => this.sfx("heartbeat"))
      .at(0.6, () => this.sfx("whistle"))
      .at(0.85, () => this.dust(STRIKER.x + 8, STRIKER.y - 10)).at(1.0, () => this.dust(STRIKER.x + 14, STRIKER.y - 20)).at(1.15, () => this.dust(STRIKER.x + 20, STRIKER.y - 28))
      .at(1.2, () => {
        this.camera.hitStop = 0.07; this.flash = this.reduced ? 0 : 0.35; this.ring = { x: SPOT.x, y: SPOT.y, t: 0 };
        this.ball.squash = 0.35; this.camera.addTrauma(0.25); this.camera.targetZoom = this.reduced ? 1 : 1.12;
        this.particles.emit("grass", SPOT.x, SPOT.y + 3, 10, { color: ["#2e7d32", "#8bc34a"], speed: 50, spread: 1.4, life: 0.5 });
        this.sfx("kick"); this.sfx("whoosh"); this.onEvent("strike");
        const k = KEEPER_DESIGNS[this.keeper].sfx; if (k === "stomp") { this.camera.addTrauma(0.3); this.sfx("stomp"); }
      })
      .at(1.2 + flight, () => this.resolve())
      .at(1.2 + flight + (outcome.result === "goal" ? 1.0 : 2.2), () => {
        if (outcome.result === "goal") this.startCelebration(this.celebration); else this.finish();
      });
  }

  private resolve() {
    const shot = this.shot!, result = shot.outcome.result, end = toScreen(shot.outcome.target.x, shot.outcome.target.y);
    this.crowd.react(result === "goal" ? "cheer" : result === "post" || result === "over" ? "ooh" : "groan");
    this.say(result);
    this.onEvent("resolved", result);
    this.camera.targetZoom = 1; this.camera.targetY = H / 2;
    if (result === "goal") {
      this.net.impulse(end.x, end.y, 160); this.camera.addTrauma(0.5); this.goalFlash = 2;
      this.particles.emit("confetti", end.x, end.y - 10, 60, { color: THEMES[this.stadium].confetti, speed: 140, spread: Math.PI * 1.2, gravity: 70, life: 2.4 });
      this.particles.emit("thread", end.x, end.y, 8, { color: "#ffffff", speed: 60, life: 0.5, gravity: 60 });
      this.sfx("net"); this.sfx("roar");
      this.streak += 1; if (this.streak >= 2) this.crowd.startWave(); if (this.streak >= 2) this.sfx("chant");
    } else {
      this.streak = 0; this.reaction = result === "post" ? "post" : result === "save" ? "save" : "miss";
      if (result === "save") {
        this.particles.emit("spark", end.x, end.y, 16, { color: ["#ffffff", "#ffd23f"], speed: 90, spread: Math.PI * 2, life: 0.4, gravity: 0 });
        if (this.keeper === "octopus") this.particles.emit("ink", end.x, end.y, 20, { color: "#1a0f2e", speed: 40, spread: Math.PI * 2, life: 1, gravity: 20, size: 2 });
        const taunts = KEEPER_TAUNTS[this.keeper]; this.bubble = { text: taunts[Math.floor(Math.random() * taunts.length)], t: 0 };
        this.camera.hitStop = 0.07; this.camera.addTrauma(0.3); this.sfx("glove"); this.sfx("groan"); this.sfx(KEEPER_DESIGNS[this.keeper].sfx as Sfx);
      } else if (result === "post") {
        this.postWobble = 1.4; this.camera.addTrauma(0.45); this.sfx("clang"); this.sfx("ooh");
        this.particles.emit("spark", end.x, end.y, 10, { color: "#ffffff", speed: 70, spread: Math.PI * 2, life: 0.3, gravity: 0 });
      } else if (result === "over") { this.fanCatch = { x: end.x + (end.x - 240) * 0.5, t: 0 }; this.sfx("ooh"); }
      else { this.ballKid = { t: 0, x: end.x > 240 ? W + 10 : -10 }; this.sfx("groan"); }
    }
    this.scoreFlip = { from: this.score, t: 0 };
  }

  startCelebration(id: CelebrationId) { this.celebration = id; this.mode = "celebrate"; this.modeTime = 0; this.ballVisible = false; this.crowd.react("cheer"); }
  react(kind: "miss" | "save" | "post") { this.reaction = kind; this.mode = "react"; this.modeTime = 0; }
  walkout() { this.mode = "walkout"; this.modeTime = 0; this.crowd.react("cheer"); this.sfx("chant"); this.say("walkout"); }
  showReveal(rarity: number) { this.reveal = { rarity, t: 0 }; this.rarity = rarity; this.sfx(rarity >= 6 ? "reveal-top" : "reveal"); if (rarity >= 5) this.say(rarity >= 6 ? "rarity-top" : "rarity-high"); }
  wave() { this.crowd.startWave(); this.crowd.react("cheer"); }
  setScore(score: number) { if (score !== this.score) { this.scoreFlip = { from: this.score, t: 0 }; this.score = score; } }
  private finish() { this.mode = "idle"; this.shot = null; this.ballVisible = false; this.onEvent("done"); }
  private dust(x: number, y: number) { this.particles.emit("dust", x, y, 5, { color: ["#c8b99a", "#a89878"], speed: 25, spread: 1.6, life: 0.5, gravity: -10 }); }
  private sfx(name: Sfx) { this.onEvent("sfx", name); }

  // ── Update ────────────────────────────────────────────────────────────────
  update(realDt: number) {
    if (this.camera.hitStop > 0) { this.camera.hitStop -= realDt; return; }
    const slow = this.shot && this.shot.outcome.result === "post" && this.mode === "shot" && !this.reduced && this.modeTime > this.shot.strikeAt + this.shot.flight * 0.7 && this.modeTime < this.shot.strikeAt + this.shot.flight + 0.4 ? 0.35 : 1;
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
    if (this.reveal) { this.reveal.t += dt; const length = this.reveal.rarity >= 6 ? 3.8 : 2.4; if (this.reveal.t > length) { this.reveal = null; this.onEvent("reveal-done"); } }
    if (this.mode === "celebrate" && this.modeTime > 2.6) this.finish();
    if (this.mode === "react" && this.modeTime > 1.6) { this.mode = "idle"; this.onEvent("done"); }
    if (this.mode === "walkout" && this.modeTime > 3) { this.mode = "idle"; this.onEvent("walkout-done"); }
    if (this.keeper === "sloth" && Math.random() < dt * 0.6) this.particles.emit("zzz", GOAL.cx + 14, GOAL.line - 60, 1, { color: "#ffffff", speed: 8, angle: -1.2, spread: 0.3, life: 1.5, gravity: -6 });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  render(c: CanvasRenderingContext2D) {
    c.save();
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b0d1a"; c.fillRect(0, 0, W, H);
    this.camera.apply(c, this.time);
    const pan = (this.camera.x - W / 2) * 2;
    drawBackdrop(c, this.stadium, this.weather, this.time, pan, { goalFlash: this.goalFlash });
    this.crowd.draw(c, this.time, pan, this.particles, this.reduced);
    this.drawFan(c);
    drawBoards(c, this.stadium, this.time, pan);
    drawPitch(c, this.stadium, this.weather);
    drawHeatShimmer(c, this.streak >= 2 && !this.reduced ? Math.min(1, this.streak - 1) : 0, this.time);
    this.drawReferee(c);
    this.net.draw(c);
    const ballBehind = this.ballBehindKeeper();
    if (ballBehind) this.drawBallLayer(c);
    this.drawKeeperLayer(c);
    drawGoalFrame(c, this.reduced ? 0 : this.postWobble, this.time);
    this.drawReticle(c);
    this.crowd.drawCat(c, 1 / 60);
    const friendFirst = ballBehind;
    if (friendFirst) this.drawFriendLayer(c);
    if (!ballBehind) this.drawBallLayer(c);
    if (!friendFirst) this.drawFriendLayer(c);
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
    let gx = Math.sin(this.time * 2.2) * 0.1, gy = 0, rotate = 0, stretch = 1, mood: KeeperPose["mood"] = "idle", alpha = 1;
    const bounce = Math.abs(Math.sin(this.time * 5)) * 3;
    let lift = this.reduced ? 0 : bounce;
    if (this.tell && this.mode !== "shot") { gx += this.tell.lean * 0.15; if (this.keeper === "peacock" || this.keeper === "squirrel") mood = "taunt"; }
    if (shot && this.mode === "shot") {
      const flightT = this.modeTime - shot.strikeAt;
      if (flightT < 0) { mood = this.modeTime < 0.7 ? "taunt" : "idle"; gx += shot.outcome.plan.lean * 0.12; }
      else {
        const hands = keeperAt(shot.outcome.plan, Math.min(shot.outcome.target.time + 0.3, (flightT / shot.flight) * shot.outcome.target.time));
        gx = hands.x * 0.85; gy = Math.max(0, hands.y - 0.45) * 0.7 * hands.progress; lift = gy * 60;
        rotate = Math.atan2(hands.x, 0.9) * hands.progress * 1.3; stretch = 1 + hands.progress * 0.15; mood = hands.progress > 0.05 ? "dive" : "idle";
        if (flightT > shot.flight + 0.2) mood = shot.outcome.result === "goal" ? "sad" : "celebrate";
        if (shot.outcome.plan.teleport && hands.progress > 0) rotate = 0;
      }
    }
    if (this.keeper === "ghost") alpha = 0.7 + 0.2 * Math.sin(this.time * 8);
    if (this.keeper === "chameleon") alpha = shot && this.modeTime >= shot.strikeAt ? 1 : 0.12 + 0.06 * Math.sin(this.time * 3);
    const [armL, armR] = keeperArms(this.keeper, mood, this.time, shot?.outcome.plan.x ?? 0, shot?.outcome.plan.y ?? 0.4);
    const { x } = toScreen(gx, 0);
    void design;
    return { x, y: GOAL.line - lift, rotate, stretch, armL, armR, alpha, scaleMul, mood };
  }

  private drawKeeperLayer(c: CanvasRenderingContext2D) {
    const pose = this.keeperPose();
    // Signature FX behind the keeper.
    if (this.keeper === "peacock") { c.fillStyle = "#2a6fdb"; const lean = this.tell?.lean ?? 0; for (let i = -3; i <= 3; i++) { const a = -Math.PI / 2 + i * 0.28 + lean * 0.35; c.fillRect(Math.round(pose.x + Math.cos(a) * 26), Math.round(pose.y - 34 + Math.sin(a) * 24), 4, 4); c.fillStyle = i % 2 ? "#1d8a8a" : "#ffd23f"; } }
    if (this.keeper === "disco" && !this.reduced) { const colors = ["#ff4fd8", "#ccff00", "#7fd3ff"]; for (let i = 0; i < 6; i++) { c.fillStyle = colors[(Math.floor(this.time * 4) + i) % 3] + "55"; c.fillRect(GOAL.left + i * 30, GOAL.bar + ((i * 13 + Math.floor(this.time * 8)) % 60), 20, 3); } }
    if (this.keeper === "finalwall") { c.fillStyle = `rgba(255,59,31,${0.15 + 0.1 * Math.sin(this.time * 4)})`; c.fillRect(pose.x - 40, GOAL.bar, 80, GOAL.line - GOAL.bar); }
    const drawn = drawKeeper(c, this.keeper, pose, this.time);
    // Tells in front.
    if (this.keeper === "robot" && this.tell?.scan) { c.fillStyle = "#ff5a6e88"; const sx = GOAL.cx + this.tell.scan * 60; c.fillRect(sx - 30, GOAL.bar + ((this.time * 60) % (GOAL.line - GOAL.bar)), 60, 2); }
    if (this.keeper === "mime" && this.tell?.wall) { c.fillStyle = `rgba(255,255,255,${0.08 + 0.05 * Math.sin(this.time * 5)})`; const [a, b] = this.tell.wall; const x1 = toScreen(Math.max(-1, a), 0).x, x2 = toScreen(Math.min(1, b), 0).x; c.fillRect(x1, GOAL.bar, x2 - x1, GOAL.line - GOAL.bar); }
    void drawn;
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
    let x = STRIKER.x, y = STRIKER.y, facing: Facing = "up", walking = false, sx = 1, sy = 1, rotate = 0, flip = false, cape = this.layers.cape, trophy = false;
    const frame = this.reduced ? 0 : Math.floor(this.time * 9) % 8;
    if (this.mode === "shot" && this.shot) {
      const p = clamp01((this.modeTime - 0.7) / 0.5);
      x = lerp(STRIKER.x, KICK_SPOT.x, ease.inOutCubic(p)); y = lerp(STRIKER.y, KICK_SPOT.y, ease.inOutCubic(p)); walking = p > 0 && p < 1;
      if (walking) { const step = (this.modeTime * 6) % 1; sy = 1 - Math.abs(Math.sin(step * Math.PI)) * 0.08; sx = 2 - sy; }
      if (Math.abs(this.modeTime - 1.2) < 0.12) { sx = 1.12; sy = 0.9; rotate = -0.12; }
    }
    if (this.mode !== "idle" && this.mode !== "walkout" && !(this.mode === "shot" && this.shot && this.modeTime < this.shot.strikeAt + this.shot.flight + 0.1)) { x = KICK_SPOT.x; y = KICK_SPOT.y; }
    const beat = this.friendBeat();
    if (beat) { x += beat.dx; y += beat.dy; rotate = beat.rotate; sx = beat.sx; sy = beat.sy; flip = beat.flip; facing = beat.facing; cape = cape || beat.cape; trophy = beat.trophy; }
    if (this.mode === "walkout") { const p = ease.outCubic(clamp01(this.modeTime / 2)); x = lerp(240, STRIKER.x, p); y = lerp(360, STRIKER.y, p); walking = p < 1; facing = "up"; }
    const rows = this.rows(facing, walking, frame);
    drawFriend(c, rows, { x, y, scale: 4, rotate, sx, sy, flip, alpha: 1 }, { ...this.layers, cape }, this.time);
    if (trophy) drawTrophy(c, x, y - 78);
  }

  private drawBallLayer(c: CanvasRenderingContext2D) {
    if (!this.ballVisible) return;
    const fx = RARITY_FX[this.rarity], onFire = this.streak >= 3;
    let { x, y, r } = { x: SPOT.x, y: SPOT.y, r: 4.5 }, spin = 0;
    const shot = this.shot;
    if (shot && this.mode === "shot" && this.modeTime >= shot.strikeAt) {
      const p = clamp01((this.modeTime - shot.strikeAt) / shot.flight), target = shot.outcome.target, end = toScreen(target.x, target.y);
      const f = flightAt(target, shot.curl, p), bow = (f.x - target.x * p) * GOAL.unit;
      x = SPOT.x + (end.x - SPOT.x) * p + bow; y = SPOT.y + (end.y - SPOT.y) * p - Math.sin(Math.PI * p) * 12; r = 4.5 - 2 * p; spin = this.time * 14 * (shot.curl || 0.4);
      if (p < 1 && !this.reduced) emitTrail(this.particles, fx, x, y, onFire);
      if (p >= 1) {
        const q = clamp01((this.modeTime - shot.strikeAt - shot.flight) / 1.3), result = shot.outcome.result;
        if (result === "goal") { x = end.x + (240 - end.x) * 0.1 * q; y = end.y + ease.outBounce(q) * (GOAL.line - 4 - end.y); r = 2.3; }
        else if (result === "save") { const dir = end.x >= 240 ? 1 : -1; x = end.x + dir * 130 * q; y = end.y + 95 * q - 45 * Math.sin(Math.PI * q); r = 2.5 + 2 * q; spin = this.time * 20; }
        else if (result === "post") { x = end.x + (240 - end.x) * 0.5 * q; y = end.y + 120 * ease.outBounce(q) - 20; r = 2.5 + 2 * q; }
        else if (result === "over") { x = end.x + (end.x - 240) * 0.5 * q; y = end.y - 70 * q; r = 2.5 - 1.2 * q; }
        else { x = end.x + (end.x - 240) * 1.2 * q; y = end.y + 20 * q; r = 2.5; }
        if (q >= 1 && result !== "goal") return;
      }
    }
    c.fillStyle = "#00000040"; c.beginPath(); c.ellipse(x, Math.min(H - 2, Math.max(y + r, SPOT.y + 5 - (SPOT.y - y) * 0.2)), r, r * 0.35, 0, 0, Math.PI * 2); c.fill();
    drawBall(c, x, y, r, fx, spin, this.ball.squash, onFire);
  }

  private drawReticle(c: CanvasRenderingContext2D) {
    const reticle = this.reticle;
    if (!reticle || this.mode !== "idle") return;
    const { x, y } = toScreen(reticle.x, reticle.y), color = reticle.y > 1 || Math.abs(reticle.x) > 1 ? "#ff5a6e" : "#ccff00";
    c.strokeStyle = "#ffffff66"; c.setLineDash([2, 3]); c.beginPath();
    for (let i = 0; i <= 16; i++) { const p = i / 16, f = flightAt({ x: reticle.x, y: reticle.y }, reticle.curl, p), bow = (f.x - reticle.x * p) * GOAL.unit; const px = SPOT.x + (x - SPOT.x) * p + bow, py = SPOT.y + (y - SPOT.y) * p - Math.sin(Math.PI * p) * 12; i ? c.lineTo(px, py) : c.moveTo(px, py); }
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
    const pop = ease.outBack(clamp01(this.bubble.t / 0.3)), x = GOAL.cx + 40, y = GOAL.bar - 6, w = 10 + this.bubble.text.length * 5;
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
    const r = this.reveal!, t = r.t, top = r.rarity >= 6, fx = RARITY_FX[r.rarity];
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
    this.particles.draw(c);
  }
}

export { CELEBRATIONS, RARITY_NAMES, STRIKER, KICK_SPOT };
export type { ShotResult };
