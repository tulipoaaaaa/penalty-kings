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
//          [--wait-ms 45000] [--steps <regex>] [--cpu-throttle 4] [--allow-gaps]
// Writes <out>/overflow-report.json and <out>/overflow-report.md (grouped by root cause, ranked) and crops in
// <out>/crops/. Exits 1 when any finding is left (known false positives are listed in IGNORE below, with reasons)
// AND when any coverage gap is left: every state must be scanned at every requested viewport × font, and a state that
// cannot be reached fails the run (naming the state, viewport and font) instead of being skipped.
//
// Determinism: the sweep waits on the game's state (the QA hook __pkFlow() and the DOM), never on elapsed time. The
// Stage runs on game time (its frame step is capped at 50 ms, so a loaded CPU slows every kick down in wall time), so
// every wait is a state transition with a generous bound (--wait-ms) that fails loudly. States the game shows on its
// own timers (the sealed pack, the face-down cards, a card flip, result banners, "Time up") are captured in-page at the
// DOM commit that shows them (a MutationObserver armed before the action), so no roundtrip latency can miss them.
//   --allow-gaps     local exploratory runs only (CI must not use it): report coverage gaps but exit 0 for them.
//   --steps <regex>  local only: run just the matching game steps (the others are not requested, so not gaps).
//   --cpu-throttle N local only: CDP Emulation.setCPUThrottlingRate on the game page, to rehearse a loaded machine.
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
const STEPS = option("--steps", null) ? new RegExp(option("--steps", null), "i") : null;
const CPU_THROTTLE = Number(option("--cpu-throttle", "1"));
const ALLOW_GAPS = args.includes("--allow-gaps");
/** The bound on every state wait (a last resort: it fails the run, naming the state). */
const WAIT_MS = Number(option("--wait-ms", "45000"));
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
  // FriendSDK host chrome on the site pages (the "Choose Friend" toolbar and the runtime's "Check for wallet" panel):
  // 36 px buttons rendered and styled by @rarefriends/friendsdk, not by this game; out of scope for our CSS.
  { check: "small-tap", selector: ".rf-frame-toolbar, .rf-runtime-connection", why: "FriendSDK chrome (the SDK's own 36 px buttons)" },
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
/** Per run (viewport × font): the steps it was asked for and the ones that finished (a step left unfinished is a gap). */
const runs = [];
const cropped = new Set();
const slug = text => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
/** The first lines of an error (Playwright call logs included, colours stripped). */
const firstLines = (error, n = 3) => String(error?.message ?? error).split("\n").map(line => line.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean).slice(0, n).join(" | ").slice(0, 400);
const SCAN_OPTIONS = { minFont: MIN_FONT, minTap: MIN_TAP, tol: 1, ignore: IGNORE };

/** Settled: two frames, then every finite running animation / transition finished (an endless one is not waited on). */
const settleIn = evaluate => evaluate(async limit => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  await frame(); await frame();
  const finite = document.getAnimations().filter(a => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming?.().endTime ?? Infinity));
  if (finite.length) await Promise.race([Promise.all(finite.map(a => a.finished.catch(() => {}))), new Promise(resolve => setTimeout(resolve, limit))]);
  await frame();
}, 5000);

/**
 * In-page capture runtime (serialised into the game document, installed once per document). `__ovArm(key, pred, opts,
 * then)` watches the DOM with a MutationObserver from NOW; at the first commit where `pred(__pkFlow(), document)` is
 * truthy it scans synchronously (plain, stressed, with an injected discovery toast), then runs `then(hit)` (e.g. flips
 * a card, so the next state is caught at its own commit too). Nothing can run between the state appearing and its scan
 * (no timer, no frame), so the game's own timers can never outrun the sweep, however loaded the machine is.
 * `__ovTake(key, ms)` resolves with the capture, or rejects after `ms` with the flow state.
 */
function captureRuntime(overflowScan, applyStress, restoreStress) {
  const captures = new Map();
  const flowNow = () => { try { const { timing, ...rest } = window.__pkFlow?.() ?? {}; return rest; } catch { return null; } };
  const scanAll = (opts, hit) => {
    const out = { hit, plain: overflowScan(opts.scan) };
    if (opts.stress && applyStress(opts.table)) { try { out.stress = overflowScan(opts.scan); } finally { restoreStress(); } }
    if (opts.discover) {
      const stage = document.querySelector(".pk-stage");
      if (stage && !stage.querySelector(".pk-discover")) {
        const toast = Object.assign(document.createElement("p"), { className: "pk-discover", textContent: opts.discover });
        toast.dataset.testid = "discover-toast"; toast.style.animation = "none"; stage.append(toast);
        try { out.discover = overflowScan(opts.scan); } finally { toast.remove(); }
      } else if (stage) out.discover = out.plain; // a real toast is already up: the plain scan covered it
    }
    return out;
  };
  window.__ovArm = (key, pred, opts, then) => {
    let settle;
    const entry = { done: false, promise: new Promise((resolve, reject) => { settle = { resolve, reject }; }) };
    entry.promise.catch(() => {});
    captures.set(key, entry);
    const check = () => {
      if (entry.done) return;
      let hit; try { hit = pred(window.__pkFlow?.() ?? null, document); } catch { hit = null; }
      if (!hit) return;
      entry.done = true; observer.disconnect();
      try { const out = hit.scan === false ? { hit } : scanAll(opts, hit); if (then) then(hit); settle.resolve(out); }
      catch (error) { settle.reject(new Error(`capture failed: ${error?.message ?? error}`)); }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    check();
  };
  window.__ovTake = (key, ms) => {
    const entry = captures.get(key);
    if (!entry) return Promise.reject(new Error(`capture "${key}" was never armed in this document`));
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`flow: ${JSON.stringify(flowNow()).slice(0, 300)}`)), ms); });
    return Promise.race([entry.promise, timeout]).finally(() => { clearTimeout(timer); captures.delete(key); });
  };
}
const CAPTURE_LIB = `(() => { if (window.__ovArm) return; (${captureRuntime})(${overflowScan}, ${applyStress}, ${restoreStress}); })()`;

/** In-page: resolve with `pred(__pkFlow(), document)` once truthy (polled), reject after `ms` with the flow state. */
const UNTIL = `(pred, ms) => new Promise((resolve, reject) => {
  const start = performance.now();
  const flowNow = () => { try { const { timing, ...rest } = window.__pkFlow?.() ?? {}; return rest; } catch { return null; } };
  const poll = () => { let hit; try { hit = pred(window.__pkFlow?.() ?? null, document); } catch { hit = null; }
    if (hit) resolve(hit); else if (performance.now() - start > ms) reject(new Error("flow: " + JSON.stringify(flowNow()).slice(0, 300))); else setTimeout(poll, 40); };
  poll();
})`;

/**
 * A scanner bound to one browser run. `evaluate(fn, arg)` runs in the scanned document; `origin()` is that document's
 * offset on the page (for crops). Each state is scanned plain and (when STRESS) with the stress table applied.
 * `optional` marks a state the game shows only on some runs (which result banner, a real discovery toast, sudden
 * death): reported when seen, never a gap. Every other state must be scanned at every viewport × font.
 */
function scanner({ page, evaluate, origin, viewport, font, surface }) {
  const done = new Set();
  async function record(name, stressed, result, { optional = false, crop = true } = {}) {
    coverage.push({ viewport, font, surface, state: name, optional, findings: result.findings.length });
    if (!stressed && name.match(/^(title|modes)$/)) fontNotes.push({ viewport, font, surface, state: name, fonts: result.fonts });
    for (const finding of result.findings) {
      const entry = { ...finding, state: name, stress: stressed, viewport, font, surface };
      const key = `${finding.check}|${finding.sel}|${viewport}|${font}`;
      if (CROPS && crop && !cropped.has(key)) {
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
  async function scan(state, { stress = STRESS, once = false, optional = false } = {}) {
    if (once && done.has(state)) return; done.add(state);
    await settleIn(evaluate);
    const variants = [[false, state]];
    if (stress) variants.push([true, `${state} [stress]`]);
    for (const [stressed, name] of variants) {
      let result;
      try {
        if (stressed && !(await evaluate(applyStress, STRESS_TABLE))) continue; // nothing to stress here
        result = await evaluate(overflowScan, SCAN_OPTIONS);
      } finally { if (stressed) await evaluate(restoreStress).catch(() => {}); }
      await record(name, stressed, result, { optional });
    }
  }
  /** Record an in-page capture (captureRuntime) as `state`. No crops: by now the state has moved on. */
  scan.capture = async (state, capture, { optional = false, discoverState = null } = {}) => {
    await record(state, false, capture.plain, { optional, crop: false });
    if (capture.stress) await record(`${state} [stress]`, true, capture.stress, { optional, crop: false });
    if (capture.discover && discoverState) await record(discoverState, false, capture.discover, { crop: false }); // required
  };
  return scan;
}

// ── The game (SDK harness) ──────────────────────────────────────────────────
const crc32 = text => { let crc = ~0; for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (~crc >>> 0).toString(16).padStart(8, "0"); };
const editSaveCode = (code, change) => {
  const [prefix, payload] = code.trim().split(".");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const next = Buffer.from(JSON.stringify({ ...value, ...(typeof change === "function" ? change(value) : change) }), "utf8").toString("base64url");
  return `${prefix}.${next}.${crc32(`${FRIEND}:${next}`)}`;
};
const DISCOVER_TEXT = "NEW: Crowd chants your Friend's number!";
const TIME_UP = "Time up — kick lost";

async function sweepGame([width, height], font) {
  const viewport = `${width}x${height}`, log = (...line) => console.log(`[${viewport} ${font}]`, ...line);
  const started = Date.now();
  const run = { viewport, font, requested: [], finished: [] };
  runs.push(run);
  await testGame("./games/penalty-kings", {
    width, height, timeout: 20_000,
    check: async ({ page, game }) => {
      page.setDefaultTimeout(WAIT_MS);
      // The sandboxed game document (re-found each time: a reload replaces it).
      const gameFrame = async () => (await page.locator("iframe").elementHandle()).contentFrame();
      const evaluate = async (fn, arg) => (await gameFrame()).evaluate(fn, arg);
      const origin = () => page.locator("iframe").evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left + node.clientLeft, y: r.top + node.clientTop }; });
      const scan = scanner({ page, evaluate, origin, viewport, font, surface: "game" });
      if (CPU_THROTTLE > 1) { await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE }); log(`CPU throttled ×${CPU_THROTTLE}`); }
      const step = async (name, fn) => {
        if (STEPS && !STEPS.test(name)) return;
        run.requested.push(name);
        const mine = () => coverage.filter(c => c.surface === "game" && c.viewport === viewport && c.font === font && !c.state.endsWith("[stress]")).map(c => c.state);
        const before = mine().length;
        try { await fn(); run.finished.push(name); }
        catch (error) {
          const reached = mine().slice(before), last = reached.at(-1);
          const where = last ? `every state after "${last}" in this step was NOT scanned` : "none of its states was scanned";
          gaps.push({ viewport, font, surface: "game", state: `step: ${name}`, error: `${where}: ${firstLines(error)}` });
          log(`GAP step "${name}": ${where}: ${firstLines(error)}`);
          await recover().catch(() => {});
        }
      };
      const visible = locator => locator.isVisible().catch(() => false);
      /** Wait for a flow/DOM state (`pred(__pkFlow(), document)`, a function or its source); fail naming it after WAIT_MS. */
      const until = async (label, pred, ms = WAIT_MS) => {
        try { return await evaluate(`(${UNTIL})(${pred}, ${ms})`); }
        catch (error) { throw new Error(`timed out after ${ms / 1000} s waiting for ${label} (${firstLines(error, 1)})`); }
      };
      const waitShootable = () => until("the player to be able to shoot (__pkFlow().shootable)", "f => f?.shootable");
      /** Arm an in-page capture (captureRuntime) BEFORE the action that leads to the state. */
      const arm = async (key, pred, { stress = STRESS, discover = null } = {}, then = null) => {
        await evaluate(CAPTURE_LIB);
        await evaluate(`window.__ovArm(${JSON.stringify(key)}, ${pred}, ${JSON.stringify({ scan: SCAN_OPTIONS, table: STRESS_TABLE, stress, discover })}, ${then ?? "null"})`);
      };
      const take = async (key, label, ms = WAIT_MS) => {
        try { return await evaluate(`window.__ovTake(${JSON.stringify(key)}, ${ms})`); }
        catch (error) { throw new Error(`timed out after ${ms / 1000} s waiting for ${label} (${firstLines(error, 1)})`); }
      };
      const modes = game.locator(".pk-modescreen");
      // Discovery toasts depend on which Director moments fire, so a real one may or may not be up in a given state. To
      // cover its placement deterministically, a toast with the longest moment name is also put where the game renders
      // it (a p.pk-discover in .pk-stage) when none is shown, scanned, and removed again.
      const withDiscover = async state => {
        const injected = await evaluate(text => {
          const stage = document.querySelector(".pk-stage");
          if (!stage || stage.querySelector(".pk-discover")) return false;
          const toast = Object.assign(document.createElement("p"), { className: "pk-discover", textContent: text });
          toast.dataset.testid = "discover-toast"; toast.dataset.injected = "true"; toast.style.animation = "none";
          stage.append(toast); return true;
        }, DISCOVER_TEXT);
        try { await scan(`${state} + discovery toast`, { stress: false }); } finally { if (injected) await evaluate(() => document.querySelector(".pk-discover[data-injected]")?.remove()); }
      };
      const hostHscroll = async state => { const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (over > 1) raw.push({ check: "hscroll", sel: "host page html", text: "", detail: `host page scrolls sideways by ${over}px`, rect: { x: 0, y: 0, w: width, h: 10 }, state, stress: false, viewport, font, surface: "host" }); };

      /** Back to the Modes screen from anywhere (polls the screen, bounded by WAIT_MS). */
      async function recover() {
        const deadline = Date.now() + WAIT_MS;
        while (Date.now() < deadline) {
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
          await page.waitForTimeout(200); // poll interval: a kick or a walkout is still playing
        }
        throw new Error(`could not get back to the Modes screen within ${WAIT_MS / 1000} s`);
      }
      /**
       * One kick (Quick shot). Its result banner lives only until the kick is done (game time), so it is captured
       * in-page at the commit that shows it: each new banner kind is scanned once, the first also with a discovery toast.
       */
      const banners = new Set();
      async function kick() {
        await waitShootable();
        const pred = `(f, d) => { const b = d.querySelector(".pk-banner"); if (!b) return null;
          const text = b.querySelector("strong")?.textContent ?? "", sub = b.querySelector("span")?.textContent ?? "";
          const kind = /sudden death/i.test(sub) ? "sudden-death:" + text : text;
          return { text, sub, kind, scan: !${JSON.stringify([...banners])}.includes(kind) }; }`;
        await arm("banner", pred, { discover: banners.size === 0 ? DISCOVER_TEXT : null });
        await game.getByTestId("quick").click();
        const capture = await take("banner", "the result banner after Quick shot");
        const { text, kind } = capture.hit;
        if (!text) throw new Error(`the result banner has no text (${JSON.stringify(capture.hit)})`);
        if (capture.plain) {
          banners.add(kind);
          const state = `banner: ${text}${kind.startsWith("sudden-death:") ? " (sudden death)" : ""}`;
          await scan.capture(state, capture, { optional: true, discoverState: "first result banner + discovery toast" });
        }
        if (await visible(game.getByTestId("discover-toast"))) await scan("discovery toast", { once: true, optional: true });
        await until("the kick to finish (banner gone, nothing in flight)", `(f, d) => f && f.inFlight === 0 && f.phase !== "shooting" && !d.querySelector(".pk-banner")`);
        return text;
      }
      /** Kick until Results (up to `max` kicks); after each kick, wait for Results or the next kick to be ready. */
      async function playOut(max = 30) {
        for (let i = 0; i < max; i++) {
          await kick();
          const next = await until("Results or the next kick to be ready", `(f, d) => d.querySelector("[data-testid=results]") ? "results" : f?.shootable ? "kick" : null`);
          if (next === "results") break;
        }
        await until(`Results within ${max} kicks`, `(f, d) => d.querySelector("[data-testid=results]")`);
        await until("the Results figures to finish counting ([data-final])", `(f, d) => d.querySelector('[data-testid="results"][data-final]')`);
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
      /** The runtime is up again after a reload (the harness's wallet fixture survives it). */
      const reconnect = async () => {
        await page.reload();
        await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
        await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
        await page.locator("iframe").waitFor();
        await game.locator("#root > *").first().waitFor();
        await game.getByText("Waiting for your Friend…", { exact: true }).waitFor({ state: "hidden" });
        await page.locator(".rf-runtime-status").waitFor({ state: "hidden" });
        await game.getByTestId("rotate").waitFor({ state: "attached" });
      };
      // The rotate card is up exactly when the frame is a portrait phone frame (layout.tsx isPortraitFrame).
      const portraitFrame = async () => evaluate(() => { const r = document.querySelector(".pk")?.getBoundingClientRect(); return Boolean(r && r.width > 0 && r.width <= 700 && r.height > r.width * 1.1); });

      // Fonts blocked: abort every web-font request and reload.
      if (font === "fallback") {
        await page.route(/\.woff2(\?|$)/, route => route.abort());
        await reconnect();
      }

      // Rotate overlay (portrait), cold open, title, Odds from the pot line.
      await step("rotate / cold open / title", async () => {
        await game.getByTestId("rotate").waitFor({ state: "attached" });
        if (await portraitFrame()) {
          await game.getByTestId("portrait-anyway").waitFor();
          await scan("rotate overlay (portrait frames)", { optional: true }); // portrait frames only; required there by the waits
          await game.getByTestId("portrait-anyway").click(); await game.getByTestId("rotate").waitFor({ state: "hidden" });
        }
        await game.getByTestId("skip-intro").waitFor(); // the cold open runs until skipped (its montage is 20–30 s)
        await scan("cold open"); await game.getByTestId("skip-intro").click();
        await game.getByTestId("play").waitFor();
        await scan("title"); await hostHscroll("title");
        await game.getByTestId("pot-counter").click();
        await game.getByRole("heading", { name: "Odds", exact: true }).waitFor();
        await scan("menu: Odds");
        await game.getByRole("button", { name: "Close Odds" }).click();
      });
      // Tutorial: coaching toast + HUD + pot banner + Quick shot; banners; Results; share panel.
      await step("tutorial", async () => {
        await game.getByTestId("play").click();
        await waitShootable();
        await scan("tutorial aim (coaching toast, HUD, pot banner, Quick shot)"); await withDiscover("tutorial aim");
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
        await playOut(6); await scan("results: World Tour");
        // "Next level" only when the level was passed (the kicks' results decide it).
        if (await visible(game.getByTestId("next-level"))) { await game.getByTestId("next-level").click(); await game.getByRole("button", { name: "Back", exact: true }).waitFor(); await scan("menu: World Tour next level brief", { optional: true }); }
      });
      await step("daily", async () => {
        await recover(); await game.getByTestId("mode-daily").click();
        await game.getByText("Attempts left:").waitFor(); await scan("menu: Daily");
        await game.getByRole("button", { name: "Play today's challenge", exact: true }).click();
        await playOut(6); await scan("results: Daily");
      });
      await step("target", async () => {
        await recover(); await game.getByTestId("mode-target").click();
        await waitShootable(); await scan("HUD: Target Practice");
        await kick();
        // The 60 s clock: wait it out (it runs through flights and banners; menus and pauses stop it).
        await until("Target Practice Results (the 60 s clock)", `(f, d) => d.querySelector("[data-testid=results]")`, Math.max(WAIT_MS, 60_000) + 60_000);
        await until("the Results figures to finish counting ([data-final])", `(f, d) => d.querySelector('[data-testid="results"][data-final]')`);
        await scan("results: Target Practice");
      });
      await step("packs + Big Match", async () => {
        await recover(); await game.getByTestId("ball-shop").click();
        await game.getByTestId("pack-2").click(); await game.getByTestId("buy-pack").click();
        await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
        await game.getByTestId("open-pack").waitFor();
        await scan("menu: Ball shop (unopened balls)");
        // The pack plays on the game's own timers (sealed while the simulated randomness is on its way, then the tear
        // and the auto flips), so its states are captured in-page at the commits that show them: the sealed pack; the
        // cards all face down (then one is flipped by a click, in the same task); one card up and the rest down (then
        // Reveal all). The dev randomness delay makes the sealed state exist at all (preview only; the judged build has 0).
        await evaluate(() => { window.__pkDevRandomnessDelayMs = 2500; });
        try {
          await arm("pack-sealed", `(f, d) => d.querySelector("[data-testid=pack-sealed]") && f?.pack && { sealed: true }`);
          await arm("pack-down", `(f, d) => { const cards = [...d.querySelectorAll("[data-testid=pack] .pk-card")]; return cards.length > 0 && cards.every(c => c.dataset.revealed === "false") && { cards: cards.length }; }`, {},
            `() => document.querySelector('[data-testid=pack] .pk-card[data-revealed="false"]').click()`);
          await arm("pack-flip", `(f, d) => { const cards = [...d.querySelectorAll("[data-testid=pack] .pk-card")], up = cards.filter(c => c.dataset.revealed === "true").length; return up > 0 && (up < cards.length || cards.length === 1) && { up, cards: cards.length }; }`, {},
            `() => document.querySelector("[data-testid=reveal-all]")?.click()`);
          await game.getByTestId("open-pack").click();
          await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
          await scan.capture("pack: sealed", await take("pack-sealed", "the sealed pack (randomness on its way)"));
          const down = await take("pack-down", "the pack's cards, all face down");
          await scan.capture("pack: cards face down + odds strip", down);
          const flip = await take("pack-flip", "one pack card flipped, the others face down");
          await scan.capture("pack: one card flipped", flip);
          log(`pack: ${down.hit.cards} cards, ${flip.hit.up} flipped when captured`);
        } finally { await evaluate(() => { window.__pkDevRandomnessDelayMs = 0; }).catch(() => {}); }
        await until("the pack summary", `(f, d) => d.querySelector("[data-testid=pack-summary]")`);
        await scan("pack: summary");
        await game.getByTestId("to-bag").click();
        await game.getByTestId("shoot-ball").first().waitFor();
        await scan("menu: My Bag (balls)");
        await game.getByTestId("shoot-ball").first().click();
        await waitShootable(); await scan("HUD: Big Match"); await withDiscover("HUD: Big Match");
        await kick();
        await waitShootable();
        await game.getByTestId("change-ball").click();
        await until("the ball carousel to open (__pkFlow().carousel)", `(f, d) => f?.carousel && d.querySelector("[data-testid=carousel]")`);
        await scan("ball carousel"); await withDiscover("ball carousel");
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
        // Armed before anything else: the clock runs from now, and its banner lives only until the next kick.
        await arm("time-up", `(f, d) => d.querySelector(".pk-banner strong")?.textContent === ${JSON.stringify(TIME_UP)} && { timeUp: true }`);
        await game.getByTestId("shot-clock").waitFor({ state: "visible" });
        await scan("HUD: shot clock bar");
        await scan.capture(`banner: ${TIME_UP}`, await take("time-up", `the "${TIME_UP}" banner (the shot clock running out)`));
      });
      await step("stress: unlock NEXT GOAL", async () => {
        await restore({ xp: 0, tutorialDone: true, stamps: [] });
        await scan("modes: unlock NEXT GOAL (real save code)", { stress: false });
      });
      // Champions Night: the page clock pinned inside the Saturday window, then reload (like test-modes).
      await step("champions night", async () => {
        await page.clock.install({ time: NIGHT });
        await reconnect();
        if (await portraitFrame()) { await game.getByTestId("portrait-anyway").click(); await game.getByTestId("rotate").waitFor({ state: "hidden" }); }
        await game.getByTestId("skip-intro").click();
        await game.locator('[data-testid="champions-night"][data-active="true"]').waitFor();
        await scan("Champions Night: title");
        await game.getByTestId("play").click();
        await waitShootable(); await scan("Champions Night: HUD (night tag)");
        await playOut(3); await scan("Champions Night: results");
        await game.getByTestId("results").getByRole("button", { name: "Modes", exact: true }).click();
        await modes.waitFor(); await scan("Champions Night: modes");
      });
    },
  }).catch(error => { gaps.push({ viewport, font, surface: "game", state: "harness", error: firstLines(error) }); log(`HARNESS ${firstLines(error)}`); });
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
          await page.evaluate(() => document.fonts.ready.then(() => true)); // loaded, or failed (fallback): settled either way
          await scan(`site: ${name}`, { stress: false }); // (scan settles frames and finite animations first)
        } catch (error) { gaps.push({ viewport, font, surface: "site", state: `site: ${name}`, error: firstLines(error) }); }
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
      } catch (error) { gaps.push({ viewport, font, surface: "site", state: "site: practice", error: firstLines(error) }); }
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

// ── Coverage: every required state at every requested viewport × font ────────────────────────────────
// A state scanned (not optional) in any run of a surface is required in every run of that surface; a " [stress]"
// variant is skipped where nothing on the screen takes a stress string, so only its plain scan is required.
{
  const base = state => state.replace(/ \[stress\]$/, "");
  const combos = VIEWPORTS.flatMap(([w, h]) => FONTS.map(font => ({ viewport: `${w}x${h}`, font })));
  for (const surface of [...(GAME ? ["game"] : []), ...(SITE ? ["site"] : [])]) {
    const required = [...new Set(coverage.filter(c => c.surface === surface && !c.optional).map(c => base(c.state)))];
    for (const { viewport, font } of combos) {
      const have = new Set(coverage.filter(c => c.surface === surface && c.viewport === viewport && c.font === font).map(c => base(c.state)));
      const missing = required.filter(state => !have.has(state));
      for (const state of missing) gaps.push({ viewport, font, surface, state, error: "never scanned in this run (see the step gap above for why)" });
    }
  }
  for (const run of runs) for (const name of run.requested) if (!run.finished.includes(name) && !gaps.some(g => g.viewport === run.viewport && g.font === run.font && g.state === `step: ${name}`)) gaps.push({ viewport: run.viewport, font: run.font, surface: "game", state: `step: ${name}`, error: "did not finish (the browser run ended first)" });
}

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
  ``, `## Coverage gaps${gaps.length ? ` (${gaps.length}: the run FAILS${ALLOW_GAPS ? ", except under --allow-gaps" : ""})` : ""}`, ...(gaps.length ? gaps.map(g => `- ${g.surface} ${g.viewport ?? ""} ${g.font ?? ""} "${g.state}": ${g.error}`) : ["- none"]),
].join("\n");
await writeFile(`${OUT}/overflow-report.md`, md);
console.log(`\n${rows.length} root causes (${raw.length} raw findings) in ${(seconds / 60).toFixed(1)} min; ${gaps.length} coverage gaps. Report: ${OUT}/overflow-report.md`);
for (const r of rows.slice(0, 25)) console.log(`  ${String(r.score).padStart(5)} ${r.check.padEnd(12)} ${r.sel}  [${r.viewports.join(" ")}] ${r.fonts.join("/")}  ${r.worst.detail.slice(0, 120)}`);
if (gaps.length) {
  console.log(`\nCOVERAGE GAPS (${gaps.length}): these states were NOT scanned, so the sweep ${ALLOW_GAPS ? "is incomplete (--allow-gaps: exploratory run, not failing on them)" : "FAILS"}:`);
  for (const g of gaps) console.log(`  - ${g.surface} ${g.viewport ?? "all viewports"} font=${g.font ?? "all"} state "${g.state}": ${g.error}`);
}
process.exitCode = rows.length || (gaps.length && !ALLOW_GAPS) ? 1 : 0;
