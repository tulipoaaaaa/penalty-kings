/**
 * Plays a showreel (gfx/showreel.ts) on the real Stage: each cut sets the stadium, weather and keeper,
 * then triggers real engine-resolved moments through the Stage's public API. Titles and captions are
 * drawn in the top safe band only, so they never cover the action. Reduced motion turns the reel into
 * a calm slideshow (no shots, pushes or flashes).
 */
import { KEEPERS, resolveShot, keeperById, type ShotResult } from "@penalty-kings/engine";
import { W, H, ease } from "./core.js";
import { revealPlan } from "../game/reveal.js";
import { BEAT, cutAt, type Cut } from "./showreel.js";
import { toScreen } from "./stadium.js";
import type { Stage } from "./stage.js";
import { CELEBRATIONS } from "./friend.js";

/** The part of the Stage a reel drives (kept small so tests can use a fake). */
export type ReelStage = Pick<Stage, "celebration" | "setStadium" | "stadium" | "weather" | "keeper" | "kind" | "freeKick" | "cue" | "say" | "taunt" | "play" | "walkout" | "wave" | "showReveal" | "startCelebration" | "busy" | "cancel" | "camera" | "reduced" | "goalPoint">;

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
 * The logo slam (B8): the big logo drops from LOGO_SLAM_FROM× to 1× (outBack) over LOGO_SLAM_SECONDS,
 * then lands with a 2-frame shake and a short floodlight flash. Reduced motion: the logo simply appears.
 */
export const LOGO_SLAM_SECONDS = 0.24, LOGO_SLAM_FROM = 1.6, LOGO_PX = 34;
/** Net-cam push zoom (B8): from the strike the camera pushes in on where the ball goes in. */
export const NETCAM_ZOOM = 1.55, NETCAM_FROM = 0.36;

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
  /** Where the net-cam cut's ball goes in (screen space), set when its shot is chosen. */
  private netcam: { x: number; y: number } | null = null;
  private slammed = false;
  /** Seconds the reel has played (driven by update, so it pauses with the game). */
  time = 0;
  done = false;

  constructor(private stage: ReelStage, private reel: readonly Cut[], private options: { loop: boolean; friendName: string; onCut?: (cut: Cut, index: number) => void }) {}

  get current() { return this.index >= 0 ? this.reel[this.index] : null; }

  update(dt: number) {
    if (this.done) return;
    this.time += dt;
    const total = this.reel.reduce((sum, cut) => sum + cut.beats * BEAT, 0);
    if (!this.options.loop && this.time >= total) { this.done = true; return; }
    const { cut, index } = cutAt(this.time, this.reel);
    if (index !== this.index) { this.index = index; this.started = this.time; this.netcam = null; this.slammed = false; this.apply(cut); this.options.onCut?.(cut, index); }
    const into = this.time - this.started, s = this.stage;
    if (s.reduced) return;
    // The logo lands: two frames of shake (the flash is drawn in drawOverlay).
    if (cut.kind === "logo" && !this.slammed && into >= LOGO_SLAM_SECONDS) { this.slammed = true; s.camera.addTrauma(0.45); }
    // Net-cam push: re-aimed every frame so the Stage's own strike/resolve camera moves never undo it.
    if (this.netcam && into >= NETCAM_FROM) { s.camera.targetX = this.netcam.x; s.camera.targetY = this.netcam.y; s.camera.targetZoom = NETCAM_ZOOM; }
  }

  /** Progress through the current cut (0..1). */
  get progress() { const cut = this.current; return cut ? Math.min(1, (this.time - this.started) / (cut.beats * BEAT)) : 0; }

  private apply(cut: Cut) {
    const s = this.stage;
    if (s.busy) s.cancel();
    if (s.stadium !== cut.stadium) s.setStadium(cut.stadium);
    s.weather = cut.weather; s.keeper = cut.keeper; s.kind = "penalty"; s.freeKick = null;
    if (!s.reduced && cut.push) s.camera.targetZoom = 1.08;
    if (s.reduced) {
      // Calm slideshow: scenery, captions, the keeper stepping forward with a taunt and a commentary line. No shots or flashes.
      // The logo cut says nothing (the logo plate + its caption are the only texts); the goal cut after it welcomes.
      if (cut.kind === "logo") return;
      if (cut.kind === "top-bin") { s.say("showreel"); s.startCelebration(CELEBRATIONS[this.index % CELEBRATIONS.length].id); } else if (cut.kind === "friend") s.say("walkout"); else if (cut.kind === "commentator") { s.say("goal"); s.startCelebration(s.celebration); }
      else if (cut.kind === "stadium" || cut.kind === "goal") { s.say("goal"); s.startCelebration(CELEBRATIONS[this.index % CELEBRATIONS.length].id); } else { s.say(`intro:${cut.keeper}` as never); s.taunt(); }
      return;
    }
    const want: Record<Cut["kind"], () => void> = {
      // No commentator line over the logo (decluttered first 2 s): the welcome line opens the goal cut instead.
      logo: () => {},
      signature: () => { s.taunt(); const save = findShot(cut.keeper, "save"); if (save) s.play(save.outcome, save.curl); },
      stadium: () => { const goal = findShot(cut.keeper, "goal"); if (goal) { s.cue = "goal"; s.play(goal.outcome, goal.curl); } },
      goal: () => { const goal = findShot(cut.keeper, "goal"); if (goal) { s.cue = "goal"; s.play(goal.outcome, goal.curl); } },
      "top-bin": () => {
        const goal = findShot(cut.keeper, "goal", true) ?? findShot(cut.keeper, "goal");
        if (!goal) return;
        s.say("showreel"); s.cue = goal.outcome.zone === "bin" ? "top-bin" : "goal"; s.play(goal.outcome, goal.curl);
        if (cut.netcam) this.netcam = s.goalPoint(toScreen(goal.outcome.target.x, goal.outcome.target.y));
      },
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
    if (cut.kind === "logo") { this.drawLogo(c, cut, into, reduced); return; }
    c.save(); c.globalAlpha = Math.max(0, alpha); c.textAlign = "center"; c.textBaseline = "middle";
    // A delayed title (the TOP BIN! payoff) slams in when the ball goes in; reduced motion shows it at once.
    const titleFrom = reduced ? 0 : cut.titleAt ?? 0, tp = titleFrom ? Math.min(1, (into - titleFrom) / (cut.beats * BEAT - titleFrom)) : p;
    if (cut.title && into >= titleFrom) {
      const slam = reduced ? 1 : 1 + Math.max(0, 0.35 - tp * 2.5), accent = cut.kind === "reveal" ? "#ffd23f" : cut.kind === "friend" ? "#7fe8ff" : "#ffd23f";
      c.font = `${Math.round(22 * slam)}px PixelifySans, monospace`;
      // A 1 px ink outline and a 2 px drop shadow keep the big type readable over any sky.
      c.fillStyle = "#0b0d1a"; c.fillText(cut.title, W / 2 + 2, TITLE_Y + 2);
      for (const [ox, oy] of OUTLINE) c.fillText(cut.title, W / 2 + ox, TITLE_Y + oy);
      c.fillStyle = cut.kind === "reveal" ? "#ffd23f" : "#ffffff"; c.fillText(cut.title, W / 2, TITLE_Y);
      // An accent rule under the title that snaps out from the centre (full width at once under reduced motion).
      const full = Math.round(c.measureText(cut.title).width / slam), grow = reduced ? 1 : Math.min(1, tp * 5), rule = Math.round(full * grow);
      c.fillStyle = "#0b0d1a"; c.fillRect(Math.round(W / 2 - rule / 2) - 1, TITLE_Y + 9, rule + 2, 4);
      c.fillStyle = accent; c.fillRect(Math.round(W / 2 - rule / 2), TITLE_Y + 10, rule, 2);
    }
    const caption = cut.kind === "friend" ? `${this.options.friendName} walks out` : cut.caption;
    if (caption) this.drawCaption(c, caption, TITLE_Y + 15);
    c.restore();
  }

  /** The logo slam: a big outlined logo with a gold rule, one caption plate under it, a flash as it lands. */
  private drawLogo(c: CanvasRenderingContext2D, cut: Cut, into: number, reduced: boolean) {
    const length = cut.beats * BEAT, y = TITLE_Y - 8;
    const k = reduced ? 1 : Math.min(1, into / LOGO_SLAM_SECONDS), scale = reduced ? 1 : LOGO_SLAM_FROM + (1 - LOGO_SLAM_FROM) * ease.outBack(k);
    const fade = Math.max(0, Math.min(1, (length - into) * 6, reduced ? 1 : 0.35 + k));
    // The floodlight flash as it lands (full motion only).
    const since = into - LOGO_SLAM_SECONDS;
    if (!reduced && since >= 0 && since < 0.18) { c.fillStyle = `rgba(255,248,220,${(0.5 * (1 - since / 0.18)).toFixed(3)})`; c.fillRect(0, 0, W, H); }
    c.save(); c.globalAlpha = fade; c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `${Math.round(LOGO_PX * scale)}px PixelifySans, monospace`;
    const text = cut.title ?? "PENALTY KINGS";
    c.fillStyle = "#0b0d1a"; c.fillText(text, W / 2 + 3, y + 3);
    for (const [ox, oy] of OUTLINE2) c.fillText(text, W / 2 + ox, y + oy);
    c.fillStyle = "#ffd23f"; c.fillText(text, W / 2, y);
    c.fillStyle = "#fff6c8"; c.fillText(text, W / 2, y - 1); c.fillStyle = "#ffd23f"; c.fillText(text, W / 2, y + 1);
    const full = Math.round(c.measureText(text).width / scale), rule = reduced || since >= 0 ? full : 0;
    if (rule) { c.fillStyle = "#0b0d1a"; c.fillRect(Math.round(W / 2 - rule / 2) - 1, y + 18, rule + 2, 5); c.fillStyle = "#ff3b1f"; c.fillRect(Math.round(W / 2 - rule / 2), y + 19, rule, 3); }
    if (cut.caption && (reduced || since >= 0)) this.drawCaption(c, cut.caption, y + 28);
    c.restore();
  }

  /** A caption plate: ink body, a light top edge and two accent pips, so the line reads on any stadium. */
  private drawCaption(c: CanvasRenderingContext2D, caption: string, y: number) {
    c.font = "11px PixelifySans, monospace";
    const width = Math.round(c.measureText(caption).width + 16), x = Math.round(W / 2 - width / 2);
    c.fillStyle = "#0b0d1ae0"; c.fillRect(x, y, width, 15);
    c.fillStyle = "#ffffff30"; c.fillRect(x, y, width, 1);
    c.fillStyle = "#ffd23f"; c.fillRect(x + 3, y + 6, 2, 3); c.fillRect(x + width - 5, y + 6, 2, 3);
    c.fillStyle = "#ffffff"; c.fillText(caption, W / 2, y + 8);
  }
}

const OUTLINE = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const OUTLINE2 = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/** Every keeper id a reel uses must exist (guards typos in the schedule). */
export const reelKeepersValid = (reel: readonly Cut[]) => reel.every(cut => KEEPERS.some(k => k.id === cut.keeper));
