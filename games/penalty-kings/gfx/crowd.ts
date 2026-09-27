/**
 * Crowd: 22 original spectator types, palette-swapped per seat so rows never tile.
 * Each type reacts differently to goals, saves and near-misses; a Mexican wave runs on streaks.
 * Rendered into a cached layer at 15 fps (pixel-art cadence, cheap on phones); the far upper tiers
 * of Pro and Champions are four pre-rendered frames (idle ×2, cheer ×2) blitted in one draw.
 */
import { W, hash01, type Particles } from "./core.js";
import { CROWD_HOLES, CHAMPIONS_MOSAIC, type StadiumId } from "./stadium.js";

export const CROWD_TYPES = [
  "fan", "drummer", "flag-waver", "kid on shoulders", "grumpy pundit", "confetti-thrower", "sleeper", "phone filmer",
  "foam finger", "mascot", "trumpeter", "nan knitting", "scarf-twirler", "face-painted fan", "twins", "hot-dog dad",
  "streamer", "balloon kid", "mega-fan", "photographer", "ref critic", "superfan in a bucket hat",
] as const;
export type CrowdType = typeof CROWD_TYPES[number];
export type CrowdMood = "idle" | "cheer" | "groan" | "ooh" | "tense";

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

export class Crowd {
  private seats: Seat[] = [];
  private buffer = document.createElement("canvas");
  private tick = 0; private since = 1;
  mood: CrowdMood = "idle"; moodTime = 0; wave = 0; chant = 0;
  catX = -40; catActive = false;
  constructor(public stadium: StadiumId) {
    this.buffer.width = W + 80; this.buffer.height = TOP + 100;
    const { rows, step, empty } = LAYOUTS[stadium], holes = CROWD_HOLES[stadium];
    let n = 0;
    rows.forEach((y, r) => {
      for (let x = 2 + (r % 2) * Math.floor(step / 2); x < W + 78; x += step) {
        n++;
        if (hash01(n * 13 + 5) < empty || holes.some(hole => x + 6 > hole.x && x < hole.x + hole.w && y + 7 > hole.y && y - 1 < hole.y + hole.h)) continue;
        const h = hash01(n * 31 + r * 7 + (stadium === "pro" ? 1000 : stadium === "champions" ? 2000 : 0));
        const typeIndex = h < 0.55 ? 0 : 1 + Math.floor(hash01(n * 17 + 3) * (CROWD_TYPES.length - 1));
        const shirts = SHIRTS[stadium];
        this.seats.push({ x, y: y + TOP, type: CROWD_TYPES[typeIndex], skin: SKIN[Math.floor(hash01(n + 11) * SKIN.length)], hair: HAIR[Math.floor(hash01(n + 23) * HAIR.length)],
          shirt: shirts[Math.floor(hash01(n + 37) * shirts.length)], accent: shirts[Math.floor(hash01(n + 53) * shirts.length)], phase: hash01(n + 71) * 6.28, seed: n });
      }
    });
  }
  react(mood: CrowdMood) { this.mood = mood; this.moodTime = 0; this.since = 1; }
  update(dt: number) { this.moodTime += dt; this.tick += dt; if (this.mood !== "idle" && this.mood !== "tense" && this.moodTime > 3.2) this.mood = "idle"; if (this.wave > 0) this.wave += dt; if (this.wave > 4.5) this.wave = 0; }
  startWave() { this.wave = 0.001; }
  /** Wind (m/s, + blows to the right): flag-wavers' flags stream with it. */
  wind = 0;

  /** Draw at 15 fps into the cached layer, then blit with parallax. Emits confetti for throwers. */
  draw(c: CanvasRenderingContext2D, time: number, pan: number, particles: Particles, reduced: boolean) {
    this.since += 1 / 60;
    if (this.since >= 1 / 15 || this.tick === 0) { this.since = 0; this.paint(time, particles, reduced); }
    c.drawImage(this.buffer, -40 - pan * 0.5, -TOP);
  }

  private paint(time: number, particles: Particles, reduced: boolean) {
    const b = this.buffer.getContext("2d")!;
    b.clearRect(0, 0, this.buffer.width, this.buffer.height);
    const mood = this.mood, t = this.moodTime, layout = LAYOUTS[this.stadium];
    if (layout.far) {
      const cheering = mood === "cheer" || this.wave > 0;
      b.drawImage(farFrame(this.stadium, cheering ? (reduced ? 2 : 2 + (Math.floor(time * 7) % 2)) : reduced ? 0 : Math.floor(time * 1.5) % 2), 0, 0);
      // Phone torches twinkle across the Champions upper tier.
      if (!reduced && this.stadium === "champions") { b.fillStyle = "#fffbe6"; for (let k = 0; k < 10; k++) b.fillRect(Math.floor(Math.random() * (W + 80)), TOP + layout.far.top + Math.floor(Math.random() * (layout.far.bottom - layout.far.top)), 1, 1); }
    }
    if (this.stadium === "champions") {
      // Card mosaic: on a goal the cards flip in a wave sweeping across the stand.
      const m = CHAMPIONS_MOSAIC, x = m.x, y = m.y + TOP;
      if (mood === "cheer" && !reduced && t < 2.6) for (let col = 0; col < 66; col++) b.drawImage(mosaic(t * 40 > col && Math.floor((t * 40 - col) / 22) % 2 === 0), col * 3, 0, 3, m.h, x + col * 3, y, 3, m.h);
      else b.drawImage(mosaic(false), x, y);
      b.fillStyle = "#e0ac69"; for (let k = 4; k < m.w; k += 9) b.fillRect(x + k, y - 1, 2, 1); // the hands holding the top row up
    }
    for (const s of this.seats) {
      const waveUp = this.wave > 0 ? Math.max(0, 1 - Math.abs((s.x / (W + 80)) * 4 - (this.wave - 0.3)) * 2) : 0;
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
          const strength = Math.min(1, Math.abs(this.wind) / 5), dir = this.wind < 0 ? -1 : 1, len = 5 + Math.round(strength * 3);
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
