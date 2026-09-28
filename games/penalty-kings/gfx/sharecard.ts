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
/** One line of the card. `head`: a heading line in PKHead; `font`: the exact canvas font it is drawn (and loaded) in. */
export type CardText = { text: string; x: number; y: number; size: number; color: string; head: boolean; font: string; align: "left" | "center" };
export type ShareCardLayout = { width: number; height: number; sprite: { x: number; y: number; scale: number }; texts: CardText[] };

const INK = "#0b0d1a", GOLD = "#ffd23f", VOLT = "#ccff00", PAPER = "#f7f7f2", SKY = "#7fd3ff";
/** Monospace/pixel faces run about 0.62 em per glyph: used to shrink long lines to fit. */
export const GLYPH_EM = 0.62;
/**
 * Heading face: PKHead, the Departure Mono subset style.css declares (A–Z, digits, number punctuation), as the
 * DOM and Stage headings use it. Bold Pixelify drew C like O ("PENALTY KINOS"-style misreads on a shared image).
 * Its glyphs sit on an 11 px grid, 7 px apart: heading sizes are whole multiples of 11 so every pixel lands whole.
 */
export const HEAD_EM = 7 / 11;
const HEAD_GRID = 11;
export const headCardFont = (px: number) => `${px}px PKHead, PixelifySans, ui-monospace, monospace`;
export const bodyCardFont = (px: number) => `400 ${px}px PixelifySans, ui-monospace, monospace`;
const fit = (text: string, size: number, room: number) => Math.max(11, Math.min(size, Math.floor(room / (Math.max(1, text.length) * GLYPH_EM))));
/** The largest grid size (≤ `size`) at which a heading fits `room`. */
const fitHead = (text: string, size: number, room: number) => Math.max(HEAD_GRID, Math.floor(Math.min(size, room / (Math.max(1, text.length) * HEAD_EM)) / HEAD_GRID) * HEAD_GRID);

export function shareCardLayout(input: ShareCardInput): ShareCardLayout {
  const left = 230, room = CARD_W - left - 24, texts: CardText[] = [];
  const add = (text: string, y: number, size: number, color: string, x = left, align: CardText["align"] = "left", width = room) => { const px = fit(text, size, width); texts.push({ text, x, y, size: px, color, head: false, font: bodyCardFont(px), align }); };
  // Heading lines: uppercase (the subset has no lowercase, and no glyph may fall back mid-word), on the 11 px grid.
  const head = (text: string, y: number, size: number, color: string) => { const upper = text.toUpperCase(), px = fitHead(upper, size, room); texts.push({ text: upper, x: left, y, size: px, color, head: true, font: headCardFont(px), align: "left" }); };
  head("PENALTY KINGS", 44, 33, GOLD);
  add(input.name, 76, 18, PAPER);
  head(`${input.score.toLocaleString("en-US")} ${input.scoreLabel}`, 142, 55, VOLT);
  if (input.kicks > 0) add(`${input.goals}/${input.kicks} goals · best streak ${input.bestStreak}`, 178, 18, PAPER); // kicks 0: a Daily best kept before its round was (score only)
  if (input.subtitle) add(input.subtitle, 204, 15, SKY);
  head(CARD_TAGLINE, 262, 22, GOLD);
  const link = input.link.replace(/^https?:\/\//, "").replace(/[?#].*$/, ""); // the code gets its own line: a link with it does not fit
  add(link, 304, 20, PAPER, 24, "left", CARD_W - 48);
  if (input.code) add(`Challenge code: ${input.code}`, 336, 16, SKY, 24, "left", CARD_W - 48);
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
    c.font = text.font; c.textAlign = text.align; c.textBaseline = "alphabetic";
    // Headings drop a hard shadow one font pixel (size / 11) down-right: a pixel-true offset at every grid size.
    const drop = text.head ? text.size / HEAD_GRID : 2;
    c.fillStyle = "#000000"; c.fillText(text.text, text.x + drop, text.y + drop);
    c.fillStyle = text.color; c.fillText(text.text, text.x, text.y);
  }
  c.fillStyle = GOLD; c.fillRect(0, 0, layout.width, 4); c.fillRect(0, layout.height - 4, layout.width, 4);
  return true;
}

/**
 * Wait (briefly) for every face and size the card draws (PKHead headings, Pixelify lines) so it never paints in a
 * fallback face: canvas text alone does not start a web-font download. Never throws.
 */
export async function cardFontsReady(layout: ShareCardLayout) {
  try {
    const fonts = (globalThis as { document?: { fonts?: { load(font: string, text?: string): Promise<unknown> } } }).document?.fonts;
    if (!fonts) return;
    await Promise.race([Promise.all(layout.texts.map(text => fonts.load(text.font, text.text))), new Promise(resolve => setTimeout(resolve, 1500))]);
  } catch { /* no FontFaceSet: system font */ }
}

/** Render to an offscreen canvas: a PNG data URL (for <img> and downloads) and, when the browser can, a File for Web Share. */
export async function cardImage(input: ShareCardInput, rows: readonly string[] | null, halo?: string): Promise<{ url: string; file: File | null; bytes: number }> {
  const layout = shareCardLayout(input);
  await cardFontsReady(layout);
  const canvas = document.createElement("canvas");
  renderShareCard(canvas, layout, rows, halo);
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
