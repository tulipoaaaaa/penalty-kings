/**
 * Game feel (Part B: B1 goal moment, B2 near-miss drama, B6 streak fever).
 *
 * The first half is pure logic (hit-stop per event, trauma per moment, pixel-snapped shake, fever
 * tier, the slow-mo rate limit, close-call and fingertip tests, confetti per stadium): unit-tested in
 * tests/game/feel.test.ts. The second half draws the short-lived FX the Stage fires (contact star,
 * speed lines, woodwork spark star, the "SO CLOSE!" beat, the fever chant ribbon).
 *
 * Reduced motion: no shake, no flash, no slow-mo; the hit-stop is a static freeze (nothing wobbles
 * during it) and every FX has a still, non-flashing equivalent.
 */
import { keeperFrame, keeperTouch, BALL_RADIUS, GOAL_ASPECT, type KeeperId, type ShotOutcome } from "@penalty-kings/engine";
import { W, ease, clamp01, pixelStar } from "./core.js";

// ── Hit-stop (Nijman "sleep"; research R1 #1) ────────────────────────────────
export type HitStopEvent = "strike" | "net" | "post" | "fingertip" | "save";
/** Seconds the sim and the render freeze (audio keeps playing): light 50 ms, medium 90 ms, huge 120 ms. */
export const HIT_STOP: Readonly<Record<HitStopEvent, number>> = { strike: 0.05, net: 0.09, post: 0.12, fingertip: 0.08, save: 0.06 };
/** The freeze for a moment. Reduced motion keeps the (static) freeze: only its wobble goes. */
export const hitStopFor = (event: HitStopEvent) => HIT_STOP[event];

// ── Trauma camera (Eiserloh, GDC 2016; research R1 #3) ───────────────────────
/** Trauma added per moment (0–1). A goal scales with pace and the streak fever (moment size). */
export const TRAUMA = { strike: 0.22, post: 0.5, save: 0.28, fingertip: 0.34 } as const;
export function goalTrauma(pace: number, tier: FeverTier) { return Math.min(0.85, 0.34 + 0.24 * clamp01(pace) + 0.07 * tier); }
/** Pace 0–1 of a penalty from the engine's crossing time (0.4 s = a rocket, 0.95 s = a roller). */
export const paceOf = (targetTime: number) => clamp01((0.95 - targetTime) / 0.55);
export { SHAKE_MAX, shakeOffset, punchEnvelope } from "./core.js";
/** Zoom punch (added to the zoom) per moment: a goal pushes in on the net point; smaller beats elsewhere. */
export const PUNCH = { goal: 0.22, post: 0.1, save: 0.07 } as const;

// ── Streak fever (Peggle; research R1 #11, R5) ───────────────────────────────
export type FeverTier = 0 | 1 | 2 | 3;
/** Goals in a row that reach fever tiers 1 / 2 / 3. */
export const FEVER_AT = [3, 5, 10] as const;
/** 3 = louder crowd + heat shimmer, 5 = the "on fire" ball trail, 10 = stadium-wide chant + commentator losing it. */
export function feverTier(streak: number): FeverTier { return streak >= FEVER_AT[2] ? 3 : streak >= FEVER_AT[1] ? 2 : streak >= FEVER_AT[0] ? 1 : 0; }
/** The stinger when a goal lands exactly on a threshold (null otherwise: a stinger marks the step, not every goal). */
export function feverStinger(streak: number): "stinger-3" | "stinger-5" | "stinger-10" | null {
  return streak === FEVER_AT[0] ? "stinger-3" : streak === FEVER_AT[1] ? "stinger-5" : streak === FEVER_AT[2] ? "stinger-10" : null;
}

// ── Slow motion on a genuine close call (Peggle Extreme Fever; research R1 #9, R2 #2) ─────
/**
 * 0.3× over the last ≤ 0.12 s of sim flight (≤ 400 ms of real time), snapping back to 1× at impact.
 * `budget`: release → result stays ≤ 1.15 s even with the slow-mo (the flow test holds every kick to 1.2 s),
 * so a slow roller gets a shorter beat than a rocket.
 */
export const SLOWMO = { rate: 0.3, window: 0.12, every: 3, budget: 1.15 } as const;
/** Sim seconds of slow-mo for a flight of `flight` s struck `strikeAt` s after release. */
export function slowMoWindow(flight: number, strikeAt = 0.4) {
  const spare = SLOWMO.budget - strikeAt - HIT_STOP.strike - flight;
  return Math.max(0, Math.min(SLOWMO.window, spare / (1 / SLOWMO.rate - 1), flight * 0.5));
}
export function slowMoRate(since: number, flight: number, strikeAt = 0.4) { return since >= flight - slowMoWindow(flight, strikeAt) && since < flight ? SLOWMO.rate : 1; }
/** At most 1 slow-mo in any 3 consecutive kicks, never under reduced motion. `allow` is called once per live kick. */
export class SlowMoGate {
  private since = Infinity;
  allow(close: boolean, reduced: boolean) {
    this.since++;
    if (!close || reduced || this.since < SLOWMO.every) return false;
    this.since = 0; return true;
  }
  reset() { this.since = Infinity; }
}

// ── Close calls ──────────────────────────────────────────────────────────────
/** Wide / over by a whisker (goal units): the ball grazed past the frame. */
export const nearFrame = (target: { x: number; y: number }) => Math.abs(Math.abs(target.x) - 1) < 0.12 || Math.abs(target.y - 1) < 0.1;
/**
 * A fingertip save: the glove made it, but only with the ball's outer edge (a ball at 40 % of its
 * radius would have gone past every part of the keeper). Drawn as a deflection that spins off.
 */
export function isFingertip(outcome: Pick<ShotOutcome, "result" | "touch" | "plan" | "target">, keeper: KeeperId) {
  if (outcome.result !== "save" || outcome.touch !== "glove") return false;
  const frame = keeperFrame(keeper, outcome.plan, outcome.target.time);
  return keeperTouch(frame, { x: outcome.target.x, y: outcome.target.y * GOAL_ASPECT }, BALL_RADIUS * 0.4) === null;
}
/** A goal that only just beat the dive: a ball 2.4× bigger would have been touched. */
export function isShaveGoal(outcome: Pick<ShotOutcome, "result" | "plan" | "target">, keeper: KeeperId) {
  if (outcome.result !== "goal") return false;
  return keeperTouch(keeperFrame(keeper, outcome.plan, outcome.target.time), { x: outcome.target.x, y: outcome.target.y * GOAL_ASPECT }, BALL_RADIUS * 2.4) !== null;
}
/** A genuine close call (woodwork, a fingertip, a whisker wide/over, a goal past the fingertips): may earn the slow-mo. */
export function isCloseCall(outcome: Pick<ShotOutcome, "result" | "touch" | "plan" | "target">, keeper: KeeperId | null) {
  if (outcome.result === "post") return true;
  if ((outcome.result === "wide" || outcome.result === "over") && nearFrame(outcome.target)) return true;
  if (!keeper) return false;
  return isFingertip(outcome, keeper) || isShaveGoal(outcome, keeper);
}

// ── Confetti per stadium ─────────────────────────────────────────────────────
export type ConfettiRecipe = Readonly<{ count: number; speed: number; life: number; spread: number; glints: number; glint: readonly string[] }>;
/** Park: a modest handful. Pro: a floodlit neon burst with glints under the lights. Champions: a gold storm. */
export const CONFETTI: Readonly<Record<"park" | "pro" | "champions", ConfettiRecipe>> = {
  park: { count: 34, speed: 105, life: 2, spread: Math.PI * 1.0, glints: 0, glint: [] },
  pro: { count: 60, speed: 140, life: 2.4, spread: Math.PI * 1.2, glints: 10, glint: ["#ffffff", "#e9ffb0"] },
  champions: { count: 84, speed: 165, life: 2.8, spread: Math.PI * 1.35, glints: 18, glint: ["#ffd23f", "#fff2b3", "#ffffff"] },
};

// ── Short-lived FX state and drawing ─────────────────────────────────────────
type Star = { x: number; y: number; t: number; dx: number; dy: number };
type Spark = { x: number; y: number; t: number };
type Banner = { text: string; sub: string; t: number; hot: boolean };
/** Seconds each FX lives. */
export const FX_LIFE = { star: 0.16, clang: 0.4, banner: 1.5, chant: 3.6 } as const;

export class FeelFx {
  star: Star | null = null;
  clang: Spark | null = null;
  banner: Banner | null = null;
  chant = 0; // seconds left of the tier-3 stadium-wide chant ribbon
  update(dt: number) {
    if (this.star && (this.star.t += dt) > FX_LIFE.star) this.star = null;
    if (this.clang && (this.clang.t += dt) > FX_LIFE.clang) this.clang = null;
    if (this.banner && (this.banner.t += dt) > FX_LIFE.banner) this.banner = null;
    this.chant = Math.max(0, this.chant - dt);
  }
  clear() { this.star = this.clang = this.banner = null; this.chant = 0; }
  /** The boot-contact star with 3 radial speed lines, pointing back from the shot direction (dx, dy). */
  contact(x: number, y: number, dx: number, dy: number) { const l = Math.hypot(dx, dy) || 1; this.star = { x, y, t: 0, dx: dx / l, dy: dy / l }; }
  /** The spark star at a woodwork or fingertip contact point. */
  spark(x: number, y: number) { this.clang = { x, y, t: 0 }; }
  /** A two-word beat: `text` pops, `sub` slides in under it. `hot` = the fever colours. */
  say(text: string, sub = "", hot = false) { this.banner = { text, sub, t: 0, hot }; }

  /** World-space FX (inside the camera). */
  drawWorld(c: CanvasRenderingContext2D, reduced: boolean) {
    const s = this.star;
    if (s) {
      const k = s.t / FX_LIFE.star, x = Math.round(s.x), y = Math.round(s.y);
      c.save();
      if (reduced) { c.globalAlpha = 0.8; pixelStar(c, x, y, 3, "#fff6b0"); }
      else {
        c.globalAlpha = 1 - k * 0.6;
        pixelStar(c, x, y, Math.round(3 + 4 * ease.outQuad(Math.min(1, k * 2)) - 3 * Math.max(0, k * 2 - 1)), k < 0.35 ? "#ffffff" : "#fff6b0");
        // 3 radial speed lines behind the contact, fanned around the reverse of the shot direction.
        c.fillStyle = "#ffffff";
        for (let i = -1; i <= 1; i++) {
          const a = Math.atan2(-s.dy, -s.dx) + i * 0.55, from = 5 + k * 6, len = 7 - k * 4 - Math.abs(i) * 2;
          for (let d = 0; d < len; d++) c.fillRect(Math.round(x + Math.cos(a) * (from + d)), Math.round(y + Math.sin(a) * (from + d)), 1, 1);
        }
      }
      c.restore();
    }
    const w = this.clang;
    if (w) {
      const k = w.t / FX_LIFE.clang, x = Math.round(w.x), y = Math.round(w.y);
      c.save(); c.globalAlpha = reduced ? 0.9 : 1 - k * 0.5;
      // A bold 2 px spark star (yellow, so it reads on the white frame), diagonal chips, and a white core.
      const len = reduced ? 6 : Math.round(10 - k * 6), d = Math.round(len * 0.6);
      c.fillStyle = "#ffb347"; c.fillRect(x - len, y - 1, len * 2 + 1, 3); c.fillRect(x - 1, y - len, 3, len * 2 + 1);
      c.fillStyle = "#ffe27a"; c.fillRect(x - len + 1, y, len * 2 - 1, 1); c.fillRect(x, y - len + 1, 1, len * 2 - 1);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.fillRect(x + sx * d, y + sy * d, 2, 2); c.fillRect(x + sx * (d - 2), y + sy * (d - 2), 1, 1); }
      c.fillStyle = "#ffffff"; c.fillRect(x - 1, y - 1, 3, 3);
      c.restore();
    }
  }

  /** Screen-space: the "CLANG!" / "SO CLOSE!" / fever banner under the commentator strip. */
  drawUI(c: CanvasRenderingContext2D, top: number, reduced: boolean, time: number) {
    const b = this.banner;
    if (!b) return;
    const pop = reduced ? 1 : ease.outBack(clamp01(b.t / 0.22)), fade = 1 - clamp01((b.t - FX_LIFE.banner + 0.3) / 0.3);
    const width = Math.max(96, 20 + b.text.length * 11), y = top + 40;
    c.save(); c.globalAlpha = fade; c.translate(W / 2, y); c.scale(pop, pop);
    const jitter = b.hot && !reduced ? Math.round(Math.sin(time * 70)) : 0;
    c.fillStyle = b.hot ? "#ff3b1f" : "#ffd23f"; c.fillRect(-width / 2 - 2 + jitter, -13, width + 4, 26);
    c.fillStyle = "#0b0d1a"; c.fillRect(-width / 2 + jitter, -11, width, 22);
    c.font = "bold 16px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#0b0d1a"; c.fillText(b.text, 1 + jitter, 1);
    c.fillStyle = b.hot ? "#ff8c00" : "#ffd23f"; c.fillText(b.text, jitter, 0);
    c.restore();
    if (b.sub && b.t > 0.3) {
      const slide = reduced ? 1 : ease.outCubic(clamp01((b.t - 0.3) / 0.25));
      c.save(); c.globalAlpha = fade * slide;
      c.font = "bold 10px PixelifySans, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
      const sw = 14 + b.sub.length * 6;
      c.fillStyle = "#0b0d1ae6"; c.fillRect(Math.round(W / 2 - sw / 2), y + 14, sw, 14);
      c.fillStyle = "#f7f7f2"; c.fillText(b.sub, W / 2, y + 21 + Math.round((1 - slide) * 6));
      c.restore();
    }
  }

  /** Tier 3: the whole stadium chants: a ribbon of the chant rolling along the stands. `y` = the stands band. */
  drawChant(c: CanvasRenderingContext2D, y: number, time: number, reduced: boolean, colour: string) {
    if (this.chant <= 0) return;
    const fade = Math.min(1, this.chant / 0.5, (FX_LIFE.chant - this.chant) / 0.3);
    const words = "OLE! OLE! OLE! ", step = 6, offset = reduced ? 0 : Math.floor(time * 40) % (words.length * step);
    c.save(); c.globalAlpha = 0.85 * fade;
    c.fillStyle = "#0b0d1acc"; c.fillRect(0, y - 6, W, 12);
    c.font = "bold 8px PixelifySans, monospace"; c.textBaseline = "middle"; c.textAlign = "left"; c.fillStyle = colour;
    const beat = reduced ? 0 : Math.floor(time * 4) % 2;
    for (let x = -offset; x < W; x += words.length * step) c.fillText(words.repeat(1), x, y + beat * -1);
    c.restore();
  }
}
