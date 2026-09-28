// Review screenshots for the Ball shop (display case + Buy above the fold) and the Scouting Book (sticker album),
// in the real sandboxed runtime. The Scouting Book is shown with 3 stamps and 2 scouted keepers (a save code).
// Usage: node scripts/shot-shop-book.mjs --size 1280x800 --tag after [--out docs/screenshots/greatness]
// Writes <out>/shop-<tag>-<w>x<h>.png and <out>/scouting-<tag>-<w>x<h>.png (palette PNGs, well under 150 KB).
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { testGame } from "@rarefriends/friendsdk/testing";
import { installPriceFixture } from "./lib/price-fixture.mjs";
import { playInPortraitIfAsked } from "./lib/phone.mjs";
import { shrinkPng } from "./lib/png-palette.mjs";

installPriceFixture();
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [width, height] = arg("--size", "1280x800").split("x").map(Number);
const tag = arg("--tag", "after"), out = arg("--out", "docs/screenshots/greatness");
await mkdir(out, { recursive: true });
const FRIEND = 7730n;
const crc32 = text => { let crc = ~0; for (let i = 0; i < text.length; i++) { crc ^= text.charCodeAt(i); for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (~crc >>> 0).toString(16).padStart(8, "0"); };
const editSaveCode = (code, change) => {
  const [prefix, payload] = code.trim().split(".");
  const next = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ...change }), "utf8").toString("base64url");
  return `${prefix}.${next}.${crc32(`${FRIEND}:${next}`)}`;
};

await testGame("./games/penalty-kings", {
  width, height, timeout: 90_000,
  check: async ({ page, game }) => {
    const press = locator => (width < 500 ? locator.tap() : locator.click());
    const waitShootable = () => game.locator("body").evaluate(() => new Promise((resolve, reject) => { const start = Date.now(); const poll = () => (window.__pkFlow?.().shootable ? resolve(true) : Date.now() - start > 15000 ? reject(new Error("never shootable")) : setTimeout(poll, 50)); poll(); }));
    const shot = async name => {
      await page.waitForTimeout(700);
      const path = `${out}/${name}-${tag}-${width}x${height}.png`;
      await page.screenshot({ path });
      await writeFile(path, shrinkPng(await readFile(path)));
      console.log(`${path} ${Math.round((await stat(path)).size / 1024)} KB`);
    };
    await playInPortraitIfAsked(game);
    const skip = game.getByTestId("skip-intro");
    if (await skip.isVisible()) await press(skip);
    await press(game.getByTestId("play"));
    for (let kick = 1; kick <= 3; kick++) {
      await waitShootable(); await press(game.getByTestId("quick"));
      await game.locator(".pk-banner").waitFor({ timeout: 8000 });
      await game.locator(".pk-banner").waitFor({ state: "detached", timeout: 10_000 });
    }
    await game.getByTestId("results").waitFor({ timeout: 10_000 });
    await press(game.getByTestId("results").getByRole("button", { name: "Modes", exact: true }));
    await press(game.getByTestId("ball-shop"));
    await game.getByTestId("buy-pack").waitFor();
    await shot("shop");
    await press(game.getByRole("button", { name: "Close Ball shop" }));
    await press(game.getByRole("button", { name: "Settings", exact: true }));
    await game.getByTestId("save-code-in").fill(editSaveCode(await game.getByTestId("save-code-out").inputValue(), { stamps: ["mouse", "squirrel", "sloth"], keepersSeen: ["mouse", "squirrel", "sloth", "peacock", "octopus"] }));
    await press(game.getByTestId("save-code-restore"));
    await game.getByTestId("save-code-note").filter({ hasText: /restored/ }).waitFor();
    await press(game.getByRole("button", { name: "Close Settings" }));
    await press(game.getByRole("button", { name: "Scouting Book", exact: true }));
    await game.locator(".pk-book").waitFor();
    await shot("scouting");
  },
});
