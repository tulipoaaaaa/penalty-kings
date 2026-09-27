/**
 * Plays a showreel (gfx/showreel.ts) on the real Stage: each cut sets the stadium, weather and keeper,
 * then triggers real engine-resolved moments through the Stage's public API. Titles and captions are
 * drawn in the top safe band only, so they never cover the action. Reduced motion turns the reel into
 * a calm slideshow (no shots, pushes or flashes).
 */
import { KEEPERS, resolveShot, keeperById, type ShotResult } from "@penalty-kings/engine";
import { W } from "./core.js";
import { revealPlan } from "../game/reveal.js";
import { cutAt, type Cut } from "./showreel.js";
import type { Stage } from "./stage.js";

/** The part of the Stage a reel drives (kept small so tests can use a fake). */
export type ReelStage = Pick<Stage, "setStadium" | "stadium" | "weather" | "keeper" | "kind" | "freeKick" | "cue" | "say" | "taunt" | "play" | "walkout" | "wave" | "showReveal" | "startCelebration" | "busy" | "cancel" | "camera" | "reduced">;

/** Find an engine-resolved shot with the wanted result against this keeper (skill moments only). */
export function findShot(keeper: string, want: ShotResult, bin = false, random: () => number = Math.random) {
  const profile = keeperById(keeper as never);
  for (let i = 0; i < 4000; i++) {
    const shot = { aimX: random() * 2.4 - 1.2, aimY: 0.05 + random() * 0.9, power: 0.4 + random() * 0.45, curl: random() * 1.2 - 0.6 };
    const outcome = resolveShot(shot, profile, Math.floor(random() * 2 ** 31));
    if (outcome.result === want && (!bin || outcome.zone === "bin")) return { outcome, curl: shot.curl };
  }
  return null;
}

export class ReelPlayer {
  private index = -1;
  private started = 0;
  /** Seconds the reel has played (driven by update, so it pauses with the game). */
  time = 0;
  done = false;

  constructor(private stage: ReelStage, private reel: readonly Cut[], private options: { loop: boolean; friendName: string; onCut?: (cut: Cut, index: number) => void }) {}

  get current() { return this.index >= 0 ? this.reel[this.index] : null; }

  update(dt: number) {
    if (this.done) return;
    this.time += dt;
    const total = this.reel.reduce((sum, cut) => sum + cut.beats * 0.72, 0);
    if (!this.options.loop && this.time >= total) { this.done = true; return; }
    const { cut, index } = cutAt(this.time, this.reel);
    if (index !== this.index) { this.index = index; this.started = this.time; this.apply(cut); this.options.onCut?.(cut, index); }
  }

  /** Progress through the current cut (0..1). */
  get progress() { const cut = this.current; return cut ? Math.min(1, (this.time - this.started) / (cut.beats * 0.72)) : 0; }

  private apply(cut: Cut) {
    const s = this.stage;
    if (s.busy) s.cancel();
    if (s.stadium !== cut.stadium) s.setStadium(cut.stadium);
    s.weather = cut.weather; s.keeper = cut.keeper; s.kind = "penalty"; s.freeKick = null;
    if (!s.reduced && cut.push) s.camera.targetZoom = 1.08;
    if (s.reduced) return; // calm slideshow: scenery + captions only
    const want: Record<Cut["kind"], () => void> = {
      logo: () => { s.cue = "showreel"; s.say("showreel"); },
      signature: () => { s.taunt(); const save = findShot(cut.keeper, "save"); if (save) s.play(save.outcome, save.curl); },
      stadium: () => { const goal = findShot(cut.keeper, "goal"); if (goal) { s.cue = "goal"; s.play(goal.outcome, goal.curl); } },
      goal: () => { const goal = findShot(cut.keeper, "goal"); if (goal) { s.cue = "goal"; s.play(goal.outcome, goal.curl); } },
      "top-bin": () => { const goal = findShot(cut.keeper, "goal", true) ?? findShot(cut.keeper, "goal"); if (goal) { s.cue = "top-bin"; s.play(goal.outcome, goal.curl); } },
      save: () => { const save = findShot(cut.keeper, "save"); if (save) s.play(save.outcome, save.curl); },
      freekick: () => { const goal = findShot(cut.keeper, "goal"); if (goal) s.play(goal.outcome, goal.curl); },
      // An EXAMPLE of the reveal animation, labelled on screen: never implies a real pull.
      reveal: () => s.showReveal(revealPlan((cut.rarity ?? 6) + 1)),
      commentator: () => { const goal = findShot(cut.keeper, "goal"); if (goal) { s.cue = "goal"; s.play(goal.outcome, goal.curl); } },
      walkout: () => s.walkout(),
      friend: () => { s.walkout(); s.wave(); },
    };
    want[cut.kind]();
  }

  /** Big type + caption in the top safe band (y 24–62), never over the goal or the striker. */
  drawOverlay(c: CanvasRenderingContext2D) {
    const cut = this.current; if (!cut) return;
    const p = this.progress, alpha = Math.min(1, p * 6, (1 - p) * 6);
    c.save(); c.globalAlpha = Math.max(0, alpha); c.textAlign = "center"; c.textBaseline = "middle";
    if (cut.title) {
      const slam = this.stage.reduced ? 1 : 1 + Math.max(0, 0.35 - p * 2.5);
      c.font = `${Math.round(22 * slam)}px PixelifySans, monospace`;
      c.fillStyle = "#0b0d1a"; c.fillText(cut.title, W / 2 + 2, 42 + 2);
      c.fillStyle = cut.kind === "reveal" ? "#ffd23f" : "#ffffff"; c.fillText(cut.title, W / 2, 42);
    }
    const caption = cut.kind === "friend" ? `${this.options.friendName} walks out` : cut.caption;
    if (caption) {
      c.font = "10px PixelifySans, monospace";
      const width = c.measureText(caption).width + 12;
      c.fillStyle = "#0b0d1acc"; c.fillRect(Math.round(W / 2 - width / 2), 56, Math.round(width), 14);
      c.fillStyle = "#ffffff"; c.fillText(caption, W / 2, 63);
    }
    c.restore();
  }
}

/** Every keeper id a reel uses must exist (guards typos in the schedule). */
export const reelKeepersValid = (reel: readonly Cut[]) => reel.every(cut => KEEPERS.some(k => k.id === cut.keeper));
