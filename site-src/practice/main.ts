/**
 * Free practice: five penalty kicks against the Penalty Kings keepers, on the public site, OUTSIDE the
 * SDK game. It runs the real shared code: the engine (swipeToShot → aimedShot → resolveShot, the
 * keepers), the Stage (stadium, crowd, keepers, commentary) and the Match Director.
 *
 * Deliberately NOT here: any wallet or provider code, network calls, Rare Friends sprites, RF, balls,
 * $GBOOT, prizes or the pot. The striker is an original silhouette (./striker.ts). Nothing needs
 * storage; the only stored thing is "rotate hint dismissed", and every storage access is guarded.
 */
import {
  keeperById, keeperPlan, kickSeed, swipeToShot, aimedShot, shotTarget, aimWobble, wobbleFor, clamp,
  type ShotInput, type ShotResult, type SwipePoint, type SwipeOptions, type InputKind,
} from "@penalty-kings/engine";
import { Stage, CELEBRATIONS } from "../../games/penalty-kings/gfx/stage.js";
import { W, H } from "../../games/penalty-kings/gfx/core.js";
import { SPOT, GOAL, PENALTY_GOAL, weatherForDay } from "../../games/penalty-kings/gfx/stadium.js";
import { cueLine } from "../../games/penalty-kings/gfx/commentary.js";
import { createGameDirector, applyBeat, playMoment, type Beat } from "../../games/penalty-kings/game/director.js";
import { keyShot, type KeyAim } from "../../games/penalty-kings/game/input.js";
import { createCrowd } from "../../games/penalty-kings/audio.js";
import { isSfx } from "../../games/penalty-kings/audio-core.js";
import { strikerRows, STRIKER_STAND } from "./striker.js";
import { PRACTICE_TUNING, practiceKick, missHint } from "./tuning.js";
import { cardImage, shareAbilities, CARD_TAGLINE } from "../../games/penalty-kings/gfx/sharecard.js";
import { PUBLIC_URL } from "../../games/penalty-kings/game/challenge.js";

export const PRACTICE_KICKS = 5;
/** Ad boards without token or cup names (the stadium's usual jokes minus the economy ones). */
const BOARDS = ["PENALTY KINGS", "FREE PRACTICE", "KEEPERS HATE THIS ONE TRICK", "NO REFUNDS ON SHIN PADS", "TOP BINS MONTHLY", "NUTMEG INSURANCE CO.", "HALF-TIME ORANGES"];
const LABELS: Record<ShotResult, string> = { goal: "GOAL!", save: "SAVED!", post: "OFF THE POST!", over: "OVER THE BAR!", wide: "WIDE!" };
/** Practice difficulty (site-src/practice/tuning.ts): the game's easiest rung, no shot clock, a keeper who can stay up for the middle. */
const DIFFICULTY = PRACTICE_TUNING.difficulty;

type Phase = "intro" | "aim" | "shooting" | "done";
type Kick = { result: ShotResult; keeper: string; zone: string; x: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("pp-canvas");
const context = canvas.getContext("2d")!;
const count = $("pp-count"), status = $("pp-status"), banner = $("pp-banner"), results = $("pp-results"), end = $("pp-end");
const tip = $("pp-tip");
const endScore = $("pp-end-score"), quick = $<HTMLButtonElement>("pp-quick"), again = $<HTMLButtonElement>("pp-again"), soundButton = $<HTMLButtonElement>("pp-sound");

const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const scene = new Stage({ stadium: "park", weather: weatherForDay(), keeper: "mouse" });
scene.scoreboard = true; // practice is always a session: the SCORE box stays (QA-7 hides it outside sessions in the game)
scene.setReduced(reducedMotion);
scene.rows = strikerRows;
scene.friendName = "The Trialist";
scene.boardText = BOARDS;
scene.rarity = 7; scene.lucky = false; // the plain warm-up ball: no rarity, no ball economy

const crowd = createCrowd();
let soundOn = false;

/** `?seed=N` fixes the FIRST round's seed (tests; a shared practice). "Practice again" always rolls a new one. */
const fixedSeed = (() => { try { const value = Number(new URLSearchParams(location.search).get("seed")); return Number.isSafeInteger(value) && value > 0 ? value >>> 0 : null; } catch { return null; } })();
const randomSeed = () => { try { return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1; } catch { return Math.floor(Math.random() * 2 ** 31); } };

const state = {
  phase: "intro" as Phase,
  seed: fixedSeed ?? randomSeed(),
  kicks: [] as Kick[],
  goals: 0, streak: 0,
  swipe: null as SwipePoint[] | null,
  pointer: null as number | null,
  gesture: { pxPerUnit: 1, input: "touch" as InputKind },
  keys: new Set<string>(),
  aim: { aimX: 0.5, aimY: 0.5, curl: 0, top: 0, power: 0, charging: false, chargeStart: 0 } as KeyAim & { charging: boolean; chargeStart: number },
  pending: null as Kick | null,
  opening: null as Beat | null,
  afterBeat: null as Beat | null,
  epoch: 0,
};
let director = createGameDirector(state.seed, { name: scene.friendName, number: "" });

/** Queue a line or moment in this round only (a restart drops what the old round queued). */
const later = (ms: number, run: () => void) => { const epoch = state.epoch; if (ms <= 0) run(); else window.setTimeout(() => { if (state.epoch === epoch) run(); }, ms); };
const shootable = () => state.phase === "aim" && !scene.busy && !scene.moment;

// ── Swipe mapping: identical to the game's penalty camera (games/penalty-kings/index.tsx swipeOptions) ──
const swipeOptions = (): SwipeOptions => ({
  width: W, height: H, pxPerUnit: state.gesture.pxPerUnit, input: state.gesture.input,
  goal: { cx: PENALTY_GOAL.x, line: PENALTY_GOAL.y, unitX: GOAL.unit * PENALTY_GOAL.g, unitY: GOAL.unit * 0.89 * PENALTY_GOAL.g },
  ball: { x: SPOT.x, y: SPOT.y },
});
function toLogical(event: PointerEvent): SwipePoint {
  const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / W, rect.height / H);
  state.gesture = { pxPerUnit: scale, input: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "trackpad" : "mouse" };
  return { x: (event.clientX - rect.left - (rect.width - W * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - H * scale) / 2) / scale, t: event.timeStamp };
}
const wobble = () => aimWobble(performance.now() / 1000, wobbleFor(DIFFICULTY, state.streak));

// ── Round flow ─────────────────────────────────────────────────────────────
let rounds = 0;
function startRound() {
  state.epoch++;
  state.seed = rounds++ === 0 && fixedSeed !== null ? fixedSeed : randomSeed(); state.kicks = []; state.goals = 0; state.streak = 0; state.pending = null; state.afterBeat = null;
  director = createGameDirector(state.seed, { name: scene.friendName, number: "" });
  scene.cancel(); scene.setScore(0); scene.streak = 0; scene.kind = "penalty"; scene.hints = 0;
  const opening = director.startSession({ mode: "penalties", stadium: "park", keeper: "mouse", weather: scene.weather });
  scene.keeper = opening.keeper;
  end.hidden = true; document.body.classList.remove("pp-finished");
  renderResults(); setBanner(null); setTip("");
  state.phase = "intro";
  state.opening = opening;
  scene.walkout("walkout"); // "walkout-done" opens the first kick
}

function afterWalkout() {
  const opening = state.opening; state.opening = null;
  if (state.phase !== "intro") return;
  if (opening) applyBeat(scene, { ...opening, keeperChanged: false }, ["before"], later);
  startAim();
}

function startAim() {
  state.aim = { ...state.aim, power: 0, charging: false, curl: 0, top: 0 };
  const index = state.kicks.length;
  // The Director picks THIS kick's keeper (set before keeperPlan/resolveShot) and stages its pre-kick moments.
  const beat = director.beforeKick({ now: performance.now() / 1000 });
  applyBeat(scene, beat, ["before"], later);
  scene.ballVisible = true;
  scene.celebration = CELEBRATIONS[index % 4].id; // the first four celebrations, one per goal
  scene.tell = keeperPlan(keeperById(scene.keeper), kickSeed(state.seed, index, scene.keeper), { x: 0, y: 0.5 }, { kickIndex: index, history: state.kicks.map(kick => kick.x) });
  state.phase = "aim";
  count.textContent = `Kick ${index + 1} of ${PRACTICE_KICKS}`;
  setStatus(index === 0 ? "Swipe up from the ball to shoot. The target shows where it will land." : `Next up: ${keeperById(scene.keeper).name}.`);
}

function shoot(raw: ShotInput) {
  if (!shootable()) return;
  state.phase = "shooting"; quick.disabled = true;
  const index = state.kicks.length, profile = keeperById(scene.keeper);
  // Practice rules on top of the engine (tuning.ts): the reticle's aimed shot, then resolveShot, then the keeper's hold for the middle.
  const { shot, outcome } = practiceKick(raw, wobble(), profile.id, kickSeed(state.seed, index, profile.id), index, state.kicks.map(kick => kick.x));
  state.pending = { result: outcome.result, keeper: profile.name, zone: outcome.zone, x: outcome.target.x };
  // The Director only reacts: the Stage says its line when the ball arrives.
  const beat = director.afterKick({ kind: "penalty", result: outcome.result, zone: outcome.zone, x: outcome.target.x, y: outcome.target.y, postIn: outcome.postIn, now: performance.now() / 1000 });
  state.afterBeat = beat;
  scene.cue = beat.lines[0] ? cueLine(beat.lines[0]) : null;
  scene.play(outcome, shot.curl);
  setStatus(""); setTip("");
}

function onResolved() {
  const kick = state.pending; state.pending = null;
  if (!kick) return;
  state.kicks.push(kick);
  const goal = kick.result === "goal";
  if (goal) state.goals++;
  state.streak = goal ? state.streak + 1 : 0;
  scene.setScore(state.goals); scene.streak = state.streak;
  for (const moment of state.afterBeat?.moments ?? []) if (moment.slot === "reaction") playMoment(scene, moment, later);
  renderResults();
  const where = kick.zone === "bin" ? "top bin" : kick.zone === "corner" ? "in the corner" : kick.zone === "side" ? "to the side" : "down the middle";
  setBanner({ text: LABELS[kick.result], sub: goal ? `${where} · past ${kick.keeper}` : kick.result === "save" ? `${kick.keeper} saves it` : "No goal this time", goal });
  setStatus(`${LABELS[kick.result]} ${state.goals} of ${state.kicks.length}.`);
  // A miss gets one short, friendly pointer (kept up while the next kick is aimed).
  if (state.kicks.length < PRACTICE_KICKS) setTip(missHint(kick.result, kick.x));
}

function onDone() {
  if (state.phase !== "shooting") return;
  setBanner(null);
  for (const moment of state.afterBeat?.moments ?? []) if (moment.slot === "between") playMoment(scene, moment, later);
  state.afterBeat = null;
  if (state.kicks.length >= PRACTICE_KICKS) { finish(); return; }
  startAim();
}

function finish() {
  state.phase = "done"; scene.reticle = null; scene.ballVisible = false;
  count.textContent = "Full time";
  endScore.textContent = `You scored ${state.goals} of ${PRACTICE_KICKS}.`;
  setStatus(`Practice over: ${state.goals} of ${PRACTICE_KICKS}.`);
  resetShare();
  later(reducedMotion ? 200 : 1200, () => { end.hidden = false; document.body.classList.add("pp-finished"); (end.querySelector("h2") as HTMLElement | null)?.focus(); });
}

// ── C4 share card: the stand-in striker (never Friend art), goals and best streak; no network (a data: image) ──
const shareButton = $<HTMLButtonElement>("pp-share-btn"), shareImage = $<HTMLImageElement>("pp-share-img"), shareNote = $("pp-share-note");
const shareActions = $("pp-share-actions"), shareNative = $<HTMLButtonElement>("pp-share-native"), shareSave = $<HTMLAnchorElement>("pp-share-save");
let shareFile: File | null = null;
const SHARE_NOTE = shareNote.textContent ?? "";
const longestRun = () => { let best = 0, run = 0; for (const kick of state.kicks) { run = kick.result === "goal" ? run + 1 : 0; best = Math.max(best, run); } return best; };
function resetShare() {
  shareFile = null; shareImage.hidden = true; shareImage.removeAttribute("src"); shareNote.hidden = true; shareActions.hidden = true;
  shareButton.hidden = false; shareButton.disabled = false; shareButton.textContent = "Make my share card";
}
shareButton.addEventListener("click", async () => {
  shareButton.disabled = true; shareButton.textContent = "Drawing…";
  let image: Awaited<ReturnType<typeof cardImage>>;
  try { image = await cardImage({ name: scene.friendName, score: state.goals, scoreLabel: "goals", goals: state.goals, kicks: state.kicks.length, bestStreak: longestRun(), subtitle: "Free practice", link: PUBLIC_URL }, STRIKER_STAND, "#ffffff"); }
  catch { // never a silent, stuck button: say so, and the link below still works
    shareButton.disabled = false; shareButton.textContent = "Make my share card";
    shareNote.textContent = "The card could not be drawn here. Tap the link below to select it, then copy."; shareNote.hidden = false;
    return;
  }
  shareNote.textContent = SHARE_NOTE;
  shareFile = image.file;
  shareImage.src = image.url; shareImage.alt = `Share card: ${state.goals} of ${state.kicks.length} goals, best streak ${longestRun()}. ${CARD_TAGLINE}.`; shareImage.hidden = false;
  shareImage.dataset.bytes = String(image.bytes);
  const can = shareAbilities(image.file);
  shareNative.hidden = !can.share; shareSave.hidden = !can.download; shareSave.href = image.url;
  shareActions.hidden = !can.share && !can.download; shareNote.hidden = false; shareButton.hidden = true;
});
shareNative.addEventListener("click", async () => {
  if (!shareFile) return;
  try { await navigator.share({ files: [shareFile], title: "Penalty Kings", text: `${CARD_TAGLINE}: ${PUBLIC_URL}` }); }
  catch (error) { if ((error as { name?: string })?.name !== "AbortError") { shareNote.textContent = "Sharing is blocked here: long-press or right-click the image to save it."; } }
});
($<HTMLInputElement>("pp-share-link")).addEventListener("focus", event => (event.currentTarget as HTMLInputElement).select());

// ── DOM bits ───────────────────────────────────────────────────────────────
function renderResults() {
  const items = results.querySelectorAll("li");
  items.forEach((item, i) => {
    const kick = state.kicks[i];
    item.textContent = kick ? (kick.result === "goal" ? "GOAL" : kick.result.toUpperCase()) : String(i + 1);
    item.dataset.result = kick?.result ?? "";
    if (kick) item.setAttribute("data-testid", "practice-result"); else item.removeAttribute("data-testid");
    item.setAttribute("aria-label", kick ? `Kick ${i + 1}: ${kick.result}` : `Kick ${i + 1}: not taken`);
  });
}
function setBanner(value: { text: string; sub: string; goal: boolean } | null) {
  banner.hidden = !value;
  if (!value) return;
  banner.dataset.tone = value.goal ? "goal" : "miss";
  banner.replaceChildren(Object.assign(document.createElement("strong"), { textContent: value.text }), Object.assign(document.createElement("span"), { textContent: value.sub }));
}
const setTip = (text: string) => { tip.textContent = text; tip.hidden = !text; };
const setStatus = (text: string) => { status.textContent = text; quick.disabled = state.phase !== "aim"; };

// ── Aim (every frame): the same WYSIWYG reticle as the game ─────────────────
function tickAim(dt: number) {
  if (state.phase !== "aim") { scene.reticle = null; return; }
  const k = state.keys, am = state.aim;
  if (k.has("ArrowLeft")) am.aimX = clamp(am.aimX - dt * 1.2, -1.4, 1.4);
  if (k.has("ArrowRight")) am.aimX = clamp(am.aimX + dt * 1.2, -1.4, 1.4);
  if (k.has("ArrowUp")) am.aimY = clamp(am.aimY + dt * 0.6, 0, 1.2);
  if (k.has("ArrowDown")) am.aimY = clamp(am.aimY - dt * 0.6, 0, 1.2);
  if (am.charging) am.power = clamp((performance.now() - am.chargeStart) / 1100, 0, 1);
  const partial = state.swipe && state.swipe.length > 2 ? swipeToShot(state.swipe, swipeOptions()) : null;
  const shot = partial ?? keyShot({ ...am, power: am.charging ? am.power : 0.7 });
  const aimed = aimedShot(shot, wobble(), DIFFICULTY.assist), target = shotTarget(aimed);
  scene.reticle = { x: target.x, y: target.y, power: aimed.power, curl: aimed.curl, active: Boolean(partial) || am.charging, alpha: 1 };
}

// ── Input: swipe (pointer), keyboard, Quick shot ────────────────────────────
canvas.addEventListener("pointerdown", event => {
  if (state.phase !== "aim" || state.pointer !== null || state.aim.charging) return;
  const point = toLogical(event);
  if (point.y < H * 0.45) return; // swipes start on the pitch, near the ball (as in the game)
  try { canvas.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
  state.pointer = event.pointerId; state.swipe = [point];
  event.preventDefault();
});
canvas.addEventListener("pointermove", event => { if (state.swipe && event.pointerId === state.pointer) state.swipe.push(toLogical(event)); });
canvas.addEventListener("pointerup", event => {
  if (!state.swipe || event.pointerId !== state.pointer) return;
  state.swipe.push(toLogical(event));
  const points = state.swipe; state.swipe = null; state.pointer = null;
  const shot = swipeToShot(points, swipeOptions());
  if (shot) shoot(shot); else if (state.phase === "aim") setStatus("Swipe UP from the ball, towards the goal.");
});
const dropSwipe = (event: PointerEvent) => { if (event.pointerId === state.pointer) { state.swipe = null; state.pointer = null; } };
canvas.addEventListener("pointercancel", dropSwipe);
canvas.addEventListener("lostpointercapture", dropSwipe);
// Resize / rotate mid-swipe: the points were measured at the old scale, so drop the gesture (no shot).
for (const name of ["resize", "orientationchange"]) window.addEventListener(name, () => { state.swipe = null; state.pointer = null; });

window.addEventListener("keydown", event => {
  if (state.phase === "done" || event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
  if (state.phase !== "aim") return;
  state.keys.add(event.key);
  const am = state.aim;
  if (event.key === "a" || event.key === "A") am.curl = clamp(Math.round((am.curl - 0.25) * 4) / 4, -1, 1);
  if (event.key === "d" || event.key === "D") am.curl = clamp(Math.round((am.curl + 0.25) * 4) / 4, -1, 1);
  if (event.key === " " && !event.repeat && !am.charging) { am.charging = true; am.chargeStart = performance.now(); am.power = 0; }
});
window.addEventListener("keyup", event => {
  state.keys.delete(event.key);
  const am = state.aim;
  if (event.key === " " && am.charging) { am.charging = false; if (shootable()) shoot(keyShot(am)); }
});
window.addEventListener("blur", () => { state.keys.clear(); state.aim.charging = false; });
quick.addEventListener("click", () => shoot({ aimX: state.aim.aimX, aimY: state.aim.aimY, power: 0.7, curl: state.aim.curl }));
again.addEventListener("click", () => startRound());

// ── Sound (off by default; synthesised in code, no files, no network) ───────
soundButton.addEventListener("click", async () => {
  soundOn = !soundOn;
  crowd.setMuted(!soundOn);
  if (soundOn) await crowd.unlock();
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.textContent = soundOn ? "Sound on" : "Sound off";
});
function playSfx(name: string) {
  if (soundOn && isSfx(name)) crowd.play(name);
}

scene.onEvent = (event, data) => {
  if (event === "sfx") playSfx(data as string);
  if (event === "resolved") onResolved();
  if (event === "done") onDone();
  if (event === "walkout-done") afterWalkout();
};

// ── Rotate hint (portrait phones): a tip, never a blocker. Storage is optional. ──
const HINT_KEY = "pk-practice-rotate-hint";
const hint = document.getElementById("pp-rotate");
const readHint = () => { try { return window.localStorage.getItem(HINT_KEY) === "1"; } catch { return false; } };
if (hint) {
  if (readHint()) hint.hidden = true;
  hint.querySelector("button")?.addEventListener("click", () => { hint.hidden = true; try { window.localStorage.setItem(HINT_KEY, "1"); } catch { /* storage blocked: fine */ } });
}

// ── The loop ───────────────────────────────────────────────────────────────
let last = performance.now();
function loop(time: number) {
  // rAF time can be a little earlier than the performance.now() read at start-up: never step backwards.
  const dt = document.hidden ? 0 : Math.max(0, Math.min(0.05, (time - last) / 1000)); last = Math.max(last, time);
  tickAim(dt);
  scene.update(dt);
  scene.render(context);
  quick.disabled = !shootable();
  requestAnimationFrame(loop);
}

/** Read-only hook for scripts/test-practice.mjs. */
(window as unknown as { __pkPractice?: () => unknown }).__pkPractice = () => ({
  phase: state.phase, shootable: shootable(), seed: state.seed, tip: tip.hidden ? "" : tip.textContent, kicks: state.kicks.map(kick => kick.result), goals: state.goals, keeper: scene.keeper,
  keepers: [...scene.stats.keepers], lines: scene.stats.lines.size,
});

renderResults();
startRound();
requestAnimationFrame(loop);
