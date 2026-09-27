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
  swipeToShot, aimedShot, WALL_HEIGHTS, aimWobble, wobbleFor, nextDifficultyLevel, DIFFICULTY_LADDER, NEUTRAL,
  type KeeperId, type ShotInput, type FreeKickShot, type FreeKickSetup, type SwipePoint, type Difficulty, type ShotResult,
} from "@penalty-kings/engine";
import { RARITIES, TIERS, ALL_COSMETICS, CUP_CURVE, CUP_SHARE_OF_PRICE, SIM_CUP_SEED_RF, SIM_CUP_SEED_GBOOT, WILDCARD_PRICE, SKILL_CUP_ENTRY, SIM_STARTING_GBOOT, tierForPrice, formatNumber, celebrationOf, type Cosmetic } from "./economy.js";
import { Stage, RARITY_NAMES } from "./gfx/stage.js";
import { setBallReducedMotion } from "./gfx/ball.js";
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
import { useRfPrice, usdForRf } from "./game/price.js";
import { swipeToFreeKick, keyShot, keyFreeKick, type KeyAim } from "./game/input.js";
import { MatchDirector, type KickFacts } from "./game/director.js";
import { windLabel, goalTransform, fkBall } from "./gfx/setpieces.js";
import { SPOT, GOAL, PENALTY_GOAL } from "./gfx/stadium.js";
import { CELEBRATIONS } from "./gfx/friend.js";
import { BallCase, OddsTable, StadiumPrices, ModeSelect, TourMap, LevelBrief, DailyCard, ScoutingBook, Results, rungName, type SessionSummary } from "./ui.js";
import { Shop, PackOpening, Bag, BallCarousel, MarketPreview } from "./ballui.js";
import { allowed, canShoot, type FlowState, type FlowAction } from "./game/flow.js";
import { encodeSaveCode, decodeSaveCode, canPersist } from "./game/savecode.js";
import { addPulls, syncBag, removeBall, setLucky, recordKick, kickStyle, sampleDiscontinued, type BallRecord } from "./game/bag.js";
import liveConfig from "./live.json" with { type: "json" };
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const LEVELS = levelsData as unknown as Level[];
type Menu = "hub" | "balls" | "bag" | "market" | "odds" | "cups" | "shop" | "book" | "tour" | "daily" | "settings" | "rules" | "results" | null;
type Screen = "title" | "modes" | "play";
type Phase = "idle" | "reveal" | "aim" | "shooting";
type PlayMode = ModeId | "tutorial";
type Session = {
  mode: PlayMode; kind: "penalty" | "freekick" | "target"; keeper: KeeperId; seed: number; total: number;
  kicks: KickRecord[]; points: number; streak: number; rung: number;
  level?: Level; daily?: DailyScenario; setup?: FreeKickSetup;
  suddenDeath?: boolean; ball?: { recordId: string; rarity: number };
  target?: { startedAt: number; round: number; targets: Target[]; combo: number; hits: number };
  earned: { rf: bigint; gboot: number; race: number };
};
type SkillEntry = { id: number; name: string; score: number; mine: boolean };

const RULE = "Your kick never changes what you win. Ball rarity is decided by on-chain randomness. Skill is for glory, stars, streaks and the Skill Cup.";
const RIVALS = ["Rival Friend A", "Rival Friend B", "Rival Friend C", "Rival Friend D", "Rival Friend E", "Rival Friend F", "Rival Friend G", "Rival Friend H", "Rival Friend I", "Rival Friend J", "Rival Friend K"];
const SIM_RACE = [2400, 1900, 1500, 1210, 1000, 820, 640, 500, 360, 240, 120];
const SIM_SKILL = [9350, 7900, 6120, 4600, 3800];
const LADDER_SHOWCASE: readonly KeeperId[] = ["squirrel", "peacock", "octopus", "mime", "disco", "sumo", "robot", "ghost", "finalwall"];
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
  // The Bag (records layered over the on-chain inventory), the open pack, the chosen ball.
  const [bag, setBag] = useState<BallRecord[]>(() => { const stored = loadBag(); return simulated ? [...stored.filter(record => !record.sample), ...sampleDiscontinued(Date.now())] : stored.filter(record => !record.sample); });
  const [pack, setPack] = useState<{ rarities: number[]; revealed: boolean[]; gboot: number } | null>(null);
  const [selectedBall, setSelectedBall] = useState<string | null>(null);
  const [carousel, setCarousel] = useState(false);
  const [earned, setEarned] = useState({ rf: 0n, gboot: 0, race: 0 });
  /** Whether this browser keeps progress by itself (false inside the SDK sandbox: use a save code). */
  const [persistent] = useState(() => canPersist());
  const [restoreCode, setRestoreCode] = useState(""), [restoreNote, setRestoreNote] = useState("");

  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const sprites = useRef<GenerationSprites | null>(null);
  const sound = useRef<FriendSoundKit | null>(null), crowd = useRef<Crowd | null>(null);
  const locked = useRef(false), epoch = useRef(0);
  const swipe = useRef<SwipePoint[] | null>(null);
  /** Display scale (CSS px per canvas unit) and the input kind of the current gesture. */
  const gestureInfo = useRef<{ pxPerUnit: number; input: "touch" | "mouse" | "trackpad" }>({ pxPerUnit: 1, input: "touch" });
  const keys = useRef(new Set<string>());
  const keyAim = useRef<KeyAim & { charging: boolean; chargeStart: number }>({ aimX: 0.5, aimY: 0.5, curl: 0, top: 0, power: 0, charging: false, chargeStart: 0 });
  const aimStarted = useRef(0);
  const pendingKick = useRef<{ record: KickRecord; result: ShotResult | "wall" } | null>(null);
  const director = useRef(new MatchDirector(Number(friendId % 997n)));
  const pendingWave = useRef(false);
  const kicksTaken = useRef(0);
  const progressRef = useRef(progress); progressRef.current = progress;
  const bagRef = useRef(bag); bagRef.current = bag;
  /** Every progress change goes through here so later reads in the same tick see it. */
  const updateProgress = (change: (p: Progress) => Progress) => { const next = change(progressRef.current); progressRef.current = next; setProgress(next); };
  const live = useRef({ paused, menu, phase, session, screen, pack: Boolean(pack), carousel, busy });
  live.current = { paused, menu, phase, session, screen, pack: Boolean(pack), carousel, busy };
  /** Kicks in flight (0 or 1) and the id of the current one: stale timers and events check it. */
  const inFlight = useRef(0), kickId = useRef(0);
  /** Time the game clocks were frozen (paused, hidden, menu, pack, carousel, walkout): shot clock and target timer use clockNow(). */
  const frozenMs = useRef(0);
  const clockNow = () => performance.now() - frozenMs.current;
  /** The action-flow state (game/flow.ts), read synchronously from refs. */
  const flow = (): FlowState => {
    const c = live.current;
    return { screen: c.screen, phase: c.phase === "reveal" ? "idle" : c.phase, session: Boolean(c.session), match: c.session?.mode === "match", menu: Boolean(c.menu), pack: c.pack, carousel: c.carousel, busy: c.busy || locked.current, paused: c.paused, stage: Boolean(stage.current?.moment), balls: bagRef.current.filter(ball => !ball.sample).length, inFlight: inFlight.current };
  };
  const may = (action: FlowAction) => allowed(flow(), action);
  /** Phase changes are visible to the next event/frame immediately (no double shot before React re-renders). */
  const setPhaseNow = (next: Phase) => { live.current = { ...live.current, phase: next }; setPhase(next); };
  const pointer = useRef<number | null>(null);
  const timeoutTimer = useRef(0);
  /** QA timing (round 6 B3): release → result and result → next kick ready, in ms. */
  const timing = useRef<{ release: number; resolved: number; log: { kind: string; toResult: number; toReady: number }[] }>({ release: 0, resolved: 0, log: [] });
  // Long-lived callbacks (Stage loop, stage events, key listeners) call the LATEST handlers.
  const latest = useRef({ tickAim: (_dt: number) => {}, onResolved: (_r: ShotResult | "wall", _t?: boolean) => {}, onKickDone: () => {}, playSfx: (_n: string) => {}, shootPenalty: (_s: ShotInput) => {}, shootFreeKick: (_s: FreeKickShot) => {}, startAim: () => {}, haptics: true });

  const maxPrize = maximumPrize(definition);
  const pending = snapshot?.plays.find(play => play.outcomeId === null) ?? null;
  const stadiumFull = snapshot ? snapshot.freeStake < maxPrize || snapshot.freeStake + definition.price < maxPrize : false;
  const canBuy = snapshot ? snapshot.rfBalance >= definition.price && !stadiumFull : false;
  const today = utcDate(new Date(now));
  const { level: playerLevel, into, next } = levelFromXp(progress.xp);
  const assist = assistLevel(progress, tier.id);
  const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
  const rfNumber = (value: bigint) => Number(value / 10n ** 15n) / 1000;
  const rfPrice = useRfPrice(!simulated); // live stadiums: pool reads every 60 s ("—" on failure); the SDK preview: labelled on-chain snapshot (the preview may only read the game contract)

  // Prize source: the SDK's (simulated) ledger + the simulated Cup ledger in preview; on-chain reads only when live.
  const prizeSource: PrizeSource = simulated
    ? { kind: "simulated", potRF: cupRF, topPrizeRF: rfNumber(maxPrize), freeStakeRF: snapshot ? rfNumber(snapshot.freeStake) : 0, price: rfPrice }
    : { kind: "live", potRF: null, topPrizeRF: rfNumber(maxPrize), freeStakeRF: snapshot ? rfNumber(snapshot.freeStake) : null, readAt: snapshot ? now : null, price: rfPrice };
  const pot = potBanner(prizeSource, now);
  const raceTable = [...SIM_RACE.map((points, index) => ({ name: RIVALS[index], points, mine: false })), { name: "Your Friend", points: race, mine: true }].sort((a, b) => b.points - a.points);
  const raceRank = raceTable.findIndex(row => row.mine) + 1;

  useEffect(() => { saveProgress(progress); }, [progress]);
  useEffect(() => { saveBag(bag); }, [bag]);
  // The on-chain inventory is the truth: records always match it exactly.
  useEffect(() => { if (snapshot) setBag(current => syncBag(current, snapshot.inventory, tier.id, Date.now())); }, [snapshot, tier.id]);
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
    cancelKick(); setSnapshot(null); setError(""); setMenu(null); setPhaseNow("idle"); setSession(null); setScreen("title"); locked.current = false;
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
    // Read-only viewer stats for the 90-second QA harness (counts only; no game state is writable).
    (window as unknown as { __pkStats?: () => unknown }).__pkStats = () => Object.fromEntries(Object.entries(scene.stats).map(([key, value]) => [key, value instanceof Set ? [...value] : value]));
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
      if (current.session && (frozen || current.menu || current.pack || current.carousel || scene.moment)) frozenMs.current += time - last;
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

  // Attract mode: a showreel of SKILL moments behind the title (engine-resolved shots, never paid reveals).
  useEffect(() => {
    if (screen !== "title" || !ready) return;
    let beat = 0;
    const run = () => {
      const scene = stage.current;
      if (!scene || live.current.paused || scene.busy) return;
      const step = MatchDirector.SHOWREEL[beat++ % MatchDirector.SHOWREEL.length];
      if (step !== "celebration" && step !== "wave") scene.keeper = LADDER_SHOWCASE[(beat + (Number(friendId) % 5)) % LADDER_SHOWCASE.length]; // every shot brings the next keeper
      scene.kind = "penalty"; scene.freeKick = null; scene.hints = 0;
      const find = (want: ShotResult) => {
        for (let i = 0; i < 3000; i++) {
          const shot = { aimX: Math.random() * 2.6 - 1.3, aimY: Math.random() * 1.1, power: 0.35 + Math.random() * 0.55, curl: Math.random() * 1.6 - 0.8 };
          const outcome = resolveShot(shot, keeperById(scene.keeper), Math.floor(Math.random() * 2 ** 31));
          if (outcome.result === want && (want !== "goal" || outcome.zone === "bin" || outcome.zone === "corner")) return { outcome, curl: shot.curl };
        }
        return null;
      };
      if (step === "walkout") scene.walkout();
      else if (step === "celebration") scene.startCelebration(CELEBRATIONS[beat % CELEBRATIONS.length].id);
      else if (step === "wave") scene.wave();
      else if (step === "taunt") { scene.say(`intro:${scene.keeper}`); scene.taunt(); }
      else if (step === "freekick") {
        const setup = freeKickSetup(beat * 7919, { maxWind: 3, wallHeight: WALL_HEIGHTS[tier.id] }), keeper = keeperById(scene.keeper);
        scene.kind = "freekick"; scene.freeKick = { setup, wall: resolveFreeKick(setup, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeper).wall };
        for (let i = 0; i < 3000; i++) {
          const outcome = resolveFreeKick({ ...setup, seed: setup.seed + i }, { aimX: Math.random() * 1.8 - 0.9, lift: Math.random(), power: Math.random(), spin: Math.random() * 2 - 1, top: Math.random() }, keeper);
          if (outcome.result === "goal") { scene.cue = "curler"; scene.playFreeKick(outcome); break; }
        }
      } else {
        const found = find(step === "penalty-save" ? "save" : step === "post" ? "post" : "goal");
        if (found) { if (step === "penalty-goal") scene.cue = found.outcome.zone === "bin" ? "top-bin" : "goal"; scene.play(found.outcome, found.curl); }
      }
      if (beat === 1) scene.say("showreel");
    };
    run();
    const id = window.setInterval(run, 1200);
    return () => { window.clearInterval(id); const scene = stage.current; if (scene) { scene.kind = "penalty"; scene.freeKick = null; scene.cue = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, ready]);

  // Keep the Stage in sync with settings, cosmetics and prize displays.
  useEffect(() => { stage.current?.setReduced(reducedMotion); setBallReducedMotion(reducedMotion || null); }, [reducedMotion, ready]);
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
  /** Aim assist strength for a penalty/target kick: the reticle and the kick both use it (WYSIWYG). */
  const kickAssist = (current: Session) => Math.max(difficultyFor(current).assist, current.mode === "skill" ? 0 : assist * 0.5);

  // ── Aiming (keyboard, clock, live previews) ─────────────────────────────
  function tickAim(dt: number) {
    const current = live.current, scene = stage.current;
    if (!scene || !current.session || !canShoot(flow())) { if (scene && current.phase !== "aim") scene.clock = null; return; }
    const s = current.session, k = keys.current, am = keyAim.current;
    if (k.has("ArrowLeft")) am.aimX = clamp(am.aimX - dt * 1.2, -1.4, 1.4);
    if (k.has("ArrowRight")) am.aimX = clamp(am.aimX + dt * 1.2, -1.4, 1.4);
    if (k.has("ArrowUp")) am.aimY = clamp(am.aimY + dt * 0.6, 0, 1.2);
    if (k.has("ArrowDown")) am.aimY = clamp(am.aimY - dt * 0.6, 0, 1.2);
    if (am.charging) am.power = clamp((performance.now() - am.chargeStart) / 1100, 0, 1);
    // Shot clock: a timeout counts as a miss.
    const total = clockFor(s);
    if (total > 0) {
      const left = total - (clockNow() - aimStarted.current) / 1000;
      scene.clock = { left: Math.max(0, left), total };
      if (left <= 0) { timeout(); return; }
    } else scene.clock = null;
    // Live aim display: reticle (penalties/target) or trajectory preview (free kicks), faded by assist.
    const wobble = aimWobble(performance.now() / 1000, wobbleFor(difficultyFor(s), s.streak));
    if (s.kind === "freekick" && s.setup) {
      const partial = swipe.current && swipe.current.length > 2 ? swipeToFreeKick(swipe.current, swipeOptions(s), s.setup) : null;
      const shot = partial ?? keyFreeKick({ ...am, power: am.charging ? am.power : 0.6 }, s.setup);
      const outcome = resolveFreeKick(s.setup, { ...shot, aimX: shot.aimX + wobble / 1.6 }, keeperById(s.keeper), difficultyFor(s));
      scene.preview = { path: outcome.path, alpha: Math.max(assist, 0.25) };
    } else {
      const partial = swipe.current && swipe.current.length > 2 ? swipeToShot(swipe.current, swipeOptions(s)) : null;
      const shot = partial ?? keyShot({ ...am, power: am.charging ? am.power : 0.7 });
      const aimed = aimedShot(shot, wobble, kickAssist(s)), target = shotTarget(aimed);
      // WYSIWYG: the reticle is the landing point (wobble, assist and curl drift included, as shootPenalty applies them) for the WHOLE drag; full for the first 5 kicks, then faint.
      scene.reticle = { x: target.x, y: target.y, power: aimed.power, curl: aimed.curl, active: Boolean(partial) || am.charging, alpha: kicksTaken.current < 5 ? 1 : Math.max(0.35, assist) };
    }
    if (s.kind === "target" && s.target) {
      const t = (clockNow() - s.target.startedAt) / 1000;
      scene.targets = s.target.targets.map(target => ({ ...targetAt(target, t), r: target.r, value: target.value }));
      if (t >= TARGET_SECONDS) endSession(s);
    }
  }

  // ── Sessions ────────────────────────────────────────────────────────────
  function newSession(mode: PlayMode, extra: Partial<Session> = {}): Session {
    const ladder = nextRung(progress);
    const base: Session = { mode, kind: "penalty", keeper: ladder, seed: (Date.now() ^ Number(friendId % 100000n)) >>> 0, total: 5, kicks: [], points: 0, streak: 0, rung: progress.difficulty, earned: { rf: 0n, gboot: 0, race: 0 } };
    if (mode === "tutorial") return { ...base, keeper: "mouse", total: 3, ...extra };
    if (mode === "freekicks") return { ...base, kind: "freekick", total: 3, keeper: director.current.keeperForKick(progress.stamps, ladder, 0), setup: freeKickSetup(base.seed, { maxWind: tier.id === "champions" ? 0 : 4, wallHeight: WALL_HEIGHTS[tier.id] }), ...extra };
    if (mode === "penalties") return { ...base, keeper: director.current.keeperForRound(progress.stamps, ladder), ...extra };
    if (mode === "target") return { ...base, kind: "target", total: 0, target: { startedAt: clockNow(), round: 0, targets: spawnTargets(base.seed, 0), combo: 0, hits: 0 }, ...extra };
    if (mode === "skill") return { ...base, keeper: "finalwall", ...extra };
    if (mode === "match") return { ...base, keeper: progress.stamps.includes(ladder) ? ladder : ladder, ...extra };
    return { ...base, ...extra };
  }

  /** Abandon an in-flight kick without scoring it (mode switch, redeemed ball). */
  function cancelKick() {
    stage.current?.cancel(); pendingKick.current = null; pendingWave.current = false; inFlight.current = 0; kickId.current++;
    window.clearTimeout(timeoutTimer.current); swipe.current = null; pointer.current = null; keyAim.current.charging = false; setBanner(null);
  }

  function beginSession(next: Session) {
    const scene = stage.current;
    if (inFlight.current) cancelKick();
    setSession(next); setSummary(null); setMenu(null); setScreen("play"); setBanner(null); setMessage("");
    if (scene) {
      scene.kind = next.kind; scene.keeper = next.keeper; scene.streak = 0; scene.setScore(0);
      scene.hints = next.mode === "tutorial" ? 1 : next.mode === "penalties" && assist > 0.5 ? 0.45 : 0;
      scene.freeKick = next.kind === "freekick" && next.setup ? { setup: next.setup, wall: resolveFreeKick(next.setup, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeperById(next.keeper)).wall } : null;
      scene.targets = []; scene.preview = null;
      if (next.mode !== "match") { scene.rarity = 7; scene.lucky = false; scene.season = "S1"; }
      scene.streak = 0; scene.cue = null;
      if (next.mode === "tutorial") scene.walkout();
      else scene.say(next.kind === "freekick" ? "freekick" : next.kind === "target" ? "target" : director.current.roundIntro(next.keeper, scene.weather, next.mode));
    }
    if (next.mode === "match") { setPhaseNow("idle"); return; }
    startAim(next);
  }

  function startMode(mode: ModeId) {
    if (!may("start-mode")) return;
    void unlockAudio(); setError("");
    if (mode === "tour") { setMenu("tour"); return; }
    if (mode === "daily") { setMenu("daily"); return; }
    if (mode === "penalties" && !progress.tutorialDone) { beginSession(newSession("tutorial")); setMessage("Tutorial: swipe up from the ball. Point left or right to aim across; a longer swipe aims higher, but never over the bar. The target shows exactly where the ball will land. Swiping faster adds pace, not height; only a wild, super-fast swipe can fly over. Watch out: low shots down the middle usually hit the keeper's trailing leg."); return; }
    if (mode === "skill") { enterSkillCup(); return; }
    if (mode === "match") { if (bag.some(ball => !ball.sample)) { setScreen("play"); beginSession(newSession("match")); setSelectedBall(selectedBall ?? bag.find(ball => !ball.sample)!.id); setCarousel(true); } else setMenu("balls"); return; }
    beginSession(newSession(mode));
  }

  function startLevel(level: Level) {
    if (!may("start-mode")) return;
    const setup = level.setup ? freeKickSetup(dateSeed(level.id), { distance: level.setup.distance, angle: level.setup.angle, wallSize: level.setup.wallSize, wallHeight: level.setup.wallHeight ?? WALL_HEIGHTS[level.stadium] }) : undefined;
    beginSession(newSession("tour", { kind: level.mode === "freekick" ? "freekick" : "penalty", keeper: level.keeper, total: level.kicks, level, setup: setup ? { ...setup, wind: level.setup?.wind ?? 0 } : undefined, seed: dateSeed(level.id) }));
    setPendingLevel(null);
  }

  function startDaily() {
    if (!may("start-mode")) return;
    const scenario = dailyScenario(today);
    const record = dailyState(progress.daily, today);
    if (record.attempts >= DAILY_ATTEMPTS) return;
    updateProgress(p => ({ ...p, daily: { ...record, attempts: record.attempts + 1 } }));
    beginSession(newSession("daily", { kind: scenario.mode === "freekick" ? "freekick" : "penalty", keeper: scenario.keeper, total: scenario.kicks, daily: scenario, setup: scenario.setup, seed: scenario.seed }));
  }

  function startAim(current: Session | null = live.current.session) {
    const scene = stage.current;
    keyAim.current = { ...keyAim.current, power: 0, charging: false, curl: 0, top: 0 };
    aimStarted.current = clockNow();
    if (scene && current) {
      scene.ballVisible = true;
      if (current.kind !== "target") {
        const index = current.kicks.length;
        if (current.mode === "tutorial") { scene.hints = 1; window.setTimeout(() => stage.current?.say(`tutorial-${Math.min(3, index + 1)}` as "tutorial-1"), index === 0 ? 2600 : 300); }
        else if (index > 0 || current.mode === "match") { const pre = director.current.beforeKick(index, current.streak); if (pre.say) scene.say(pre.say); if (pre.taunt) scene.taunt(); }
        scene.tell = keeperPlan(keeperById(current.keeper), kickSeed(current.seed, index, current.keeper), { x: 0, y: 0.5 }, { kickIndex: index, history: current.kicks.map(kick => kick.x) });
      }
    }
    setPhaseNow("aim"); setMenu(null);
  }

  // ── Shooting ────────────────────────────────────────────────────────────
  function shootPenalty(raw: ShotInput) {
    const current = live.current.session, scene = stage.current;
    if (!current || !scene || !may("shoot")) return;
    inFlight.current = 1; kickId.current++; setPhaseNow("shooting"); timing.current.release = performance.now();
    const difficulty = difficultyFor(current);
    const wobble = aimWobble(performance.now() / 1000, wobbleFor(difficulty, current.streak));
    const shot = aimedShot(raw, wobble, kickAssist(current));
    const index = current.kicks.length;
    if (current.kind === "target" && current.target) {
      const t = (clockNow() - current.target.startedAt) / 1000;
      const hit = resolveTargetShot(shot, current.target.targets, t, current.target.combo);
      const target = shotTarget(shot);
      const result: ShotResult = Math.abs(target.x) > 1 ? "wide" : target.y > 1 ? "over" : hit.hit || hit.crossbar ? "goal" : "save";
      pendingKick.current = { record: { result, zone: "centre", points: hit.points, x: target.x, y: target.y }, result };
      setSession({ ...current, target: { ...current.target, combo: hit.combo, hits: current.target.hits + (hit.hit ? 1 : 0), targets: hit.hit ? current.target.targets.filter(item => item !== hit.hit) : current.target.targets } });
      scene.play({ result, target, plan: keeperPlan(keeperById("mouse"), 1, target), zone: "centre", postIn: false }, shot.curl);
      return;
    }
    const profile = keeperById(current.keeper);
    const seed = current.mode === "match" && current.ball ? kickSeed(hashId(current.ball.recordId), index, profile.id) : kickSeed(current.seed, index, profile.id);
    const outcome = resolveShot(shot, profile, seed, { kickIndex: index, history: current.kicks.map(kick => kick.x) }, difficulty);
    // The chosen ball sets ONLY the skill-layer score multiplier (kickStyle); RF values never change.
    const ballMult = current.mode === "match" && current.ball ? kickStyle(bagRef.current.find(record => record.id === current.ball!.recordId) ?? null, RARITIES.map(r => r.dropMult)).scoreMult : 1;
    const points = outcome.result === "goal" ? goalPoints(profile, ballMult, current.streak + 1, Boolean(current.suddenDeath), outcome.zone, outcome.postIn) : 0;
    pendingKick.current = { record: { result: outcome.result, zone: outcome.zone, points, postIn: outcome.postIn, x: outcome.target.x, y: outcome.target.y }, result: outcome.result };
    direct(current, pendingKick.current.record);
    scene.play(outcome, shot.curl);
  }

  function shootFreeKick(raw: FreeKickShot) {
    const current = live.current.session, scene = stage.current;
    if (!current || !scene || !current.setup || !may("shoot")) return;
    inFlight.current = 1; kickId.current++; setPhaseNow("shooting"); timing.current.release = performance.now();
    const difficulty = difficultyFor(current);
    const wobble = aimWobble(performance.now() / 1000, wobbleFor(difficulty, current.streak)) / 1.6;
    const shot = { ...raw, aimX: raw.aimX + wobble };
    const profile = keeperById(current.keeper);
    const outcome = resolveFreeKick({ ...current.setup, seed: kickSeed(current.seed, current.kicks.length, profile.id) }, shot, profile, difficulty);
    const points = outcome.result === "goal" ? goalPoints(profile, 1, current.streak + 1, false, outcome.zone) * (outcome.knuckle ? 2 : 1) : 0;
    pendingKick.current = { record: { result: outcome.result, zone: outcome.zone, points, x: outcome.target.x, y: outcome.target.y, spin: shot.spin, knuckle: outcome.knuckle }, result: outcome.result };
    direct(current, pendingKick.current.record);
    scene.playFreeKick(outcome);
  }

  /** Tell the Match Director what just happened; it picks the line (and maybe a wave) the Stage plays on resolve. */
  function direct(current: Session, record: KickRecord) {
    const scene = stage.current; if (!scene) return;
    let misses = 0; for (let i = current.kicks.length - 1; i >= 0 && current.kicks[i].result !== "goal"; i--) misses++;
    const goal = record.result === "goal";
    const facts: KickFacts = { kind: current.kind, result: record.result, zone: record.zone, postIn: record.postIn, x: record.x, y: record.y, spin: record.spin, knuckle: record.knuckle, streak: goal ? current.streak + 1 : 0, misses: goal ? 0 : misses + 1 };
    const cue = director.current.afterKick(facts);
    scene.cue = current.kind === "target" ? null : cue.say; pendingWave.current = cue.wave;
  }

  function timeout() {
    const current = live.current.session;
    if (!current || !may("tick-clock")) return;
    inFlight.current = 1; const id = ++kickId.current; setPhaseNow("shooting");
    swipe.current = null; pointer.current = null; keyAim.current.charging = false;
    pendingKick.current = { record: { result: "wide", zone: "centre", points: 0, x: 0, y: 0 }, result: "wide" };
    setBanner({ text: "TIME!", sub: "The shot clock ran out: that counts as a miss.", tone: "miss" });
    timeoutTimer.current = window.setTimeout(() => { if (kickId.current !== id) return; latest.current.onResolved("wide", true); latest.current.onKickDone(); }, 900);
  }

  // ── Results of a kick ───────────────────────────────────────────────────
  function onResolved(result: ShotResult | "wall", timedOut = false) {
    const current = live.current.session, kick = pendingKick.current;
    if (!current || !kick) return;
    const record = kick.record, goal = record.result === "goal";
    timing.current.resolved = performance.now();
    if (current.mode === "match" && current.ball) { const id = current.ball.recordId; setBag(list => list.map(ball => (ball.id === id ? recordKick(ball, { goal, zone: record.zone }) : ball))); }
    if (pendingWave.current) { pendingWave.current = false; stage.current?.wave(); }
    kicksTaken.current++;
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
    updateProgress(p => ({ ...p, history: [...p.history, { goal, zone: record.zone }].slice(-20) }));
    const text = timedOut ? "TIME!" : current.kind === "target" ? (record.points ? (current.target && record.points >= 250 && record.y > 0.9 ? "CROSSBAR!" : "HIT!") : "MISS") : result === "post" && record.y > 0.9 ? "OFF THE BAR!" : LABELS[result];
    setBanner({ text, sub, tone: goal || (current.kind === "target" && record.points > 0) ? "goal" : "miss" });
    setSession(next);
    pendingKick.current = null;
  }

  function onKickDone() {
    const current = live.current.session;
    if (!inFlight.current) return; // a cancelled kick, or a duplicate "done"
    inFlight.current = 0;
    { const t = timing.current, now = performance.now(); if (t.release && t.resolved >= t.release) t.log.push({ kind: current?.kind ?? "penalty", toResult: Math.round(t.resolved - t.release), toReady: Math.round(now - t.resolved) }); t.release = 0; }
    setBanner(null);
    if (!current) return;
    if (current.kind === "target") {
      const t = current.target ? (clockNow() - current.target.startedAt) / 1000 : TARGET_SECONDS;
      if (t >= TARGET_SECONDS) { endSession(current); return; }
      if (current.target && current.target.targets.length === 0) { const round = current.target.round + 1; const updated = { ...current, target: { ...current.target, round, targets: spawnTargets(current.seed, round) } }; setSession(updated); startAim(updated); return; }
      startAim(current); return;
    }
    if (current.mode === "match") {
      const done = current.suddenDeath ? current.kicks[current.kicks.length - 1]?.result !== "goal" : current.kicks.length >= 5 && !current.suddenDeath;
      if (done) { endSession(current); return; }
      setPhaseNow("idle"); setCarousel(true); return;
    }
    if (current.kicks.length >= current.total) { endSession(current); return; }
    // Free kicks: a new setup for every kick (except levels/daily with a fixed setup).
    if (current.mode === "freekicks") {
      const setup = freeKickSetup((current.seed + current.kicks.length * 101) >>> 0, { maxWind: tier.id === "champions" ? 0 : 4, wallHeight: WALL_HEIGHTS[tier.id] });
      const keeper = director.current.keeperForKick(progressRef.current.stamps, nextRung(progressRef.current), current.kicks.length);
      const updated = { ...current, setup, keeper };
      if (stage.current) { stage.current.keeper = keeper; if (keeper !== current.keeper) stage.current.say(`intro:${keeper}`); }
      setSession(updated);
      if (stage.current) stage.current.freeKick = { setup, wall: resolveFreeKick(setup, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeperById(current.keeper)).wall };
      startAim(updated); return;
    }
    startAim(current);
  }

  function addXp(amount: number) {
    updateProgress(p => {
      const before = levelFromXp(p.xp).level, after = levelFromXp(p.xp + amount).level;
      if (after > before) {
        const opened = MODES.filter(mode => mode.level > before && mode.level <= after).map(mode => mode.name);
        setMessage(`Level ${after}!${opened.length ? ` Unlocked: ${opened.join(", ")}.` : ""}`); stage.current?.say("level-up");
      }
      return { ...p, xp: p.xp + amount };
    });
  }

  function endSession(current: Session) {
    setMessage(""); // the tutorial/session tips never follow the player into menus or the shop (round 6 C9)
    const goals = current.kicks.filter(kick => kick.result === "goal").length;
    const scene = stage.current;
    if (scene) { scene.clock = null; scene.preview = null; scene.reticle = null; }
    let result: SessionSummary = { title: "Full time", kicks: current.kicks.length, goals, points: current.points, xp: 0 };
    {
      const p = progressRef.current;
      let updated: Progress = { ...p };
      let xp = 0;
      const rung = nextDifficultyLevel(p.difficulty, p.history); // between rounds only
      if (current.mode !== "match" && current.mode !== "skill") updated = { ...updated, difficulty: rung, matches: p.matches + 1 };
      if (current.mode === "tutorial") { updated.tutorialDone = true; xp += XP.tutorial; result.title = "Tutorial complete! Level 2: Free Kicks, World Tour, Daily and Target Practice unlocked"; }
      if ((current.mode === "penalties" || current.mode === "tutorial") && goals >= 3 && !p.stamps.includes(current.keeper)) {
        updated.stamps = [...p.stamps, current.keeper]; xp += XP.stamp; result.stamp = keeperById(current.keeper).name; stage.current?.say("stamp");
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
        result.match = { rf: `${rf(earned.rf)} (${usdForRf(rfNumber(earned.rf), rfPrice, Date.now())}) pulled in balls this session${tag}`, gboot: `+${formatNumber(earned.gboot)} $GBOOT${simulated ? " (sim)" : " (est., paid weekly)"}`, race: `+${formatNumber(earned.race)} pts${tag}`, toTop10: raceRank <= 10 ? `you are #${raceRank}` : `${formatNumber(gap)} points to reach the top 10${tag}` };
      }
      if (current.mode === "skill") {
        setSkill(list => [...list, { id: current.seed, name: "Your Friend", score: current.points, mine: true }]);
        result.title = `Skill Cup entry: ${formatNumber(current.points)} pts${tag}`;
      }
      result = { ...result, xp: result.xp + xp };
      updated.xp = p.xp + xp;
      const before = levelFromXp(p.xp).level, after = levelFromXp(updated.xp).level;
      if (after > before) result.unlocked = [...(result.unlocked ?? []), `Level ${after}`];
      progressRef.current = updated;
      setProgress(updated);
    }
    setSummary(result);
    setSession({ ...current, kicks: current.kicks });
    live.current = { ...live.current, menu: "results" };
    setPhaseNow("idle"); setMenu("results");
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

  /** SHOP: buy a pack (SDK buy). Nothing is revealed yet: balls are unopened until "Open pack". */
  function buyPack(quantity: bigint) {
    void act(async () => { if (!(await client.canBuy(quantity))) throw new Error("Stadium full. Try again later."); await client.buy(quantity); },
      () => { sound.current?.play("purchase"); setMessage(`${quantity} ball${quantity > 1n ? "s" : ""} bought. Open the pack to reveal them.`); });
  }

  /** PACK OPENING: SDK play + settle for every unopened ball (and any pending one), then reveal one by one. */
  function openPack() {
    if (!snapshot) return;
    void act(async () => {
      const version = epoch.current;
      const plays = [...snapshot.plays.filter(play => play.outcomeId === null), ...(snapshot.consumables > 0n ? await client.play(snapshot.consumables) : [])];
      sound.current?.play("anticipation");
      const rarities: number[] = [];
      for (const play of plays) {
        const settled = await client.settle(play.id);
        if (version !== epoch.current) return;
        if (settled.outcomeId !== null) rarities.push(settled.outcomeId - 1);
      }
      if (rarities.length < plays.length) setMessage("Randomness is still on its way for some balls. Choose Open again to resume them.");
      if (!rarities.length) return;
      let drops = 0, race = 0, value = 0n;
      for (const rarity of rarities) { const meta = RARITIES[rarity]; drops += Math.round(tier.baseDrop * meta.dropMult * 100) / 100; race += meta.racePoints * tier.raceWeight; value += definition.outcomes[rarity].reward; }
      setGboot(v => v + drops); setCupRF(v => v + tier.priceRF * CUP_SHARE_OF_PRICE * rarities.length); setRace(v => v + race);
      setEarned(e => ({ rf: e.rf + value, gboot: e.gboot + drops, race: e.race + race }));
      const best = Math.max(...rarities);
      if (best >= 5) setLastBigPull(`FRIEND #${friendId} PULLED A ${RARITY_NAMES[best].toUpperCase()}`);
      updateProgress(p => ({ ...p, pulled: [...new Set([...p.pulled, ...rarities])] }));
      setBag(list => addPulls(list, rarities, tier.id, Date.now()));
      setPack({ rarities, revealed: rarities.map(() => false), gboot: drops });
      setMenu(null); setScreen("play"); stage.current?.say("pack");
    });
  }
  /** Flip one card: the stage plays the TRUE reveal for that settled outcome (revealPlan). */
  function flipCard(index: number) {
    setPack(current => { if (!current || current.revealed[index]) return current; stage.current?.showReveal(revealPlan(current.rarities[index] + 1)); return { ...current, revealed: current.revealed.map((value, i) => value || i === index) }; });
  }
  /** Reveal all: flip every card; the best ball gets its reveal sequence (a Golden Boot keeps its full-screen moment). */
  function revealAll() {
    setPack(current => { if (!current) return current; const best = Math.max(...current.rarities); stage.current?.showReveal(revealPlan(best + 1)); return { ...current, revealed: current.revealed.map(() => true) }; });
  }

  /** BAG → Redeem one ball for its RF (SDK redeem); its record leaves the Bag. */
  function redeemBall(record: BallRecord) {
    if (record.sample || !may("redeem")) return;
    void act(() => client.redeem(record.rarity + 1, 1n), () => {
      sound.current?.play("reward"); setBag(list => removeBall(list, record.id));
      // You cannot kick a ball you no longer hold: cancel an aim with the redeemed ball.
      const current = live.current.session;
      if (current?.mode === "match" && current.ball?.recordId === record.id) {
        setSession({ ...current, ball: undefined }); if (live.current.phase === "aim") setPhaseNow("idle");
        if (selectedBall === record.id) setSelectedBall(null);
      } setMessage(`Redeemed a ${RARITY_NAMES[record.rarity]} for ${rf(definition.outcomes[record.rarity].reward)}.`); });
  }

  /** BAG / CAROUSEL → kick with this ball (Big Match). Choice changes only skill-layer fields. */
  function chooseBall(id: string) {
    setSelectedBall(id);
    const record = bagRef.current.find(ball => ball.id === id), scene = stage.current;
    if (record && scene) {
      const style = kickStyle(record, RARITIES.map(r => r.dropMult));
      scene.rarity = style.fx; scene.lucky = style.luckyTrail; scene.season = record.season; scene.crowd.react(style.crowd);
    }
  }
  function kickWith(id: string | null) {
    const record = bagRef.current.find(ball => ball.id === id && !ball.sample);
    if (!record) { setMenu("balls"); return; }
    if (!may("kick-with")) return;
    chooseBall(record.id);
    const current = live.current.session;
    const session = current && current.mode === "match" ? { ...current, ball: { recordId: record.id, rarity: record.rarity } } : { ...newSession("match"), ball: { recordId: record.id, rarity: record.rarity } };
    if (!current || current.mode !== "match") beginSession(session); else setSession(session);
    const intro = kickStyle(record, RARITIES.map(r => r.dropMult)).intro;
    if (intro) stage.current?.say(intro);
    setCarousel(false); setMenu(null);
    startAim(session);
  }

  function enterSkillCup() {
    if (gboot < SKILL_CUP_ENTRY || busy || paused || !may("start-mode")) return;
    setGboot(value => value - SKILL_CUP_ENTRY); setBurned(value => value + SKILL_CUP_ENTRY / 2); setCupGboot(value => value + SKILL_CUP_ENTRY / 2);
    beginSession(newSession("skill"));
    // Paid skill contest: everyone kicks the same standard ball (no pay-to-win).
    if (stage.current) { stage.current.rarity = 7; stage.current.lucky = false; stage.current.season = "S1"; }
  }

  // ── Input ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const current = live.current;
      if (current.paused || current.menu || current.screen !== "play") return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      if (!canShoot(flow())) return;
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
        if (current.session && canShoot(flow())) {
          if (current.session.kind === "freekick" && current.session.setup) latest.current.shootFreeKick(keyFreeKick(am, current.session.setup)); else latest.current.shootPenalty(keyShot(am));
        }
      }
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (paused) { keys.current.clear(); keyAim.current.charging = false; swipe.current = null; pointer.current = null; } }, [paused]);
  // Resize / rotate mid-swipe: the points were measured at the old scale, so drop the gesture (no shot).
  useEffect(() => {
    const drop = () => { swipe.current = null; pointer.current = null; };
    window.addEventListener("resize", drop); window.addEventListener("orientationchange", drop);
    return () => { window.removeEventListener("resize", drop); window.removeEventListener("orientationchange", drop); };
  }, []);

  // QA hook (like __pkStats): the action-flow state, so browser tests wait for "shootable" instead of sleeping.
  (window as unknown as { __pkFlow?: () => unknown }).__pkFlow = () => { const state = flow(); return { ...state, shootable: canShoot(state), timing: timing.current.log }; };
  latest.current = { tickAim, onResolved, onKickDone, playSfx, shootPenalty, shootFreeKick, startAim: () => startAim(), haptics };

  /** Swipe mapping options for this session's camera: goal face + ball on screen, display scale, input kind. */
  function swipeOptions(current: Session) {
    const base = { width: W, height: H, pxPerUnit: gestureInfo.current.pxPerUnit, input: gestureInfo.current.input };
    if (current.kind === "freekick" && current.setup) {
      const xf = goalTransform(current.setup), ball = fkBall(current.setup);
      return { ...base, goal: { cx: xf.x, line: xf.y, unitX: GOAL.unit * xf.g, unitY: GOAL.unit * 0.89 * xf.g }, ball: { x: ball.x, y: ball.y } };
    }
    const xf = PENALTY_GOAL; // the penalty camera's goal placement (round 6 B1)
    return { ...base, goal: { cx: xf.x, line: xf.y, unitX: GOAL.unit * xf.g, unitY: GOAL.unit * 0.89 * xf.g }, ball: { x: SPOT.x, y: SPOT.y } };
  }

  const toLogical = (event: ReactPointerEvent<HTMLCanvasElement>): SwipePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    gestureInfo.current = { pxPerUnit: scale, input: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "trackpad" : "mouse" };
    return { x: (event.clientX - rect.left - (rect.width - W * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - H * scale) / 2) / scale, t: event.timeStamp };
  };
  function release() {
    const points = swipe.current; swipe.current = null; pointer.current = null;
    const current = live.current.session;
    if (!points || !current || !may("shoot")) return;
    if (current.kind === "freekick" && current.setup) { const shot = swipeToFreeKick(points, swipeOptions(current), current.setup); if (shot) shootFreeKick(shot); }
    else { const shot = swipeToShot(points, swipeOptions(current)); if (shot) shootPenalty(shot); }
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
  const kickLabel = s ? (s.kind === "target" && s.target ? `${Math.max(0, Math.ceil(TARGET_SECONDS - (clockNow() - s.target.startedAt) / 1000))}s · ×${s.target.combo}` : s.mode === "match" ? `${s.suddenDeath ? "SUDDEN DEATH · " : ""}kick ${s.kicks.length + (phase === "idle" ? 0 : 1)}` : `kick ${Math.min(s.total, s.kicks.length + 1)}/${s.total}`) : "";

  return <section className="pk" aria-label={definition.name} aria-busy={busy} data-phase={phase} data-screen={screen}>
    <div className="pk-stage" inert={Boolean(menu) || paused || screen !== "play" || undefined}>
      <canvas ref={canvas} className="pk-canvas" width={W} height={H} tabIndex={0}
        aria-label="Swipe up from the ball to shoot: where you release decides the shot. Keys: arrows aim, A/D curl, W/S topspin, hold Space for power."
        onPointerDown={event => {
          // One gesture at a time: a second finger (or mouse + touch together) never hijacks the swipe.
          if (!may("start-swipe") || pointer.current !== null || keyAim.current.charging) return;
          const point = toLogical(event);
          if (point.y < H * 0.45) return;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
          pointer.current = event.pointerId; swipe.current = [point]; void unlockAudio();
        }}
        onPointerMove={event => { if (swipe.current && event.pointerId === pointer.current) swipe.current.push(toLogical(event)); }}
        onPointerUp={event => { if (swipe.current && event.pointerId === pointer.current) { swipe.current.push(toLogical(event)); release(); } }}
        onPointerCancel={event => { if (event.pointerId === pointer.current) { swipe.current = null; pointer.current = null; } }}
        onLostPointerCapture={event => { if (event.pointerId === pointer.current) { swipe.current = null; pointer.current = null; } }} />

      {/* Pot banner: small, persistent, true figures from game/prizes.ts. Tap = odds. */}
      <button type="button" className="pk-pot" data-testid="pot" data-tag={pot.tag} disabled={phase === "shooting"} onClick={() => { if (may("open-menu")) setMenu("odds"); }} title="Tap for the exact odds and the 90% average return">
        <span className="pk-pot-label">GOLDEN BOOT CUP ·</span><span>🏆 {pot.value}</span><span className="pk-pot-usd" data-testid="pot-usd">{pot.usd}</span><span className="pk-pot-extra">{pot.priceNote} · {pot.ends}</span>{pot.tag === "SIMULATED" ? <b className="pk-simtag">SIMULATED</b> : <small>{pot.note}</small>}
      </button>

      {screen === "play" && s && <>
        <header className="pk-hud pk-hud-left">
          <span className={`pk-chip ${inMatch ? (simulated ? "pk-sim" : "pk-live") : ""}`} data-testid="mode-chip">{inMatch ? `${tier.name.toUpperCase()} · ${simulated ? "SIMULATED" : "LIVE RF"}` : `${modeName.toUpperCase()} · ${rungName(s.rung).toUpperCase()}`}</span>
          {inMatch ? <span className="pk-stat">RF <b data-testid="rf">{formatGameAmount(snapshot.rfBalance, 18)}</b>{tag} · Balls <b data-testid="balls">{balls.toString()}</b></span>
            : <span className="pk-stat">LV <b>{playerLevel}</b> · {into}/{next} XP</span>}
        </header>
        <header className="pk-hud pk-hud-right">
          <span className="pk-stat" data-testid="round" data-kicks={s.kicks.length} data-score={s.points}>{kickLabel} · ×{streakMultiplier(s.streak)}{s.kind === "freekick" && s.setup ? <> · <b data-testid="wind" title="Wind">{windLabel(s.setup.wind)}</b></> : null}</span>
        </header>
      </>}

      {banner && <div className={`pk-banner pk-${banner.tone}`} role="status"><strong>{banner.text}</strong><span>{banner.sub}</span></div>}
      {artStatus && screen === "play" && <p className="pk-art-status" role="status">{artStatus}</p>}

      {pack && <PackOpening rarities={pack.rarities} revealed={pack.revealed} definition={definition} simulated={simulated} gboot={pack.gboot} onFlip={flipCard} onRevealAll={revealAll} onDone={() => { setPack(null); setMenu("bag"); }} />}
      {carousel && inMatch && phase === "idle" && <BallCarousel records={bag} selected={selectedBall} onSelect={chooseBall} onKick={() => kickWith(selectedBall)} onClose={() => setCarousel(false)} />}

      {screen === "play" && <nav className="pk-actions" aria-label="Game actions">
        {inMatch && phase === "idle" && !carousel && <button type="button" className="pk-primary" disabled={busy || paused} onClick={() => { if (may("open-carousel")) setCarousel(true); }} data-testid="choose-ball">Choose ball</button>}
        {phase === "aim" && s && !pack && !carousel && <button type="button" onClick={() => (s.kind === "freekick" && s.setup ? shootFreeKick(keyFreeKick({ ...keyAim.current, power: 0.55, curl: keyAim.current.curl || 0.6, top: 0.5 }, s.setup)) : shootPenalty({ aimX: keyAim.current.aimX, aimY: keyAim.current.aimY, power: 0.7, curl: keyAim.current.curl }))} data-testid="quick">Quick shot</button>}
        <button type="button" onClick={() => { if (may("open-menu")) setMenu("hub"); }} disabled={phase === "shooting"} data-testid="menu">Menu</button>
      </nav>}
      {(error || message) && phase !== "shooting" && screen === "play" && <p className="pk-toast" role={error ? "alert" : "status"}>{error || message}</p>}
    </div>

    {screen === "title" && !menu && <div className="pk-title pk-attract" role="dialog" aria-label="Penalty Kings">
      <div className="pk-attract-top">
        <h1>PENALTY KINGS</h1>
        <p>Easy to play. Hard to master. Friend #{friendId.toString()} is your striker.</p>
      </div>
      <div className="pk-attract-bottom">
        <button type="button" className="pk-primary" autoFocus onClick={() => { void unlockAudio(); if (progress.tutorialDone) setScreen("modes"); else startMode("penalties"); }} data-testid="play">{progress.tutorialDone ? "Play" : "Kick off"}</button>
        <p className="pk-rule">{RULE}</p>
        {simulated && <p className="pk-note">Public preview: the economy (RF, balls, rewards, $GBOOT, Cup) is SIMULATED. Wallet and Friend ownership are real.</p>}
      </div>
    </div>}

    {screen === "modes" && !menu && <div className="pk-title pk-modescreen" role="dialog" aria-label="Choose a mode">
      <h2>Level {playerLevel} · {into}/{next} XP</h2>
      <ModeSelect progress={progress} onPick={startMode} />
      <div className="pk-buyrow">
        <button type="button" onClick={() => setMenu("book")}>Scouting Book</button>
        <button type="button" onClick={() => setMenu("balls")} data-testid="ball-shop">Ball shop</button>
        <button type="button" onClick={() => setMenu("bag")} data-testid="my-bag">My Bag</button>
        <button type="button" onClick={() => setMenu("cups")}>Cups</button>
        <button type="button" onClick={() => setMenu("settings")}>Settings</button>
      </div>
    </div>}

    {portrait && <div className="pk-rotate" role="status">Rotate your phone to landscape to play.</div>}
    {paused && <div className="pk-paused" role="status">Paused</div>}

    {menu && <GameMenu title={menuTitle(menu)} onClose={busy ? undefined : () => setMenu(null)}>
      {menu === "hub" && <div className="pk-hub">
        {(["balls", "bag", "cups", "book", "shop", "rules", "settings"] as const).map(id => <button key={id} type="button" onClick={() => setMenu(id)}>{menuTitle(id)}</button>)}
        <button type="button" onClick={() => { cancelKick(); setMenu(null); setSession(null); setPhaseNow("idle"); setScreen("modes"); }}>Change mode</button>
        {simulated && <p className="pk-note">Economy is SIMULATED in this preview: RF, balls, rewards, $GBOOT (you start with {SIM_STARTING_GBOOT.toLocaleString("en-US")} simulated), Cup and shop reset on reload. Wallet and Friend ownership are real (SDK gate). Progress (XP, stars, stamps) is saved on this device when the browser allows it.</p>}
      </div>}

      {menu === "balls" && <>
        <Shop definition={definition} tier={tier} simulated={simulated} balance={snapshot.rfBalance} busy={busy || paused} full={stadiumFull} onBuy={buyPack} onOdds={() => setMenu("odds")} unopened={balls} onOpen={openPack} />
        {(message || error) && <p className="pk-warn" role={error ? "alert" : "status"}>{error || message}</p>}
        <BallCase definition={definition} tag={tag} />
        <StadiumPrices source={prizeSource} now={now} />
        <p className="pk-rule">{RULE}</p>
      </>}
      {menu === "bag" && <>
        <Bag records={bag} definition={definition} simulated={simulated} busy={busy || paused} selected={selectedBall} onShoot={record => kickWith(record.id)} onRedeem={redeemBall} onLucky={record => setBag(list => setLucky(list, record.id))} onMarket={() => setMenu("market")} />
        {(message || error) && <p className="pk-warn" role={error ? "alert" : "status"}>{error || message}</p>}
      </>}
      {menu === "market" && <MarketPreview />}
      {menu === "odds" && <>
        <p>Exact odds at {tier.name} (ball price {rf(definition.price)}{tag}):</p>
        <OddsTable definition={definition} tier={tier} tag={tag} />
        <p className="pk-note">{simulated ? "Preview: prize figures are SIMULATED; USD uses an on-chain RF price snapshot (live stadiums read the price every 60 s)." : "Live: figures are read on-chain; a failed read shows a dash."} No figure here is a promise of winnings.</p>
      </>}

      {menu === "book" && <ScoutingBook progress={progress} />}
      {menu === "tour" && (pendingLevel
        ? <><h3>{pendingLevel.name}</h3><LevelBrief level={pendingLevel} /><div className="pk-buyrow"><button type="button" className="pk-primary" autoFocus onClick={() => startLevel(pendingLevel)}>Kick off</button><button type="button" onClick={() => setPendingLevel(null)}>Back</button></div></>
        : <TourMap levels={LEVELS} progress={progress} onPick={setPendingLevel} />)}
      {menu === "daily" && <DailyCard scenario={scenario} progress={progress} today={today} practice={!persistent} onPlay={startDaily} onShare={() => void shareCard(`Penalty Kings Daily ${today}: ${formatNumber(progress.daily.best)} pts`)} />}

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
          <li>Big Match: buy a pack of balls with RF, open it (each ball's rarity is decided by on-chain randomness: the true outcome, 90% average return), and keep them in your Bag. Choose any ball to kick with: its rarity sets your score multiplier and style. Kicking never uses up a ball or changes its RF value. Redeem any ball for its RF whenever you like.</li>
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
        <div className="pk-save" data-testid="save-code">
          <p>{persistent ? "Your progress is saved on this device. A save code moves it to another browser." : "This preview can't save between visits (the game sandbox has no storage). Copy your save code to keep your XP, stars, stamps and bests:"}</p>
          <textarea readOnly rows={3} value={encodeSaveCode(progress, friendId)} onFocus={event => event.currentTarget.select()} aria-label="Your save code" data-testid="save-code-out" />
          <label>Restore from a save code<textarea rows={2} value={restoreCode} onChange={event => setRestoreCode(event.target.value)} data-testid="save-code-in" /></label>
          <button type="button" disabled={!restoreCode.trim()} data-testid="save-code-restore" onClick={() => {
            const restored = decodeSaveCode(restoreCode, friendId);
            if (restored.ok) { updateProgress(() => restored.progress); setRestoreCode(""); setRestoreNote("Progress restored from your save code."); } else setRestoreNote(restored.reason);
          }}>Restore</button>
          {restoreNote && <p role="status" data-testid="save-code-note">{restoreNote}</p>}
          <p className="pk-note">Save codes hold progression only (never RF, balls or $GBOOT: those always come from the chain).</p>
        </div>
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
  return { hub: "Menu", balls: "Ball shop", bag: "My Bag", market: "Market (coming soon)", odds: "Odds", cups: "Cups", shop: "Kit shop", book: "Scouting Book", tour: "World Tour", daily: "Daily Challenge", settings: "Settings", rules: "Rules", results: "Results" }[menu];
}

/** Bag records persist on this device when the browser allows (the sandboxed preview may not). */
const BAG_KEY = "penalty-kings/bag/v1";
function loadBag(): BallRecord[] { try { const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(BAG_KEY); return raw ? (JSON.parse(raw) as BallRecord[]) : []; } catch { return []; } }
function saveBag(records: readonly BallRecord[]) { try { localStorage.setItem(BAG_KEY, JSON.stringify(records.filter(record => !record.sample))); } catch { /* not persisted */ } }
/** Stable 32-bit hash of a ball id (kick seeds for the skill layer). */
function hashId(id: string) { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

void KEEPERS; void TIERS;
