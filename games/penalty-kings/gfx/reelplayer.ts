/**
 * Plays a showreel (gfx/showreel.ts) on the real Stage: each cut sets the stadium, weather and keeper,
 * then triggers real engine-resolved moments through the Stage's public API. Titles and captions are
 * drawn in the top safe band only, so they never cover the action. Reduced motion turns the reel into
 * a calm slideshow (no shots, pushes or flashes).
 */
import { KEEPERS, resolveShot, keeperById, type ShotResult } from "@penalty-kings/engine";
import { W, H } from "./core.js";
import { revealPlan } from "../game/reveal.js";
import { cutAt, type Cut } from "./showreel.js";
import type { Stage } from "./stage.js";
import { CELEBRATIONS } from "./friend.js";

/** The part of the Stage a reel drives (kept small so tests can use a fake). */
export type ReelStage = Pick<Stage, "celebration" | "setStadium" | "stadium" | "weather" | "keeper" | "kind" | "freeKick" | "cue" | "say" | "taunt" | "play" | "walkout" | "wave" | "showReveal" | "startCelebration" | "busy" | "cancel" | "camera" | "reduced">;

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

/** Title baseline: below the pot banner (which covers canvas y 0–38 at the top centre). */
const TITLE_Y = 84;

/**
 * Cut transition: a retro block dissolve. Each new cut opens behind a grid of WIPE_BLOCK px blocks
 * that clear in a diagonal sweep broken up by a 4×4 ordered-dither pattern (no allocations, ≤ 600
 * rects for WIPE_SECONDS). Off under reduced motion (the reel is a calm slideshow there).
 */
export const WIPE_BLOCK = 16, WIPE_SECONDS = 0.26;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const WIPE_COLS = Math.ceil(W / WIPE_BLOCK), WIPE_ROWS = Math.ceil(H / WIPE_BLOCK);
/** When block (bx, by) clears, in 0..1 of the wipe: the diagonal sweep (60 %) plus the dither (40 %). */
export const wipeThreshold = (bx: number, by: number) =>
  0.6 * ((bx / (WIPE_COLS - 1) + by / (WIPE_ROWS - 1)) / 2) + 0.4 * (BAYER4[(by & 3) * 4 + (bx & 3)] / 16);
/** True while block (bx, by) still covers the frame at wipe progress k (0 = all covered, 1 = clear). */
export const wipeCovered = (bx: number, by: number, k: number) => k < 1 && wipeThreshold(bx, by) >= k;

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
    if (s.reduced) {
      // Calm slideshow: scenery, captions, the keeper stepping forward with a taunt and a commentary line. No shots or flashes.
      if (cut.kind === "logo") s.say("showreel"); else if (cut.kind === "friend") s.say("walkout"); else if (cut.kind === "commentator") { s.say("goal"); s.startCelebration(s.celebration); }
      else if (cut.kind === "stadium" || cut.kind === "goal" || cut.kind === "top-bin") { s.say("goal"); s.startCelebration(CELEBRATIONS[this.index % CELEBRATIONS.length].id); } else { s.say(`intro:${cut.keeper}` as never); s.taunt(); }
      return;
    }
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

  /** Big type + caption in the band under the pot banner (y 80–106), never over the goal or the striker. */
  drawOverlay(c: CanvasRenderingContext2D) {
    const cut = this.current; if (!cut) return;
    const reduced = this.stage.reduced, into = this.time - this.started;
    // The block dissolve that opens each cut (never under reduced motion).
    if (!reduced && into < WIPE_SECONDS) {
      const k = into / WIPE_SECONDS;
      c.fillStyle = "#0b0d1a";
      for (let by = 0; by < WIPE_ROWS; by++) for (let bx = 0; bx < WIPE_COLS; bx++) if (wipeCovered(bx, by, k)) c.fillRect(bx * WIPE_BLOCK, by * WIPE_BLOCK, WIPE_BLOCK, WIPE_BLOCK);
    }
    const p = this.progress, alpha = Math.min(1, p * 6, (1 - p) * 6);
    c.save(); c.globalAlpha = Math.max(0, alpha); c.textAlign = "center"; c.textBaseline = "middle";
    if (cut.title) {
      const slam = reduced ? 1 : 1 + Math.max(0, 0.35 - p * 2.5), accent = cut.kind === "reveal" ? "#ffd23f" : cut.kind === "friend" ? "#7fe8ff" : "#ffd23f";
      c.font = `${Math.round(22 * slam)}px PixelifySans, monospace`;
      // A 1 px ink outline and a 2 px drop shadow keep the big type readable over any sky.
      c.fillStyle = "#0b0d1a"; c.fillText(cut.title, W / 2 + 2, TITLE_Y + 2);
      for (const [ox, oy] of OUTLINE) c.fillText(cut.title, W / 2 + ox, TITLE_Y + oy);
      c.fillStyle = cut.kind === "reveal" ? "#ffd23f" : "#ffffff"; c.fillText(cut.title, W / 2, TITLE_Y);
      // An accent rule under the title that snaps out from the centre (full width at once under reduced motion).
      const full = Math.round(c.measureText(cut.title).width / slam), grow = reduced ? 1 : Math.min(1, p * 5), rule = Math.round(full * grow);
      c.fillStyle = "#0b0d1a"; c.fillRect(Math.round(W / 2 - rule / 2) - 1, TITLE_Y + 9, rule + 2, 4);
      c.fillStyle = accent; c.fillRect(Math.round(W / 2 - rule / 2), TITLE_Y + 10, rule, 2);
    }
    const caption = cut.kind === "friend" ? `${this.options.friendName} walks out` : cut.caption;
    if (caption) {
      c.font = "11px PixelifySans, monospace";
      const width = Math.round(c.measureText(caption).width + 16), x = Math.round(W / 2 - width / 2), y = TITLE_Y + 15;
      // A caption plate: ink body, a light top edge and two accent pips, so the line reads on any stadium.
      c.fillStyle = "#0b0d1ae0"; c.fillRect(x, y, width, 15);
      c.fillStyle = "#ffffff30"; c.fillRect(x, y, width, 1);
      c.fillStyle = "#ffd23f"; c.fillRect(x + 3, y + 6, 2, 3); c.fillRect(x + width - 5, y + 6, 2, 3);
      c.fillStyle = "#ffffff"; c.fillText(caption, W / 2, y + 8);
    }
    c.restore();
  }
}

const OUTLINE = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** Every keeper id a reel uses must exist (guards typos in the schedule). */
export const reelKeepersValid = (reel: readonly Cut[]) => reel.every(cut => KEEPERS.some(k => k.id === cut.keeper));
