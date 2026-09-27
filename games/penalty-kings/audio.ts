/**
 * Crowd, kick and keeper sounds synthesised in code (no samples). Silent until a player gesture unlocks it
 * (the shell turns sound on at the first gesture unless the player muted it); the SDK sound kit covers UI cues.
 *
 * The mix (sound pass B3, research R5): every voice → master gain → compressor/limiter → destination. The
 * crowd, ambience and music share a crowd bus with a low-pass, so the pre-kick hush (−12 dB, 800 Hz) muffles
 * the stadium but not the kick, and the goal roar swells +18 dB over the hushed crowd. Every `Sfx` name has a
 * voice (`play`); one roar per event (audio-core.ts createGate). Pure numbers live in audio-core.ts.
 *
 * Ambience follows the stadium on screen (gfx/stadium.ts activeStadium, round 6 E22):
 *   PARK      a small murmur, birdsong between kicks;
 *   PRO       a big crowd bed, the ultras' drums, floodlight hum, rain hiss when it rains;
 *   CHAMPIONS a vast roar, a slow original anthem pad and rhythmic claps.
 * Goals add a horn (Pro) or firework booms (Champions) on top of the roar.
 */
import { activeStadium } from "./gfx/stadium.js";
import type { StadiumId, Weather } from "./gfx/stadium.js";
import { CLANG_PARTIALS, HUSH, ROAR_OVER_BED_DB, STINGER_TIERS, SWELL, createGate, dbToGain, stingerNotes, vary, type Sfx } from "./audio-core.js";

type Ambience = { stadium: StadiumId; weather: Weather; gain: GainNode; sources: AudioScheduledSourceNode[]; pad?: OscillatorNode[] };
/** Relative bed levels (under the shared ambience gain): Pro and Champions are bigger crowds. */
const LEVEL: Readonly<Record<StadiumId, number>> = { park: 0.8, pro: 1.3, champions: 1.6 };
const ANTHEM = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [4, 7, 12]] as const;
/** Master and bus levels. */
const MASTER = 0.9, AMBIENCE = 0.05, MUSIC = 0.035;

export function createCrowd() {
  let context: AudioContext | null = null, muted = true, noise: AudioBuffer | null = null;
  let master: GainNode | null = null, crowdBus: GainNode | null = null, crowdLow: BiquadFilterNode | null = null;
  let pv = 1, gv = 1, pulse = false; // this call's pitch and gain variation; the Big Match heartbeat loop
  const gate = createGate();
  const ensure = () => {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
      // The one noise buffer every noise voice reads (at a random offset): created once, never per sound.
      noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -10; limiter.knee.value = 4; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.25;
      master = context.createGain(); master.gain.value = muted ? 0 : MASTER;
      master.connect(limiter).connect(context.destination);
      crowdLow = context.createBiquadFilter(); crowdLow.type = "lowpass"; crowdLow.frequency.value = HUSH.openHz;
      crowdBus = context.createGain(); crowdBus.connect(crowdLow).connect(master);
    }
    return context;
  };
  const live = () => (!muted && context && noise && master && context.state === "running" ? context : null);
  /** Finished voices disconnect themselves (nothing stays wired into the graph). */
  const release = (source: AudioScheduledSourceNode, ...nodes: AudioNode[]) => { source.onended = () => { source.disconnect(); for (const node of nodes) node.disconnect(); }; };
  /** 2 ms attack (no clicks), an optional hold, then an exponential decay to silence at `t + duration`. */
  const envelope = (param: AudioParam, t: number, peak: number, duration: number, attack = 0.002, hold = 0) => {
    const top = Math.max(0.0002, peak);
    param.setValueAtTime(0.0001, t); param.exponentialRampToValueAtTime(top, t + attack);
    if (hold) param.setValueAtTime(top, t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + duration);
  };
  /** An oscillator voice whose pitch glides f0 → f1 over `glide` s (this call's pitch and gain variation applied). */
  const osc = (type: OscillatorType, f0: number, f1: number, duration: number, gain: number, at = 0, out?: AudioNode | null, glide = duration) => {
    const ctx = live(); if (!ctx) return;
    const o = ctx.createOscillator(), amp = ctx.createGain(), t = ctx.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f0 * pv, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * pv, t + glide);
    envelope(amp.gain, t, gain * gv, duration);
    o.connect(amp).connect(out ?? master!); o.start(t); o.stop(t + duration + 0.02); release(o, amp);
  };
  /** A filtered-noise voice read from the shared buffer; the filter glides f0 → f1. */
  const hiss = (type: BiquadFilterType, f0: number, f1: number, q: number, duration: number, gain: number, at = 0, out?: AudioNode | null, attack = 0.002, hold = 0) => {
    const ctx = live(); if (!ctx) return;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain(), t = ctx.currentTime + at;
    source.buffer = noise; source.loop = true;
    filter.type = type; filter.Q.value = q; filter.frequency.setValueAtTime(f0 * pv, t); if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1 * pv, t + duration * 0.9);
    envelope(amp.gain, t, gain * gv, duration, attack, hold);
    source.connect(filter).connect(amp).connect(out ?? master!); source.start(t, Math.random() * 1.5); source.stop(t + duration + 0.05); release(source, filter, amp);
  };
  /** Move a param from where it is now to `value` over `seconds`; with `back`, it lifts back there after the hush's hold. */
  const glideParam = (param: AudioParam, value: number, seconds: number, linear: boolean, back?: number) => {
    const t = context!.currentTime;
    param.cancelScheduledValues(t); param.setValueAtTime(param.value, t);
    if (linear) param.linearRampToValueAtTime(value, t + seconds); else param.exponentialRampToValueAtTime(value, t + seconds);
    if (back !== undefined) param.setTargetAtTime(back, t + HUSH.holdS, HUSH.liftS);
  };
  /** The pre-kick hush: the crowd bus ducks 12 dB and low-passes to 800 Hz over 150 ms, lifting by itself after 1.4 s. */
  const hush = () => {
    if (!crowdBus || !crowdLow || !live()) return;
    glideParam(crowdBus.gain, dbToGain(HUSH.db), HUSH.seconds, true, 1); glideParam(crowdLow.frequency, HUSH.lowpassHz, HUSH.seconds, false, HUSH.openHz);
  };
  /** The result lifts the hush (the goal roar lifts it with the swell's attack). */
  const lift = (seconds: number) => {
    if (!crowdBus || !crowdLow || !live()) return;
    glideParam(crowdBus.gain, 1, seconds, true); glideParam(crowdLow.frequency, HUSH.openHz, seconds, false);
  };
  /** The goal roar: the bus lifts +12 dB while a formant roar swells 6 dB over the bed (+18 dB over the hushed crowd). */
  const roar = () => {
    if (!live()) return;
    lift(SWELL.attackS);
    const stadium = activeStadium().stadium, peak = AMBIENCE * LEVEL[stadium] * dbToGain(ROAR_OVER_BED_DB), length = SWELL.attackS + SWELL.holdS + SWELL.releaseS;
    hiss("bandpass", 560, 720, 0.5, length, peak, 0, crowdBus, SWELL.attackS, SWELL.holdS);
    hiss("bandpass", 1200, 1500, 0.6, length * 0.8, peak * 0.45, 0, crowdBus, SWELL.attackS, SWELL.holdS * 0.7);
    if (stadium === "pro") { osc("sawtooth", 440, 440, 0.7, 0.035, 0.15, crowdBus); osc("sawtooth", 554, 554, 0.7, 0.03, 0.15, crowdBus); } // the ultras' air horn
    if (stadium === "champions") for (const at of [0.9, 1.35, 1.8, 2.25, 2.7]) { hit(crowdBus!, 70, 0.35, 0.5, "lowpass", at); hit(crowdBus!, 3000, 0.08, 0.35, "highpass", at + 0.08); } // firework booms + crackle
  };
  const kick = () => {
    hiss("highpass", 3000, 3000, 0.7, 0.006, 0.5); // click
    osc("sine", 160, 50, 0.16, 0.9, 0, null, 0.1); // thump, pitch dropping
    osc("sine", 320, 100, 0.1, 0.3, 0, null, 0.08); // its 2nd harmonic (phone speakers cannot play 50 Hz)
    hiss("bandpass", 1250, 1250, 1, 0.04, 0.35); // leather slap
    if (crowdLow && live()) glideParam(crowdLow.frequency, HUSH.openHz, 0.03, false); // contact un-muffles the crowd
  };
  const ooh = () => { lift(0.4); hiss("bandpass", 720, 450, 1.4, 1.1, 0.12, 0, crowdBus, 0.06); hiss("bandpass", 1500, 1000, 2, 0.9, 0.04, 0, crowdBus, 0.06); };
  const reveal = () => hiss("bandpass", 400, 3000, 1.5, 0.9, 0.08, 0, null, 0.6);
  const stinger = (name: keyof typeof STINGER_TIERS) => {
    pv = 1; const notes = stingerNotes(name);
    notes.forEach((f, i) => osc("square", f, f, 0.14, 0.05, i * 0.07));
    osc("triangle", notes[3], notes[3], 0.45, 0.06, 0.28);
  };
  /** A card-flip chime: one note per rarity step (a major pentatonic climb), brighter and longer for rarer balls. */
  const rarityChime = (rarity: number) => {
    const f = 440 * 2 ** ([0, 2, 4, 7, 9, 12, 16][Math.max(0, Math.min(6, rarity))] / 12);
    osc("triangle", f, f, 0.12 + rarity * 0.04, 0.12); if (rarity >= 4) osc("sine", f * 2, f * 2, 0.2 + rarity * 0.05, 0.05, 0.03);
  };
  /** Every Sfx name → its voice (BQ-X4: none is silent). */
  const voices: Record<Sfx, () => void> = {
    kick,
    perfect: () => { osc("sine", 120, 38, 0.28, 0.8, 0, null, 0.14); osc("square", 240, 80, 0.06, 0.07); hiss("highpass", 6000, 6000, 0.7, 0.012, 0.4); }, // a bassier, crisper layer on the kick
    whoosh: () => hiss("bandpass", 1200, 300, 1.2, 0.18, 0.18),
    "pack-tear": () => { hiss("bandpass", 2500, 6000, 1.5, 0.22, 0.3); hiss("highpass", 5000, 5000, 0.7, 0.06, 0.2, 0.18); }, // a paper-foil rip
    "rarity-0": () => rarityChime(0), "rarity-1": () => rarityChime(1), "rarity-2": () => rarityChime(2), "rarity-3": () => rarityChime(3),
    "rarity-4": () => rarityChime(4), "rarity-5": () => rarityChime(5), "rarity-6": () => rarityChime(6),
    "pot-up": () => { pv = 1; osc("triangle", 988, 988, 0.08, 0.07); osc("triangle", 1319, 1319, 0.22, 0.07, 0.07); osc("sine", 2638, 2638, 0.18, 0.02, 0.07); }, // a bright two-note chime: B5 → E6 with a glint
    net: () => { hiss("bandpass", 5000, 2000, 0.7, 0.32, 0.22); osc("sine", 90, 70, 0.06, 0.5); }, // swish + the back-of-the-net thud
    "net-ripple": () => { hiss("bandpass", 3800, 1400, 0.8, 0.5, 0.1, 0.04); hiss("bandpass", 2600, 1200, 0.8, 0.35, 0.06, 0.2); },
    clang: () => { // modal post: inharmonic partials, higher ones die faster
      const f = 700 + Math.random() * 200; pv = 1;
      for (const [ratio, decay, gain] of CLANG_PARTIALS) osc("sine", f * ratio, f * ratio, decay, gain);
      const beat = f * 2 ** (3 / 1200); osc("sine", beat, beat, 1.2, 0.08); // +3 cents: the ring beats
      hiss("highpass", 4000, 4000, 0.7, 0.005, 0.4);
    },
    glove: () => { hiss("lowpass", 500, 300, 0.7, 0.1, 0.45); osc("sine", 120, 70, 0.08, 0.35); },
    fingertip: () => { hiss("bandpass", 2600, 2600, 2, 0.03, 0.35); osc("sine", 620, 900, 0.05, 0.12); },
    stomp: () => { osc("sine", 70, 35, 0.32, 0.9); hiss("lowpass", 220, 120, 0.7, 0.25, 0.5); },
    heartbeat: () => { // lub-dub, with harmonics a phone can play
      osc("sine", 58, 50, 0.13, 0.5); osc("sine", 116, 100, 0.08, 0.1);
      osc("sine", 52, 45, 0.12, 0.35, 0.2); osc("sine", 104, 90, 0.07, 0.07, 0.2);
    },
    hush: () => { hush(); hiss("lowpass", 700, 400, 0.7, 0.35, 0.03, 0, crowdBus, 0.12); }, // the crowd draws breath
    whistle: () => { osc("sine", 2800, 2800, 0.25, 0.08); osc("sine", 2950, 2950, 0.2, 0.05, 0.05); },
    roar, "roar-swell": roar,
    groan: () => { lift(0.4); hiss("bandpass", 480, 300, 0.9, 1.2, 0.12, 0, crowdBus, 0.08); },
    ooh,
    "so-close": () => { ooh(); pv = 1; osc("triangle", 660, 660, 0.18, 0.06, 0.05); osc("triangle", 555, 555, 0.3, 0.06, 0.22); },
    chant: () => { // claps and an "oh-oh" (not a second roar)
      for (const at of [0, 0.3, 0.6, 1.05, 1.35]) hiss("highpass", 1800, 1800, 0.7, 0.07, 0.3, at, crowdBus);
      for (const at of [0, 0.3]) hiss("bandpass", 500, 560, 3, 0.28, 0.1, at, crowdBus, 0.04);
    },
    beep: () => { osc("square", 1000, 1000, 0.07, 0.05); osc("square", 1500, 1500, 0.07, 0.04, 0.1); },
    honk: () => { osc("sawtooth", 233, 226, 0.6, 0.06); osc("sawtooth", 277, 270, 0.6, 0.04); },
    reveal,
    "reveal-top": () => { reveal(); hiss("highpass", 6000, 6000, 0.7, 1.6, 0.12, 1.0); },
    "stinger-3": () => stinger("stinger-3"), "stinger-5": () => stinger("stinger-5"), "stinger-10": () => stinger("stinger-10"),
    squeak: () => { osc("sine", 1200, 2400, 0.09, 0.12); osc("sine", 1400, 2600, 0.08, 0.1, 0.12); },
    chitter: () => { for (let i = 0; i < 6; i++) { const f = 2200 + Math.random() * 900; osc("sine", f, f * 1.2, 0.03, 0.07, i * 0.045); } },
    yawn: () => { osc("triangle", 420, 160, 0.9, 0.12); osc("sine", 840, 320, 0.8, 0.03); },
    blub: () => { for (const at of [0, 0.08, 0.17]) osc("sine", 300, 750, 0.06, 0.15, at); },
    mime: () => { for (const at of [0, 0.14]) { osc("sine", 900, 700, 0.04, 0.12, at); hiss("bandpass", 1800, 1800, 3, 0.02, 0.15, at); } }, // knocks on an invisible wall
    disco: () => { [0, 12, 7, 12].forEach((step, i) => { const f = 220 * 2 ** (step / 12); osc("square", f, f, 0.08, 0.05, i * 0.09); hiss("highpass", 8000, 8000, 0.7, 0.03, 0.08, i * 0.09); }); },
    hiss: () => hiss("highpass", 5000, 4000, 0.7, 0.6, 0.12, 0, null, 0.08),
    boo: () => { osc("triangle", 330, 200, 0.6, 0.12); osc("sine", 165, 100, 0.6, 0.06); },
    rumble: () => { hiss("lowpass", 140, 90, 0.7, 1.2, 0.5, 0, null, 0.1); osc("sine", 45, 38, 1.1, 0.4); },
  };
  /** Play a sound by name: gated (one roar per event), with ±5 % pitch and ±1.5 dB gain on every call. */
  const play = (name: Sfx) => {
    if (!live() || !gate.allow(name, performance.now())) return;
    pv = vary(1, 0.05); gv = vary(1, 0.16); voices[name]();
  };
  let musicGain: GainNode | null = null, ambienceGain: GainNode | null = null, musicTimer = 0, ducked = 1, ambience: Ambience | null = null;
  /** Ducking: music and ambience dip under big moments (reveals, commentary, goals). */
  const duck = (amount: number, seconds: number) => {
    if (!context || !musicGain || !ambienceGain) return;
    const now = context.currentTime; ducked = amount;
    for (const [node, level] of [[musicGain, MUSIC], [ambienceGain, AMBIENCE]] as const) {
      node.gain.cancelScheduledValues(now); node.gain.setTargetAtTime(level * amount, now, 0.05); node.gain.setTargetAtTime(level, now + seconds, 0.4);
    }
  };
  /** A looping filtered-noise bed into `out`. */
  const bed = (out: AudioNode, type: BiquadFilterType, freq: number, gain: number, q = 0.7) => {
    const ctx = context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = noise; source.loop = true; filter.type = type; filter.frequency.value = freq; filter.Q.value = q; amp.gain.value = gain;
    source.connect(filter).connect(amp).connect(out); source.start(ctx.currentTime, Math.random() * 1.5); release(source, filter, amp);
    return source;
  };
  /** A one-shot filtered-noise hit (drum, clap, boom) into `out`, `at` seconds from now. */
  function hit(out: AudioNode, freq: number, gain: number, duration: number, type: BiquadFilterType = "bandpass", at = 0) {
    const ctx = context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain(), now = ctx.currentTime + at;
    source.buffer = noise; filter.type = type; filter.frequency.value = freq; filter.Q.value = type === "bandpass" ? 1.2 : 0.7;
    amp.gain.setValueAtTime(0.0001, now); amp.gain.exponentialRampToValueAtTime(gain, now + 0.002); amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(amp).connect(out); source.start(now, Math.random() * 1.5); source.stop(now + duration + 0.02); release(source, filter, amp);
  }
  const chirp = (out: AudioNode, from: number, to: number, at: number) => {
    const ctx = context!, o = ctx.createOscillator(), amp = ctx.createGain(), now = ctx.currentTime + at;
    o.type = "sine"; o.frequency.setValueAtTime(from, now); o.frequency.exponentialRampToValueAtTime(to, now + 0.07);
    amp.gain.setValueAtTime(0.0001, now); amp.gain.exponentialRampToValueAtTime(0.25, now + 0.015); amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    o.connect(amp).connect(out); o.start(now); o.stop(now + 0.1); release(o, amp);
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
      hum.connect(humFilter).connect(humGain).connect(gain); hum.start(); release(hum, humFilter, humGain); sources.push(hum);
      if (weather === "rain") sources.push(bed(gain, "highpass", 4200, 0.35));
    } else {
      sources.push(bed(gain, "lowpass", 950, 1.0), bed(gain, "bandpass", 300, 0.6, 0.5), bed(gain, "bandpass", 2600, 0.12, 0.6));
      const padGain = context.createGain(); padGain.gain.value = 0.06; padGain.connect(gain);
      pad = ANTHEM[0].map(step => { const o = context!.createOscillator(); o.type = "triangle"; o.frequency.value = 110 * 2 ** (step / 12); o.connect(padGain); o.start(); release(o); return o; });
      sources.push(...pad);
    }
    return { stadium, weather, gain, sources, pad };
  };
  const retire = (old: Ambience) => {
    if (!context) return;
    old.gain.gain.cancelScheduledValues(context.currentTime); old.gain.gain.setTargetAtTime(0, context.currentTime, 0.4);
    for (const source of old.sources) try { source.stop(context.currentTime + 2); } catch { /* already stopped */ }
    window.setTimeout(() => old.gain.disconnect(), 2500);
  };
  /** Every music step (180 ms): follow the stadium on screen, honour mute, play the rhythmic parts and the Big Match heartbeat. */
  const ambienceStep = (step: number) => {
    if (!context) return;
    const want = activeStadium();
    if (!ambience || ambience.stadium !== want.stadium || (want.stadium === "pro" && ambience.weather !== want.weather)) { if (ambience) retire(ambience); ambience = buildAmbience(want.stadium, want.weather); }
    if (!ambience) return;
    ambience.gain.gain.setTargetAtTime(muted ? 0 : LEVEL[ambience.stadium], context.currentTime, 0.15);
    if (muted || context.state !== "running") return;
    if (pulse && step % 4 === 0) play("heartbeat"); // ≈ 83 bpm under the Big Match kick
    const out = ambience.gain, beat = step % 16;
    if (ambience.stadium === "park") { if (Math.random() < 0.05) { const f = 2400 + Math.random() * 1600; [0, 0.11, 0.22].slice(0, 2 + Math.floor(Math.random() * 2)).forEach(at => chirp(out, f, f * 1.3, at)); } }
    else if (ambience.stadium === "pro") {
      // The ultras' drums: a steady, original two-bar pattern.
      if ([0, 3, 4, 6, 8, 11, 12, 14].includes(beat)) hit(out, beat % 4 === 0 ? 90 : 140, beat % 4 === 0 ? 0.9 : 0.5, 0.16);
    } else {
      // Claps ("clap clap · clap clap clap") every other bar; the anthem pad changes chord each bar.
      if ([0, 2, 8, 10, 12].includes(beat) && Math.floor(step / 16) % 2 === 1) hit(out, 1800, 0.55, 0.07, "highpass");
      if (beat === 0 && ambience.pad) { const chord = ANTHEM[Math.floor(step / 16) % ANTHEM.length]; ambience.pad.forEach((o, i) => o.frequency.setTargetAtTime(110 * 2 ** (chord[i] / 12), context!.currentTime, 0.4)); }
    }
  };
  // A four-bar chiptune loop (original): bass + arpeggio, very quiet under the crowd.
  const NOTES = [0, 4, 7, 12, 5, 9, 12, 17, 7, 11, 14, 19, 5, 9, 12, 16];
  const startMusic = () => {
    if (!context || musicGain || !crowdBus) return;
    musicGain = context.createGain(); musicGain.gain.value = MUSIC; musicGain.connect(crowdBus);
    ambienceGain = context.createGain(); ambienceGain.gain.value = AMBIENCE; ambienceGain.connect(crowdBus);
    let step = 0;
    const tick = () => {
      if (!context || !musicGain) return;
      if (!muted && context.state === "running") {
        const now = context.currentTime, root = 220 * 2 ** (NOTES[(Math.floor(step / 4) * 4) % 16] / 12);
        const o = context.createOscillator(), amp = context.createGain();
        o.type = step % 2 ? "square" : "triangle"; o.frequency.value = root * 2 ** (NOTES[step % 16] / 12) / (step % 4 === 0 ? 2 : 1);
        amp.gain.setValueAtTime(0.0001, now); amp.gain.exponentialRampToValueAtTime(0.6, now + 0.002); amp.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        o.connect(amp).connect(musicGain); o.start(now); o.stop(now + 0.18); release(o, amp);
      }
      ambienceStep(step);
      step++; musicTimer = window.setTimeout(tick, 180);
    };
    tick();
  };
  return {
    async unlock() { const ctx = ensure(); if (ctx && ctx.state !== "running") await ctx.resume().catch(() => undefined); if (ctx?.state === "running") startMusic(); return ctx?.state === "running"; },
    setMuted(value: boolean) { muted = value; if (context && master) master.gain.setTargetAtTime(value ? 0 : MASTER, context.currentTime, 0.02); },
    get muted() { return muted; },
    /** Every Stage/Director sound name (audio-core.ts SFX_NAMES) plays through here. */
    play,
    /** The voice table (the unit test checks that every name has one). */
    voices: voices as Readonly<Record<Sfx, () => void>>,
    /** The Big Match heartbeat loop under the aim and the kick (on/off). */
    setPulse(on: boolean) { pulse = on; },
    /** Reveal sting: a rising arpeggio whose pitch climbs with the TRUE rarity tier. */
    reveal(semitones: number, top: boolean) {
      if (!live()) return;
      duck(0.25, top ? 3.8 : 2.2);
      const base = 330 * 2 ** (semitones / 12); pv = 1; gv = 1;
      [0, 4, 7, 12].forEach((step, index) => { const f = base * 2 ** (step / 12); osc("square", f, f, 0.22, 0.05, 1.05 + index * 0.07); });
      if (top) { [0, 7, 12, 19, 24].forEach((step, index) => { const f = base * 2 ** (step / 12); osc("triangle", f, f, 0.4, 0.06, 1.5 + index * 0.1); }); play("roar"); }
    },
    /** FD-3b: one bar of crowd drumroll while randomness is on its way (called every ~0.45 s; louder as `level` → 1). */
    drumroll(level: number) {
      if (!live()) return;
      const k = Math.max(0, Math.min(1, level)), hits = 4 + Math.round(k * 6);
      for (let i = 0; i < hits; i++) hit(crowdBus!, 150 + k * 60, 0.12 + 0.3 * k, 0.07, "bandpass", (i * 0.45) / hits);
    },
    /** FD-3b: the building sting before a pack's best ball; its size follows the TRUE best rarity (0–6). */
    sting(rarity: number) {
      if (!live()) return;
      duck(0.4, 1.4);
      const k = Math.max(0, Math.min(6, rarity)) / 6, steps = 3 + Math.round(k * 3); pv = 1; gv = 1;
      for (let i = 0; i < steps; i++) { const f = 220 * 2 ** ((i * 2) / 12); osc("triangle", f, f, 0.18, 0.03 + 0.03 * k, i * 0.14); }
      this.drumroll(0.4 + 0.6 * k);
    },
    duck,
    get ducked() { return ducked; },
    dispose() { window.clearTimeout(musicTimer); void context?.close().catch(() => undefined); context = null; master = null; crowdBus = null; crowdLow = null; musicGain = null; ambienceGain = null; ambience = null; },
  };
}
export type Crowd = ReturnType<typeof createCrowd>;
