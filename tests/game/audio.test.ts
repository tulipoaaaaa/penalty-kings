import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, NEUTRAL, resolveShot, kickSeed, prng, type ShotOutcome } from "@penalty-kings/engine";
import { SFX_NAMES, HUSH, SWELL, ROAR_OVER_BED_DB, CLANG_PARTIALS, createGate, dbToGain, hushGainAt, stingerNotes, isSfx, type Sfx } from "../../games/penalty-kings/audio-core.ts";
import { createCrowd } from "../../games/penalty-kings/audio.ts";
import { KEEPER_DESIGNS } from "../../games/penalty-kings/gfx/keepers.ts";
import { Stage, STRIKE_AT, type Sfx as StageSfx } from "../../games/penalty-kings/gfx/stage.ts";

// Sound pass B3: BQ-X4 (no silent Sfx name), BQ-X5 (one roar per event, a master limiter), the hush and swell.

// ── A recording fake of the Web Audio graph (no browser needed) ─────────────────────────────────────
type Event = [kind: string, value: number, time: number];
class FakeParam { events: Event[] = []; constructor(public value = 0) {}
  setValueAtTime(v: number, t: number) { this.events.push(["set", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(["linear", v, t]); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { if (!(v > 0)) throw new RangeError("exponential ramp to 0"); this.events.push(["exp", v, t]); return this; }
  setTargetAtTime(v: number, t: number, c: number) { this.events.push(["target", v, t]); void c; return this; }
  cancelScheduledValues(t: number) { this.events.push(["cancel", 0, t]); return this; }
}
class FakeNode { outputs: FakeNode[] = []; disconnected = false; constructor(public kind: string) {}
  connect(node: FakeNode) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; }
}
class FakeSource extends FakeNode { started = false; stopAt: number | null = null; onended: (() => void) | null = null; frequency = new FakeParam(440); type = ""; buffer: unknown = null; loop = false;
  start() { this.started = true; }
  stop(t: number) { this.stopAt = t; }
}
const created: FakeNode[] = []; let buffers = 0;
const track = <T extends FakeNode>(node: T) => { created.push(node); return node; };
class FakeContext {
  state = "suspended"; currentTime = 0; sampleRate = 8000; destination = new FakeNode("destination");
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
  createBuffer(_c: number, length: number) { buffers++; return { getChannelData: () => new Float32Array(length) }; }
  createGain() { return track(Object.assign(new FakeNode("gain"), { gain: new FakeParam(1) })); }
  createBiquadFilter() { return track(Object.assign(new FakeNode("filter"), { type: "lowpass", frequency: new FakeParam(350), Q: new FakeParam(1) })); }
  createDynamicsCompressor() { return track(Object.assign(new FakeNode("compressor"), { threshold: new FakeParam(-24), knee: new FakeParam(30), ratio: new FakeParam(12), attack: new FakeParam(0.003), release: new FakeParam(0.25) })); }
  createOscillator() { return track(new FakeSource("oscillator")); }
  createBufferSource() { return track(new FakeSource("buffer")); }
}
(globalThis as { window?: unknown }).window = { AudioContext: FakeContext, setTimeout: () => 0, clearTimeout: () => undefined };

const reaches = (node: FakeNode, kind: string, seen = new Set<FakeNode>()): boolean =>
  node.kind === kind || (!seen.has(node) && (seen.add(node), node.outputs.some(next => reaches(next, kind, seen))));
const sources = () => created.filter((node): node is FakeSource => node instanceof FakeSource);
async function liveCrowd() {
  const crowd = createCrowd(); crowd.setMuted(false);
  assert.equal(await crowd.unlock(), true, "the fake context unlocks");
  return crowd;
}

// ── BQ-X4: every name has a voice ────────────────────────────────────────────────────────────────────
test("SFX_NAMES is the Stage's Sfx union, has no duplicates, and covers every keeper's signature sound", () => {
  const sameUnion: [StageSfx] extends [Sfx] ? ([Sfx] extends [StageSfx] ? true : false) : false = true; // compile-time: the same union
  assert.equal(sameUnion, true);
  assert.equal(new Set(SFX_NAMES).size, SFX_NAMES.length, "no duplicate names");
  for (const [keeper, design] of Object.entries(KEEPER_DESIGNS)) assert.ok(isSfx(design.sfx), `${keeper}'s "${design.sfx}" is a sound name`);
  for (const name of ["clang", "fingertip", "net-ripple", "roar-swell", "stinger-3", "stinger-5", "stinger-10", "so-close", "perfect", "hush", "whoosh", "beep", "honk"]) assert.ok(isSfx(name), `${name} is wired`);
  assert.equal(isSfx("nope"), false);
});

test("every Sfx name maps to an audio function that starts real sound, routed through the master limiter", async () => {
  const crowd = await liveCrowd();
  const silent: string[] = [];
  for (const name of SFX_NAMES) {
    assert.equal(typeof crowd.voices[name], "function", `${name} has a voice`);
    const before = sources().length;
    crowd.voices[name]();
    const started = sources().slice(before).filter(source => source.started);
    if (started.length === 0) silent.push(name);
    for (const source of started) {
      assert.ok(reaches(source, "compressor"), `${name}: every voice passes the limiter`);
      assert.ok(reaches(source, "destination"), `${name}: every voice reaches the speakers`);
    }
  }
  assert.deepEqual(silent, [], "no silent Sfx names");
  crowd.dispose();
});

test("voices release their nodes: one-shots stop, disconnect on end, and the noise buffer is made once", async () => {
  buffers = 0;
  const crowd = await liveCrowd(), from = created.length;
  for (let round = 0; round < 3; round++) for (const name of SFX_NAMES) crowd.voices[name]();
  const oneShots = created.slice(from).filter((node): node is FakeSource => node instanceof FakeSource && node.started);
  assert.ok(oneShots.length > 100, "the voices made many sources");
  for (const source of oneShots) {
    assert.notEqual(source.stopAt, null, `a ${source.kind} voice is scheduled to stop`);
    assert.equal(typeof source.onended, "function", "and cleans up when it ends");
  }
  const sample = oneShots[0], chain = [sample, ...sample.outputs];
  sample.onended!();
  assert.ok(chain.every(node => node.disconnected), "ended voices disconnect their chain");
  assert.equal(buffers, 1, "one shared noise buffer (created once, never per sound)");
  crowd.dispose();
});

test("muted: play() makes no sound", async () => {
  const crowd = await liveCrowd(); crowd.setMuted(true);
  const before = sources().length;
  for (const name of SFX_NAMES) crowd.play(name);
  assert.equal(sources().length, before);
  crowd.dispose();
});

// ── BQ-X5: one roar per event ────────────────────────────────────────────────────────────────────────
test("dedupe gate: one roar per event (roar, roar-swell share a 1.5 s window), other names pass", () => {
  const gate = createGate();
  assert.equal(gate.allow("roar", 0), true, "the goal roar");
  assert.equal(gate.allow("roar-swell", 200), false, "a roar-swell on the same goal is the same roar");
  assert.equal(gate.allow("roar", 900), false, "a second roar (Golden Boot: stage + reveal) is dropped");
  assert.equal(gate.allow("chant", 10), true, "the chant is claps, not a roar");
  assert.equal(gate.allow("net", 10), true);
  assert.equal(gate.allow("roar", 1600), true, "the next event roars again");
  assert.equal(gate.allow("kick", 0), true);
  assert.equal(gate.allow("kick", 30), false, "the same name in the same frame plays once");
  assert.equal(gate.allow("kick", 400), true, "the next kick plays");
  assert.equal(gate.allow("stinger-3", 0), true);
  assert.equal(gate.allow("stinger-5", 100), false, "one streak stinger at a time");
  gate.reset(); assert.equal(gate.allow("roar-swell", 1700), true, "reset clears the windows");
});

test("crowd.play: goal (net + roar + chant + roar-swell) and a Golden Boot reveal each roar once", async () => {
  const crowd = await liveCrowd();
  const roarVoices = () => sources().filter(source => source.kind === "buffer" && source.stopAt !== null && source.stopAt - 0 > 3).length; // the roar's 4.5 s formant voices
  const before = roarVoices();
  crowd.play("net"); crowd.play("roar"); crowd.play("chant"); crowd.play("roar-swell");
  assert.equal(roarVoices() - before, 2, "one roar (its two formant voices)");
  const mid = roarVoices();
  crowd.reveal(12, true); crowd.play("roar");
  assert.equal(roarVoices() - mid, 0, "within the window, the reveal's roar and the Stage's roar are dropped");
  crowd.dispose();
});

// ── The mix: master limiter, hush, swell ─────────────────────────────────────────────────────────────
test("master bus: master gain → compressor/limiter → destination; the crowd bus low-passes into the master", async () => {
  const from = created.length, crowd = await liveCrowd(), made = created.slice(from);
  const compressor = made.find(node => node.kind === "compressor") as FakeNode & { threshold: FakeParam; ratio: FakeParam; attack: FakeParam };
  assert.ok(compressor, "a DynamicsCompressor exists");
  assert.equal(compressor.outputs[0].kind, "destination");
  assert.ok(compressor.threshold.value <= -6 && compressor.ratio.value >= 8 && compressor.attack.value <= 0.005, "limiter-like settings");
  const master = made.find(node => node.kind === "gain" && node.outputs.includes(compressor));
  assert.ok(master, "a master gain feeds the limiter");
  const low = made.find(node => node.kind === "filter" && node.outputs.includes(master!)) as FakeNode & { frequency: FakeParam };
  assert.ok(low && low.frequency.value >= 16000, "the crowd bus low-pass starts open");
  crowd.dispose();
});

test("hush envelope: −12 dB and 800 Hz over the 150 ms before the strike; the roar swells +18 dB over the hushed crowd", async () => {
  assert.equal(HUSH.db, -12);
  assert.ok(Math.abs(dbToGain(HUSH.db) - 0.2512) < 1e-3);
  assert.equal(HUSH.seconds, 0.15);
  assert.equal(hushGainAt(0), 1);
  assert.ok(Math.abs(hushGainAt(0.075) - (1 + dbToGain(-12)) / 2) < 1e-9, "a linear duck: halfway at 75 ms");
  assert.ok(Math.abs(hushGainAt(0.15) - dbToGain(-12)) < 1e-9, "fully hushed at the strike");
  assert.ok(Math.abs(hushGainAt(1.0) - dbToGain(-12)) < 1e-9, "held through the flight");
  assert.ok(hushGainAt(HUSH.holdS + 5 * HUSH.liftS) > 0.99, "lifts by itself if no result lifts it");
  assert.equal(SWELL.db, 18); assert.equal(ROAR_OVER_BED_DB - HUSH.db, 18, "hushed bed → roar peak is +18 dB");
  assert.equal(SWELL.attackS, 0.15);

  // The graph follows the same numbers.
  const from = created.length, crowd = await liveCrowd(), made = created.slice(from);
  const low = made.find(node => node.kind === "filter" && (node as unknown as { frequency: FakeParam }).frequency.value >= 16000) as FakeNode & { frequency: FakeParam };
  const bus = made.find(node => node.kind === "gain" && node.outputs.includes(low)) as FakeNode & { gain: FakeParam };
  crowd.play("hush");
  assert.deepEqual(bus.gain.events.find(e => e[0] === "linear"), ["linear", dbToGain(-12), HUSH.seconds], "the bus ducks 12 dB over 150 ms");
  assert.deepEqual(low.frequency.events.find(e => e[0] === "exp"), ["exp", HUSH.lowpassHz, HUSH.seconds], "and low-passes to 800 Hz");
  assert.ok(bus.gain.events.some(e => e[0] === "target" && e[1] === 1 && e[2] === HUSH.holdS), "a self-lift is scheduled");
  bus.gain.events.length = 0;
  crowd.play("roar");
  assert.deepEqual(bus.gain.events.find(e => e[0] === "linear"), ["linear", 1, SWELL.attackS], "the goal roar lifts the bus with a 150 ms attack");
  crowd.dispose();
});

test("stingers: the same arpeggio, +2 semitones per tier; the post clang uses inharmonic bar partials", () => {
  const [three, five, ten] = (["stinger-3", "stinger-5", "stinger-10"] as const).map(name => stingerNotes(name));
  const step = 2 ** (2 / 12);
  three.forEach((f, i) => { assert.ok(Math.abs(five[i] / f - step) < 1e-9); assert.ok(Math.abs(ten[i] / five[i] - step) < 1e-9); });
  assert.ok(Math.abs(three[3] / three[0] - 2) < 1e-9, "an octave arpeggio");
  assert.deepEqual(CLANG_PARTIALS.map(p => p[0]), [1, 2.76, 5.4, 8.93]);
  for (let i = 1; i < CLANG_PARTIALS.length; i++) assert.ok(CLANG_PARTIALS[i][1] < CLANG_PARTIALS[i - 1][1], "higher partials die faster");
});

// ── The Stage fires the hush 150 ms before the strike, and only known names ─────────────────────────────
function findOutcome(result: ShotOutcome["result"]): ShotOutcome {
  const random = prng(0xb3), keeper = KEEPERS[0];
  for (let k = 0; k < 5000; k++) {
    const shot = { aimX: random() * 2 - 1, aimY: random() * 0.95, power: 0.35 + random() * 0.65, curl: 0 };
    const outcome = resolveShot(shot, keeper, kickSeed(k, 0, keeper.id), { kickIndex: 0, history: [] }, NEUTRAL);
    if (outcome.result === result) return outcome;
  }
  throw new Error(`no ${result} found`);
}
function stubDocument() {
  if ((globalThis as { document?: unknown }).document) return;
  const context: unknown = new Proxy({}, { get: (_t, key) => (key === "canvas" ? {} : key === "measureText" ? () => ({ width: 0 }) : () => context), set: () => true });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
}

test("Stage: hush 150 ms before the kick, then kick + whoosh; every emitted name is a wired Sfx", () => {
  stubDocument();
  const stage = new Stage({ keeper: KEEPERS[0].id });
  for (const result of ["goal", "save", "post", "miss", "over"] as const) {
    let outcome: ShotOutcome; try { outcome = findOutcome(result); } catch { continue; }
    const heard: [string, number][] = []; let t = 0;
    stage.onEvent = (event, data) => { if (event === "sfx") heard.push([data as string, t]); };
    stage.cancel(); stage.play(outcome, 0);
    for (let i = 0; i < 300 && stage.busy; i++) { stage.update(1 / 120); t += 1 / 120; }
    for (const [name] of heard) assert.ok(isSfx(name), `${result}: "${name}" is wired to a sound`);
    const hush = heard.find(([name]) => name === "hush"), kick = heard.find(([name]) => name === "kick");
    assert.ok(hush && kick, `${result}: hush and kick fire`);
    assert.ok(Math.abs(kick![1] - hush![1] - HUSH.seconds) < 0.02, `${result}: the hush leads the strike by 150 ms`);
    assert.ok(Math.abs(kick![1] - STRIKE_AT) < 0.03);
    assert.ok(heard.some(([name]) => name === "whoosh"), `${result}: the strike whooshes`);
  }
});
