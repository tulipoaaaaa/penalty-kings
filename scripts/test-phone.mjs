// Phone layouts in the real sandboxed runtime (R6-B7, owner playtest): 360×800 and 390×844 portrait, 800×360 and
// 844×390 landscape. For each size:
//   - the frame fits the screen (no scrolling to reach the game);
//   - portrait: the "Turn your phone sideways" card, then "Play in portrait anyway"; landscape: no card;
//   - the goal and the ball are wholly on screen, uncovered by game UI, and clear of the SDK toolbar;
//   - the tutorial coaching toast (aim phase) is on screen and unclipped, clear of the goal mouth, the ball, the
//     striker, the lower-left pitch quadrant and all of the pitch below the crossbar, and of the pot banner / HUD / actions;
//   - no text under 11 CSS px anywhere in the game UI (a DOM walk in the game frame) on the rotate card, the
//     title, the HUD / pot banner / coaching toast, the results, the pack opening and the ball carousel;
//   - Kick off, Quick shot and Menu (and the pack/carousel buttons) are on screen, tappable (nothing covers them)
//     and not under the SDK toolbar;
//   - a real swipe (touch events on the page, from the ball upwards) produces a kick;
//   - saves artifacts/phone-<w>x<h>.png (or --out docs/screenshots to refresh the docs) (the phone's screen while aiming, after the first kick).
// Also (BQ-P1-9): at 960×640 and 1280×800 the title's Kick off is >= 44 CSS px (cold open and attract card).
// PK_TAP_SURVEY=1 lists every small tap target instead of failing on the first.
// QA-4: at 844x390 (reduced and full motion) the Results tiles and the primary button are both in view.
// Usage: node scripts/test-phone.mjs [--size 360x800 | --desktop-only | --results-only | --review-only] [--out docs/screenshots]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { playInPortraitIfAsked } from "./lib/phone.mjs";

installPriceFixture(); // answers the live RF/USD pool reads with recorded values (the SDK fixture rejects unknown reads)

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const SIZES = (option("--size") ? [option("--size")] : args.includes("--desktop-only") || args.includes("--results-only") || args.includes("--review-only") ? [] : ["360x800", "390x844", "800x360", "844x390"]).map(size => size.split("x").map(Number));
const OUT = option("--out") ?? "artifacts";
const MIN_FONT = 11;
const MIN_TAP = 44; // BQ-P1-10: every tap target (was 32)
// Logical scene geometry (gfx/stadium.ts, penalty camera): goal mouth incl. posts and bar, and the ball on the spot.
const GOAL = { left: 168, right: 312, top: 146, bottom: 212 };
const BALL = { left: 233, right: 247, top: 243, bottom: 257 };
// While aiming, the coaching toast stays off the pitch that matters: the striker (run-up left of the ball), the
// lower-left quadrant (where the toast sat on landscape phones before), and everything from just above the bar down.
const STRIKER = { left: 110, right: 250, top: 190, bottom: 300 };
const LOWER_LEFT = { left: 0, right: 240, top: 160, bottom: 320 };
const PLAY = { left: 0, right: 480, top: GOAL.top - 6, bottom: 320 };
await mkdir(OUT, { recursive: true });
/** BQ-P1-10: every visible interactive element in the game frame (buttons, links, fields; a checkbox counts by its
 *  label, the real hit area), on screen or scrolled out of a menu, is at least MIN_TAP x MIN_TAP CSS px.
 *  PK_TAP_SURVEY=1 lists them instead of failing. */
async function assertTargets(game, where) {
  const small = await game.locator("body").evaluate(min => {
    const bad = [], seen = new Set();
    for (let el of document.querySelectorAll("button, a[href], input, select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])")) {
      if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) el = el.closest("label") ?? el;
      if (seen.has(el) || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.height < min - 0.5 || r.width < min - 0.5) bad.push(`${Math.round(r.width)}x${Math.round(r.height)} <${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
    }
    return { bad, count: seen.size };
  }, MIN_TAP);
  if (process.env.PK_TAP_SURVEY) console.log(`SURVEY ${where} (${small.count} targets):${small.bad.map(line => `\n  ${line}`).join("")}`);
  else assert.deepEqual(small.bad, [], `${where}: tap targets under ${MIN_TAP} CSS px`);
}

/** BQ-X6: on the attract title the pot is the pot line inside the title card; the HUD pot banner is hidden (or clear
 *  of the title), the title card and the Kick off card do not overlap, and the sound toggle covers no title text. */
async function titleClear(game, where) {
  const boxes = await game.locator("body").evaluate(() => Object.fromEntries([".pk-pot", ".pk-attract-top", ".pk-attract-top h1", ".pk-attract-bottom", ".pk-title-sound", "[data-testid=pot-counter]"].map(selector => {
    const node = document.querySelector(selector), range = document.createRange();
    if (node && selector.endsWith(" h1")) range.selectNodeContents(node); // the heading's text, not its full-width box
    const r = node && selector.endsWith(" h1") ? range.getBoundingClientRect() : node?.getBoundingClientRect();
    return [selector, node && node.checkVisibility() && r.width > 0 ? { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom } : null];
  })));
  const hit = (a, b) => a && b && a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
  const top = boxes[".pk-attract-top"], line = boxes["[data-testid=pot-counter]"];
  assert.ok(top && line, `${where}: the title card and its pot line are shown ${JSON.stringify(boxes)}`);
  assert.ok(line.x1 >= top.x1 - 0.5 && line.x2 <= top.x2 + 0.5 && line.y1 >= top.y1 - 0.5 && line.y2 <= top.y2 + 0.5, `${where}: the pot line sits inside the title card ${JSON.stringify(boxes)}`);
  for (const other of [".pk-attract-top", ".pk-attract-bottom", ".pk-title-sound"]) assert.ok(!hit(boxes[".pk-pot"], boxes[other]), `${where}: the pot banner overlaps ${other} ${JSON.stringify(boxes)}`);
  assert.ok(!hit(top, boxes[".pk-attract-bottom"]), `${where}: the title card overlaps the Kick off card ${JSON.stringify(boxes)}`);
  for (const text of [".pk-attract-top h1", "[data-testid=pot-counter]"]) assert.ok(!hit(boxes[".pk-title-sound"], boxes[text]), `${where}: the sound toggle covers ${text} ${JSON.stringify(boxes)}`);
}

/** QA-3: while aiming, the tutorial coaching toast (when shown) never covers the player's Friend (its drawn box, from
 *  the Stage), the ball, the goal mouth or the commentator strip (logical top at canvas[data-commentary-top], 22 px
 *  tall + its rule, up to 260 px wide, centred). Returns whether a toast was up. Rects in the game frame's px. */
async function toastOffFriend(game, where) {
  const toast = game.locator(".pk-toast");
  if (!(await toast.isVisible())) return false;
  const r = await game.locator("body").evaluate(() => {
    const rect = node => { const b = node.getBoundingClientRect(); return { x1: b.left, y1: b.top, x2: b.right, y2: b.bottom }; };
    const canvas = document.querySelector("canvas.pk-canvas"), c = canvas.getBoundingClientRect(), scale = Math.min(c.width / 480, c.height / 320);
    const ox = c.left + (c.width - 480 * scale) / 2, oy = c.top + (c.height - 320 * scale) / 2;
    const toPx = z => ({ x1: ox + z.x1 * scale, y1: oy + z.y1 * scale, x2: ox + z.x2 * scale, y2: oy + z.y2 * scale });
    const top = Number(canvas.dataset.commentaryTop), friend = window.__pkStats().friendRect;
    return { toast: rect(document.querySelector(".pk-toast")), friend: friend && toPx(friend),
      strip: toPx({ x1: 240 - 130, y1: top, x2: 240 + 130, y2: top + 24 }),
      ball: toPx({ x1: 233, y1: 243, x2: 247, y2: 257 }), goal: toPx({ x1: 168, y1: 146, x2: 312, y2: 212 }) };
  });
  const hit = (a, b) => a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
  assert.ok(r.friend, `${where}: the Stage reports the Friend's drawn box`);
  for (const name of ["friend", "strip", "ball", "goal"]) assert.ok(!hit(r.toast, r[name]), `${where}: the coaching toast covers the ${name === "strip" ? "commentator strip" : name} ${JSON.stringify({ toast: r.toast, [name]: r[name] })}`);
  return true;
}

/** Polish: the DOM result banner on a phone. The headline is one line that fits the frame, and neither it nor the
 *  sub line covers the player's Friend (its drawn box, from the Stage). Checked for the banner shown and, by swapping
 *  the text in and restoring it, for the longest headlines ("Time up — kick lost", "OFF THE POST!") and a long sub. */
async function bannerClear(game, where) {
  const banner = game.locator(".pk-banner");
  if (!(await banner.isVisible())) return false;
  const fails = await game.locator("body").evaluate(async () => {
    const node = document.querySelector(".pk-banner"), strong = node?.querySelector("strong"), span = node?.querySelector("span");
    if (!node || !strong) return [];
    const canvas = document.querySelector("canvas.pk-canvas"), c = canvas.getBoundingClientRect(), scale = Math.min(c.width / 480, c.height / 320);
    const ox = c.left + (c.width - 480 * scale) / 2, oy = c.top + (c.height - 320 * scale) / 2;
    const hit = (a, b) => a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
    const textBox = el => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, lines: new Set([...range.getClientRects()].map(q => Math.round(q.top))).size }; };
    const original = [strong.textContent, span?.textContent ?? ""], bad = [];
    const cases = [original, ["Time up — kick lost", "The shot clock ran out. Next kick in a moment."], ["OFF THE POST!", "No goal this time"], ["GOAL!", "+1,200 points · Golden Hour: double points · TOP BIN · knuckleball · 3 in a row"]];
    for (const round of [0, 1]) {
      if (round) await new Promise(resolve => setTimeout(resolve, 350)); // the Friend eases back after the result
      const f = window.__pkStats().friendRect;
      if (!f || !document.contains(node)) break;
      const friend = { x1: ox + f.x1 * scale, y1: oy + f.y1 * scale, x2: ox + f.x2 * scale, y2: oy + f.y2 * scale };
      for (const [head, sub] of cases) {
        strong.textContent = head; if (span) span.textContent = sub;
        const h = textBox(strong), s = span ? textBox(span) : null, label = `"${head}" / "${sub.slice(0, 24)}"`;
        if (h.lines !== 1) bad.push(`${label}: the headline wraps to ${h.lines} lines`);
        if (h.x1 < -0.5 || h.x2 > innerWidth + 0.5) bad.push(`${label}: the headline runs off the frame ${JSON.stringify(h)}`);
        for (const [name, box] of [["headline", h], ["sub line", s]]) if (box && hit(box, friend)) bad.push(`${label}: the ${name} covers the Friend ${JSON.stringify({ box, friend })}`);
        const discover = document.querySelector(".pk-discover"), d = discover?.checkVisibility() && discover.getBoundingClientRect();
        if (d) for (const [name, box] of [["headline", h], ["sub line", s]]) if (box && hit(box, { x1: d.left, y1: d.top, x2: d.right, y2: d.bottom })) bad.push(`${label}: the ${name} is under the discovery toast`);
      }
      strong.textContent = original[0]; if (span) span.textContent = original[1];
    }
    return bad;
  });
  assert.deepEqual(fails, [], `${where}: the result banner`);
  return true;
}

/** Polish: each tutorial kick's coaching toast is one short line (<= 90 characters, at most 3 lines on screen), and
 *  a new kick brings a new line (not the old six-line paragraph). Returns the text, or null when no toast is up. */
async function toastShort(game, where, seen) {
  const toast = game.locator(".pk-toast");
  if (!(await toast.isVisible())) return null;
  const m = await toast.evaluate(node => { const s = getComputedStyle(node), line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
    return { text: node.textContent, lines: Math.round((node.scrollHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / line) }; });
  assert.ok(m.text.length <= 90, `${where}: the coaching toast is ${m.text.length} characters (max 90): "${m.text}"`);
  assert.ok(m.lines <= 3, `${where}: the coaching toast takes ${m.lines} lines (max 3): "${m.text}"`);
  assert.ok(!seen.includes(m.text), `${where}: the coaching toast repeats an earlier kick's line: "${m.text}"`);
  seen.push(m.text);
  return m.text;
}

/** Polish (owner report, 949x634): the NEXT GOAL / Keeper of the Week / Results NEXT GOAL buttons grow with their
 *  text. With the longest realistic goal text swapped in (then restored), in Pixelify and in the fallback monospace,
 *  nothing scrolls inside the button and every line of text lies inside its border. Returns the selectors checked. */
const LONG_TEXT = {
  "[data-testid=next-goal]": "<b>NEXT GOAL</b> Beat Nibbles the Squirrel (3 goals in a round) for Scouting Book stamp 3/12 ▸",
  "[data-testid=weekly-keeper]": "KEEPER OF THE WEEK: Octavia the Octopus Goalkeeper. Score 3 in a round for ×2 XP ▸",
  "[data-testid=results-next-goal]": "<b>NEXT GOAL</b> Beat Nibbles the Squirrel (3 goals in a round) for Scouting Book stamp 3/12 ▸",
};
async function goalFits(game, where, selectors) {
  const result = await game.locator("body").evaluate((_, entries) => {
    const bad = [], seen = [];
    for (const [selector, html] of entries) {
      const node = document.querySelector(selector);
      if (!node || !node.checkVisibility()) continue;
      seen.push(selector);
      const original = node.innerHTML, font = node.style.fontFamily;
      node.innerHTML = html;
      for (const family of ["", "ui-monospace, monospace"]) {
        node.style.fontFamily = family;
        const r = node.getBoundingClientRect(), s = getComputedStyle(node), bl = parseFloat(s.borderLeftWidth), bt = parseFloat(s.borderTopWidth);
        const inner = { x1: r.left + bl - 0.5, y1: r.top + bt - 0.5, x2: r.right - bl + 0.5, y2: r.bottom - bt + 0.5 };
        const range = document.createRange(); range.selectNodeContents(node);
        const out = [...range.getClientRects()].filter(q => q.width > 0 && (q.left < inner.x1 || q.right > inner.x2 || q.top < inner.y1 || q.bottom > inner.y2));
        const label = `${selector} (${family || "game font"})`;
        if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) bad.push(`${label}: its text scrolls inside it ${JSON.stringify({ sh: node.scrollHeight, ch: node.clientHeight, sw: node.scrollWidth, cw: node.clientWidth })}`);
        if (out.length) bad.push(`${label}: a text line lies outside its border ${JSON.stringify({ button: [r.left, r.top, r.right, r.bottom].map(Math.round), line: [out[0].left, out[0].top, out[0].right, out[0].bottom].map(Math.round) })}`);
      }
      node.style.fontFamily = font; node.innerHTML = original;
    }
    return { bad, seen };
  }, selectors.map(selector => [selector, LONG_TEXT[selector]]));
  assert.deepEqual(result.bad, [], `${where}: a NEXT GOAL / Keeper of the Week button overflows`);
  return result.seen;
}

for (const [width, height] of SIZES) {
  const portrait = height > width, label = `${width}x${height}`, errors = [];
  const checked = [];
  await testGame("./games/penalty-kings", {
    width, height, timeout: 60_000,
    check: async ({ page, game }) => {
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", error => errors.push(String(error)));
      const canvas = game.locator("canvas.pk-canvas");
      /** Tap on touch contexts (the harness enables touch below 500px), click otherwise. */
      const press = locator => (width < 500 ? locator.tap() : locator.click());
      const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable: " + JSON.stringify(window.__pkFlow?.()))) : setTimeout(poll, 50)); poll(); }));
      /** Page coordinates of a logical scene point (the canvas letterboxes the 480 × 320 pitch: object-fit contain). */
      const toPage = async (x, y) => {
        const box = await canvas.boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
        return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale };
      };
      const toolbar = () => page.locator(".rf-frame-toolbar").evaluate(node => { const r = node.getBoundingClientRect(); return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; });
      const iframeOrigin = () => page.locator("iframe").evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left + node.clientLeft, y: r.top + node.clientTop }; });
      const hit = (a, b) => a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
      const inViewport = r => r.x1 >= -0.5 && r.y1 >= -0.5 && r.x2 <= width + 0.5 && r.y2 <= height + 0.5;

      /** No visible text in the game frame under 11 CSS px. */
      const fonts = async state => {
        const small = await game.locator("body").evaluate(min => {
          const bad = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent.trim(), element = node.parentElement;
            if (!text || !element || !element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            const box = range.getBoundingClientRect();
            if (box.width < 1 || box.height < 1 || box.right < 0 || box.bottom < 0 || box.left > innerWidth || box.top > innerHeight) continue;
            const size = parseFloat(getComputedStyle(element).fontSize);
            if (size < min - 0.01) bad.push(`${size.toFixed(1)}px <${element.tagName.toLowerCase()} class="${element.className}"> "${text.slice(0, 40)}"`);
          }
          return bad;
        }, MIN_FONT);
        assert.deepEqual(small, [], `${label} ${state}: text under ${MIN_FONT} CSS px`);
        checked.push(`fonts:${state}`);
      };
      /** On screen, tappable (the hit test at its centre lands on it, in the frame and on the page), not under the toolbar. */
      const reachable = async (locator, name) => {
        await locator.waitFor({ state: "visible" });
        const origin = await iframeOrigin(), bar = await toolbar();
        const own = await locator.evaluate(node => {
          const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
          return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, x, y, covered: !(top && node.contains(top)) && `${top?.tagName}.${top?.className}` };
        });
        const box = { x1: own.x1 + origin.x, y1: own.y1 + origin.y, x2: own.x2 + origin.x, y2: own.y2 + origin.y };
        assert.equal(own.covered, false, `${label}: ${name} is covered by ${own.covered}`);
        assert.ok(inViewport(box), `${label}: ${name} is off screen ${JSON.stringify(box)}`);
        assert.ok(!hit(box, bar), `${label}: ${name} is under the SDK toolbar ${JSON.stringify({ box, bar })}`);
        const onPage = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [own.x + origin.x, own.y + origin.y]);
        assert.equal(onPage, "IFRAME", `${label}: ${name}'s centre is covered on the page by ${onPage}`);
        const big = box.y2 - box.y1 >= MIN_TAP && box.x2 - box.x1 >= MIN_TAP;
        if (process.env.PK_TAP_SURVEY) { if (!big) console.log(`SURVEY ${label} ${name}: ${JSON.stringify(box)}`); }
        else assert.ok(big, `${label}: ${name} is a small target ${JSON.stringify(box)}`);
        checked.push(`tap:${name}`);
      };
      const targets = async state => { await assertTargets(game, `${label} ${state}`); checked.push(`targets:${state}`); };
      /** A logical scene rect: on screen, not under the toolbar, and every sampled point hits the canvas. */
      const sceneVisible = async (rect, name) => {
        const a = await toPage(rect.left, rect.top), b = await toPage(rect.right, rect.bottom), bar = await toolbar(), origin = await iframeOrigin();
        const box = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        assert.ok(inViewport(box), `${label}: the ${name} is not wholly on screen ${JSON.stringify(box)}`);
        assert.ok(!hit(box, bar), `${label}: the ${name} is under the SDK toolbar`);
        const points = [];
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) points.push([box.x1 + (box.x2 - box.x1) * i / 4 - origin.x, box.y1 + (box.y2 - box.y1) * j / 4 - origin.y]);
        const covered = await canvas.evaluate((node, list) => list.map(([x, y]) => document.elementFromPoint(x, y)).filter(top => top !== node).map(top => `${top?.tagName}.${top?.className}`), points);
        assert.deepEqual([...new Set(covered)], [], `${label}: game UI covers the ${name}`);
        checked.push(`visible:${name}`);
        return box;
      };
      /** The tutorial coaching toast while aiming: on screen, unclipped, off the pitch that matters and off the other UI. */
      const toastClear = async () => {
        const toast = game.locator(".pk-toast");
        await toast.waitFor({ state: "visible" });
        assert.match(await toast.textContent(), /^Tutorial: swipe up/, `${label}: the tutorial coaching toast is up`);
        const origin = await iframeOrigin(), bar = await toolbar();
        const rectOf = locator => locator.evaluate(node => { const r = node.getBoundingClientRect(); return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; });
        const shift = r => ({ x1: r.x1 + origin.x, y1: r.y1 + origin.y, x2: r.x2 + origin.x, y2: r.y2 + origin.y });
        const box = shift(await rectOf(toast));
        assert.ok(inViewport(box), `${label}: the coaching toast is off screen ${JSON.stringify(box)}`);
        assert.ok(!hit(box, bar), `${label}: the coaching toast is under the SDK toolbar`);
        assert.equal(await toast.evaluate(node => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1), true, `${label}: the coaching toast's text is clipped`);
        for (const [rect, name] of [[GOAL, "goal mouth"], [BALL, "ball"], [STRIKER, "striker"], [LOWER_LEFT, "lower-left pitch quadrant"], [PLAY, "pitch below the crossbar"]]) {
          const a = await toPage(rect.left, rect.top), b = await toPage(rect.right, rect.bottom), area = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
          assert.ok(!hit(box, area), `${label}: the coaching toast covers the ${name} ${JSON.stringify({ toast: box, [name]: area })}`);
        }
        for (const selector of [".pk-pot", ".pk-hud-left", ".pk-hud-right", ".pk-actions"]) {
          const other = shift(await rectOf(game.locator(selector)));
          assert.ok(!hit(box, other), `${label}: the coaching toast overlaps ${selector} ${JSON.stringify({ toast: box, other })}`);
        }
        checked.push("toast:clear");
      };
      /** A real swipe: touch events from the ball, up and slightly right, ~180 ms. */
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const touchSwipe = async (dx = 0.3) => {
        const start = await toPage(240, 250);
        const point = i => ({ x: start.x + i * dx * 12 * start.scale, y: start.y - i * 12 * start.scale, id: 1, radiusX: 4, radiusY: 4, force: 1 });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
        for (let i = 1; i <= 9; i++) { await page.waitForTimeout(18); await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(i)] }); }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };

      // The frame fits the screen: nothing to scroll to.
      const frame = await page.locator(".rf-game-frame").boundingBox();
      assert.ok(frame.y >= 0 && frame.y + frame.height <= height + 0.5 && frame.x >= 0 && frame.x + frame.width <= width + 0.5, `${label}: the game frame does not fit the screen ${JSON.stringify(frame)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, `${label}: the page scrolls`);

      // Rotate card: from the frame's own size (portrait frames only).
      await game.getByTestId("rotate").waitFor({ state: "attached" });
      if (portrait) {
        await game.getByTestId("rotate").waitFor({ state: "visible" });
        assert.match(await game.getByTestId("rotate").textContent(), /Turn your phone sideways/);
        assert.equal(await game.locator(".pk-rotate-phone rect").count() > 5, true, "a pixel-art phone icon");
        await fonts("rotate card");
        await reachable(game.getByTestId("portrait-anyway"), "Play in portrait anyway");
        await page.screenshot({ path: `artifacts/phone-${label}-rotate.png` });
        await game.getByTestId("portrait-anyway").click();
        await game.getByTestId("rotate").waitFor({ state: "hidden" });
      } else assert.equal(await game.getByTestId("rotate").isVisible(), false, `${label}: no rotate card in landscape`);

      // Title: the cold open (showreel) and the attract card.
      await fonts("title (cold open)");
      await targets("title (cold open)");
      await reachable(game.getByTestId("play"), "Kick off");
      if (await game.getByTestId("skip-intro").isVisible()) {
        await reachable(game.getByTestId("skip-intro"), "Skip intro");
        await game.getByTestId("skip-intro").click();
        await titleClear(game, `${label} title (attract)`); checked.push("title:clear");
        await fonts("title (attract)");
        await targets("title (attract)");
        await reachable(game.getByTestId("play"), "Kick off");
      }
      await press(game.getByTestId("play"));

      // Tutorial: HUD chips, pot banner, coaching toast; the goal and the ball; Quick shot and Menu.
      await game.getByTestId("pot").waitFor();
      await waitShootable();
      await sceneVisible(GOAL, "goal");
      await sceneVisible(BALL, "ball");
      await toastClear();
      if (await toastOffFriend(game, `${label} tutorial kick 1`)) checked.push("toast:friend-1");
      const coachLines = [];
      if (await toastShort(game, `${label} tutorial kick 1`, coachLines)) checked.push("toast:short-1");
      await page.screenshot({ path: `artifacts/phone-${label}-tutorial.png` });
      await fonts("tutorial HUD");
      await reachable(game.getByTestId("quick"), "Quick shot");
      await reachable(game.getByTestId("menu"), "Menu");
      const before = (await game.locator("body").evaluate(() => window.__pkStats())).shots;
      await touchSwipe(0.3);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      const banner = await game.locator(".pk-banner strong").textContent();
      assert.match(banner, /GOAL!|SAVED!|OFF THE POST!|OVER THE BAR!|WIDE!/);
      assert.equal((await game.locator("body").evaluate(() => window.__pkStats())).shots, before + 1, "the swipe produced exactly one kick");
      assert.equal(await game.getByTestId("round").getAttribute("data-kicks"), "1");
      checked.push(`swipe:${banner}`);
      await fonts("kick banner");
      if (await bannerClear(game, `${label} tutorial kick 1`)) checked.push("banner:clear-1");
      // QA-9: the discovery toast is never truncated: it wraps (at most 2 lines, >= 11 px), even for the longest
      // moment name (measured by swapping the longest label into the shown toast, then restoring it).
      {
        const toast = game.getByTestId("discover-toast");
        await toast.waitFor({ timeout: 5000 });
        const fit = await toast.evaluate(node => {
          const measure = () => { const s = getComputedStyle(node), line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
            return { sw: node.scrollWidth, cw: node.clientWidth, sh: node.scrollHeight, ch: node.clientHeight, lines: Math.round((node.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / line), font: parseFloat(s.fontSize), text: node.textContent }; };
          const shown = measure(), original = node.textContent;
          node.textContent = "NEW: Crowd chants your Friend's number!";
          const longest = measure();
          node.textContent = original;
          return { shown, longest };
        });
        for (const [name, m] of Object.entries(fit)) {
          assert.ok(m.sw <= m.cw && m.sh <= m.ch + 1, `${label}: the discovery toast is truncated (${name}) ${JSON.stringify(m)}`);
          assert.ok(m.lines <= 2 && m.font >= MIN_FONT, `${label}: the discovery toast takes over 2 lines or is under 11px (${name}) ${JSON.stringify(m)}`);
        }
        checked.push("discover:unclipped");
      }
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      await waitShootable();
      await fonts("after the kick (discovery toast)");
      await page.screenshot({ path: `${OUT}/phone-${label}.png` });
      // Kicks 2 and 3 with Quick shot (a tap), then the results.
      for (let kick = 2; kick <= 3; kick++) {
        await waitShootable();
        if (await toastOffFriend(game, `${label} tutorial kick ${kick}`)) checked.push(`toast:friend-${kick}`);
        if (await toastShort(game, `${label} tutorial kick ${kick}`, coachLines)) checked.push(`toast:short-${kick}`);
        await reachable(game.getByTestId("quick"), "Quick shot");
        await press(game.getByTestId("quick"));
        await game.locator(".pk-banner").waitFor({ timeout: 8000 });
        if (await bannerClear(game, `${label} tutorial kick ${kick}`)) checked.push(`banner:clear-${kick}`);
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      }
      await game.getByTestId("results").waitFor({ timeout: 10_000 });
      await fonts("results");
      for (const selector of await goalFits(game, `${label} results`, ["[data-testid=results-next-goal]"])) checked.push(`fits:${selector}`);
      await targets("results");
      // (Closing Results goes to the Modes screen, QA-8; Play again keeps a session on the pitch for the menu hub.)
      await press(game.getByTestId("results").getByRole("button", { name: "Play again", exact: true }));
      await waitShootable();
      await reachable(game.getByTestId("menu"), "Menu");
      await press(game.getByTestId("menu"));
      await fonts("menu hub");
      await targets("menu hub");
      await game.locator(".pk-hub").getByRole("button", { name: "Settings", exact: true }).click();
      await game.locator(".pk-settings").waitFor();
      await fonts("settings");
      await targets("settings");
      await game.getByRole("button", { name: "Close" }).first().click();
      await press(game.getByTestId("menu"));
      await game.getByRole("button", { name: "Change mode", exact: true }).click();
      await fonts("mode select");
      for (const selector of await goalFits(game, `${label} modes`, ["[data-testid=next-goal]", "[data-testid=weekly-keeper]"])) checked.push(`fits:${selector}`);
      // Polish (C3c/C4 regression): on landscape phones the six mode cards are wholly on screen without scrolling
      // (above the SDK toolbar, nothing covering them) and NEXT GOAL is visible too, with the pot, Day badge,
      // Keeper of the Week and the check-in note all on the Modes screen.
      if (!portrait) {
        await game.getByTestId("checkin").waitFor({ state: "attached", timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300); // the screen's entry ease
        const origin = await iframeOrigin(), bar = await toolbar();
        const seen = await game.locator("body").evaluate(() => {
          const screen = document.querySelector(".pk-modescreen");
          const covered = node => { const r = node.getBoundingClientRect(); return [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]].some(([fx, fy]) => { const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); return !(top && node.contains(top)); }); };
          const box = node => { const r = node.getBoundingClientRect(); return { name: node.dataset.testid, x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, covered: covered(node) }; };
          return { scrolled: screen.scrollTop, cards: [...document.querySelectorAll(".pk-modescreen .pk-mode")].map(box), goal: box(document.querySelector("[data-testid=next-goal]")) };
        });
        assert.equal(seen.cards.length, 6, `${label}: six mode cards`);
        assert.equal(seen.scrolled, 0, `${label}: the Modes screen is not scrolled`);
        for (const item of [...seen.cards, seen.goal]) {
          const b = { x1: item.x1 + origin.x, y1: item.y1 + origin.y, x2: item.x2 + origin.x, y2: item.y2 + origin.y };
          assert.ok(inViewport(b) && !hit(b, bar) && !item.covered, `${label}: ${item.name} is not wholly on screen on the Modes screen ${JSON.stringify({ item, bar })}`);
        }
        await page.screenshot({ path: `artifacts/phone-${label}-modes.png` });
        checked.push("modes:on-screen");
      }

      // Big Match: buy a 2-ball pack, open it (pack opening overlay), reveal, kick, then the ball carousel.
      await game.getByTestId("ball-shop").click();
      await fonts("ball shop");
      await targets("ball shop");
      await game.getByTestId("pack-2").click();
      await game.getByTestId("buy-pack").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText("2 balls bought.").waitFor();
      await game.getByTestId("open-pack").click();
      await page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByTestId("pack").waitFor({ timeout: 10_000 });
      await fonts("pack opening");
      await page.screenshot({ path: `artifacts/phone-${label}-pack.png` });
      await reachable(game.getByTestId("reveal-all"), "Reveal all");
      await reachable(game.locator(".pk-card").first(), "pack card");
      await press(game.getByTestId("reveal-all"));
      await game.getByTestId("pack-summary").waitFor();
      await fonts("pack summary");
      await reachable(game.getByTestId("to-bag"), "Go to my Bag");
      await press(game.getByTestId("to-bag"));
      await fonts("bag");
      await game.getByTestId("ball").first().getByTestId("shoot-ball").click();
      await waitShootable();
      await sceneVisible(GOAL, "goal (Big Match)");
      await sceneVisible(BALL, "ball (Big Match)");
      await fonts("Big Match HUD");
      await reachable(game.getByTestId("change-ball"), "Change ball");
      await reachable(game.getByTestId("quick"), "Quick shot");
      await reachable(game.getByTestId("menu"), "Menu");
      await touchSwipe(-0.3);
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      await game.getByTestId("round").and(game.locator('[data-kicks="1"]')).waitFor({ timeout: 8000 });
      await waitShootable();
      await press(game.getByTestId("change-ball"));
      await game.getByTestId("carousel").waitFor({ timeout: 5000 });
      await fonts("ball carousel");
      await reachable(game.getByTestId("kick-with-ball"), "Kick with this ball");
      await reachable(game.getByRole("button", { name: "Close", exact: true }), "carousel Close");
      await page.screenshot({ path: `artifacts/phone-${label}-carousel.png` });
      await press(game.getByRole("button", { name: "Close", exact: true }));
      await waitShootable();
    },
  });
  assert.deepEqual(errors.filter(e => !/favicon/.test(e)), [], `console errors: ${errors.join("\n")}`);
  console.log(`PASS phone ${label} (${portrait ? "portrait, after the rotate card" : "landscape"}): ${checked.length} checks — ${checked.filter(c => c.startsWith("swipe")).join(", ")}`);
}
// BQ-P1-9: on frames taller than 519px (desktop), the title's main CTA "Kick off" is a real button too (>= 44 CSS px),
// in the cold open and on the attract card after "Skip intro". BQ-P1-10: and every tap target in Results, the menu
// hub, Settings, mode select and the Ball shop.
const DESKTOP = option("--size") || args.includes("--results-only") || args.includes("--review-only") ? [] : [[949, 634], [960, 640], [1280, 800]];
for (const [width, height] of DESKTOP) {
  const label = `${width}x${height}`, sizes = [];
  await testGame("./games/penalty-kings", {
    width, height, timeout: 60_000,
    check: async ({ page, game }) => {
      const tall = async (locator, name) => {
        await locator.waitFor({ state: "visible" });
        const box = await locator.boundingBox();
        assert.ok(box.height >= 44 && box.width >= 44, `${label}: ${name} is a small target ${JSON.stringify(box)}`);
        sizes.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
      };
      await tall(game.getByTestId("play"), "Kick off (cold open)");
      await assertTargets(game, `${label} title (cold open)`);
      if (await game.getByTestId("skip-intro").isVisible()) {
        await game.getByTestId("skip-intro").click();
        await titleClear(game, `${label} title (attract)`); sizes.push("title clear (BQ-X6)");
        await tall(game.getByTestId("play"), "Kick off (attract)");
        await assertTargets(game, `${label} title (attract)`);
      }
      if (width === 1280) await page.screenshot({ path: `artifacts/title-${label}.png` });
      // BQ-P1-10 on a desktop frame: Results, the menu hub, Settings and the Ball shop.
      const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
      await game.getByTestId("play").click();
      let toasts = 0;
      for (let kick = 1; kick <= 3; kick++) {
        await waitShootable();
        if (await toastOffFriend(game, `${label} tutorial kick ${kick}`)) toasts++;
        await game.getByTestId("quick").click();
        await game.locator(".pk-banner").waitFor({ timeout: 8000 });
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      }
      assert.ok(toasts >= 1, `${label}: the tutorial coaching toast was checked against the Friend`); sizes.push(`toast clear of the Friend/ball/goal/strip x${toasts}`);
      await game.getByTestId("results").waitFor({ timeout: 10_000 });
      await assertTargets(game, `${label} results`); sizes.push("results");
      sizes.push(...(await goalFits(game, `${label} results`, ["[data-testid=results-next-goal]"])).map(selector => `fits ${selector}`));
      await game.getByTestId("results").getByRole("button", { name: "Play again", exact: true }).click(); // (× goes to Modes, QA-8)
      await waitShootable();
      await game.getByTestId("menu").click();
      await assertTargets(game, `${label} menu hub`); sizes.push("hub");
      await game.locator(".pk-hub").getByRole("button", { name: "Settings", exact: true }).click();
      await game.locator(".pk-settings").waitFor();
      await assertTargets(game, `${label} settings`); sizes.push("settings");
      await game.getByRole("button", { name: "Close" }).first().click();
      await game.getByTestId("menu").click();
      await game.getByRole("button", { name: "Change mode", exact: true }).click();
      await assertTargets(game, `${label} mode select`); sizes.push("mode select");
      sizes.push(...(await goalFits(game, `${label} modes`, ["[data-testid=next-goal]", "[data-testid=weekly-keeper]"])).map(selector => `fits ${selector}`));
      // Owner report: no horizontal scrollbar at ~949 px, on the page or inside the Modes screen.
      const wide = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
      assert.ok(wide.sw <= wide.iw, `${label}: the page scrolls sideways ${JSON.stringify(wide)}`);
      // (in the game font and in the fallback monospace that play:dev showed before its fonts loaded)
      for (const family of ["", "ui-monospace, monospace"]) {
        const inner = await game.locator(".pk-modescreen").evaluate((node, family) => {
          // A classic 17 px vertical scrollbar (Windows Chrome; headless Chromium hides scrollbars) takes 17 px from the
          // content box: emulated with 17 px more inline-end padding. It must not push the content sideways.
          const pad = node.style.paddingRight; node.style.paddingRight = `calc(${getComputedStyle(node).paddingRight} + 17px)`;
          const root = node.closest(".pk"), before = root.style.fontFamily; root.style.fontFamily = family;
          const wide = [...node.querySelectorAll("*")].filter(el => el.getBoundingClientRect().right > node.getBoundingClientRect().right + 0.5).slice(0, 4).map(el => `${el.tagName}.${el.className}`);
          const out = { family, sw: node.scrollWidth, cw: node.clientWidth, doc: document.documentElement.scrollWidth, iw: innerWidth, wide };
          root.style.fontFamily = before; node.style.paddingRight = pad; return out;
        }, family);
        assert.ok(inner.sw <= inner.cw + 1 && inner.doc <= inner.iw, `${label}: the Modes screen scrolls sideways ${JSON.stringify(inner)}`);
      }
      sizes.push("no sideways scroll");
      await game.getByTestId("ball-shop").click();
      await assertTargets(game, `${label} ball shop`); sizes.push("ball shop");
    },
  });
  console.log(`PASS title CTA ${label}: ${sizes.join(", ")}`);
}
// QA-4: on a landscape phone the Results tiles stay in view once Results land (no focus jump, no scroll to the
// button after the count-up), and the primary button is visible and tappable too, in both motion modes.
for (const [width, height, motion] of option("--size") || args.includes("--review-only") ? [] : [[844, 390, "reduce"], [844, 390, "no-preference"]]) {
  const label = `${width}x${height} ${motion === "reduce" ? "reduced motion" : "full motion"}`;
  await testGame("./games/penalty-kings", {
    width, height, timeout: 60_000,
    check: async ({ page, game }) => {
      await page.emulateMedia({ reducedMotion: motion });
      const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
      if (await game.getByTestId("skip-intro").isVisible()) await game.getByTestId("skip-intro").click();
      await game.getByTestId("play").click();
      for (let kick = 1; kick <= 3; kick++) {
        await waitShootable();
        await game.getByTestId("quick").click();
        await game.locator(".pk-banner").waitFor({ timeout: 8000 });
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      }
      await game.locator('[data-testid="results"][data-final]').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(1500); // any smooth scroll after the count has finished
      const seen = await game.locator("body").evaluate(() => {
        const at = (node, fx, fy) => { const r = node.getBoundingClientRect(), hitNode = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); return Boolean(hitNode && node.contains(hitNode)); };
        const tiles = document.querySelector("[data-testid=results] .pk-tiles"), primary = document.querySelector("[data-testid=results] .pk-primary");
        const r = tiles.getBoundingClientRect(), p = primary.getBoundingClientRect();
        return { tiles: [at(tiles, 0.5, 0.05), at(tiles, 0.5, 0.5), at(tiles, 0.5, 0.95)], tilesRect: [r.top, r.bottom].map(Math.round), inViewport: r.top >= 0 && r.bottom <= innerHeight,
          primary: at(primary, 0.5, 0.5), primaryRect: [p.top, p.bottom, p.height].map(Math.round), primaryText: primary.textContent.slice(0, 30) };
      });
      assert.ok(seen.inViewport && seen.tiles.every(Boolean), `${label}: the Results tiles are scrolled out of view ${JSON.stringify(seen)}`);
      assert.ok(seen.primary && seen.primaryRect[2] >= 44, `${label}: the primary Results button is not visible and tappable ${JSON.stringify(seen)}`);
      console.log(`PASS Results in view ${label}: tiles ${seen.tilesRect.join("-")}, primary "${seen.primaryText.trim()}" ${seen.primaryRect.slice(0, 2).join("-")}`);
    },
  });
}
// Owner decision (b), at every review size: the Ball shop opens on its display case (every ball a pack can pull:
// art, odds, RF value), and the primary "Buy pack" button is wholly on screen with no scrolling: inside the page
// viewport and the menu's visible body, clear of the SDK toolbar, uncovered, >= 44 px; the case comes before it in
// the DOM and is visible.
const REVIEW = option("--size") || args.includes("--results-only") ? [] : [[1280, 800], [949, 634], [844, 390], [800, 360], [390, 844], [360, 640]];
for (const [width, height] of REVIEW) {
  const label = `${width}x${height}`;
  await testGame("./games/penalty-kings", {
    width, height, timeout: 90_000,
    check: async ({ page, game }) => {
      const press = locator => (width < 500 ? locator.tap() : locator.click());
      const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
      const origin = () => page.locator("iframe").evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left + node.clientLeft, y: r.top + node.clientTop }; });
      const toolbar = () => page.locator(".rf-frame-toolbar").evaluate(node => { const r = node.getBoundingClientRect(); return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; });
      const hit = (a, b) => a.x1 < b.x2 - 0.5 && a.x2 > b.x1 + 0.5 && a.y1 < b.y2 - 0.5 && a.y2 > b.y1 + 0.5;
      /** Text under 11 px, and text (or any box) outside its card, anywhere under `root` (scrolled or not). */
      const tidy = (root, cards) => game.locator(root).evaluate((node, [cards, min]) => {
        const bad = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          const el = text.parentElement;
          if (!text.textContent.trim() || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < min - 0.01) bad.push(`${size}px "${text.textContent.trim().slice(0, 30)}"`);
        }
        for (const card of node.querySelectorAll(cards)) {
          const c = card.getBoundingClientRect();
          if (card.scrollWidth > card.clientWidth + 1 || card.scrollHeight > card.clientHeight + 1) bad.push(`${card.className} scrolls inside (${card.scrollWidth}x${card.scrollHeight} > ${card.clientWidth}x${card.clientHeight})`);
          const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
          for (let text = w.nextNode(); text; text = w.nextNode()) {
            if (!text.textContent.trim() || !text.parentElement.checkVisibility()) continue;
            const range = document.createRange(); range.selectNodeContents(text);
            for (const q of range.getClientRects()) if (q.width > 0 && (q.left < c.left - 1 || q.right > c.right + 1 || q.top < c.top - 1 || q.bottom > c.bottom + 1)) { bad.push(`"${text.textContent.trim().slice(0, 24)}" lies outside its ${card.className}`); break; }
          }
        }
        const body = node.closest(".rf-frame-menu-body");
        if (body && body.scrollWidth > body.clientWidth + 1) bad.push(`the menu scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
        return bad;
      }, [cards, MIN_FONT]);

      await playInPortraitIfAsked(game);
      if (await game.getByTestId("skip-intro").isVisible()) await press(game.getByTestId("skip-intro"));
      await press(game.getByTestId("play"));
      for (let kick = 1; kick <= 3; kick++) {
        await waitShootable(); await press(game.getByTestId("quick"));
        await game.locator(".pk-banner").waitFor({ timeout: 8000 });
        await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
      }
      await game.getByTestId("results").waitFor({ timeout: 10_000 });
      await press(game.getByTestId("results").getByRole("button", { name: "Modes", exact: true }));

      // (b) Ball shop, as it opens (the first-purchase state: the longest shop).
      await press(game.getByTestId("ball-shop"));
      await game.getByTestId("buy-pack").waitFor();
      await game.getByTestId("first-purchase").waitFor();
      await page.waitForTimeout(300); // the menu's 200 ms entry
      const shop = await game.locator("body").evaluate(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom }; };
        const buy = document.querySelector("[data-testid=buy-pack]"), vitrine = document.querySelector("[data-testid=display-case]"), body = buy?.closest(".rf-frame-menu-body");
        if (!buy || !vitrine || !body) return { missing: { buy: Boolean(buy), vitrine: Boolean(vitrine), body: Boolean(body) } };
        const b = box(buy), top = document.elementFromPoint((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
        const balls = [...vitrine.querySelectorAll(".pk-vball")].map(item => ({ name: item.querySelector("strong")?.textContent.trim(), odds: item.querySelector(".pk-vodds")?.textContent.trim(), value: item.querySelector("small")?.textContent.trim(), art: Boolean(item.querySelector("canvas")?.checkVisibility()) }));
        return { buy: b, text: buy.textContent, body: box(body), scrolled: body.scrollTop, covered: !(top && buy.contains(top)) && `${top?.tagName}.${top?.className}`,
          before: Boolean(vitrine.compareDocumentPosition(buy) & Node.DOCUMENT_POSITION_FOLLOWING), vitrine: box(vitrine), vitrineVisible: vitrine.checkVisibility({ visibilityProperty: true, opacityProperty: true }), balls };
      });
      assert.equal(shop.missing, undefined, `${label}: the Ball shop has no display case / Buy button ${JSON.stringify(shop.missing)}`);
      assert.equal(shop.scrolled, 0, `${label}: the Ball shop opens scrolled`);
      assert.ok(shop.before, `${label}: the display case comes before the Buy button`);
      assert.ok(shop.vitrineVisible && shop.vitrine.y1 >= shop.body.y1 - 0.5 && shop.vitrine.y1 < shop.body.y2, `${label}: the display case is not visible at the top of the shop ${JSON.stringify(shop)}`);
      assert.equal(shop.balls.length, 7, `${label}: seven balls in the display case`);
      for (const ball of shop.balls) assert.ok(ball.art && ball.name && /^[\d.]+%$/.test(ball.odds) && /RF/.test(ball.value), `${label}: a display-case ball without art, name, odds or RF value ${JSON.stringify(ball)}`);
      assert.match(shop.text, /^Buy pack · [\d,.]+ RF/, `${label}: the Buy button names its price in RF`);
      const o = await origin(), bar = await toolbar(), buy = { x1: shop.buy.x1 + o.x, y1: shop.buy.y1 + o.y, x2: shop.buy.x2 + o.x, y2: shop.buy.y2 + o.y };
      assert.ok(shop.buy.y1 >= shop.body.y1 - 0.5 && shop.buy.y2 <= shop.body.y2 + 0.5, `${label}: Buy pack is below the fold of the shop (button ${Math.round(shop.buy.y1)}-${Math.round(shop.buy.y2)}, visible body ${Math.round(shop.body.y1)}-${Math.round(shop.body.y2)})`);
      assert.ok(buy.x1 >= -0.5 && buy.y1 >= -0.5 && buy.x2 <= width + 0.5 && buy.y2 <= height + 0.5, `${label}: Buy pack is off the page viewport ${JSON.stringify(buy)}`);
      assert.ok(!hit(buy, bar), `${label}: Buy pack is under the SDK toolbar ${JSON.stringify({ buy, bar })}`);
      assert.equal(shop.covered, false, `${label}: Buy pack is covered by ${shop.covered}`);
      assert.ok(shop.buy.y2 - shop.buy.y1 >= MIN_TAP - 0.5 && shop.buy.x2 - shop.buy.x1 >= MIN_TAP - 0.5, `${label}: Buy pack is under ${MIN_TAP} px`);
      assert.deepEqual(await tidy(".pk-shop", ".pk-vball, .pk-buybar"), [], `${label}: Ball shop text`);
      await assertTargets(game, `${label} ball shop (display case)`);
      console.log(`PASS shop ${label}: Buy pack ${Math.round(buy.y1)}-${Math.round(buy.y2)} of ${height} (display case first)`);
    },
  });
}
console.log(`PASS phone layouts:${SIZES.map(s => s.join("x")).join(", ")}; screenshots in ${OUT}/`);
