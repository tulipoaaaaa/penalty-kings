// Bug Quest P2 (engine / difficulty): game-side tests, each failed before its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recordsDifficulty } from "../../games/penalty-kings/game/progress.ts";
import { skillZoneOf, inOffLabel } from "../../games/penalty-kings/game/rewards.ts";
import { keeperHistory } from "../../games/penalty-kings/game/shots.ts";
import { keeperPlan, keeperById, resolveShot, kickSeed, type ShotResult } from "@penalty-kings/engine";

const index = () => readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");

test("BQ-P2-2: only ladder-mode kicks feed the difficulty history (never Skill Cup, Big Match, Target or the tutorial)", () => {
  for (const mode of ["penalties", "tour", "daily"] as const) assert.equal(recordsDifficulty(mode, "penalty"), true, mode);
  assert.equal(recordsDifficulty("freekicks", "freekick"), true);
  for (const mode of ["skill", "match", "tutorial", "challenge"] as const) assert.equal(recordsDifficulty(mode, "penalty"), false, mode);
  assert.equal(recordsDifficulty("target", "target"), false);
  assert.equal(recordsDifficulty("penalties", "target"), false);
  // The shell's one history write is behind the guard.
  const writes = index().split("\n").filter(line => /history: \[\.\.\.p\.history/.test(line));
  assert.equal(writes.length, 1);
  assert.match(writes[0], /if \(recordsDifficulty\(current\.mode, current\.kind\)\)/);
});

test("BQ-P2-6: a shot-clock timeout never enters the robot keeper's kick history", () => {
  const kick = (x: number) => ({ result: "goal" as ShotResult, zone: "corner" as const, points: 100, x, y: 0.3 });
  const timeout = { result: "wide" as ShotResult, zone: "centre" as const, points: 0, x: 0, y: 0, timedOut: true };
  const kicks = [kick(0.7), kick(0.8), timeout, timeout, timeout];
  assert.deepEqual(keeperHistory(kicks), [0.7, 0.8]);
  // The robot still knows your favourite side after three timeouts (with x: 0 in his memory he forgot it).
  const robot = keeperById("robot"), scans = new Set<number | undefined>();
  for (let seed = 1; seed <= 200; seed++) scans.add(keeperPlan(robot, seed, { x: 0, y: 0.5 }, { kickIndex: 5, history: keeperHistory(kicks) }).scan);
  assert.ok(scans.has(1), "the robot scans the learned (right) side");
  // The shell: the timeout record is flagged, and both keeper-history reads go through keeperHistory.
  const source = index();
  assert.match(source, /record: \{ result: "wide", zone: "centre", points: 0, x: 0, y: 0, timedOut: true \}/);
  assert.equal((source.match(/history: keeperHistory\(current\.kicks\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /history: current\.kicks\.map\(kick => kick\.x\)/);
});

test("BQ-P2-8: in off the bar / OFF THE BAR / crossbar lines come from the engine's hitBar flag, and the result line says it once", () => {
  // XP / Skill Zone: the flag decides, whatever the height.
  assert.equal(skillZoneOf({ goal: true, zone: "centre", postIn: true, hitBar: true }), "bar-in");
  assert.equal(skillZoneOf({ goal: true, zone: "corner", postIn: true, hitBar: false }), "post-in");
  // The engine's real in-off goals label as the engine says.
  const sloth = keeperById("sloth");
  let barIns = 0, postIns = 0;
  for (let k = 0; k < 20000; k++) {
    const o = resolveShot({ aimX: (k % 2 ? 1 : -1) * (0.9 + (k % 9) * 0.01), aimY: 0.85 + (k % 13) * 0.01, power: 0.6, curl: 0 }, sloth, kickSeed(3, k, "sloth"));
    if (!o.postIn) continue;
    const zone = skillZoneOf({ goal: true, zone: o.zone, postIn: o.postIn, hitBar: o.hitBar });
    assert.equal(zone, o.hitBar ? "bar-in" : "post-in");
    if (o.hitBar) barIns++; else postIns++;
  }
  assert.ok(barIns > 0 && postIns > 0, `${barIns} bar-in, ${postIns} post-in`);
  // The double label: a free-mode bar-in goal read "centre · in off the post · SKILL ZONE: in off the bar". Now the
  // Skill Zone label says it alone; without a Skill Zone (Big Match, Skill Cup) the inline words name the right woodwork.
  assert.equal(inOffLabel({ postIn: true, hitBar: true }, "bar-in"), "");
  assert.equal(inOffLabel({ postIn: true }, "post-in"), "");
  assert.equal(inOffLabel({ postIn: true, hitBar: true }, null), " · in off the bar");
  assert.equal(inOffLabel({ postIn: true }, null), " · in off the post");
  assert.equal(inOffLabel({}, null), "");
  // The shell and the Stage never guess the bar from the height.
  const source = index(), stage = readFileSync(new URL("../../games/penalty-kings/gfx/stage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /BAR_CONTACT_Y|" · in off the post"/);
  assert.match(source, /result === "post" && record\.hitBar \? "OFF THE BAR!"/);
  assert.match(source, /skillZoneOf\(\{ goal, zone: record\.zone, postIn: record\.postIn, hitBar: record\.hitBar \}\)/);
  assert.match(source, /hitBar: record\.hitBar/); // the Director's facts
  assert.match(stage, /bar = result === "post" && Boolean\(shot\.outcome\.hitBar\)/);
});

test("UI copy: multipliers use ×, menus go by their names, no double spaces, one spelling of the Golden Boot Cup and $GBOOT", () => {
  const game = new URL("../../games/penalty-kings/", import.meta.url);
  const files = ["index.tsx", "ui.tsx", "ballui.tsx", "potui.tsx", "share.tsx", "layout.tsx", "economy.ts", "game/shots.ts", "game/prizes.ts", "game/weekly.ts", "game/challenge.ts", "game/nextgoal.ts", "game/objectives.ts", "game/progress.ts", "game/rewards.ts", "game/firstsession.ts", "gfx/commentary.ts"];
  const texts: string[] = [];
  for (const file of files) {
    const source = readFileSync(new URL(file, game), "utf8");
    // String literals, template literals (with ${…} taken out) and JSX text.
    for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "\u0000");
      if (/[A-Za-z]{2,} [A-Za-z]/.test(text)) texts.push(`${text} (${file})`);
    }
  }
  assert.ok(texts.length > 300, `UI strings found: ${texts.length}`);
  const bad = (pattern: RegExp) => texts.filter(text => pattern.test(text));
  assert.deepEqual(bad(/\bx\d/), [], "a points multiplier is written ×1.5, never x1.5");
  assert.deepEqual(bad(/\bthe Shop\b/), [], "the Ball shop / Kit shop go by their menu names");
  assert.deepEqual(bad(/[^\s\u0000] {2,}[^\s\u0000(]/), [], "no double spaces");
  assert.deepEqual(bad(/golden boot cup/i).filter(text => !/Golden Boot Cup|GOLDEN BOOT CUP/.test(text)), [], "Golden Boot Cup (or GOLDEN BOOT CUP)");
  assert.deepEqual(bad(/(?<![$\w])GBOOT\b/), [], "the token is always $GBOOT");
});
