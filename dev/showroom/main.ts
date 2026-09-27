// DEV ONLY — the Showroom: every moment of the scene engine on demand. Never part of site/.
// It renders the SAME Stage the game uses; outcomes are produced by the real engine
// (resolveShot), searched until the requested result comes up, so nothing is faked visually.
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { KEEPERS, keeperById, resolveShot, resolveFreeKick, freeKickSetup, isKnuckle, type KeeperId, type ShotResult, type ShotOutcome, type FreeKickSetup, type FreeKickShot } from "@penalty-kings/engine";
import { spawnTargets, targetAt } from "../../games/penalty-kings/game/target.js";
import { Stage, CELEBRATIONS, RARITY_NAMES } from "../../games/penalty-kings/gfx/stage.js";
import { W, H, FrameMeter } from "../../games/penalty-kings/gfx/core.js";
import { THEMES, type StadiumId, type Weather } from "../../games/penalty-kings/gfx/stadium.js";
import { drawKeeper } from "../../games/penalty-kings/gfx/keepers.js";
import { drawBall, RARITY_FX } from "../../games/penalty-kings/gfx/ball.js";
import { CROWD_TYPES } from "../../games/penalty-kings/gfx/crowd.js";
import { COMMENTARY_COUNT, type CommentaryContext } from "../../games/penalty-kings/gfx/commentary.js";
import type { CelebrationId } from "../../games/penalty-kings/gfx/friend.js";
import { revealPlan } from "../../games/penalty-kings/game/reveal.js";

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

// ── Forced outcomes via the real engine ─────────────────────────────────────
function findShot(result: ShotResult, keeper: KeeperId): { outcome: ShotOutcome; curl: number } {
  const profile = keeperById(keeper);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const shot = { aimX: Math.random() * 2.8 - 1.4, aimY: Math.random() * 1.2, power: Math.random(), curl: Math.random() * 2 - 1 };
    const outcome = resolveShot(shot, profile, Math.floor(Math.random() * 2 ** 31), { kickIndex: 0, history: [] });
    if (outcome.result === result) return { outcome, curl: shot.curl };
  }
  throw new Error(`engine never produced "${result}" against ${profile.name}`);
}
function shoot(result: ShotResult) {
  try { const { outcome, curl } = findShot(result, stage.keeper); stage.play(outcome, curl); log(`shot → ${result} (target ${outcome.target.x.toFixed(2)}, ${outcome.target.y.toFixed(2)})`); }
  catch (error) { log((error as Error).message); }
}

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
button("#setpieces", "Back to penalties", () => toPenalty());
for (const celebration of CELEBRATIONS) button("#celebrations", celebration.name, () => { stage.celebration = celebration.id as CelebrationId; stage.startCelebration(celebration.id as CelebrationId); });
for (const kind of ["miss", "save", "post"] as const) button("#reactions", `React: ${kind}`, () => stage.react(kind));
RARITY_NAMES.slice(0, 7).forEach((name, index) => button("#rarities", name, () => stage.showReveal(revealPlan(index + 1))));
button("#moments", "Walk-out", () => stage.walkout());
button("#moments", "Streak fire ×3", () => { stage.streak = 3; stage.rarity = 6; stage.ballVisible = true; log("streak = 3 (heat shimmer + fire ball)"); });
button("#moments", "Reset streak", () => { stage.streak = 0; stage.rarity = 7; stage.ballVisible = false; });
button("#moments", "Mexican wave", () => stage.wave());
button("#moments", "Score +250", () => stage.setScore(stage.score + 250));
const contexts: CommentaryContext[] = ["walkout", "buildup", "goal", "save", "post", "over", "wide", "streak2", "streak3", "rarity-high", "rarity-top", "keeper", "sudden-death", "boss"];
for (const topic of contexts) button("#commentary", topic, () => stage.say(topic));
$<HTMLSpanElement>("#line-count").textContent = String(COMMENTARY_COUNT);

select<KeeperId>("#keeper", KEEPERS.map(keeper => ({ value: keeper.id, label: keeper.name })), value => { stage.keeper = value; const k = keeperById(value); $("#keeper-info").textContent = `${k.bio} Tell: ${k.tell}`; });
($<HTMLSelectElement>("#keeper")).value = "squirrel";
select<StadiumId>("#stadium", (Object.keys(THEMES) as StadiumId[]).map(id => ({ value: id, label: THEMES[id].label })), value => stage.setStadium(value));
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
$<HTMLButtonElement>("#friend-load").onclick = () => loadFriend($<HTMLInputElement>("#friend-id").value.trim());
document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach(element => { element.onclick = () => { $<HTMLInputElement>("#friend-id").value = element.dataset.sample!; loadFriend(element.dataset.sample!); }; });
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(element => {
  element.onclick = () => {
    document.querySelectorAll("[data-panel]").forEach(panel => panel.toggleAttribute("hidden", (panel as HTMLElement).dataset.panel !== element.dataset.tab));
    document.querySelectorAll("[data-tab]").forEach(tab => tab.classList.toggle("active", tab === element));
    if (element.dataset.tab === "cast") drawCast();
  };
});

// ── Event log (the game maps these to SFX) ──────────────────────────────────
const logElement = $<HTMLPreElement>("#log");
function log(line: string) { logElement.textContent = `${(performance.now() / 1000).toFixed(1)}s  ${line}\n${logElement.textContent}`.slice(0, 3000); }
stage.onEvent = (event, data) => log(event === "sfx" ? `sfx: ${data}` : `${event}${data ? `: ${data}` : ""}`);

// ── Loop ─────────────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  walkFrame.value = Math.floor(now / 140) % 4;
  const started = performance.now();
  if (!paused || stepOnce) { stage.update(stepOnce ? 1 / 60 : dt); stepOnce = false; }
  stage.render(context);
  meter.push(performance.now() - started);
  $("#meter").textContent = `frame ${meter.average.toFixed(2)} ms avg · ${meter.p95.toFixed(2)} ms p95 · particles ${stage.particles.count ?? "?"}`;
  requestAnimationFrame(frame);
}
canvas.width = W; canvas.height = H;
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

loadFriend("336583");
