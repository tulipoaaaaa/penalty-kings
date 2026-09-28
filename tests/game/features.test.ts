// EARLY ACCESS feature flags (game/features.ts) and the build regions that apply them (scripts/lib/ea-regions.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEATURES, isOn, shownFeatures, hiddenFeatures, visibleModes, modeOn, hubMenus, modesScreenMenus, menuOn, openedModes, tutorialTitle,
  earlyAccessTeaser, nextGoalFor, HUB_MENUS, MODES_SCREEN_MENUS, type MenuId,
} from "../../games/penalty-kings/game/features.ts";
import { nextGoal } from "../../games/penalty-kings/game/nextgoal.ts";
import { MODES, LADDER, fresh, levelFromXp, type Progress } from "../../games/penalty-kings/game/progress.ts";
import type { Level } from "../../games/penalty-kings/game/objectives.ts";
import { applyEarlyAccess, regionCount } from "../../scripts/lib/ea-regions.mjs";

const LEVELS = JSON.parse(readFileSync(new URL("../../games/penalty-kings/game/levels.json", import.meta.url), "utf8")) as Level[];
const TODAY = "2026-09-28";
const HIDDEN_WORDS = /Free Kick|World Tour|Target|Skill Cup|Kit shop|Cups?\b|Champions Night|Keeper of the Week|challenge code|Market|\$GBOOT/i;
const source = (file: string) => readFileSync(new URL(`../../games/penalty-kings/${file}`, import.meta.url), "utf8");

/** Every progress state a player can be in that matters for the NEXT GOAL (XP, daily attempts, stamps, stars, bests). */
function* progressSweep(): Generator<Progress> {
  const stars = Object.fromEntries(LEVELS.map(level => [level.id, 3]));
  for (const xp of [0, 40, 99, 100, 150, 300, 5000]) for (const attempts of [0, 2, 3]) for (const stamps of [[], ["mouse"], [...LADDER]]) for (const allStars of [false, true])
    yield { ...fresh(), tutorialDone: xp > 0, xp, daily: { date: TODAY, attempts, best: 0, played: [] }, stamps: stamps as Progress["stamps"], stars: allStars ? stars : {}, best: { penalties: 1234, freekicks: 50, target: 420 } };
}

test("features: early access shows exactly the four features (balls, Practice, Daily, Scouting Book)", () => {
  assert.deepEqual(shownFeatures("early-access"), ["bigMatch", "ballShop", "bag", "packs", "redeem", "practice", "daily", "scoutingBook"]);
  assert.deepEqual(hiddenFeatures("early-access"), ["freeKicks", "worldTour", "target", "skillCup", "kitShop", "cups", "pot", "championsNight", "keeperOfTheWeek", "challengeCodes", "share", "market", "gboot"]);
  assert.deepEqual(hiddenFeatures("full"), [], "the full preset shows everything");
  for (const feature of Object.keys(FEATURES) as (keyof typeof FEATURES)[]) assert.equal(isOn("full", feature), true);
});

test("features: full preset lists are today's, unchanged", () => {
  assert.equal(visibleModes("full"), MODES);
  assert.deepEqual(hubMenus("full"), ["balls", "bag", "cups", "book", "shop", "rules", "settings"]);
  assert.deepEqual(modesScreenMenus("full"), ["book", "balls", "bag", "shop", "cups", "rules", "settings"]);
  assert.equal(tutorialTitle("full"), "Tutorial complete! Level 2: Free Kicks, World Tour, Daily and Target Practice unlocked");
  for (const progress of progressSweep()) assert.deepEqual(nextGoalFor("full", progress, LEVELS, TODAY), nextGoal(progress, LEVELS, TODAY));
});

test("features: hidden modes and menus are absent in early access; Penalties is the Practice mode", () => {
  const modes = visibleModes("early-access");
  assert.deepEqual(modes.map(mode => mode.id), ["penalties", "daily", "match"]);
  assert.equal(modes[0].name, "Practice");
  assert.match(modes[0].blurb, /No RF/);
  for (const mode of modes) { assert.ok(modeOn("early-access", mode.id)); assert.doesNotMatch(`${mode.name} ${mode.blurb}`, HIDDEN_WORDS); }
  for (const hidden of ["freekicks", "tour", "target", "skill"] as const) assert.equal(modeOn("early-access", hidden), false);
  assert.deepEqual(hubMenus("early-access"), ["balls", "bag", "book", "rules", "settings"]);
  assert.deepEqual(modesScreenMenus("early-access"), ["book", "balls", "bag", "rules", "settings"]);
  for (const menu of ["shop", "cups", "tour", "market"] as MenuId[]) assert.equal(menuOn("early-access", menu), false, menu);
  for (const menu of [...HUB_MENUS, ...MODES_SCREEN_MENUS]) if (!menuOn("early-access", menu)) assert.ok(!hubMenus("early-access").includes(menu) && !modesScreenMenus("early-access").includes(menu));
});

test("features: early access NEXT GOAL only ever points at a visible mode and never names a hidden feature", () => {
  let seen = new Set<string>();
  for (const progress of progressSweep()) {
    const goal = nextGoalFor("early-access", progress, LEVELS, TODAY);
    assert.ok(modeOn("early-access", goal.mode), `${goal.mode}: ${goal.text}`);
    assert.ok(visibleModes("early-access").some(mode => mode.id === goal.mode && !mode.paid), "never the paid Big Match");
    assert.doesNotMatch(goal.text, HIDDEN_WORDS, goal.text);
    seen.add(goal.mode);
  }
  assert.deepEqual([...seen].sort(), ["daily", "penalties"]);
  // the tutorial still unlocks level 2, and NEXT GOAL names what it opens (the Daily Challenge only)
  assert.equal(nextGoalFor("early-access", { ...fresh(), tutorialDone: true, xp: 40 }, LEVELS, TODAY).text, "60 XP to level 2: unlocks Daily Challenge");
  const done = nextGoalFor("early-access", { ...fresh(), tutorialDone: true, xp: 5000, daily: { date: TODAY, attempts: 3, best: 0, played: [] }, stamps: [...LADDER], best: { penalties: 1234, freekicks: 0, target: 420 } }, LEVELS, TODAY);
  assert.deepEqual(done, { text: "Beat your Practice best: 1234", mode: "penalties" });
  assert.equal(tutorialTitle("early-access"), "Tutorial complete! Level 2: Daily Challenge unlocked");
  assert.deepEqual(openedModes("early-access", 1, 2), ["Daily Challenge"]);
  assert.deepEqual(openedModes("early-access", levelFromXp(0).level, levelFromXp(100).level), ["Daily Challenge"], "the tutorial's 100 XP opens it");
  assert.doesNotMatch(earlyAccessTeaser(true) + earlyAccessTeaser(false), HIDDEN_WORDS);
});

test("regions: early access source has no entry point to a hidden feature; the full source is today's", () => {
  const index = source("index.tsx"), ui = source("ui.tsx"), ballui = source("ballui.tsx");
  for (const file of [index, ui, ballui]) assert.ok(regionCount(file) > 0);
  const ea = { index: applyEarlyAccess(index), ui: applyEarlyAccess(ui), ballui: applyEarlyAccess(ballui) };
  // Render-level entry points of hidden features (menus, HUD pot, Results, modes screen).
  const entryPoints = ["<ChallengeBox", "<WeeklyKeeper", "<SharePanel", "<WinnersTicker", "{potCounter(", "data-testid=\"pot\"", "onClick={() => setMenu(\"shop\")}", "onClick={() => setMenu(\"cups\")}", "<Shop ", "<OddsTable "];
  for (const entry of entryPoints) { assert.ok(index.includes(entry), `full: ${entry}`); assert.ok(!ea.index.includes(entry), `early access: ${entry}`); }
  assert.ok(ballui.includes(">Market (coming soon)</button>") && !ea.ballui.includes(">Market (coming soon)</button>"));
  assert.ok(ui.includes("<b>Target Practice:</b>") && !ea.ui.includes("<b>Target Practice:</b>"));
  assert.ok(!/\$GBOOT dropped/.test(ea.ballui) && !/summary\.match\.gboot/.test(ea.ui), "no $GBOOT lines in early access");
  // What early access adds: rating shop, rating odds, the HUD rating, the NEXT GOAL and hub/modes lists from features.ts.
  for (const entry of ["<EarlyAccessShop", "<RatingOddsTable", "<RatingPanel", "hud-rating", "nextGoalFor(\"early-access\"", "hubMenus(\"early-access\")", "modesScreenMenus(\"early-access\")", "if (!modeOn(\"early-access\", mode)) return;"]) assert.ok(ea.index.includes(entry), entry);
  // With every region removed, the full source equals today's apart from the comments (the build is byte-identical).
  assert.equal(applyEarlyAccess("a /*EA{ b }*/ c /*}EA*/ d /*EA+ e +EA*/ f"), "a  b  d  e  f");
  assert.throws(() => applyEarlyAccess("x /*EA{ y }*/ z"), /unbalanced/);
});
