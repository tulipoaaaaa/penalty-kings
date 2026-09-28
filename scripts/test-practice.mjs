// Free practice page (site/practice/): served from the built site/, played in Chromium at the two
// phone sizes (844 × 390 landscape, 360 × 640 portrait) and a desktop width.
//   - 5 swipes → 5 results and the final "Get your Friend to play for real" card with its links;
//   - EVERY network request is recorded: all must be same-origin GETs for the page's own files
//     (no RPC host, no provider, no wallet, nothing cross-origin, no POST);
//   - no wallet/provider code in the bundle; the site root links to the practice page;
//   - every tap target >= 44 x 44 CSS px (page, end card, and the game pages' stadium bar);
//   - text >= 11 CSS px, no horizontal scroll, no console errors; works with storage blocked.
// Screenshots: artifacts/practice-*.png (set PK_DOC_SHOTS=1 to refresh docs/screenshots/). `npm run test:practice` builds the site first.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serveStatic } from "./lib/static-server.mjs";

const SITE = "site", SHOTS = process.env.PK_DOC_SHOTS ? "docs/screenshots" : "artifacts", C4_SHOTS = process.env.PK_DOC_SHOTS ? "docs/screenshots/greatness" : "artifacts";
const RPC_HOSTS = ["rpc.mainnet.chain.robinhood.com", "robinhood", "infura", "alchemy", "quicknode", "walletconnect", "privy", "moonpay", "blockscout", "rarefriends.com"];
const BUNDLE_BANNED = [/window\.ethereum/, /eth_requestAccounts/, /eth_chainId/, /wallet_switchEthereumChain/, /privy/i, /moonpay/i, /walletconnect/i, /metamask:\/\//i, /isPenaltyKingsDevWallet/, /mock-wallet/];

await readFile(`${SITE}/practice/index.html`).catch(() => { console.error("site/practice missing: use npm run test:practice (it builds the site first)"); process.exit(1); });

// Static checks on the built files.
const bundle = await readFile(`${SITE}/practice/practice.js`, "utf8"), html = await readFile(`${SITE}/practice/index.html`, "utf8");
for (const pattern of BUNDLE_BANNED) { assert(!pattern.test(bundle), `practice.js contains ${pattern}`); assert(!pattern.test(html), `practice/index.html contains ${pattern}`); }
assert.match(html, /connect-src 'none'/, "the practice CSP must forbid every connection");
assert.match(html, /href="https:\/\/rarefriends\.com"/, "links to Rare Friends");
const root = await readFile(`${SITE}/index.html`, "utf8");
assert.match(root, /<a class="practice" href="\.\/practice\/">Try a free practice kick<\/a>/, "the site root links to the free practice page");
for (const file of await readdir(`${SITE}/practice`)) assert(!/^(sw|service-worker)\.js$/.test(file), "no service worker in practice/");

await mkdir(SHOTS, { recursive: true });
const server = await serveStatic(SITE);
const origin = new URL(server.url).origin;
const browser = await chromium.launch({ headless: true });
const report = [];
const MIN_TAP = 44; // BQ-P1-10: every tap target (buttons, links, fields; a checkbox by its label) is >= 44 x 44 CSS px

/** Every visible interactive element inside `scope` on this page, smaller than MIN_TAP in either dimension. */
const smallTargets = (page, scope = "body") => page.evaluate(([min, scope]) => {
  const bad = [], seen = new Set();
  for (let el of document.querySelectorAll(`${scope} :is(button, a[href], input, select, textarea, summary, [role=button])`)) {
    if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) el = el.closest("label") ?? el;
    if (seen.has(el) || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.height < min - 0.5 || r.width < min - 0.5) bad.push(`${Math.round(r.width)}x${Math.round(r.height)} <${el.tagName.toLowerCase()} class="${el.className}"> "${el.textContent.trim().slice(0, 30)}"`);
  }
  return bad;
}, [MIN_TAP, scope]);

async function run({ width, height, name, mobile, blockStorage = false }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: "no-preference" });
  if (blockStorage) await context.addInitScript(() => { for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, { get() { throw new DOMException("blocked", "SecurityError"); } }); });
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on("request", request => requests.push({ url: request.url(), method: request.method() }));
  page.on("websocket", socket => requests.push({ url: socket.url(), method: "WEBSOCKET" }));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`${server.url}practice/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
  if (!blockStorage) await page.screenshot({ path: `${SHOTS}/practice-${name}.png` });

  // Text size: every visible text node's element is >= 11 CSS px.
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || !el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const own = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 11) out.push(`${el.tagName}.${el.className}: ${getComputedStyle(el).fontSize}`);
    }
    return out;
  });
  assert.deepEqual(small, [], `${name}: text under 11px`);
  assert.deepEqual(await smallTargets(page), [], `${name}: tap targets under ${MIN_TAP} CSS px`);
  // Polish: bold C/c draw Pixelify's open 400 glyph (bold Pixelify closes them into O/o), as in the game.
  const glyphs = await page.evaluate(async () => {
    await document.fonts.load("700 48px PixelifySans", "CcOo"); await document.fonts.load("48px PixelifySans", "CcOo"); await document.fonts.ready;
    const mask = (weight, ch) => {
      const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }).getContext("2d");
      c.font = `${weight} 48px PixelifySans`; c.textBaseline = "top"; c.fillText(ch, 4, 4);
      return [...c.getImageData(0, 0, 64, 64).data].filter((_, i) => i % 4 === 3).map(a => (a > 127 ? 1 : 0));
    };
    const diff = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    return Object.fromEntries([["C", "O"], ["c", "o"]].map(([c, o]) => [c, { boldVsRegular: diff(mask(700, c), mask(400, c)), boldVsO: diff(mask(700, c), mask(700, o)) }]));
  });
  for (const d of Object.values(glyphs)) assert.ok(d.boldVsRegular === 0 && d.boldVsO > 40, `${name}: bold C/c draw the open glyph ${JSON.stringify(glyphs)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `${name}: horizontal scroll of ${overflow}px`);
  // The whole pitch is on screen (landscape: no scrolling to reach the ball).
  const box = await page.locator("#pp-canvas").boundingBox();
  assert(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= Math.max(height, box.y + box.height) , `${name}: canvas off screen`);
  if (width > height) assert(box.y + box.height <= height + 0.5, `${name}: in landscape the pitch must fit the screen (bottom ${box.y + box.height} > ${height})`);
  assert(Math.abs(box.width / box.height - 1.5) < 0.02, `${name}: canvas aspect ${box.width / box.height}`);

  // Five swipes from the ball, up and to alternating sides (like scripts/test-game.mjs).
  const toScreen = (x, y) => { const scale = Math.min(box.width / 480, box.height / 320); return { x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale, scale }; };
  for (let kick = 0; kick < 5; kick++) {
    await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
    const dx = [0.5, -0.45, 0.2, -0.6, 0.35][kick];
    const start = toScreen(240, 252);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i <= 9; i++) { await page.mouse.move(start.x + i * dx * 12 * start.scale, start.y - i * 11 * start.scale); await page.waitForTimeout(18); }
    await page.mouse.up();
    await page.waitForFunction(n => window.__pkPractice?.().kicks.length === n, kick + 1, { timeout: 20_000 });
    if (kick === 1 && !blockStorage) { await page.waitForTimeout(150); await page.screenshot({ path: `${SHOTS}/practice-${name}-kick.png` }); }
  }
  await page.waitForFunction(() => window.__pkPractice?.().phase === "done", null, { timeout: 20_000 });
  const results = page.locator('[data-testid="practice-result"]');
  assert.equal(await results.count(), 5, `${name}: 5 results`);
  const shown = await results.evaluateAll(items => items.map(item => item.dataset.result));
  assert(shown.every(result => ["goal", "save", "post", "over", "wide"].includes(result)), `${name}: results ${shown}`);
  const end = page.getByTestId("practice-end");
  await end.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("heading", { name: "Get your Friend to play for real" }).waitFor();
  assert.equal(await page.getByTestId("cta-game").getAttribute("href"), "../");
  assert.equal(await page.getByTestId("cta-rarefriends").getAttribute("href"), "https://rarefriends.com");
  const endText = await end.innerText();
  assert.match(endText, /Rare Friends Generations NFT/);
  assert.match(endText, /Rare Friends app/);
  // C4: the one owner-approved CTA "Get a Friend to play for the pot" (a link out to Rare Friends) is the only place the pot is named.
  const cta = await page.getByTestId("cta-rarefriends").innerText();
  assert.match(cta, /^Get a Friend to play for the pot/);
  assert.match(await page.getByTestId("cta-how").innerText(), /hardwired Rare Friends Generations NFT on Robinhood/);
  assert(!/\bRF\b|\$GBOOT|GBOOT|prize|jackpot|\bpot\b/i.test((await page.locator("body").innerText()).replace(cta, "")), `${name}: economy words on the practice page`);
  if (!blockStorage) await page.screenshot({ path: `${SHOTS}/practice-${name}-end.png` });
  // C4 share card: one tap draws a non-empty PNG (a data: URL, so still no network) with the stand-in striker.
  // Every share entry point (the owner's report): within 2 s of the tap the card shows, with a visible note on how to
  // save it and copy the link (select on focus: no silent clipboard), and no unhandled promise rejection.
  await page.evaluate(() => { window.__ppRejections = []; addEventListener("unhandledrejection", event => window.__ppRejections.push(String(event.reason))); });
  await page.getByTestId("practice-share-btn").click();
  const img = page.getByTestId("practice-share-img");
  await img.waitFor({ state: "visible", timeout: 2_000 });
  assert.match(await page.locator("#pp-share-note").innerText(), /Long-press or right-click the image.*tap it to select it, then copy/, `${name}: the share note is shown`);
  assert(await page.getByTestId("practice-share-link").evaluate(el => { el.focus(); return el.selectionStart === 0 && el.selectionEnd === el.value.length; }), `${name}: focusing the link selects it`);
  assert.deepEqual(await page.evaluate(() => window.__ppRejections), [], `${name}: no unhandled promise rejections`);
  const card = await img.evaluate(el => ({ src: el.src.slice(0, 22), w: el.naturalWidth, h: el.naturalHeight, bytes: Number(el.dataset.bytes), alt: el.alt, download: !document.getElementById("pp-share-save").hidden }));
  assert.equal(card.src, "data:image/png;base64,", `${name}: the card is a PNG data URL`);
  assert.deepEqual([card.w, card.h], [640, 360], `${name}: card size`);
  assert(card.bytes > 5000, `${name}: the card is not empty (${card.bytes} bytes)`);
  assert(await page.evaluate(() => [...document.fonts].some(face => face.family.replace(/"/g, "") === "PKHead" && face.status === "loaded")), `${name}: the card's heading face (PKHead) is loaded before it is drawn`);
  assert.match(card.alt, /Beat me at Penalty Kings/);
  assert.equal(card.download, true, `${name}: a normal page can save the image`);
  assert.equal(await page.getByTestId("practice-share-link").inputValue(), "https://tulipoaaaaa.github.io/penalty-kings/");
  // Is the card really drawn (not a blank canvas)? Count distinct colours in a sample.
  const colours = await img.evaluate(el => { const c = document.createElement("canvas"); c.width = 640; c.height = 360; const x = c.getContext("2d"); x.drawImage(el, 0, 0); const d = x.getImageData(0, 0, 640, 360).data, set = new Set(); for (let i = 0; i < d.length; i += 4 * 97) set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return set.size; });
  assert(colours >= 6, `${name}: the card has content (${colours} colours)`);
  if (name === "1280x800" && !blockStorage) { await page.setViewportSize({ width, height: 1300 }); await page.locator(".pp-end-card").screenshot({ path: `${C4_SHOTS}/c4-practice-end.png` }); await page.setViewportSize({ width, height }); }
  report.push({ name: `${name} share card`, results: `${card.w}x${card.h} PNG, ${card.bytes} bytes, ${colours} colours`, goals: "-", keepers: "-", lines: 0, requests: "-" });
  assert.deepEqual(await smallTargets(page, ".pp-end"), [], `${name}: end-card tap targets under ${MIN_TAP} CSS px`);
  const cardSmall = await page.evaluate(() => [...document.querySelectorAll(".pp-end *")].filter(el => el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11).map(el => el.tagName));
  assert.deepEqual(cardSmall, [], `${name}: end card text under 11px`);

  // Network: only this origin, only GETs, only the page's own files.
  const foreign = requests.filter(request => !request.url.startsWith(origin + "/") || request.method !== "GET");
  const rpc = requests.filter(request => RPC_HOSTS.some(host => request.url.includes(host)));
  assert.deepEqual(rpc, [], `${name}: requests to an RPC/provider host`);
  assert.deepEqual(foreign, [], `${name}: cross-origin or non-GET requests`);
  const paths = [...new Set(requests.map(request => new URL(request.url).pathname))];
  assert(paths.every(path => path.startsWith("/practice/")), `${name}: requests outside /practice/: ${paths}`);
  assert.deepEqual(errors, [], `${name}: console errors`);
  const stats = await page.evaluate(() => window.__pkPractice());
  report.push({ name, width, height, results: shown.join(" "), goals: stats.goals, keepers: stats.keepers.join(","), lines: stats.lines, requests: paths.join(" ") });
  await context.close();
}

/**
 * Owner: "naive swipes must not score 5/5; keep it welcoming". On the default seed (?seed=DEFAULT_SEED) at the
 * desktop size where the audit found 5/5: five straight-up centre swipes do NOT all score, five corner swipes
 * score at least 4, and a saved/missed kick shows a short tip (>= 11 px, inside the side panel, no overlap).
 */
// Same seed as BROWSER_SEED in tests/game/practice-tuning.test.ts (which checks it over a grid of paces and heights).
const DEFAULT_SEED = Number(process.env.PK_PRACTICE_SEED ?? 194426);
async function balance(dxs, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`${server.url}practice/?seed=${DEFAULT_SEED}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__pkPractice().seed), DEFAULT_SEED, "?seed= fixes the first round");
  const box = await page.locator("#pp-canvas").boundingBox(), scale = Math.min(box.width / 480, box.height / 320);
  const at = (x, y) => ({ x: box.x + (box.width - 480 * scale) / 2 + x * scale, y: box.y + (box.height - 320 * scale) / 2 + y * scale });
  const tips = [];
  for (let kick = 0; kick < 5; kick++) {
    await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
    const start = at(240, 252);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i <= 9; i++) { await page.mouse.move(start.x + i * dxs[kick] * 11 * scale, start.y - i * 11 * scale); await page.waitForTimeout(18); }
    await page.mouse.up();
    await page.waitForFunction(n => window.__pkPractice?.().kicks.length === n, kick + 1, { timeout: 20_000 });
    const state = await page.evaluate(() => window.__pkPractice());
    if (kick < 4 && state.kicks[kick] !== "goal") {
      await page.waitForFunction(() => window.__pkPractice?.().tip !== "", null, { timeout: 5_000 });
      const tip = await page.getByTestId("practice-tip").evaluate(el => {
        const r = el.getBoundingClientRect(), side = el.parentElement.getBoundingClientRect();
        const others = [...el.parentElement.children].filter(other => other !== el && other.checkVisibility()).map(other => other.getBoundingClientRect());
        return { text: el.textContent, size: parseFloat(getComputedStyle(el).fontSize), inside: r.left >= side.left - 0.5 && r.right <= side.right + 0.5, overlap: others.some(o => r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom) };
      });
      assert(tip.size >= 11 && tip.inside && !tip.overlap && tip.text.length <= 60, `${label}: tip after a miss ${JSON.stringify(tip)}`);
      tips.push(tip.text);
    }
  }
  const { kicks, goals } = await page.evaluate(() => window.__pkPractice());
  assert.deepEqual(errors, [], `${label}: page errors`);
  await context.close();
  return { kicks, goals, tips };
}

try {
  {
    const naive = await balance([0, 0, 0, 0, 0], "centre swipes");
    assert(naive.goals < 5, `five naive centre swipes must not score 5/5 on seed ${DEFAULT_SEED} (got ${naive.kicks.join(" ")})`);
    assert(naive.tips.some(text => /corner/i.test(text)), `a saved centre shot suggests a corner (${naive.tips.join(" | ")})`);
    const corners = await balance([0.68, -0.68, 0.68, -0.68, 0.68], "corner swipes");
    assert(corners.goals >= 4, `five corner swipes score at least 4 on seed ${DEFAULT_SEED} (got ${corners.kicks.join(" ")})`);
    report.push({ name: `balance seed ${DEFAULT_SEED} 1280x800`, results: `centre ${naive.goals}/5 (${naive.kicks.join(" ")}), corners ${corners.goals}/5 (${corners.kicks.join(" ")}); tip: "${naive.tips[0] ?? ""}"`, goals: "-", keepers: "-", lines: 0, requests: "-" });
  }
  // BQ-P2: no vertical scroll where the page is one screen (landscape phones, where the header wraps on the narrow
  // ones, and a tall portrait phone). A short portrait phone (360 × 640) scrolls to the footer by design, but the
  // whole pitch and the Quick shot button are on the first screen.
  for (const [width, height] of [[844, 390], [812, 375], [667, 375], [640, 360], [568, 320], [390, 844], [360, 640]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`${server.url}practice/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__pkPractice?.().shootable === true, null, { timeout: 20_000 });
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight - window.innerHeight, canvas: document.getElementById("pp-canvas").getBoundingClientRect().bottom, quick: document.getElementById("pp-quick").getBoundingClientRect().bottom }));
    if (width > height || height >= 800) assert(fit.scroll <= 0, `${width}x${height}: vertical scroll of ${fit.scroll}px (scrollHeight > innerHeight)`);
    assert(fit.canvas <= height + 0.5 && fit.quick <= height + 0.5, `${width}x${height}: the pitch (bottom ${fit.canvas}) and Quick shot (bottom ${fit.quick}) are on the first screen`);
    report.push({ name: `fit ${width}x${height}`, results: `scroll ${Math.max(0, fit.scroll)}px`, goals: "-", keepers: "-", lines: 0, requests: "-" });
    await context.close();
  }
  await run({ width: 844, height: 390, name: "844x390", mobile: true });
  await run({ width: 360, height: 640, name: "360x640", mobile: true });
  await run({ width: 1280, height: 800, name: "1280x800", mobile: false });
  await run({ width: 844, height: 390, name: "no-storage", mobile: true, blockStorage: true });
  // The published game pages' stadium bar (trusted host page): its links are real tap targets too.
  for (const [width, height, path] of [[390, 844, ""], [1280, 800, ""], [390, 844, "pro/"]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
    const page = await context.newPage();
    await page.goto(`${server.url}${path}`, { waitUntil: "load" });
    assert.deepEqual(await smallTargets(page, ".pk-stadiums"), [], `stadium bar /${path} at ${width}x${height}: tap targets under ${MIN_TAP} CSS px`);
    report.push({ name: `stadium bar /${path} ${width}x${height}`, results: "links >= 44px", goals: "-", keepers: "-", lines: 0, requests: "-" });
    await context.close();
  }
  // C4: a challenge link (?challenge=CODE) on the trusted host page shows the code to paste into the sandboxed game.
  {
    const code = "pkc1.p.sumo.1fyf8el.13g.2lsohxawjui8i.02d36836";
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`${server.url}?challenge=${code}`, { waitUntil: "load" });
    assert.equal(await page.getByTestId("host-challenge-code").inputValue(), code, "the host page shows the challenge code");
    assert.deepEqual(await smallTargets(page, ".pk-challenge"), [], "challenge banner tap targets");
    await page.goto(`${server.url}?challenge=%3Cimg%20src%3Dx%3E`, { waitUntil: "load" });
    assert.equal(await page.locator(".pk-challenge").isVisible(), false, "a malformed code is ignored");
    report.push({ name: "host challenge banner", results: "code shown; junk ignored", goals: "-", keepers: "-", lines: 0, requests: "-" });
    await context.close();
  }
} finally {
  await browser.close(); await server.close();
}
for (const row of report) console.log(`${row.name}: ${row.results} (goals ${row.goals}; keepers ${row.keepers}; ${row.lines} commentary lines) · requests: ${row.requests}`);
console.log("PASS test-practice: 5 kicks → 5 results → CTA at 844×390, 360×640 and 1280×800 (and with storage blocked); no wallet/provider/RPC requests");
