// DEV ONLY — the Showroom: every moment of the scene engine on demand. Never part of site/.
// It renders the SAME Stage the game uses; outcomes are produced by the real engine
// (resolveShot), searched until the requested result comes up, so nothing is faked visually.
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { KEEPERS, keeperById, keeperFrame, resolveShot, shotTarget, resolveFreeKick, freeKickSetup, isKnuckle, type KeeperId, type ShotResult, type ShotOutcome, type FreeKickSetup, type FreeKickShot } from "@penalty-kings/engine";
import { spawnTargets, targetAt } from "../../games/penalty-kings/game/target.js";
import { Stage, CELEBRATIONS, RARITY_NAMES, STRIKE_AT } from "../../games/penalty-kings/gfx/stage.js";
import { W, H, FrameMeter } from "../../games/penalty-kings/gfx/core.js";
import { THEMES, type StadiumId, type Weather } from "../../games/penalty-kings/gfx/stadium.js";
import { drawKeeper, drawKeeperLook, keeperArms, KEEPER_DESIGNS, KEEPER_SHEET, PAD } from "../../games/penalty-kings/gfx/keepers.js";
import { PENALTY_GOAL } from "../../games/penalty-kings/gfx/stadium.js";
import { KEEPER_RIGS, type RigPose } from "@penalty-kings/engine";
import { drawBall, drawBallSprite, drawBallShadow, ballSprite, ballSpriteCacheSize, BALL_FRAMES, BALL_IDENTITY, RARITY_FX, seasonFx, type Season } from "../../games/penalty-kings/gfx/ball.js";
import { CROWD_TYPES, type CrowdMood } from "../../games/penalty-kings/gfx/crowd.js";
import { BACKDROP_DROP } from "../../games/penalty-kings/gfx/stage.js";
// The SDK's recorded canonical Generations frames (Friends #7730, #3412): lets the Showroom show the
// Friends crowd offline, when the chain cannot be reached. DEV only; the game reads the chain.
import { sampleFriendSprites } from "../../node_modules/@rarefriends/friendsdk/examples/fishing/sample-sprites.js";
import { COMMENTARY_COUNT, ALL_COMMENTARY_COUNT, type CommentaryContext } from "../../games/penalty-kings/gfx/commentary.js";
import type { CelebrationId } from "../../games/penalty-kings/gfx/friend.js";
import { revealPlan } from "../../games/penalty-kings/game/reveal.js";
import { simulatedBeacon, packDraws } from "../../games/penalty-kings/game/randomness.js";
import { rollKeeper, packCommitment, packRevealSequence, isAbort } from "../../games/penalty-kings/game/suspense.js";
import { CATALOGUE, MOMENT_STAGE, createGameDirector, applyBeat, playMoment, type Moment, type Beat } from "../../games/penalty-kings/game/director.js";
import { cueLine } from "../../games/penalty-kings/gfx/commentary.js";
import type { PlayMode } from "@penalty-kings/game-director";
import { ReelPlayer } from "../../games/penalty-kings/gfx/reelplayer.js";
import { MONTAGE, ATTRACT } from "../../games/penalty-kings/gfx/showreel.js";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const canvas = $<HTMLCanvasElement>("#stage"), context = canvas.getContext("2d")!;
const stage = new Stage({ stadium: "park", weather: "sun", keeper: "squirrel" });
const meter = new FrameMeter();
let paused = false, stepOnce = false, sprites: GenerationSprites | null = null;

// ── Friend sprite (read from Robinhood mainnet, same reader as the game) ────
const walkFrame = { value: 0 };
stage.rows = (facing, walking, frame) => (sprites ? spriteFrame(sprites, facing, walking, frame ?? walkFrame.value, "right").frame.rows : null);
async function loadFriend(id: string) {
  const status = $<HTMLSpanElement>("#friend-status");
  status.textContent = "reading…";
  try { sprites = await createFriendReader().read(BigInt(id)); stage.friendName = `Friend #${id}`; status.textContent = "loaded from chain"; }
  catch (error) { sprites = null; status.textContent = `not loaded (${(error as Error).message.slice(0, 60)}) — placeholder shown`; }
}

function loadSample(id: string) {
  const sample = sampleFriendSprites(BigInt(id));
  sprites = sample ?? null; stage.friendName = `Friend #${id}`;
  $<HTMLSpanElement>("#friend-status").textContent = sample ? `SDK recorded sample #${id} (canonical frames, offline)` : "no such SDK sample";
}

// ── Crowd: the stands filled with little copies of the loaded Friend (close-up, moods, wind) ──
const crowdFriends = $<HTMLInputElement>("#crowd-friends"), zoomCanvas = $<HTMLCanvasElement>("#crowd-zoom"), zoomContext = zoomCanvas.getContext("2d")!;
let crowdWind: number | null = null;
function applyCrowd() { stage.crowd.friends = crowdFriends.checked; stage.crowd.windOverride = crowdWind; }
crowdFriends.onchange = applyCrowd;
$<HTMLInputElement>("#crowd-zoom-toggle").onchange = event => { zoomCanvas.hidden = !(event.target as HTMLInputElement).checked; };
window.setInterval(() => {
  const n = stage.crowd.census;
  $("#crowd-info").textContent = `${n.friends} Friends (${n.peekers} over the tifo/cards), ${n.humans} human characters, ${n.flags} flag-wavers, ${n.bigFlags} big PK flags, ${n.banners} banners · mood ${stage.crowd.mood}`;
}, 500);

// ── Forced outcomes via the real engine ─────────────────────────────────────
function findShot(result: ShotResult, keeper: KeeperId, accept: (outcome: ShotOutcome) => boolean = () => true): { outcome: ShotOutcome; curl: number } {
  const profile = keeperById(keeper);
  for (let attempt = 0; attempt < 20000; attempt++) {
    const shot = { aimX: Math.random() * 2.8 - 1.4, aimY: Math.random() * 1.2, power: Math.random(), curl: Math.random() * 2 - 1 };
    const outcome = resolveShot(shot, profile, Math.floor(Math.random() * 2 ** 31), { kickIndex: attempt % 5, history: [] });
    if (outcome.result === result && accept(outcome)) return { outcome, curl: shot.curl };
  }
  throw new Error(`engine never produced "${result}" against ${profile.name}`);
}
function shoot(result: ShotResult, accept?: (outcome: ShotOutcome) => boolean, label: string = result) {
  try { const { outcome, curl } = findShot(result, stage.keeper, accept); stage.play(outcome, curl); log(`shot → ${label} (target ${outcome.target.x.toFixed(2)}, ${outcome.target.y.toFixed(2)}${outcome.touch ? `, touched: ${outcome.touch}` : ""})`); }
  catch (error) { log((error as Error).message); }
}
// Hitbox inspection: saves by each body part, and goals that only just beat the keeper.
for (const part of ["glove", "arm", "body", "leg", "wall"] as const) button("#hitbox-shots", `SAVE: ${part}`, () => { toPenalty(); shoot("save", outcome => outcome.touch === part, `save (${part})`); });
button("#hitbox-shots", "GOAL: past the dive", () => {
  toPenalty();
  shoot("goal", outcome => { const f = keeperFrame(stage.keeper, outcome.plan, outcome.target.time); return f.progress > 0.8 && Math.abs(f.x - outcome.target.x) < 0.45; }, "goal past the dive");
});
$<HTMLInputElement>("#hitbox").onchange = event => { stage.debugHitbox = (event.target as HTMLInputElement).checked; };

// ── Controls ─────────────────────────────────────────────────────────────────
function button(parent: string, label: string, onClick: () => void) {
  const element = document.createElement("button");
  element.textContent = label; element.onclick = onClick; $(parent).append(element);
  return element;
}
function select<T extends string>(id: string, options: readonly { value: T; label: string }[], onChange: (value: T) => void) {
  const element = $<HTMLSelectElement>(id);
  element.innerHTML = options.map(option => `<option value="${option.value}">${option.label}</option>`).join("");
  element.onchange = () => onChange(element.value as T);
}

for (const result of ["goal", "save", "post", "over", "wide"] as const) button("#outcomes", result.toUpperCase(), () => { toPenalty(); shoot(result); });

// ── Set pieces (free kicks with the engine's physics, the wall, wind; target practice) ─────
let setup: FreeKickSetup = freeKickSetup(42, { distance: 24, angle: 0.2, wallSize: 4, maxWind: 3 });
let targetTimer = 0;
function toPenalty() { stage.kind = "penalty"; stage.freeKick = null; stage.targets = []; window.clearInterval(targetTimer); }
function useSetup(next: FreeKickSetup) {
  setup = next; stage.kind = "freekick"; stage.targets = []; stage.ballVisible = true; window.clearInterval(targetTimer);
  stage.freeKick = { setup, wall: resolveFreeKick(setup, { aimX: 0, lift: 0.5, power: 0.5, spin: 0, top: 0 }, keeperById(stage.keeper)).wall };
  $("#setpiece-info").textContent = `${setup.distance} m · angle ${(setup.angle * 57.3).toFixed(0)}° · wall of ${setup.wallSize} × ${setup.wallHeight} m · wind ${setup.wind} m/s`;
}
function freeKick(want: "goal" | "wall" | "save" | "knuckle" | "curler") {
  if (stage.kind !== "freekick") useSetup(setup);
  for (let i = 0; i < 6000; i++) {
    const shot: FreeKickShot = want === "knuckle" ? { aimX: Math.random() * 1.6 - 0.8, lift: Math.random(), power: 0.8 + Math.random() * 0.2, spin: (Math.random() - 0.5) * 0.2, top: Math.random() * 0.1 }
      : { aimX: Math.random() * 2 - 1, lift: Math.random(), power: Math.random(), spin: want === "curler" ? (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4) : Math.random() * 2 - 1, top: Math.random() };
    const outcome = resolveFreeKick({ ...setup, seed: setup.seed + i }, shot, keeperById(stage.keeper));
    const ok = want === "knuckle" ? isKnuckle(shot) && outcome.result === "goal" : want === "curler" ? outcome.result === "goal" : outcome.result === want;
    if (ok) { stage.playFreeKick(outcome); log(`free kick → ${outcome.result}${outcome.knuckle ? " (knuckle)" : ""} spin ${shot.spin.toFixed(2)} top ${shot.top.toFixed(2)}`); return; }
  }
  log(`engine never produced a ${want} free kick from this setup`);
}
button("#setpieces", "FK: goal", () => freeKick("goal"));
button("#setpieces", "FK: curler", () => freeKick("curler"));
button("#setpieces", "FK: knuckleball", () => freeKick("knuckle"));
button("#setpieces", "FK: blocked by wall", () => freeKick("wall"));
button("#setpieces", "FK: saved", () => freeKick("save"));
button("#setpieces", "FK: new setup", () => useSetup(freeKickSetup(Math.floor(Math.random() * 1e6), { maxWind: 5 })));
for (const distance of [18, 25, 32]) button("#setpieces", `FK ${distance} m`, () => useSetup(freeKickSetup(Math.floor(Math.random() * 1e6), { distance, maxWind: 3 })));
for (const [label, wallHeight] of [["Wall: Park 1.65 m", 1.65], ["Wall: Pro 1.8 m", 1.8], ["Wall: Champions 1.9 m", 1.9]] as const) button("#setpieces", label, () => useSetup({ ...setup, wallHeight }));
button("#setpieces", "Wind ←5", () => useSetup({ ...setup, wind: -5 }));
button("#setpieces", "Wind 5→", () => useSetup({ ...setup, wind: 5 }));
button("#setpieces", "Wall jump preview", () => { useSetup({ ...setup, wallJumpAt: 0 }); freeKick("wall"); });
button("#setpieces", "Target practice", () => {
  toPenalty(); stage.kind = "target"; const targets = spawnTargets(7, 0), start = performance.now();
  targetTimer = window.setInterval(() => { const t = (performance.now() - start) / 1000; stage.targets = targets.map(target => ({ ...targetAt(target, t), r: target.r, value: target.value })); }, 33);
});
button("#setpieces", "Zone hints on/off", () => { stage.hints = stage.hints ? 0 : 1; });

// ── Kick animation review: the run-up, plant, leg swing and contact flash, slowed down ─────
let freezeAtStrike = false;
function setSpeed(value: number) { speed.value = String(value); speed.dispatchEvent(new Event("input")); }
function kickReview(view: "penalty" | "freekick", mode: "slow" | "contact") {
  paused = false; $("#pause").textContent = "Pause";
  if (view === "penalty") { toPenalty(); shoot("goal"); } else { if (stage.kind !== "freekick") useSetup(setup); freeKick("goal"); }
  freezeAtStrike = mode === "contact";
  setSpeed(mode === "slow" ? 0.12 : 0.25);
  log(mode === "slow" ? "kick replay at 0.12× (Speed slider to change; Step frame to scrub)" : `frozen at the contact frame (${STRIKE_AT} s after release)`);
}
button("#kickreview", "Penalty kick ×0.12", () => kickReview("penalty", "slow"));
button("#kickreview", "Free kick ×0.12", () => kickReview("freekick", "slow"));
button("#kickreview", "Penalty: freeze at contact", () => kickReview("penalty", "contact"));
button("#kickreview", "Free kick: freeze at contact", () => kickReview("freekick", "contact"));
button("#kickreview", "Normal speed", () => setSpeed(1));
button("#setpieces", "Back to penalties", () => toPenalty());
for (const celebration of CELEBRATIONS) button("#celebrations", celebration.name, () => { stage.celebration = celebration.id as CelebrationId; stage.startCelebration(celebration.id as CelebrationId); });
for (const kind of ["miss", "save", "post"] as const) button("#reactions", `React: ${kind}`, () => stage.react(kind));
RARITY_NAMES.slice(0, 7).forEach((name, index) => button("#rarities", name, () => stage.showReveal(revealPlan(index + 1))));
button("#moments", "Walk-out", () => stage.walkout());
button("#moments", "Streak fire ×3", () => { stage.streak = 3; stage.rarity = 6; stage.ballVisible = true; log("streak = 3 (heat shimmer + fire ball)"); });
button("#moments", "Reset streak", () => { stage.streak = 0; stage.rarity = 7; stage.ballVisible = false; });
button("#moments", "Mexican wave", () => stage.wave());
button("#moments", "Score +250", () => stage.setScore(stage.score + 250));
button("#crowd", "Goal: hop ripple", () => stage.crowd.react("cheer"));
button("#crowd", "Near-miss: ooh ripple", () => stage.crowd.react("ooh"));
button("#crowd", "Groan", () => stage.crowd.react("groan"));
button("#crowd", "Tense", () => stage.crowd.react("tense"));
button("#crowd", "Mexican wave", () => stage.wave());
for (const [label, wind] of [["Wind ←6", -6], ["Calm", 0], ["Wind 6→", 6], ["Wind: follow scene", null]] as const) button("#crowd", label, () => { crowdWind = wind; applyCrowd(); });
const contexts: CommentaryContext[] = ["walkout", "buildup", "goal", "save", "post", "over", "wide", "streak2", "streak3", "rarity-high", "rarity-top", "keeper", "sudden-death", "boss"];
for (const topic of contexts) button("#commentary", topic, () => stage.say(topic));
$<HTMLSpanElement>("#line-count").textContent = `${COMMENTARY_COUNT} + ${ALL_COMMENTARY_COUNT - COMMENTARY_COUNT} Director`;

// ── Director debug: the seeded Game Director driving this Stage, its state overlaid, every moment on a button ─────
let director = createGameDirector(1, { name: stage.friendName, number: "336583" });
let jumboHold = 0, lastBeat: Beat | null = null;
const directorMode = () => $<HTMLSelectElement>("#director-mode").value as PlayMode;
function directorSession() {
  director = createGameDirector(Math.floor(Math.random() * 1e6), { name: stage.friendName, number: $<HTMLInputElement>("#friend-id").value.trim() }, director.seenCode());
  toPenalty();
  showBeat(director.startSession({ mode: directorMode(), stadium: stage.stadium, keeper: stage.keeper, weather: stage.weather, timeOfDay: "evening" }), "session");
}
function showBeat(beat: Beat, label: string, slots?: Moment["slot"][]) {
  lastBeat = beat;
  const played = applyBeat(stage, beat, slots);
  if (played.jumbotron) jumboHold = performance.now() + 6000;
  if (beat.keeperChanged) ($<HTMLSelectElement>("#keeper")).value = beat.keeper;
  log(`director ${label}: ${beat.phase} · intensity ${beat.intensity} · ${beat.moments.map(m => `${m.tier}:${m.id}`).join(", ") || "no moments"}${beat.skillScoreMultiplier === 2 ? " · ×2 skill (Golden Hour)" : ""}`);
  refreshDirector();
}
/** One kick the way the game will run it: beforeKick → real engine outcome → afterKick (line cued for the resolve) → reaction, then between-kick moments. */
function directorKick(result: ShotResult) {
  const before = director.beforeKick({ now: performance.now() / 1000 });
  showBeat(before, "before kick");
  try {
    const { outcome, curl } = findShot(result, stage.keeper);
    const after = director.afterKick({ kind: "penalty", result: outcome.result, zone: outcome.zone, postIn: outcome.postIn, x: outcome.target.x, y: outcome.target.y, now: performance.now() / 1000 });
    if (after.lines[0]) stage.cue = cueLine(after.lines[0]);
    stage.play(outcome, curl);
    window.setTimeout(() => showBeat({ ...after, lines: after.lines.slice(1) }, "reaction", ["reaction"]), 1600);
    window.setTimeout(() => showBeat({ ...after, lines: [], keeperChanged: false }, "between kicks", ["between"]), 4200);
  } catch (error) { log((error as Error).message); }
}
function refreshDirector() {
  const state = director.debugState();
  $("#director-overlay").textContent = [
    `DIRECTOR  kick ${state.kick} · round ${state.round} (${state.kickInRound}/5)`,
    `phase ${state.phase.toUpperCase()}  intensity ${state.intensity.toFixed(2)}`,
    `  ${Object.entries(state.intensityParts).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `streak ${state.streak} · misses ${state.misses} · keeper ${state.keeper} (${state.keeperRun})${state.pendingKeeper ? ` → ${state.pendingKeeper}` : ""}`,
    `weather ${state.weather}${state.goldenHour ? " · GOLDEN HOUR" : ""} · skill ×${state.skillScoreMultiplier}`,
    `next: ${state.nextMoment ? `${state.nextMoment.tier} ${state.nextMoment.name}` : "—"} · set piece in ${state.nextSetPieceInKicks} · notable in ${state.nextNotableInKicks.join("–")}`,
    `cooldowns: ${Object.entries(state.cooldowns).map(([id, left]) => `${id} ${left}`).join(", ") || "none"}`,
    `recent: ${state.recent.join(", ")}`,
    state.discovery,
    lastBeat ? `last: ${lastBeat.moments.map(m => m.name).join(" + ") || "—"} | ${[...lastBeat.lines, ...lastBeat.moments.flatMap(m => m.lines)].map(l => l.text).join(" / ")}` : "",
  ].join("\n");
  $("#director-discovery").textContent = `${state.discovery} · ${CATALOGUE.filter(m => MOMENT_STAGE[m.id].support === "full").length} full, ${CATALOGUE.filter(m => MOMENT_STAGE[m.id].support === "partial").length} partial, ${CATALOGUE.filter(m => MOMENT_STAGE[m.id].support === "line-only").length} line-only on today's Stage`;
  const seen = new Set(director.seenIds());
  document.querySelectorAll<HTMLButtonElement>("#director-moments button").forEach(element => element.classList.toggle("seen", seen.has(element.dataset.moment!)));
}
for (const result of ["goal", "save", "post", "over", "wide"] as const) button("#director-kicks", `Kick: ${result}`, () => directorKick(result));
for (const tier of ["micro", "notable", "set-piece"] as const) {
  const heading = document.createElement("h4"); heading.textContent = `${tier} (${CATALOGUE.filter(m => m.tier === tier).length})`; $("#director-moments").append(heading);
  for (const moment of CATALOGUE.filter(m => m.tier === tier)) {
    const staging = MOMENT_STAGE[moment.id];
    const element = button("#director-moments", `${moment.name}${staging.support === "full" ? "" : staging.support === "partial" ? " ◐" : " ○"}`, () => {
      const played = director.trigger(moment.id);
      if (!played) return;
      const result = playMoment(stage, played);
      if (result.jumbotron) jumboHold = performance.now() + 6000;
      if (played.keeper) ($<HTMLSelectElement>("#keeper")).value = played.keeper;
      log(`moment: ${played.name}${staging.missing ? ` (missing: ${staging.missing})` : ""}`);
      lastBeat = null; refreshDirector();
    });
    element.dataset.moment = moment.id; element.title = `${staging.support}: ${staging.uses}${staging.missing ? ` · missing: ${staging.missing}` : ""}`;
  }
}
$<HTMLButtonElement>("#director-session").onclick = directorSession;
$<HTMLInputElement>("#director-overlay-toggle").onchange = event => $("#director-overlay").toggleAttribute("hidden", !(event.target as HTMLInputElement).checked);
window.setInterval(() => { if (performance.now() > jumboHold && jumboHold) { stage.jumbotron = ""; jumboHold = 0; } }, 500);
refreshDirector();

select<KeeperId>("#keeper", KEEPERS.map(keeper => ({ value: keeper.id, label: keeper.name })), value => { stage.keeper = value; const k = keeperById(value); $("#keeper-info").textContent = `${k.bio} Tell: ${k.tell}`; });
($<HTMLSelectElement>("#keeper")).value = "squirrel";
const STADIUM_NOTES: Record<StadiumId, string> = {
  park: "Cosy Sunday league: benches, trees, kites, sparse crowd, warm grade, birdsong ambience.",
  pro: "Floodlit bowl: two tiers, glass boxes, LED ribbons, TV gantry, ultras tifos + coloured smoke, drizzle and wet sheen, cool grade, drums + floodlight hum.",
  champions: "Golden arena: retractable roof, 4-sided jumbotron, card mosaic, champions stage, pyro line, confetti cannons, fireworks on a goal, gold grade, anthem pad + claps.",
};
function setStadium(value: StadiumId) {
  stage.setStadium(value); ($<HTMLSelectElement>("#stadium")).value = value;
  applyCrowd();
  document.querySelectorAll<HTMLButtonElement>("#stadiums button[data-stadium]").forEach(b => b.classList.toggle("active", b.dataset.stadium === value));
  $("#stadium-info").textContent = STADIUM_NOTES[value];
}
select<StadiumId>("#stadium", (Object.keys(THEMES) as StadiumId[]).map(id => ({ value: id, label: THEMES[id].label })), value => setStadium(value));
for (const id of Object.keys(THEMES) as StadiumId[]) button("#stadiums", id === "park" ? "Park" : id === "pro" ? "Pro" : "Champions", () => setStadium(id)).dataset.stadium = id;
button("#stadiums", "Goal finale", () => { toPenalty(); shoot("goal"); });
// The showreel (gfx/showreel.ts) played on this Stage, with its overlay (titles, captions, cut dissolves).
let reel: ReelPlayer | null = null;
function playReel(which: "montage" | "attract" | "off") {
  reel = which === "off" ? null : new ReelPlayer(stage, which === "montage" ? MONTAGE : ATTRACT, { loop: which === "attract", friendName: stage.friendName || "Your Friend" });
  if (reel) toPenalty();
}
button("#stadiums", "Showreel", () => playReel("montage"));
button("#stadiums", "Attract loop", () => playReel("attract"));
button("#stadiums", "Stop reel", () => playReel("off"));
setStadium("park");
// Screenshot hook for scripts/stadium-shots (DEV only).
(window as unknown as { __showroom: unknown }).__showroom = { stage, setStadium, toPenalty, freeKickView: () => useSetup(setup), goal: () => { toPenalty(); shoot("goal"); },
  crowd: (mood: CrowdMood) => stage.crowd.react(mood), census: () => stage.crowd.census, drop: BACKDROP_DROP, loadSample: (id: string) => loadSample(id),
  reel: (which: "montage" | "attract" | "off") => playReel(which), reelTime: () => reel?.time ?? -1,
  friend: () => $("#friend-status").textContent, setFriends: (on: boolean) => { crowdFriends.checked = on; applyCrowd(); } };
select<Weather>("#weather", (["sun", "rain", "snow", "fog", "sunset"] as const).map(value => ({ value, label: value })), value => { stage.weather = value; });
select<string>("#rarity", RARITY_NAMES.map((name, index) => ({ value: String(index), label: name })), value => { stage.rarity = Number(value); });
($<HTMLSelectElement>("#rarity")).value = "7";

const speed = $<HTMLInputElement>("#speed");
speed.oninput = () => { stage.camera.timeScale = Number(speed.value); $("#speed-value").textContent = `${Number(speed.value).toFixed(2)}×`; };
$<HTMLButtonElement>("#pause").onclick = () => { paused = !paused; $("#pause").textContent = paused ? "Resume" : "Pause"; };
$<HTMLButtonElement>("#step").onclick = () => { paused = true; stepOnce = true; $("#pause").textContent = "Resume"; };
$<HTMLInputElement>("#reduced").onchange = event => stage.setReduced((event.target as HTMLInputElement).checked);
$<HTMLInputElement>("#phone").onchange = event => document.body.classList.toggle("phone", (event.target as HTMLInputElement).checked);
$<HTMLInputElement>("#fps").onchange = event => $("#meter").toggleAttribute("hidden", !(event.target as HTMLInputElement).checked);
document.querySelectorAll<HTMLButtonElement>("[data-sdk-sample]").forEach(element => { element.onclick = () => loadSample(element.dataset.sdkSample!); });
$<HTMLButtonElement>("#friend-load").onclick = () => loadFriend($<HTMLInputElement>("#friend-id").value.trim());
document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach(element => { element.onclick = () => { $<HTMLInputElement>("#friend-id").value = element.dataset.sample!; loadFriend(element.dataset.sample!); }; });
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(element => {
  element.onclick = () => {
    document.querySelectorAll("[data-panel]").forEach(panel => panel.toggleAttribute("hidden", (panel as HTMLElement).dataset.panel !== element.dataset.tab));
    document.querySelectorAll("[data-tab]").forEach(tab => tab.classList.toggle("active", tab === element));
    if (element.dataset.tab === "cast") drawCast();
    if (element.dataset.tab === "balls") drawBallSheet();
  };
});

// ── Event log (the game maps these to SFX) ──────────────────────────────────
const logElement = $<HTMLPreElement>("#log");
function log(line: string) { logElement.textContent = `${(performance.now() / 1000).toFixed(1)}s  ${line}\n${logElement.textContent}`.slice(0, 3000); }
stage.onEvent = (event, data) => {
  log(event === "sfx" ? `sfx: ${data}` : event === "wait" ? `wait: ${JSON.stringify(data)}` : `${event}${data ? `: ${data}` : ""}`);
  if (event === "resolved") stage.streak = data === "goal" ? stage.streak + 1 : 0; // the game owns the streak; the Showroom counts its own kicks
  if (event === "resolved" && $<HTMLInputElement>("#freeze").checked) { paused = true; $("#pause").textContent = "Resume"; }
};

// ── FD-3b: randomness waits (0 / 5 / 15 s) — the same Stage code paths the game uses ─────────
// PENALTY: a random shot is fixed and committed, THEN the simulated beacon is requested; its value
// seeds only the keeper (keeperSeed) and the engine resolves the strike. PACK: a sealed pack waits,
// then the sequence reveals lowest → highest with a sting before the best ball (Showroom draws only;
// the Showroom's rarities are dev draws from the beacon, never a paid reveal).
let waitAbort: AbortController | null = null, packTimers: number[] = [];
function stopWaits() { waitAbort?.abort(); waitAbort = null; stage.endWait(); packTimers.forEach(id => window.clearTimeout(id)); packTimers = []; }
async function penaltyWait(ms: number) {
  stopWaits(); toPenalty(); stage.cancel(); stage.ballVisible = true;
  const controller = new AbortController(); waitAbort = controller;
  const shot = { aimX: Math.random() * 1.6 - 0.8, aimY: Math.random() * 0.9 + 0.05, power: 0.45 + Math.random() * 0.4, curl: Math.random() * 1.2 - 0.6 };
  stage.reticle = { ...shotTarget(shot), power: shot.power, curl: shot.curl, active: false };
  const index = Math.floor(Math.random() * 5), released = performance.now();
  try {
    const roll = await rollKeeper(shot, { friendId: "336583", sessionId: "showroom", kickIndex: index }, simulatedBeacon(ms), controller.signal, commitment => {
      stage.startWait("penalty", ms); log(`penalty: shot committed ${commitment.slice(0, 18)}… → beacon requested (${ms / 1000} s)`);
    });
    const waited = stage.endWait();
    const outcome = resolveShot(shot, keeperById(stage.keeper), roll.seed, { kickIndex: index, history: [] });
    log(`penalty: beacon #${roll.beacon.round} after ${waited.toFixed(1)} s (${Math.round(performance.now() - released)} ms) → keeperSeed ${roll.seed} → ${outcome.result}`);
    stage.play(outcome, shot.curl);
  } catch (error) { if (!isAbort(error)) log(`penalty wait failed: ${(error as Error).message}`); else log("penalty wait cancelled: nothing scored"); }
}
async function packWait(ms: number, count: number) {
  stopWaits(); stage.cancel();
  const controller = new AbortController(), started = performance.now(); waitAbort = controller;
  stage.startWait("pack", ms, count);
  try {
    const commitment = await packCommitment(Array.from({ length: count }, (_, i) => `showroom-${Date.now()}-${i}`), { friendId: "336583" });
    const beacon = await simulatedBeacon(ms).next("pack", commitment, controller.signal);
    stage.endWait();
    // DEV draws only (uniform over the 7 rarities, NOT the stadium odds): exercises the sequencing.
    const rarities = (await packDraws(beacon, commitment, count)).map(draw => Math.floor(draw * 7));
    const plan = packRevealSequence(rarities, performance.now() - started);
    log(`pack: beacon #${beacon.round} → rarities ${rarities.map(r => RARITY_NAMES[r].replace(" Ball", "")).join(", ")}; order ${plan.steps.map(step => step.index).join("→")}, sting at ${plan.stingAt} ms (level ${plan.stingLevel})`);
    stage.showPackTear(count); // B5: the fixed 0.8 s tear, then a Stage flip per lower ball and the best ball's full reveal
    for (const step of plan.steps) packTimers.push(window.setTimeout(() => { if (step.best) stage.showReveal(revealPlan(step.shows + 1)); else { stage.flipBall(revealPlan(step.shows + 1)); log(`pack: card ${step.index} flips: ${RARITY_NAMES[step.shows]}`); } }, step.at));
    if (plan.stingAt !== null) packTimers.push(window.setTimeout(() => { stage.crowd.react("tense"); log(`pack: sting (level ${plan.stingLevel}) before the best ball`); }, plan.stingAt));
  } catch (error) { if (!isAbort(error)) log(`pack wait failed: ${(error as Error).message}`); else { stage.endWait(); log("pack wait cancelled"); } }
}
for (const seconds of [0, 5, 15]) button("#randomness", `Penalty · ${seconds} s`, () => void penaltyWait(seconds * 1000)).dataset.testid = `wait-penalty-${seconds}`;
for (const seconds of [0, 5, 15]) button("#randomness", `Pack ×5 · ${seconds} s`, () => void packWait(seconds * 1000, 5)).dataset.testid = `wait-pack-${seconds}`;
button("#randomness", "Cancel wait", () => { stopWaits(); log("wait cancelled (AbortSignal): nothing scored"); });
// The game preview's delay (npm run play:dev): the dev server injects it into the game frame. The judged preview stays 0 s.
const previewDelayInfo = $<HTMLSpanElement>("#randomness-preview");
const setPreviewDelay = (ms?: number) => fetch(`/showroom/randomness-delay${ms === undefined ? "" : `?ms=${ms}`}`).then(response => response.json())
  .then((body: { ms: number }) => { previewDelayInfo.textContent = `game preview (play:dev): ${body.ms / 1000} s — reload the game tab`; })
  .catch(() => { previewDelayInfo.textContent = "game preview delay: needs npm run play:dev"; });
for (const seconds of [0, 5, 15]) button("#randomness-game", `Randomness delay: ${seconds} s`, () => void setPreviewDelay(seconds * 1000)).dataset.testid = `preview-delay-${seconds}`;
void setPreviewDelay();

// ── Loop ─────────────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  walkFrame.value = Math.floor(now / 140) % 4;
  const started = performance.now();
  if (!paused || stepOnce) { const step = stepOnce ? 1 / 60 : dt; reel?.update(step); if (reel?.done) reel = null; stage.update(step); stepOnce = false; }
  if (freezeAtStrike && (stage.kickClock ?? 0) >= STRIKE_AT) { freezeAtStrike = false; paused = true; $("#pause").textContent = "Resume"; }
  stage.render(context);
  reel?.drawOverlay(context);
  meter.push(performance.now() - started);
  if (!zoomCanvas.hidden) zoomContext.drawImage(canvas, Number($<HTMLInputElement>("#crowd-zoom-x").value), Number($<HTMLInputElement>("#crowd-zoom-y").value), 120, 40, 0, 0, 480, 160);
  $("#meter").textContent = `frame ${meter.average.toFixed(2)} ms avg · ${meter.p95.toFixed(2)} ms p95 · particles ${stage.particles.count ?? "?"}`;
  requestAnimationFrame(frame);
}
canvas.width = W; canvas.height = H;
zoomCanvas.width = 480; zoomCanvas.height = 160; zoomContext.imageSmoothingEnabled = false;
(window as unknown as { __frameMeter: FrameMeter }).__frameMeter = meter;
requestAnimationFrame(frame);

// ── Cast sheet ───────────────────────────────────────────────────────────────
function drawCast() {
  const cast = $<HTMLCanvasElement>("#cast"), c = cast.getContext("2d")!;
  cast.width = 480; cast.height = 420; c.imageSmoothingEnabled = false;
  c.fillStyle = "#12162b"; c.fillRect(0, 0, cast.width, cast.height);
  c.font = "8px PixelifySans, monospace"; c.textAlign = "center";
  KEEPERS.forEach((keeper, index) => {
    const x = 40 + (index % 6) * 80, y = 110 + Math.floor(index / 6) * 120;
    drawKeeper(c, keeper.id, { x, y, rotate: 0, stretch: 1, armL: -0.4, armR: -0.4, alpha: 1, scaleMul: 1, mood: "idle" }, 0);
    c.fillStyle = "#ffffff"; c.fillText(keeper.name.split(" ")[0], x, y + 12);
    c.fillStyle = "#ffd23f"; c.fillText(`×${keeper.mult}`, x, y + 22);
  });
  RARITY_FX.forEach((fx, index) => { const x = 36 + index * 58; drawBall(c, x, 370, 8, fx); c.fillStyle = "#ffffff"; c.fillText(RARITY_NAMES[index].replace(" Ball", ""), x, 392); });
  $("#crowd-types").textContent = `${CROWD_TYPES.length} crowd types: ${CROWD_TYPES.join(", ")}`;
}

// ── Ball sheet: rarities × seasons × sizes × spin frames ─────────────────────
const LABEL = 96, GAP = 4;
function drawBallSheet() {
  const sheet = $<HTMLCanvasElement>("#balls"), c = sheet.getContext("2d")!, reduced = $<HTMLInputElement>("#balls-reduced").checked;
  const zoom = Number($<HTMLSelectElement>("#balls-zoom").value);
  const small = ballSprite(0, "S1", 24)!.cell + GAP, big = ballSprite(0, "S1", 32)!.cell + GAP, rowH = 58;
  const x24 = LABEL, x32 = x24 + small * BALL_FRAMES + 12, xStill = x32 + big * BALL_FRAMES + 12, xGame = xStill + 48;
  const rows: { rarity: number; season: Season }[] = [];
  for (const season of ["S1", "S0"] as const) for (let rarity = 0; rarity < 8; rarity++) rows.push({ rarity, season });
  sheet.width = xGame + 110; sheet.height = 34 + rows.length * rowH + 14;
  sheet.style.width = `${sheet.width * zoom}px`;
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#12162b"; c.fillRect(0, 0, sheet.width, sheet.height);
  c.font = "8px PixelifySans, monospace"; c.textBaseline = "middle"; c.fillStyle = "#ffd23f";
  c.fillText(`24 px · frames 0–${BALL_FRAMES - 1}`, x24, 12); c.fillText(`32 px · frames 0–${BALL_FRAMES - 1}`, x32, 12);
  c.fillText("still", xStill + 8, 12); c.fillText("in game 9 px · reveal 28 px", xGame, 12);
  c.fillStyle = "#9aa3d0"; c.fillText(reduced ? "reduced motion: no sheen sweep, no twinkle" : "sheen sweeps frames 1–4 on Pro and above", x24, 24);
  rows.forEach(({ rarity, season }, index) => {
    const y = 34 + index * rowH, cy = y + rowH / 2 - 4;
    if (index % 2 === 0) { c.fillStyle = "#171c38"; c.fillRect(0, y, sheet.width, rowH); }
    if (season === "S0" && rarity === 0) { c.fillStyle = "#ffd23f"; c.fillRect(0, y, sheet.width, 1); }
    c.fillStyle = "#ffffff"; c.fillText(rarity === 7 ? "Standard (fx 7)" : RARITY_NAMES[rarity].replace(" Ball", ""), 6, cy - 6);
    c.fillStyle = "#9aa3d0"; c.fillText(`${season}${season === "S0" ? " vintage" : ""} · ${BALL_IDENTITY[rarity].pattern}`, 6, cy + 6);
    for (let f = 0; f < BALL_FRAMES; f++) {
      const sx = x24 + f * small + small / 2, bx = x32 + f * big + big / 2;
      drawBallShadow(c, sx, cy + 14, 24); drawBallSprite(c, sx, cy, 24, rarity, season, f, reduced);
      drawBallShadow(c, bx, cy + 18, 32); drawBallSprite(c, bx, cy, 32, rarity, season, f, reduced);
    }
    drawBallShadow(c, xStill + 20, cy + 18, 32); drawBallSprite(c, xStill + 20, cy, 32, rarity, season, 0, true);
    const fx = season === "S0" ? seasonFx("S0", rarity) : RARITY_FX[rarity];
    drawBall(c, xGame + 10, cy, 4.5, fx, 0); drawBall(c, xGame + 26, cy, 2.5, fx, 0);
    drawBallShadow(c, xGame + 64, cy + 16, 28); drawBall(c, xGame + 64, cy, 14, fx, 0);
  });
  $("#balls-info").textContent = `${ballSpriteCacheSize()} sprite strips cached (each rendered once, drawn with one drawImage per ball).`;
}
$<HTMLInputElement>("#balls-reduced").onchange = () => drawBallSheet();
$<HTMLSelectElement>("#balls-zoom").onchange = () => drawBallSheet();
(window as unknown as { __drawBallSheet: () => void }).__drawBallSheet = drawBallSheet;

// ── Keeper sheet: 12 keepers × every frame, physics poses flagged, plus the in-game scale ──
const KZ = 3, KCELL = (17 + 2 * PAD) * KZ, KROW = (16 + PAD) * KZ + 22, KLABEL = 128, KGAME = 76, KHEAD = 34;
function drawKeeperSheet() {
  const sheet = $<HTMLCanvasElement>("#keepers"), c = sheet.getContext("2d")!, masks = $<HTMLInputElement>("#keepers-masks").checked;
  const lean = Number($<HTMLSelectElement>("#keepers-lean").value), zoom = Number($<HTMLSelectElement>("#keepers-zoom").value), g = PENALTY_GOAL.g;
  const xGame = KLABEL + KEEPER_SHEET.length * KCELL + 8;
  sheet.width = xGame + 2 * KGAME + 8; sheet.height = KHEAD + KEEPERS.length * KROW + 8;
  sheet.style.width = `${sheet.width * zoom}px`;
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#12162b"; c.fillRect(0, 0, sheet.width, sheet.height);
  c.font = "10px PixelifySans, monospace"; c.textBaseline = "middle"; c.textAlign = "center";
  KEEPER_SHEET.forEach(({ label, physics }, i) => { c.fillStyle = physics ? "#ffd23f" : "#9aa3d0"; c.fillText(label, KLABEL + i * KCELL + KCELL / 2, 12); });
  c.fillStyle = "#7fd3ff"; c.fillText("in game ×" + g.toFixed(2), xGame + KGAME, 12);
  c.fillStyle = "#9aa3d0"; c.fillText(`sprite px × ${KZ}`, KLABEL + (KEEPER_SHEET.length * KCELL) / 2, 25);
  c.fillText("idle", xGame + KGAME / 2, 25); c.fillText("dive", xGame + KGAME * 1.5, 25);
  const physicsX = KEEPER_SHEET.findIndex(frame => frame.physics);
  c.fillStyle = "#ffd23f22"; c.fillRect(KLABEL + physicsX * KCELL, KHEAD - 2, 3 * KCELL, KEEPERS.length * KROW);
  KEEPERS.forEach((keeper, row) => {
    const y = KHEAD + row * KROW, feet = y + KROW - 16, design = KEEPER_DESIGNS[keeper.id];
    if (row % 2 === 0) { c.fillStyle = "#ffffff08"; c.fillRect(0, y, sheet.width, KROW); }
    c.textAlign = "left"; c.fillStyle = "#ffffff"; c.fillText(keeper.name, 6, y + KROW / 2 - 10);
    c.fillStyle = "#ffd23f"; c.fillText(`×${keeper.mult}${keeper.boss ? " · boss" : ""}`, 6, y + KROW / 2 + 4);
    c.fillStyle = "#9aa3d0"; c.fillText(`${design.rows[0].length}×${design.rows.length} px @${design.scale}`, 6, y + KROW / 2 + 18);
    c.textAlign = "center";
    KEEPER_SHEET.forEach(({ look, phase, physics }, i) => {
      const x = KLABEL + i * KCELL + KCELL / 2;
      c.fillStyle = "#00000040"; c.beginPath(); c.ellipse(x, feet + 1, design.rows[0].length * KZ * 0.45, 3, 0, 0, Math.PI * 2); c.fill();
      drawKeeperLook(c, keeper.id, look, phase, x, feet, KZ, { lean: keeper.id === "peacock" ? lean : 0 });
      if (masks && physics) {
        const mask = KEEPER_RIGS[keeper.id].poses[look as RigPose], w = mask[0].length * KZ, h = mask.length * KZ;
        c.fillStyle = "#00e5ff66";
        mask.forEach((line, r) => [...line].forEach((ch, col) => { if (ch === "#") c.fillRect(Math.round(x - w / 2) + col * KZ, feet - h + r * KZ, KZ, KZ); }));
      }
    });
    // In game: the whole keeper (arms, gloves) at the penalty view's scale, standing and mid-dive.
    const ix = xGame + KGAME / 2, dx = xGame + KGAME * 1.5;
    drawKeeper(c, keeper.id, { x: ix, y: feet, rotate: 0, stretch: 1, armL: 0.35, armR: 0.35, alpha: 1, scaleMul: g, mood: "idle", reduced: true }, 0);
    drawKeeper(c, keeper.id, { x: dx, y: feet - 12, rotate: 1.05, stretch: 1, armL: -1.1, armR: -0.6, alpha: 1, scaleMul: g, mood: "dive", reduced: true }, 0);
  });
}
// Live row: every keeper cycling idle → set → taunt → celebrate → sad at game scale, as in the match.
let keepersLive = false;
function drawKeepersLive(now: number) {
  const live = $<HTMLCanvasElement>("#keepers-live"), c = live.getContext("2d")!, reduced = $<HTMLInputElement>("#keepers-reduced").checked;
  const zoom = Number($<HTMLSelectElement>("#keepers-zoom").value), g = PENALTY_GOAL.g, t = now / 1000;
  live.width = 12 * 56 + 8; live.height = 92; live.style.width = `${live.width * 2 * zoom}px`;
  c.imageSmoothingEnabled = false; c.fillStyle = "#2e7d32"; c.fillRect(0, 0, live.width, live.height);
  c.fillStyle = "#12162b"; c.fillRect(0, 0, live.width, 14);
  const beat = t % 8, mood = beat < 3.5 ? "idle" : beat < 4.3 ? "set" : beat < 5.8 ? "taunt" : beat < 7 ? "celebrate" : "sad";
  c.font = "8px PixelifySans, monospace"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = "#ffd23f"; c.fillText(`${mood}${reduced ? " · reduced motion" : ""}`, 4, 7);
  KEEPERS.forEach((keeper, i) => {
    const x = 32 + i * 56, [armL, armR] = keeperArms(keeper.id, mood, t, 0, 0.4);
    drawKeeper(c, keeper.id, { x, y: 80, rotate: 0, stretch: 1, armL, armR, alpha: keeper.id === "ghost" ? 0.85 : 1, scaleMul: g, mood, reduced, lean: Math.sin(t) }, t);
  });
  if (keepersLive) requestAnimationFrame(drawKeepersLive);
}
for (const id of ["#keepers-masks", "#keepers-lean", "#keepers-zoom"]) $<HTMLElement>(id).onchange = () => drawKeeperSheet();
document.querySelector<HTMLButtonElement>("[data-tab=keepers]")!.addEventListener("click", () => { drawKeeperSheet(); if (!keepersLive) { keepersLive = true; requestAnimationFrame(drawKeepersLive); } });
document.querySelectorAll<HTMLButtonElement>("[data-tab]:not([data-tab=keepers])").forEach(tab => tab.addEventListener("click", () => { keepersLive = false; }));
(window as unknown as { __drawKeeperSheet: () => void }).__drawKeeperSheet = drawKeeperSheet;

loadFriend("336583");
