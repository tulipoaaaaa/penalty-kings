import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEEPERS } from "@penalty-kings/engine";
import { starsFor, met, describe, type Level, type KickRecord } from "../../games/penalty-kings/game/objectives.ts";
import levelsJson from "../../games/penalty-kings/game/levels.json";
import { loadProgress, saveProgress, fresh, levelFromXp, assistLevel, isUnlocked, nextRung, shotClockOn, LADDER, STORAGE_KEY } from "../../games/penalty-kings/game/progress.ts";
import { dailyScenario, dailyStreak, dailyState, utcDate } from "../../games/penalty-kings/game/daily.ts";
import { spawnTargets, resolveTargetShot, targetAt, MAX_COMBO } from "../../games/penalty-kings/game/target.ts";
import { revealPlan } from "../../games/penalty-kings/game/reveal.ts";
import { potBanner, prizeLine, jumbotronSlides, cupEndsAt, PRICE_MAX_AGE_MS } from "../../games/penalty-kings/game/prizes.ts";
import { ALL_COSMETICS, COSMETICS, TOKEN_LINES } from "../../games/penalty-kings/economy.ts";

const levels = levelsJson as unknown as Level[];
const kick = (o: Partial<KickRecord>): KickRecord => ({ result: "goal", zone: "corner", points: 300, x: 0.8, y: 0.3, ...o });

test("World Tour: 30 data-defined levels, 10 per stadium, valid keepers and rewards", () => {
  assert.equal(levels.length, 30);
  for (const stadium of ["park", "pro", "champions"]) assert.equal(levels.filter(l => l.stadium === stadium).length, 10);
  assert.equal(new Set(levels.map(l => l.id)).size, 30);
  for (const level of levels) {
    assert.ok(KEEPERS.some(k => k.id === level.keeper), level.id);
    assert.equal(level.objectives.length, 3);
    if (level.mode === "freekick") assert.ok(level.setup && level.setup.distance >= 18 && level.setup.distance <= 32, level.id);
    if (level.reward) assert.ok(ALL_COSMETICS.some(c => c.id === level.reward), level.reward);
    for (const objective of level.objectives) assert.ok(describe(objective, "Keeper").length > 3);
  }
});

test("stars are cumulative and objectives read the kicks", () => {
  const topBins = levels.find(l => l.id === "park-9")!;
  assert.equal(starsFor(topBins, [kick({ zone: "corner" })]), 0);
  assert.equal(starsFor(topBins, [kick({ zone: "bin" })]), 1);
  assert.equal(starsFor(topBins, [kick({ zone: "bin" }), kick({ result: "save" }), kick({ zone: "bin" })]), 2);
  assert.equal(starsFor(topBins, [kick({ zone: "bin" }), kick({ zone: "bin" }), kick({ zone: "bin" })]), 3);
  assert.ok(met({ type: "knuckle", count: 1 }, [kick({ knuckle: true })]));
  assert.ok(met({ type: "curl", count: 1, side: "left", zone: "bin" }, [kick({ spin: 0.8, x: -0.8, zone: "bin" })]));
  assert.ok(!met({ type: "curl", count: 1, side: "left" }, [kick({ spin: 0.8, x: 0.8 })]));
  assert.ok(met({ type: "chip", count: 1 }, [kick({ zone: "centre", y: 0.7 })]));
  assert.ok(!met({ type: "no-miss" }, []));
});

test("progress survives a missing or throwing localStorage", () => {
  assert.deepEqual(loadProgress(null), fresh());
  assert.deepEqual(loadProgress({ getItem: () => { throw new Error("denied"); } }), fresh());
  assert.deepEqual(loadProgress({ getItem: () => "{not json" }), fresh());
  assert.equal(saveProgress(fresh(), { setItem: () => { throw new Error("quota"); } }), false);
  const store = new Map<string, string>();
  const p = { ...fresh(), xp: 420, stamps: ["mouse" as const] };
  assert.ok(saveProgress(p, { setItem: (k, v) => void store.set(k, v) }));
  assert.equal(loadProgress({ getItem: k => store.get(k) ?? null }).xp, 420);
  assert.ok(store.has(STORAGE_KEY));
});

test("levels, unlocks, ladder and assist fade", () => {
  assert.deepEqual(levelFromXp(0), { level: 1, into: 0, next: 100 });
  assert.equal(levelFromXp(100).level, 2);
  assert.equal(levelFromXp(300).level, 3);
  assert.ok(isUnlocked("penalties", fresh()) && isUnlocked("match", fresh()));
  assert.ok(!isUnlocked("target", fresh()) && isUnlocked("target", { ...fresh(), xp: 100 }));
  assert.equal(nextRung(fresh()), LADDER[0]);
  assert.equal(nextRung({ ...fresh(), stamps: ["mouse"] }), "squirrel");
  assert.equal(assistLevel(fresh(), "pro"), 1);
  assert.equal(assistLevel({ ...fresh(), tutorialDone: true, matches: 6 }, "pro"), 0);
  assert.ok(assistLevel({ ...fresh(), tutorialDone: true, matches: 6 }, "park") > 0);
});

test("shot clock (round 6 C14): off in the tutorial and the first 3 matches after it", () => {
  assert.equal(shotClockOn(fresh()), false, "tutorial");
  for (const matches of [1, 2, 3]) assert.equal(shotClockOn({ ...fresh(), tutorialDone: true, matches }), false, `tutorial + ${matches - 1} matches`);
  assert.equal(shotClockOn({ ...fresh(), tutorialDone: true, matches: 4 }), true, "the 4th session after the tutorial has a clock");
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  assert.match(index, /Time up — kick lost/, "a timed-out kick is announced, never silent");
});

test("daily challenge: same scenario for everyone per date, streak calendar", () => {
  assert.deepEqual(dailyScenario("2026-09-28"), dailyScenario("2026-09-28"));
  const days = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(dailyScenario(`2026-10-${String(i + 1).padStart(2, "0")}`))));
  assert.ok(days.size > 20, "scenarios vary by day");
  assert.equal(dailyStreak(["2026-09-26", "2026-09-27", "2026-09-28"], "2026-09-28"), 3);
  assert.equal(dailyStreak(["2026-09-26", "2026-09-27"], "2026-09-28"), 2, "today not yet played keeps yesterday's streak");
  assert.equal(dailyStreak(["2026-09-25"], "2026-09-28"), 0);
  assert.deepEqual(dailyState({ date: "2026-09-27", attempts: 3, best: 900, played: ["2026-09-27"] }, "2026-09-28"), { date: "2026-09-28", attempts: 0, best: 0, played: ["2026-09-27"] });
  assert.match(utcDate(new Date(Date.UTC(2026, 8, 29, 23, 0))), /^2026-09-29$/);
});

test("target practice: hitting a target scores, combos build and reset, bar bonus", () => {
  const targets = spawnTargets(5, 0);
  const t = 3;
  const at = targetAt(targets[0], t + (0.95 - 0.55 * 0.6));
  const aimed = resolveTargetShot({ aimX: at.x, aimY: at.y, power: 0.6, curl: 0 }, targets, t, 0);
  // (power changes flight time slightly; search nearby release times for a hit)
  let hit = aimed.hit ? aimed : null;
  for (let dt = -0.2; !hit && dt <= 0.2; dt += 0.01) { const r = resolveTargetShot({ aimX: at.x, aimY: at.y, power: 0.6, curl: 0 }, targets, t + dt, 0); if (r.hit) hit = r; }
  assert.ok(hit && hit.points > 0 && hit.combo === 1);
  const miss = resolveTargetShot({ aimX: 1.5, aimY: 0.5, power: 0.5, curl: 0 }, targets, t, 4);
  assert.equal(miss.combo, 0); assert.equal(miss.points, 0);
  const bar = resolveTargetShot({ aimX: 0, aimY: 1, power: 0.6, curl: 0 }, [], t, MAX_COMBO);
  assert.ok(bar.crossbar && bar.points > 0 && bar.combo === MAX_COMBO);
});

test("target practice (round 6 C8): the hit is judged on the target positions at the on-screen crossing time", () => {
  const targets = spawnTargets(11, 0), t = 7.3, delay = 0.9; // the shell passes STRIKE_AT + the Stage's flight time
  const moving = targets.find(target => target.value !== 5)!;
  const drawn = targetAt(moving, t + delay), atRelease = targetAt(moving, t);
  assert.ok(Math.hypot(drawn.x - atRelease.x, drawn.y - atRelease.y) > moving.r, "the target moves during the flight");
  const shot = { aimX: drawn.x, aimY: drawn.y, power: 0.6, curl: 0 };
  assert.equal(resolveTargetShot(shot, [moving], t, 0, delay).hit, moving, "aiming where the target is drawn at the crossing hits");
  const stale = { aimX: atRelease.x, aimY: atRelease.y, power: 0.6, curl: 0 };
  assert.equal(resolveTargetShot(stale, [moving], t, 0, delay).hit, null, "aiming where it was at release misses");
});

test("token explainer (round 6 C11): the five lines word for word, RF + $GBOOT only (no Coins anywhere)", () => {
  assert.deepEqual(TOKEN_LINES.map(([term, text]) => `${term}: ${text}`), [
    "RF: Rare Friends money. Buy balls with it; cash balls back into it.",
    "Ball: your shot. Its RF value is printed on it.",
    "$GBOOT: the game's token. Spend it on kits, cup entries and wildcards.",
    "Lace: lock $GBOOT into your Friend for style + XP perks.",
    "Burn: spent $GBOOT is gone forever.",
  ]);
  for (const file of ["index.tsx", "ui.tsx", "ballui.tsx", "economy.ts"]) {
    const text = readFileSync(new URL(`../../games/penalty-kings/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /\bcoins?\b/i, `${file} mentions an off-chain currency`);
  }
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  assert.match(index, /setConfirmWildcard\(true\)/, "the Wildcard button only opens a confirmation");
});

test("HUD jargon (round 6 C15): rung names, ×N multipliers and keeper reads live in the Scouting Book, not on the pitch", () => {
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../games/penalty-kings/ui.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(index, /rungName|streakMultiplier\(/, "no difficulty rung or streak multiplier in the shell's HUD");
  const hud = index.slice(index.indexOf('className="pk-hud pk-hud-left"'), index.indexOf("{banner &&"));
  assert.doesNotMatch(hud, /×/, "no ×N in the HUD");
  const onResolved = index.slice(index.indexOf("function onResolved"), index.indexOf("function onKickDone"));
  assert.doesNotMatch(onResolved, /×\d/, "no ×N in the kick banners");
  const book = ui.slice(ui.indexOf("export function ScoutingBook"), ui.indexOf("export type SessionSummary"));
  assert.match(book, /rungName\(progress\.difficulty\)/); assert.match(book, /ZONE_MULT/); assert.match(book, /streakMultiplier/); assert.match(book, /profile\.read/);
});

test("ETHICS: the paid ball reveal is derived only from the settled outcome — no fake near-misses", () => {
  for (let outcome = 1; outcome <= 7; outcome++) {
    const plan = revealPlan(outcome);
    assert.equal(plan.rarity, outcome - 1);
    assert.ok(plan.beats.every(beat => beat.shows === outcome - 1), "every beat shows only the true rarity");
    assert.deepEqual(revealPlan(outcome), plan, "pure: same outcome, same animation");
  }
  // Intensity is monotonic in the TRUE rarity (no teasing a lower ball with top-tier drama).
  for (let outcome = 2; outcome <= 7; outcome++) assert.ok(revealPlan(outcome).tier > revealPlan(outcome - 1).tier);
  assert.ok(revealPlan(7).fullScreen && !revealPlan(6).fullScreen);
  assert.throws(() => revealPlan(0)); assert.throws(() => revealPlan(8));
  // The Stage's reveal takes nothing but the plan: its reveal entry point accepts a RevealPlan only.
  const stage = readFileSync(new URL("../../games/penalty-kings/gfx/stage.ts", import.meta.url), "utf8");
  assert.match(stage, /showReveal\(plan: RevealPlan\)/);
  assert.doesNotMatch(stage, /Math\.random\(\)[^\n]*reveal\.rarity|reveal\.rarity\s*=/, "the shown rarity is never randomised or reassigned");
});

test("PRIZES: simulated amounts are tagged, USD uses the live price, failed or stale reads show a dash", () => {
  const now = Date.UTC(2026, 8, 28, 12);
  const price = { usdPerRf: 0.0016, fetchedAt: now - 12_000, status: "live" as const };
  const failed = { usdPerRf: null, fetchedAt: now - 1000, status: "error" as const };
  const sim = potBanner({ kind: "simulated", potRF: 500000, topPrizeRF: 100, freeStakeRF: 2000, price }, now);
  assert.equal(sim.tag, "SIMULATED"); assert.equal(sim.usd, "≈ $800", "preview converts with the real price"); assert.match(sim.text, /500,000 RF/);
  assert.equal(sim.priceNote, "live · 12s ago"); assert.doesNotMatch(sim.text, /illustrative/);
  assert.equal(potBanner({ kind: "simulated", potRF: 500000, topPrizeRF: 100, freeStakeRF: 2000, price: failed }, now).usd, "—", "no price → dash, never a constant");
  assert.equal(potBanner({ kind: "simulated", potRF: 500000, topPrizeRF: 100, freeStakeRF: 2000 }, now).usd, "—", "no price read yet → dash");
  const live = { kind: "live" as const, potRF: 1234, topPrizeRF: 100, freeStakeRF: 5000, readAt: now - 5000, price };
  assert.match(prizeLine(live, "potRF", now).note, /updated 5s ago/);
  assert.equal(prizeLine(live, "potRF", now).usd, "≈ $1.97");
  assert.equal(prizeLine(live, "potRF", now + PRICE_MAX_AGE_MS).value, "—", "stale read shows a dash");
  assert.equal(prizeLine({ ...live, potRF: null }, "potRF", now).value, "—", "failed read shows a dash");
  assert.equal(prizeLine({ ...live, price: failed }, "potRF", now).usd, "—");
  const slides = jumbotronSlides({ kind: "simulated", potRF: 1000, topPrizeRF: 100, freeStakeRF: 1, price }, now, { rank: 3, lastBigPull: null });
  for (const slide of slides) assert.match(slide, /SIMULATED|ODDS/);
  assert.match(slides[0], /≈ \$1\.60/); assert.match(slides[1], /≈ \$0\.16/);
  assert.equal(new Date(cupEndsAt(now)).getUTCDay(), 1);
});

test("PRICE: no fixed or illustrative RF/USD price remains in the game sources", () => {
  for (const file of ["index.tsx", "ui.tsx", "game/prizes.ts", "game/price.ts"]) {
    const text = readFileSync(new URL(`../../games/penalty-kings/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /ILLUSTRATIVE_USD_PER_RF|illustrative/i, file);
  }
});

test("PRIZES: no UI source hard-codes a prize figure or promises a win", () => {
  for (const file of ["index.tsx", "game/prizes.ts", "gfx/stage.ts"]) {
    let text: string;
    try { text = readFileSync(new URL(`../../games/penalty-kings/${file}`, import.meta.url), "utf8"); } catch { continue; }
    text = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // rules quoted in comments are fine
    assert.doesNotMatch(text, /you will win|guaranteed (return|win|prize)/i, file);
    assert.doesNotMatch(text, /[^≈]\s\$\d/, `${file}: USD figures need ≈`);
  }
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  // Prize/pot displays go through the prizes module.
  assert.match(index, /potBanner\(/); assert.match(index, /prizeLine\(|jumbotronSlides\(/);
});

test("cosmetics: 15 KitShop items keep their on-chain order; star rewards are separate", () => {
  assert.equal(COSMETICS.length, 15);
  assert.ok(ALL_COSMETICS.length > COSMETICS.length);
});

import { swipeToFreeKick } from "../../games/penalty-kings/game/input.ts";
import { freeKickSetup } from "@penalty-kings/engine";
test("free-kick swipe: higher aim lifts, a late flick adds topspin, a bow adds spin", () => {
  const size = { width: 480, height: 320 };
  const setup = freeKickSetup(2, { distance: 22, angle: 0 });
  const short = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 260, t: 80 }, { x: 240, y: 230, t: 160 }], size, setup)!;
  const long = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 200, t: 80 }, { x: 240, y: 100, t: 160 }], size, setup)!;
  assert.ok(long.lift > short.lift);
  const even = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 250, t: 100 }, { x: 240, y: 200, t: 200 }, { x: 240, y: 150, t: 300 }], size, setup)!;
  const flick = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 280, t: 100 }, { x: 240, y: 260, t: 200 }, { x: 240, y: 150, t: 260 }], size, setup)!;
  assert.ok(flick.top > even.top);
  const bowed = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 190, y: 220, t: 100 }, { x: 240, y: 140, t: 200 }], size, setup)!;
  assert.ok(Math.abs(bowed.spin) > 0.3);
});

import { MatchDirector } from "../../games/penalty-kings/game/director.ts";
import { COMMENTARY_COUNT, commentary, commentaryContexts } from "../../games/penalty-kings/gfx/commentary.ts";
test("Match Director: the specific line wins, waves are rationed, keepers rotate", () => {
  const d = new MatchDirector(3);
  const base = { kind: "penalty" as const, zone: "corner" as const, x: 0.8, y: 0.3, streak: 1, misses: 0 };
  assert.equal(d.afterKick({ ...base, result: "goal", zone: "bin", y: 0.8 }).say, "top-bin");
  assert.equal(d.afterKick({ ...base, result: "goal", postIn: true }).say, "post-in");
  assert.equal(d.afterKick({ ...base, result: "goal", zone: "centre", x: 0, y: 0.7 }).say, "panenka");
  assert.equal(d.afterKick({ ...base, kind: "freekick", result: "wall" }).say, "wall");
  assert.equal(d.afterKick({ ...base, kind: "freekick", result: "goal", knuckle: true }).say, "knuckle");
  assert.equal(d.afterKick({ ...base, result: "save", misses: 3 }).say, "cold-streak");
  const waves = Array.from({ length: 12 }, () => d.afterKick({ ...base, result: "goal", streak: 3 }).wave).filter(Boolean).length;
  assert.ok(waves >= 1 && waves <= 3, `waves rationed (${waves} in 12 streak goals)`);
  const keepers = new Set(Array.from({ length: 6 }, () => d.keeperForRound(["mouse", "squirrel"], "sloth")));
  assert.ok(keepers.has("sloth") && keepers.size >= 2, "rematches rotate in");
  assert.ok(new Set([0, 1, 2, 3].map(k => d.keeperForKick(["mouse"], "squirrel", k))).size >= 2, "free kicks rotate keepers");
  assert.ok(MatchDirector.SHOWREEL.every(beat => !/reveal/.test(beat)), "the showreel never shows paid reveals");
});

test("commentary: 150+ lines, every context non-empty, no repeat until the pool is used", () => {
  assert.ok(COMMENTARY_COUNT >= 150, `${COMMENTARY_COUNT} lines`);
  const names = { friend: "Friend #1", keeper: "Keeper" };
  for (const context of commentaryContexts()) assert.ok(commentary(context, names).length > 3, context);
  // The pool cycles: 12 draws span at most one cycle boundary, so at most one line can repeat.
  const seen = new Set(Array.from({ length: 12 }, () => commentary("goal", names)));
  assert.ok(seen.size >= 11, `${seen.size} distinct goal lines in 12 draws`);
});
