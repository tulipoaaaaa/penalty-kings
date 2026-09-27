/**
 * Crowd: the stands are packed with little Rare Friends, mixed with 22 original spectator types.
 *
 * FRIENDS. Every little Friend is the player's OWN canonical Generations sprite (the rows the Stage
 * already has from the SDK sprite reader; no other token is ever read: the SDK test harness rejects
 * reads of other Friends). Its pixels are never edited or recoloured: each frame is cropped to the
 * union of its canonical frames, downscaled nearest-neighbour to 8–12 px, and drawn in the mask's
 * black with a one-pixel halo around it (as the SDK's own world view and the hero do). Variety comes
 * only from position, flip, the canonical idle/walk frame, bob timing, the halo colour and props held
 * above or beside the sprite (flags, big PK flags, scarves, banners, the Champions mosaic cards),
 * never drawn over it. Pixels are pre-rendered once per stadium × Friend into one atlas canvas.
 *
 * MOTION. Friends are drawn every frame with sub-frame (continuous) timing and eased curves, snapped
 * to whole pixels for the retro look: a hop ripple that travels out from the goal on a goal, a rising
 * "ooh" ripple on a near-miss, a sag on a groan, the Mexican wave. Reduced motion: no hops, ripples,
 * waves or cloth ripple; a one-pixel lift and raised scarves on a goal.
 *
 * FALLBACK. Until the sprite is loaded (or if it cannot be read), the original crowd is drawn exactly
 * as before: rendered into a cached layer at 15 fps; the far upper tiers of Pro and Champions are
 * four pre-rendered frames (idle ×2, cheer ×2) blitted in one draw.
 */
import { W, hash01, ease, clamp01, type Particles } from "./core.js";
import { CROWD_HOLES, CHAMPIONS_MOSAIC, PRO_TIFO, PRO_BANNER, glyphText, glyphCols, type StadiumId } from "./stadium.js";

export const CROWD_TYPES = [
  "fan", "drummer", "flag-waver", "kid on shoulders", "grumpy pundit", "confetti-thrower", "sleeper", "phone filmer",
  "foam finger", "mascot", "trumpeter", "nan knitting", "scarf-twirler", "face-painted fan", "twins", "hot-dog dad",
  "streamer", "balloon kid", "mega-fan", "photographer", "ref critic", "superfan in a bucket hat",
] as const;
export type CrowdType = typeof CROWD_TYPES[number];
export type CrowdMood = "idle" | "cheer" | "groan" | "ooh" | "tense";
/** The player's own Friend: canonical rows for (facing, walking, frame 0–7), or null while loading. */
export type CrowdRowsProvider = (facing: "down", walking: boolean, frame: number) => readonly string[] | null;

const SKIN = ["#f2c79a", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#a0674b"];
const HAIR = ["#2b1b0e", "#6b3e1f", "#e8c26a", "#111111", "#b05a2a", "#dddddd", "#ff5a6e"];
const SHIRTS: Readonly<Record<StadiumId, string[]>> = {
  park: ["#e63946", "#ffd23f", "#2a6fdb", "#ffffff", "#43a047", "#ff8fab", "#7fd3ff"],
  pro: ["#ccff00", "#ff5a6e", "#7fd3ff", "#ffffff", "#1d3557", "#9b5de5", "#f4a261"],
  champions: ["#ffd23f", "#b8860b", "#ffffff", "#e63946", "#1d3557", "#fff2b3", "#ff8c00"],
};

type Seat = { x: number; y: number; type: CrowdType; skin: string; hair: string; shirt: string; accent: string; phase: number; seed: number };
/** The crowd buffer reaches this far above the stands' y 0 (Pro / Champions upper tiers). */
const TOP = 40;
/**
 * Density per ground (round 6 E22). Park: three cosy bench rows with empty seats. Pro: a sold-out
 * lower tier plus a distant upper tier. Champions: packed rows 6 px apart, a full upper tier, the card
 * mosaic. `far` is the upper tier: tiny 2 px fans pre-rendered into four cached frames.
 */
const LAYOUTS: Readonly<Record<StadiumId, { rows: readonly number[]; step: number; empty: number; far?: { top: number; bottom: number; shirts: readonly string[] } }>> = {
  park: { rows: [68, 76, 84], step: 8, empty: 0.22 },
  pro: { rows: [36, 43, 50, 57, 64, 71, 78, 85], step: 7, empty: 0.03, far: { top: -35, bottom: 4, shirts: ["#9bd400", "#c43a5c", "#2aa7c4", "#b8c0d8", "#23305e", "#6a45a8"] } },
  champions: { rows: [42, 48, 54, 60, 66, 72, 78, 84], step: 6, empty: 0, far: { top: -15, bottom: 28, shirts: ["#e6b82e", "#9a7010", "#e8e0c8", "#6a2fa8", "#3a1a6a", "#c8a0ff"] } },
};

type Banner = Readonly<{ row: number; x: number; text: string; bg: string; fg: string }>;
/**
 * The Friends crowd per ground: sprite heights (back rows, front rows) in px, the share of seats
 * that are Friends, the gap between neighbours, halo (supporter) colours for the back rows (dimmer:
 * distance and night, so the stands never out-shout the pitch) and the front rows, flag colour
 * pairs, banners and the two big PK flags. Banners and big flags stay clear of the goal mouth.
 */
const FRIENDS: Readonly<Record<StadiumId, { heights: readonly [number, number]; share: number; gap: number; flagShare: number; halos: readonly [readonly string[], readonly string[]];
  flags: readonly (readonly [string, string])[]; banners: readonly Banner[]; big: readonly { row: number; x: number; bg: string; fg: string }[]; pole: string }>> = {
  park: { heights: [11, 12], share: 0.7, gap: 1, flagShare: 0.07, pole: "#8d6e63",
    halos: [["#e4e4e4", "#e8c040", "#e888a0", "#78c0e8", "#d04048", "#80c880"], ["#ffffff", "#ffd23f", "#ff8fab", "#7fd3ff", "#e63946", "#8bd88f"]],
    flags: [["#e63946", "#ffffff"], ["#ffd23f", "#2a6fdb"], ["#7fd3ff", "#ffffff"], ["#43a047", "#ffd23f"]],
    banners: [{ row: 1, x: 348, text: "COME ON PK", bg: "#fff8e8", fg: "#e63946" }],
    big: [{ row: 2, x: 120, bg: "#e63946", fg: "#ffffff" }, { row: 1, x: 470, bg: "#2a6fdb", fg: "#ffd23f" }] },
  pro: { heights: [9, 10], share: 0.72, gap: 2, flagShare: 0.07, pole: "#8c96b8",
    halos: [["#4f6a12", "#7a1c40", "#18708a", "#5c6690", "#4c3680", "#7a5030"], ["#98c418", "#c8265a", "#22acd0", "#aab4d8", "#7c5cc4", "#c07c48"]],
    flags: [["#c6ff1a", "#05070f"], ["#ff2e6e", "#ffffff"], ["#29e0ff", "#1b1f5a"], ["#ffffff", "#ff2e6e"]],
    banners: [{ row: 6, x: 150, text: "PK FRIENDS", bg: "#c6ff1a", fg: "#05070f" }, { row: 2, x: 390, text: "KINGS", bg: "#ff2e6e", fg: "#ffffff" }],
    big: [{ row: 3, x: 200, bg: "#c6ff1a", fg: "#05070f" }, { row: 5, x: 470, bg: "#ff2e6e", fg: "#ffffff" }] },
  champions: { heights: [8, 9], share: 0.74, gap: 2, flagShare: 0.07, pole: "#c8b880",
    halos: [["#8a6c1c", "#948a64", "#5a3690", "#847c98", "#8c4c18", "#842c3a"], ["#e0b030", "#e8d898", "#9258d8", "#dcd8e8", "#e07818", "#d84656"]],
    flags: [["#ffd23f", "#4a1a8a"], ["#ffffff", "#ffd23f"], ["#b36bff", "#fff2b3"], ["#e63946", "#ffd23f"]],
    banners: [{ row: 5, x: 40, text: "FRIENDS", bg: "#4a1a8a", fg: "#ffd23f" }, { row: 7, x: 350, text: "PK FOREVER", bg: "#ffd23f", fg: "#2a0f4a" }],
    big: [{ row: 6, x: 130, bg: "#ffd23f", fg: "#4a1a8a" }, { row: 3, x: 396, bg: "#4a1a8a", fg: "#ffd23f" }] },
};
/** Layer x of the goal's centre (the buffer sits 40 px left of the screen): ripples start here. */
const ORIGIN_X = W / 2 + 40;

const farCache = new Map<string, HTMLCanvasElement>();
/** One frame of the far upper tier: idle (0/1) or cheering (2/3). */
function farFrame(stadium: StadiumId, frame: number) {
  const key = `${stadium}-${frame}`, far = LAYOUTS[stadium].far!;
  let canvas = farCache.get(key);
  if (canvas) return canvas;
  canvas = document.createElement("canvas"); canvas.width = W + 80; canvas.height = TOP + 100;
  const b = canvas.getContext("2d")!, cheer = frame >= 2;
  let n = 0;
  for (let y = far.top; y < far.bottom; y += 4) for (let x = 1 + (Math.abs(y / 4) % 2 ? 1 : 0); x < W + 78; x += 3, n++) {
    if (hash01(n + 7001) < 0.04) continue;
    const lift = cheer ? Math.floor(hash01(n * 3 + frame) * 3) : frame === 1 && hash01(n + 17) < 0.35 ? 1 : 0, by = y + TOP - lift;
    b.fillStyle = far.shirts[Math.floor(hash01(n + 3301) * far.shirts.length)]; b.fillRect(x, by + 1, 2, 2);
    b.fillStyle = SKIN[Math.floor(hash01(n + 1109) * SKIN.length)]; b.fillRect(x, by, 2, 1);
    if (cheer && hash01(n + 51) < 0.6) { b.fillRect(x - 1, by - 1, 1, 1); b.fillRect(x + 2, by - 1, 1, 1); }
    else if (hash01(n + 77) < 0.05) { b.fillStyle = far.shirts[n % far.shirts.length]; b.fillRect(x - 1, by - 1, 4, 1); } // scarves held high
  }
  // Distance and night: the far tier sits in shadow under the roof, so it never out-shouts the pitch.
  b.globalCompositeOperation = "source-atop"; b.fillStyle = stadium === "pro" ? "rgba(3,6,20,0.5)" : "rgba(18,6,32,0.42)"; b.fillRect(0, 0, canvas.width, canvas.height);
  farCache.set(key, canvas);
  return canvas;
}
/** 4×5 glyphs for the card mosaic (PENALTY KINGS only). */
const MOSAIC_GLYPHS: Readonly<Record<string, string>> = {
  P: "11101001111010001000", E: "11111000111010001111", N: "10011101101110011001", A: "01101001111110011001", L: "10001000100010001111",
  T: "11110110011001100110", Y: "10011001011001100110", K: "10011010110010101001", I: "11100100010001001110", G: "01111000101110010111",
  S: "01111000011000011110", " ": "00000000000000000000",
};
/** The card mosaic (cached: normal and flipped). Each card is 2×2 px on a 3 px pitch. */
function mosaic(flipped: boolean) {
  const key = `mosaic-${flipped}`;
  let canvas = farCache.get(key);
  if (canvas) return canvas;
  const { w, h } = CHAMPIONS_MOSAIC, text = "PENALTY KINGS";
  canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const b = canvas.getContext("2d")!, [bg, fg, rim] = flipped ? ["#ffd23f", "#4a1a8a", "#fff2b3"] : ["#4a1a8a", "#ffd23f", "#b36bff"];
  b.fillStyle = "#12081f"; b.fillRect(0, 0, w, h);
  for (let row = 0; row < 7; row++) for (let col = 0; col < 66; col++) {
    let on = false;
    if (row >= 1 && row <= 5 && col >= 1 && col <= 64) { const cell = col - 1, ch = text[Math.floor(cell / 5)], k = cell % 5; on = k < 4 && (MOSAIC_GLYPHS[ch] ?? "")[(row - 1) * 4 + k] === "1"; }
    b.fillStyle = on ? fg : row === 0 || row === 6 ? rim : bg; b.fillRect(col * 3, row * 3, 2, 2);
  }
  farCache.set(key, canvas);
  return canvas;
}
/** The mosaic, cards flipping in a wave that sweeps across the stand on a goal. */
function drawMosaic(b: CanvasRenderingContext2D, x: number, y: number, mood: CrowdMood, t: number, reduced: boolean) {
  const m = CHAMPIONS_MOSAIC;
  if (mood === "cheer" && !reduced && t < 2.6) for (let col = 0; col < 66; col++) b.drawImage(mosaic(t * 40 > col && Math.floor((t * 40 - col) / 22) % 2 === 0), col * 3, 0, 3, m.h, x + col * 3, y, 3, m.h);
  else b.drawImage(mosaic(false), x, y);
}

// ── The Friend atlas: canonical frames, cropped + nearest-neighbour downscaled, black mask + halo ─────
/** Canonical frames used: idle (down) 0–7 then walk (down) 0–7. */
const FRAME_COUNT = 16;
type Atlas = { key: string; canvas: HTMLCanvasElement; cw: number; ch: number; sizes: readonly { w: number; h: number }[]; halos: number };
const atlasCache = new Map<string, Atlas>();
const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const;
/**
 * One canvas per stadium × Friend. Cell (frame, flip) × (size, halo). Each cell holds the frame's
 * '#' pixels in black, sampled nearest-neighbour from the union bounding box of all 16 frames (so
 * the canonical animation keeps its registration), with a one-pixel halo (8-neighbour dilation).
 */
function buildAtlas(key: string, frames: readonly (readonly string[])[], heights: readonly number[], halos: readonly (readonly string[])[]): Atlas | null {
  let top = Infinity, bottom = -1, left = Infinity, right = -1;
  for (const rows of frames) rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === "#") { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); } });
  if (bottom < 0) return null;
  const hc = bottom - top + 1, wc = right - left + 1;
  const sizes = heights.map(target => { const h = Math.min(target, hc), s = h / hc; return { h, w: Math.max(1, Math.round(wc * s)), s }; });
  const cw = Math.max(...sizes.map(size => size.w)) + 2, ch = Math.max(...sizes.map(size => size.h)) + 2;
  const count = halos[0].length, canvas = document.createElement("canvas"); canvas.width = cw * FRAME_COUNT * 2; canvas.height = ch * sizes.length * count;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(canvas.width, canvas.height), data = image.data;
  const put = (x: number, y: number, [r, g, b]: readonly number[]) => { const i = (y * canvas.width + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
  sizes.forEach((size, si) => {
    const { w, h, s } = size;
    frames.forEach((rows, fi) => {
      for (let flip = 0; flip < 2; flip++) {
        // Nearest-neighbour sample of the canonical mask (no pixel is ever invented or recoloured).
        const mask = new Uint8Array((w + 2) * (h + 2));
        for (let j = 0; j < h; j++) {
          const row = rows[top + Math.min(hc - 1, Math.floor((j + 0.5) / s))] ?? "";
          for (let i = 0; i < w; i++) if (row[left + Math.min(wc - 1, Math.floor((i + 0.5) / s))] === "#") mask[(j + 1) * (w + 2) + (flip ? w - i : i + 1)] = 1;
        }
        halos[si].forEach((halo, hi) => {
          const ox = (fi * 2 + flip) * cw, oy = (si * count + hi) * ch, colour = rgb(halo);
          for (let y = 0; y < h + 2; y++) for (let x = 0; x < w + 2; x++) {
            if (mask[y * (w + 2) + x]) { put(ox + x, oy + y, [0, 0, 0]); continue; }
            let near = false;
            for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w + 2 && ny < h + 2 && mask[ny * (w + 2) + nx]) { near = true; break; } }
            if (near) put(ox + x, oy + y, colour);
          }
        });
      }
    });
  });
  context.putImageData(image, 0, 0);
  return { key, canvas, cw, ch, sizes: sizes.map(({ w, h }) => ({ w, h })), halos: count };
}

/** A big "PK" flag cloth (cached): 22 × 13 px, drawn column by column so it ripples. */
function pkCloth(bg: string, fg: string) {
  const key = `pk-${bg}-${fg}`;
  let canvas = farCache.get(key);
  if (canvas) return canvas;
  canvas = document.createElement("canvas"); canvas.width = 22; canvas.height = 13;
  const b = canvas.getContext("2d")!;
  b.fillStyle = bg; b.fillRect(0, 0, 22, 13);
  b.fillStyle = fg; b.fillRect(0, 0, 22, 1); b.fillRect(0, 12, 22, 1);
  glyphText(b, "PK", 2, 2, 2, fg);
  farCache.set(key, canvas);
  return canvas;
}
/** A held-up banner (cached): the text in the 4×5 stadium font on a bordered sheet. */
function bannerCloth(banner: Banner) {
  const key = `banner-${banner.text}-${banner.bg}`;
  let canvas = farCache.get(key);
  if (canvas) return canvas;
  canvas = document.createElement("canvas"); canvas.width = glyphCols(banner.text) + 6; canvas.height = 9;
  const b = canvas.getContext("2d")!;
  b.fillStyle = banner.bg; b.fillRect(0, 0, canvas.width, 9);
  b.fillStyle = "rgba(0,0,0,0.25)"; b.fillRect(0, 8, canvas.width, 1);
  glyphText(b, banner.text, 3, 2, 1, banner.fg);
  farCache.set(key, canvas);
  return canvas;
}

type Fan = { x: number; y: number; row: number; size: number; halo: number; flip: boolean; phase: number; hop: number; flag: number; big: number; scarf: boolean };
type Peeker = { x: number; y: number; peek: number; halo: number; flip: boolean; phase: number; col: number };
type FriendLayout = { key: string; atlas: Atlas; rows: { fans: Fan[]; humans: Seat[]; y: number }[]; peekers: Peeker[]; holders: Peeker[]; banners: { banner: Banner; y: number; lift: number; n: number }[] };
/** Height of each row's human strip and how far above the row's y it starts. */
const STRIP_H = 26, STRIP_UP = 16;

/** One human spectator (the original 22 types), with its mood and accessories. */
function paintHuman(b: CanvasRenderingContext2D, s: Seat, crowd: Crowd, time: number, particles: Particles, reduced: boolean) {
  const mood = crowd.mood, t = crowd.moodTime;
  const waveUp = crowd.wave > 0 ? Math.max(0, 1 - Math.abs((s.x / (W + 80)) * 4 - (crowd.wave - 0.3)) * 2) : 0;
  let lift = 0, armsUp = false, handsHead = false, handsMouth = false;
  const jitter = Math.sin(time * 9 + s.phase);
  if (s.type === "sleeper" && mood !== "cheer") { /* sleeps through everything */ }
  else if (mood === "cheer") { lift = reduced ? 1 : Math.round(Math.abs(Math.sin(t * 10 + s.phase)) * 3); armsUp = true; }
  else if (mood === "groan") { handsHead = s.type !== "grumpy pundit"; lift = 0; }
  else if (mood === "ooh") { handsMouth = true; lift = Math.round(Math.abs(jitter)); }
  else if (mood === "tense") { lift = 0; }
  else lift = Math.round((Math.sin(time * 2 + s.phase) + 1) * 0.5);
  if (waveUp > 0.3) { lift = Math.round(waveUp * 4); armsUp = true; }
  const x = s.x, y = s.y - lift;
  // Body and head.
  b.fillStyle = s.shirt; b.fillRect(x, y + 3, 5, 4);
  b.fillStyle = s.skin; b.fillRect(x + 1, y, 3, 3);
  b.fillStyle = s.hair; b.fillRect(x + 1, y - 1, 3, 1);
  // Arms.
  b.fillStyle = s.skin;
  if (armsUp) { b.fillRect(x - 1, y - 2, 1, 4); b.fillRect(x + 5, y - 2, 1, 4); }
  else if (handsHead) { b.fillRect(x, y - 1, 1, 2); b.fillRect(x + 4, y - 1, 1, 2); }
  else if (handsMouth) { b.fillRect(x + 2, y + 2, 1, 1); }
  // Type accessories and behaviours.
  switch (s.type) {
    case "drummer": b.fillStyle = "#b8860b"; b.fillRect(x + 1, y + 6, 4, 2); b.fillStyle = "#fff"; b.fillRect(x + (Math.floor(time * 8) % 2 ? 0 : 4), y + 4, 1, 2); break;
    case "flag-waver": {
      b.fillStyle = "#6d4c41"; b.fillRect(x + 5, y - 6, 1, 8); b.fillStyle = s.accent;
      const wind = crowd.windOverride ?? crowd.wind, strength = Math.min(1, Math.abs(wind) / 5), dir = wind < 0 ? -1 : 1, len = 5 + Math.round(strength * 3);
      const f = Math.round(Math.sin(time * (6 + strength * 8) + s.phase) * 1.5 * (1 - strength * 0.7));
      b.fillRect(dir > 0 ? x + 6 : x + 5 - len, y - 6 + f, len, 3 - Math.round(strength)); break;
    }
    case "kid on shoulders": b.fillStyle = s.skin; b.fillRect(x + 1, y - 5, 3, 3); b.fillStyle = s.accent; b.fillRect(x + 1, y - 2, 3, 2); if (mood === "cheer") { b.fillStyle = s.skin; b.fillRect(x, y - 7, 1, 2); b.fillRect(x + 4, y - 7, 1, 2); } break;
    case "grumpy pundit": b.fillStyle = "#ffffff"; b.fillRect(x + 4, y + 4, 2, 3); b.fillStyle = "#111"; b.fillRect(x + 1, y + 1, 3, 1); break;
    case "confetti-thrower": if (mood === "cheer" && t < 0.3) particles.emit("confetti", x - 40, y - TOP, 2, { color: ["#ffd23f", "#ff5a6e", "#7fd3ff", "#ccff00"], speed: 40, gravity: 60, life: 2 }); b.fillStyle = s.accent; b.fillRect(x + 5, y + 2, 2, 2); break;
    case "sleeper": b.fillStyle = "#111"; b.fillRect(x + 1, y + 1, 3, 1); if (Math.floor(time * 1.5 + s.phase) % 3 === 0) { b.fillStyle = "#ffffff"; b.fillRect(x + 5, y - 3 - (Math.floor(time * 3) % 3), 2, 1); } break;
    case "phone filmer": b.fillStyle = "#111"; b.fillRect(x + 5, y, 2, 3); if (Math.floor(time * 2 + s.phase) % 5 === 0) { b.fillStyle = "#ffffff"; b.fillRect(x + 5, y, 1, 1); } break;
    case "foam finger": b.fillStyle = s.accent; b.fillRect(x + 5, y - (armsUp ? 6 : 3), 2, 4); b.fillRect(x + 5, y - (armsUp ? 8 : 5), 1, 2); break;
    case "mascot": b.fillStyle = "#ffd23f"; b.fillRect(x, y - 2, 6, 5); b.fillStyle = "#111"; b.fillRect(x + 1, y, 1, 1); b.fillRect(x + 4, y, 1, 1); b.fillStyle = "#ff8c00"; b.fillRect(x + 2, y + 1, 2, 1); break;
    case "trumpeter": b.fillStyle = "#ffd23f"; b.fillRect(x + 4, y + 1, 4, 1); b.fillRect(x + 8, y, 1, 3); break;
    case "nan knitting": b.fillStyle = "#dddddd"; b.fillRect(x + 1, y - 1, 3, 1); b.fillStyle = "#ff8fab"; b.fillRect(x + 1, y + 5, 3, 2); b.fillStyle = "#bbb"; b.fillRect(x + (Math.floor(time * 5) % 2 ? 1 : 3), y + 4, 1, 3); break;
    case "scarf-twirler": { b.fillStyle = s.accent; const a = time * 8 + s.phase; b.fillRect(Math.round(x + 2 + Math.cos(a) * 4), Math.round(y - 3 + Math.sin(a) * 2), 3, 1); break; }
    case "face-painted fan": b.fillStyle = s.accent; b.fillRect(x + 1, y + 1, 1, 1); b.fillRect(x + 3, y + 1, 1, 1); break;
    case "twins": b.fillStyle = s.shirt; b.fillRect(x + 3, y + 4, 4, 3); b.fillStyle = s.skin; b.fillRect(x + 4, y + 1, 2, 2); break;
    case "hot-dog dad": b.fillStyle = "#c8702f"; b.fillRect(x + 5, y + 3, 3, 1); b.fillStyle = "#ffd23f"; b.fillRect(x + 6, y + 3, 1, 1); break;
    case "streamer": b.fillStyle = s.accent; for (let k = 0; k < 3; k++) b.fillRect(x + 5 + k, y - 4 + Math.round(Math.sin(time * 5 + k) * 1.5), 1, 1); break;
    case "balloon kid": b.fillStyle = s.accent; b.fillRect(x + 5, y - 9 + Math.round(Math.sin(time * 2 + s.phase)), 3, 4); b.fillStyle = "#ffffff99"; b.fillRect(x + 6, y - 5, 1, 5); break;
    case "mega-fan": b.fillStyle = s.accent; b.fillRect(x - 1, y + 3, 7, 5); b.fillStyle = "#ffffff"; b.fillRect(x + 1, y + 4, 3, 1); break;
    case "photographer": b.fillStyle = "#111"; b.fillRect(x + 1, y + 1, 4, 2); if (mood === "cheer" && Math.floor(t * 8) % 3 === 0) { b.fillStyle = "#ffffff"; b.fillRect(x + 2, y + 1, 2, 2); } break;
    case "ref critic": b.fillStyle = "#111"; b.fillRect(x + 1, y + 3, 3, 4); b.fillStyle = s.skin; if (mood === "groan") b.fillRect(x + 5, y - 3, 1, 3); break;
    case "superfan in a bucket hat": b.fillStyle = s.accent; b.fillRect(x, y - 2, 5, 2); break;
    default: break;
  }
}

const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A 1 px pixel line (poles), snapped to whole pixels. */
function pixelLine(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const steps = Math.max(Math.abs(Math.round(x1) - Math.round(x0)), Math.abs(Math.round(y1) - Math.round(y0)), 1);
  for (let i = 0; i <= steps; i++) c.fillRect(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), 1, 1);
}

export class Crowd {
  private seats: Seat[] = [];
  private buffer = document.createElement("canvas");
  private strips: HTMLCanvasElement[] = [];
  private tick = 0; private since = 1;
  private layout: FriendLayout | null = null;
  private lastRows: (readonly string[] | null)[] = [];
  private paintedKey = "";
  mood: CrowdMood = "idle"; moodTime = 0; wave = 0; chant = 0;
  catX = -40; catActive = false;
  /** The player's Friend (set by the Stage every frame). Null → the original crowd. */
  rows: CrowdRowsProvider | null = null;
  /** Showroom switch: false shows the original crowd even when the Friend is loaded. */
  friends = true;
  /** Showroom: overrides the Stage's wind for the crowd's flags. */
  windOverride: number | null = null;
  constructor(public stadium: StadiumId) {
    this.buffer.width = W + 80; this.buffer.height = TOP + 100;
    const { rows, step, empty } = LAYOUTS[stadium], holes = CROWD_HOLES[stadium];
    let n = 0;
    rows.forEach((y, r) => {
      for (let x = 2 + (r % 2) * Math.floor(step / 2); x < W + 78; x += step) {
        n++;
        if (hash01(n * 13 + 5) < empty || holes.some(hole => x + 6 > hole.x && x < hole.x + hole.w && y + 7 > hole.y && y - 1 < hole.y + hole.h)) continue;
        this.seats.push(this.human(x, y, r, n, false));
      }
    });
  }
  private human(x: number, y: number, r: number, n: number, mixed: boolean): Seat {
    const h = hash01(n * 31 + r * 7 + (this.stadium === "pro" ? 1000 : this.stadium === "champions" ? 2000 : 0));
    // Among the Friends, the humans are the characters (no plain fans).
    const typeIndex = !mixed && h < 0.55 ? 0 : 1 + Math.floor(hash01(n * 17 + 3) * (CROWD_TYPES.length - 1));
    const shirts = SHIRTS[this.stadium];
    return { x, y: y + TOP, type: CROWD_TYPES[typeIndex], skin: SKIN[Math.floor(hash01(n + 11) * SKIN.length)], hair: HAIR[Math.floor(hash01(n + 23) * HAIR.length)],
      shirt: shirts[Math.floor(hash01(n + 37) * shirts.length)], accent: shirts[Math.floor(hash01(n + 53) * shirts.length)], phase: hash01(n + 71) * 6.28, seed: n };
  }
  react(mood: CrowdMood) { this.mood = mood; this.moodTime = 0; this.since = 1; }
  update(dt: number) { this.moodTime += dt; this.tick += dt; if (this.mood !== "idle" && this.mood !== "tense" && this.moodTime > 3.2) this.mood = "idle"; if (this.wave > 0) this.wave += dt; if (this.wave > 4.5) this.wave = 0; }
  startWave() { this.wave = 0.001; }
  /** Wind (m/s, + blows to the right): flags stream with it. */
  wind = 0;
  /** What the stands hold right now (Showroom readout). */
  get census() {
    const l = this.layout;
    if (!l || !this.friends) return { friends: 0, humans: this.seats.length, flags: 0, bigFlags: 0, banners: 0, peekers: 0 };
    const fans = l.rows.flatMap(row => row.fans);
    return { friends: fans.length + l.peekers.length + l.holders.length, humans: l.rows.reduce((sum, row) => sum + row.humans.length, 0), flags: fans.filter(f => f.flag >= 0).length,
      bigFlags: fans.filter(f => f.big >= 0).length, banners: l.banners.length, peekers: l.peekers.length + l.holders.length };
  }

  /** Builds (or reuses) the atlas and seat plan for the current Friend. Null → the original crowd. */
  private friendLayout(): FriendLayout | null {
    const rows = this.rows;
    if (!rows || !this.friends) return null;
    const idle = rows("down", false, 0), walk = rows("down", true, 0);
    if (!idle || !walk) return null;
    if (this.layout && idle === this.lastRows[0] && walk === this.lastRows[8]) return this.layout; // same Friend
    const frames: (readonly string[])[] = [];
    for (let k = 0; k < FRAME_COUNT; k++) { const frame = rows("down", k >= 8, k % 8); if (!frame) return null; frames.push(frame); }
    this.lastRows = frames;
    const key = `${this.stadium}|${frames.map(frame => frame.join("")).join("/")}`;
    if (this.layout?.key === key) return this.layout;
    const config = FRIENDS[this.stadium];
    let atlas = atlasCache.get(key);
    if (!atlas) {
      const built = buildAtlas(key, frames, config.heights, config.halos);
      if (!built) return null;
      atlas = built;
      if (atlasCache.size >= 6) atlasCache.delete(atlasCache.keys().next().value!);
      atlasCache.set(key, atlas);
    }
    this.layout = this.planSeats(key, atlas);
    return this.layout;
  }
  /** Fills each row with Friends (packed, halos touching) and the odd human character. */
  private planSeats(key: string, atlas: Atlas): FriendLayout {
    const { rows, step, empty } = LAYOUTS[this.stadium], holes = CROWD_HOLES[this.stadium], config = FRIENDS[this.stadium];
    const salt = this.stadium === "pro" ? 5000 : this.stadium === "champions" ? 9000 : 0;
    const hit = (x: number, y: number, w: number, h: number) => holes.some(hole => x + w > hole.x && x < hole.x + hole.w && y + h > hole.y && y < hole.y + hole.h);
    let n = 0;
    const plan: { fans: Fan[]; humans: Seat[]; y: number }[] = rows.map((y, r) => {
      const size = r < rows.length / 2 ? 0 : 1, { w, h } = atlas.sizes[size], fans: Fan[] = [], humans: Seat[] = [];
      for (let x = 1 + (r % 2) * Math.floor(w / 2); x < W + 78;) {
        n++;
        const seed = n * 7 + salt;
        if (hash01(seed + 1) < empty) { x += step; continue; }
        if (hash01(seed + 2) < config.share) {
          // A flag-waver gets a free pixel column beside it for the pole (so the pole never crosses a Friend).
          const flag = hash01(seed + 7) < config.flagShare ? Math.floor(hash01(seed + 8) * config.flags.length) : -1, flip = hash01(seed + 4) < 0.5, room = flag >= 0 ? 2 : 0;
          if (hit(x, y + 6 - h, w + 2 + room, h + 2)) { x += 2; continue; }
          fans.push({ x: x + (flip ? room : 0), y: y + TOP, row: r, size, halo: Math.floor(hash01(seed + 3) * atlas.halos), flip, phase: hash01(seed + 5) * 6.28,
            hop: 2.3 + hash01(seed + 6) * 0.7, flag, big: -1, scarf: hash01(seed + 9) < 0.55 });
          x += w + config.gap + room + (this.stadium === "park" && hash01(seed + 10) < 0.3 ? 2 : 0);
        } else {
          if (!hit(x, y - 1, 6, 8)) humans.push(this.human(x, y, r, n, true));
          x += step;
        }
      }
      return { fans, humans, y: y + TOP };
    });
    // The two big PK flags go to the Friend nearest each spot. The neighbour on the pole's side steps
    // aside (the pole never crosses a Friend) and the Friends nearby lower their own flags.
    config.big.forEach((spot, i) => {
      const row = plan[spot.row];
      if (!row) return;
      let best: Fan | null = null;
      for (const fan of row.fans) if (!best || Math.abs(fan.x - spot.x) < Math.abs(best.x - spot.x)) best = fan;
      if (!best) return;
      const chosen = best, { w } = atlas.sizes[chosen.size], pole = chosen.flip ? chosen.x - 1 : chosen.x + w + 2;
      chosen.big = i; chosen.flag = -1; chosen.scarf = false;
      row.fans = row.fans.filter(fan => fan === chosen || !(fan.x <= pole + 1 && fan.x + w + 2 >= pole));
      row.humans = row.humans.filter(seat => !(seat.x <= pole + 2 && seat.x + 7 >= pole));
      for (const fan of row.fans) if (fan !== chosen && Math.abs(fan.x - chosen.x) < 30) fan.flag = -1;
    });
    // Banner holders hold the banner (no flags or scarves of their own).
    const banners = config.banners.map(banner => {
      const width = glyphCols(banner.text) + 6;
      for (const fan of plan[banner.row]?.fans ?? []) if (fan.x + 10 > banner.x && fan.x < banner.x + width) { fan.flag = -1; fan.big = -1; fan.scarf = false; }
      return { banner, y: 0, lift: 0, n: 0 };
    });
    // Friends peeking over the tops of the Pro tifo and banner, and holding up the Champions cards.
    const small = atlas.sizes[0], peekers: Peeker[] = [], holders: Peeker[] = [];
    const along = (list: Peeker[], rect: { x: number; y: number; w: number }, peek: number, gap: number) => {
      for (let x = rect.x + 1, k = 0; x + small.w + 2 <= rect.x + rect.w; x += small.w + gap, k++) {
        const seed = x * 13 + rect.y * 7 + salt;
        list.push({ x, y: rect.y + TOP, peek, halo: Math.floor(hash01(seed) * atlas.halos), flip: hash01(seed + 1) < 0.5, phase: hash01(seed + 2) * 6.28, col: Math.floor((x - rect.x) / 3) });
      }
    };
    if (this.stadium === "pro") { along(peekers, PRO_TIFO, 5, 2); along(peekers, PRO_BANNER, 4, 3); }
    if (this.stadium === "champions") along(holders, CHAMPIONS_MOSAIC, 5, 1);
    return { key, atlas, rows: plan, peekers, holders, banners };
  }

  /**
   * Each Friend's pose now (continuous time, eased; the caller snaps to whole pixels): lift in px,
   * whether it dances (the canonical walk cycle), how high its scarf is raised (0–1), flag energy.
   */
  private pose(x: number, row: number, phase: number, hop: number, time: number, reduced: boolean) {
    const mood = this.mood, t = this.moodTime, dist = Math.abs(x - ORIGIN_X);
    let lift = (Math.sin(time * 1.7 + phase) + 1) * 0.5, walk = false, raise = 0, energy = 0.35;
    if (reduced) { lift = mood === "cheer" ? 1 : 0; raise = mood === "cheer" ? 1 : 0; energy = 0; }
    else if (mood === "cheer") {
      // The roar ripples out from the goal along the stands; each Friend hops on a parabola.
      const tt = t - dist / 320 - row * 0.015;
      if (tt >= 0) {
        const env = 1 - smoothstep(2.3, 3.1, tt), p = (tt * hop) % 1;
        lift = 4 * p * (1 - p) * (3 + (row % 2)) * env; walk = env > 0.2; energy = 0.35 + 0.65 * env;
        raise = Math.min(ease.outCubic(clamp01(tt / 0.25)), 1 - smoothstep(2.6, 3.2, tt));
      }
    } else if (mood === "ooh") {
      // Near-miss: a faster ripple of Friends rising up on their toes, then easing back down.
      const tt = t - dist / 520;
      if (tt >= 0) { lift = 2 * ease.outBack(clamp01(tt / 0.2)) * (1 - ease.inOutCubic(clamp01((tt - 0.9) / 0.8))); energy = 0.6; }
    } else if (mood === "groan") {
      const tt = t - dist / 400;
      lift = tt < 0 ? lift : -ease.outQuad(clamp01(tt / 0.35)) * (1 - ease.inOutCubic(clamp01((tt - 1.6) / 0.8))); energy = 0.1;
    } else if (mood === "tense") { lift = 0; energy = 0.2; }
    if (this.wave > 0 && !reduced) {
      const up = Math.max(0, 1 - Math.abs((x / (W + 80)) * 4 - (this.wave - 0.3)) * 2);
      if (up > 0) { lift = Math.max(lift, ease.inOutCubic(up) * 6); raise = Math.max(raise, smoothstep(0.2, 0.6, up)); energy = Math.max(energy, up); }
    }
    return { lift: Math.round(lift), walk, raise, energy };
  }
  /** Canonical frame for a Friend: the idle cycle, the walk cycle when dancing; frame 0 when still. */
  private frame(time: number, phase: number, walk: boolean, reduced: boolean) {
    if (reduced || this.mood === "tense") return 0;
    return walk ? 8 + (Math.floor(time * 10 + phase * 3) % 8) : Math.floor(time * 5 + phase * 3) % 8;
  }

  /**
   * Draw. The original crowd: repainted at 15 fps into the cached layer, then blitted with parallax.
   * The Friends crowd: the far tier stays cached; each row is its humans' strip (15 fps) then its
   * Friends from the atlas, every frame, at whole-pixel positions. Emits confetti for throwers.
   */
  draw(c: CanvasRenderingContext2D, time: number, pan: number, particles: Particles, reduced: boolean) {
    const layout = this.friendLayout();
    if ((layout?.key ?? "") !== this.paintedKey) this.since = 1; // the plan changed: repaint the strips now
    this.since += 1 / 60;
    if (this.since >= 1 / 15 || this.tick === 0) { this.since = 0; this.paint(time, particles, reduced, layout); }
    const ox = Math.round(-40 - pan * 0.5), oy = -TOP;
    c.drawImage(this.buffer, ox, oy);
    if (!layout) return;
    const { atlas } = layout, config = FRIENDS[this.stadium], wind = this.windOverride ?? this.wind;
    const cell = (frame: number, flip: boolean, size: number, halo: number) => [(frame * 2 + (flip ? 1 : 0)) * atlas.cw, (size * atlas.halos + halo) * atlas.ch] as const;
    // Friends peeking over the Pro tifo and banner (only their heads show above the sheet).
    for (const p of layout.peekers) {
      const { lift } = this.pose(p.x, 0, p.phase, 2.6, time, reduced), s = atlas.sizes[0], shown = Math.min(s.h + 2, p.peek + Math.max(0, lift));
      const [sx, sy] = cell(this.frame(time, p.phase, false, reduced), p.flip, 0, p.halo);
      c.drawImage(atlas.canvas, sx, sy, s.w + 2, shown, ox + p.x, oy + p.y - shown, s.w + 2, shown);
    }
    // Champions: little Friends holding up the card mosaic; each bobs up as its column's cards flip.
    if (this.stadium === "champions") {
      const m = CHAMPIONS_MOSAIC, s = atlas.sizes[0], t = this.moodTime;
      for (const p of layout.holders) {
        let lift = this.pose(p.x, 0, p.phase, 2.6, time, reduced).lift;
        if (this.mood === "cheer" && t < 2.6) lift = reduced ? 1 : Math.round(2 * ease.outCubic(clamp01((t * 40 - p.col) / 6)) * (1 - smoothstep(2.2, 2.6, t)));
        const [sx, sy] = cell(this.frame(time, p.phase, false, reduced), p.flip, 0, p.halo);
        c.drawImage(atlas.canvas, sx, sy, s.w + 2, s.h + 2, ox + p.x, oy + p.y - p.peek - lift, s.w + 2, s.h + 2);
      }
      drawMosaic(c, ox + m.x, oy + m.y + TOP, this.mood, t, reduced);
    }
    for (const banner of layout.banners) { banner.lift = -9; banner.n = 0; }
    layout.rows.forEach((row, r) => {
      c.drawImage(this.strips[r], ox, oy + row.y - STRIP_UP);
      for (const f of row.fans) {
        const s = atlas.sizes[f.size], pose = this.pose(f.x, f.row, f.phase, f.hop, time, reduced);
        const x = ox + f.x, top = oy + f.y + 8 - (s.h + 2) - pose.lift;
        const [sx, sy] = cell(this.frame(time, f.phase, pose.walk, reduced), f.flip, f.size, f.halo);
        c.drawImage(atlas.canvas, sx, sy, s.w + 2, s.h + 2, x, top, s.w + 2, s.h + 2);
        // Props are held above or beside the Friend, never drawn over its pixels.
        if (f.big >= 0) this.bigFlag(c, x + (f.flip ? -1 : s.w + 2), top + 3, f, time, wind, pose.energy, reduced);
        else if (f.flag >= 0) this.flag(c, x + (f.flip ? -1 : s.w + 2), top + 3, f, config.flags[f.flag], time, wind, pose.energy, reduced);
        else if (f.scarf && pose.raise > 0.05) this.scarf(c, x, top, s.w + 2, config.flags[f.halo % config.flags.length], pose.raise);
        for (const b of layout.banners) if (b.banner.row === r && f.x + 10 > b.banner.x && f.x < b.banner.x + glyphCols(b.banner.text) + 6) { b.lift = Math.max(b.lift, pose.lift); b.n++; b.y = oy + f.y + 8 - (s.h + 2); }
      }
      // Banners held up just above this row's heads (clear of the highest hop), rising with the holders.
      for (const b of layout.banners) if (b.banner.row === r && b.n) {
        const cloth = bannerCloth(b.banner), bx = ox + b.banner.x, by = b.y - b.lift - cloth.height - 1;
        if (reduced) c.drawImage(cloth, bx, by);
        else for (let k = 0; k < cloth.width; k += 4) c.drawImage(cloth, k, 0, 4, cloth.height, bx + k, by + Math.round(Math.sin(time * 3 - k * 0.12 + r) * 0.6), 4, cloth.height);
      }
    });
  }

  /** A flag-waver's flag: the pole sweeps side to side, the cloth ripples and streams with the wind. */
  private flag(c: CanvasRenderingContext2D, hx: number, hy: number, f: Fan, colours: readonly [string, string], time: number, wind: number, energy: number, reduced: boolean) {
    const strength = Math.min(1, Math.abs(wind) / 6), dir = Math.abs(wind) > 0.3 ? Math.sign(wind) : f.flip ? -1 : 1;
    const sweep = reduced ? 0.12 * dir : Math.sin(time * (1.8 + energy * 3.2) + f.phase) * (0.15 + energy * 0.4);
    const len = 11, tx = hx + Math.sin(sweep) * len, ty = hy - Math.cos(sweep) * len;
    c.fillStyle = FRIENDS[this.stadium].pole; pixelLine(c, hx, hy, tx, ty);
    const cloth = 6 + Math.round(strength * 3), droop = (1 - strength) * 2;
    for (let k = 0; k < cloth; k++) {
      const ripple = reduced ? 0 : Math.sin(time * (6 + energy * 6 + strength * 6) - k * 0.9 + f.phase) * (0.5 + energy) * (1 - strength * 0.5) * Math.min(1, k / 2);
      const x = Math.round(tx) + dir * (k + 1), y = Math.round(ty + (k / cloth) * droop + ripple);
      c.fillStyle = colours[0]; c.fillRect(x, y, 1, 2); c.fillStyle = colours[1]; c.fillRect(x, y + 2, 1, 2);
    }
  }
  /** A big "PK" flag on a long pole, swung slowly; the cloth ripples column by column. */
  private bigFlag(c: CanvasRenderingContext2D, hx: number, hy: number, f: Fan, time: number, wind: number, energy: number, reduced: boolean) {
    const spot = FRIENDS[this.stadium].big[f.big], cloth = pkCloth(spot.bg, spot.fg), strength = Math.min(1, Math.abs(wind) / 6);
    const dir = Math.abs(wind) > 0.3 ? Math.sign(wind) : f.flip ? -1 : 1;
    const sweep = reduced ? 0.08 * dir : Math.sin(time * (1.1 + energy * 1.6) + f.phase) * (0.12 + energy * 0.3);
    const len = 20, tx = Math.round(hx + Math.sin(sweep) * len), ty = Math.round(hy - Math.cos(sweep) * len);
    c.fillStyle = FRIENDS[this.stadium].pole; pixelLine(c, hx, hy, tx, ty);
    c.fillRect(tx - 1, ty - 1, 3, 1);
    for (let k = 0; k < cloth.width; k++) {
      const ripple = reduced ? 0 : Math.sin(time * (4 + energy * 4 + strength * 4) - k * 0.42 + f.phase) * (0.8 + energy * 1.2) * (1 - strength * 0.4) * Math.min(1, k / 3);
      const sag = Math.round((k / cloth.width) * (1 - strength) * 2 + ripple);
      c.drawImage(cloth, k, 0, 1, cloth.height, dir > 0 ? tx + 1 + k : tx - 1 - k, ty + sag, 1, cloth.height);
    }
  }
  /** A scarf held up above the head: above the stamp, tassels on its halo columns, never over the sprite. */
  private scarf(c: CanvasRenderingContext2D, x: number, top: number, width: number, colours: readonly [string, string], raise: number) {
    const y = top - 2 - Math.round(raise * 2);
    for (let k = 0; k < width; k += 2) { c.fillStyle = colours[(k / 2) % 2]; c.fillRect(x + k, y, Math.min(2, width - k), 2); }
    c.fillStyle = colours[0]; c.fillRect(x, y + 2, 1, 1); c.fillRect(x + width - 1, y + 2, 1, 1); // tassels
  }

  private paint(time: number, particles: Particles, reduced: boolean, layout: FriendLayout | null) {
    this.paintedKey = layout?.key ?? "";
    const b = this.buffer.getContext("2d")!;
    b.clearRect(0, 0, this.buffer.width, this.buffer.height);
    const mood = this.mood, t = this.moodTime, far = LAYOUTS[this.stadium].far;
    if (far) {
      const cheering = mood === "cheer" || this.wave > 0;
      b.drawImage(farFrame(this.stadium, cheering ? (reduced ? 2 : 2 + (Math.floor(time * 7) % 2)) : reduced ? 0 : Math.floor(time * 1.5) % 2), 0, 0);
      // Phone torches twinkle across the Champions upper tier.
      if (!reduced && this.stadium === "champions") { b.fillStyle = "#fffbe6"; for (let k = 0; k < 10; k++) b.fillRect(Math.floor(Math.random() * (W + 80)), TOP + far.top + Math.floor(Math.random() * (far.bottom - far.top)), 1, 1); }
    }
    if (layout) {
      // Friends mode: the humans go into one strip per row, so each row keeps its depth order.
      layout.rows.forEach((row, r) => {
        let strip = this.strips[r];
        if (!strip) { strip = this.strips[r] = document.createElement("canvas"); strip.width = W + 80; strip.height = STRIP_H; }
        const s = strip.getContext("2d")!;
        s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, strip.width, strip.height);
        s.setTransform(1, 0, 0, 1, 0, -(row.y - STRIP_UP));
        for (const seat of row.humans) paintHuman(s, seat, this, time, particles, reduced);
        s.setTransform(1, 0, 0, 1, 0, 0);
      });
      return;
    }
    if (this.stadium === "champions") {
      // Card mosaic: on a goal the cards flip in a wave sweeping across the stand.
      const m = CHAMPIONS_MOSAIC, x = m.x, y = m.y + TOP;
      drawMosaic(b, x, y, mood, t, reduced);
      b.fillStyle = "#e0ac69"; for (let k = 4; k < m.w; k += 9) b.fillRect(x + k, y - 1, 2, 1); // the hands holding the top row up
    }
    for (const s of this.seats) paintHuman(b, s, this, time, particles, reduced);
  }

  /** Pitch-invader cat: occasionally scampers along the touchline (world layer). */
  drawCat(c: CanvasRenderingContext2D, dt: number) {
    if (!this.catActive && Math.random() < dt * 0.02) { this.catActive = true; this.catX = -20; }
    if (!this.catActive) return;
    this.catX += dt * 60;
    if (this.catX > W + 20) { this.catActive = false; return; }
    const x = Math.round(this.catX), y = 300, leg = Math.floor(this.catX / 4) % 2;
    c.fillStyle = "#222"; c.fillRect(x, y, 8, 4); c.fillRect(x + 7, y - 3, 4, 4); c.fillRect(x + 7, y - 4, 1, 1); c.fillRect(x + 10, y - 4, 1, 1);
    c.fillRect(x - 3, y - 2 - leg, 3, 1); c.fillRect(x + 1, y + 4, 1, 2 - leg); c.fillRect(x + 6, y + 4, 1, 1 + leg);
    c.fillStyle = "#ccff00"; c.fillRect(x + 9, y - 2, 1, 1);
  }
}
