/**
 * GameDirector: a deterministic, seeded match director. It watches what happens (it never decides
 * outcomes) and says what to SHOW: a phase cycle (BUILD-UP → PEAK → RELAX) driven by an intensity model
 * and the kick count, a moment deck with weights, cooldowns, a no-repeat window and a preference for
 * moments the player has not seen yet, keeper rotation for free play, and commentary.
 *
 * Cadence (asserted in test/cadence.test.ts):
 *   every kick      ≥ 1 micro-moment (plus a commentator line),
 *   every 3–4 kicks  one notable moment,
 *   every round (≤ 5 kicks) one set piece.
 *
 * Cosmetic only: no output touches odds, prizes, rarity reveals or anything paid. The one number it
 * emits, skillScoreMultiplier (Golden Hour), is 2 only in FREE_PLAY_MODES and 1 everywhere else.
 */
import { Commentator, type CommentatorState, type Names } from "./commentator.ts";
import { MOMENTS, momentById, type MomentContext, type MomentDef } from "./moments.ts";
import { Rng } from "./rng.ts";
import { decodeSeen, discovery, encodeSeen } from "./seen.ts";
import { FREE_PLAY_MODES, type BallGlow, type Beat, type KeeperId, type KickFacts, type Line, type Moment, type MomentTier, type Phase, type PlayMode, type StadiumId, type TimeOfDay, type Weather } from "./types.ts";

/** The keeper facts the Director needs; pass the engine's KEEPERS. */
export type KeeperInfo = Readonly<{ id: KeeperId; name: string; mult: number; boss?: boolean }>;

export type SessionSetup = Readonly<{
  mode: PlayMode; stadium: StadiumId;
  /** The keeper the shell picked (ladder rung, tour level, daily, Skill Cup). Kept as-is outside free play. */
  keeper: KeeperId;
  weather?: Weather; timeOfDay?: TimeOfDay; glow?: BallGlow;
}>;

export type DirectorOptions = Readonly<{
  seed: number;
  /** The engine's KEEPERS (ids, names, multipliers, boss flag). */
  keepers: readonly KeeperInfo[];
  /** Keeper ladder, easiest first (the game's LADDER). Defaults to the keepers' order. */
  ladder?: readonly KeeperId[];
  friendName?: string;
  /** The Friend's token number, for the crowd chant. */
  friendNumber?: string;
  /** Previously seen moment ids (or an encoded seen code from progress). */
  seen?: Iterable<string> | string;
  /** A snapshot from save(); restores everything else. */
  state?: DirectorSave;
}>;

export type DirectorSave = {
  v: 1; rng: number; kick: number; lastNotable: number; lastSetPiece: number;
  streak: number; misses: number; nearHeat: number; pullHeat: number;
  keeper: KeeperId | null; run: number; maxRun: number; keeperHistory: KeeperId[];
  pendingKeeper: KeeperId | null; bossKick: number; weather: Weather; goldenUntil: number;
  seen: string; firsts: string[]; used: [string, number][]; picks: [string, number][];
  lines: CommentatorState;
};

/** Kicks in a round: one set piece per round. */
export const ROUND_KICKS = 5;
const NOTABLE_MIN = 3, NOTABLE_MAX = 4;
const WINDOW: Readonly<Record<MomentTier, number>> = { micro: 4, notable: 5, "set-piece": 3 };
const UNSEEN_BOOST = 4;
const DEFAULT_SECONDS_PER_KICK = 12;

export class GameDirector {
  readonly keepers: readonly KeeperInfo[];
  readonly ladder: readonly KeeperId[];
  friendName: string; friendNumber: string;

  private rng: Rng;
  private lines = new Commentator();
  private kick = 0;
  private lastNotable = -1; private lastSetPiece = -1;
  private streak = 0; private misses = 0; private nearHeat = 0; private pullHeat = 0;
  private setup: Required<SessionSetup> = { mode: "penalties", stadium: "park", keeper: "mouse", weather: "sun", timeOfDay: "afternoon", glow: "standard" };
  private keeper: KeeperId | null = null; private run = 0; private maxRun = 2; private keeperHistory: KeeperId[] = [];
  private pendingKeeper: KeeperId | null = null; private bossKick = -1;
  private weather: Weather = "sun"; private goldenUntil = -1;
  private seen = new Set<string>(); private firsts = new Set<string>();
  /** Moment id → kick it last played. */
  private used = new Map<string, number>();
  /** Recent picks [id, kick], newest last (the no-repeat window). */
  private picks: [string, number][] = [];
  private phase: Phase = "relax"; private suddenDeath = false; private now = 0;

  constructor(options: DirectorOptions) {
    this.keepers = options.keepers;
    this.ladder = options.ladder ?? options.keepers.map(keeper => keeper.id);
    this.friendName = options.friendName ?? "Your Friend";
    this.friendNumber = options.friendNumber ?? "";
    this.rng = new Rng(options.seed);
    const seen = options.seen === undefined ? [] : typeof options.seen === "string" ? decodeSeen(options.seen) : [...options.seen];
    for (const id of seen) if (momentById(id)) this.seen.add(id);
    if (options.state) this.load(options.state);
  }

  // ── Shell calls ────────────────────────────────────────────────────────────
  /** A new session (round of kicks) starts: the scene the shell chose. Returns the opening line. */
  startSession(setup: SessionSetup): Beat {
    this.setup = { mode: setup.mode, stadium: setup.stadium, keeper: setup.keeper, weather: setup.weather ?? this.weather, timeOfDay: setup.timeOfDay ?? "afternoon", glow: setup.glow ?? "standard" };
    this.weather = this.setup.weather; this.bossKick = -1;
    this.streak = 0; this.misses = 0; this.pendingKeeper = null; this.goldenUntil = -1; this.suddenDeath = false;
    // Pro / Champions free play rotates between sessions (a whole round against one keeper of the harder ladder).
    const keeper = this.freePlay() && setup.stadium !== "park" && this.keeperHistory.length ? this.leastRecent(this.pool()) : setup.keeper;
    this.keeper = keeper; this.run = 0; this.maxRun = this.rollRun(); this.remember(keeper);
    const contexts = this.rng.next() < 0.5 ? [`tell:${keeper}`, `stadium:${setup.stadium}`] : [`time:${this.setup.timeOfDay}`, `stadium:${setup.stadium}`, `tell:${keeper}`];
    const line = this.lines.pick(contexts, this.rng, this.names(keeper), this.clock());
    return this.beat({ moments: [], lines: line ? [line] : [], keeperChanged: keeper !== setup.keeper, hush: false, shotClock: false });
  }

  /** Before each kick (when aiming starts): the keeper for this kick, the phase, pre-kick moments. */
  beforeKick(options: { suddenDeath?: boolean; now?: number; glow?: BallGlow } = {}): Beat {
    this.suddenDeath = Boolean(options.suddenDeath);
    if (options.now !== undefined) this.now = options.now;
    if (options.glow) this.setup = { ...this.setup, glow: options.glow };
    const moments: Moment[] = [], lines: Line[] = [];
    let keeperChanged = this.bossKick === this.kick - 1 && this.kick > 0; // back from the boss's cameo
    if (this.pendingKeeper && this.pendingKeeper !== this.keeper) { this.keeper = this.pendingKeeper; this.run = 0; this.maxRun = this.rollRun(); this.remember(this.keeper); keeperChanged = true; }
    this.pendingKeeper = null;
    // Phase: a set piece is due every round (early when the intensity is high) → PEAK; just after one → RELAX.
    const sinceSet = this.kick - this.lastSetPiece, intensity = this.intensity();
    const setDue = sinceSet >= ROUND_KICKS || (sinceSet >= ROUND_KICKS - 1 && intensity >= 0.75);
    this.phase = setDue ? "peak" : sinceSet <= 1 + (intensity < 0.3 ? 1 : 0) ? "relax" : "build-up";
    if (setDue) {
      const def = this.choose("set-piece", ["before"], this.context(null), this.rng);
      if (def) { moments.push(this.stage(def)); this.lastSetPiece = this.kick; if (def.id === "boss-appearance") keeperChanged = true; }
    }
    if (keeperChanged && !moments.some(m => m.keeper)) { const line = this.lines.pick([`tell:${this.currentKeeper()}`], this.rng, this.names(), this.clock()); if (line) lines.push(line); }
    // A pre-kick micro every kick (pressure in build-up, flavour in relax) unless a set piece is playing.
    if (!moments.length) { const def = this.choose("micro", ["before"], this.context(null), this.rng); if (def) moments.push(this.stage(def)); }
    const ids = moments.map(m => m.id);
    return this.beat({ moments, lines, keeperChanged, hush: ids.includes("crowd-hush") || (this.phase === "build-up" && intensity >= 0.5), shotClock: ids.includes("shot-clock") });
  }

  /** After the kick resolved: the line, the reaction, maybe a notable moment, and the next keeper. */
  afterKick(facts: KickFacts): Beat {
    this.now = facts.now ?? this.now + DEFAULT_SECONDS_PER_KICK;
    const goal = facts.result === "goal";
    const near = !goal && (facts.result === "wide" || facts.result === "over") && (Math.abs(Math.abs(facts.x) - 1) < 0.1 || Math.abs(facts.y - 1) < 0.08);
    const closePost = facts.result === "post" || Boolean(goal && facts.postIn) || (facts.result === "wide" && Math.abs(Math.abs(facts.x) - 1) < 0.06);
    this.streak = goal ? this.streak + 1 : 0;
    this.misses = goal ? 0 : this.misses + 1;
    this.nearHeat = this.nearHeat * 0.6 + (near || closePost ? 0.3 : 0);
    this.pullHeat *= 0.7;
    const keeper = this.currentKeeper();
    const moments: Moment[] = [], lines: Line[] = [];
    const main = this.lines.pick(this.kickContexts(facts, keeper, near), this.rng, this.names(), this.clock(), true);
    if (main) lines.push(main);
    // Keeper rotation for the next kick (decided now so a substitution can be staged between kicks).
    this.run++;
    const bossDone = this.bossKick === this.kick;
    const changeDue = bossDone || (this.rotates() && this.run >= this.maxRun && this.pool().length > 1);
    const ctx = this.context({ facts, near, closePost, changeDue });
    const micro = this.choose("micro", ["reaction"], ctx, this.rng);
    if (micro) moments.push(this.stage(micro));
    const sinceNotable = this.kick - this.lastNotable;
    const notableDue = sinceNotable >= NOTABLE_MAX || (sinceNotable >= NOTABLE_MIN && this.rng.next() < 0.35 + 0.5 * this.intensity());
    let subbed: KeeperId | null = null;
    if (notableDue) {
      const def = this.choose("notable", ["reaction", "between"], ctx, this.rng);
      if (def) { const moment = this.stage(def); moments.push(moment); this.lastNotable = this.kick; if (moment.keeper) subbed = moment.keeper; }
    }
    if (changeDue) this.pendingKeeper = subbed ?? (bossDone ? this.setup.keeper : this.nextKeeper());
    const beat = this.beat({ moments, lines, keeperChanged: false, hush: false, shotClock: false });
    this.kick++;
    return beat;
  }

  /** A big (cosmetic) pull happened: raises the intensity. The Director never learns what it was worth. */
  noteBigPull() { this.pullHeat = Math.min(1, this.pullHeat + 0.5); }

  /** Stage any moment on demand (Showroom buttons). Marks it seen. */
  trigger(id: string): Moment | null {
    const def = momentById(id);
    return def ? this.stage(def) : null;
  }

  // ── Discovery and persistence ─────────────────────────────────────────────
  seenIds() { return MOMENTS.filter(m => this.seen.has(m.id)).map(m => m.id); }
  seenCode() { return encodeSeen(this.seen); }
  discovery() { return discovery(this.seen); }

  save(): DirectorSave {
    return {
      v: 1, rng: this.rng.state, kick: this.kick, lastNotable: this.lastNotable, lastSetPiece: this.lastSetPiece,
      streak: this.streak, misses: this.misses, nearHeat: this.nearHeat, pullHeat: this.pullHeat,
      keeper: this.keeper, run: this.run, maxRun: this.maxRun, keeperHistory: [...this.keeperHistory],
      pendingKeeper: this.pendingKeeper, bossKick: this.bossKick, weather: this.weather, goldenUntil: this.goldenUntil,
      seen: this.seenCode(), firsts: [...this.firsts].sort(), used: [...this.used.entries()], picks: this.picks.map(([id, kick]) => [id, kick]),
      lines: this.lines.save(),
    };
  }
  private load(state: DirectorSave) {
    this.rng.state = state.rng; this.kick = state.kick; this.lastNotable = state.lastNotable; this.lastSetPiece = state.lastSetPiece;
    this.streak = state.streak; this.misses = state.misses; this.nearHeat = state.nearHeat; this.pullHeat = state.pullHeat;
    this.keeper = state.keeper; this.run = state.run; this.maxRun = state.maxRun; this.keeperHistory = [...state.keeperHistory];
    this.pendingKeeper = state.pendingKeeper; this.bossKick = state.bossKick; this.weather = state.weather; this.goldenUntil = state.goldenUntil;
    for (const id of decodeSeen(state.seen)) this.seen.add(id);
    this.firsts = new Set(state.firsts); this.used = new Map(state.used); this.picks = state.picks.map(([id, kick]) => [id, kick]);
    this.lines.load(state.lines);
  }

  // ── Debug (Showroom overlay) ───────────────────────────────────────────────
  debugState() {
    const intensity = this.intensity(), sinceSet = this.kick - this.lastSetPiece, sinceNotable = this.kick - this.lastNotable;
    const preview = this.rng.clone(), ctx = this.context(null);
    const setIn = Math.max(0, ROUND_KICKS - sinceSet);
    const next = setIn === 0 ? this.choose("set-piece", ["before"], ctx, preview) : this.choose("micro", ["before"], ctx, preview);
    return {
      kick: this.kick, round: Math.floor(this.kick / ROUND_KICKS), kickInRound: this.kick % ROUND_KICKS,
      phase: this.phase, intensity: round2(intensity), intensityParts: this.intensityParts(),
      streak: this.streak, misses: this.misses, keeper: this.currentKeeper(), keeperRun: `${this.run}/${this.maxRun}`, pendingKeeper: this.pendingKeeper,
      weather: this.weather, goldenHour: this.golden(), skillScoreMultiplier: this.multiplier(),
      nextMoment: next ? { id: next.id, name: next.name, tier: next.tier } : null,
      nextSetPieceInKicks: setIn, /** After how many more kicks a notable may / must play (0 = after this kick). */
      nextNotableInKicks: [Math.max(0, NOTABLE_MIN - sinceNotable), Math.max(0, NOTABLE_MAX - sinceNotable)] as const,
      cooldowns: Object.fromEntries(MOMENTS.map(m => [m.id, Math.max(0, (this.used.has(m.id) ? this.used.get(m.id)! + m.cooldown + 1 : 0) - this.kick)]).filter(([, left]) => (left as number) > 0)),
      recent: this.picks.slice(-8).map(([id]) => id),
      discovery: this.discovery().label,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────
  private clock() { return this.now || this.kick * DEFAULT_SECONDS_PER_KICK; }
  private freePlay() { return FREE_PLAY_MODES.includes(this.setup.mode); }
  private golden() { return this.goldenUntil >= this.kick; }
  private multiplier(): 1 | 2 { return this.golden() && this.freePlay() ? 2 : 1; }
  private currentKeeper(): KeeperId { return this.bossKick === this.kick ? this.bossId() : this.keeper ?? this.setup.keeper; }
  private bossId(): KeeperId { return (this.keepers.find(k => k.boss) ?? this.keepers[this.keepers.length - 1]).id; }
  private keeperName(id: KeeperId) { return this.keepers.find(k => k.id === id)?.name ?? id; }
  private names(keeper: KeeperId = this.currentKeeper()): Names { return { friend: this.friendName, keeper: this.keeperName(keeper), number: this.friendNumber }; }
  private remember(id: KeeperId) { this.keeperHistory = [...this.keeperHistory.filter(k => k !== id), id].slice(-12); }

  private intensityParts() {
    const sinceMoment = Math.min(this.kick - this.lastNotable, this.kick - this.lastSetPiece);
    return {
      streak: round2(Math.min(1, this.streak / 4) * 0.35),
      nearMiss: round2(Math.min(0.35, this.nearHeat)),
      bigPull: round2(this.pullHeat * 0.3),
      sinceMoment: round2(Math.min(1, sinceMoment / 5) * 0.15),
      missesInRow: round2(Math.min(1, this.misses / 3) * 0.2),
    };
  }
  /** 0 … 1: streaks, near-misses, big pulls, time since the last moment, misses in a row. */
  intensity() { return Math.min(1, Object.values(this.intensityParts()).reduce((a, b) => a + b, 0)); }

  /** Keeper rotation applies to free play only (the shell's keeper is kept for paid, ranked and scripted modes). */
  private rotates() { return this.freePlay(); }
  private rollRun() { return this.setup.stadium === "park" ? 2 + this.rng.int(2) : ROUND_KICKS; }
  /**
   * Rotation pool. Park: the four easiest keepers plus two rungs past the shell's keeper (so new players meet the cast).
   * Pro: keepers with multiplier ≥ 1.25; Champions: ≥ 1.5 (harder ladders), up to one rung past the
   * shell's keeper. The boss only appears through its set piece.
   */
  pool(): KeeperId[] {
    const index = Math.max(0, this.ladder.indexOf(this.setup.keeper));
    const floor = this.setup.stadium === "park" ? 0 : this.setup.stadium === "pro" ? 1.25 : 1.5;
    // Park: meet the cast. The four easiest keepers plus two rungs past the player's level (difficulty stays with the difficulty director).
    const reach = this.setup.stadium === "park" ? Math.max(3, index + 2) : Math.max(0, index + 1);
    const ids = this.ladder.filter((id, i) => {
      const info = this.keepers.find(k => k.id === id);
      return info && !info.boss && i <= reach && info.mult >= floor;
    });
    return ids.includes(this.setup.keeper) ? ids : [this.setup.keeper, ...ids];
  }
  private nextKeeper(): KeeperId {
    const pool = this.pool().filter(id => id !== this.keeper);
    return pool.length ? this.leastRecent(pool) : this.keeper ?? this.setup.keeper;
  }
  /** The keeper met least recently (never met first), with a seeded tie-break between the two oldest. */
  private leastRecent(pool: readonly KeeperId[]): KeeperId {
    const age = (id: KeeperId) => { const i = this.keeperHistory.indexOf(id); return i < 0 ? -1 : i; };
    const oldest = Math.min(...pool.map(age));
    const candidates = pool.filter(id => age(id) === oldest || age(id) <= oldest + 1);
    return candidates[this.rng.int(candidates.length)];
  }

  private context(after: { facts: KickFacts; near: boolean; closePost: boolean; changeDue: boolean } | null): MomentContext {
    return {
      phase: this.phase, intensity: this.intensity(), mode: this.setup.mode, stadium: this.setup.stadium, weather: this.weather, timeOfDay: this.setup.timeOfDay,
      keeper: this.currentKeeper(), kickInRound: this.kick % ROUND_KICKS, streak: this.streak, misses: this.misses,
      result: after?.facts.result ?? null, nearMiss: after?.near ?? false, closePost: after?.closePost ?? false, zone: after?.facts.zone ?? null,
      suddenDeath: this.suddenDeath, freePlay: this.freePlay(), friendNumber: this.friendNumber, glow: this.setup.glow,
      keeperChangeDue: after?.changeDue ?? false,
    };
  }

  /** The deck: eligible moments of a tier, weighted by phase fit and novelty, outside cooldown and the no-repeat window. */
  private choose(tier: MomentTier, slots: readonly string[], ctx: MomentContext, rng: Rng): MomentDef | null {
    const eligible = MOMENTS.filter(m => m.tier === tier && slots.includes(m.slot) && (!m.when || m.when(ctx)));
    if (!eligible.length) return null;
    const window = this.picks.filter(([id]) => momentById(id)?.tier === tier).slice(-WINDOW[tier]).map(([id]) => id);
    const fresh = eligible.filter(m => !window.includes(m.id) && (!this.used.has(m.id) || this.kick - this.used.get(m.id)! > m.cooldown));
    const inPhase = (list: readonly MomentDef[]) => list.filter(m => m.phases.includes(ctx.phase));
    const pool = inPhase(fresh).length ? inPhase(fresh) : fresh;
    if (pool.length) return pool[rng.weighted(pool.map(m => m.weight * (this.seen.has(m.id) ? 1 : UNSEEN_BOOST)))];
    // Everything is cooling down: the least recently used eligible moment (in phase when possible).
    const rest = inPhase(eligible).length ? inPhase(eligible) : eligible;
    return rest.reduce((best, m) => ((this.used.get(m.id) ?? -1) < (this.used.get(best.id) ?? -1) ? m : best));
  }

  /** Turn a definition into a Moment: payload, lines, and bookkeeping (seen, cooldown, window). */
  private stage(def: MomentDef): Moment {
    this.seen.add(def.id); this.used.set(def.id, this.kick); this.picks.push([def.id, this.kick]); if (this.picks.length > 24) this.picks.shift();
    let keeper: KeeperId | undefined, weather: Weather | undefined, jumbotron: string | undefined;
    const lines: Line[] = [], now = this.clock();
    const say = (contexts: string[], names = this.names()) => { const line = this.lines.pick(contexts, this.rng, names, now); if (line) lines.push(line); };
    switch (def.id) {
      case "keeper-sub": keeper = this.nextKeeper(); say(["moment:keeper-sub"], this.names(keeper)); break;
      case "boss-appearance": keeper = this.bossId(); this.bossKick = this.kick; say(["moment:boss-appearance"], this.names(keeper)); break;
      case "weather-rain": case "thunderstorm": weather = "rain"; break;
      case "weather-snow": weather = "snow"; break;
      case "weather-fog": weather = "fog"; break;
      case "weather-clear": weather = "sun"; break;
      case "golden-hour": weather = "sunset"; this.goldenUntil = this.kick + ROUND_KICKS - 1; jumbotron = "GOLDEN HOUR · DOUBLE SKILL POINTS"; break;
      case "friend-chant": jumbotron = this.friendNumber ? `#${this.friendNumber} #${this.friendNumber} #${this.friendNumber}` : `${this.friendName.toUpperCase()}!`; break;
      case "jumbotron-replay": jumbotron = "REPLAY"; break;
      case "kiss-cam": jumbotron = "KISS CAM"; break;
      case "var-check": jumbotron = "VAR CHECK..."; break;
      case "selfie-cam": jumbotron = "SELFIE CAM"; break;
      case "jumbotron-fact": jumbotron = this.rng.pick(FACTS); break;
      case "legend-in-stands": jumbotron = "A LEGEND IS WATCHING"; break;
      case "mascot-race": jumbotron = "MASCOT RACE"; break;
    }
    if (weather) this.weather = weather;
    if (def.id === "keeper-tell") say([`tell:${this.currentKeeper()}`, "moment:keeper-tell"]);
    else if (def.id === "keeper-banter") { const pair = this.lines.banter(this.currentKeeper(), this.rng, this.names(), now); if (pair) lines.push(...pair); }
    else if (def.id === "commentator-banter") say(this.rng.next() < 0.5 ? [`time:${this.setup.timeOfDay}`, `stadium:${this.setup.stadium}`, "banter"] : ["banter", `stadium:${this.setup.stadium}`, `time:${this.setup.timeOfDay}`]);
    else if (def.id === "ball-glow") say([`glow:${this.setup.glow}`, "moment:ball-glow"]);
    else if (def.id === "chin-up") say(["cold", "moment:chin-up"]);
    else if (def.id === "crowd-hush") say(["moment:crowd-hush", "buildup"]);
    else if (def.id !== "keeper-sub" && def.id !== "boss-appearance") say([`moment:${def.id}`]);
    return { id: def.id, name: def.name, tier: def.tier, slot: def.slot, ...(keeper ? { keeper } : {}), ...(weather ? { weather } : {}), ...(jumbotron ? { jumbotron } : {}), lines };
  }

  /** Line contexts for a kick result, most specific first; first-time events always lead. */
  private kickContexts(facts: KickFacts, keeper: KeeperId, near: boolean): string[] {
    const goal = facts.result === "goal";
    const out: string[] = [];
    const first = (event: string) => { if (this.firsts.has(event)) return; this.firsts.add(event); out.push(`first:${event.startsWith("beat:") ? "beat" : event}`); };
    if (facts.kind === "target") return [goal ? "cheer" : "miss"];
    if (goal) {
      const special = facts.postIn ? "post-in" : facts.screamer && facts.kind === "freekick" ? "screamer" : facts.knuckle ? "knuckle" : facts.kind === "penalty" && facts.zone === "centre" && facts.y >= 0.55 ? "panenka" : facts.kind === "freekick" && Math.abs(facts.spin ?? 0) >= 0.45 ? "curler" : null;
      first("goal"); if (facts.zone === "bin") first("bin"); if (special) first(special); first(`beat:${keeper}`);
      if (special) out.push(`goal:${special}`);
      const mixed = [`goal:${facts.zone}`, this.streak >= 5 ? "streak:5" : this.streak >= 3 ? "streak:3" : this.streak === 2 ? "streak:2" : "", `goal:vs:${keeper}`].filter(Boolean);
      for (let i = mixed.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); [mixed[i], mixed[j]] = [mixed[j], mixed[i]]; }
      out.push(...mixed, "goal", "cheer");
      return out;
    }
    if (facts.result === "save") first("save");
    if (this.misses >= 3) out.push("cold");
    if (facts.result === "wall") out.push("wall");
    else if (facts.result === "post") out.push(facts.y > 0.9 ? "crossbar" : "post");
    else if (near) out.push("near-miss");
    if (facts.result === "save") out.push(...(this.rng.next() < 0.4 ? [`save:by:${keeper}`, "save"] : ["save", `save:by:${keeper}`]));
    else if (facts.result === "over" || facts.result === "wide") out.push(facts.result);
    out.push("miss");
    return out;
  }

  private beat(parts: { moments: Moment[]; lines: Line[]; keeperChanged: boolean; hush: boolean; shotClock: boolean }): Beat {
    return {
      kick: this.kick, round: Math.floor(this.kick / ROUND_KICKS), kickInRound: this.kick % ROUND_KICKS,
      phase: this.phase, intensity: round2(this.intensity()), keeper: this.currentKeeper(), keeperChanged: parts.keeperChanged,
      moments: parts.moments, lines: parts.lines, hush: parts.hush, shotClock: parts.shotClock, skillScoreMultiplier: this.multiplier(),
    };
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const FACTS = ["FUN FACT: THE BALL IS ROUND", "PIES SOLD TODAY: LOTS", "LOUDEST FAN: ROW F", "WIND: GENTLE. NERVES: HIGH", "MASCOT MOOD: EXCELLENT", "GRASS LENGTH: 25 MM EXACTLY"];
