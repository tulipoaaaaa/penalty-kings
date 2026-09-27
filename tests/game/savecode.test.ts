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
