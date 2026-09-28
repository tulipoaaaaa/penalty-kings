// Automated text-overflow / clipping / overlap sweep of every screen (owner bug: on the Modes screen at ~949×634 the
// NEXT GOAL button's text wrapped to 2 lines and the 2nd line hung OUTSIDE the button's border, in the fallback
// monospace font). Plays the real sandboxed runtime (SDK testGame harness, QA hooks __pkFlow/__pkStats) through every
// DOM screen and state, and scans each one with scripts/lib/overflow-scan.mjs (escape, clipped, ellipsis, overlap,
// overlap-text, offscreen, hscroll, small-font, small-tap), at every viewport, with the web fonts loaded AND blocked
// (route-aborted: the fallback monospace is wider), plain and with realistic longest strings forced into the slots the
// game fills from data. Then the public site pages (npm run build:site output, served locally).
//
// States: rotate overlay (portrait), cold open, title (attract), Odds from the pot line, tutorial (coaching toast, HUD,
// pot banner, Quick shot), result banners, discovery toasts, Results (tutorial, Penalties, Free Kicks, World Tour with
// Next level, Daily, Target Practice, challenge, Big Match incl. sudden death when it happens), share panel, Modes
// (challenge box open, bad-code error, the longest NEXT GOAL, the unlock NEXT GOAL), every menu (Scouting Book, Ball
// shop, My Bag, Kit shop + buy confirm, Cups, Rules, Settings + save code, World Tour map + level brief, Skill Cup
// confirm, Daily), pack opening (sealed, cards, a flip, summary, odds strip), ball carousel, shot clock bar and
// "Time up — kick lost", Champions Night (page clock pinned like scripts/test-modes.mjs).
//
// Usage: node scripts/test-overflow.mjs [--viewports 949x634,1280x800] [--fonts normal,fallback] [--jobs 3]
//          [--out artifacts/overflow] [--no-site] [--site-only] [--no-stress] [--no-crops]
// Writes <out>/overflow-report.json and <out>/overflow-report.md (grouped by root cause, ranked) and crops in
// <out>/crops/. Exits 1 when any finding is left (known false positives are listed in IGNORE below, with reasons).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { chromium } from "playwright";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { serveStatic } from "./lib/static-server.mjs";
import { overflowScan, applyStress, restoreStress, markRect, unmark } from "./lib/overflow-scan.mjs";

installPriceFixture();

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const VIEWPORTS = option("--viewports", "1280x800,1024x768,949x634,844x390,800x360,667x375,390x844,360x800,360x640").split(",").map(v => v.split("x").map(Number));
const FONTS = option("--fonts", "normal,fallback").split(",");
const JOBS = Number(option("--jobs", "3"));
const OUT = option("--out", "artifacts/overflow");
const STRESS = !args.includes("--no-stress"), CROPS = !args.includes("--no-crops");
const SITE = !args.includes("--no-site"), GAME = !args.includes("--site-only");
const MIN_FONT = 11, MIN_TAP = 44;
const FRIEND = 7730n;
const NIGHT = Date.UTC(2026, 9, 3, 19, 30); // Saturday 3 Oct 2026, 19:30 UTC (Champions Night, as in test-modes)
await mkdir(`${OUT}/crops`, { recursive: true });

/** Known false positives (selector → why it is not a bug). Keep this short and justified. */
const IGNORE = [
  // The winners ticker is a marquee: its line scrolls through a clipped window on purpose.
  { check: "clipped", selector: ".pk-ticker, [class*=ticker]", why: "marquee window (intentional clip)" },
  // The canvas-sized stage clips the pitch, not text.
  { check: "clipped", selector: "canvas", why: "canvas" },
  // The textarea save code / challenge input scroll natively.
  { check: "*", selector: "#pk-overflow-mark", why: "the checker's own outline" },
];

/** Realistic longest values (game/nextgoal.ts, engine keeper names, big balances, Big Match sudden death). */
const STRESS_TABLE = [
  { selector: "[data-testid=next-goal]", after: "b", text: " Beat Chroma the Chameleon (3 goals in a round) for Scouting Book stamp 9/12 ▸" },
  { selector: "[data-testid=weekly-keeper]", text: "KEEPER OF THE WEEK: Chroma the Chameleon. Score 3 in a round for ×2 XP ▸" },
  { selector: "[data-testid=pot-counter-value]", text: "12,345,678 RF" },
  { selector: ".pk-pot > span:nth-child(2)", text: "🏆 12,345,678 RF" },
  { selector: "[data-testid=rf]", text: "1,000,000" },
  { selector: ".pk-modescreen > h2", text: "Level 44 · 4,399/4,400 XP" },
  { selector: ".pk-hud-left .pk-stat:not(:has([data-testid=rf]))", text: "LV 44 · 4,399/4,400 XP" },
  { selector: "[data-testid=round]", text: "SUDDEN DEATH · kick 17 · 12 in a row" },
  { selector: ".pk-banner strong", text: "Time up — kick lost" },
  { selector: ".pk-banner span", text: "Sudden death over: missed · final score 12 goals from 17 kicks" },
  { selector: "[data-testid=results] .pk-tile b", text: "+99,999" },
  { selector: "[data-testid=challenge-brief]", text: "Friend #336583 scored 99,999 pts in 3 free kicks against Chroma the Chameleon. Beat it!" },
  { selector: ".pk-keepercard strong", text: "Chroma the Chameleon · scouted" },
];

// ── Findings ────────────────────────────────────────────────────────────────
const raw = [], coverage = [], gaps = [], fontNotes = [];
const cropped = new Set();
const slug = text => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * A scanner bound to one browser run. `evaluate(fn, arg)` runs in the scanned document; `origin()` is that document's
 * offset on the page (for crops). Each state is scanned plain and (when STRESS) with the stress table applied.
 */
function scanner({ page, evaluate, origin, viewport, font, surface }) {
  const done = new Set();
  return async function scan(state, { stress = STRESS, once = false } = {}) {
    if (once && done.has(state)) return; done.add(state);
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(120);
    const variants = [[false, state]];
    if (stress) variants.push([true, `${state} [stress]`]);
    for (const [stressed, name] of variants) {
      let result;
      try {
        if (stressed && !(await evaluate(applyStress, STRESS_TABLE))) continue; // nothing to stress here
        result = await evaluate(overflowScan, { minFont: MIN_FONT, minTap: MIN_TAP, tol: 1, ignore: IGNORE });
      } catch (error) { gaps.push({ viewport, font, surface, state: name, error: String(error).split("\n")[0] }); continue; }
      finally { if (stressed) await evaluate(restoreStress).catch(() => {}); }
      coverage.push({ viewport, font, surface, state: name, findings: result.findings.length });
      if (!stressed && state.match(/^(title|modes)$/)) fontNotes.push({ viewport, font, surface, state, fonts: result.fonts });
      for (const finding of result.findings) {
        const entry = { ...finding, state: name, stress: stressed, viewport, font, surface };
        const key = `${finding.check}|${finding.sel}|${viewport}|${font}`;
        if (CROPS && !cropped.has(key)) {
          cropped.add(key);
          try {
            if (stressed) await evaluate(applyStress, STRESS_TABLE);
            await evaluate(markRect, finding.rect);
            const o = await origin(), size = page.viewportSize(), pad = 24;
            const x = Math.max(0, o.x + finding.rect.x - pad), y = Math.max(0, o.y + finding.rect.y - pad);
            const clip = { x, y, width: Math.max(8, Math.min(size.width - x, finding.rect.w + 2 * pad)), height: Math.max(8, Math.min(size.height - y, finding.rect.h + 2 * pad)) };
            const path = `${OUT}/crops/${viewport}-${font}-${slug(finding.check)}-${slug(finding.sel)}-${slug(name)}.png`;
            if (clip.width > 4 && clip.height > 4 && x < size.width && y < size.height) { await page.screenshot({ path, clip }); entry.crop = path; }
          } catch { /* a crop is best-effort */ } finally { await evaluate(unmark).catch(() => {}); if (stressed) await evaluate(restoreStress).catch(() => {}); }
        }
        raw.push(entry);
      }
    }
  };
}

// ── The game (SDK harness) ──────────────────────────────────────────────────
const crc32 = text => { let crc = ~0; for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (~crc >>> 0).toString(16).padStart(8, "0"); };
const editSaveCode = (code, change) => {
  const [prefix, payload] = code.trim().split(".");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const next = Buffer.from(JSON.stringify({ ...value, ...(typeof change === "function" ? change(value) : change) }), "utf8").toString("base64url");
  return `${prefix}.${next}.${crc32(`${FRIEND}:${next}`)}`;
};

async function sweepGame([width, height], font) {
  const viewport = `${width}x${height}`, log = (...line) => console.log(`[${viewport} ${font}]`, ...line);
  const started = Date.now();
  await testGame("./games/penalty-kings", {
    width, height, timeout: 20_000,
    check: async ({ page, game }) => {
      // The sandboxed game document (re-found each time: a reload replaces it).
      const gameFrame = async () => (await page.locator("iframe").elementHandle()).contentFrame();
      const evaluate = async (fn, arg) => (await gameFrame()).evaluate(fn, arg);
      const origin = () => page.locator("iframe").evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left + node.clientLeft, y: r.top + node.clientTop }; });
      const scan = scanner({ page, evaluate, origin, viewport, font, surface: "game" });
      const step = async (name, fn) => { try { await fn(); } catch (error) { gaps.push({ viewport, font, surface: "game", state: name, error: String(error.message ?? error).split("\n")[0].slice(0, 200) }); log(`GAP ${name}: ${String(error.message ?? error).split("\n")[0].slice(0, 160)}`); await recover().catch(() => {}); } };
      const visible = locator => locator.isVisible().catch(() => false);
      const flow = () => evaluate(() => window.__pkFlow?.() ?? null);
      const waitShootable = (ms = 15000) => evaluate(ms => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > ms ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }), ms);
      const modes = game.locator(".pk-modescreen");
      const hostHscroll = async state => { const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (over > 1) raw.push({ check: "hscroll", sel: "host page html", text: "", detail: `host page scrolls sideways by ${over}px`, rect: { x: 0, y: 0, w: width, h: 10 }, state, stress: false, viewport, font, surface: "host" }); };

      /** Back to the Modes screen from anywhere. */
      async function recover() {
        for (let i = 0; i < 8; i++) {
          if (await visible(modes)) return;
          const confirm = page.getByRole("button", { name: "Confirm preview", exact: true });
          if (await visible(confirm)) { await confirm.click(); continue; }
          if (await visible(game.getByTestId("to-bag"))) { await game.getByTestId("to-bag").click(); continue; }
          if (await visible(game.getByTestId("reveal-all"))) { await game.getByTestId("reveal-all").click(); continue; }
          if (await visible(game.getByTestId("results"))) { await game.getByTestId("results").getByRole("button", { name: "Modes", exact: true }).click(); continue; }
          const close = game.getByRole("button", { name: /^Close/ }).first();
          if (await visible(close)) { await close.click(); continue; }
          if (await visible(game.getByTestId("play"))) { await game.getByTestId("play").click(); continue; }
          if (await visible(game.getByTestId("menu"))) { await game.getByTestId("menu").click(); await game.getByRole("button", { name: "Change mode", exact: true }).click(); continue; }
          if (await visible(game.getByTestId("portrait-anyway"))) { await game.getByTestId("portrait-anyway").click(); continue; }
          await page.waitForTimeout(500);
        }
        await modes.waitFor({ timeout: 3000 });
      }
      /** One kick (Quick shot), scanning each new result banner and discovery toast once. */
      const banners = new Set();
      async function kick({ aimWide = false } = {}) {
        await waitShootable();
        if (aimWide) { await page.keyboard.down("ArrowRight"); await page.waitForTimeout(900); await page.keyboard.up("ArrowRight"); }
        await game.getByTestId("quick").click();
        const banner = game.locator(".pk-banner");
        await banner.waitFor({ timeout: 10_000 });
        const text = (await game.locator(".pk-banner strong").textContent().catch(() => "")) ?? "";
        const sub = (await game.locator(".pk-banner span").textContent().catch(() => "")) ?? "";
        const kind = /sudden death/i.test(sub) ? "sudden-death" : text;
        if (!banners.has(kind)) { banners.add(kind); await scan(`banner: ${text}${kind === "sudden-death" ? " (sudden death)" : ""}`); }
        if (await visible(game.getByTestId("discover-toast"))) await scan("discovery toast", { once: true });
        await banner.waitFor({ state: "detached", timeout: 15_000 });
        return text;
      }
      /** Kick until Results (up to `max` kicks). */
      async function playOut(max = 30, options) {
        for (let i = 0; i < max; i++) {
          if (await visible(game.getByTestId("results"))) break;
          await kick(options);
          const over = await evaluate(() => new Promise(resolve => { const start = Date.now(); const poll = () => { const f = window.__pkFlow?.(); if (document.querySelector("[data-testid=results]")) resolve(true); else if (f?.shootable) resolve(false); else if (Date.now() - start > 12000) resolve(false); else setTimeout(poll, 50); }; poll(); }));
          if (over) break;
        }
        await game.getByTestId("results").waitFor({ timeout: 10_000 });
        await game.locator('[data-testid="results"][data-final]').waitFor({ timeout: 8000 }).catch(() => {});
      }
      const openFromModes = async name => { await recover(); await modes.getByRole("button", { name, exact: true }).click(); };
      const restore = async change => {
        await openFromModes("Settings");
        const code = await game.getByTestId("save-code-out").inputValue();
        await game.getByTestId("save-code-in").fill(editSaveCode(code, change));
        await game.getByTestId("save-code-restore").click();
        await game.getByTestId("save-code-note").filter({ hasText: /restored/ }).waitFor();
        await game.getByRole("button", { name: "Close Settings" }).click();
        await modes.waitFor();
      };

      // Fonts blocked: abort every web-font request and reload (the harness's wallet fixture survives a reload).
      if (font === "fallback") {
        await page.route(/\.woff2(\?|$)/, route => route.abort());
        await page.reload();
        await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
        await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
        await page.locator("iframe").waitFor();
        await game.locator("#root > *").first().waitFor();
        await game.getByText("Waiting for your Friend…", { exact: true }).waitFor({ state: "hidden" });
        await page.locator(".rf-runtime-status").waitFor({ state: "hidden" });
      }

      // Rotate overlay (portrait), cold open, title, Odds from the pot line.
      await step("rotate / cold open / title", async () => {
        await game.getByTestId("rotate").waitFor({ state: "attached", timeout: 10_000 });
        if (await visible(game.getByTestId("portrait-anyway"))) { await scan("rotate overlay"); await game.getByTestId("portrait-anyway").click(); await game.getByTestId("rotate").waitFor({ state: "hidden" }); }
        if (await visible(game.getByTestId("skip-intro"))) { await scan("cold open"); await game.getByTestId("skip-intro").click(); }
        await game.getByTestId("play").waitFor();
        await scan("title"); await hostHscroll("title");
        await game.getByTestId("pot-counter").click();
        await game.getByRole("heading", { name: "Odds", exact: true }).waitFor({ timeout: 3000 });
        await scan("menu: Odds");
        await game.getByRole("button", { name: "Close Odds" }).click();
      });
      // Tutorial: coaching toast + HUD + pot banner + Quick shot; banners; Results; share panel.
      await step("tutorial", async () => {
        await game.getByTestId("play").click();
        await waitShootable();
        await scan("tutorial aim (coaching toast, HUD, pot banner, Quick shot)");
        await playOut(3);
        await scan("results: tutorial");
        await game.getByTestId("share-card").click();
        await game.getByTestId("share-image").waitFor();
        await scan("share panel");
        await game.getByTestId("results").getByRole("button", { name: "Modes", exact: true }).click();
      });
      await step("modes", async () => {
        await recover();
        await scan("modes");
        await modes.getByTestId("challenge-box").locator("summary").click();
        await scan("modes: challenge box open");
        await game.getByTestId("challenge-in").fill("pkc1.f.zz.not-a-real-code.00000000");
        await game.getByTestId("challenge-play").click();
        await game.getByTestId("challenge-error").waitFor();
        await scan("modes: challenge code error");
        await game.getByTestId("challenge-in").fill("");
        await modes.getByTestId("challenge-box").locator("summary").click();
      });
      for (const name of ["Scouting Book", "Ball shop", "My Bag", "Kit shop", "Cups", "Rules", "Settings"]) {
        await step(`menu ${name}`, async () => {
          await openFromModes(name);
          await game.getByRole("button", { name: `Close ${name}` }).waitFor();
          await scan(`menu: ${name}`);
          if (name === "Kit shop") {
            await game.locator(".pk-shopgroup button").filter({ hasText: "try on" }).first().click();
            await game.getByTestId("kit-buy").click();
            await game.getByTestId("kit-confirm").waitFor();
            await scan("menu: Kit shop buy confirm");
            await game.getByTestId("kit-confirm").getByRole("button", { name: "Cancel" }).click();
          }
          await game.getByRole("button", { name: `Close ${name}` }).click();
        });
      }
      await step("cups confirms", async () => {
        await openFromModes("Cups");
        await game.getByTestId("skill-enter").click();
        await game.getByTestId("skill-confirm").waitFor();
        await scan("menu: Cups, Skill Cup entry confirm");
        await game.getByTestId("skill-confirm").getByRole("button", { name: "Cancel" }).click();
        await game.getByTestId("wildcard").click();
        await game.getByTestId("wildcard-confirm").waitFor();
        await scan("menu: Cups, Wildcard confirm");
        await game.getByTestId("wildcard-confirm").getByRole("button", { name: "Cancel" }).click();
        await game.getByRole("button", { name: "Close Cups" }).click();
      });
      await step("penalties", async () => {
        await recover(); await game.getByTestId("mode-penalties").click();
        await waitShootable(); await scan("HUD: penalties");
        await playOut(6); await scan("results: penalties");
      });
      await step("free kicks + challenge", async () => {
        await recover(); await game.getByTestId("mode-freekicks").click();
        await waitShootable(); await scan("HUD: free kicks (wind)");
        await playOut(4); await scan("results: free kicks");
        await game.getByTestId("share-card").click();
        const code = await game.getByTestId("challenge-code").inputValue();
        await scan("share panel: challenge code");
        await recover();
        await modes.getByTestId("challenge-box").locator("summary").click();
        await game.getByTestId("challenge-in").fill(code);
        await game.getByTestId("challenge-brief").waitFor();
        await scan("modes: challenge brief");
        await game.getByTestId("challenge-play").click();
        await waitShootable(); await scan("HUD: challenge");
        await playOut(4); await scan("results: challenge");
      });
      await step("world tour", async () => {
        await recover(); await game.getByTestId("mode-tour").click();
        await game.getByTestId("level-park-1").waitFor(); await scan("menu: World Tour map");
        await game.getByTestId("level-park-1").click();
        await game.getByRole("button", { name: "Kick off", exact: true }).waitFor(); await scan("menu: World Tour level brief");
        await game.getByRole("button", { name: "Kick off", exact: true }).click();
        await playOut(6); await scan("results: World Tour (Next level)");
        if (await visible(game.getByTestId("next-level"))) { await game.getByTestId("next-level").click(); await game.getByRole("button", { name: "Back", exact: true }).waitFor(); await scan("menu: World Tour next level brief"); }
      });
      await step("daily", async () => {
        await recover(); await game.getByTestId("mode-daily").click();
        await game.getByText("Attempts left:").waitFor(); await scan("menu: Daily");
        await game.getByRole("button", { name: "Play today's challenge", exact: true }).click();
        await waitShootable(); await playOut(6); await scan("results: Daily");
      });
      await step("target", async () => {
        await recover(); await game.getByTestId("mode-target").click();
        await waitShootable(); await scan("HUD: Target Practice");
        await kick();
        // The 60 s clock: wait it out (it pauses while a shot plays).
        await game.getByTestId("results").waitFor({ timeout: 75_000 });
        await game.locator('[data-testid="results"][data-final]').waitFor({ timeout: 8000 }).catch(() => {});
        await scan("results: Target Practice");
      });
      await step("packs + Big Match", async () => {
        await recover(); await game.getByTestId("ball-shop").click();
        await game.getByTestId("pack-2").click(); await game.getByTestId("buy-pack").click();
        await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
        await game.getByTestId("open-pack").waitFor();
        await scan("menu: Ball shop (unopened balls)");
        await evaluate(() => { window.__pkDevRandomnessDelayMs = 2500; });
        await game.getByTestId("open-pack").click();
        await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
        if (await game.getByTestId("pack-sealed").waitFor({ timeout: 3000 }).then(() => true, () => false)) await scan("pack: sealed");
        await evaluate(() => { window.__pkDevRandomnessDelayMs = 0; });
        await game.getByTestId("pack").waitFor({ timeout: 10_000 });
        await scan("pack: cards face down + odds strip");
        const back = game.locator('.pk-card[data-revealed="false"]').first();
        if (await visible(back)) { await back.click(); await scan("pack: one card flipped"); }
        if (await visible(game.getByTestId("reveal-all"))) await game.getByTestId("reveal-all").click();
        await game.getByTestId("pack-summary").waitFor({ timeout: 10_000 });
        await scan("pack: summary");
        await game.getByTestId("to-bag").click();
        await game.getByTestId("shoot-ball").first().waitFor();
        await scan("menu: My Bag (balls)");
        await game.getByTestId("shoot-ball").first().click();
        await waitShootable(); await scan("HUD: Big Match");
        await kick();
        await waitShootable();
        await game.getByTestId("change-ball").click();
        await game.getByTestId("carousel").waitFor({ timeout: 5000 });
        await scan("ball carousel");
        await game.getByTestId("kick-with-ball").click();
        await playOut(30); await scan("results: Big Match");
      });
      // Content stress through a real save code: the longest NEXT GOAL (8 stamps: "Beat Chroma the Chameleon …
      // stamp 9/12"), XP 99,999, bests 99,999, a 999 streak, shot clock on (matches ≥ 4); then the unlock goal.
      await step("stress: longest NEXT GOAL", async () => {
        await recover();
        const today = new Date().toISOString().slice(0, 10);
        await restore(value => ({ xp: 99_999, stamps: ["mouse", "squirrel", "sloth", "peacock", "octopus", "mime", "disco", "sumo"], keepersSeen: ["chameleon", "robot", "ghost", "finalwall"], daily: { ...value.daily, date: value.daily.date || today, attempts: 3, best: 99_999 }, best: { target: 99_999, penalties: 99_999, freekicks: 99_999 }, bestStreak: 999, matches: 50, tutorialDone: true }));
        const goal = await modes.getByTestId("next-goal").innerText();
        assert.match(goal, /Chroma the Chameleon .* stamp 9\/12/, `the longest NEXT GOAL is shown (${goal})`);
        await scan("modes: longest NEXT GOAL (real save code)", { stress: false });
        await openFromModes("Scouting Book"); await scan("menu: Scouting Book (8 stamps, 999 streak)", { stress: false }); await game.getByRole("button", { name: "Close Scouting Book" }).click();
        await openFromModes("Settings"); await scan("menu: Settings (XP 99,999)", { stress: false }); await game.getByRole("button", { name: "Close Settings" }).click();
        await recover(); await game.getByTestId("mode-daily").click(); await game.getByText("Attempts left:").waitFor(); await scan("menu: Daily (no attempts left)", { stress: false });
      });
      await step("shot clock + time up", async () => {
        await recover(); await game.getByTestId("mode-penalties").click();
        await waitShootable();
        await game.getByTestId("shot-clock").waitFor({ state: "visible", timeout: 5000 });
        await scan("HUD: shot clock bar");
        await game.locator(".pk-banner strong").filter({ hasText: "Time up — kick lost" }).waitFor({ timeout: 10_000 });
        await scan("banner: Time up — kick lost");
      });
      await step("stress: unlock NEXT GOAL", async () => {
        await restore({ xp: 0, tutorialDone: true, stamps: [] });
        await scan("modes: unlock NEXT GOAL (real save code)", { stress: false });
      });
      // Champions Night: the page clock pinned inside the Saturday window, then reload (like test-modes).
      await step("champions night", async () => {
        await page.clock.install({ time: NIGHT });
        await page.reload();
        await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
        await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
        await game.locator("#root > *").first().waitFor();
        await game.getByText("Waiting for your Friend…", { exact: true }).waitFor({ state: "hidden" });
        await game.getByTestId("rotate").waitFor({ state: "attached", timeout: 10_000 });
        if (await visible(game.getByTestId("portrait-anyway"))) await game.getByTestId("portrait-anyway").click();
        if (await visible(game.getByTestId("skip-intro"))) await game.getByTestId("skip-intro").click();
        await game.locator('[data-testid="champions-night"][data-active="true"]').waitFor({ timeout: 5000 });
        await scan("Champions Night: title");
        await game.getByTestId("play").click();
        await waitShootable(); await scan("Champions Night: HUD (night tag)");
        await playOut(3); await scan("Champions Night: results");
        await game.getByTestId("results").getByRole("button", { name: "Modes", exact: true }).click();
        await modes.waitFor(); await scan("Champions Night: modes");
      });
    },
  }).catch(error => { gaps.push({ viewport, font, surface: "game", state: "harness", error: String(error.message ?? error).split("\n")[0].slice(0, 300) }); console.log(`[${viewport} ${font}] HARNESS ${String(error.message ?? error).split("\n").slice(0, 3).join(" | ")}`); });
  log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

// ── The public site (npm run build:site output) ─────────────────────────────
async function sweepSite() {
  if (!existsSync("site/index.html")) { gaps.push({ surface: "site", state: "all", error: "site/ missing: run npm run build:site first" }); return; }
  const server = await serveStatic("site");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of VIEWPORTS) for (const font of FONTS) {
      const viewport = `${width}x${height}`;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 500, reducedMotion: "reduce" });
      if (font === "fallback") await context.route(/\.woff2(\?|$)/, route => route.abort());
      const page = await context.newPage();
      const evaluate = (fn, arg) => page.evaluate(fn, arg);
      const scan = scanner({ page, evaluate, origin: async () => ({ x: 0, y: 0 }), viewport, font, surface: "site" });
      const pages = [["landing", ""], ["stadium page: Pro", "pro/"], ["stadium page: Champions", "champions/"]];
      for (const [name, path] of pages) {
        try {
          await page.goto(`${server.url}${path}`, { waitUntil: "load" });
          await page.waitForTimeout(800);
          await scan(`site: ${name}`, { stress: false });
        } catch (error) { gaps.push({ viewport, font, surface: "site", state: name, error: String(error).split("\n")[0] }); }
      }
      try {
        await page.goto(`${server.url}practice/`, { waitUntil: "load" });
        await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
        await scan("site: practice", { stress: false });
        const canvas = await page.locator("#pp-canvas").boundingBox();
        const scale = Math.min(canvas.width / 480, canvas.height / 320);
        const at = (x, y) => ({ x: canvas.x + (canvas.width - 480 * scale) / 2 + x * scale, y: canvas.y + (canvas.height - 320 * scale) / 2 + y * scale });
        for (let kick = 0; kick < 5; kick++) {
          await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
          const start = at(240, 252), dx = [0.5, -0.45, 0.2, -0.6, 0.35][kick];
          await page.mouse.move(start.x, start.y); await page.mouse.down();
          for (let i = 1; i <= 9; i++) { await page.mouse.move(start.x + i * dx * 12 * scale, start.y - i * 11 * scale); await page.waitForTimeout(18); }
          await page.mouse.up();
          await page.waitForFunction(n => window.__pkPractice?.().kicks.length === n, kick + 1, { timeout: 20_000 });
        }
        await page.getByTestId("practice-end").waitFor({ state: "visible", timeout: 15_000 });
        await scan("site: practice end card", { stress: false });
        await page.getByTestId("practice-share-btn").click();
        await page.getByTestId("practice-share-img").waitFor({ state: "visible", timeout: 10_000 });
        await scan("site: practice share card", { stress: false });
      } catch (error) { gaps.push({ viewport, font, surface: "site", state: "practice", error: String(error).split("\n")[0] }); }
      await context.close();
      console.log(`[site ${viewport} ${font}] done`);
    }
  } finally { await browser.close(); await server.close(); }
}

// ── Run ─────────────────────────────────────────────────────────────────────
const t0 = Date.now();
if (GAME) {
  const queue = VIEWPORTS.flatMap(v => FONTS.map(f => [v, f]));
  await Promise.all(Array.from({ length: Math.max(1, JOBS) }, async () => { while (queue.length) { const [v, f] = queue.shift(); await sweepGame(v, f); } }));
}
if (SITE) await sweepSite();
const seconds = (Date.now() - t0) / 1000;

// ── Report: one row per check + selector (root cause), ranked by visibility to a judge ─────────────
const CHECK_WEIGHT = { escape: 10, offscreen: 9, clipped: 8, overlap: 7, "overlap-text": 6, hscroll: 5, ellipsis: 3, "small-font": 2, "small-tap": 2 };
const stateWeight = state => (/^(title|cold open|modes|tutorial|HUD|banner|results|Champions Night|rotate|site: (landing|practice))/.test(state) ? 3 : /^(menu|pack|share|ball carousel|discovery)/.test(state) ? 2 : 1);
const groups = new Map();
for (const f of raw) {
  const key = `${f.surface}|${f.check}|${f.sel}`;
  const g = groups.get(key) ?? { surface: f.surface, check: f.check, sel: f.sel, samples: [], viewports: new Set(), fonts: new Set(), states: new Set(), plain: false, stressOnly: true, crops: [], worst: null, text: f.text, detail: f.detail };
  g.viewports.add(f.viewport); g.fonts.add(f.font); g.states.add(f.state.replace(/ \[stress\]$/, "") + (f.stress ? " [stress]" : ""));
  if (!f.stress) g.stressOnly = false;
  const size = f.num ? Math.max(f.num.dx ?? 0, f.num.dy ?? 0, f.num.w ?? 0, f.num.h ?? 0) : 0;
  if (!g.worst || size > g.worst.size) g.worst = { size, detail: f.detail, viewport: f.viewport, font: f.font, state: f.state, text: f.text, full: f.full };
  if (f.crop && g.crops.length < 4 && !g.crops.some(c => c.includes(`/${f.viewport}-`))) g.crops.push(f.crop);
  if (g.samples.length < 6) g.samples.push({ viewport: f.viewport, font: f.font, state: f.state, detail: f.detail, text: f.text, num: f.num });
  (g.hits ??= []).push(`${f.viewport} ${f.font} ${f.state}`);
  groups.set(key, g);
}
const rows = [...groups.values()].map(g => ({
  ...g, viewports: [...g.viewports], fonts: [...g.fonts], states: [...g.states],
  score: Math.round((CHECK_WEIGHT[g.check] ?? 1) * Math.max(...[...g.states].map(stateWeight)) * g.viewports.size * (g.fonts.size === 2 ? 1.5 : g.fonts.has("normal") ? 1.2 : 1) * (g.stressOnly ? 0.5 : 1)),
})).sort((a, b) => b.score - a.score);
const counts = Object.fromEntries(Object.keys(CHECK_WEIGHT).map(check => [check, rows.filter(r => r.check === check).length]));
const report = { commitNote: "see git log", seconds, viewports: VIEWPORTS.map(v => v.join("x")), fonts: FONTS, states: new Set(coverage.map(c => c.state)).size, scans: coverage.length, rawFindings: raw.length, rootCauses: rows.length, counts, gaps, fontNotes: fontNotes.slice(0, 40), rows, coverage };
await writeFile(`${OUT}/overflow-report.json`, JSON.stringify(report, null, 2));
const md = [
  `# Overflow sweep`, ``,
  `${coverage.length} scans of ${report.states} states × ${VIEWPORTS.length} viewports × fonts ${FONTS.join("/")} in ${(seconds / 60).toFixed(1)} min. ${raw.length} raw findings → **${rows.length} root causes** (${Object.entries(counts).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(", ")}).`, ``,
  `| # | score | check | selector (root cause) | viewports | fonts | states | worst | crop |`, `|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r, i) => `| ${i + 1} | ${r.score} | ${r.check} | \`${r.sel}\` (${r.surface}) | ${r.viewports.join(" ")} | ${r.fonts.join("/")} | ${r.states.slice(0, 4).join("; ")}${r.states.length > 4 ? ` +${r.states.length - 4}` : ""} | ${r.worst.detail.replace(/\|/g, "/").slice(0, 220)} — "${(r.worst.text ?? "").replace(/\|/g, "/").slice(0, 80)}" | ${r.crops.slice(0, 2).join(" ")} |`),
  ``, `## Coverage gaps`, ...(gaps.length ? gaps.map(g => `- ${g.viewport ?? ""} ${g.font ?? ""} ${g.surface} ${g.state}: ${g.error}`) : ["- none"]),
].join("\n");
await writeFile(`${OUT}/overflow-report.md`, md);
console.log(`\n${rows.length} root causes (${raw.length} raw findings) in ${(seconds / 60).toFixed(1)} min; ${gaps.length} coverage gaps. Report: ${OUT}/overflow-report.md`);
for (const r of rows.slice(0, 25)) console.log(`  ${String(r.score).padStart(5)} ${r.check.padEnd(12)} ${r.sel}  [${r.viewports.join(" ")}] ${r.fonts.join("/")}  ${r.worst.detail.slice(0, 120)}`);
process.exitCode = rows.length ? 1 : 0;
