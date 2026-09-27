/**
 * Crowd: 22 original spectator types, palette-swapped per seat so rows never tile.
 * Each type reacts differently to goals, saves and near-misses; a Mexican wave runs on streaks.
 * Rendered into a cached layer at 15 fps (pixel-art cadence, cheap on phones).
 */
import { W, hash01, type Particles } from "./core.js";
import type { StadiumId } from "./stadium.js";

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

export class Crowd {
  private seats: Seat[] = [];
  private buffer = document.createElement("canvas");
  private tick = 0; private since = 1;
  mood: CrowdMood = "idle"; moodTime = 0; wave = 0; chant = 0;
  catX = -40; catActive = false;
  constructor(public stadium: StadiumId) {
    this.buffer.width = W + 80; this.buffer.height = 100;
    const rows = stadium === "park" ? [68, 76, 84] : [28, 35, 42, 49, 56, 63, 70, 77, 84];
    let n = 0;
    rows.forEach((y, r) => {
      for (let x = 2 + (r % 2) * 3; x < W + 78; x += 7) {
        const h = hash01(n * 31 + r * 7 + (stadium === "pro" ? 1000 : stadium === "champions" ? 2000 : 0));
        const typeIndex = h < 0.55 ? 0 : 1 + Math.floor(hash01(n * 17 + 3) * (CROWD_TYPES.length - 1));
        const shirts = SHIRTS[stadium];
        this.seats.push({ x, y, type: CROWD_TYPES[typeIndex], skin: SKIN[Math.floor(hash01(n + 11) * SKIN.length)], hair: HAIR[Math.floor(hash01(n + 23) * HAIR.length)],
          shirt: shirts[Math.floor(hash01(n + 37) * shirts.length)], accent: shirts[Math.floor(hash01(n + 53) * shirts.length)], phase: hash01(n + 71) * 6.28, seed: n });
        n++;
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
    c.drawImage(this.buffer, -40 - pan * 0.5, 0);
  }

  private paint(time: number, particles: Particles, reduced: boolean) {
    const b = this.buffer.getContext("2d")!;
    b.clearRect(0, 0, this.buffer.width, this.buffer.height);
    const mood = this.mood, t = this.moodTime;
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
        case "confetti-thrower": if (mood === "cheer" && t < 0.3) particles.emit("confetti", x - 40 - 0, y, 2, { color: ["#ffd23f", "#ff5a6e", "#7fd3ff", "#ccff00"], speed: 40, gravity: 60, life: 2 }); b.fillStyle = s.accent; b.fillRect(x + 5, y + 2, 2, 2); break;
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
