/**
 * Crowd and kick sounds synthesised in code (no samples). Muted by default and
 * only unlocked from a player gesture; the SDK sound kit covers UI cues.
 */
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
  let musicGain: GainNode | null = null, ambienceGain: GainNode | null = null, musicTimer = 0, ducked = 1;
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
  // A four-bar chiptune loop (original): bass + arpeggio, very quiet under the crowd.
  const NOTES = [0, 4, 7, 12, 5, 9, 12, 17, 7, 11, 14, 19, 5, 9, 12, 16];
  const startMusic = () => {
    if (!context || musicGain) return;
    musicGain = context.createGain(); musicGain.gain.value = 0.035; musicGain.connect(context.destination);
    ambienceGain = context.createGain(); ambienceGain.gain.value = 0.05; ambienceGain.connect(context.destination);
    if (noise) { const bed = context.createBufferSource(), filter = context.createBiquadFilter(); bed.buffer = noise; bed.loop = true; filter.type = "lowpass"; filter.frequency.value = 700; bed.connect(filter).connect(ambienceGain); bed.start(); }
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
      step++; musicTimer = window.setTimeout(tick, 180);
    };
    tick();
  };
  return {
    async unlock() { const ctx = ensure(); if (ctx && ctx.state !== "running") await ctx.resume().catch(() => undefined); if (ctx?.state === "running") startMusic(); return ctx?.state === "running"; },
    setMuted(value: boolean) { muted = value; },
    roar() { burst(2.4, 900, 0.22, 0.4); burst(1.6, 2400, 0.08, 0.6); },
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
    duck,
    get ducked() { return ducked; },
    dispose() { window.clearTimeout(musicTimer); void context?.close().catch(() => undefined); context = null; musicGain = null; ambienceGain = null; },
  };
}
export type Crowd = ReturnType<typeof createCrowd>;
