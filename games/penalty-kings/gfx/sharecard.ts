/**
 * C4 SHARE CARD: one tap renders a 640 × 360 image on an offscreen canvas. The striker is the canonical
 * Friend sprite (or the practice page's generic stand-in), drawn by drawFriend exactly as on the pitch:
 * whole-sprite scale only, never redrawn. Points and streaks only: no RF, balls, $GBOOT or prizes.
 *
 * `shareCardLayout` is pure (unit tested); `renderShareCard` paints it; `cardImage` returns a PNG data URL
 * (data: images are allowed by both the game frame's CSP and the practice page's) plus a File for Web Share.
 */
import { drawFriend } from "./friend.js";

export const CARD_W = 640, CARD_H = 360;
export const CARD_TAGLINE = "Beat me at Penalty Kings";
export type ShareCardInput = {
  /** "Friend #123" (the game) or "The Trialist" (free practice). */
  name: string;
  /** Headline: points in the game, goals in free practice. */
  score: number; scoreLabel: "pts" | "goals";
  goals: number; kicks: number; bestStreak: number;
  /** e.g. "5 penalties vs Big Bento". */
  subtitle?: string;
  /** The public link (a challenge link when there is one). */
  link: string;
  /** A challenge code, printed small under the link (optional). */
  code?: string;
};
export type CardText = { text: string; x: number; y: number; size: number; color: string; bold: boolean; align: "left" | "center" };
export type ShareCardLayout = { width: number; height: number; sprite: { x: number; y: number; scale: number }; texts: CardText[] };

const INK = "#0b0d1a", GOLD = "#ffd23f", VOLT = "#ccff00", PAPER = "#f7f7f2", SKY = "#7fd3ff";
/** Monospace/pixel faces run about 0.62 em per glyph: used to shrink long lines to fit. */
export const GLYPH_EM = 0.62;
const fit = (text: string, size: number, room: number) => Math.max(11, Math.min(size, Math.floor(room / (Math.max(1, text.length) * GLYPH_EM))));

export function shareCardLayout(input: ShareCardInput): ShareCardLayout {
  const left = 230, room = CARD_W - left - 24, texts: CardText[] = [];
  const add = (text: string, y: number, size: number, color: string, bold = false, x = left, align: CardText["align"] = "left", width = room) => texts.push({ text, x, y, size: fit(text, size, width), color, bold, align });
  add("PENALTY KINGS", 44, 30, GOLD, true);
  add(input.name, 76, 18, PAPER);
  add(`${input.score.toLocaleString("en-US")} ${input.scoreLabel}`, 142, 54, VOLT, true);
  add(`${input.goals}/${input.kicks} goals · best streak ${input.bestStreak}`, 178, 18, PAPER);
  if (input.subtitle) add(input.subtitle, 204, 15, SKY);
  add(CARD_TAGLINE, 264, 30, GOLD, true);
  const link = input.link.replace(/^https?:\/\//, "").replace(/[?#].*$/, ""); // the code gets its own line: a link with it does not fit
  add(link, 304, 20, PAPER, false, 24, "left", CARD_W - 48);
  if (input.code) add(`Challenge code: ${input.code}`, 336, 16, SKY, false, 24, "left", CARD_W - 48);
  return { width: CARD_W, height: CARD_H, sprite: { x: 118, y: 222, scale: 8 }, texts };
}

/** Paint the card. `rows` is the canonical 16 × 16 mask ('#' pixels) or null while art loads (a neutral placeholder). */
export function renderShareCard(canvas: HTMLCanvasElement, layout: ShareCardLayout, rows: readonly string[] | null, halo = "#ffffff") {
  canvas.width = layout.width; canvas.height = layout.height;
  const c = canvas.getContext("2d");
  if (!c) return false;
  c.imageSmoothingEnabled = false;
  // Night sky, stands, a stripe of pitch and a goal frame behind the striker: flat pixel blocks, no gradients.
  c.fillStyle = INK; c.fillRect(0, 0, layout.width, layout.height);
  c.fillStyle = "#151a33"; for (let y = 0; y < 120; y += 12) c.fillRect(0, y, layout.width, 6);
  c.fillStyle = "#2f7d32"; c.fillRect(0, 236, layout.width, layout.height - 236);
  c.fillStyle = "#3a8f3d"; for (let x = 0; x < layout.width; x += 64) c.fillRect(x, 236, 32, layout.height - 236);
  c.fillStyle = "#0b0d1acc"; c.fillRect(0, 272, layout.width, layout.height - 272);
  c.fillStyle = PAPER; c.fillRect(24, 70, 6, 166); c.fillRect(206, 70, 6, 166); c.fillRect(24, 70, 188, 6);
  c.strokeStyle = "#f7f7f255"; c.lineWidth = 1;
  for (let x = 36; x < 206; x += 14) { c.beginPath(); c.moveTo(x + 0.5, 76); c.lineTo(x + 0.5, 236); c.stroke(); }
  for (let y = 88; y < 236; y += 14) { c.beginPath(); c.moveTo(30, y + 0.5); c.lineTo(206, y + 0.5); c.stroke(); }
  // The striker: the same drawFriend as the Stage (canonical mask, halo in the kit colour), scaled whole.
  const { x, y, scale } = layout.sprite;
  drawFriend(c, rows, { x, y, scale, rotate: 0, sx: 1, sy: 1, flip: false, alpha: 1, shadowY: y + 2 }, { halo, boots: "#111111", headband: null, cape: false, laced: 0 }, 0);
  c.fillStyle = PAPER; c.beginPath(); c.arc(x + 70, y - 6, 9, 0, Math.PI * 2); c.fill(); // the ball
  c.fillStyle = INK; c.fillRect(x + 66, y - 10, 4, 4); c.fillRect(x + 71, y - 4, 4, 4);
  for (const text of layout.texts) {
    c.font = `${text.bold ? 700 : 400} ${text.size}px PixelifySans, ui-monospace, monospace`;
    c.textAlign = text.align; c.textBaseline = "alphabetic";
    c.fillStyle = "#000000"; c.fillText(text.text, text.x + 2, text.y + 2);
    c.fillStyle = text.color; c.fillText(text.text, text.x, text.y);
  }
  c.fillStyle = GOLD; c.fillRect(0, 0, layout.width, 4); c.fillRect(0, layout.height - 4, layout.width, 4);
  return true;
}

/** Wait (briefly) for the pixel font so the card never falls back to a system face; never throws. */
export async function cardFontsReady() {
  try { await Promise.race([Promise.all([document.fonts.load("700 30px PixelifySans"), document.fonts.load("400 18px PixelifySans")]), new Promise(resolve => setTimeout(resolve, 800))]); } catch { /* no FontFaceSet: system font */ }
}

/** Render to an offscreen canvas: a PNG data URL (for <img> and downloads) and, when the browser can, a File for Web Share. */
export async function cardImage(input: ShareCardInput, rows: readonly string[] | null, halo?: string): Promise<{ url: string; file: File | null; bytes: number }> {
  await cardFontsReady();
  const canvas = document.createElement("canvas");
  renderShareCard(canvas, shareCardLayout(input), rows, halo);
  const url = canvas.toDataURL("image/png");
  let file: File | null = null;
  try {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (blob && typeof File === "function") file = new File([blob], "penalty-kings.png", { type: "image/png" });
  } catch { /* toBlob unavailable: share the link instead */ }
  return { url, file, bytes: Math.round((url.length - 22) * 0.75) };
}

/**
 * Where the image can go from here. The SDK game frame is an allow-scripts sandbox with an opaque origin
 * ("null"): downloads are blocked (no allow-downloads) and Web Share is not delegated to the frame, so the
 * game shows the image to long-press / right-click and a link to copy. The practice page is a normal page.
 */
export function shareAbilities(file: File | null) {
  let share = false, download = false;
  try { share = Boolean(file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })); } catch { share = false; }
  try { download = typeof window !== "undefined" && window.origin !== "null" && "download" in HTMLAnchorElement.prototype; } catch { download = false; }
  return { share, download };
}
