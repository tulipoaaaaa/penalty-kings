// B5: pack reveal captures for docs/screenshots/greatness/b5-*.png (dev only, not shipped).
// Buys a 2-ball Park pack in the SDK preview (the fixture wallet holds 20 simulated RF) and opens it with the
// first roll forced to the top of the range (a Golden Boot) and the second to the fixture's pinned Scuffed roll,
// then captures the sequence at fixed times after "Open" and the summary.
// Usage: node dev/b5-pack-shots.mjs <width> <height> <prefix>   e.g. node dev/b5-pack-shots.mjs 1280 800 after
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "../scripts/lib/price-fixture.mjs";

const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 800), prefix = process.argv[4] || "after", tag = `${W}x${H}`;
const OUT = new URL("../docs/screenshots/greatness/", import.meta.url).pathname, roll = Number(process.env.PK_ROLL || 9999);
const TIMES = (process.env.PK_TIMES || "700,1500,3600").split(",").map(Number);
mkdirSync(OUT, { recursive: true });
installPriceFixture();
{ const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...a) => { const b = await launch(...a); const nc = b.newContext.bind(b); b.newContext = (o = {}) => nc({ ...o, reducedMotion: process.env.PK_REDUCED ? "reduce" : "no-preference" }); return b; }; }
await testGame("./games/penalty-kings", { width: W, height: H, timeout: 120_000, check: async ({ page, game }) => {
  page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  const shot = async name => { await page.screenshot({ path: `${OUT}b5-${prefix}-${name}-${tag}.png` }); console.log("shot", name); };
  const confirm = () => page.getByRole("button", { name: "Confirm preview", exact: true }).click();
  const portrait = game.getByRole("button", { name: /Play in portrait anyway/ });
  await game.getByTestId("play").click();
  if (await portrait.count()) await portrait.click();
  await game.getByTestId("pot").waitFor();
  // Skip the tutorial: Menu → Change mode → Big Match (no balls → the Ball shop).
  await game.getByTestId("menu").click();
  await game.getByRole("button", { name: "Change mode", exact: true }).click();
  await game.getByTestId("mode-match").click();
  await game.getByTestId("pack-2").click();
  await game.getByTestId("buy-pack").click(); await confirm();
  await game.getByText("2 balls bought.").waitFor();
  await page.evaluate(value => { const pinned = crypto.getRandomValues.bind(crypto); let once = true; crypto.getRandomValues = array => (once && array instanceof Uint32Array && array.length === 1 ? (once = false, array[0] = value, array) : pinned(array)); }, roll);
  await game.getByTestId("open-pack").click(); await confirm();
  await game.getByTestId("pack").waitFor({ timeout: 10_000 });
  const opened = Date.now();
  for (const at of TIMES) { await page.waitForTimeout(Math.max(0, at - (Date.now() - opened))); await shot(`t${String(at).padStart(4, "0")}`); }
  await game.getByTestId("pack-summary").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(700); await shot("summary");
  console.log("cards:", (await game.locator(".pk-card strong").allTextContents()).join(", "), "summary after", Date.now() - opened, "ms", errors.length ? `ERRORS ${errors}` : "no page errors");
} });
