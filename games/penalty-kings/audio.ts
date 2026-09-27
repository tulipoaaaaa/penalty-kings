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
  return {
    async unlock() { const ctx = ensure(); if (ctx && ctx.state !== "running") await ctx.resume().catch(() => undefined); return ctx?.state === "running"; },
    setMuted(value: boolean) { muted = value; },
    roar() { burst(2.4, 900, 0.22, 0.4); burst(1.6, 2400, 0.08, 0.6); },
    groan() { burst(1.2, 320, 0.12, 0.8); },
    kick() { burst(0.09, 180, 0.35, 1.5); },
    post() { burst(0.3, 1400, 0.25, 9); },
    dispose() { void context?.close().catch(() => undefined); context = null; },
  };
}
export type Crowd = ReturnType<typeof createCrowd>;
