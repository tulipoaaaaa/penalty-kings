/**
 * The Match Director: decides WHAT the player sees and hears so every session feels like a
 * broadcast — keeper rotation between rounds, keeper intros, weather lines, pre-kick taunts,
 * the right line for the right goal (top bin, post-in, Panenka, curler, knuckleball, long-range screamer), crowd waves
 * on streaks (rationed), consolation on cold streaks, and the attract-mode showreel. Pure logic:
 * it never touches outcomes (the engine and on-chain randomness decide those).
 */
import { LADDER } from "./progress.js";
import { KEEPERS, keeperById, type KeeperId, type Zone } from "@penalty-kings/engine";
import { GameDirector, type Beat as DirectorBeat, type Moment as DirectorMoment, type Line as DirectorLine } from "@penalty-kings/game-director";
import { cueLine, type CommentaryContext } from "../gfx/commentary.js";
import type { Stage, Sfx } from "../gfx/stage.js";

export type KickFacts = {
  kind: "penalty" | "freekick" | "target";
  result: "goal" | "save" | "post" | "over" | "wide" | "wall";
  zone: Zone; postIn?: boolean; y: number; x: number; spin?: number; knuckle?: boolean; screamer?: boolean; streak: number; misses: number;
};
export type Cue = { say: CommentaryContext | null; wave: boolean };
export type ShowreelBeat = "walkout" | "penalty-goal" | "penalty-save" | "celebration" | "wave" | "freekick" | "taunt" | "post";

export class MatchDirector {
  private kicks = 0;
  private lastWave = -99;
  private round = 0;
  constructor(private seed = 1) {}

  /** Keeper for the next free round: the ladder keeper, with a rematch against a beaten one every third round. */
  keeperForRound(stamps: readonly KeeperId[], ladderNext: KeeperId): KeeperId {
    const round = this.round++;
    if (stamps.length && round % 3 === 2) return stamps[(this.seed + round) % stamps.length];
    return ladderNext;
  }

  /** Free kicks rotate the keeper every kick: the ladder keeper, beaten ones, and a sneak peek at the next rung. */
  keeperForKick(stamps: readonly KeeperId[], ladderNext: KeeperId, kick: number): KeeperId {
    const index = LADDER.indexOf(ladderNext), window = LADDER.slice(Math.max(0, index - 2), index + 2).filter(id => id === ladderNext || stamps.includes(id) || LADDER.indexOf(id) === index + 1);
    return window[(kick + this.seed) % window.length] ?? ladderNext;
  }

  /** Round opening line: the keeper's intro, or the weather if it is dramatic. */
  roundIntro(keeper: KeeperId, weather: string, mode: string): CommentaryContext {
    if (mode === "daily") return "daily";
    if (mode === "tour") return this.round % 2 ? "tour" : `intro:${keeper}`;
    if ((weather === "rain" || weather === "snow" || weather === "fog") && this.round % 2 === 1) return weather as CommentaryContext;
    return `intro:${keeper}`;
  }

  /** Before the kick: build-up line on big moments, a keeper taunt now and then. */
  beforeKick(kickIndex: number, streak: number): { say: CommentaryContext | null; taunt: boolean } {
    if (streak >= 2) return { say: "buildup", taunt: true };
    return { say: kickIndex > 0 && kickIndex % 3 === 0 ? "buildup" : null, taunt: kickIndex % 2 === 1 };
  }

  /** After the kick: the most specific line, and a (rationed) Mexican wave on a streak. */
  afterKick(facts: KickFacts): Cue {
    this.kicks++;
    const goal = facts.result === "goal";
    let say: CommentaryContext;
    if (facts.result === "wall") say = "wall";
    else if (goal && facts.postIn) say = "post-in";
    else if (goal && facts.screamer && facts.kind === "freekick") say = "screamer";
    else if (goal && facts.knuckle) say = "knuckle";
    else if (goal && facts.zone === "bin") say = "top-bin";
    else if (goal && facts.zone === "centre" && facts.y >= 0.55) say = "panenka";
    else if (goal && facts.kind === "freekick" && Math.abs(facts.spin ?? 0) >= 0.45) say = "curler";
    else if (goal && facts.streak >= 3) say = "streak3";
    else if (goal && facts.streak === 2) say = "streak2";
    else if (goal) say = "goal";
    else if (facts.misses >= 3) say = "cold-streak";
    else if ((facts.result === "wide" || facts.result === "over") && (Math.abs(Math.abs(facts.x) - 1) < 0.1 || Math.abs(facts.y - 1) < 0.08)) say = "near-miss";
    else say = facts.result === "post" ? "post" : facts.result;
    const wave = goal && facts.streak >= 2 && this.kicks - this.lastWave >= 6;
    if (wave) this.lastWave = this.kicks;
    return { say, wave };
  }

  /** Attract-mode showreel: a fixed, varied loop of skill moments (never paid reveals). */
  static readonly SHOWREEL: readonly ShowreelBeat[] = ["walkout", "penalty-goal", "celebration", "taunt", "penalty-save", "wave", "freekick", "post", "penalty-goal"];
}

// ── The seeded Game Director (@penalty-kings/game-director) and its Stage adapter ─────────────
// The package decides WHAT to show (phase, intensity, moment deck, keeper rotation, lines); this
// adapter maps each moment onto the Stage calls that exist today. MOMENT_STAGE says, per moment,
// whether the Stage shows it fully, partly, or only as a line, and what is missing.
export { GameDirector, CATALOGUE, MOMENTS, discovery, encodeSeen, decodeSeen, type Beat, type Moment, type Line } from "@penalty-kings/game-director";

/** A Director for this Friend: the engine's keepers, the game's ladder, and the seen code from progress. */
export const createGameDirector = (seed: number, friend: { name: string; number: string }, seen?: string) =>
  new GameDirector({ seed, keepers: KEEPERS, ladder: LADDER, friendName: friend.name, friendNumber: friend.number, seen });

export type StageSupport = "full" | "partial" | "line-only";
type Play = (scene: Stage, moment: DirectorMoment) => void;
export type MomentStaging = Readonly<{ support: StageSupport; uses: string; play: Play; missing?: string }>;
const sfx = (scene: Stage, name: Sfx) => scene.onEvent("sfx", name);
const fireworks = (scene: Stage, bursts: number) => {
  for (let i = 0; i < bursts; i++) scene.particles.emit("firework", 90 + ((i * 97) % 300), 30 + ((i * 37) % 40), 18, { color: ["#ffd23f", "#ff5a6e", "#7fd3ff", "#ccff00", "#ffffff"], speed: 55, spread: Math.PI * 2, life: 1.1, gravity: 30 });
};
const entry = (support: StageSupport, uses: string, play: Play, missing?: string): MomentStaging => ({ support, uses, play, missing });
/** A keeper change walks on (Stage.keeperWalkOn: walk-off, walk-on, taunt; reduced motion: an instant swap). */
const keeperOn: Play = (scene, m) => { if (m.keeper && m.keeper !== scene.keeper) scene.keeperWalkOn(m.keeper); };
const weatherOn: Play = (scene, m) => { if (m.weather) scene.weather = m.weather; };
const nothing: Play = () => {};

/** Every catalogue moment → the Stage calls that show it. playMoment() also says the moment's lines. */
export const MOMENT_STAGE: Readonly<Record<string, MomentStaging>> = {
  "crowd-hush": entry("full", "crowd.react('tense') + sfx heartbeat", s => { s.crowd.react("tense"); sfx(s, "heartbeat"); }),
  "keeper-taunt": entry("full", "taunt()", s => s.taunt()),
  "keeper-tell": entry("full", "say(tell line)", nothing),
  "shot-clock": entry("partial", "sfx beep (the shell's shot clock already draws scene.clock)", s => sfx(s, "beep"), "no pulse/zoom emphasis on the clock"),
  "drumbeat": entry("partial", "sfx heartbeat", s => sfx(s, "heartbeat"), "no drummer sprite in the crowd"),
  "ref-whistle": entry("partial", "sfx whistle", s => sfx(s, "whistle"), "no referee sprite"),
  "keeper-banter": entry("partial", "say(set-up) then say(keeper answer)", nothing, "no Stage.taunt(text): the keeper's answer shows in the commentator box, not the keeper's bubble"),
  "commentator-banter": entry("full", "say(line)", nothing),
  "vuvuzela": entry("partial", "sfx honk", s => sfx(s, "honk"), "no trumpeter in the crowd"),
  "jumbotron-fact": entry("full", "jumbotron text", nothing),
  "ball-glow": entry("full", "say(line)", nothing),
  "keeper-stretch": entry("line-only", "say(line)", nothing, "no keeper stretch animation"),
  "crowd-roar": entry("full", "crowd.react('cheer') + sfx roar", s => { s.crowd.react("cheer"); sfx(s, "roar"); }),
  "crowd-ooh": entry("full", "crowd.react('ooh') + sfx ooh", s => { s.crowd.react("ooh"); sfx(s, "ooh"); }),
  "crowd-groan": entry("full", "crowd.react('groan') + sfx groan", s => { s.crowd.react("groan"); sfx(s, "groan"); }),
  "keeper-gloat": entry("full", "taunt()", s => s.taunt()),
  "streak-chant": entry("full", "sfx chant + crowd.react('cheer')", s => { sfx(s, "chant"); s.crowd.react("cheer"); }),
  "fan-catch": entry("full", "built into the Stage on 'over' (fanCatch)", nothing),
  "ball-kid": entry("full", "built into the Stage on a miss (ballKid)", nothing),
  "scarf-twirl": entry("partial", "crowd.react('cheer')", s => s.crowd.react("cheer"), "no scarf-twirl crowd frame"),
  "air-horn": entry("full", "sfx honk", s => sfx(s, "honk")),
  "slow-clap": entry("partial", "crowd.react('cheer')", s => s.crowd.react("cheer"), "no slow-clap crowd frame"),
  "chin-up": entry("full", "say(cold line) + crowd.react('cheer')", s => s.crowd.react("cheer")),
  "photo-flash": entry("partial", "white 'spark' particles behind the goal", s => s.particles.emit("spark", 240, 150, 14, { color: "#ffffff", speed: 8, spread: Math.PI * 2, life: 0.25, gravity: 0 }), "no photographers' row"),
  "keeper-sub": entry("full", "keeperWalkOn(moment.keeper): walk-off, walk-on, taunt + say(intro)", keeperOn),
  "weather-rain": entry("partial", "scene.weather = 'rain'", weatherOn, "weather switches instantly (no roll-in transition)"),
  "weather-snow": entry("partial", "scene.weather = 'snow'", weatherOn, "weather switches instantly (no roll-in transition)"),
  "weather-fog": entry("partial", "scene.weather = 'fog'", weatherOn, "weather switches instantly (no roll-in transition)"),
  "weather-clear": entry("partial", "scene.weather = 'sun'", weatherOn, "weather switches instantly"),
  "cat-invader": entry("full", "crowd.catActive = true (crowd.drawCat runs it)", s => { if (!s.crowd.catActive) { s.crowd.catActive = true; s.crowd.catX = -20; } }),
  "mexican-wave": entry("full", "wave()", s => s.wave()),
  "jumbotron-replay": entry("partial", "jumbotron 'REPLAY'", nothing, "no replay playback of the last shot on the jumbotron"),
  "kiss-cam": entry("partial", "jumbotron 'KISS CAM'", nothing, "no Kiss Cam art on the jumbotron"),
  "var-check": entry("partial", "jumbotron 'VAR CHECK...' + sfx beep", s => sfx(s, "beep"), "no VAR overlay / freeze-frame of the post"),
  "mascot-race": entry("partial", "jumbotron 'MASCOT RACE'", nothing, "no mascot race animation"),
  "fireworks": entry("full", "'firework' particle bursts + sfx roar", s => { fireworks(s, 4); sfx(s, "roar"); }),
  "beach-ball": entry("line-only", "say(line)", nothing, "no beach ball in the crowd"),
  "pigeon": entry("line-only", "say(line)", nothing, "no pigeon on the crossbar"),
  "floodlight-flicker": entry("line-only", "say(line)", nothing, "no floodlight flicker"),
  "conga": entry("line-only", "say(line)", nothing, "no conga line in the crowd"),
  "tifo": entry("line-only", "say(line)", nothing, "no tifo banner"),
  "drone-cam": entry("line-only", "say(line)", nothing, "no drone camera move"),
  "brass-band": entry("partial", "sfx chant", s => sfx(s, "chant"), "no band sprite or brass sound"),
  "ref-cards": entry("line-only", "say(line)", nothing, "no referee sprite"),
  "rainbow": entry("line-only", "say(line)", nothing, "no rainbow in the sky"),
  "keeper-mind-games": entry("full", "taunt() + say(line)", s => s.taunt()),
  "sprinklers": entry("line-only", "say(line)", nothing, "no sprinklers on the park pitch"),
  "selfie-cam": entry("partial", "jumbotron 'SELFIE CAM'", nothing, "no Selfie Cam art"),
  "boss-appearance": entry("partial", "keeperWalkOn('finalwall') + camera trauma + sfx stomp", (s, m) => { keeperOn(s, m); s.camera.addTrauma(0.4); sfx(s, "stomp"); }, "no bespoke boss entrance (the shared keeper walk-on plays)"),
  "golden-hour": entry("full", "scene.weather = 'sunset' + jumbotron; the shell applies beat.skillScoreMultiplier (free play only)", weatherOn),
  "lights-out": entry("line-only", "say(line) + sfx heartbeat", s => sfx(s, "heartbeat"), "no lights-out spotlight render"),
  "friend-chant": entry("full", "jumbotron '#number' + sfx chant + crowd.react('cheer')", s => { sfx(s, "chant"); s.crowd.react("cheer"); }),
  "walkout": entry("full", "walkout()", s => s.walkout()),
  "card-mosaic": entry("line-only", "say(line)", nothing, "no card mosaic in the stands"),
  "anthem": entry("partial", "sfx chant", s => sfx(s, "chant"), "no anthem audio"),
  "trophy-lap": entry("line-only", "say(line)", nothing, "no standalone trophy (drawTrophy only appears inside a celebration)"),
  "midnight-fireworks": entry("full", "'firework' particle bursts", s => fireworks(s, 7)),
  "legend-in-stands": entry("partial", "jumbotron 'A LEGEND IS WATCHING'", nothing, "no legend cameo in the crowd"),
  "duel-cam": entry("line-only", "say(line)", nothing, "no split-screen camera"),
  "thunderstorm": entry("partial", "scene.weather = 'rain' + camera trauma", (s, m) => { weatherOn(s, m); s.camera.addTrauma(0.25); }, "no lightning flash"),
};

export type Later = (ms: number, run: () => void) => void;
const defaultLater: Later = (ms, run) => { if (ms <= 0) run(); else setTimeout(run, ms); };
/** Milliseconds between queued lines so each can be read. */
export const LINE_GAP_MS = 2400;

/** Say Director lines one after another (a keeper's answer shows as `Keeper: "…"`). Returns when the last one starts + one gap. */
export function sayLines(scene: Stage, lines: readonly DirectorLine[], later: Later = defaultLater, startMs = 0) {
  lines.forEach((line, i) => later(startMs + i * LINE_GAP_MS, () => {
    const text = line.by === "keeper" ? `${keeperById(scene.keeper).name}: "${line.text}"` : line.text;
    scene.say(cueLine({ id: line.id, text }));
  }));
  return startMs + lines.length * LINE_GAP_MS;
}

/**
 * Stage one moment: its effects now, its lines queued. Returns the jumbotron text the shell should hold
 * on screen for a few seconds (the shell's slide loop overwrites scene.jumbotron every 4 s).
 */
export function playMoment(scene: Stage, moment: DirectorMoment, later: Later = defaultLater, startMs = 0): { jumbotron?: string; ms: number } {
  MOMENT_STAGE[moment.id]?.play(scene, moment);
  if (moment.jumbotron) scene.jumbotron = moment.jumbotron;
  return { jumbotron: moment.jumbotron, ms: sayLines(scene, moment.lines, later, startMs) };
}

/** Apply a whole Beat: keeper change, hush, the beat's own lines, then its moments of the given slots. */
export function applyBeat(scene: Stage, beat: DirectorBeat, slots: readonly DirectorMoment["slot"][] = ["before", "reaction", "between"], later: Later = defaultLater) {
  if (beat.keeperChanged && scene.keeper !== beat.keeper) scene.keeperWalkOn(beat.keeper);
  if (beat.hush) scene.crowd.react("tense");
  let at = sayLines(scene, beat.lines, later), jumbotron: string | undefined;
  for (const moment of beat.moments) if (slots.includes(moment.slot)) { const played = playMoment(scene, moment, later, at); at = played.ms; jumbotron = played.jumbotron ?? jumbotron; }
  return { jumbotron, ms: at };
}
