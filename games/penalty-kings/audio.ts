/**
 * Crowd and kick sounds synthesised in code (no samples). Muted by default and
 * only unlocked from a player gesture; the SDK sound kit covers UI cues.
 *
 * Ambience follows the stadium on screen (gfx/stadium.ts activeStadium, round 6 E22):
 *   PARK      a small murmur, birdsong between kicks;
 *   PRO       a big crowd bed, the ultras' drums, floodlight hum, rain hiss when it rains;
 *   CHAMPIONS a vast roar, a slow original anthem pad and rhythmic claps.
 * Goals add a horn (Pro) or firework booms (Champions) on top of the roar.
 */
import { activeStadium } from "./gfx/stadium.js";
import type { StadiumId, Weather } from "./gfx/stadium.js";

type Ambience = { stadium: StadiumId; weather: Weather; gain: GainNode; sources: AudioScheduledSourceNode[]; pad?: OscillatorNode[] };
/** Relative bed levels (under the shared ambience gain): Pro and Champions are bigger crowds. */
const LEVEL: Readonly<Record<StadiumId, number>> = { park: 0.8, pro: 1.3, champions: 1.6 };
const ANTHEM = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [4, 7, 12]] as const;

export function createCrowd() {
  let context: AudioContext | null = null, muted = true, noise: AudioBuffer | null = null;
  const ensure = () => {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
      noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
    }
    return context;
  };
  const burst = (duration: number, freq: number, gain: number, q = 0.7) => {
    if (muted || !context || !noise || context.state !== "running") return;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), amp = context.createGain();
    source.buffer = noise; source.loop = true;
    filter.type = "bandpass"; filter.frequency.value = freq; filter.Q.value = q;
    const now = context.currentTime;
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.25, duration * 0.2));
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(amp).connect(context.destination);
    source.start(now); source.stop(now + duration + 0.05);
  };
  let musicGain: GainNode | null = null, ambienceGain: GainNode | null = null, musicTimer = 0, ducked = 1, ambience: Ambience | null = null;
  const tone = (freq: number, duration: number, type: OscillatorType, gain: number, at = 0) => {
    if (muted || !context || context.state !== "running") return;
    const osc = context.createOscillator(), amp = context.createGain(), now = context.currentTime + at;
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    amp.gain.setValueAtTime(0.0001, now); amp.gain.exponentialRampToValueAtTime(gain, now + 0.01); amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp).connect(context.destination); osc.start(now); osc.stop(now + duration + 0.02);
  };
  /** Ducking: music and ambience dip under big moments (reveals, commentary, goals). */
  const duck = (amount: number, seconds: number) => {
    if (!context || !musicGain || !ambienceGain) return;
    const now = context.currentTime; ducked = amount;
    for (const [node, level] of [[musicGain, 0.035], [ambienceGain, 0.05]] as const) {
      node.gain.cancelScheduledValues(now); node.gain.setTargetAtTime(level * amount, now, 0.05); node.gain.setTargetAtTime(level, now + seconds, 0.4);
    }
  };
  /** A looping filtered-noise bed into `out`. */
  const bed = (out: AudioNode, type: BiquadFilterType, freq: number, gain: number, q = 0.7) => {
    const ctx = context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = noise; source.loop = true; filter.type = type; filter.frequency.value = freq; filter.Q.value = q; amp.gain.value = gain;
    source.connect(filter).connect(amp).connect(out); source.start(ctx.currentTime, Math.random() * 1.5);
    return source;
  };
  /** A one-shot filtered-noise hit (drum, clap, boom) into `out`, `at` seconds from now. */
  const hit = (out: AudioNode, freq: number, gain: number, duration: number, type: BiquadFilterType = "bandpass", at = 0) => {
    const ctx = context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain(), now = ctx.currentTime + at;
    source.buffer = noise; filter.type = type; filter.frequency.value = freq; filter.Q.value = type === "bandpass" ? 1.2 : 0.7;
    amp.gain.setValueAtTime(gain, now); amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(amp).connect(out); source.start(now, Math.random() * 1.5); source.stop(now + duration + 0.02);
  };
  const chirp = (out: AudioNode, from: number, to: number, at: number) => {
    const ctx = context!, osc = ctx.createOscillator(), amp = ctx.createGain(), now = ctx.currentTime + at;
    osc.type = "sine"; osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(to, now + 0.07);
    amp.gain.setValueAtTime(0.0001, now); amp.gain.exponentialRampToValueAtTime(0.25, now + 0.015); amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(amp).connect(out); osc.start(now); osc.stop(now + 0.1);
  };
  /** Build the stadium's ambience graph (it fades in; the previous one is retired). */
  const buildAmbience = (stadium: StadiumId, weather: Weather): Ambience | null => {
    if (!context || !ambienceGain || !noise) return null;
    const gain = context.createGain(), sources: AudioScheduledSourceNode[] = [], now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now); gain.gain.setTargetAtTime(muted ? 0 : LEVEL[stadium], now, 0.6); gain.connect(ambienceGain);
    let pad: OscillatorNode[] | undefined;
    if (stadium === "park") sources.push(bed(gain, "lowpass", 600, 0.8));
    else if (stadium === "pro") {
      sources.push(bed(gain, "bandpass", 480, 1.1, 0.5), bed(gain, "bandpass", 1800, 0.25, 0.8));
      const hum = context.createOscillator(), humFilter = context.createBiquadFilter(), humGain = context.createGain();
      hum.type = "sawtooth"; hum.frequency.value = 100; humFilter.type = "lowpass"; humFilter.frequency.value = 260; humGain.gain.value = 0.05;
      hum.connect(humFilter).connect(humGain).connect(gain); hum.start(); sources.push(hum);
      if (weather === "rain") sources.push(bed(gain, "highpass", 4200, 0.35));
    } else {
      sources.push(bed(gain, "lowpass", 950, 1.0), bed(gain, "bandpass", 300, 0.6, 0.5), bed(gain, "bandpass", 2600, 0.12, 0.6));
      const padGain = context.createGain(); padGain.gain.value = 0.06; padGain.connect(gain);
      pad = ANTHEM[0].map(step => { const osc = context!.createOscillator(); osc.type = "triangle"; osc.frequency.value = 110 * 2 ** (step / 12); osc.connect(padGain); osc.start(); return osc; });
      sources.push(...pad);
    }
    return { stadium, weather, gain, sources, pad };
  };
  const retire = (old: Ambience) => {
    if (!context) return;
    old.gain.gain.cancelScheduledValues(context.currentTime); old.gain.gain.setTargetAtTime(0, context.currentTime, 0.4);
    for (const source of old.sources) try { source.stop(context.currentTime + 2); } catch { /* already stopped */ }
  };
  /** Every music step (180 ms): follow the stadium on screen, honour mute, play the rhythmic parts. */
  const ambienceStep = (step: number) => {
    if (!context) return;
    const want = activeStadium();
    if (!ambience || ambience.stadium !== want.stadium || (want.stadium === "pro" && ambience.weather !== want.weather)) { if (ambience) retire(ambience); ambience = buildAmbience(want.stadium, want.weather); }
    if (!ambience) return;
    ambience.gain.gain.setTargetAtTime(muted ? 0 : LEVEL[ambience.stadium], context.currentTime, 0.15);
    if (muted || context.state !== "running") return;
    const out = ambience.gain, beat = step % 16;
    if (ambience.stadium === "park") { if (Math.random() < 0.05) { const f = 2400 + Math.random() * 1600; [0, 0.11, 0.22].slice(0, 2 + Math.floor(Math.random() * 2)).forEach(at => chirp(out, f, f * 1.3, at)); } }
    else if (ambience.stadium === "pro") {
      // The ultras' drums: a steady, original two-bar pattern.
      if ([0, 3, 4, 6, 8, 11, 12, 14].includes(beat)) hit(out, beat % 4 === 0 ? 90 : 140, beat % 4 === 0 ? 0.9 : 0.5, 0.16);
    } else {
      // Claps ("clap clap · clap clap clap") every other bar; the anthem pad changes chord each bar.
      if ([0, 2, 8, 10, 12].includes(beat) && Math.floor(step / 16) % 2 === 1) hit(out, 1800, 0.55, 0.07, "highpass");
      if (beat === 0 && ambience.pad) { const chord = ANTHEM[Math.floor(step / 16) % ANTHEM.length]; ambience.pad.forEach((osc, i) => osc.frequency.setTargetAtTime(110 * 2 ** (chord[i] / 12), context!.currentTime, 0.4)); }
    }
  };
  // A four-bar chiptune loop (original): bass + arpeggio, very quiet under the crowd.
  const NOTES = [0, 4, 7, 12, 5, 9, 12, 17, 7, 11, 14, 19, 5, 9, 12, 16];
  const startMusic = () => {
    if (!context || musicGain) return;
    musicGain = context.createGain(); musicGain.gain.value = 0.035; musicGain.connect(context.destination);
    ambienceGain = context.createGain(); ambienceGain.gain.value = 0.05; ambienceGain.connect(context.destination);
    let step = 0;
    const tick = () => {
      if (!context || !musicGain) return;
      if (!muted && context.state === "running") {
        const now = context.currentTime, root = 220 * 2 ** (NOTES[(Math.floor(step / 4) * 4) % 16] / 12);
        const osc = context.createOscillator(), amp = context.createGain();
        osc.type = step % 2 ? "square" : "triangle"; osc.frequency.value = root * 2 ** (NOTES[step % 16] / 12) / (step % 4 === 0 ? 2 : 1);
        amp.gain.setValueAtTime(0.6, now); amp.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(amp).connect(musicGain); osc.start(now); osc.stop(now + 0.18);
      }
      ambienceStep(step);
      step++; musicTimer = window.setTimeout(tick, 180);
    };
    tick();
  };
  return {
    async unlock() { const ctx = ensure(); if (ctx && ctx.state !== "running") await ctx.resume().catch(() => undefined); if (ctx?.state === "running") startMusic(); return ctx?.state === "running"; },
    setMuted(value: boolean) { muted = value; },
    roar() {
      burst(2.4, 900, 0.22, 0.4); burst(1.6, 2400, 0.08, 0.6);
      const stadium = activeStadium().stadium;
      if (stadium === "pro") { tone(440, 0.7, "sawtooth", 0.035, 0.15); tone(554, 0.7, "sawtooth", 0.03, 0.15); } // the ultras' air horn
      if (stadium === "champions" && !muted && context?.state === "running") for (const at of [0.9, 1.35, 1.8, 2.25, 2.7]) { hit(context.destination, 70, 0.35, 0.5, "lowpass", at); hit(context.destination, 3000, 0.08, 0.35, "highpass", at + 0.08); } // firework booms + crackle
    },
    groan() { burst(1.2, 320, 0.12, 0.8); },
    kick() { burst(0.09, 180, 0.35, 1.5); },
    post() { burst(0.3, 1400, 0.25, 9); },
    ooh() { burst(1.1, 600, 0.14, 1.2); },
    whistle() { tone(2800, 0.25, "sine", 0.08); tone(2950, 0.2, "sine", 0.05, 0.05); },
    clang() { tone(1320, 0.5, "triangle", 0.12); tone(1980, 0.35, "sine", 0.06); },
    thud() { burst(0.12, 120, 0.3, 2); },
    /** Reveal sting: a rising arpeggio whose pitch climbs with the TRUE rarity tier. */
    reveal(semitones: number, top: boolean) {
      duck(0.25, top ? 3.8 : 2.2);
      const base = 330 * 2 ** (semitones / 12);
      [0, 4, 7, 12].forEach((step, index) => tone(base * 2 ** (step / 12), 0.22, "square", 0.05, 1.05 + index * 0.07));
      if (top) { [0, 7, 12, 19, 24].forEach((step, index) => tone(base * 2 ** (step / 12), 0.4, "triangle", 0.06, 1.5 + index * 0.1)); this.roar(); }
    },
    /** FD-3b: one bar of crowd drumroll while randomness is on its way (called every ~0.45 s; louder as `level` → 1). */
    drumroll(level: number) {
      if (muted || !context || context.state !== "running") return;
      const k = Math.max(0, Math.min(1, level)), hits = 4 + Math.round(k * 6);
      for (let i = 0; i < hits; i++) hit(context.destination, 150 + k * 60, 0.12 + 0.3 * k, 0.07, "bandpass", (i * 0.45) / hits);
    },
    /** FD-3b: the building sting before a pack's best ball; its size follows the TRUE best rarity (0–6). */
    sting(rarity: number) {
      duck(0.4, 1.4);
      const k = Math.max(0, Math.min(6, rarity)) / 6, steps = 3 + Math.round(k * 3);
      for (let i = 0; i < steps; i++) tone(220 * 2 ** ((i * 2) / 12), 0.18, "triangle", 0.03 + 0.03 * k, i * 0.14);
      this.drumroll(0.4 + 0.6 * k);
    },
    duck,
    get ducked() { return ducked; },
    dispose() { window.clearTimeout(musicTimer); void context?.close().catch(() => undefined); context = null; musicGain = null; ambienceGain = null; ambience = null; },
  };
}
export type Crowd = ReturnType<typeof createCrowd>;
