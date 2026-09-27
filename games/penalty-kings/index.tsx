"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { maximumPrize, type GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import {
  KEEPERS, keeperById, kickSeed, keeperPlan, resolveShot, resolveFreeKick, freeKickSetup, goalPoints, streakMultiplier, shotTarget, clamp,
  swipeToShot, assistShot, aimWobble, wobbleFor, nextDifficultyLevel, DIFFICULTY_LADDER, NEUTRAL,
  type KeeperId, type ShotInput, type FreeKickShot, type FreeKickSetup, type SwipePoint, type Difficulty, type ShotResult,
} from "@penalty-kings/engine";
import { RARITIES, TIERS, ALL_COSMETICS, CUP_CURVE, CUP_SHARE_OF_PRICE, SIM_CUP_SEED_RF, SIM_CUP_SEED_GBOOT, WILDCARD_PRICE, SKILL_CUP_ENTRY, SIM_STARTING_GBOOT, tierForPrice, formatNumber, celebrationOf, type Cosmetic } from "./economy.js";
import { Stage, RARITY_NAMES } from "./gfx/stage.js";
import { W, H } from "./gfx/core.js";
import { weatherForDay } from "./gfx/stadium.js";
import type { CelebrationId } from "./gfx/friend.js";
import { createCrowd, type Crowd } from "./audio.js";
import { loadProgress, saveProgress, levelFromXp, isUnlocked, nextRung, assistLevel, XP, MODES, type Progress, type ModeId } from "./game/progress.js";
import { starsFor, type Level, type KickRecord } from "./game/objectives.js";
import levelsData from "./game/levels.json" with { type: "json" };
import { dailyScenario, dailyState, utcDate, dateSeed, DAILY_ATTEMPTS, type DailyScenario } from "./game/daily.js";
import { spawnTargets, targetAt, resolveTargetShot, TARGET_SECONDS, type Target } from "./game/target.js";
import { revealPlan } from "./game/reveal.js";
import { potBanner, jumbotronSlides, prizeLine, type PrizeSource } from "./game/prizes.js";
import { swipeToFreeKick, keyShot, keyFreeKick, type KeyAim } from "./game/input.js";
import { BallCase, OddsTable, StadiumPrices, ModeSelect, TourMap, LevelBrief, DailyCard, ScoutingBook, Results, rungName, type SessionSummary } from "./ui.js";
import liveConfig from "./live.json" with { type: "json" };
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const LEVELS = levelsData as unknown as Level[];
type Menu = "hub" | "kitbag" | "odds" | "locker" | "cups" | "shop" | "book" | "tour" | "daily" | "settings" | "rules" | "results" | null;
type Screen = "title" | "modes" | "play";
type Phase = "idle" | "reveal" | "aim" | "shooting";
type PlayMode = ModeId | "tutorial";
type Session = {
  mode: PlayMode; kind: "penalty" | "freekick" | "target"; keeper: KeeperId; seed: number; total: number;
  kicks: KickRecord[]; points: number; streak: number; rung: number;
  level?: Level; daily?: DailyScenario; setup?: FreeKickSetup;
  suddenDeath?: boolean; ball?: { playId: bigint; outcomeId: number };
  target?: { startedAt: number; round: number; targets: Target[]; combo: number; hits: number };
  earned: { rf: bigint; gboot: number; race: number };
};
type SkillEntry = { id: number; name: string; score: number; mine: boolean };

const RULE = "Your kick never changes what you win. Ball rarity is decided by on-chain randomness. Skill is for glory, stars, streaks and the Skill Cup.";
const RIVALS = ["Rival Friend A", "Rival Friend B", "Rival Friend C", "Rival Friend D", "Rival Friend E", "Rival Friend F", "Rival Friend G", "Rival Friend H", "Rival Friend I", "Rival Friend J", "Rival Friend K"];
const SIM_RACE = [2400, 1900, 1500, 1210, 1000, 820, 640, 500, 360, 240, 120];
const SIM_SKILL = [9350, 7900, 6120, 4600, 3800];
const LABELS: Record<ShotResult | "wall", string> = { goal: "GOAL!", save: "SAVED!", post: "OFF THE POST!", over: "OVER THE BAR!", wide: "WIDE!", wall: "BLOCKED!" };
const vibrate = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* iPhone Safari: unsupported, skip */ } };

/** Penalty Kings. The SDK runtime supplies the verified Friend, the fixed action client and pause state. */
export default function PenaltyKings({ friendId, client, paused }: GameComponentProps) {
  const definition = client.definition;
  const tier = tierForPrice(Number(definition.price / 10n ** 18n));
  const simulated = client.mode === "preview";
  const tag = simulated ? " (sim)" : "";
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [screen, setScreen] = useState<Screen>("title");
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true), [reducedMotion, setReducedMotion] = useState(false), [haptics, setHaptics] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [banner, setBanner] = useState<{ text: string; sub: string; tone: string } | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [pendingLevel, setPendingLevel] = useState<Level | null>(null);
  const [gboot, setGboot] = useState(simulated ? SIM_STARTING_GBOOT : 0), [burned, setBurned] = useState(0);
  const [cupRF, setCupRF] = useState(SIM_CUP_SEED_RF), [cupGboot, setCupGboot] = useState(SIM_CUP_SEED_GBOOT);
  const [race, setRace] = useState(0), [wildcards, setWildcards] = useState(0);
  const [lastBigPull, setLastBigPull] = useState<string | null>(null);
  const [owned, setOwned] = useState<Set<string>>(() => new Set(ALL_COSMETICS.filter(item => item.price === 0 && !item.name.includes("★")).map(item => item.id)));
  const [equipped, setEquipped] = useState<Record<Cosmetic["kind"], string>>({ boots: "boots-classic", kit: "kit-white", net: "net-white", celebration: "cele-knee-slide" });
  const [skill, setSkill] = useState<SkillEntry[]>(() => SIM_SKILL.map((points, index) => ({ id: index + 1, name: RIVALS[index], score: points, mine: false })));
  const [artStatus, setArtStatus] = useState("Loading your Friend…");
  const [now, setNow] = useState(() => Date.now());
  const [portrait, setPortrait] = useState(false);

  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const sprites = useRef<GenerationSprites | null>(null);
  const sound = useRef<FriendSoundKit | null>(null), crowd = useRef<Crowd | null>(null);
  const locked = useRef(false), epoch = useRef(0);
  const swipe = useRef<SwipePoint[] | null>(null);
  const keys = useRef(new Set<string>());
  const keyAim = useRef<KeyAim & { charging: boolean; chargeStart: number }>({ aimX: 0.5, loft: 0, lift: 0.55, curl: 0, top: 0, power: 0, charging: false, chargeStart: 0 });
  const aimStarted = useRef(0);
  const pendingKick = useRef<{ record: KickRecord; result: ShotResult | "wall" } | null>(null);
  const live = useRef({ paused, menu, phase, session, screen });
  live.current = { paused, menu, phase, session, screen };
  // Long-lived callbacks (Stage loop, stage events, key listeners) call the LATEST handlers.
  const latest = useRef({ tickAim: (_dt: number) => {}, onResolved: (_r: ShotResult | "wall") => {}, onKickDone: () => {}, playSfx: (_n: string) => {}, shootPenalty: (_s: ShotInput) => {}, shootFreeKick: (_s: FreeKickShot) => {}, startAim: () => {}, haptics: true });

  const maxPrize = maximumPrize(definition);
  const pending = snapshot?.plays.find(play => play.outcomeId === null) ?? null;
  const stadiumFull = snapshot ? snapshot.freeStake < maxPrize || snapshot.freeStake + definition.price < maxPrize : false;
  const canBuy = snapshot ? snapshot.rfBalance >= definition.price && !stadiumFull : false;
  const today = utcDate(new Date(now));
  const { level: playerLevel, into, next } = levelFromXp(progress.xp);
  const assist = assistLevel(progress, tier.id);
  const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
  const rfNumber = (value: bigint) => Number(value / 10n ** 15n) / 1000;

  // Prize source: the SDK's (simulated) ledger + the simulated Cup ledger in preview; on-chain reads only when live.
  const prizeSource: PrizeSource = simulated
    ? { kind: "simulated", potRF: cupRF, topPrizeRF: rfNumber(maxPrize), freeStakeRF: snapshot ? rfNumber(snapshot.freeStake) : 0 }
    : { kind: "live", potRF: null, topPrizeRF: rfNumber(maxPrize), freeStakeRF: snapshot ? rfNumber(snapshot.freeStake) : null, usdPerRF: null, readAt: snapshot ? now : null };
  const pot = potBanner(prizeSource, now);
  const raceTable = [...SIM_RACE.map((points, index) => ({ name: RIVALS[index], points, mine: false })), { name: "Your Friend", points: race, mine: true }].sort((a, b) => b.points - a.points);
  const raceRank = raceTable.findIndex(row => row.mine) + 1;

  useEffect(() => { saveProgress(progress); }, [progress]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    const query = window.matchMedia("(orientation: portrait) and (max-width: 700px)");
    const update = () => setPortrait(query.matches); update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Session start: snapshot, Friend artwork, sound, motion preference.
  useEffect(() => {
    const version = ++epoch.current;
    sound.current = createFriendSoundKit({ muted: true }); crowd.current = createCrowd();
    setSnapshot(null); setError(""); setMenu(null); setPhase("idle"); setSession(null); setScreen("title"); locked.current = false;
    void client.read().then(value => { if (version === epoch.current) setSnapshot(value); }).catch(cause => {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load the game.");
    });
    sprites.current = null; setArtStatus("Loading your Friend…");
    createFriendReader().read(friendId).then(value => { if (version === epoch.current) { sprites.current = value; setArtStatus(""); } })
      .catch(() => { if (version === epoch.current) setArtStatus("Friend artwork unavailable. Playing with a placeholder."); });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches); update(); preference.addEventListener("change", update);
    return () => { epoch.current++; sound.current?.dispose(); crowd.current?.dispose(); preference.removeEventListener("change", update); };
  }, [client, friendId]);

  // Live mode: cosmetics come from on-chain KitShop unlocks for this Friend (read-only RPC).
  useEffect(() => {
    const kitShop = (liveConfig as { kitShop?: string }).kitShop;
    if (simulated || !kitShop) return;
    let active = true;
    const word = (value: bigint) => value.toString(16).padStart(64, "0");
    // unlocked(uint256 friendId, uint256 itemId) — selector 0x310f2de6 (cast sig); plain eth_call keeps the bundle small.
    const read = (index: number) => fetch("https://rpc.mainnet.chain.robinhood.com", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: index, method: "eth_call", params: [{ to: kitShop, data: `0x310f2de6${word(friendId)}${word(BigInt(index))}` }, "latest"] }) })
      .then(response => response.json()).then(body => { if (body.error || typeof body.result !== "string") throw new Error("read failed"); return BigInt(body.result) === 1n; });
    Promise.all(ALL_COSMETICS.slice(0, 15).map((_, index) => read(index)))
      .then(values => { if (active) setOwned(current => new Set([...current, ...ALL_COSMETICS.slice(0, 15).filter((item, index) => item.price === 0 || values[index]).map(item => item.id)])); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [simulated, friendId]);

  // Star rewards are owned once earned.
  useEffect(() => { if (progress.rewards.length) setOwned(current => new Set([...current, ...progress.rewards])); }, [progress.rewards]);

  // ── The Stage loop ──────────────────────────────────────────────────────
  const ready = snapshot !== null;
  useEffect(() => {
    const node = canvas.current, context = node?.getContext("2d");
    if (!node || !context) return;
    const scene = new Stage({ stadium: tier.id, weather: weatherForDay(), keeper: "squirrel" });
    stage.current = scene;
    scene.rows = (facing, walking, frame) => (sprites.current ? spriteFrame(sprites.current, facing, walking, frame, "right").frame.rows : null);
    scene.friendName = `Friend #${friendId}`;
    scene.onEvent = (event, data) => {
      const h = latest.current;
      if (event === "sfx") h.playSfx(data as string);
      if (event === "reveal") { const plan = data as ReturnType<typeof revealPlan>; crowd.current?.reveal(plan.pitch, plan.fullScreen); sound.current?.play(plan.tier >= 5 ? "reveal-legendary" : plan.tier >= 3 ? "reveal-rare" : "reveal-common"); }
      if (event === "strike" && h.haptics) vibrate(15);
      if (event === "resolved") h.onResolved(data as ShotResult | "wall");
      if (event === "done") h.onKickDone();
      if (event === "reveal-done") setPhase(current => (current === "reveal" ? "reveal" : current));
    };
    let frame = 0, last = performance.now();
    const loop = (time: number) => {
      const current = live.current, frozen = current.paused || document.hidden;
      const dt = frozen ? 0 : Math.min(0.05, (time - last) / 1000); last = time;
      latest.current.tickAim(dt);
      scene.update(dt);
      scene.render(context);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const stopKeys = () => keys.current.clear();
    window.addEventListener("blur", stopKeys);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("blur", stopKeys); stage.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Keep the Stage in sync with settings, cosmetics and prize displays.
  useEffect(() => { stage.current?.setReduced(reducedMotion); }, [reducedMotion, ready]);
  useEffect(() => {
    const scene = stage.current; if (!scene) return;
    const colour = (kind: Cosmetic["kind"]) => ALL_COSMETICS.find(item => item.id === equipped[kind])?.color;
    scene.layers = { ...scene.layers, halo: colour("kit") ?? "#ffffff", boots: colour("boots") ?? "#111111" };
    scene.net.color = colour("net") ?? "#e8e8e8";
    scene.celebration = celebrationOf(equipped.celebration) as CelebrationId;
  }, [equipped, ready]);
  useEffect(() => {
    const scene = stage.current; if (!scene) return;
    const slides = jumbotronSlides(prizeSource, now, { rank: race > 0 ? raceRank : null, lastBigPull });
    scene.jumbotron = slides[Math.floor(now / 4000) % slides.length];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, ready, cupRF, race, lastBigPull]);

  function playSfx(name: string) {
    const c = crowd.current, s = sound.current;
    if (name === "kick") { c?.kick(); s?.play("impact"); }
    else if (name === "whistle") c?.whistle();
    else if (name === "roar" || name === "chant") c?.roar();
    else if (name === "groan") c?.groan();
    else if (name === "ooh") c?.ooh();
    else if (name === "clang") c?.post();
    else if (name === "net") s?.play("reward");
    else if (name === "glove" || name === "stomp" || name === "heartbeat") c?.thud();
  }

  // ── Difficulty for the current kick ─────────────────────────────────────
  function difficultyFor(current: Session): Difficulty {
    if (current.mode === "skill") return NEUTRAL; // the referee's rules
    if (current.mode === "tutorial") return { ...DIFFICULTY_LADDER[0], clock: 0 };
    return DIFFICULTY_LADDER[current.rung];
  }
  const clockFor = (current: Session) => (current.mode === "tutorial" || current.kind === "target" ? 0 : difficultyFor(current).clock);

  // ── Aiming (keyboard, clock, live previews) ─────────────────────────────
  function tickAim(dt: number) {
    const current = live.current, scene = stage.current;
    if (!scene || current.phase !== "aim" || !current.session || current.menu || current.paused) { if (scene) scene.clock = null; return; }
    const s = current.session, k = keys.current, am = keyAim.current;
    if (k.has("ArrowLeft")) am.aimX = clamp(am.aimX - dt * 1.2, -1.4, 1.4);
    if (k.has("ArrowRight")) am.aimX = clamp(am.aimX + dt * 1.2, -1.4, 1.4);
    if (k.has("ArrowUp")) { am.loft = clamp(am.loft + dt * 0.5, -0.3, 0.3); am.lift = clamp(am.lift + dt * 0.6, 0, 1); }
    if (k.has("ArrowDown")) { am.loft = clamp(am.loft - dt * 0.5, -0.3, 0.3); am.lift = clamp(am.lift - dt * 0.6, 0, 1); }
    if (am.charging) am.power = clamp((performance.now() - am.chargeStart) / 1100, 0, 1);
    // Shot clock: a timeout counts as a miss.
    const total = clockFor(s);
    if (total > 0) {
      const left = total - (performance.now() - aimStarted.current) / 1000;
      scene.clock = { left: Math.max(0, left), total };
      if (left <= 0) { timeout(); return; }
    } else scene.clock = null;
    // Live aim display: reticle (penalties/target) or trajectory preview (free kicks), faded by assist.
    const wobble = aimWobble(performance.now() / 1000, wobbleFor(difficultyFor(s), s.streak));
    if (s.kind === "freekick" && s.setup) {
      const partial = swipe.current && swipe.current.length > 2 ? swipeToFreeKick(swipe.current, { width: W, height: H }) : null;
      const shot = partial ?? keyFreeKick({ ...am, power: am.charging ? am.power : 0.6 });
      const outcome = resolveFreeKick(s.setup, { ...shot, aimX: shot.aimX + wobble / 1.6 }, keeperById(s.keeper), difficultyFor(s));
      scene.preview = { path: outcome.path, alpha: Math.max(assist, 0.25) };
    } else {
      const partial = swipe.current && swipe.current.length > 2 ? swipeToShot(swipe.current, { width: W, height: H }) : null;
      const shot = partial ?? keyShot({ ...am, power: am.charging ? am.power : 0.7 });
      const target = shotTarget({ ...shot, aimX: shot.aimX + wobble });
      scene.reticle = { x: target.x - shot.curl * 0.3, y: target.y, power: shot.power, curl: shot.curl, active: Boolean(partial) || am.charging };
    }
    if (s.kind === "target" && s.target) {
      const t = (performance.now() - s.target.startedAt) / 1000;
      scene.targets = s.target.targets.map(target => ({ ...targetAt(target, t), r: target.r, value: target.value }));
      if (t >= TARGET_SECONDS) endSession(s);
    }
  }

  // ── Sessions ────────────────────────────────────────────────────────────
  function newSession(mode: PlayMode, extra: Partial<Session> = {}): Session {
    const ladder = nextRung(progress);
    const base: Session = { mode, kind: "penalty", keeper: ladder, seed: (Date.now() ^ Number(friendId % 100000n)) >>> 0, total: 5, kicks: [], points: 0, streak: 0, rung: progress.difficulty, earned: { rf: 0n, gboot: 0, race: 0 } };
    if (mode === "tutorial") return { ...base, keeper: "mouse", total: 3, ...extra };
    if (mode === "freekicks") return { ...base, kind: "freekick", total: 3, setup: freeKickSetup(base.seed, { maxWind: tier.id === "champions" ? 0 : 4 }), ...extra };
    if (mode === "target") return { ...base, kind: "target", total: 0, target: { startedAt: performance.now(), round: 0, targets: spawnTargets(base.seed, 0), combo: 0, hits: 0 }, ...extra };
    if (mode === "skill") return { ...base, keeper: "finalwall", ...extra };
    if (mode === "match") return { ...base, keeper: progress.stamps.includes(ladder) ? ladder : ladder, ...extra };
    return { ...base, ...extra };
  }

  function beginSession(next: Session) {
    const scene = stage.current;
    setSession(next); setSummary(null); setMenu(null); setScreen("play"); setBanner(null); setMessage("");
    if (scene) {
      scene.kind = next.kind; scene.keeper = next.keeper; scene.streak = 0; scene.setScore(0);
      scene.hints = next.mode === "tutorial" ? 1 : next.mode === "penalties" && assist > 0.5 ? 0.45 : 0;
      scene.freeKick = next.kind === "freekick" && next.setup ? { setup: next.setup, wall: resolveFreeKick(next.setup, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeperById(next.keeper)).wall } : null;
      scene.targets = []; scene.preview = null;
      scene.rarity = next.mode === "match" ? scene.rarity : 7;
      scene.say(next.kind === "freekick" ? "freekick" : next.kind === "target" ? "target" : keeperById(next.keeper).boss ? "boss" : "keeper");
    }
    if (next.mode === "match") { setPhase("idle"); return; }
    startAim(next);
  }

  function startMode(mode: ModeId) {
    void unlockAudio(); setError("");
    if (mode === "tour") { setMenu("tour"); return; }
    if (mode === "daily") { setMenu("daily"); return; }
    if (mode === "penalties" && !progress.tutorialDone) { beginSession(newSession("tutorial")); setMessage("Tutorial: swipe up from the ball. Where you release decides the shot. The coloured zones show the multipliers."); return; }
    if (mode === "skill") { enterSkillCup(); return; }
    beginSession(newSession(mode));
  }

  function startLevel(level: Level) {
    const setup = level.setup ? freeKickSetup(dateSeed(level.id), { distance: level.setup.distance, angle: level.setup.angle, wallSize: level.setup.wallSize }) : undefined;
    beginSession(newSession("tour", { kind: level.mode === "freekick" ? "freekick" : "penalty", keeper: level.keeper, total: level.kicks, level, setup: setup ? { ...setup, wind: level.setup?.wind ?? 0 } : undefined, seed: dateSeed(level.id) }));
    setPendingLevel(null);
  }

  function startDaily() {
    const scenario = dailyScenario(today);
    const record = dailyState(progress.daily, today);
    if (record.attempts >= DAILY_ATTEMPTS) return;
    setProgress(p => ({ ...p, daily: { ...record, attempts: record.attempts + 1 } }));
    beginSession(newSession("daily", { kind: scenario.mode === "freekick" ? "freekick" : "penalty", keeper: scenario.keeper, total: scenario.kicks, daily: scenario, setup: scenario.setup, seed: scenario.seed }));
  }

  function startAim(current: Session | null = live.current.session) {
    const scene = stage.current;
    keyAim.current = { ...keyAim.current, power: 0, charging: false, loft: 0, curl: 0, top: 0 };
    aimStarted.current = performance.now();
    if (scene && current) {
      scene.ballVisible = true;
      if (current.kind !== "target") {
        const index = current.kicks.length;
        scene.tell = keeperPlan(keeperById(current.keeper), kickSeed(current.seed, index, current.keeper), { x: 0, y: 0.5 }, { kickIndex: index, history: current.kicks.map(kick => kick.x) });
      }
    }
    setPhase("aim"); setMenu(null);
  }

  // ── Shooting ────────────────────────────────────────────────────────────
  function shootPenalty(raw: ShotInput) {
    const current = live.current.session, scene = stage.current;
    if (!current || !scene || live.current.phase !== "aim") return;
    const difficulty = difficultyFor(current);
    const wobble = aimWobble(performance.now() / 1000, wobbleFor(difficulty, current.streak));
    const shot = assistShot({ ...raw, aimX: raw.aimX + wobble }, Math.max(difficulty.assist, current.mode === "skill" ? 0 : assist * 0.5));
    const index = current.kicks.length;
    if (current.kind === "target" && current.target) {
      const t = (performance.now() - current.target.startedAt) / 1000;
      const hit = resolveTargetShot(shot, current.target.targets, t, current.target.combo);
      const target = shotTarget(shot);
      const result: ShotResult = Math.abs(target.x) > 1 ? "wide" : target.y > 1 ? "over" : hit.hit || hit.crossbar ? "goal" : "save";
      pendingKick.current = { record: { result, zone: "centre", points: hit.points, x: target.x, y: target.y }, result };
      setSession({ ...current, target: { ...current.target, combo: hit.combo, hits: current.target.hits + (hit.hit ? 1 : 0), targets: hit.hit ? current.target.targets.filter(item => item !== hit.hit) : current.target.targets } });
      scene.play({ result, target, plan: keeperPlan(keeperById("mouse"), 1, target), zone: "centre", postIn: false }, shot.curl);
      setPhase("shooting");
      return;
    }
    const profile = keeperById(current.keeper);
    const seed = current.mode === "match" && current.ball ? kickSeed(Number(current.ball.playId), index, profile.id) : kickSeed(current.seed, index, profile.id);
    const outcome = resolveShot(shot, profile, seed, { kickIndex: index, history: current.kicks.map(kick => kick.x) }, difficulty);
    const ballMult = current.mode === "match" && current.ball ? RARITIES[current.ball.outcomeId - 1].dropMult : 1;
    const points = outcome.result === "goal" ? goalPoints(profile, ballMult, current.streak + 1, Boolean(current.suddenDeath), outcome.zone, outcome.postIn) : 0;
    pendingKick.current = { record: { result: outcome.result, zone: outcome.zone, points, postIn: outcome.postIn, x: outcome.target.x, y: outcome.target.y }, result: outcome.result };
    scene.play(outcome, shot.curl);
    setPhase("shooting");
  }

  function shootFreeKick(raw: FreeKickShot) {
    const current = live.current.session, scene = stage.current;
    if (!current || !scene || !current.setup || live.current.phase !== "aim") return;
    const difficulty = difficultyFor(current);
    const wobble = aimWobble(performance.now() / 1000, wobbleFor(difficulty, current.streak)) / 1.6;
    const shot = { ...raw, aimX: raw.aimX + wobble };
    const profile = keeperById(current.keeper);
    const outcome = resolveFreeKick({ ...current.setup, seed: kickSeed(current.seed, current.kicks.length, profile.id) }, shot, profile, difficulty);
    const points = outcome.result === "goal" ? goalPoints(profile, 1, current.streak + 1, false, outcome.zone) * (outcome.knuckle ? 2 : 1) : 0;
    pendingKick.current = { record: { result: outcome.result, zone: outcome.zone, points, x: outcome.target.x, y: outcome.target.y, spin: shot.spin, knuckle: outcome.knuckle }, result: outcome.result };
    if (outcome.knuckle) scene.say("knuckle");
    scene.playFreeKick(outcome);
    setPhase("shooting");
  }

  function timeout() {
    const current = live.current.session;
    if (!current) return;
    pendingKick.current = { record: { result: "wide", zone: "centre", points: 0, x: 0, y: 0 }, result: "wide" };
    setBanner({ text: "TIME!", sub: "The shot clock ran out: that counts as a miss.", tone: "miss" });
    setPhase("shooting");
    window.setTimeout(() => { onResolved("wide", true); onKickDone(); }, 900);
  }

  // ── Results of a kick ───────────────────────────────────────────────────
  function onResolved(result: ShotResult | "wall", timedOut = false) {
    const current = live.current.session, kick = pendingKick.current;
    if (!current || !kick) return;
    const record = kick.record, goal = record.result === "goal";
    if (goal && haptics) vibrate([40, 30, 40]);
    const streak = goal ? current.streak + 1 : 0;
    const kicks = [...current.kicks, record], points = current.points + record.points;
    let next: Session = { ...current, kicks, points, streak };
    const scene = stage.current;
    if (scene) { scene.setScore(points); scene.streak = streak; }
    let sub = timedOut ? "Shot clock" : goal ? `+${formatNumber(record.points)} pts · ${record.zone === "bin" ? "TOP BIN ×5" : record.zone === "corner" ? "corner ×3" : record.zone === "side" ? "side ×2" : "centre ×1"}${record.postIn ? " · in off the post +50%" : ""}${record.knuckle ? " · knuckleball ×2" : ""}` : "Streak reset";
    if (current.kind === "target") sub = record.points ? `+${formatNumber(record.points)} · combo ×${current.target?.combo ?? 1}` : "Miss: combo reset";
    // Free modes: XP for goals and placement.
    const xp = current.mode === "match" || current.mode === "skill" ? 0 : goal ? XP.goal + XP.zoneBonus[record.zone] : 0;
    if (xp) addXp(xp);
    // Big Match: 5 kicks, then sudden death at ×2 if 3+ goals (unchanged rule).
    if (current.mode === "match") {
      const regular = kicks.length <= 5 && !current.suddenDeath;
      if (regular && kicks.length === 5 && kicks.filter(item => item.result === "goal").length >= 3) { next = { ...next, suddenDeath: true }; sub += " · SUDDEN DEATH: ×2 until you miss"; scene?.say("sudden-death"); }
    }
    setProgress(p => ({ ...p, history: [...p.history, { goal, zone: record.zone }].slice(-20) }));
    setBanner({ text: timedOut ? "TIME!" : LABELS[result], sub, tone: goal ? "goal" : "miss" });
    setSession(next);
    pendingKick.current = null;
  }

  function onKickDone() {
    const current = live.current.session;
    setBanner(null);
    if (!current) return;
    if (current.kind === "target") {
      const t = current.target ? (performance.now() - current.target.startedAt) / 1000 : TARGET_SECONDS;
      if (t >= TARGET_SECONDS) { endSession(current); return; }
      if (current.target && current.target.targets.length === 0) { const round = current.target.round + 1; const updated = { ...current, target: { ...current.target, round, targets: spawnTargets(current.seed, round) } }; setSession(updated); startAim(updated); return; }
      startAim(current); return;
    }
    if (current.mode === "match") {
      const done = current.suddenDeath ? current.kicks[current.kicks.length - 1]?.result !== "goal" : current.kicks.length >= 5 && !current.suddenDeath;
      if (done) { endSession(current); return; }
      setSession({ ...current, ball: undefined }); setPhase("idle"); return;
    }
    if (current.kicks.length >= current.total) { endSession(current); return; }
    // Free kicks: a new setup for every kick (except levels/daily with a fixed setup).
    if (current.mode === "freekicks") {
      const setup = freeKickSetup((current.seed + current.kicks.length * 101) >>> 0, { maxWind: tier.id === "champions" ? 0 : 4 });
      const updated = { ...current, setup };
      setSession(updated);
      if (stage.current) stage.current.freeKick = { setup, wall: resolveFreeKick(setup, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeperById(current.keeper)).wall };
      startAim(updated); return;
    }
    startAim(current);
  }

  function addXp(amount: number) {
    setProgress(p => {
      const before = levelFromXp(p.xp).level, after = levelFromXp(p.xp + amount).level;
      if (after > before) {
        const opened = MODES.filter(mode => mode.level > before && mode.level <= after).map(mode => mode.name);
        setMessage(`Level ${after}!${opened.length ? ` Unlocked: ${opened.join(", ")}.` : ""}`);
      }
      return { ...p, xp: p.xp + amount };
    });
  }

  function endSession(current: Session) {
    const goals = current.kicks.filter(kick => kick.result === "goal").length;
    const scene = stage.current;
    if (scene) { scene.clock = null; scene.preview = null; scene.reticle = null; }
    let result: SessionSummary = { title: "Full time", kicks: current.kicks.length, goals, points: current.points, xp: 0 };
    setProgress(p => {
      let updated: Progress = { ...p };
      let xp = 0;
      const rung = nextDifficultyLevel(p.difficulty, p.history); // between rounds only
      if (current.mode !== "match" && current.mode !== "skill") updated = { ...updated, difficulty: rung, matches: p.matches + 1 };
      if (current.mode === "tutorial") { updated.tutorialDone = true; result.title = "Tutorial complete!"; }
      if ((current.mode === "penalties" || current.mode === "tutorial") && goals >= 3 && !p.stamps.includes(current.keeper)) {
        updated.stamps = [...p.stamps, current.keeper]; xp += XP.stamp; result.stamp = keeperById(current.keeper).name;
      }
      if (current.mode === "penalties") updated.best = { ...updated.best, penalties: Math.max(p.best.penalties, current.points) };
      if (current.mode === "freekicks") updated.best = { ...updated.best, freekicks: Math.max(p.best.freekicks, current.points) };
      if (current.mode === "target") { updated.best = { ...updated.best, target: Math.max(p.best.target, current.points) }; xp += Math.round(current.points / 100) * XP.target; result.title = `Time! ${current.target?.hits ?? 0} targets`; }
      if (current.mode === "tour" && current.level) {
        const stars = starsFor(current.level, current.kicks), before = p.stars[current.level.id] ?? 0;
        result.stars = stars; result.title = `${current.level.name}: ${stars ? "cleared" : "not yet"}`;
        if (stars > before) { updated.stars = { ...p.stars, [current.level.id]: stars }; xp += (stars - before) * XP.star; }
        if (stars === 3 && current.level.reward && !p.rewards.includes(current.level.reward)) { updated.rewards = [...p.rewards, current.level.reward]; result.unlocked = [ALL_COSMETICS.find(item => item.id === current.level!.reward)?.name ?? current.level.reward]; }
      }
      if (current.mode === "daily") {
        const record = dailyState(p.daily, today), first = !record.played.includes(today);
        updated.daily = { ...record, best: Math.max(record.best, current.points), played: first ? [...record.played, today] : record.played };
        if (first) xp += XP.daily;
        result.title = `Daily: ${formatNumber(current.points)} pts`;
      }
      if (current.mode === "match") {
        const top10 = raceTable[Math.min(9, raceTable.length - 1)].points, gap = Math.max(0, top10 - race + 1);
        result.match = { rf: `${rf(current.earned.rf)} in balls won${tag}`, gboot: `+${formatNumber(current.earned.gboot)} $GBOOT${simulated ? " (sim)" : " (est., paid weekly)"}`, race: `+${formatNumber(current.earned.race)} pts${tag}`, toTop10: raceRank <= 10 ? `you are #${raceRank}` : `${formatNumber(gap)} points to reach the top 10${tag}` };
      }
      if (current.mode === "skill") {
        setSkill(list => [...list, { id: current.seed, name: "Your Friend", score: current.points, mine: true }]);
        result.title = `Skill Cup entry: ${formatNumber(current.points)} pts${tag}`;
      }
      result = { ...result, xp: result.xp + xp };
      updated.xp = p.xp + xp;
      return updated;
    });
    setSummary(result);
    setSession({ ...current, kicks: current.kicks });
    setPhase("idle"); setMenu("results");
  }

  // ── Big Match (paid RF balls, unchanged SDK flow) ───────────────────────
  async function act(work: () => Promise<void>, after?: () => void) {
    if (locked.current || paused) return;
    const version = epoch.current; locked.current = true; setBusy(true); setError(""); setMessage("");
    void unlockAudio();
    try { await work(); const value = await client.read(); if (version === epoch.current) { setSnapshot(value); after?.(); } }
    catch (cause) { if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The action failed."); }
    finally { if (version === epoch.current) { locked.current = false; setBusy(false); } }
  }
  async function unlockAudio() { if (!muted) { await sound.current?.unlock(); await crowd.current?.unlock(); } }

  /** Place a ball: consume one (SDK play), settle it (SDK outcome), reveal its TRUE rarity. */
  function placeBall() {
    const current = live.current.session;
    if (!snapshot || phase !== "idle" || !current || current.mode !== "match") return;
    void act(async () => {
      const version = epoch.current;
      const play = pending ?? (await client.play(1n))[0];
      sound.current?.play("anticipation");
      const settled = await client.settle(play.id);
      if (version !== epoch.current) return;
      if (settled.outcomeId === null) { setMessage("Randomness is still on its way. Choose Place ball again to resume this same ball."); return; }
      const outcomeId = settled.outcomeId, meta = RARITIES[outcomeId - 1];
      const drop = Math.round(tier.baseDrop * meta.dropMult);
      setGboot(value => value + drop);
      setCupRF(value => value + tier.priceRF * CUP_SHARE_OF_PRICE);
      setRace(value => value + meta.racePoints * tier.raceWeight);
      if (outcomeId >= 6) setLastBigPull(`FRIEND #${friendId} PULLED A ${RARITY_NAMES[outcomeId - 1].toUpperCase()}`);
      setProgress(p => (p.pulled.includes(outcomeId - 1) ? p : { ...p, pulled: [...p.pulled, outcomeId - 1] }));
      setSession(s => (s ? { ...s, ball: { playId: settled.id, outcomeId }, earned: { rf: s.earned.rf + definition.outcomes[outcomeId - 1].reward, gboot: s.earned.gboot + drop, race: s.earned.race + meta.racePoints * tier.raceWeight } } : s));
      if (stage.current) stage.current.showReveal(revealPlan(outcomeId));
      setPhase("reveal");
    });
  }

  function enterSkillCup() {
    if (gboot < SKILL_CUP_ENTRY || busy || paused) return;
    setGboot(value => value - SKILL_CUP_ENTRY); setBurned(value => value + SKILL_CUP_ENTRY / 2); setCupGboot(value => value + SKILL_CUP_ENTRY / 2);
    beginSession(newSession("skill"));
  }

  // ── Input ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const current = live.current;
      if (current.paused || current.menu || current.screen !== "play") return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      if (current.phase !== "aim") { if (event.key === "Enter" && current.phase === "reveal") latest.current.startAim(); return; }
      keys.current.add(event.key);
      const am = keyAim.current;
      if (event.key === "a" || event.key === "A") am.curl = clamp(Math.round((am.curl - 0.25) * 4) / 4, -1, 1);
      if (event.key === "d" || event.key === "D") am.curl = clamp(Math.round((am.curl + 0.25) * 4) / 4, -1, 1);
      if (event.key === "w" || event.key === "W") am.top = clamp(am.top + 0.25, 0, 1);
      if (event.key === "s" || event.key === "S") am.top = clamp(am.top - 0.25, 0, 1);
      if (event.key === " " && !event.repeat && !am.charging) { am.charging = true; am.chargeStart = performance.now(); am.power = 0; }
    };
    const up = (event: KeyboardEvent) => {
      keys.current.delete(event.key);
      const am = keyAim.current, current = live.current;
      if (event.key === " " && am.charging) {
        am.charging = false;
        if (current.phase === "aim" && !current.paused && !current.menu && current.session) {
          if (current.session.kind === "freekick") latest.current.shootFreeKick(keyFreeKick(am)); else latest.current.shootPenalty(keyShot(am));
        }
      }
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (paused) { keys.current.clear(); keyAim.current.charging = false; swipe.current = null; } }, [paused]);

  latest.current = { tickAim, onResolved, onKickDone, playSfx, shootPenalty, shootFreeKick, startAim: () => startAim(), haptics };

  const toLogical = (event: ReactPointerEvent<HTMLCanvasElement>): SwipePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    return { x: (event.clientX - rect.left - (rect.width - W * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - H * scale) / 2) / scale, t: event.timeStamp };
  };
  function release() {
    const points = swipe.current; swipe.current = null;
    const current = live.current.session;
    if (!points || !current || paused || menu) return;
    if (current.kind === "freekick") { const shot = swipeToFreeKick(points, { width: W, height: H }); if (shot) shootFreeKick(shot); }
    else { const shot = swipeToShot(points, { width: W, height: H }); if (shot) shootPenalty(shot); }
  }

  if (!snapshot) return <div className="pk-loading" role={error ? "alert" : "status"}>
    <div className="pk-loading-ball" aria-hidden="true" />{error || "Loading the stadium…"}
    {error && <button type="button" onClick={() => { setError(""); void client.read().then(setSnapshot).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load the game.")); }}>Retry</button>}
  </div>;
  if (snapshot.friendId !== friendId) return <p role="alert">This game session does not match the selected Friend.</p>;

  const balls = snapshot.consumables + (pending ? 1n : 0n);
  const s = session, inMatch = s?.mode === "match";
  const skillTable = [...skill].sort((a, b) => b.score - a.score || a.id - b.id);
  const scenario = dailyScenario(today);
  const modeName = s ? (s.mode === "tutorial" ? "Tutorial" : s.mode === "tour" && s.level ? s.level.name : MODES.find(item => item.id === s.mode)?.name ?? "Skill Cup") : "";
  const kickLabel = s ? (s.kind === "target" && s.target ? `${Math.max(0, Math.ceil(TARGET_SECONDS - (performance.now() - s.target.startedAt) / 1000))}s · ×${s.target.combo}` : s.mode === "match" ? `${s.suddenDeath ? "SUDDEN DEATH · " : ""}kick ${s.kicks.length + (phase === "idle" ? 0 : 1)}` : `kick ${Math.min(s.total, s.kicks.length + 1)}/${s.total}`) : "";

  return <section className="pk" aria-label={definition.name} aria-busy={busy} data-phase={phase} data-screen={screen}>
    <div className="pk-stage" inert={Boolean(menu) || paused || screen !== "play" || undefined}>
      <canvas ref={canvas} className="pk-canvas" width={W} height={H} tabIndex={0}
        aria-label="Swipe up from the ball to shoot: where you release decides the shot. Keys: arrows aim, A/D curl, W/S topspin, hold Space for power."
        onPointerDown={event => {
          if (paused || menu || phase !== "aim") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = toLogical(event);
          if (point.y < H * 0.45) return;
          swipe.current = [point]; void unlockAudio();
        }}
        onPointerMove={event => { if (swipe.current) { const point = toLogical(event); swipe.current.push(point); } }}
        onPointerUp={event => { if (swipe.current) { swipe.current.push(toLogical(event)); release(); } }}
        onPointerCancel={() => { swipe.current = null; }} />

      {/* Pot banner: small, persistent, true figures from game/prizes.ts. Tap = odds. */}
      <button type="button" className="pk-pot" data-testid="pot" data-tag={pot.tag} onClick={() => setMenu("odds")} title="Tap for the exact odds and the 90% average return">
        <span className="pk-pot-label">GOLDEN BOOT CUP ·</span><span>🏆 {pot.value}</span><span className="pk-pot-extra">({pot.usd}) · {pot.ends}</span>{pot.tag === "SIMULATED" ? <b className="pk-simtag">SIMULATED</b> : <small>{pot.note}</small>}
      </button>

      {screen === "play" && s && <>
        <header className="pk-hud pk-hud-left">
          <span className={`pk-chip ${inMatch ? (simulated ? "pk-sim" : "pk-live") : ""}`} data-testid="mode-chip">{inMatch ? `${tier.name.toUpperCase()} · ${simulated ? "SIMULATED" : "LIVE RF"}` : `${modeName.toUpperCase()} · ${rungName(s.rung).toUpperCase()}`}</span>
          {inMatch ? <span className="pk-stat">RF <b data-testid="rf">{formatGameAmount(snapshot.rfBalance, 18)}</b>{tag} · Balls <b data-testid="balls">{balls.toString()}</b></span>
            : <span className="pk-stat">LV <b>{playerLevel}</b> · {into}/{next} XP</span>}
        </header>
        <header className="pk-hud pk-hud-right">
          <span className="pk-stat" data-testid="round" data-kicks={s.kicks.length} data-score={s.points}>{kickLabel} · ×{streakMultiplier(s.streak)}</span>
        </header>
      </>}

      {banner && <div className={`pk-banner pk-${banner.tone}`} role="status"><strong>{banner.text}</strong><span>{banner.sub}</span></div>}
      {artStatus && screen === "play" && <p className="pk-art-status" role="status">{artStatus}</p>}

      {phase === "reveal" && s?.ball && <div className="pk-reveal" role="dialog" aria-label={`${RARITY_NAMES[s.ball.outcomeId - 1]} revealed`}>
        <small>{RARITIES[s.ball.outcomeId - 1].label}</small>
        <h2>{RARITY_NAMES[s.ball.outcomeId - 1]}</h2>
        <p>Worth <b>{rf(definition.outcomes[s.ball.outcomeId - 1].reward)}</b>{tag}, kept in your Locker · $GBOOT drop <b>+{formatNumber(Math.round(tier.baseDrop * RARITIES[s.ball.outcomeId - 1].dropMult))}</b>{simulated ? " (simulated)" : " (paid weekly)"} · score ×{RARITIES[s.ball.outcomeId - 1].dropMult}</p>
        <button type="button" className="pk-primary" onClick={() => startAim()} autoFocus>Take the kick ⏎</button>
        <button type="button" className="pk-link" onClick={() => setMenu("odds")}>See odds</button>
      </div>}

      {screen === "play" && <nav className="pk-actions" aria-label="Game actions">
        {inMatch && phase === "idle" && (balls > 0n
          ? <button type="button" className="pk-primary" disabled={busy || paused} onClick={placeBall} data-testid="place">{busy ? "Placing…" : pending ? "Resume ball" : "Place ball"}</button>
          : <button type="button" className="pk-primary" disabled={busy || paused} onClick={() => setMenu("kitbag")}>Buy balls</button>)}
        {phase === "aim" && s && <button type="button" onClick={() => (s.kind === "freekick" ? shootFreeKick({ aimX: keyAim.current.aimX / 1.6, lift: 0.75, power: 0.55, spin: keyAim.current.curl || 0.6, top: 0.5 }) : shootPenalty({ aimX: keyAim.current.aimX, loft: 0, power: 0.7, curl: keyAim.current.curl }))} data-testid="quick">Quick shot</button>}
        <button type="button" onClick={() => setMenu("hub")} disabled={phase === "shooting"} data-testid="menu">Menu</button>
      </nav>}
      {(error || message) && phase !== "shooting" && screen === "play" && <p className="pk-toast" role={error ? "alert" : "status"}>{error || message}</p>}
    </div>

    {screen === "title" && !menu && <div className="pk-title" role="dialog" aria-label="Penalty Kings">
      <h1>PENALTY KINGS</h1>
      <p>Easy to play. Hard to master. Your Friend #{friendId.toString()} is the striker.</p>
      <button type="button" className="pk-primary" autoFocus onClick={() => { setScreen("modes"); void unlockAudio(); stage.current?.walkout(); }} data-testid="play">Play</button>
      <p className="pk-rule">{RULE}</p>
      {simulated && <p className="pk-note">Public preview: the economy (RF, balls, rewards, $GBOOT, Cup) is SIMULATED. Wallet and Friend ownership are real.</p>}
    </div>}

    {screen === "modes" && !menu && <div className="pk-title pk-modescreen" role="dialog" aria-label="Choose a mode">
      <h2>Level {playerLevel} · {into}/{next} XP</h2>
      <ModeSelect progress={progress} onPick={startMode} />
      <div className="pk-buyrow">
        <button type="button" onClick={() => setMenu("book")}>Scouting Book</button>
        <button type="button" onClick={() => setMenu("kitbag")}>Kit bag</button>
        <button type="button" onClick={() => setMenu("cups")}>Cups</button>
        <button type="button" onClick={() => setMenu("settings")}>Settings</button>
      </div>
    </div>}

    {portrait && <div className="pk-rotate" role="status">Rotate your phone to landscape to play.</div>}
    {paused && <div className="pk-paused" role="status">Paused</div>}

    {menu && <GameMenu title={menuTitle(menu)} onClose={busy ? undefined : () => setMenu(null)}>
      {menu === "hub" && <div className="pk-hub">
        {(["kitbag", "locker", "cups", "book", "shop", "rules", "settings"] as const).map(id => <button key={id} type="button" onClick={() => setMenu(id)}>{menuTitle(id)}</button>)}
        <button type="button" onClick={() => { setMenu(null); setSession(null); setPhase("idle"); setScreen("modes"); }}>Change mode</button>
        {simulated && <p className="pk-note">Economy is SIMULATED in this preview: RF, balls, rewards, $GBOOT (you start with {SIM_STARTING_GBOOT.toLocaleString("en-US")} simulated), Cup and shop reset on reload. Wallet and Friend ownership are real (SDK gate). Progress (XP, stars, stamps) is saved on this device when the browser allows it.</p>}
      </div>}

      {menu === "kitbag" && <>
        <p>Big Match balls cost <b>{rf(definition.price)}</b>{tag} each. Placing a ball reveals its rarity by {simulated ? "a simulated draw" : "on-chain Dice randomness"}. The rarity fixes its RF value, $GBOOT drop and score multiplier.</p>
        <BallCase definition={definition} tag={tag} />
        <StadiumPrices source={prizeSource} now={now} />
        <p>Top prize at this stadium: <b>{prizeLine(prizeSource, "topPrizeRF", now).value}</b> <small>{prizeLine(prizeSource, "topPrizeRF", now).usd}</small> · <button type="button" className="pk-link" onClick={() => setMenu("odds")}>See odds</button></p>
        {stadiumFull ? <p className="pk-warn" role="status">Stadium full: every seat's top prize is reserved right now. Try another stadium or come back after some balls settle.</p>
          : <div className="pk-buyrow">
            {[1n, 5n].map(quantity => <button key={quantity.toString()} type="button" className="pk-primary" disabled={busy || paused || snapshot.rfBalance < definition.price * quantity}
              onClick={() => void act(async () => { if (!(await client.canBuy(quantity))) throw new Error("Stadium full. Try another stadium."); await client.buy(quantity); }, () => { sound.current?.play("purchase"); setMessage(`${quantity} ball${quantity > 1n ? "s" : ""} added to your kit bag.`); })}>
              Buy {quantity.toString()} · {rf(definition.price * quantity)}</button>)}
            <button type="button" onClick={() => { beginSession(newSession("match")); }} data-testid="big-match">Play Big Match</button>
          </div>}
        {(message || error) && <p className="pk-warn" role={error ? "alert" : "status"}>{error || message}</p>}
        {!canBuy && !stadiumFull && <p>{simulated ? `The preview wallet holds ${rf(snapshot.rfBalance)} of simulated RF. Redeem balls in your Locker to get RF back, or play the free modes.` : "Not enough RF in your Friend's wallet: use Transfer RF to Friend in the wallet menu."}</p>}
        <p className="pk-rule">{RULE}</p>
      </>}

      {menu === "odds" && <>
        <p>Exact odds at {tier.name} (ball price {rf(definition.price)}{tag}):</p>
        <OddsTable definition={definition} tier={tier} tag={tag} />
        <p className="pk-note">{simulated ? "Preview: prize figures are SIMULATED; USD values are illustrative." : "Live: figures are read on-chain; a failed read shows a dash."} No figure here is a promise of winnings.</p>
      </>}

      {menu === "locker" && <>
        <p>Balls you have drawn keep their fixed RF value forever. Redeem any time; RF goes to your Friend's wallet{tag}.</p>
        {definition.outcomes.map((item, index) => <div className="pk-item" key={item.name}>
          <span><strong>{RARITY_NAMES[index]}</strong> <small>{snapshot.inventory[index].toString()} kept · {rf(item.reward)}</small></span>
          <button type="button" disabled={busy || paused || snapshot.inventory[index] === 0n || item.reward === 0n}
            onClick={() => void act(() => client.redeem(index + 1, snapshot.inventory[index]), () => sound.current?.play("reward"))}>Redeem all</button>
        </div>)}
      </>}

      {menu === "book" && <ScoutingBook progress={progress} />}
      {menu === "tour" && (pendingLevel
        ? <><h3>{pendingLevel.name}</h3><LevelBrief level={pendingLevel} /><div className="pk-buyrow"><button type="button" className="pk-primary" autoFocus onClick={() => startLevel(pendingLevel)}>Kick off</button><button type="button" onClick={() => setPendingLevel(null)}>Back</button></div></>
        : <TourMap levels={LEVELS} progress={progress} onPick={setPendingLevel} />)}
      {menu === "daily" && <DailyCard scenario={scenario} progress={progress} today={today} onPlay={startDaily} onShare={() => void shareCard(`Penalty Kings Daily ${today}: ${formatNumber(progress.daily.best)} pts`)} />}

      {menu === "cups" && <>
        <h3>Golden Boot Cup: this week</h3>
        <p>{pot.text}{pot.tag === "SIMULATED" ? " · SIMULATED" : ` · ${pot.note}`}. The top 10 Friends by Gold (1 pt) and Golden Boot (2 pts) balls drawn this week, weighted by stadium (Park ×1, Pro ×100, Champions ×1,000), share the pot: {CUP_CURVE.join(" / ")}%. <button type="button" className="pk-link" onClick={() => setMenu("odds")}>See odds</button></p>
        {simulated && <><ol className="pk-table">{raceTable.slice(0, 10).map((row, index) => <li key={row.name} data-mine={row.mine}><span>{index + 1}. {row.name}</span><b>{formatNumber(row.points)}</b></li>)}</ol>
          {raceRank > 10 && <p>You: #{raceRank} with {formatNumber(race)} pts{tag}.</p>}
          <p>Pot $GBOOT: {formatNumber(cupGboot)}{tag}</p>
          <button type="button" disabled={gboot < WILDCARD_PRICE || busy} onClick={() => { setGboot(value => value - WILDCARD_PRICE); setBurned(value => value + WILDCARD_PRICE / 2); setCupGboot(value => value + WILDCARD_PRICE / 2); setWildcards(value => value + 1); }}>
            Wildcard entry · {WILDCARD_PRICE} $GBOOT (50% burned, 50% to pot)</button>
          <p className="pk-note">Wildcards: {wildcards}{tag}. Live wildcard draws use on-chain randomness (Clubhouse).</p></>}
        {!simulated && <p>The live pot, race table and payouts are computed each week from on-chain ball settlements by a public script and published with transaction links in docs/WEEKLY.md. This screen does not invent live numbers.</p>}
        <h3>Skill Cup: 5 kicks vs THE FINAL WALL</h3>
        <p>Pot: {formatNumber(cupGboot)} $GBOOT{tag} · entry {SKILL_CUP_ENTRY} $GBOOT (50% burned, 50% to the pot). Scores use placement (corners ×3, top bins ×5).</p>
        {simulated ? <><ol className="pk-table">{skillTable.slice(0, 5).map((row, index) => <li key={row.id} data-mine={row.mine}><span>{index + 1}. {row.name}</span><b>{formatNumber(row.score)}</b></li>)}</ol>
          <button type="button" className="pk-primary" disabled={gboot < SKILL_CUP_ENTRY || Boolean(s && phase !== "idle")} onClick={enterSkillCup}>Enter · {SKILL_CUP_ENTRY} $GBOOT{tag}</button>
          <p className="pk-note">SIMULATED locally. Live entries are replayed by a referee server: your kicks are committed before the keeper's dive exists, and every kick is re-simulated.</p></>
          : <p className="pk-note">Live Skill Cup entries are made in the Clubhouse (link above the game).</p>}
      </>}

      {menu === "shop" && <>
        {simulated ? <p>Cosmetics are bought with $GBOOT, which is burned{tag}. Balance: <b>{formatNumber(gboot)}</b> · burned so far {formatNumber(burned)}. Star rewards come from the World Tour.</p>
          : <p>Your Friend's on-chain unlocks are shown here. Unlock more in the <b>Clubhouse</b>: $GBOOT is burned by the KitShop contract. Star rewards come from the World Tour.</p>}
        {(["boots", "kit", "net", "celebration"] as const).map(kind => <div key={kind} className="pk-shopgroup"><h3>{kind === "kit" ? "Kits (halo colour)" : kind === "net" ? "Net colours" : kind === "celebration" ? "Celebrations (try on: plays on your next goal)" : "Boots"}</h3>
          {ALL_COSMETICS.filter(item => item.kind === kind).map(item => {
            const has = owned.has(item.id), on = equipped[kind] === item.id, starOnly = item.name.includes("★");
            return <button key={item.id} type="button" aria-pressed={on} disabled={starOnly ? !has : simulated ? !has && gboot < item.price : !has} onClick={() => {
              if (!has && simulated && !starOnly) { setGboot(value => value - item.price); setBurned(value => value + item.price); setOwned(set => new Set(set).add(item.id)); sound.current?.play("purchase"); }
              setEquipped(value => ({ ...value, [kind]: item.id }));
              if (kind === "celebration") stage.current?.startCelebration(celebrationOf(item.id) as CelebrationId);
            }}>{item.color && <i className="pk-swatch" style={{ background: item.color }} />}{item.name} · {has ? on ? "equipped" : "equip" : starOnly ? "earn with stars" : simulated ? `${item.price} $GBOOT` : "unlock in Clubhouse"}</button>;
          })}</div>)}
      </>}

      {menu === "rules" && <div className="pk-rules">
        <p><b>{RULE}</b></p>
        <ol>
          <li>Swipe up from the ball. Where you release decides the shot; speed is power; a curved swipe bends it. Keys: arrows aim, A/D curl, W/S topspin, hold Space for power.</li>
          <li>Placement scores: centre ×1 (and usually saved), sides ×2, corners ×3, top bins ×5, in off the post +50%. Streaks multiply up to ×3.</li>
          <li>A 5-second shot clock keeps the pressure on (off in the tutorial). Aim wobble grows with your streak.</li>
          <li>Free modes (Penalties, Free Kicks, World Tour, Daily, Target Practice) have no energy or lives. Play as much as you like.</li>
          <li>Big Match: buy balls with RF; each ball's rarity is revealed by the chance game (true outcome, 90% average return). Then take your kick for points.</li>
          <li>Golden Boot Cup (weekly): the top 10 Friends by Gold and Golden Boot balls. Skill Cup (weekly): best 5 kicks vs THE FINAL WALL, verified by replay.</li>
        </ol>
        {simulated && <p className="pk-note">Preview: every balance, ball, reward, $GBOOT amount, Cup pot, race table and rival shown here is SIMULATED and resets on reload.</p>}
      </div>}

      {menu === "settings" && <div className="pk-settings">
        <button type="button" aria-pressed={!muted} onClick={() => {
          const nextMuted = !muted; setMuted(nextMuted); sound.current?.setMuted(nextMuted); crowd.current?.setMuted(nextMuted);
          if (!nextMuted) { void sound.current?.unlock(); void crowd.current?.unlock(); }
        }}>{muted ? "Sound off" : "Sound on"}</button>
        <label><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)} /> Reduce motion (no shake, flashes, slow-mo or big celebrations)</label>
        <label><input type="checkbox" checked={haptics} onChange={event => setHaptics(event.target.checked)} /> Vibration (Android)</label>
        <p>Level {playerLevel} · {progress.xp} XP · ★ {Object.values(progress.stars).reduce((a, b) => a + b, 0)} · {progress.stamps.length}/12 keepers stamped</p>
        <p>Best: penalties {formatNumber(progress.best.penalties)} · free kicks {formatNumber(progress.best.freekicks)} · target {formatNumber(progress.best.target)}</p>
      </div>}

      {menu === "results" && summary && <Results summary={summary} onModes={() => { setMenu(null); setSession(null); setScreen("modes"); }}
        onAgain={() => { const last = session; setMenu(null); if (!last) { setScreen("modes"); return; }
          if (last.mode === "tour" && last.level) startLevel(last.level); else if (last.mode === "daily") { setMenu("daily"); } else if (last.mode === "skill") enterSkillCup(); else beginSession(newSession(last.mode === "tutorial" ? "penalties" : last.mode)); }} />}
    </GameMenu>}
  </section>;

  async function shareCard(text: string) {
    const url = typeof location === "undefined" ? "" : location.href;
    try { if (navigator.share) { await navigator.share({ title: "Penalty Kings", text, url }); return; } } catch { /* fall back to copy */ }
    try { await navigator.clipboard.writeText(`${text} ${url}`); setMessage("Result copied."); } catch { setMessage(text); }
  }
}

function menuTitle(menu: Exclude<Menu, null>) {
  return { hub: "Menu", kitbag: "Kit bag", odds: "Odds", locker: "Locker", cups: "Cups", shop: "Kit shop", book: "Scouting Book", tour: "World Tour", daily: "Daily Challenge", settings: "Settings", rules: "Rules", results: "Results" }[menu];
}

void KEEPERS; void TIERS;
