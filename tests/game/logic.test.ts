import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KEEPERS } from "@penalty-kings/engine";
import { starsFor, met, describe, type Level, type KickRecord } from "../../games/penalty-kings/game/objectives.ts";
import levelsJson from "../../games/penalty-kings/game/levels.json";
import { loadProgress, saveProgress, fresh, levelFromXp, assistLevel, isUnlocked, nextRung, LADDER, STORAGE_KEY } from "../../games/penalty-kings/game/progress.ts";
import { dailyScenario, dailyStreak, dailyState, utcDate } from "../../games/penalty-kings/game/daily.ts";
import { spawnTargets, resolveTargetShot, targetAt, MAX_COMBO } from "../../games/penalty-kings/game/target.ts";
import { revealPlan } from "../../games/penalty-kings/game/reveal.ts";
import { potBanner, prizeLine, jumbotronSlides, cupEndsAt, PRICE_MAX_AGE_MS } from "../../games/penalty-kings/game/prizes.ts";
import { ALL_COSMETICS, COSMETICS } from "../../games/penalty-kings/economy.ts";

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
  assert.ok(!isUnlocked("target", fresh()) && isUnlocked("target", { ...fresh(), xp: 300 }));
  assert.equal(nextRung(fresh()), LADDER[0]);
  assert.equal(nextRung({ ...fresh(), stamps: ["mouse"] }), "squirrel");
  assert.equal(assistLevel(fresh(), "pro"), 1);
  assert.equal(assistLevel({ ...fresh(), tutorialDone: true, matches: 6 }, "pro"), 0);
  assert.ok(assistLevel({ ...fresh(), tutorialDone: true, matches: 6 }, "park") > 0);
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
  const t = 3, flight = 0.95 - 0.55 * 0.6;
  const at = targetAt(targets[0], t + flight);
  const power = (at.y + 0.15) / 1.25;
  const aimed = resolveTargetShot({ aimX: at.x, loft: 0, power, curl: 0 }, targets, t, 0);
  // (power changes flight time slightly; search nearby release times for a hit)
  let hit = aimed.hit ? aimed : null;
  for (let dt = -0.2; !hit && dt <= 0.2; dt += 0.01) { const r = resolveTargetShot({ aimX: at.x, loft: 0, power, curl: 0 }, targets, t + dt, 0); if (r.hit) hit = r; }
  assert.ok(hit && hit.points > 0 && hit.combo === 1);
  const miss = resolveTargetShot({ aimX: 1.5, loft: 0, power: 0.5, curl: 0 }, targets, t, 4);
  assert.equal(miss.combo, 0); assert.equal(miss.points, 0);
  const bar = resolveTargetShot({ aimX: 0, loft: 0, power: 0.92, curl: 0 }, [], t, MAX_COMBO);
  assert.ok(bar.crossbar && bar.points > 0 && bar.combo === MAX_COMBO);
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

test("PRIZES: simulated figures are tagged, live figures come from reads and never go stale", () => {
  const now = Date.UTC(2026, 8, 28, 12);
  const sim = potBanner({ kind: "simulated", potRF: 500000, topPrizeRF: 100, freeStakeRF: 2000 }, now);
  assert.equal(sim.tag, "SIMULATED"); assert.match(sim.usd, /^≈ \$[\d,.]+ \(illustrative\)$/); assert.match(sim.text, /500,000 RF/);
  const live = { kind: "live" as const, potRF: 1234, topPrizeRF: 100, freeStakeRF: 5000, usdPerRF: 0.0016, readAt: now - 5000 };
  assert.match(prizeLine(live, "potRF", now).note, /updated 5s ago/);
  assert.match(prizeLine(live, "potRF", now).usd, /^≈ \$/);
  assert.equal(prizeLine(live, "potRF", now + PRICE_MAX_AGE_MS).value, "—", "stale read shows a dash");
  assert.equal(prizeLine({ ...live, potRF: null }, "potRF", now).value, "—", "failed read shows a dash");
  assert.equal(prizeLine({ ...live, usdPerRF: null }, "potRF", now).usd, "—");
  for (const slide of jumbotronSlides({ kind: "simulated", potRF: 1, topPrizeRF: 1, freeStakeRF: 1 }, now, { rank: 3, lastBigPull: null })) assert.match(slide, /SIMULATED|ODDS/);
  assert.equal(new Date(cupEndsAt(now)).getUTCDay(), 1);
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
test("free-kick swipe: longer swipes lift, a late flick adds topspin, a bow adds spin", () => {
  const size = { width: 480, height: 320 };
  const short = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 260, t: 80 }, { x: 240, y: 230, t: 160 }], size)!;
  const long = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 200, t: 80 }, { x: 240, y: 100, t: 160 }], size)!;
  assert.ok(long.lift > short.lift);
  const even = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 250, t: 100 }, { x: 240, y: 200, t: 200 }, { x: 240, y: 150, t: 300 }], size)!;
  const flick = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 240, y: 280, t: 100 }, { x: 240, y: 260, t: 200 }, { x: 240, y: 150, t: 260 }], size)!;
  assert.ok(flick.top > even.top);
  const bowed = swipeToFreeKick([{ x: 240, y: 300, t: 0 }, { x: 190, y: 220, t: 100 }, { x: 240, y: 140, t: 200 }], size)!;
  assert.ok(Math.abs(bowed.spin) > 0.3);
});
