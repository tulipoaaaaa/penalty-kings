import { test } from "node:test";
import assert from "node:assert/strict";
import { remoteProgressStore, localProgressStore, defaultPlatform } from "../../games/penalty-kings/game/platform.ts";
import { fresh } from "../../games/penalty-kings/game/progress.ts";

test("platform seams: remote (Nakama-style) store round-trips progression; defaults are today's behaviour", async () => {
  const kv = new Map<string, string>();
  const store = remoteProgressStore(7730n, { read: async k => kv.get(k) ?? null, write: async (k, v) => { kv.set(k, v); } });
  assert.equal(store.durable, true);
  await store.save({ ...fresh(), xp: 420, tutorialDone: true });
  const back = await store.load();
  assert.equal(back.xp, 420); assert.equal(back.tutorialDone, true);
  assert.equal(localProgressStore(7730n).importCode(store.exportCode(back)).ok, true);
  const platform = defaultPlatform(7730n);
  assert.equal(platform.randomness.expectedWaitMs(), 0, "preview default: instant randomness (no added delay)");
});
