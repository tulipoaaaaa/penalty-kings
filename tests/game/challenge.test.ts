// C4: challenge codes (round trip, tamper rejection, determinism), Keeper of the Week, Day N, and the share card layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEPERS, keeperById, keeperPlan, kickSeed, resolveShot, freeKickSetup } from "@penalty-kings/engine";
import {
  encodeChallenge, decodeChallenge, challengeLink, challengeVerdict, challengeSetup, keeperOfTheWeek, weeklyBonusXp, streakDay, comeBackLine,
  shareRoundOf, CHALLENGE_KICKS, PUBLIC_URL, CHALLENGE_RULE, type Challenge,
} from "../../games/penalty-kings/game/challenge.ts";
import { weekKey } from "../../games/penalty-kings/game/rewards.ts";
import { shareCardLayout, CARD_W, CARD_H, CARD_TAGLINE, GLYPH_EM } from "../../games/penalty-kings/gfx/sharecard.ts";

const sample: Challenge = { kind: "penalty", keeper: "sumo", seed: 3_141_592_653, kicks: 5, score: 1420, from: "12345678901234567890" };

test("challenge code: round trip (penalties and free kicks, big Friend ids), and a pasted link works too", () => {
  const code = encodeChallenge(sample);
  assert.match(code, /^pkc1\.p\.sumo\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-f]{8}$/);
  assert.ok(code.length <= 64, `short enough to paste (${code.length})`);
  assert.deepEqual(decodeChallenge(code), { ok: true, challenge: sample });
  const fk: Challenge = { kind: "freekick", keeper: "mouse", seed: 0, kicks: 3, score: 0, from: "7" };
  assert.deepEqual(decodeChallenge(encodeChallenge(fk)), { ok: true, challenge: fk });
  assert.equal(challengeLink(code), `${PUBLIC_URL}?challenge=${code}`);
  assert.deepEqual(decodeChallenge(`  ${challengeLink(code)}  `), { ok: true, challenge: sample }, "the whole link");
  assert.deepEqual(decodeChallenge(code.toUpperCase()), { ok: true, challenge: sample }, "capitals from a chat app");
});

test("challenge code: casual edits and typos are rejected", () => {
  const code = encodeChallenge(sample), parts = code.split(".");
  const edit = (index: number, value: string) => { const copy = [...parts]; copy[index] = value; return copy.join("."); };
  assert.equal(decodeChallenge(edit(4, (99_999).toString(36))).ok, false, "a raised score");
  assert.equal(decodeChallenge(edit(2, "mouse")).ok, false, "a swapped keeper");
  assert.equal(decodeChallenge(edit(3, "1")).ok, false, "a changed seed");
  assert.equal(decodeChallenge(edit(1, "f")).ok, false, "a changed mode");
  assert.equal(decodeChallenge(edit(5, "1")).ok, false, "someone else's name");
  assert.equal(decodeChallenge(code.slice(0, -1) + (code.endsWith("0") ? "1" : "0")).ok, false, "a typo in the checksum");
  assert.equal(decodeChallenge("PK1.eyJ4cCI6MX0.deadbeef").ok, false, "a save code is not a challenge");
  assert.equal(decodeChallenge("").ok, false);
  const bad = decodeChallenge(edit(4, "zz"));
  assert.ok(!bad.ok && /changed or mistyped/.test(bad.reason));
});

test("determinism: the same code brings the same keeper plans, kick results and free-kick setup", () => {
  const decoded = decodeChallenge(encodeChallenge(sample));
  assert.ok(decoded.ok);
  const plans = (c: Challenge) => Array.from({ length: c.kicks }, (_, i) => keeperPlan(keeperById(c.keeper), kickSeed(c.seed, i, c.keeper), { x: 0, y: 0.5 }, { kickIndex: i, history: [] }));
  assert.deepEqual(plans(decoded.challenge), plans(sample));
  const shot = { aimX: 0.6, aimY: 0.5, power: 0.7, curl: 0.1 };
  const kicks = (c: Challenge) => Array.from({ length: c.kicks }, (_, i) => resolveShot(shot, keeperById(c.keeper), kickSeed(c.seed, i, c.keeper), { kickIndex: i, history: [] }).result);
  assert.deepEqual(kicks(decoded.challenge), kicks(sample));
  assert.notDeepEqual(plans({ ...sample, seed: sample.seed + 1 }), plans(sample), "another seed, other plans");
  assert.deepEqual(challengeSetup(sample.seed), challengeSetup(sample.seed));
  assert.deepEqual(challengeSetup(sample.seed), freeKickSetup(sample.seed, { maxWind: 3, wallHeight: 1.65 }));
});

test("challenge verdict: won, level, still leads (points only)", () => {
  assert.deepEqual(challengeVerdict(sample, 1500), { won: true, text: "You beat Friend #12345678901234567890's 1,420!" });
  assert.equal(challengeVerdict(sample, 1300).text, "Friend #12345678901234567890 still leads by 120.");
  assert.match(challengeVerdict(sample, 1420).text, /^Level with/);
  assert.ok(CHALLENGE_RULE.split(/[.!?]\s/).length === 1, "one sentence for a new player");
});

test("Keeper of the Week: a pure function of the UTC ISO week, never the boss, changes across weeks", () => {
  const week = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]; // Mon … Sun
  for (const day of week) assert.equal(weekKey(day), "2026-W39");
  const featured = keeperOfTheWeek(week[0]);
  for (const day of week) assert.equal(keeperOfTheWeek(day), featured, day);
  assert.equal(keeperOfTheWeek("2026-09-27"), keeperOfTheWeek("2026-09-27"));
  const seen = new Set<string>();
  const d = new Date("2026-01-05T00:00:00Z");
  for (let i = 0; i < 52; i++) { const day = d.toISOString().slice(0, 10); const id = keeperOfTheWeek(day); assert.ok(!keeperById(id).boss, `${day}: ${id} is not the boss`); seen.add(id); d.setUTCDate(d.getUTCDate() + 7); }
  assert.ok(seen.size >= 6, `a year features many keepers (${seen.size})`);
  assert.ok(KEEPERS.some(k => k.id === featured));
  assert.equal(weeklyBonusXp(120, 3), 120, "3 goals: the round's XP again (×2)");
  assert.equal(weeklyBonusXp(120, 5), 120);
  assert.equal(weeklyBonusXp(120, 2), 0);
});

test("Day N: shown while the check-in run is alive; come back tomorrow for day N+1", () => {
  assert.equal(streakDay({ lastDay: "", day: 0 }, "2026-09-27"), null);
  assert.equal(streakDay({ lastDay: "2026-09-27", day: 4 }, "2026-09-27"), 4);
  assert.equal(streakDay({ lastDay: "2026-09-26", day: 4 }, "2026-09-27"), 4, "yesterday: still alive until today's check-in");
  assert.equal(streakDay({ lastDay: "2026-09-25", day: 4 }, "2026-09-27"), null, "lapsed");
  assert.equal(streakDay({ lastDay: "2026-02-28", day: 2 }, "2026-03-01"), 2, "across a month end");
  assert.equal(comeBackLine({ lastDay: "2026-09-27", day: 4 }, "2026-09-27"), "Come back tomorrow for day 5.");
  assert.equal(comeBackLine({ lastDay: "2026-09-27", day: 7 }, "2026-09-27"), "Come back tomorrow for day 1.", "the 7-day track wraps");
  assert.equal(comeBackLine({ lastDay: "2026-09-26", day: 4 }, "2026-09-27"), null);
});

test("share round: challenges from replayable rounds only; none next to money", () => {
  const base = { friendId: "42", kind: "penalty", keeper: "sumo" as const, seed: 99, points: 1420, kicks: [{ result: "goal" }, { result: "save" }, { result: "goal" }], bestStreak: 2 };
  const pen = shareRoundOf({ ...base, mode: "penalties" });
  assert.deepEqual(pen?.replay, { kind: "penalty", keeper: "sumo", seed: 99, kicks: CHALLENGE_KICKS.penalty });
  assert.equal(pen?.goals, 2); assert.equal(pen?.subtitle, "5 penalties vs Big Bento");
  assert.equal(shareRoundOf({ ...base, mode: "match" }), null, "Big Match: no card");
  assert.equal(shareRoundOf({ ...base, mode: "skill" }), null, "Skill Cup: no card");
  assert.equal(shareRoundOf({ ...base, mode: "target", kind: "target" })?.replay, null, "Target Practice: a card, no challenge");
  assert.equal(shareRoundOf({ ...base, mode: "freekicks", kind: "freekick" })?.replay?.kicks, 3);
  assert.deepEqual(shareRoundOf({ ...base, mode: "challenge", challenge: { vs: sample } })?.answered, sample);
});

test("share card layout: the score, best streak, tagline and public link, all inside the card and readable", () => {
  const code = encodeChallenge(sample);
  const layout = shareCardLayout({ name: "Friend #12345678901234567890", score: 1420, scoreLabel: "pts", goals: 4, kicks: 5, bestStreak: 3, subtitle: "5 penalties vs Big Bento", link: challengeLink(code), code });
  assert.equal(layout.width, CARD_W); assert.equal(layout.height, CARD_H);
  const all = layout.texts.map(text => text.text);
  assert.ok(all.includes("1,420 pts"));
  assert.ok(all.includes("4/5 goals · best streak 3"));
  assert.ok(all.includes(CARD_TAGLINE) && CARD_TAGLINE === "Beat me at Penalty Kings");
  assert.ok(all.some(text => text.startsWith("tulipoaaaaa.github.io/penalty-kings/")));
  assert.ok(all.some(text => text.includes(code)));
  for (const text of layout.texts) {
    assert.ok(text.size >= 11, `${text.text}: ${text.size}px`);
    assert.ok(text.x >= 0 && text.x + text.text.length * text.size * GLYPH_EM <= CARD_W + 1, `${text.text} fits the width`);
    assert.ok(text.y - text.size >= 0 && text.y <= CARD_H - 4, `${text.text} fits the height`);
  }
  const s = layout.sprite; // 18 × 18 cells (mask + halo) at an integer scale, never resampled
  assert.ok(Number.isInteger(s.scale) && s.x - 9 * s.scale >= 0 && s.y - 16 * s.scale >= 0 && s.y + 2 * s.scale <= CARD_H);
  assert.ok(!/\bRF\b|GBOOT|prize|\bpot\b/i.test(all.join(" ")), "no economy words on the card");
});
