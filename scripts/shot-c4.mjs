// C4 screenshot + check: the title's "Day N 🔥" badge for a RETURNING player. The SDK sandbox has no storage, so a
// returning player's progress only survives where the host lets the game keep it; this script stages exactly that by
// giving the frame a stand-in localStorage holding a progress record (checked in yesterday, day 3), reloads the real
// sandboxed runtime and screenshots the title. Usage: node scripts/shot-c4.mjs [--out artifacts] [--width 960]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";

installPriceFixture();
const args = process.argv.slice(2);
const width = Number(args[args.indexOf("--width") + 1] || 0) || 960;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "artifacts";
await mkdir(out, { recursive: true });
const day = offset => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const progress = { version: 1, xp: 350, stars: {}, stamps: ["mouse"], pulled: [], matches: 4, tutorialDone: true, difficulty: 3, history: [], daily: { date: "", attempts: 0, best: 0, played: [] }, best: { target: 0, penalties: 900, freekicks: 0 }, rewards: [], directorSeen: "", keepersSeen: ["mouse"], stadiumsSeen: ["park"], login: { lastDay: day(-1), day: 3 }, bestStreak: 4 };

await testGame("./games/penalty-kings", {
  width, timeout: 60_000,
  check: async ({ page, game }) => {
    // Every frame (the sandboxed game included) gets a working in-memory localStorage with the stored progress.
    await page.context().addInitScript(stored => {
      const data = new Map([["penalty-kings/progress/v1", stored]]);
      const storage = { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => void data.set(key, String(value)), removeItem: key => void data.delete(key), clear: () => data.clear(), key: i => [...data.keys()][i] ?? null, get length() { return data.size; } };
      try { Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage }); } catch { /* the host page keeps its own */ }
    }, JSON.stringify(progress));
    await page.reload();
    await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
    await game.getByTestId("play").waitFor();
    const skip = game.getByTestId("skip-intro");
    if (await skip.isVisible()) await skip.click();
    const badge = game.getByTestId("streak-day");
    await badge.waitFor();
    assert.match(await badge.textContent(), /^Day 3/);
    const size = await badge.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= 11, `the Day badge is readable (${size}px)`);
    await page.waitForTimeout(400);
    await page.locator(".rf-game-frame").screenshot({ path: `${out}/c4-title-day.png` });
    // Play → modes: today's check-in moves the run to day 4.
    await game.getByTestId("play").click();
    await game.getByTestId("checkin").waitFor();
    assert.match(await game.getByTestId("checkin").textContent(), /^Day 4 of 7 check-in/);
    assert.match(await game.getByTestId("streak-day").textContent(), /^Day 4/);
    await page.locator(".rf-game-frame").screenshot({ path: `${out}/c4-modes-weekly.png` });
    console.log(`title: Day 3 badge (${size}px); modes: Day 4 after check-in`);
  },
});
console.log(`PASS shot-c4 at ${width}px → ${out}/c4-title-day.png, ${out}/c4-modes-weekly.png`);
