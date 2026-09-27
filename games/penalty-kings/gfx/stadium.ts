/**
 * Stadium backdrops (Park / Pro / Champions), weather, pitch and goal frame.
 * Static layers are painted once into cached canvases; animated details are drawn per frame.
 */
import { W, H, hash01, type Particles } from "./core.js";

export type StadiumId = "park" | "pro" | "champions";
export type Weather = "sun" | "rain" | "snow" | "fog" | "sunset";
export const GOAL = { left: 150, right: 330, bar: 96, line: 176, unit: 90, cx: 240 } as const;
/**
 * Pitch cameras (pinhole, behind the ball on the centre line). Focal lengths: 539 px at 1 m across,
 * 4/3 × that vertically (the goal art is 180 × 80 px for 7.32 × 2.44 m). `back` is metres behind the
 * ball, `height` metres up, `horizon` the screen y of the vanishing line.
 *
 * PENALTY camera: solved so the goal art lands exactly where it is drawn (scale 1, goal line y 176)
 * and the 18-yard line sits at y 310 at the bottom of the frame. Real proportions follow: 6-yard
 * line (5.5 m) y≈191, spot (11 m) y≈220, box edge (16.5 m) y≈310. The D (9.15 m around the spot,
 * beyond the box line), the box's side lines and the corners are off-screen, as in a real
 * behind-the-kicker broadcast shot.
 */
export type PitchCamera = Readonly<{ back: number; height: number; horizon: number }>;
export const CAM_FX = 539, CAM_FY = CAM_FX * (4 / 3);
/**
 * The penalty view is a real broadcast camera behind the taker (round 6 B1): the goal is drawn at
 * PENALTY_UNIT px per half-goal (not the art's 90), the spot sits at y 250 and the 18-yard line at
 * y 296 (above the SDK badges), so the six-yard box, the spot, the box edge and where the D meets it are in view with
 * real proportions. The goal-art group is placed with PENALTY_GOAL (scale + goal-line position).
 */
export const PENALTY_UNIT = 68;
const PEN_C = (CAM_FX * 3.66) / PENALTY_UNIT;                          // camera → goal line (m)
const PEN_SPOT_Y = 250, PEN_BOX_Y = 296;
const PEN_K = (PEN_BOX_Y - PEN_SPOT_Y) / (1 / (PEN_C - 16.5) - 1 / (PEN_C - 11)); // FY·height
export const PENALTY_CAMERA: PitchCamera = { back: PEN_C - 11, height: PEN_K / CAM_FY, horizon: PEN_SPOT_Y - PEN_K / (PEN_C - 11) };
/** Screen y of a point on the centre line `d` metres from the goal line (penalty camera). */
export const penaltyY = (d: number) => PENALTY_CAMERA.horizon + (CAM_FY * PENALTY_CAMERA.height) / (PEN_C - d);
/** Goal-art group placement for penalties: scale and the goal line on screen. */
export const PENALTY_GOAL = { g: PENALTY_UNIT / GOAL.unit, x: GOAL.cx, y: penaltyY(0) } as const;
export const SPOT = { x: 240, y: Math.round(penaltyY(11)) } as const;
export const toScreen = (gx: number, gy: number) => ({ x: GOAL.cx + gx * GOAL.unit, y: GOAL.line - gy * GOAL.unit * 0.89 });


export type StadiumTheme = { sky: [string, string]; grass: [string, string]; stands: string; standLine: string; boards: string[]; confetti: string[]; lines: string; label: string };
/**
 * Three grounds that never look alike (round 6 E22):
 * PARK — a cosy Sunday-league field under a daytime sky: wooden benches, trees, kites, an ice-cream van.
 * PRO — a modern floodlit bowl at night: two tiers, glass hospitality boxes, LED ribbon boards, a TV
 *   gantry, the ultras end with its tifos and coloured smoke, drizzle in the light beams and a wet sheen.
 * CHAMPIONS — a colossal golden arena: retractable roof open to a starry sky, a crown ring, a 4-sided
 *   centre-hung jumbotron, a card mosaic spelling PENALTY KINGS, the champions stage with the trophy,
 *   a pyro line, confetti cannons and a firework finale on your goal.
 */
export const THEMES: Readonly<Record<StadiumId, StadiumTheme>> = {
  park: { sky: ["#7ec8ff", "#d4f0ff"], grass: ["#4caf50", "#43a047"], stands: "#8d6e63", standLine: "#6d4c41", boards: ["#ffd23f", "#ff8fab", "#7fd3ff"], confetti: ["#ffd23f", "#ff8fab", "#7fd3ff", "#ffffff"], lines: "#f1fff0", label: "PARK · Sunday League" },
  pro: { sky: ["#040716", "#101c44"], grass: ["#2c7f37", "#26702f"], stands: "#141b3c", standLine: "#1e2754", boards: ["#05070f"], confetti: ["#c6ff1a", "#ff2e6e", "#29e0ff", "#ffffff"], lines: "#e9f5e1", label: "PRO · Floodlit Bowl" },
  champions: { sky: ["#05020c", "#1a0b30"], grass: ["#3c9a44", "#348a3b"], stands: "#22103a", standLine: "#301a50", boards: ["#120c04"], confetti: ["#ffd23f", "#fff2b3", "#b36bff", "#ffffff"], lines: "#fff6d8", label: "CHAMPIONS · Golden Arena" },
};

/** Weather by UTC weekday unless overridden: Sun sun, Mon rain, Tue sun, Wed fog, Thu sun, Fri sunset, Sat snow. */
export const weatherForDay = (day = new Date().getUTCDay()): Weather => (["sun", "rain", "sun", "fog", "sun", "sunset", "snow"] as const)[day];

/**
 * The backdrop layer reaches SKY_TOP px above its own y 0: the penalty view drops the layer by
 * BACKDROP_DROP (gfx/stage.ts), so Pro's roof and Champions' upper tiers fill the space above the
 * stands there, while the free-kick view (no drop) crops them off the top of the screen.
 */
export const SKY_TOP = 130;
const LAYER_W = W + 80, BACK_H = SKY_TOP + 102;
type Rect = Readonly<{ x: number; y: number; w: number; h: number }>;
/** Layer-space rectangles the near crowd leaves empty (x in backdrop-layer px, y in local px). */
export const PRO_TIFO: Rect = { x: 44, y: 35, w: 104, h: 50 };
export const PRO_BANNER: Rect = { x: 428, y: 62, w: 88, h: 14 };
export const CHAMPIONS_MOSAIC: Rect = { x: 181, y: 40, w: 198, h: 21 };
export const CHAMPIONS_STAGE: Rect = { x: 410, y: 46, w: 96, h: 42 };
export const CROWD_HOLES: Readonly<Record<StadiumId, readonly Rect[]>> = { park: [], pro: [PRO_TIFO, PRO_BANNER], champions: [CHAMPIONS_MOSAIC, CHAMPIONS_STAGE] };

const cache = new Map<string, HTMLCanvasElement>();
function layer(key: string, paint: (c: CanvasRenderingContext2D) => void, width = LAYER_W, height = H) {
  let canvas = cache.get(key);
  if (!canvas) { canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const c = canvas.getContext("2d")!; c.imageSmoothingEnabled = false; paint(c); cache.set(key, canvas); }
  return canvas;
}

// ── 4×5 pixel font for cached art (the tifo, the mosaic, the jumbotron) ─────────
const GLYPHS: Readonly<Record<string, string>> = {
  A: "0110100111111001 1001", B: "1110100111101001 1110", C: "0111100010001000 0111", D: "1110100110011001 1110", E: "1111100011101000 1111",
  F: "1111100011101000 1000", G: "0111100010111001 0111", H: "1001100111111001 1001", I: "1110010001000100 1110", K: "1001101011001010 1001",
  L: "1000100010001000 1111", M: "1001111111111001 1001", N: "1001110110111001 1001", O: "0110100110011001 0110", P: "1110100111101000 1000",
  R: "1110100111101010 1001", S: "0111100001100001 1110", T: "1111011001100110 0110", U: "1001100110011001 0110", V: "1001100110010110 0110",
  W: "1001100111111111 1001", Y: "1001100101100110 0110", "!": "0100010001000000 0100", " ": "0000000000000000 0000",
};
/** Width in font cells (4 per glyph + 1 gap). */
const glyphCols = (text: string) => text.length * 5 - 1;
function glyphText(c: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, colour: string) {
  c.fillStyle = colour;
  [...text].forEach((ch, i) => {
    const bits = (GLYPHS[ch] ?? GLYPHS[" "]).replace(" ", "");
    for (let k = 0; k < 20; k++) if (bits[k] === "1") c.fillRect(x + (i * 5 + (k % 4)) * px, y + Math.floor(k / 4) * px, px, px);
  });
}
const vGrad = (c: CanvasRenderingContext2D, y0: number, y1: number, stops: readonly string[]) => {
  const g = c.createLinearGradient(0, y0, 0, y1); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g;
};
/** Darkens both ends of a stand so the flat rows read as a curved bowl. */
function bowlShade(c: CanvasRenderingContext2D, y: number, h: number, strength: number) {
  for (const [x0, x1] of [[0, 150], [LAYER_W, LAYER_W - 150]] as const) {
    const g = c.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(Math.min(x0, x1), y, 150, h);
  }
}

// ── Static backdrops (one cached canvas per stadium × weather) ────────────────
function paintPark(c: CanvasRenderingContext2D, weather: Weather) {
  const theme = THEMES.park;
  const [top, bottom] = weather === "sunset" ? ["#ff7e5f", "#feb47b"] : weather === "fog" ? ["#9aa3ad", "#c7ccd2"] : theme.sky;
  c.fillStyle = top; c.fillRect(0, -SKY_TOP, LAYER_W, SKY_TOP);
  c.fillStyle = vGrad(c, 0, 90, [top, bottom]); c.fillRect(0, 0, LAYER_W, 90);
  // Distant trees and a hill.
  c.fillStyle = "#6fbf73"; c.beginPath(); c.ellipse(120, 92, 180, 30, 0, Math.PI, 0); c.fill();
  c.fillStyle = "#3e8e41"; for (let i = 0; i < 22; i++) { const x = i * 26 + (i % 3) * 5; c.beginPath(); c.arc(x, 72 + (i % 2) * 4, 10 + (i % 3) * 3, 0, Math.PI * 2); c.fill(); }
  // Wooden bench stands.
  c.fillStyle = theme.stands; c.fillRect(0, 60, LAYER_W, 30);
  c.fillStyle = theme.standLine; for (let y = 64; y < 90; y += 8) c.fillRect(0, y, LAYER_W, 2);
}

function paintPro(c: CanvasRenderingContext2D, weather: Weather) {
  const X = LAYER_W;
  // Night sky (a few stars when it is clear).
  c.fillStyle = vGrad(c, -SKY_TOP, -40, weather === "fog" ? ["#1d2433", "#3d4758"] : weather === "rain" ? ["#02040b", "#0a1128"] : ["#03050f", "#0f1a40"]);
  c.fillRect(0, -SKY_TOP, X, SKY_TOP - 38);
  if (weather !== "fog" && weather !== "rain") for (let i = 0; i < 40; i++) { c.fillStyle = i % 5 ? "#6f80b8" : "#c9d6ff"; c.fillRect(Math.floor(hash01(i + 401) * X), -SKY_TOP + Math.floor(hash01(i + 811) * (SKY_TOP - 56)), 1, 1); }
  // Cantilevered roof with a continuous floodlight bank along its underside.
  c.fillStyle = "#090d1c"; c.fillRect(0, -54, X, 14);
  c.fillStyle = "#222c52"; c.fillRect(0, -54, X, 1);
  c.fillStyle = "#121a34"; for (let x = 0; x < X; x += 16) { c.fillRect(x, -52, 1, 11); c.fillRect(x + 1, -47, 14, 1); }
  c.fillStyle = vGrad(c, -40, -18, ["rgba(255,248,214,0.28)", "rgba(255,248,214,0)"]); c.fillRect(0, -40, X, 22);
  for (let x = 3; x < X; x += 9) { c.fillStyle = "#fffbe6"; c.fillRect(x, -41, 6, 2); c.fillStyle = "#b8c4ff"; c.fillRect(x + 1, -39, 4, 1); }
  // Upper tier: navy seats, stepped rows, stair aisles and vomitories.
  c.fillStyle = "#11183a"; c.fillRect(0, -38, X, 44);
  c.fillStyle = "#1a2350"; for (let y = -36; y < 6; y += 4) c.fillRect(0, y, X, 1);
  for (let x = 34; x < X; x += 70) { c.fillStyle = "#0a0f26"; c.fillRect(x, -38, 2, 44); c.fillStyle = "#04060e"; c.fillRect(x - 4, -8, 10, 6); c.fillStyle = "#29e0ff"; c.fillRect(x - 1, -9, 4, 1); }
  bowlShade(c, -38, 44, 0.45);
  // Balcony fascia (ribbon 1 lives at y 6–10), glass hospitality boxes, ribbon 2 (y 25–33).
  c.fillStyle = "#05070f"; c.fillRect(0, 5, X, 5); c.fillStyle = "#2a3868"; c.fillRect(0, 5, X, 1);
  c.fillStyle = "#0a0f22"; c.fillRect(0, 10, X, 15);
  for (let x = 1, n = 0; x < X; x += 34, n++) {
    c.fillStyle = vGrad(c, 11, 24, ["rgba(140,236,255,0.75)", "rgba(60,140,220,0.45)", "rgba(20,50,120,0.6)"]); c.fillRect(x, 11, 31, 13);
    c.fillStyle = "#ffe2a0"; for (let k = 0; k < 3; k++) c.fillRect(x + 5 + k * 10, 12, 3, 1);
    for (let k = 0; k < 4; k++) if (hash01(n * 7 + k) > 0.3) { const px = x + 3 + k * 7; c.fillStyle = "#0b1026"; c.fillRect(px + 1, 15, 3, 3); c.fillRect(px, 18, 5, 6); c.fillStyle = hash01(n * 3 + k) > 0.5 ? "#29e0ff" : "#c6ff1a"; c.fillRect(px + 1, 20, 3, 1); }
    c.fillStyle = "rgba(255,255,255,0.22)"; for (let k = 0; k < 7; k++) c.fillRect(x + 22 - k, 12 + k * 2, 2, 2);
    c.fillStyle = "#4a5c96"; c.fillRect(x, 11, 31, 1); c.fillRect(x, 11, 1, 13); c.fillRect(x + 30, 11, 1, 13); c.fillRect(x + 10, 11, 1, 13); c.fillRect(x + 20, 11, 1, 13);
    c.fillStyle = "#070a18"; c.fillRect(x, 24, 31, 1);
  }
  c.fillStyle = "#03050c"; c.fillRect(0, 25, X, 8); c.fillStyle = "#2a3868"; c.fillRect(0, 25, X, 1); c.fillRect(0, 33, X, 1);
  // Lower tier.
  c.fillStyle = "#141b3c"; c.fillRect(0, 34, X, 54);
  c.fillStyle = "#1e2754"; for (let y = 36; y < 88; y += 7) c.fillRect(0, y, X, 1);
  c.fillStyle = "#0a0f26"; for (let x = 170; x < X - 60; x += 84) c.fillRect(x, 34, 3, 54);
  c.fillStyle = "rgba(255,46,110,0.10)"; c.fillRect(20, 34, 150, 54); // the ultras end glows red
  bowlShade(c, 34, 54, 0.35);
  c.fillStyle = "#05070f"; c.fillRect(0, 87, X, 3);
  drawTifo(c); drawUltrasBanner(c); drawGantry(c);
}

/** The ultras' main tifo (original art): a crowned ball on magenta/navy halves, held up over the lower tier. */
function drawTifo(c: CanvasRenderingContext2D) {
  const { x, y, w, h } = PRO_TIFO;
  c.fillStyle = "#1b1f5a"; c.fillRect(x, y, w, h);
  c.fillStyle = "#ff2e6e"; for (let r = 0; r < h; r++) c.fillRect(x, y + r, Math.round(w * 0.5 - (r - h / 2) * 0.6), 1);
  c.fillStyle = "rgba(0,0,0,0.12)"; for (let r = 4; r < h; r += 8) c.fillRect(x, y + r, w, 3); // the sheets the fans hold
  c.fillStyle = "#c6ff1a"; c.fillRect(x, y, w, 2); c.fillRect(x, y + h - 2, w, 2); c.fillRect(x, y, 2, h); c.fillRect(x + w - 2, y, 2, h);
  // Crown.
  const cx = x + w / 2, cy = y + 6;
  c.fillStyle = "#ffd23f"; c.fillRect(cx - 12, cy + 6, 24, 5);
  for (const dx of [-12, -2, 8]) { c.fillRect(cx + dx, cy, 4, 6); c.fillStyle = "#fff2b3"; c.fillRect(cx + dx + 1, cy - 2, 2, 2); c.fillStyle = "#ffd23f"; }
  c.fillStyle = "#ff2e6e"; c.fillRect(cx - 7, cy + 8, 2, 2); c.fillRect(cx + 5, cy + 8, 2, 2); c.fillStyle = "#29e0ff"; c.fillRect(cx - 1, cy + 8, 2, 2);
  // Ball.
  c.fillStyle = "#ffffff"; c.beginPath(); c.arc(cx, cy + 20, 8, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#111827"; c.fillRect(cx - 2, cy + 18, 4, 4); c.fillRect(cx - 7, cy + 16, 2, 3); c.fillRect(cx + 5, cy + 16, 2, 3); c.fillRect(cx - 5, cy + 25, 3, 2); c.fillRect(cx + 2, cy + 25, 3, 2);
  glyphText(c, "ULTRAS", cx - glyphCols("ULTRAS") / 2, y + h - 9, 1, "#c6ff1a");
  // Fans' hands along the top edge.
  c.fillStyle = "#e0ac69"; for (let k = 4; k < w - 2; k += 9) c.fillRect(x + k, y - 1, 2, 2);
}
function drawUltrasBanner(c: CanvasRenderingContext2D) {
  const { x, y, w, h } = PRO_BANNER;
  for (let k = 0; k < w; k += 8) { c.fillStyle = (k / 8) % 2 ? "#1b1f5a" : "#c6ff1a"; c.fillRect(x + k, y, Math.min(8, w - k), h); }
  c.fillStyle = "#05070f"; c.fillRect(x + 14, y + 2, w - 28, h - 4);
  glyphText(c, "PK ARMY", x + (w - glyphCols("PK ARMY")) / 2, y + 4, 1, "#ff2e6e");
  c.fillStyle = "#e0ac69"; c.fillRect(x + 2, y - 1, 2, 2); c.fillRect(x + w - 4, y - 1, 2, 2);
}
/** TV camera gantry on the balcony: deck, rail, truss and three camera operators. */
function drawGantry(c: CanvasRenderingContext2D) {
  const x = 352, w = 78;
  c.fillStyle = "#3a4468"; c.fillRect(x + 4, 6, 1, 10); c.fillRect(x + w - 5, 6, 1, 10);
  for (const cx of [x + 10, x + 34, x + 58]) {
    c.fillStyle = "#0b0b10"; c.fillRect(cx, 9, 9, 5); c.fillStyle = "#3a4a70"; c.fillRect(cx - 3, 10, 3, 3); c.fillStyle = "#9fb4ff"; c.fillRect(cx - 3, 11, 1, 1);
    c.fillStyle = "#555e80"; c.fillRect(cx + 3, 14, 2, 3);
    c.fillStyle = "#e0ac69"; c.fillRect(cx + 10, 8, 3, 3); c.fillStyle = "#111"; c.fillRect(cx + 10, 7, 3, 1); c.fillStyle = "#2b3458"; c.fillRect(cx + 9, 11, 5, 6);
  }
  c.fillStyle = "#6b7aa8"; c.fillRect(x, 12, w, 1); for (let k = 0; k < w; k += 6) c.fillRect(x + k, 12, 1, 5);
  c.fillStyle = "#2a3354"; c.fillRect(x, 17, w, 3);
  c.fillStyle = "#1a2140"; for (let k = 0; k < w; k += 6) { c.fillRect(x + k, 20, 1, 3); c.fillRect(x + k + 1, 21, 4, 1); }
  c.fillStyle = "#c6ff1a"; c.fillRect(x + 2, 18, 12, 1); // "TV" livery stripe
}

function paintChampions(c: CanvasRenderingContext2D, weather: Weather) {
  const X = LAYER_W;
  c.fillStyle = vGrad(c, -SKY_TOP, -20, weather === "fog" ? ["#241e30", "#4a4058"] : ["#040109", "#170a2c", "#2a1248"]);
  c.fillRect(0, -SKY_TOP, X, SKY_TOP - 20);
  if (weather !== "fog") for (let i = 0; i < 90; i++) { const s = hash01(i + 3001); c.fillStyle = s < 0.15 ? "#ffd23f" : s < 0.6 ? "#fff6d8" : "#8f7fb8"; c.fillRect(Math.floor(hash01(i + 1201) * X), -SKY_TOP + Math.floor(hash01(i + 2203) * (SKY_TOP - 28)), s > 0.93 ? 2 : 1, 1); }
  // Retractable roof: two golden truss panels slid back to the sides, the tracks spanning the opening.
  for (const side of [0, 1]) {
    const edgeTop = side ? X - 200 : 200, edgeBottom = side ? X - 150 : 150, outer = side ? X : 0;
    c.save(); c.beginPath(); c.moveTo(outer, -SKY_TOP); c.lineTo(edgeTop, -SKY_TOP); c.lineTo(edgeBottom, -24); c.lineTo(outer, -24); c.closePath(); c.clip();
    c.fillStyle = "#170f05"; c.fillRect(0, -SKY_TOP, X, SKY_TOP);
    c.fillStyle = "#5a4010"; for (let k = -SKY_TOP; k < X; k += 12) { for (let t = 0; t < SKY_TOP; t += 2) { c.fillRect(k + t * 0.8, -SKY_TOP + t, 1, 1); c.fillRect(k + SKY_TOP * 0.8 - t * 0.8, -SKY_TOP + t, 1, 1); } }
    c.fillStyle = "#3b2a0a"; for (let y = -SKY_TOP + 10; y < -24; y += 14) c.fillRect(0, y, X, 1);
    c.restore();
    c.fillStyle = "#ffcf3f"; for (let t = 0; t <= 1; t += 1 / 106) { const ex = edgeTop + (edgeBottom - edgeTop) * t, ey = -SKY_TOP + (SKY_TOP - 24) * t; c.fillRect(Math.round(ex) - (side ? 0 : 1), Math.round(ey), 2, 1); }
    c.fillStyle = "#fff4c8"; for (let t = 0.05; t < 1; t += 0.09) c.fillRect(Math.round(edgeTop + (edgeBottom - edgeTop) * t) + (side ? 2 : -3), Math.round(-SKY_TOP + (SKY_TOP - 24) * t), 1, 1);
  }
  c.fillStyle = "#4a340c"; for (const y of [-78, -34]) { const inset = (y + SKY_TOP) * (50 / (SKY_TOP - 24)); c.fillRect(200 - inset, y, X - 2 * (200 - inset), 1); }
  // Crown ring: gold fascia with crown teeth and lamp pips.
  c.fillStyle = "#d4a52a"; for (let x = 4; x < X; x += 24) { c.beginPath(); c.moveTo(x, -24); c.lineTo(x + 4, -30); c.lineTo(x + 8, -24); c.fill(); c.fillStyle = "#fff2b3"; c.fillRect(x + 3, -31, 2, 2); c.fillStyle = "#d4a52a"; }
  c.fillStyle = "#b8860b"; c.fillRect(0, -24, X, 7); c.fillStyle = "#ffe28a"; c.fillRect(0, -24, X, 1); c.fillStyle = "#5a3c08"; c.fillRect(0, -18, X, 1);
  c.fillStyle = "#fff6d0"; for (let x = 2; x < X; x += 6) c.fillRect(x, -21, 2, 1);
  // Upper tier (purple seats), hospitality ring, lower tier.
  c.fillStyle = "#1d0f30"; c.fillRect(0, -17, X, 47);
  c.fillStyle = "#2a1845"; for (let y = -15; y < 30; y += 4) c.fillRect(0, y, X, 1);
  c.fillStyle = "#3b2a14"; for (let x = 30; x < X; x += 64) c.fillRect(x, -17, 2, 47);
  bowlShade(c, -17, 47, 0.5);
  c.fillStyle = "#140c04"; c.fillRect(0, 30, X, 8); c.fillStyle = "#d4a52a"; c.fillRect(0, 30, X, 1); c.fillRect(0, 37, X, 1);
  for (let x = 1, n = 0; x < X; x += 5, n++) { c.fillStyle = hash01(n + 91) > 0.25 ? "#ffcf5a" : "#4a3410"; c.fillRect(x, 32, 3, 4); }
  c.fillStyle = "#22103a"; c.fillRect(0, 38, X, 50);
  c.fillStyle = "#301a50"; for (let y = 40; y < 88; y += 6) c.fillRect(0, y, X, 1);
  c.fillStyle = "#3b2a14"; for (let x = 150; x < X - 120; x += 90) c.fillRect(x, 38, 2, 50);
  bowlShade(c, 38, 50, 0.4);
  drawChampionsStage(c);
  // Pyro line emitters and the two confetti cannons on the front wall.
  c.fillStyle = "#0e0903"; c.fillRect(0, 86, X, 4);
  for (let x = 12; x < X; x += 26) { c.fillStyle = "#2a1c08"; c.fillRect(x, 86, 6, 3); c.fillStyle = "#ffcf3f"; c.fillRect(x, 86, 6, 1); }
  for (const [cx, dir] of [[64, 1], [496, -1]] as const) {
    c.fillStyle = "#3b2a14"; c.fillRect(cx - 4, 82, 9, 6);
    c.fillStyle = "#d4a52a"; for (let k = 0; k < 8; k++) c.fillRect(cx + dir * k * 0.6 - 1, 81 - k, 4, 1);
    c.fillStyle = "#fff2b3"; c.fillRect(cx + dir * 4.2 - 1, 73, 4, 1);
  }
}
/** The champions stage (right of the goal): golden arch, stepped podium, the trophy on its plinth. */
function drawChampionsStage(c: CanvasRenderingContext2D) {
  const { x, y, w, h } = CHAMPIONS_STAGE, cx = x + w / 2, base = y + h;
  c.fillStyle = "#2a0f4a"; c.fillRect(x + 8, y + 6, w - 16, h - 18);
  c.fillStyle = "#ffd23f"; for (let k = 0; k < 14; k++) c.fillRect(x + 10 + Math.floor(hash01(k + 71) * (w - 20)), y + 8 + Math.floor(hash01(k + 97) * (h - 24)), 1, 1);
  c.strokeStyle = "#ffcf3f"; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 6, base - 10); c.lineTo(x + 6, y + 18); c.quadraticCurveTo(cx, y - 8, x + w - 6, y + 18); c.lineTo(x + w - 6, base - 10); c.stroke();
  c.strokeStyle = "#fff2b3"; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 6, y + 18); c.quadraticCurveTo(cx, y - 8, x + w - 6, y + 18); c.stroke();
  c.fillStyle = "rgba(255,240,200,0.14)"; for (const sx of [x + 8, x + w - 8]) { c.beginPath(); c.moveTo(sx, y + 4); c.lineTo(cx - 8, base - 12); c.lineTo(cx + 8, base - 12); c.fill(); }
  c.fillStyle = "#ffcf3f"; c.fillRect(x, base - 12, w, 4); c.fillStyle = "#d4a52a"; c.fillRect(x + 4, base - 8, w - 8, 4); c.fillStyle = "#8a6410"; c.fillRect(x + 8, base - 4, w - 16, 4);
  c.fillStyle = "#fff2b3"; for (let k = x + 3; k < x + w - 3; k += 6) c.fillRect(k, base - 11, 2, 1);
  // Trophy.
  const ty = base - 34;
  c.fillStyle = "#3b2a14"; c.fillRect(cx - 6, ty + 14, 12, 8); c.fillStyle = "#6d4c1a"; c.fillRect(cx - 6, ty + 14, 12, 1);
  c.fillStyle = "#ffd23f"; c.fillRect(cx - 7, ty, 14, 7); c.fillRect(cx - 5, ty + 7, 10, 2); c.fillRect(cx - 1, ty + 9, 2, 3); c.fillRect(cx - 4, ty + 12, 8, 2);
  c.fillRect(cx - 10, ty + 1, 3, 1); c.fillRect(cx - 10, ty + 1, 1, 4); c.fillRect(cx - 9, ty + 5, 2, 1); c.fillRect(cx + 7, ty + 1, 3, 1); c.fillRect(cx + 9, ty + 1, 1, 4); c.fillRect(cx + 7, ty + 5, 2, 1);
  c.fillStyle = "#fff2b3"; c.fillRect(cx - 5, ty + 1, 2, 5);
  c.fillStyle = "#b8860b"; c.fillRect(cx + 3, ty + 1, 2, 5);
}

function paintBackdrop(stadium: StadiumId, weather: Weather) {
  return layer(`backdrop-${stadium}-${weather}`, c => {
    c.translate(0, SKY_TOP);
    if (stadium === "park") paintPark(c, weather); else if (stadium === "pro") paintPro(c, weather); else paintChampions(c, weather);
  }, LAYER_W, BACK_H);
}

/** Scrolling LED text inside a screen rectangle. */
function marquee(c: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, time: number, color: string) {
  c.save(); c.beginPath(); c.rect(x, y - 8, w, 12); c.clip();
  c.fillStyle = color; c.font = "8px PixelifySans, monospace";
  const width = text.length * 5 + 40, offset = (time * 30) % width;
  c.fillText(text, x + w - offset, y); c.fillText(text, x + w - offset + width, y);
  c.restore();
}

/** The stadium and weather last drawn (the ambience in audio.ts follows them). */
let active: { stadium: StadiumId; weather: Weather } = { stadium: "park", weather: "sun" };
export const activeStadium = () => active;

export type BackdropEvents = { goalFlash: number; jumbotron?: string; wind?: number; drop?: number; reduced?: boolean };
/** Draws sky + stands (behind the crowd). `pan` shifts the parallax. */
export function drawBackdrop(c: CanvasRenderingContext2D, stadium: StadiumId, weather: Weather, time: number, pan: number, events: BackdropEvents) {
  if (active.stadium !== stadium || active.weather !== weather) active = { stadium, weather };
  c.drawImage(paintBackdrop(stadium, weather), -40 - pan * 0.3, -SKY_TOP);
  drawRoofFlags(c, stadium, time, pan, events.wind ?? 0);
  if (stadium === "park") {
    // Clouds, kites and the sun.
    if (weather === "sun" || weather === "sunset") { c.fillStyle = weather === "sunset" ? "#ffdd8a" : "#fff7b0"; c.beginPath(); c.arc(420 - pan * 0.1, 22, 11, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = "#ffffffcc";
    for (let i = 0; i < 4; i++) { const x = ((time * 6 + i * 140) % (W + 120)) - 60 - pan * 0.15, y = 12 + i * 7; c.fillRect(Math.round(x), y, 30, 5); c.fillRect(Math.round(x) + 6, y - 3, 16, 3); }
    for (let i = 0; i < 2; i++) {
      const kx = 80 + i * 280 + Math.sin(time * 0.7 + i) * 12 - pan * 0.2, ky = 30 + Math.cos(time * 0.9 + i) * 6;
      c.fillStyle = i ? "#ff8fab" : "#ffd23f"; c.beginPath(); c.moveTo(kx, ky - 6); c.lineTo(kx + 5, ky); c.lineTo(kx, ky + 7); c.lineTo(kx - 5, ky); c.fill();
      c.strokeStyle = "#ffffff99"; c.beginPath(); c.moveTo(kx, ky + 7); c.quadraticCurveTo(kx + 8, ky + 30, kx + 3 * Math.sin(time), 60); c.stroke();
    }
    // Ice-cream van at the far left.
    const vx = 18 - pan * 0.3;
    c.fillStyle = "#ffffff"; c.fillRect(vx, 76, 36, 14); c.fillStyle = "#ff8fab"; c.fillRect(vx, 76, 36, 4); c.fillRect(vx + 26, 70, 10, 6);
    c.fillStyle = "#222"; c.fillRect(vx + 5, 89, 6, 3); c.fillRect(vx + 26, 89, 6, 3); c.fillStyle = "#7fd3ff"; c.fillRect(vx + 4, 81, 10, 5);
  }
}

/**
 * Flags on poles along the top of the stands (where real grounds fly them). They stream in the
 * wind's direction and stretch out with its strength; in calm air they hang and flutter gently.
 */
function drawRoofFlags(c: CanvasRenderingContext2D, stadium: StadiumId, time: number, pan: number, wind: number) {
  const base = stadium === "park" ? 60 : stadium === "pro" ? 5 : 30, pole = stadium === "park" ? 14 : 9;
  const colours = THEMES[stadium].confetti, strength = Math.min(1, Math.abs(wind) / 6), dir = wind < 0 ? -1 : 1;
  for (let i = 0; i < 6; i++) {
    const x = Math.round(20 + i * 88 - pan * 0.3);
    c.fillStyle = "#d7dde5"; c.fillRect(x, base - pole, 1, pole);
    const len = 5 + Math.round(strength * 5), droop = Math.round((1 - strength) * 3);
    for (let k = 0; k < len; k++) {
      const ripple = Math.round(Math.sin(time * (3 + strength * 9) - k * 0.9 + i) * (0.6 + (1 - strength) * 0.6));
      c.fillStyle = colours[i % colours.length];
      c.fillRect(dir > 0 ? x + 1 + k : x - 1 - k, base - pole + Math.round((k / len) * droop) + ripple, 1, 4);
    }
  }
}

// ── Animated stadium set pieces (drawn after the crowd, boards and grass; behind the goal) ─────
let lastFlash = 0, goalAt = -1e9;
const PRO_CONES = [70, 190, 330, 470] as const;
/** Soft light beams under the Pro roof (cached; drawn over the crowd as haze). */
const proHaze = () => layer("pro-haze", c => {
  c.translate(0, SKY_TOP);
  for (const x of PRO_CONES) {
    c.fillStyle = vGrad(c, -40, 100, ["rgba(255,250,225,0.16)", "rgba(255,250,225,0.05)", "rgba(255,250,225,0)"]);
    c.beginPath(); c.moveTo(x - 18, -40); c.lineTo(x + 18, -40); c.lineTo(x + 70, 100); c.lineTo(x - 70, 100); c.fill();
  }
}, LAYER_W, BACK_H);
/** Soft round smoke puff sprites (cached per colour). */
const puff = (colour: string) => layer(`puff-${colour}`, c => {
  const g = c.createRadialGradient(16, 16, 1, 16, 16, 16); g.addColorStop(0, colour); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
}, 32, 32);
/** Ribbon-board strips (cached): idle chevrons and the GOAL flash. */
const ribbonStrip = (kind: "idle" | "goal-a" | "goal-b") => layer(`ribbon-${kind}`, c => {
  if (kind === "idle") { for (let x = 0; x < LAYER_W + 24; x += 12) { c.fillStyle = "#0e3a66"; c.fillRect(x, 0, 12, 4); c.fillStyle = "#29e0ff"; c.fillRect(x + 2, 1, 5, 2); c.fillStyle = "#c6ff1a"; c.fillRect(x + 7, 1, 2, 2); } return; }
  const [bg, fg] = kind === "goal-a" ? ["#c6ff1a", "#05070f"] : ["#ff2e6e", "#ffffff"];
  c.fillStyle = bg; c.fillRect(0, 0, LAYER_W + 40, 8);
  for (let x = 2; x < LAYER_W + 40; x += 40) glyphText(c, "GOAL!", x, 1, 1, fg);
}, LAYER_W + 40, 8);
/** Mosaic-style card faces for the Champions jumbotron (cached). */
const jumboFace = (kind: "title" | "goal-a" | "goal-b") => layer(`jumbo-${kind}`, c => {
  const [bg, fg] = kind === "goal-b" ? ["#ffd23f", "#2a0f4a"] : kind === "goal-a" ? ["#2a0f4a", "#ffd23f"] : ["#140a24", "#ffd23f"];
  c.fillStyle = bg; c.fillRect(0, 0, 70, 30);
  if (kind === "title") glyphText(c, "PENALTY KINGS", 3, 3, 1, fg);
  else glyphText(c, "GOAL!", 35 - glyphCols("GOAL!"), 5, 2, fg);
  c.fillStyle = "rgba(0,0,0,0.18)"; for (let y = 1; y < 30; y += 2) c.fillRect(0, y, 70, 1);
}, 70, 30);

/**
 * Stadium set pieces animated per frame, drawn in the (dropped) backdrop space after the crowd,
 * boards and grass, before the goal: Pro's haze, drizzle, ribbon boards, smoke and gantry tally
 * lights; Champions' jumbotron, pyro line, confetti cannons and the firework finale.
 * Reduced motion: no strobing boards, no pyro, no fireworks, fewer confetti pieces.
 */
export function drawStadiumFx(c: CanvasRenderingContext2D, stadium: StadiumId, weather: Weather, time: number, pan: number, events: BackdropEvents) {
  if (events.goalFlash > lastFlash + 0.5) goalAt = time;
  lastFlash = events.goalFlash;
  const since = time - goalAt, reduced = !!events.reduced, drop = events.drop ?? 0, ox = -40 - pan * 0.3;
  if (stadium === "pro") drawProFx(c, weather, time, ox, since, reduced, events);
  else if (stadium === "champions") drawChampionsFx(c, time, pan, ox, since, reduced, drop, events);
}

function drawProFx(c: CanvasRenderingContext2D, weather: Weather, time: number, ox: number, since: number, reduced: boolean, events: BackdropEvents) {
  // Ribbon 1 (balcony) and ribbon 2 (below the boxes).
  const goal = since >= 0 && since < 3;
  const flip = !reduced && Math.floor(since * 5) % 2 === 1, shift = reduced ? 0 : (time * 40) % 40;
  if (goal) { for (let x = -shift; x < W; x += 20) { c.fillStyle = (Math.round((x + shift) / 20) % 2 === 0) !== flip ? "#c6ff1a" : "#ff2e6e"; c.fillRect(Math.round(x), 6, 20, 4); } }
  else c.drawImage(ribbonStrip("idle"), ((reduced ? 0 : time * 24) % 12), 0, LAYER_W, 4, ox, 6, LAYER_W, 4);
  if (goal) c.drawImage(ribbonStrip(flip ? "goal-b" : "goal-a"), 0, 0, W + 40, 7, shift - 40, 26, W + 40, 7);
  else marquee(c, events.jumbotron || "PRO LEAGUE NIGHT · PENALTY KINGS · FLOODLIT BOWL", 0, 32, W, time, "#c6ff1a");
  // Gantry tally lights (on air).
  c.fillStyle = reduced || Math.floor(time * 2) % 2 ? "#ff3040" : "#5a1018";
  for (const cx of [362, 386, 410]) c.fillRect(ox + cx + 7, 8, 1, 1);
  // Coloured smoke from the ultras end (heavier for a few seconds after a goal).
  const puffs = goal ? 18 : 11, colours = ["rgba(255,46,110,0.8)", "rgba(41,224,255,0.65)", "rgba(198,255,26,0.6)"] as const, rate = reduced ? 0.04 : 0.12;
  for (let i = 0; i < puffs; i++) {
    const age = (time * rate + i / puffs + hash01(i + 5) * 0.3) % 1, r = 9 + age * 26;
    const x = ox + PRO_TIFO.x + hash01(i + 17) * PRO_TIFO.w + age * 24 + Math.sin(time * 0.8 + i) * 3, y = 88 - age * 70;
    c.globalAlpha = Math.min(1, age * 6) * (1 - age); c.drawImage(puff(colours[i % 3]), x - r, y - r, r * 2, r * 2);
  }
  // Bengal flares burn in the ultras end after a goal.
  if (goal) for (let k = 0; k < 4; k++) {
    const fx = ox + PRO_TIFO.x + 12 + k * 26, flick = reduced ? 1 : 0.7 + 0.3 * Math.sin(time * 37 + k * 2);
    c.globalAlpha = 0.35 * flick; c.drawImage(puff("rgba(255,60,40,0.9)"), fx - 12, 74, 24, 24);
    c.globalAlpha = 1; c.fillStyle = "#fff0e0"; c.fillRect(fx - 1, 83, 2, 2); c.fillStyle = "#ff3a28"; c.fillRect(fx - 1, 85, 2, 3);
  }
  c.globalAlpha = 1;
  // Haze beams and drizzle in the light (heavier in rain).
  c.drawImage(proHaze(), ox, -SKY_TOP);
  if (!reduced) {
    const drops = weather === "rain" ? 70 : 32;
    c.fillStyle = "rgba(210,232,255,0.45)";
    for (let i = 0; i < drops; i++) {
      const cone = PRO_CONES[i % 4], y = ((time * 150 + hash01(i + 900) * 140) % 140) - 40, spread = 18 + (y + 40) * 0.37;
      c.fillRect(Math.round(ox + cone + (hash01(i + 300) * 2 - 1) * spread + y * 0.12), Math.round(y), 1, 3);
    }
  }
}

function drawChampionsFx(c: CanvasRenderingContext2D, time: number, pan: number, ox: number, since: number, reduced: boolean, drop: number, events: BackdropEvents) {
  // Firework finale in the night sky over the arena (never under reduced motion).
  if (!reduced && since >= 0.4 && since < 6) drawFireworks(c, since - 0.4, drop);
  // The 4-sided centre-hung jumbotron: centred under the HUD in the penalty view; to the left
  // of the goal, below the HUD, in the free-kick view (where the upper tiers are off-screen).
  const jx = Math.round((drop ? W / 2 : 62) - pan * 0.3), jy = drop ? 40 - drop : 44;
  c.fillStyle = "#4a340c"; c.fillRect(jx - 28, jy - 60, 1, 57); c.fillRect(jx + 27, jy - 60, 1, 57);
  c.fillStyle = "#1a1206"; c.beginPath(); c.moveTo(jx - 35, jy); c.lineTo(jx - 45, jy + 3); c.lineTo(jx - 45, jy + 27); c.lineTo(jx - 35, jy + 30); c.fill();
  c.beginPath(); c.moveTo(jx + 35, jy); c.lineTo(jx + 45, jy + 3); c.lineTo(jx + 45, jy + 27); c.lineTo(jx + 35, jy + 30); c.fill();
  const goal = since >= 0 && since < 5;
  const sideLit = goal ? (!reduced && Math.floor(since * 6) % 2 ? "#ffd23f" : "#b36bff") : "#3a1a5e";
  c.fillStyle = sideLit; for (let k = 0; k < 4; k++) { c.fillRect(jx - 43, jy + 5 + k * 6, 7, 3); c.fillRect(jx + 36, jy + 5 + k * 6, 7, 3); }
  if (goal && since > 1.6 && since < 3.2) drawReplay(c, jx - 35, jy, since - 1.6);
  else if (goal) c.drawImage(jumboFace(!reduced && Math.floor(since * 6) % 2 ? "goal-b" : "goal-a"), jx - 35, jy);
  else {
    c.drawImage(jumboFace("title"), jx - 35, jy);
    marquee(c, events.jumbotron || "CHAMPIONS NIGHT · LIVE FROM THE GOLDEN ARENA", jx - 33, jy + 25, 66, time, "#fff2b3");
  }
  c.fillStyle = "#ffcf3f"; c.fillRect(jx - 46, jy - 3, 92, 3); c.fillRect(jx - 46, jy + 30, 92, 3);
  c.fillStyle = "#fff2b3"; c.fillRect(jx - 46, jy - 3, 92, 1); c.fillStyle = "#8a6410"; c.fillRect(jx - 46, jy + 32, 92, 1);
  c.fillStyle = "#fff6d0"; for (let k = -42; k < 44; k += 6) c.fillRect(jx + k, jy + 31, 2, 1);
  // Pyro line: two volleys of flame jets on a goal.
  if (!reduced) for (const start of [0, 2.2]) {
    const t = since - start; if (t < 0 || t > 1.4) continue;
    const env = t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 1.3);
    c.fillStyle = `rgba(255,170,40,${0.12 * env})`; c.fillRect(0, 40, W, 48);
    for (let x = 12, k = 0; x < LAYER_W; x += 26, k++) {
      const h = Math.round((k % 2 ? 26 : 18) * env * (0.75 + 0.25 * Math.sin(time * 41 + k * 1.7))), px = Math.round(ox + x);
      if (h < 2 || px < -8 || px > W) continue;
      c.fillStyle = "#ff5a00"; c.fillRect(px, 86 - h, 6, h); c.fillStyle = "#ffb000"; c.fillRect(px + 1, 86 - Math.round(h * 0.8), 4, Math.round(h * 0.8)); c.fillStyle = "#fff6c0"; c.fillRect(px + 2, 86 - Math.round(h * 0.45), 2, Math.round(h * 0.45));
    }
  }
  // Confetti cannons (fewer pieces under reduced motion).
  if (since >= 0.15 && since < 5) drawCannonConfetti(c, ox, since - 0.15, time, reduced ? 16 : 64);
}

const FIREWORK_COLOURS = ["#ffd23f", "#fff6d8", "#b36bff", "#ff5ac8", "#7fe8ff"] as const;
/** Nine shells rise from the pyro line and burst over the stands (screen y 44–96 in both views). */
function drawFireworks(c: CanvasRenderingContext2D, t: number, drop: number) {
  for (let s = 0; s < 9; s++) {
    const t0 = s * 0.45, local = t - t0; if (local < 0 || local > 2) continue;
    const bx = 30 + hash01(s + 41) * (W - 60), by = 44 + hash01(s + 59) * 52 - drop, x0 = bx + (hash01(s + 3) - 0.5) * 40, colour = FIREWORK_COLOURS[s % FIREWORK_COLOURS.length];
    if (local < 0.5) { const p = local / 0.5, e = 1 - (1 - p) * (1 - p); c.fillStyle = "#fff2b3"; c.fillRect(Math.round(x0 + (bx - x0) * e), Math.round(86 + (by - 86) * e), 1, 3); continue; }
    const tau = local - 0.5, r = (26 + hash01(s + 7) * 18) * (1 - Math.exp(-4 * tau)), sag = 16 * tau * tau, fade = Math.max(0, 1 - tau / 1.5);
    c.globalAlpha = 0.5 * fade; c.drawImage(puff(colour), bx - r * 1.3, by - r * 1.3 + sag, r * 2.6, r * 2.6); // glow lights the stand behind
    c.globalAlpha = fade;
    if (tau < 0.08) { c.fillStyle = "#ffffff"; c.fillRect(Math.round(bx) - 2, Math.round(by) - 2, 5, 5); }
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + s, cx = Math.cos(a), cy = Math.sin(a);
      c.fillStyle = colour; c.fillRect(Math.round(bx + cx * r * 0.82), Math.round(by + cy * r * 0.82 + sag * 0.9), 2, 2); c.fillRect(Math.round(bx + cx * r * 0.64), Math.round(by + cy * r * 0.64 + sag * 0.8), 1, 1);
      c.fillStyle = "#ffffff"; c.fillRect(Math.round(bx + cx * r), Math.round(by + cy * r + sag), 2, 2);
    }
  }
  c.globalAlpha = 1;
}
const CONFETTI = ["#ffd23f", "#fff2b3", "#b36bff", "#ffffff", "#ff8c00"] as const;
function drawCannonConfetti(c: CanvasRenderingContext2D, ox: number, t: number, time: number, pieces: number) {
  const k = 2, g = 90, decay = (1 - Math.exp(-k * t)) / k;
  for (const [cx, dir] of [[64, 1], [496, -1]] as const) for (let i = 0; i < pieces; i++) {
    const vx = dir * (30 + hash01(i * 3 + cx) * 150), vy = -(110 + hash01(i * 5 + cx) * 130);
    const x = ox + cx + vx * decay + Math.sin(time * 7 + i) * 2, y = 74 + (vy + g / k) * decay - (g / k) * t;
    if (y > 230) continue;
    c.fillStyle = CONFETTI[i % CONFETTI.length];
    if (Math.floor(time * 10 + i) % 2) c.fillRect(Math.round(x), Math.round(y), 2, 1); else c.fillRect(Math.round(x), Math.round(y), 1, 2);
  }
}
/** A tiny replay on the jumbotron: the ball curls into the top corner past a diving keeper. */
function drawReplay(c: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const p = Math.min(1, (t % 0.8) / 0.6);
  c.fillStyle = "#1c5a24"; c.fillRect(x, y, 70, 30); c.fillStyle = "#23702c"; for (let k = 0; k < 30; k += 6) c.fillRect(x, y + k, 70, 3);
  c.fillStyle = "#ffffff"; c.fillRect(x + 20, y + 6, 30, 1); c.fillRect(x + 20, y + 6, 1, 12); c.fillRect(x + 49, y + 6, 1, 12);
  c.fillStyle = "#ff8c00"; c.fillRect(x + 33 + Math.round(p * 8), y + 12 - Math.round(p * 3), 4, 4);
  c.fillStyle = "#ffffff"; c.fillRect(Math.round(x + 35 + p * 10), Math.round(y + 26 - p * 18 - Math.sin(p * Math.PI) * 4), 2, 2);
  c.fillStyle = "#ff3040"; c.fillRect(x + 3, y + 3, 2, 2); c.fillStyle = "#fff2b3"; c.fillRect(x + 7, y + 3, 10, 2);
}

/** LED / wooden advertising boards with in-game jokes only. */
const BOARD_TEXT = ["PENALTY KINGS", "$GBOOT", "GOLDEN BOOT CUP", "KEEPERS HATE THIS ONE TRICK", "NO REFUNDS ON SHIN PADS", "TOP BINS MONTHLY", "NUTMEG INSURANCE CO.", "HALF-TIME ORANGES"];
export function drawBoards(c: CanvasRenderingContext2D, stadium: StadiumId, time: number, pan: number) {
  const y = 90;
  c.fillStyle = "#0b0d1a"; c.fillRect(0, y, W, 12);
  c.font = "8px PixelifySans, monospace"; c.textBaseline = "middle";
  const speed = stadium === "park" ? 14 : 26, offset = (time * speed + pan * 0.6) % 160;
  for (let i = -1; i < 5; i++) {
    const x = i * 160 - offset, text = BOARD_TEXT[(i + 16 + Math.floor((time * speed) / 160)) % BOARD_TEXT.length];
    if (stadium === "pro") { c.fillStyle = "#05070f"; c.fillRect(x + 1, y + 1, 158, 10); c.fillStyle = (Math.floor(time * 4) + i) % 2 ? "#c6ff1a" : "#29e0ff"; }
    else if (stadium === "champions") { c.fillStyle = "#120c04"; c.fillRect(x + 1, y + 1, 158, 10); c.fillStyle = "#d4a52a"; c.fillRect(x + 1, y + 1, 158, 1); c.fillRect(x + 1, y + 10, 158, 1); c.fillStyle = "#ffd23f"; }
    else { c.fillStyle = THEMES[stadium].boards[(i + 8) % THEMES[stadium].boards.length]; c.fillRect(x + 1, y + 1, 158, 10); c.fillStyle = "#0b0d1a"; }
    c.fillText(text, x + 6, y + 6.5);
  }
  c.textBaseline = "alphabetic";
}

/** Grass stripes and weather tint only; line markings come from the pitch cameras (setpieces.ts). */
export function drawPitch(c: CanvasRenderingContext2D, stadium: StadiumId, weather: Weather) {
  c.drawImage(layer(`pitch-${stadium}-${weather}`, p => {
    const theme = THEMES[stadium];
    let y = 102, band = 0;
    while (y < H) {
      const h = 7 + (y - 102) * 0.13; p.fillStyle = theme.grass[band % 2]; p.fillRect(0, y, W + 80, Math.ceil(h));
      // Champions: a cross-mown chequerboard converging on the goal.
      if (stadium === "champions") { p.fillStyle = "rgba(255,255,255,0.05)"; for (let k = -14 + (band % 2); k < 14; k += 2) { const at = (yy: number, kk: number) => 240 + kk * 22 * (0.4 + (yy - 102) * 0.012); p.beginPath(); p.moveTo(at(y, k), y); p.lineTo(at(y, k + 1), y); p.lineTo(at(y + h, k + 1), y + h); p.lineTo(at(y + h, k), y + h); p.fill(); } }
      y += h; band++;
    }
    if (weather === "snow") { p.fillStyle = "#ffffff55"; for (let i = 0; i < 400; i++) p.fillRect(Math.floor(hash01(i) * W), 102 + Math.floor(hash01(i + 999) * 218), 2, 1); }
    if (weather === "rain") { p.fillStyle = "#9fd3ff55"; for (let i = 0; i < 6; i++) { const px = 40 + hash01(i * 7) * 400, py = 200 + hash01(i * 13) * 100; p.beginPath(); p.ellipse(px, py, 16, 4, 0, 0, Math.PI * 2); p.fill(); } }
    if (stadium === "park") { p.fillStyle = "#6d8f5a"; for (let i = 0; i < 3; i++) { const px = 60 + i * 170, py = 280 + (i % 2) * 14; p.beginPath(); p.ellipse(px, py, 14, 3, 0, 0, Math.PI * 2); p.fill(); } }
    if (stadium === "pro") {
      // Rain sheen under the lights: specular pools below each beam and streaked lamp reflections.
      const wet = weather === "rain" ? 1.6 : 1;
      for (const cone of PRO_CONES) {
        const x = cone - 40, g = p.createRadialGradient(x, 116, 2, x, 116, 70); g.addColorStop(0, `rgba(215,236,255,${0.3 * wet})`); g.addColorStop(1, "rgba(215,236,255,0)");
        p.fillStyle = g; p.save(); p.translate(x, 116); p.scale(1, 0.22); p.translate(-x, -116); p.fillRect(x - 70, 46, 140, 140); p.restore();
      }
      // The LED boards and ribbon glow reflected in the wet grass just below them.
      for (let x = 0; x < W + 80; x += 4) { p.fillStyle = `rgba(${x % 16 < 8 ? "41,224,255" : "198,255,26"},${0.1 * wet})`; p.fillRect(x, 103, 3, 3 + Math.floor(hash01(x) * 8)); }
      p.fillStyle = `rgba(255,250,225,${0.08 * wet})`; for (let x = 3; x < W + 80; x += 9) p.fillRect(x + 2, 103, 1, 12 + Math.floor(hash01(x + 5) * 14));
    }
    // Markings are drawn in perspective by the Stage (drawPitchMarkings), never hand-placed here.
  }), 0, 0);
}

/** Per-stadium camera grade (cached): a colour wash plus a vignette, applied over the world layer. */
const GRADES: Readonly<Record<StadiumId, { wash: string; mode: GlobalCompositeOperation; vignette: string; strength: number }>> = {
  park: { wash: "#fff4dc", mode: "multiply", vignette: "40,30,10", strength: 0.12 },
  pro: { wash: "#d8e4ff", mode: "multiply", vignette: "0,4,20", strength: 0.38 },
  champions: { wash: "#ffe9bf", mode: "multiply", vignette: "26,10,0", strength: 0.34 },
};
const gradeLayer = (stadium: StadiumId) => layer(`grade-${stadium}`, g => {
  const grade = GRADES[stadium], v = g.createRadialGradient(W / 2, H * 0.46, H * 0.35, W / 2, H * 0.46, W * 0.62);
  v.addColorStop(0, `rgba(${grade.vignette},0)`); v.addColorStop(1, `rgba(${grade.vignette},${grade.strength})`);
  g.fillStyle = v; g.fillRect(0, 0, W, H);
}, W, H);
export function drawCameraGrade(c: CanvasRenderingContext2D, stadium: StadiumId) {
  const grade = GRADES[stadium];
  c.save(); c.globalCompositeOperation = grade.mode; c.fillStyle = grade.wash; c.fillRect(-60, -60, W + 120, H + 120); c.restore();
  c.drawImage(gradeLayer(stadium), -20, -20, W + 40, H + 40);
}

/** Heat shimmer (streak ×2+) and weather overlays, then the stadium's camera grade. */
export function drawWeather(c: CanvasRenderingContext2D, weather: Weather, stadium: StadiumId, time: number, particles: Particles, dt: number, reduced: boolean) {
  if (weather === "rain" && !reduced) { if (Math.random() < 0.9) particles.emit("rain", Math.random() * W, -4, 3, { color: "#b8dcff", speed: 220, angle: Math.PI / 2 + 0.15, spread: 0.05, life: 1.4, gravity: 0, drag: 0 }); }
  if (weather === "snow") { if (Math.random() < (reduced ? 0.2 : 0.7)) particles.emit("snow", Math.random() * W, -4, 1, { color: "#ffffff", speed: 20, angle: Math.PI / 2, spread: 0.8, life: 9, gravity: 4, drag: 0.1, size: 2 }); }
  if (weather === "fog") { c.fillStyle = "#c7ccd2"; for (let i = 0; i < 4; i++) { c.globalAlpha = 0.12; c.fillRect(Math.round(((time * 8 + i * 150) % (W + 200)) - 100), 60 + i * 30, 220, 30); } c.globalAlpha = 1; }
  if (weather === "sunset") { c.fillStyle = "#ff7e5f"; c.globalAlpha = stadium === "park" ? 0.08 : 0.04; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
  drawCameraGrade(c, stadium);
  void dt;
}

export function drawHeatShimmer(c: CanvasRenderingContext2D, intensity: number, time: number) {
  if (intensity <= 0) return;
  c.globalAlpha = 0.08 * intensity;
  c.fillStyle = "#ff8c00";
  for (let y = 180; y < H; y += 6) c.fillRect(Math.round(Math.sin(time * 9 + y * 0.3) * 3 * intensity), y, W, 2);
  c.globalAlpha = 1;
}

/** Goal frame (drawn in front of the keeper). `vibrate` animates a post hit. */
export function drawGoalFrame(c: CanvasRenderingContext2D, vibrate: number, time: number) {
  const { left, right, bar, line } = GOAL, wob = vibrate > 0 ? Math.round(Math.sin(time * 90) * 2 * vibrate) : 0;
  c.fillStyle = "#ffffff";
  c.fillRect(left - 3 + wob, bar - 3, 3, line - bar + 3);
  c.fillRect(right - wob, bar - 3, 3, line - bar + 3);
  c.fillRect(left - 3, bar - 3 + wob, right - left + 6, 3);
  c.fillStyle = "#c9ced6"; c.fillRect(left - 1 + wob, bar, 1, line - bar); c.fillRect(right + 2 - wob, bar, 1, line - bar);
}
