"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { maximumPrize, type GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import {
  KEEPERS, keeperById, kickSeed, resolveShot, goalPoints, streakMultiplier, clamp, shotTarget,
  type KeeperId, type ShotInput, type ShotOutcome,
} from "@penalty-kings/engine";
import { RARITIES, TIERS, COSMETICS, CUP_CURVE, CUP_SHARE_OF_PRICE, SIM_CUP_SEED_RF, SIM_CUP_SEED_GBOOT, WILDCARD_PRICE, SKILL_CUP_ENTRY, tierForPrice, formatNumber, type Cosmetic } from "./economy.js";
import { renderScene, ballFlightScreen, keeperPose, toScreen, drawBall, SPOT, W, H, type SceneState } from "./scene.js";
import { createCrowd, type Crowd } from "./audio.js";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

type Menu = "hub" | "kitbag" | "locker" | "cup" | "shop" | "stadium" | "rules" | "settings" | "keeper" | "round" | null;
type Mode = "match" | "warmup" | "skill";
type Phase = "idle" | "reveal" | "aim" | "shooting";
type Ball = { mode: Mode; playId: bigint | null; outcomeId: number | null };
type RoundState = { kicks: boolean[]; suddenDeath: boolean; points: number };
type SkillEntry = { id: number; name: string; score: number; mine: boolean };

const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
const RULE = "Your kick never changes what you win — ball rarity is decided by on-chain randomness. Skill is for glory, streaks and the leaderboard.";
const RIVALS = ["Rival Friend A", "Rival Friend B", "Rival Friend C", "Rival Friend D", "Rival Friend E", "Rival Friend F", "Rival Friend G", "Rival Friend H", "Rival Friend I", "Rival Friend J", "Rival Friend K"];
const SIM_RACE = [2400, 1900, 1500, 1210, 1000, 820, 640, 500, 360, 240, 120];
const SIM_SKILL = [4350, 3900, 3120, 2600, 1800];
const BADGES: Readonly<Record<string, string>> = {
  "first-goal": "First goal", "hat-trick": "Hat-trick (3 in a row)", "top-bins": "Top bins", "banana": "Banana kick (big curl)",
  "perfect-five": "Perfect five", "iron-nerve": "Iron nerve (sudden-death goal)", "ghostbuster": "Ghostbuster (beat Ghost)", "max-streak": "×3 streak",
};

/** Penalty Kings. The SDK runtime supplies the verified Friend, the fixed action client and pause state. */
export default function PenaltyKings({ friendId, client, paused }: GameComponentProps) {
  const definition = client.definition;
  const tier = tierForPrice(Number(definition.price / 10n ** 18n));
  const simulated = client.mode === "preview";
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true), [reducedMotion, setReducedMotion] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [ball, setBall] = useState<Ball | null>(null);
  const [keeper, setKeeper] = useState<KeeperId>("showboat");
  const [banner, setBanner] = useState<{ text: string; sub: string; tone: string } | null>(null);
  const [score, setScore] = useState(0), [streak, setStreak] = useState(0), [bestRound, setBestRound] = useState(0);
  const [round, setRound] = useState<RoundState>({ kicks: [], suddenDeath: false, points: 0 });
  const [lastRound, setLastRound] = useState<RoundState | null>(null);
  const [gboot, setGboot] = useState(0), [burned, setBurned] = useState(0);
  const [cupRF, setCupRF] = useState(SIM_CUP_SEED_RF), [cupGboot, setCupGboot] = useState(SIM_CUP_SEED_GBOOT);
  const [race, setRace] = useState(0), [wildcards, setWildcards] = useState(0);
  const [owned, setOwned] = useState<Set<string>>(() => new Set(COSMETICS.filter(item => item.price === 0).map(item => item.id)));
  const [equipped, setEquipped] = useState<Record<Cosmetic["kind"], string>>({ boots: "boots-classic", kit: "kit-white", net: "net-white", celebration: "cele-jump" });
  const [badges, setBadges] = useState<Set<string>>(() => new Set());
  const [skill, setSkill] = useState<SkillEntry[]>(() => SIM_SKILL.map((points, index) => ({ id: index + 1, name: RIVALS[index], score: points, mine: false })));
  const [skillRun, setSkillRun] = useState<{ id: number; kicks: boolean[]; points: number } | null>(null);
  const [artStatus, setArtStatus] = useState("Loading your Friend…");
  const [aimHint, setAimHint] = useState(true);

  const canvas = useRef<HTMLCanvasElement>(null);
  const sprites = useRef<GenerationSprites | null>(null);
  const sound = useRef<FriendSoundKit | null>(null), crowd = useRef<Crowd | null>(null);
  const locked = useRef(false), epoch = useRef(0), kickIndex = useRef(0), warmups = useRef(0);
  const aim = useRef({ aimX: 0.55, loft: 0, power: 0, curl: 0, charging: false, chargeStart: 0 });
  const keys = useRef(new Set<string>());
  const drag = useRef<{ points: { x: number; y: number }[] } | null>(null);
  const anim = useRef<{ kind: "runup" | "flight" | "after" | "cele" | "none"; start: number; shot: ShotInput | null; outcome: ShotOutcome | null; ballVisible: boolean }>({ kind: "none", start: 0, shot: null, outcome: null, ballVisible: false });
  const live = useRef({ paused, menu, phase, reducedMotion, keeper, ball, equipped });
  live.current = { paused, menu, phase, reducedMotion, keeper, ball, equipped };

  const ready = snapshot !== null;
  const rarity = ball?.outcomeId ? RARITIES[ball.outcomeId - 1] : null;
  const maxPrize = maximumPrize(definition);
  const pending = snapshot?.plays.find(play => play.outcomeId === null) ?? null;
  const stadiumFull = snapshot ? snapshot.freeStake < maxPrize || snapshot.freeStake + definition.price < maxPrize : false;
  const canBuy = snapshot ? snapshot.rfBalance >= definition.price && !stadiumFull : false;
  const cosmetic = (kind: Cosmetic["kind"]) => COSMETICS.find(item => item.id === equipped[kind])!;

  // Session start: load snapshot, Friend artwork, sound and motion preference.
  useEffect(() => {
    const version = ++epoch.current;
    sound.current = createFriendSoundKit({ muted: true }); crowd.current = createCrowd();
    setSnapshot(null); setError(""); setMenu(null); setPhase("idle"); setBall(null); locked.current = false;
    void client.read().then(value => { if (version === epoch.current) setSnapshot(value); }).catch(cause => {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load the game.");
    });
    sprites.current = null; setArtStatus("Loading your Friend…");
    createFriendReader().read(friendId).then(value => { if (version === epoch.current) { sprites.current = value; setArtStatus(""); } })
      .catch(() => { if (version === epoch.current) setArtStatus("Friend artwork unavailable — playing with a placeholder."); });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches); update(); preference.addEventListener("change", update);
    return () => { epoch.current++; sound.current?.dispose(); crowd.current?.dispose(); preference.removeEventListener("change", update); };
  }, [client, friendId]);

  // Animation loop.
  useEffect(() => {
    const node = canvas.current, context = node?.getContext("2d");
    if (!node || !context) return;
    let frame = 0, last = performance.now(), clock = 0, shake = 0, roar = 0, flash = 0;
    let ripple: SceneState["ripple"] = null;
    const trail: { x: number; y: number }[] = [];
    const state: SceneState = {
      time: 0, keeper: "showboat", keeperPose: { x: 0, y: 0.2, rotate: 0, lift: 0 },
      ball: { x: SPOT.x, y: SPOT.y, r: 4.5, color: "#fff", accent: "#333", visible: false, spin: 0 },
      trail, friend: { rows: null, x: 216, y: 286, scale: 3, halo: "#fff", boots: "#111" }, netColor: "#e8e8e8",
      ripple: null, shake: 0, roar: 0, reticle: null, flash: null,
    };
    const rowsFor = (facing: "up" | "down" | "left" | "right", walking: boolean, index: number) =>
      sprites.current ? spriteFrame(sprites.current, facing, walking, index, "right").frame.rows : null;
    const render = (now: number) => {
      const current = live.current;
      const frozen = current.paused || document.hidden;
      let dt = frozen ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const a = anim.current;
      // Slow-mo just before the frame of the goal on post hits.
      if (a.kind === "flight" && a.outcome?.result === "post" && !current.reducedMotion && (clock - a.start) / flightDuration(a.outcome) > 0.7) dt *= 0.35;
      clock += dt; state.time = clock;
      if (a.start === -1) a.start = clock;
      const motion = !current.reducedMotion;
      // Keyboard aiming.
      if (current.phase === "aim" && !current.menu && !current.paused) {
        const k = keys.current, am = aim.current;
        if (k.has("ArrowLeft")) am.aimX = clamp(am.aimX - dt * 1.2, -1.4, 1.4);
        if (k.has("ArrowRight")) am.aimX = clamp(am.aimX + dt * 1.2, -1.4, 1.4);
        if (k.has("ArrowUp")) am.loft = clamp(am.loft + dt * 0.5, -0.3, 0.3);
        if (k.has("ArrowDown")) am.loft = clamp(am.loft - dt * 0.5, -0.3, 0.3);
        if (am.charging) am.power = clamp((now - am.chargeStart) / 1100, 0, 1);
      }
      const equip = current.equipped;
      state.keeper = current.keeper;
      state.netColor = COSMETICS.find(item => item.id === equip.net)?.color ?? "#e8e8e8";
      const halo = COSMETICS.find(item => item.id === equip.kit)?.color ?? "#fff";
      const boots = COSMETICS.find(item => item.id === equip.boots)?.color ?? "#111";
      const walkFrame = motion ? Math.floor(clock * 9) % 8 : 0;
      const ballMeta = current.ball?.outcomeId ? RARITIES[current.ball.outcomeId - 1] : null;
      state.ball.color = current.ball?.mode === "warmup" ? "#f4f4f4" : ballMeta?.color ?? "#fff";
      state.ball.accent = current.ball?.mode === "warmup" ? "#9aa3ad" : ballMeta?.accent ?? "#333";
      state.friend = { rows: rowsFor("up", false, 0), x: 216, y: 286, scale: 3, halo, boots };
      state.keeperPose = keeperPose(null, 0, motion ? clock : 0);
      state.reticle = null;
      const elapsed = clock - a.start;
      if (a.kind === "none") {
        state.ball.visible = current.phase === "aim" || current.phase === "reveal";
        state.ball.x = SPOT.x; state.ball.y = SPOT.y; state.ball.r = 4.5; state.ball.spin = 0; trail.length = 0;
        if (current.phase === "aim") {
          const am = aim.current, target = shotTarget({ aimX: am.aimX + wobble(now, am.power), loft: am.loft, power: am.charging || drag.current ? am.power : 0.78, curl: am.curl });
          state.reticle = { x: target.x - am.curl * 0.3, y: target.y, power: am.power, curl: am.curl, aimX: am.aimX, active: am.charging || Boolean(drag.current) };
        }
      } else if (a.kind === "runup") {
        const p = clamp(elapsed / 0.45, 0, 1);
        state.friend = { ...state.friend, rows: rowsFor("up", true, walkFrame), x: 216 + 16 * p, y: 286 - 26 * p };
        state.ball.visible = true;
        if (p >= 1) { a.kind = "flight"; a.start = clock; crowd.current?.kick(); sound.current?.play("impact"); }
      } else if (a.kind === "flight" && a.outcome && a.shot) {
        const duration = flightDuration(a.outcome), p = clamp(elapsed / duration, 0, 1);
        const position = ballFlightScreen(a.outcome.target, a.shot.curl, p);
        state.friend = { ...state.friend, rows: rowsFor("up", false, 0), x: 232, y: 260, squash: p < 0.15 && motion ? 0.08 : 0 };
        state.ball = { ...state.ball, ...position, visible: true, spin: motion ? clock * 14 * (a.shot.curl || 0.3) : 0 };
        if (motion) { trail.push({ x: position.x, y: position.y }); if (trail.length > 10) trail.shift(); }
        state.keeperPose = keeperPose(a.outcome.plan, p * a.outcome.target.time, clock);
        if (p >= 1) {
          a.kind = "after"; a.start = clock;
          const result = a.outcome.result, impact = toScreen(a.outcome.target.x, a.outcome.target.y);
          if (result === "goal") { ripple = { x: impact.x, y: impact.y, t: 0 }; roar = 1; shake = motion ? 1 : 0; flash = motion ? 0.25 : 0; crowd.current?.roar(); sound.current?.play("reward"); }
          else if (result === "post") { shake = motion ? 0.7 : 0; crowd.current?.post(); crowd.current?.groan(); }
          else { crowd.current?.groan(); }
          onShotResolved(a.outcome);
        }
      } else if (a.kind === "after" && a.outcome && a.shot) {
        const p = clamp(elapsed / 1.3, 0, 1), result = a.outcome.result, end = toScreen(a.outcome.target.x, a.outcome.target.y);
        state.keeperPose = keeperPose(a.outcome.plan, a.outcome.target.time + p * 0.3, clock);
        const slump = result !== "goal" && motion ? Math.min(1, p * 2) : 0;
        state.friend = { ...state.friend, rows: rowsFor("up", false, 0), x: 232, y: 260 + slump * 3, squash: slump * 0.12, rotate: slump * 0.12 * Math.sin(clock * 3) };
        let bx = end.x, by = end.y, br = 2.5;
        if (result === "goal") { bx = end.x + (240 - end.x) * 0.15 * p; by = end.y - 6 * Math.sin(Math.PI * Math.min(1, p * 2)) + Math.min(1, p * 1.5) * (168 - 4 - end.y); br = 2.3; }
        else if (result === "save") { const dir = end.x >= 240 ? 1 : -1; bx = end.x + dir * 120 * p; by = end.y + 90 * p - 40 * Math.sin(Math.PI * p); br = 2.5 + 2 * p; }
        else if (result === "post") { bx = end.x + (240 - end.x) * 0.4 * p; by = end.y + 110 * p - 30 * Math.sin(Math.PI * p); br = 2.5 + 2.2 * p; }
        else { bx = end.x + (end.x - 240) * 0.4 * p; by = end.y - 50 * p; br = 2.5 - 1.2 * p; }
        state.ball = { ...state.ball, x: bx, y: by, r: br, visible: p < 0.98 || result === "goal", spin: 0 };
        trail.length = 0;
        if (p >= 1) { a.kind = result === "goal" ? "cele" : "none"; a.start = clock; if (result !== "goal") onAnimationDone(); }
      } else if (a.kind === "cele") {
        const p = clamp(elapsed / 1.8, 0, 1), celebration = equip.celebration;
        const rows = rowsFor("down", false, 0);
        let x = 232, y = 260, rotate = 0, flip = false, squash = 0;
        if (motion) {
          if (celebration === "cele-jump") y -= Math.abs(Math.sin(p * Math.PI * 3)) * 18;
          if (celebration === "cele-spin") flip = Math.floor(p * 16) % 2 === 1;
          if (celebration === "cele-slide") { x += 60 * Math.sin(p * Math.PI / 2); squash = 0.2; }
          if (celebration === "cele-flip") { y -= Math.sin(p * Math.PI) * 26; rotate = -p * Math.PI * 2; }
          if (celebration === "cele-robot") { x += (Math.floor(p * 8) % 2 ? 4 : -4); rotate = (Math.floor(p * 6) % 3 - 1) * 0.15; }
          if (celebration === "cele-plane") { x += Math.sin(p * Math.PI * 2) * 40; rotate = Math.sin(p * Math.PI * 4) * 0.3; }
        }
        state.friend = { ...state.friend, rows: rows, x, y, rotate, flip, squash };
        state.ball.visible = false;
        if (p >= 1) { a.kind = "none"; onAnimationDone(); }
      }
      if (ripple) { ripple.t += dt; if (ripple.t > 1.4) ripple = null; }
      state.ripple = ripple;
      shake = Math.max(0, shake - dt * 2.5); roar = Math.max(0, roar - dt * 0.5); flash = Math.max(0, flash - dt);
      state.shake = motion ? shake : 0; state.roar = motion ? roar : 0;
      state.flash = flash > 0 ? `rgba(255,255,255,${flash})` : null;
      renderScene(context, state);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const stopKeys = () => keys.current.clear();
    window.addEventListener("blur", stopKeys);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("blur", stopKeys); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Keyboard controls.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const current = live.current;
      if (current.paused || current.menu) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      if (current.phase !== "aim") {
        if (event.key === "Enter" && current.phase === "reveal") startAim();
        if (current.phase === "idle" && !event.repeat && (event.target as HTMLElement | null)?.tagName !== "BUTTON") {
          if (event.key === "Enter") placeRef.current();
          if (event.key === "w" || event.key === "W") warmRef.current();
        }
        return;
      }
      keys.current.add(event.key);
      const am = aim.current;
      if (event.key === "a" || event.key === "A") am.curl = clamp(Math.round((am.curl - 0.25) * 4) / 4, -1, 1);
      if (event.key === "d" || event.key === "D") am.curl = clamp(Math.round((am.curl + 0.25) * 4) / 4, -1, 1);
      if (event.key === " " && !event.repeat && !am.charging) { am.charging = true; am.chargeStart = performance.now(); am.power = 0; setAimHint(false); }
    };
    const up = (event: KeyboardEvent) => {
      keys.current.delete(event.key);
      const am = aim.current;
      if (event.key === " " && am.charging) {
        am.charging = false;
        if (live.current.phase === "aim" && !live.current.paused && !live.current.menu) shoot({ aimX: am.aimX + wobble(performance.now(), am.power), loft: am.loft, power: am.power, curl: am.curl });
      }
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (paused) { keys.current.clear(); aim.current.charging = false; drag.current = null; } }, [paused]);

  function flightDuration(outcome: ShotOutcome) { return outcome.target.time * 1.6; }

  async function act(work: () => Promise<void>, after?: () => void) {
    if (locked.current || paused) return;
    const version = epoch.current; locked.current = true; setBusy(true); setError(""); setMessage("");
    void unlockAudio();
    try { await work(); const value = await client.read(); if (version === epoch.current) { setSnapshot(value); after?.(); } }
    catch (cause) { if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The action failed."); }
    finally { if (version === epoch.current) { locked.current = false; setBusy(false); } }
  }
  async function unlockAudio() { if (!muted) { await sound.current?.unlock(); await crowd.current?.unlock(); } }

  /** Place a ball: consume one (SDK play), settle it (SDK outcome), reveal its rarity. */
  function placeBall() {
    if (!snapshot || phase !== "idle") return;
    void act(async () => {
      const version = epoch.current;
      const play = pending ?? (await client.play(1n))[0];
      sound.current?.play("anticipation");
      const settled = await client.settle(play.id);
      if (version !== epoch.current) return;
      if (settled.outcomeId === null) { setMessage("Randomness is still on its way. Choose Place ball again to resume this same ball."); return; }
      const meta = RARITIES[settled.outcomeId - 1];
      const drop = Math.round(tier.baseDrop * meta.dropMult);
      setGboot(value => value + drop);
      setCupRF(value => value + tier.priceRF * CUP_SHARE_OF_PRICE);
      setRace(value => value + meta.racePoints * tier.raceWeight);
      setBall({ mode: "match", playId: settled.id, outcomeId: settled.outcomeId });
      setPhase("reveal");
      sound.current?.play(meta.racePoints > 0 ? "reveal-legendary" : meta.dropMult >= 3 ? "reveal-rare" : "reveal-common");
    });
  }

  function warmUp() {
    if (phase !== "idle" || busy || paused) return;
    void unlockAudio(); setError(""); setMessage("");
    warmups.current++;
    setBall({ mode: "warmup", playId: null, outcomeId: null }); startAim();
  }

  function enterSkillCup() {
    if (phase !== "idle" || busy || paused || gboot < SKILL_CUP_ENTRY || skillRun) return;
    setGboot(value => value - SKILL_CUP_ENTRY); setBurned(value => value + SKILL_CUP_ENTRY / 2); setCupGboot(value => value + SKILL_CUP_ENTRY / 2);
    setSkillRun({ id: Date.now() % 100000, kicks: [], points: 0 }); setKeeper("ghost"); setMenu(null);
    setBall({ mode: "skill", playId: null, outcomeId: null }); startAim();
  }

  function startAim() {
    aim.current = { ...aim.current, power: 0, charging: false, loft: 0, curl: 0 };
    setPhase("aim"); setMenu(null);
  }

  function shoot(shot: ShotInput) {
    const current = live.current;
    if (current.phase !== "aim" || !current.ball || anim.current.kind !== "none") return;
    const ballId = current.ball.mode === "match" ? Number(current.ball.playId) : current.ball.mode === "skill" ? 900000 + (skillRunRef.current?.id ?? 0) : 800000 + warmups.current;
    const profile = keeperById(current.keeper);
    const outcome = resolveShot(shot, profile, kickSeed(ballId, kickIndex.current++, profile.id));
    // start = -1: the animation loop stamps the start with its own clock.
    anim.current = { kind: "runup", start: -1, shot, outcome, ballVisible: true };
    setPhase("shooting");
  }
  const skillRunRef = useRef(skillRun); skillRunRef.current = skillRun;
  const placeRef = useRef(() => {}), warmRef = useRef(() => {});
  placeRef.current = () => { if (snapshot && (snapshot.consumables > 0n || pending)) placeBall(); };
  warmRef.current = warmUp;

  function onShotResolved(outcome: ShotOutcome) {
    const current = live.current, profile = keeperById(current.keeper), mode = current.ball?.mode ?? "warmup";
    const meta = current.ball?.outcomeId ? RARITIES[current.ball.outcomeId - 1] : null;
    const goal = outcome.result === "goal";
    const labels = { goal: "GOAL!", save: "SAVED!", post: "OFF THE POST!", over: "OVER THE BAR!", wide: "WIDE!" } as const;
    if (mode === "warmup") {
      setBanner({ text: labels[outcome.result], sub: "Warm-up kick · no score, no rewards", tone: goal ? "goal" : "miss" });
      return;
    }
    if (mode === "skill") {
      setSkillRun(run => {
        if (!run) return run;
        // Same rule as the referee (verifier/src/core.ts scoreKick): streak = consecutive goals.
        const trailing = run.kicks.reduce((streak, kick) => (kick ? streak + 1 : 0), 0);
        const points = goal ? goalPoints(profile, 1, trailing + 1, false) : 0;
        const next = { ...run, kicks: [...run.kicks, goal], points: run.points + points };
        setBanner({ text: labels[outcome.result], sub: `Skill Cup kick ${next.kicks.length}/5 · ${formatNumber(next.points)} pts (simulated)`, tone: goal ? "goal" : "miss" });
        return next;
      });
      return;
    }
    setRound(previous => {
      const nextStreak = goal ? streak + 1 : 0;
      const points = goal ? goalPoints(profile, meta?.dropMult ?? 1, nextStreak, previous.suddenDeath) : 0;
      setStreak(nextStreak); setScore(value => value + points);
      const earned: string[] = [];
      if (goal) earned.push("first-goal");
      if (nextStreak >= 3) earned.push("hat-trick");
      if (streakMultiplier(nextStreak) >= 3) earned.push("max-streak");
      if (goal && Math.abs(outcome.target.x) > 0.75 && outcome.target.y > 0.7) earned.push("top-bins");
      if (goal && Math.abs(anim.current.shot?.curl ?? 0) >= 0.75) earned.push("banana");
      if (goal && previous.suddenDeath) earned.push("iron-nerve");
      if (goal && current.keeper === "ghost") earned.push("ghostbuster");
      let next: RoundState = { ...previous, kicks: [...previous.kicks, goal], points: previous.points + points };
      let sub = goal ? `+${formatNumber(points)} pts · ${meta?.name ?? ""} ×${meta?.dropMult ?? 1} · streak ×${streakMultiplier(nextStreak)}` : "Streak reset";
      const regular = next.kicks.length <= 5 && !next.suddenDeath;
      if (regular && next.kicks.length === 5) {
        const goals = next.kicks.filter(Boolean).length;
        if (goals === 5) earned.push("perfect-five");
        if (goals >= 3) { next = { ...next, suddenDeath: true }; sub += " · SUDDEN DEATH: ×2 until you miss"; }
        else next = finishRound(next);
      } else if (next.suddenDeath && !goal) next = finishRound(next);
      if (earned.length) setBadges(set => { const copy = new Set(set); earned.forEach(id => copy.add(id)); return copy; });
      setBanner({ text: labels[outcome.result], sub, tone: goal ? "goal" : "miss" });
      return next;
    });
  }

  function finishRound(state: RoundState): RoundState {
    setLastRound(state); setBestRound(best => Math.max(best, state.points));
    setTimeout(() => setMenu("round"), 900);
    return { kicks: [], suddenDeath: false, points: 0 };
  }

  function onAnimationDone() {
    const mode = live.current.ball?.mode;
    setBanner(null); setBall(null); setPhase("idle");
    if (mode === "skill") {
      const run = skillRunRef.current;
      if (run && run.kicks.length >= 5) {
        setSkill(list => [...list, { id: run.id, name: "Your Friend", score: run.points, mine: true }]);
        setSkillRun(null); setMenu("cup");
      } else if (run) { setBall({ mode: "skill", playId: null, outcomeId: null }); startAim(); }
    }
  }

  // Touch / mouse flick from the ball.
  const toLogical = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    return { x: (event.clientX - rect.left - (rect.width - W * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - H * scale) / 2) / scale };
  };
  const applyDrag = (points: { x: number; y: number }[]) => {
    const start = points[0], end = points[points.length - 1];
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    const am = aim.current;
    am.power = clamp(length / 140, 0, 1);
    am.aimX = clamp((dx / Math.max(12, -dy)) / 0.96, -1.4, 1.4);
    let deviation = 0;
    if (length > 8) for (const point of points) {
      const cross = ((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
      if (Math.abs(cross) > Math.abs(deviation)) deviation = cross;
    }
    am.curl = clamp((-deviation / Math.max(40, length)) * 4, -1, 1);
    return length;
  };

  if (!snapshot) return <div className="pk-loading" role={error ? "alert" : "status"}>
    <div className="pk-loading-ball" aria-hidden="true" />{error || "Loading the stadium…"}
    {error && <button type="button" onClick={() => { setError(""); void client.read().then(setSnapshot).catch(cause => setError(cause instanceof Error ? cause.message : "Could not load the game.")); }}>Retry</button>}
  </div>;
  if (snapshot.friendId !== friendId) return <p role="alert">This game session does not match the selected Friend.</p>;

  const balls = snapshot.consumables + (pending ? 1n : 0n);
  const raceTable = [...SIM_RACE.map((points, index) => ({ name: RIVALS[index], points, mine: false })), { name: "Your Friend", points: race + wildcardPoints(wildcards, tier.raceWeight), mine: true }]
    .sort((a, b) => b.points - a.points);
  const raceRank = raceTable.findIndex(row => row.mine) + 1;
  const skillTable = [...skill].sort((a, b) => b.score - a.score || a.id - b.id);
  const inRound = round.kicks.length;
  const simTag = simulated ? " (sim)" : "";

  return <section className="pk" aria-label={definition.name} aria-busy={busy} data-phase={phase}>
    <div className="pk-stage" inert={Boolean(menu) || paused || undefined}>
      <canvas ref={canvas} className="pk-canvas" width={W} height={H} tabIndex={0}
        aria-label="Penalty spot. Drag from the ball towards the goal to shoot, or use arrow keys to aim and hold Space to charge."
        onPointerDown={event => {
          if (paused || menu || phase !== "aim") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = toLogical(event);
          if (point.y < 140) return;
          drag.current = { points: [point] }; aim.current.power = 0; setAimHint(false);
        }}
        onPointerMove={event => { if (drag.current) { drag.current.points.push(toLogical(event)); applyDrag(drag.current.points); } }}
        onPointerUp={event => {
          const current = drag.current; drag.current = null;
          if (!current || paused || menu) return;
          current.points.push(toLogical(event));
          const length = applyDrag(current.points), am = aim.current;
          if (length > 14 && current.points[current.points.length - 1].y < current.points[0].y) shoot({ aimX: am.aimX, loft: 0, power: am.power, curl: am.curl });
        }}
        onPointerCancel={() => { drag.current = null; }} />

      <header className="pk-hud pk-hud-left">
        <span className={`pk-chip ${simulated ? "pk-sim" : "pk-live"}`}>{tier.name.toUpperCase()} · {simulated ? "SIMULATED" : "LIVE RF"}</span>
        <span className="pk-stat" title="RF balance of your Friend's wallet">RF <b data-testid="rf">{formatGameAmount(snapshot.rfBalance, 18)}</b>{simTag}</span>
        <span className="pk-stat">Balls <b data-testid="balls">{balls.toString()}</b></span>
        <span className="pk-stat">$GBOOT <b data-testid="gboot">{formatNumber(gboot)}</b>{simulated ? " (sim)" : " (est., paid weekly)"}</span>
      </header>
      <header className="pk-hud pk-hud-right">
        <span className="pk-stat">Score <b data-testid="score">{formatNumber(score)}</b></span>
        <span className="pk-stat">Streak <b>×{streakMultiplier(streak)}</b></span>
        {simulated ? <>
          <span className="pk-stat">Cup <b>{formatCompact(cupRF)} RF</b>{simTag}</span>
          <span className="pk-stat">Race <b>#{raceRank}</b>{simTag}</span>
        </> : <span className="pk-stat">Cup <b>weekly</b> · see report</span>}
      </header>
      <div className="pk-round" aria-label={`Keeper ${keeperById(keeper).name}. Round kick ${inRound} of 5${round.suddenDeath ? ", sudden death" : ""}`}>
        <span className="pk-keeper">{keeperById(keeper).name} ×{keeperById(keeper).mult}</span>
        {skillRun ? <span className="pk-dots">SKILL CUP {skillRun.kicks.map((kick, index) => <i key={index} data-goal={kick} />)}{Array.from({ length: 5 - skillRun.kicks.length }, (_, index) => <i key={`e${index}`} />)}</span>
          : <span className="pk-dots" data-testid="round" data-kicks={inRound}>{round.suddenDeath ? "SUDDEN DEATH " : ""}{round.kicks.slice(-5).map((kick, index) => <i key={index} data-goal={kick} />)}{Array.from({ length: Math.max(0, 5 - inRound) }, (_, index) => <i key={`e${index}`} />)}</span>}
      </div>

      {banner && <div className={`pk-banner pk-${banner.tone}`} role="status"><strong>{banner.text}</strong><span>{banner.sub}</span></div>}
      {phase === "aim" && aimHint && <p className="pk-aimhint">Drag up from the ball: direction aims, length is power, a curved flick adds curl · Keys: ←→ aim, ↑↓ loft, A/D curl, hold Space</p>}
      {artStatus && <p className="pk-art-status" role="status">{artStatus}</p>}

      {phase === "reveal" && rarity && <div className="pk-reveal" role="dialog" aria-label={`${rarity.name} revealed`}>
        <BallIcon color={rarity.color} accent={rarity.accent} size={64} />
        <small>{rarity.label}</small>
        <h2>{rarity.name}</h2>
        <p>Redeemable for <b>{rf(definition.outcomes[ball!.outcomeId! - 1].reward)}</b>{simTag} · kept in your Locker</p>
        <p>$GBOOT drop <b>+{formatNumber(Math.round(tier.baseDrop * rarity.dropMult))}</b>{simulated ? " (simulated)" : " (paid weekly)"} · score ×{rarity.dropMult}{rarity.racePoints ? ` · +${rarity.racePoints * tier.raceWeight} Cup race pts` : ""}</p>
        <button type="button" className="pk-primary" onClick={startAim} autoFocus>Take the kick ⏎</button>
        <p className="pk-rule">{RULE}</p>
      </div>}

      <nav className="pk-actions" aria-label="Game actions">
        <button type="button" onClick={() => setMenu("kitbag")} disabled={busy || phase === "shooting"}>Kit bag</button>
        {phase === "idle" && (balls > 0n
          ? <button type="button" className="pk-primary" disabled={busy || paused} onClick={placeBall}>{busy ? "Placing…" : pending ? "Resume ball" : "Place ball"}</button>
          : <button type="button" className="pk-primary" disabled={busy || paused} onClick={() => setMenu("kitbag")}>Buy balls</button>)}
        {phase === "idle" && <button type="button" disabled={busy || paused} onClick={warmUp}>Warm-up</button>}
        {phase === "aim" && <button type="button" className="pk-primary" onClick={() => shoot({ aimX: aim.current.aimX, loft: aim.current.loft, power: 0.8, curl: aim.current.curl })}>Quick shot</button>}
        <button type="button" onClick={() => setMenu("hub")} disabled={phase === "shooting"}>Menu</button>
      </nav>
      {(error || message) && phase !== "shooting" && <p className="pk-toast" role={error ? "alert" : "status"}>{error || message}</p>}
    </div>

    {paused && <div className="pk-paused" role="status">Paused</div>}

    {menu && <GameMenu title={menuTitle(menu)} onClose={busy ? undefined : () => setMenu(null)}>
      {menu === "hub" && <div className="pk-hub">
        {(["kitbag", "locker", "keeper", "cup", "shop", "stadium", "rules", "settings"] as const).map(id =>
          <button key={id} type="button" onClick={() => setMenu(id)} disabled={id === "keeper" && (inRound > 0 || Boolean(skillRun))}>{menuTitle(id)}</button>)}
        {simulated && <p className="pk-note">Economy is SIMULATED in this preview: RF, balls, rewards, $GBOOT, Cup and shop resets on reload. Wallet and Friend ownership are real (SDK gate).</p>}
      </div>}

      {menu === "kitbag" && <>
        <p>One ball costs <b>{rf(definition.price)}</b>{simTag}. Placing a ball reveals its rarity by {simulated ? "a simulated draw" : "on-chain Dice randomness"}; the rarity fixes its RF value, $GBOOT drop and score multiplier.</p>
        <table className="pk-odds"><thead><tr><th>Ball</th><th>Chance</th><th>RF value</th><th>$GBOOT drop</th></tr></thead>
          <tbody>{definition.outcomes.map((item, index) => <tr key={item.name}><td><BallIcon color={RARITIES[index].color} accent={RARITIES[index].accent} size={14} /> {item.name}</td><td>{item.chanceBps / 100}%</td><td>{formatGameAmount(item.reward, 18)}</td><td>+{formatNumber(Math.round(tier.baseDrop * RARITIES[index].dropMult))} (×{RARITIES[index].dropMult})</td></tr>)}</tbody></table>
        <p>Expected RF back per ball: 90% ({formatNumber(tier.priceRF * 0.9)} RF). Every ball reserves the top prize ({rf(maxPrize)}) until it is settled.</p>
        {stadiumFull ? <p className="pk-warn" role="status">Stadium full — every seat's top prize is reserved right now. Try another stadium or come back after some balls settle.</p>
          : <div className="pk-buyrow">
            {[1n, 5n].map(quantity => <button key={quantity.toString()} type="button" className="pk-primary" disabled={busy || paused || !snapshot || snapshot.rfBalance < definition.price * quantity}
              onClick={() => void act(async () => { if (!(await client.canBuy(quantity))) throw new Error("Stadium full — try another stadium."); await client.buy(quantity); }, () => { sound.current?.play("purchase"); setMessage(`${quantity} ball${quantity > 1n ? "s" : ""} added to your kit bag.`); })}>
              Buy {quantity.toString()} · {rf(definition.price * quantity)}</button>)}
          </div>}
        {!canBuy && !stadiumFull && <p>{simulated ? `The preview wallet holds ${rf(snapshot.rfBalance)} of simulated RF. Redeem balls in your Locker to get RF back, or play Warm-up kicks for free.` : "Not enough RF in your Friend's wallet — use Transfer RF to Friend in the wallet menu."}</p>}
        <p className="pk-rule">{RULE}</p>
      </>}

      {menu === "locker" && <>
        <p>Balls you have drawn keep their fixed RF value forever. Redeem any time; RF goes to your Friend's wallet{simTag}.</p>
        {definition.outcomes.map((item, index) => <div className="pk-item" key={item.name}>
          <span><BallIcon color={RARITIES[index].color} accent={RARITIES[index].accent} size={16} /> <strong>{item.name}</strong> <small>{snapshot.inventory[index].toString()} kept · {rf(item.reward)}</small></span>
          <button type="button" disabled={busy || paused || snapshot.inventory[index] === 0n || item.reward === 0n}
            onClick={() => void act(() => client.redeem(index + 1, snapshot.inventory[index]), () => sound.current?.play("reward"))}>Redeem all</button>
        </div>)}
      </>}

      {menu === "keeper" && <div className="pk-keepers">
        {KEEPERS.map(profile => <button key={profile.id} type="button" aria-pressed={keeper === profile.id} onClick={() => { setKeeper(profile.id); setMenu(null); }}>
          <strong>{profile.name} · score ×{profile.mult}</strong><small>{profile.blurb}</small></button>)}
        <p className="pk-note">You can change keeper between rounds. Tougher keepers score more points; they never change ball rarity or rewards.</p>
      </div>}

      {menu === "cup" && !simulated && <>
        <h3>Golden Boot Cup (live)</h3>
        <p>The live pot, race table and payouts are computed each week from on-chain ball settlements by a public script and published with transaction links in the project's docs/WEEKLY.md. This screen does not invent live numbers.</p>
        <p>Race points this session (from your settled balls): <b>{formatNumber(race)}</b>. Gold = 1 pt, Golden Boot = 2 pts, × stadium weight.</p>
        <h3>Skill Cup</h3>
        <p className="pk-note">The replay referee is not connected to this build yet, so Skill Cup entries are not available in live mode.</p>
      </>}
      {menu === "cup" && simulated && <>
        <h3>Golden Boot Cup — this week{simTag}</h3>
        <p>Pot: <b>{formatNumber(cupRF)} RF</b> + <b>{formatNumber(cupGboot)} $GBOOT</b>{simTag}. The top 10 Friends by Gold (1 pt) and Golden Boot (2 pts) balls drawn this week, weighted by stadium (Park ×1, Pro ×100, Champions ×1,000), share the pot: {CUP_CURVE.join(" / ")}%.</p>
        <ol className="pk-table">{raceTable.slice(0, 10).map((row, index) => <li key={row.name} data-mine={row.mine}><span>{index + 1}. {row.name}</span><b>{formatNumber(row.points)}</b></li>)}</ol>
        {raceRank > 10 && <p>You: #{raceRank} with {formatNumber(race)} pts.</p>}
        <button type="button" disabled={gboot < WILDCARD_PRICE || busy} onClick={() => {
          setGboot(value => value - WILDCARD_PRICE); setBurned(value => value + WILDCARD_PRICE / 2); setCupGboot(value => value + WILDCARD_PRICE / 2); setWildcards(value => value + 1);
        }}>Wildcard entry · {WILDCARD_PRICE} $GBOOT (50% burned, 50% to pot)</button>
        <p className="pk-note">Wildcards: {wildcards}{simTag}. Live wildcard draws use on-chain randomness.</p>
        <h3>Skill Cup — best 5-kick shootout vs Ghost{simTag}</h3>
        <ol className="pk-table">{skillTable.slice(0, 5).map((row, index) => <li key={row.id} data-mine={row.mine}><span>{index + 1}. {row.name}</span><b>{formatNumber(row.score)}</b></li>)}</ol>
        <button type="button" className="pk-primary" disabled={gboot < SKILL_CUP_ENTRY || phase !== "idle" || Boolean(skillRun)} onClick={enterSkillCup}>Enter · {SKILL_CUP_ENTRY} $GBOOT (50% burned, 50% to pot)</button>
        <p className="pk-note">SIMULATED locally. Live entries are replayed by a referee server: your kick inputs are committed before the keeper's dive exists, the dive comes from a weekly secret whose hash is published in advance, and the server re-simulates every kick. Top 3 paid weekly; ties go to the earlier entry.</p>
      </>}

      {menu === "shop" && <>
        {simulated ? <p>Cosmetics are bought with $GBOOT, which is burned{simTag}. Balance: <b>{formatNumber(gboot)}</b> · burned so far {formatNumber(burned)}.</p>
          : <p>Try-on only: nothing is spent or burned here. On-chain KitShop purchases ($GBOOT burned, unlocks per Friend) need a bridge action the SDK does not supply yet (roadmap v1.1).</p>}
        {(["boots", "kit", "net", "celebration"] as const).map(kind => <div key={kind} className="pk-shopgroup"><h3>{kind === "kit" ? "Kits (halo colour)" : kind === "net" ? "Net colours" : kind === "celebration" ? "Celebrations" : "Boots"}</h3>
          {COSMETICS.filter(item => item.kind === kind).map(item => {
            const has = owned.has(item.id), on = equipped[kind] === item.id;
            return <button key={item.id} type="button" aria-pressed={on} disabled={simulated && !has && gboot < item.price} onClick={() => {
              if (!has && simulated) { setGboot(value => value - item.price); setBurned(value => value + item.price); setOwned(set => new Set(set).add(item.id)); sound.current?.play("purchase"); }
              setEquipped(value => ({ ...value, [kind]: item.id }));
            }}>{item.color && <i className="pk-swatch" style={{ background: item.color }} />}{item.name} · {has || !simulated ? on ? "equipped" : simulated ? "equip" : "try on" : `${item.price} $GBOOT`}</button>;
          })}</div>)}
      </>}

      {menu === "stadium" && <>
        <p>Three stadiums, same odds and 90% return, scaled prices. Each stadium is its own game contract and its own page.</p>
        {TIERS.map(item => <div key={item.id} className="pk-item" data-current={item.id === tier.id}>
          <span><strong>{item.name}</strong> <small>{item.priceRF.toLocaleString("en-US")} RF per ball · top prize {(item.priceRF * 10).toLocaleString("en-US")} RF</small></span>
          <small>{item.id === tier.id ? "You are here" : item.id === "champions" ? "Unlocks when the Pro bank earns it" : `Open ${item.path} on this site`}</small>
        </div>)}
        {simulated && <p className="pk-note">The preview wallet holds 20 simulated RF, so Pro and Champions balls are out of reach here; their odds and prices are shown for reference.</p>}
      </>}

      {menu === "rules" && <div className="pk-rules">
        <p><b>{RULE}</b></p>
        <ol>
          <li>Buy balls in your Kit bag with RF. Every ball reserves its top prize, so every reward is backed.</li>
          <li>Place a ball: its rarity is revealed (Scuffed → Golden Boot). That sets its RF value (redeem any time in your Locker), its $GBOOT drop and its score multiplier.</li>
          <li>Shoot. Touch: drag up from the ball — direction aims, length is power, a curved flick bends it. Keys: ←→ aim, ↑↓ loft, A/D curl, hold Space to charge and release to shoot. Too much power sails over the bar.</li>
          <li>Goal = 100 × keeper × ball multiplier × streak (streak caps at ×3). Save or miss resets the streak.</li>
          <li>Rounds are 5 kicks. Score 3+ and you play sudden death at ×2 points until you miss.</li>
          <li>Golden Boot Cup: weekly, pays the top 10 Friends by Gold and Golden Boot balls drawn (luck + volume, verifiable on-chain).</li>
          <li>Skill Cup: weekly, best 5-kick shootout vs Ghost, verified by replay.</li>
          <li>Warm-up kicks are free and give no score or rewards.</li>
        </ol>
        {simulated && <p className="pk-note">Preview: every balance, ball, reward, $GBOOT amount, Cup pot, race table and rival shown here is SIMULATED and resets on reload.</p>}
      </div>}

      {menu === "settings" && <div className="pk-settings">
        <button type="button" aria-pressed={!muted} onClick={() => {
          const next = !muted; setMuted(next); sound.current?.setMuted(next); crowd.current?.setMuted(next);
          if (!next) { void sound.current?.unlock(); void crowd.current?.unlock(); }
        }}>{muted ? "Sound off" : "Sound on"}</button>
        <label><input type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)} /> Reduce motion (no shake, flashes or celebrations)</label>
        <p>Badges: {badges.size ? [...badges].map(id => BADGES[id]).join(" · ") : "none yet"}</p>
        <p>Best round: {formatNumber(bestRound)} pts.</p>
      </div>}

      {menu === "round" && lastRound && <div className="pk-roundcard">
        <h3>{lastRound.kicks.filter(Boolean).length} goals from {lastRound.kicks.length} kicks</h3>
        <p className="pk-dots">{lastRound.kicks.map((kick, index) => <i key={index} data-goal={kick} />)}</p>
        <p><b>{formatNumber(lastRound.points)}</b> points · best round {formatNumber(Math.max(bestRound, lastRound.points))}</p>
        <button type="button" className="pk-primary" onClick={() => setMenu(null)}>Next round</button>
      </div>}
    </GameMenu>}
  </section>;
}

/** Reticle wobble: grows with charge, so a held Space never gives a perfectly still aim. */
function wobble(now: number, power: number) {
  return Math.sin(now / 173) * 0.05 * power + Math.sin(now / 71) * 0.02 * power;
}

function wildcardPoints(count: number, weight: number) {
  // Preview only: each wildcard is shown as an expected-value draw (0.045 pts × weight). Live draws are on-chain.
  return Math.round(count * 0.045 * weight * 100) / 100;
}

function formatCompact(value: number) {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : formatNumber(value);
}

function menuTitle(menu: Exclude<Menu, null>) {
  return { hub: "Menu", kitbag: "Kit bag", locker: "Locker", cup: "Cups", shop: "Kit shop", stadium: "Stadiums", rules: "Rules", settings: "Settings", keeper: "Choose keeper", round: "Round over" }[menu];
}

function BallIcon({ color, accent, size }: { color: string; accent: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, 18, 18); drawBall(context, 9, 9, 9, color, accent);
  }, [color, accent]);
  return <canvas ref={ref} className="pk-ballicon" width={18} height={18} style={{ width: size, height: size }} aria-hidden="true" />;
}
