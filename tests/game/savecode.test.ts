import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSaveCode, decodeSaveCode } from "../../games/penalty-kings/game/savecode.ts";
import { fresh } from "../../games/penalty-kings/game/progress.ts";

test("save code round-trips progression for the same Friend, and only progression", () => {
  const progress = { ...fresh(), xp: 1234, stars: { "park-1": 3, "pro-2": 1 }, stamps: ["mouse", "sloth"] as never[], tutorialDone: true, best: { target: 900, penalties: 2400, freekicks: 800 }, rewards: ["boots-gold"] };
  const code = encodeSaveCode(progress, 336583n);
  assert.match(code, /^PK1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const back = decodeSaveCode(code, 336583n);
  assert.ok(back.ok);
  if (back.ok) {
    assert.equal(back.progress.xp, 1234); assert.deepEqual(back.progress.stars, progress.stars); assert.deepEqual(back.progress.stamps, ["mouse", "sloth"]);
    assert.equal(back.progress.tutorialDone, true); assert.deepEqual(back.progress.best, progress.best);
    for (const key of Object.keys(back.progress)) assert.ok(!/rf|gboot|ball|balance/i.test(key), `no money field: ${key}`);
  }
});

test("save code is bound to its Friend and rejects typos / junk", () => {
  const code = encodeSaveCode({ ...fresh(), xp: 50 }, 7730n);
  assert.equal(decodeSaveCode(code, 336583n).ok, false, "another Friend");
  assert.equal(decodeSaveCode(code.slice(0, -1) + (code.endsWith("0") ? "1" : "0"), 7730n).ok, false, "typo");
  assert.equal(decodeSaveCode("hello", 7730n).ok, false);
  assert.equal(decodeSaveCode(`  ${code}\n`, 7730n).ok, true, "whitespace from copy/paste is fine");
});

test("save code keeps the Discovery meter (Director seen code, keepers, stadiums) and old codes still restore", () => {
  const progress = { ...fresh(), xp: 300, directorSeen: "gB-3", keepersSeen: ["mouse", "chameleon", "octopus"] as never[], stadiumsSeen: ["park"] };
  const back = decodeSaveCode(encodeSaveCode(progress, 42n), 42n);
  assert.ok(back.ok);
  if (back.ok) { assert.equal(back.progress.directorSeen, "gB-3"); assert.deepEqual(back.progress.keepersSeen, ["mouse", "chameleon", "octopus"]); assert.deepEqual(back.progress.stadiumsSeen, ["park"]); }
  const crc = (text: string) => { let c = ~0; for (let i = 0; i < text.length; i++) { c ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c >>> 0).toString(16).padStart(8, "0"); };
  const code = (value: unknown) => { const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); return `PK1.${payload}.${crc(`42:${payload}`)}`; };
  // A code made before the Discovery meter existed (no such fields) restores with empty discovery.
  const old = decodeSaveCode(code({ xp: 120, stamps: ["mouse"], tutorialDone: true }), 42n);
  assert.ok(old.ok);
  if (old.ok) { assert.equal(old.progress.xp, 120); assert.equal(old.progress.directorSeen, ""); assert.deepEqual(old.progress.keepersSeen, []); assert.deepEqual(old.progress.stadiumsSeen, []); }
  // Junk in the new fields is dropped, never trusted.
  const cleaned = decodeSaveCode(code({ xp: 1, directorSeen: "<script>", stadiumsSeen: ["moon", "pro"] }), 42n);
  assert.ok(cleaned.ok);
  if (cleaned.ok) { assert.equal(cleaned.progress.directorSeen, ""); assert.deepEqual(cleaned.progress.stadiumsSeen, ["pro"]); }
});

test("save code keeps the D18 check-in track; older codes without it restore a fresh track", () => {
  const progress = { ...fresh(), xp: 300, login: { lastDay: "2026-09-27", day: 4 } };
  const restored = decodeSaveCode(encodeSaveCode(progress, 7730n), 7730n);
  assert.ok(restored.ok); if (restored.ok) assert.deepEqual(restored.progress.login, { lastDay: "2026-09-27", day: 4 });
  const { login: _drop, ...old } = progress;
  const legacy = decodeSaveCode(encodeSaveCode(old as typeof progress, 7730n), 7730n);
  assert.ok(legacy.ok); if (legacy.ok) assert.deepEqual(legacy.progress.login, { lastDay: "", day: 0 });
});
