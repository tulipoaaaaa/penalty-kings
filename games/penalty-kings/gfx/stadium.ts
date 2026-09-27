/**
 * Stadium backdrops (Park / Pro / Champions), weather, pitch and goal frame.
 * Static layers are painted once into cached canvases; animated details are drawn per frame.
 */
import { W, H, hash01, type Particles } from "./core.js";

export type StadiumId = "park" | "pro" | "champions";
export type Weather = "sun" | "rain" | "snow" | "fog" | "sunset";
export const GOAL = { left: 150, right: 330, bar: 96, line: 176, unit: 90, cx: 240 } as const;
export const SPOT = { x: 240, y: 254 } as const;
export const toScreen = (gx: number, gy: number) => ({ x: GOAL.cx + gx * GOAL.unit, y: GOAL.line - gy * GOAL.unit * 0.89 });

export type StadiumTheme = { sky: [string, string]; grass: [string, string]; stands: string; standLine: string; boards: string[]; confetti: string[]; lines: string; label: string };
export const THEMES: Readonly<Record<StadiumId, StadiumTheme>> = {
  park: { sky: ["#7ec8ff", "#d4f0ff"], grass: ["#4caf50", "#43a047"], stands: "#8d6e63", standLine: "#6d4c41", boards: ["#ffd23f", "#ff8fab", "#7fd3ff"], confetti: ["#ffd23f", "#ff8fab", "#7fd3ff", "#ffffff"], lines: "#f1fff0", label: "PARK · Sunday League" },
  pro: { sky: ["#0b1030", "#1c2a5c"], grass: ["#2e7d32", "#276b2b"], stands: "#1e2340", standLine: "#2f3563", boards: ["#0b0d1a"], confetti: ["#ccff00", "#ff5a6e", "#7fd3ff", "#ffffff"], lines: "#e9f5e1", label: "PRO · Floodlit Night" },
  champions: { sky: ["#1a0f00", "#3d2600"], grass: ["#3b8f3f", "#327a36"], stands: "#2a1a05", standLine: "#4a3310", boards: ["#ffd23f", "#b8860b"], confetti: ["#ffd23f", "#fff2b3", "#ff8c00", "#ffffff"], lines: "#fff6d8", label: "CHAMPIONS · Golden Arena" },
};

/** Weather by UTC weekday unless overridden: Sun sun, Mon rain, Tue sun, Wed fog, Thu sun, Fri sunset, Sat snow. */
export const weatherForDay = (day = new Date().getUTCDay()): Weather => (["sun", "rain", "sun", "fog", "sun", "sunset", "snow"] as const)[day];

const cache = new Map<string, HTMLCanvasElement>();
function layer(key: string, paint: (c: CanvasRenderingContext2D) => void) {
  let canvas = cache.get(key);
  if (!canvas) { canvas = document.createElement("canvas"); canvas.width = W + 80; canvas.height = H; paint(canvas.getContext("2d")!); cache.set(key, canvas); }
  return canvas;
}

/** Far background: sky + stands structure (parallax 0.3). */
function paintBackdrop(stadium: StadiumId, weather: Weather) {
  return layer(`backdrop-${stadium}-${weather}`, c => {
    const theme = THEMES[stadium], sky = c.createLinearGradient(0, 0, 0, 90);
    const [top, bottom] = weather === "sunset" && stadium === "park" ? ["#ff7e5f", "#feb47b"] : weather === "fog" ? ["#9aa3ad", "#c7ccd2"] : theme.sky;
    sky.addColorStop(0, top); sky.addColorStop(1, bottom);
    c.fillStyle = sky; c.fillRect(0, 0, W + 80, 90);
    if (stadium === "park") {
      // Distant trees and a hill.
      c.fillStyle = "#6fbf73"; c.beginPath(); c.ellipse(120, 92, 180, 30, 0, Math.PI, 0); c.fill();
      c.fillStyle = "#3e8e41"; for (let i = 0; i < 22; i++) { const x = i * 26 + (i % 3) * 5; c.beginPath(); c.arc(x, 72 + (i % 2) * 4, 10 + (i % 3) * 3, 0, Math.PI * 2); c.fill(); }
      // Wooden bench stands.
      c.fillStyle = theme.stands; c.fillRect(0, 60, W + 80, 30);
      c.fillStyle = theme.standLine; for (let y = 64; y < 90; y += 8) c.fillRect(0, y, W + 80, 2);
    } else {
      c.fillStyle = theme.stands; c.beginPath(); c.moveTo(0, 18); c.lineTo(W + 80, 18); c.lineTo(W + 80, 92); c.lineTo(0, 92); c.fill();
      c.fillStyle = theme.standLine; for (let y = 22; y < 92; y += 7) c.fillRect(0, y, W + 80, 1);
      // Roof edge.
      c.fillStyle = stadium === "pro" ? "#0d1022" : "#1a1003"; c.fillRect(0, 10, W + 80, 9);
      if (stadium === "champions") { c.fillStyle = "#ffd23f"; c.fillRect(0, 18, W + 80, 1); }
    }
  });
}

/** Draws sky + stands + animated stadium props. `pan` shifts the parallax. */
/** Scrolling LED text inside a screen rectangle (the jumbotron). */
function marquee(c: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, time: number, color: string) {
  c.save(); c.beginPath(); c.rect(x, y - 8, w, 12); c.clip();
  c.fillStyle = color; c.font = "8px PixelifySans, monospace";
  const width = text.length * 5 + 40, offset = (time * 30) % width;
  c.fillText(text, x + w - offset, y); c.fillText(text, x + w - offset + width, y);
  c.restore();
}

export function drawBackdrop(c: CanvasRenderingContext2D, stadium: StadiumId, weather: Weather, time: number, pan: number, events: { goalFlash: number; jumbotron?: string }) {
  c.drawImage(paintBackdrop(stadium, weather), -40 - pan * 0.3, 0);
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
    // Wooden scoreboard frame lives in the HUD layer (drawScoreboard).
  } else if (stadium === "pro") {
    // Floodlight towers with glow cones and moths.
    for (const fx of [40, 440]) {
      const x = fx - pan * 0.3;
      c.fillStyle = "#222844"; c.fillRect(x - 1, 0, 3, 18); c.fillStyle = "#fff6c8"; c.fillRect(x - 7, 0, 15, 5);
      const cone = c.createRadialGradient(x, 4, 2, x, 4, 150); cone.addColorStop(0, "#fff6c855"); cone.addColorStop(1, "#fff6c800");
      c.fillStyle = cone; c.beginPath(); c.moveTo(x - 6, 4); c.lineTo(x + (fx < 200 ? 200 : -200), 220); c.lineTo(x + (fx < 200 ? 60 : -60), 220); c.fill();
      c.fillStyle = "#fff6c8"; for (let m = 0; m < 5; m++) c.fillRect(Math.round(x + Math.sin(time * 3 + m * 2) * 9), Math.round(8 + Math.cos(time * 4 + m) * 5), 1, 1);
    }
    // Jumbotron (pot, top prize, rank, last big pull — fed by game/prizes.ts).
    const jx = 64 - pan * 0.3;
    c.fillStyle = "#222844"; c.fillRect(jx, 20, 104, 26); c.fillStyle = events.goalFlash > 0 ? "#ccff00" : "#0b0d1a"; c.fillRect(jx + 2, 22, 100, 22);
    if (events.jumbotron) marquee(c, events.jumbotron, jx + 3, 36, 98, time, events.goalFlash > 0 ? "#0b0d1a" : "#ccff00");
  } else {
    // Giant screen with a live "replay" frame and a trophy on a plinth.
    const sx = 330 - pan * 0.3;
    c.fillStyle = "#222"; c.fillRect(sx, 22, 96, 44); c.fillStyle = "#0b0d1a"; c.fillRect(sx + 3, 25, 90, 38);
    c.fillStyle = events.goalFlash > 0 ? "#ffd23f" : "#1c2a5c"; c.fillRect(sx + 4, 26, 88, 36);
    if (events.goalFlash > 0 || !events.jumbotron) { c.fillStyle = "#ffffff"; c.font = "8px PixelifySans, monospace"; c.fillText(events.goalFlash > 0 ? "GOAL! GOAL!" : "PENALTY KINGS", sx + 12, 48); }
    else marquee(c, events.jumbotron, sx + 5, 48, 86, time, "#ffd23f");
    const tx = 60 - pan * 0.3;
    c.fillStyle = "#6d4c1a"; c.fillRect(tx, 70, 20, 20); c.fillStyle = "#ffd23f"; c.fillRect(tx + 6, 52, 8, 14); c.fillRect(tx + 3, 52, 14, 3); c.fillRect(tx + 8, 66, 4, 4);
    c.fillStyle = "#fff2b3"; c.fillRect(tx + 7, 54, 2, 6);
  }
}

/** LED / wooden advertising boards with in-game jokes only. */
const BOARD_TEXT = ["PENALTY KINGS", "$GBOOT", "GOLDEN BOOT CUP", "KEEPERS HATE THIS ONE TRICK", "NO REFUNDS ON SHIN PADS", "TOP BINS MONTHLY", "NUTMEG INSURANCE CO.", "HALF-TIME ORANGES"];
export function drawBoards(c: CanvasRenderingContext2D, stadium: StadiumId, time: number, pan: number) {
  const y = 90;
  c.fillStyle = "#0b0d1a"; c.fillRect(0, y, W, 12);
  c.font = "8px PixelifySans, monospace"; c.textBaseline = "middle";
  const speed = stadium === "pro" ? 26 : 14, offset = (time * speed + pan * 0.6) % 160;
  for (let i = -1; i < 5; i++) {
    const x = i * 160 - offset, text = BOARD_TEXT[(i + 16 + Math.floor((time * speed) / 160)) % BOARD_TEXT.length];
    if (stadium === "pro") { c.fillStyle = "#0b0d1a"; c.fillRect(x + 1, y + 1, 158, 10); c.fillStyle = (Math.floor(time * 4) + i) % 2 ? "#ccff00" : "#7fd3ff"; }
    else { c.fillStyle = THEMES[stadium].boards[(i + 8) % THEMES[stadium].boards.length]; c.fillRect(x + 1, y + 1, 158, 10); c.fillStyle = "#0b0d1a"; }
    c.fillText(text, x + 6, y + 6.5);
  }
  c.textBaseline = "alphabetic";
}

/** Grass stripes, markings and weather tint (painted once per stadium/weather). */
/** `markings: false` paints grass only (free kicks draw their own markings in perspective). */
export function drawPitch(c: CanvasRenderingContext2D, stadium: StadiumId, weather: Weather, markings = true) {
  c.drawImage(layer(`pitch-${stadium}-${weather}-${markings}`, p => {
    const theme = THEMES[stadium];
    let y = 102, band = 0;
    while (y < H) { const h = 7 + (y - 102) * 0.13; p.fillStyle = theme.grass[band % 2]; p.fillRect(0, y, W + 80, Math.ceil(h)); y += h; band++; }
    if (weather === "snow") { p.fillStyle = "#ffffff55"; for (let i = 0; i < 400; i++) p.fillRect(Math.floor(hash01(i) * W), 102 + Math.floor(hash01(i + 999) * 218), 2, 1); }
    if (weather === "rain") { p.fillStyle = "#9fd3ff55"; for (let i = 0; i < 6; i++) { const px = 40 + hash01(i * 7) * 400, py = 200 + hash01(i * 13) * 100; p.beginPath(); p.ellipse(px, py, 16, 4, 0, 0, Math.PI * 2); p.fill(); } }
    if (stadium === "park") { p.fillStyle = "#6d8f5a"; for (let i = 0; i < 3; i++) { const px = 60 + i * 170, py = 280 + (i % 2) * 14; p.beginPath(); p.ellipse(px, py, 14, 3, 0, 0, Math.PI * 2); p.fill(); } }
    if (!markings) return;
    p.strokeStyle = theme.lines; p.lineWidth = 1;
    const line = (x1: number, y1: number, x2: number, y2: number) => { p.beginPath(); p.moveTo(x1 + 0.5, y1 + 0.5); p.lineTo(x2 + 0.5, y2 + 0.5); p.stroke(); };
    line(0, GOAL.line, W, GOAL.line);
    line(118, GOAL.line, 104, 204); line(362, GOAL.line, 376, 204); line(104, 204, 376, 204);
    line(40, GOAL.line, -10, 244); line(440, GOAL.line, 490, 244); line(-10, 244, 490, 244);
    p.beginPath(); p.ellipse(240, 244, 50, 12, 0, 0, Math.PI); p.stroke();
    p.fillStyle = theme.lines; p.fillRect(SPOT.x - 2, SPOT.y + 3, 5, 2);
  }), 0, 0);
}

/** Heat shimmer (streak ×2+) and weather overlays. */
export function drawWeather(c: CanvasRenderingContext2D, weather: Weather, stadium: StadiumId, time: number, particles: Particles, dt: number, reduced: boolean) {
  if (weather === "rain" && !reduced) { if (Math.random() < 0.9) particles.emit("rain", Math.random() * W, -4, 3, { color: "#b8dcff", speed: 220, angle: Math.PI / 2 + 0.15, spread: 0.05, life: 1.4, gravity: 0, drag: 0 }); }
  if (weather === "snow") { if (Math.random() < (reduced ? 0.2 : 0.7)) particles.emit("snow", Math.random() * W, -4, 1, { color: "#ffffff", speed: 20, angle: Math.PI / 2, spread: 0.8, life: 9, gravity: 4, drag: 0.1, size: 2 }); }
  if (weather === "fog") { c.fillStyle = "#c7ccd2"; for (let i = 0; i < 4; i++) { c.globalAlpha = 0.12; c.fillRect(Math.round(((time * 8 + i * 150) % (W + 200)) - 100), 60 + i * 30, 220, 30); } c.globalAlpha = 1; }
  if (weather === "sunset") { c.fillStyle = "#ff7e5f"; c.globalAlpha = 0.08; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
  if (stadium === "pro" && weather !== "rain") { /* night: flare smoke puffs from the corners */ if (Math.random() < 0.05 && !reduced) particles.emit("smoke", Math.random() < 0.5 ? 12 : W - 12, 88, 1, { color: Math.random() < 0.5 ? "#ff5a6e" : "#7fd3ff", speed: 8, spread: 1, life: 3, gravity: -4, size: 4 }); }
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
