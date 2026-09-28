// Haptics bridge (apps/mobile/web/src/haptics.ts) and the deep-link return (deeplink.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHaptics, hapticKind, WEB_PATTERNS } from "../src/haptics.ts";
import { AUTH_RETURN_URL, authReturnSearch } from "../src/deeplink.ts";

test("the game's own vibration patterns map to kick / goal; anything else is ignored", () => {
  assert.equal(hapticKind(15), "kick");
  assert.equal(hapticKind([40, 30, 40]), "goal");
  for (const bad of [0, -5, 5000, Number.NaN, "15", null, undefined, {}, [], [1, "2"], new Array(20).fill(10)]) assert.equal(hapticKind(bad), null, JSON.stringify(bad));
});

test("native: impact on the kick, success notification on a goal", async () => {
  const calls: string[] = [];
  const bridge = createHaptics({
    native: { impact: async ({ style }) => { calls.push(`impact:${style}`); }, notification: async ({ type }) => { calls.push(`notification:${type}`); } },
    vibrate: () => { calls.push("vibrate"); return true; },
  });
  assert.equal(await bridge.play("kick"), "native");
  assert.equal(await bridge.play("goal"), "native");
  assert.deepEqual(calls, ["impact:LIGHT", "notification:SUCCESS"], "no double buzz: the web vibrate is not also called");
});

test("native failure falls back to navigator.vibrate", async () => {
  const patterns: unknown[] = [];
  const bridge = createHaptics({ native: { impact: async () => { throw new Error("no motor"); }, notification: async () => { throw new Error("no motor"); } }, vibrate: pattern => { patterns.push(pattern); return true; } });
  assert.equal(await bridge.play("goal"), "vibrate");
  assert.deepEqual(patterns, [WEB_PATTERNS.goal]);
});

test("web fallback: navigator.vibrate where available (Android Chrome)", async () => {
  const patterns: unknown[] = [];
  const bridge = createHaptics({ native: null, vibrate: pattern => { patterns.push(pattern); return true; } });
  assert.equal(await bridge.play("kick"), "vibrate");
  assert.equal(await bridge.play("goal"), "vibrate");
  assert.deepEqual(patterns, [15, [40, 30, 40]]);
});

test("iPhone web (no vibration API): a silent no-op, never an error", async () => {
  for (const vibrate of [null, undefined]) {
    const bridge = createHaptics({ native: null, vibrate });
    assert.equal(await bridge.play("kick"), "none");
    assert.equal(await bridge.play("goal"), "none");
  }
  const throwing = createHaptics({ native: null, vibrate: () => { throw new Error("blocked"); } });
  assert.equal(await throwing.play("kick"), "none");
  const refused = createHaptics({ native: null, vibrate: () => false });
  assert.equal(await refused.play("kick"), "none");
});

test("deep-link return: only com.penaltykings.test://auth with both OAuth params, only known params kept", () => {
  assert.equal(AUTH_RETURN_URL, "com.penaltykings.test://auth");
  assert.equal(authReturnSearch("com.penaltykings.test://auth?privy_oauth_code=abc&privy_oauth_state=xyz&evil=1"), "?privy_oauth_code=abc&privy_oauth_state=xyz");
  assert.equal(authReturnSearch("com.penaltykings.test://auth?privy_oauth_code=abc"), null, "state is required");
  assert.equal(authReturnSearch("com.penaltykings.test://other?privy_oauth_code=abc&privy_oauth_state=xyz"), null);
  assert.equal(authReturnSearch("https://example.test/auth?privy_oauth_code=abc&privy_oauth_state=xyz"), null);
  assert.equal(authReturnSearch("not a url"), null);
});
