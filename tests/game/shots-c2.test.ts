// C2 "Shots that feel amazing" (game side): best streak (Progress + save codes), great goals for the instant
// replay, the PERFECT flash wording and the shot clock the shell runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSaveCode, decodeSaveCode } from "../../games/penalty-kings/game/savecode.ts";
import { fresh, loadProgress, STORAGE_KEY } from "../../games/penalty-kings/game/progress.ts";
import { longestRun, withBestStreak, replayReason, REPLAY_SECONDS, REPLAY_LABEL, SHOT_RULES, clockSeconds } from "../../games/penalty-kings/game/shots.ts";
import { DIFFICULTY_LADDER, NEUTRAL } from "@penalty-kings/engine";
import { readFileSync } from "node:fs";

const kick = (result: "goal" | "save" | "post" | "over" | "wide" | "wall", extra: Record<string, unknown> = {}) => ({ result, zone: "side" as const, points: 0, x: 0.5, y: 0.3, ...extra });

test("best streak: the longest run of real goals in a session, kept in Progress as an all-time best", () => {
  assert.equal(longestRun([]), 0);
  assert.equal(longestRun([kick("goal"), kick("goal"), kick("save"), kick("goal"), kick("goal"), kick("goal"), kick("wide")]), 3);
  assert.equal(fresh().bestStreak, 0);
  const p = withBestStreak({ ...fresh(), bestStreak: 4 }, 3);
  assert.equal(p.bestStreak, 4, "a shorter run never lowers it");
  assert.equal(withBestStreak(p, 6).bestStreak, 6);
  // Stored progress from before this field restores with 0.
  const legacy = loadProgress({ getItem: key => (key === STORAGE_KEY ? JSON.stringify({ version: 1, xp: 50 }) : null) });
  assert.equal(legacy.bestStreak, 0); assert.equal(legacy.xp, 50);
});

test("best streak survives a save code; older codes without it restore 0; junk is dropped", () => {
  const back = decodeSaveCode(encodeSaveCode({ ...fresh(), xp: 300, bestStreak: 7 }, 7730n), 7730n);
  assert.ok(back.ok); if (back.ok) assert.equal(back.progress.bestStreak, 7);
  const crc = (text: string) => { let c = ~0; for (let i = 0; i < text.length; i++) { c ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c >>> 0).toString(16).padStart(8, "0"); };
  const code = (value: unknown) => { const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); return `PK1.${payload}.${crc(`42:${payload}`)}`; };
  const old = decodeSaveCode(code({ xp: 120, tutorialDone: true }), 42n);
  assert.ok(old.ok); if (old.ok) assert.equal(old.progress.bestStreak, 0, "a legacy code (no bestStreak) restores 0");
  for (const junk of [-3, "9", Number.NaN, 2.7, 1e9]) {
    const restored = decodeSaveCode(code({ xp: 1, bestStreak: junk }), 42n);
    assert.ok(restored.ok);
    if (restored.ok) assert.ok(Number.isInteger(restored.progress.bestStreak) && restored.progress.bestStreak >= 0 && restored.progress.bestStreak <= 999, `junk ${junk} → ${restored.progress.bestStreak}`);
  }
});

test("instant replay: only great goals (top bin, in off the post, 28 m+ screamer, PERFECT strike)", () => {
  assert.equal(replayReason(kick("goal", { zone: "bin" })), "TOP BIN");
  assert.equal(replayReason(kick("goal", { postIn: true })), "IN OFF THE POST");
  assert.equal(replayReason(kick("goal", { screamer: true, distance: 29 })), "29 M SCREAMER");
  assert.equal(replayReason(kick("goal", { perfect: true })), "PERFECT STRIKE");
  assert.equal(replayReason(kick("goal", { zone: "corner" })), null, "a plain corner goal is not replayed");
  assert.equal(replayReason(kick("save", { zone: "bin", perfect: true })), null, "only goals");
  assert.equal(REPLAY_SECONDS, 1.5);
  assert.match(REPLAY_LABEL, /REPLAY/);
});

test("the shell's shot clock: 6 s penalties / 8 s free kicks, 5 / 7 s at the hardest rung, off for Target Practice", () => {
  assert.equal(clockSeconds(DIFFICULTY_LADDER[0], "penalty"), 6);
  assert.equal(clockSeconds(DIFFICULTY_LADDER[0], "freekick"), 8);
  assert.equal(clockSeconds(DIFFICULTY_LADDER[8], "penalty"), 5);
  assert.equal(clockSeconds(DIFFICULTY_LADDER[8], "freekick"), 7);
  assert.equal(clockSeconds(DIFFICULTY_LADDER[3], "target"), 0);
  assert.equal(clockSeconds(NEUTRAL, "penalty"), 6, "Skill Cup");
});

test("every C2 rule is one sentence for a new player, and the Rules / Scouting Book / Results show them", () => {
  for (const [name, line] of Object.entries(SHOT_RULES)) {
    assert.equal(line.split(/(?<=[.!?])\s+/).filter(Boolean).length, 1, `${name}: one sentence`);
    assert.ok(line.length < 170, `${name}: short`);
  }
  const index = readFileSync(new URL("../../games/penalty-kings/index.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../games/penalty-kings/ui.tsx", import.meta.url), "utf8");
  assert.match(index, /SHOT_RULES\.clock/); assert.match(index, /SHOT_RULES\.perfect/); assert.match(index, /SHOT_RULES\.streak/); assert.match(index, /SHOT_RULES\.replay/);
  assert.doesNotMatch(index, /shot clock \(4–5 seconds/, "the old clock text is gone");
  assert.match(ui, /BEST STREAK/); assert.match(ui, /data-testid="best-streak"/); assert.match(ui, /progress\.bestStreak/);
});
