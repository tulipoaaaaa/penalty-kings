// DEV ONLY — local play + showroom on http://localhost:5199 (never part of site/ or Pages).
//   npm run play:dev          (binds 0.0.0.0 so Windows Chrome reaches it through WSL)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { context } from "esbuild";
import { buildGame } from "@rarefriends/friendsdk/build";

const PORT = Number(process.env.PORT ?? 5199), ROOT = new URL("..", import.meta.url).pathname;
const PLAY = join(ROOT, ".dev/play"), SHOWROOM = join(ROOT, ".dev/showroom");
await buildGame(join(ROOT, "games/penalty-kings"), { outdir: PLAY, watch: true });
const showroom = await context({
  entryPoints: [join(ROOT, "dev/showroom/main.ts")], bundle: true, format: "iife", platform: "browser", target: "es2022",
  outfile: join(SHOWROOM, "app.js"), loader: { ".woff2": "file" }, assetNames: "[name]", logLevel: "warning",
});
await showroom.watch();
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

/**
 * FD-3b: the preview's simulated randomness delay (0 / 5 / 15 s), set from the Showroom. DEV ONLY: the
 * game reads window.__pkDevRandomnessDelayMs (preview mode only); the judged preview never sets it (0 s).
 */
let randomnessDelayMs = Math.max(0, Math.min(15_000, Number(process.env.PK_RANDOMNESS_DELAY_MS ?? 0) || 0));

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.includes("..")) throw new Error("path traversal");
    if (url.pathname === "/showroom/randomness-delay") {
      if (url.searchParams.has("ms")) randomnessDelayMs = Math.max(0, Math.min(15_000, Number(url.searchParams.get("ms")) || 0));
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ ms: randomnessDelayMs }));
    }
    if (url.pathname === "/pk-dev-randomness.js") {
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      return res.end(`window.__pkDevRandomnessDelayMs = ${randomnessDelayMs};`);
    }
    if (url.pathname.startsWith("/showroom")) {
      const rest = url.pathname.replace(/^\/showroom\/?/, "") || "index.html";
      const file = rest === "index.html" ? join(ROOT, "dev/showroom/index.html")
        : rest.endsWith(".woff2") ? join(ROOT, "games/penalty-kings/assets", normalize(rest)) : join(SHOWROOM, normalize(rest));
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      return res.end(await readFile(file));
    }
    const rest = url.pathname === "/" ? "index.html" : normalize(url.pathname.slice(1));
    let body = await readFile(join(PLAY, rest));
    // The game frame (CSP script-src 'self'): load the dev randomness delay before the game script.
    if (rest === "game.html") body = Buffer.from(body.toString().replace('<script src="./game.js">', '<script src="./pk-dev-randomness.js"></script><script src="./game.js">'));
    if (rest === "index.html") body =Buffer.from(body.toString().replace("<head>", `<head><script>${await readFile(join(ROOT, "dev/mock-wallet.js"), "utf8")}</script>`));
    res.writeHead(200, { "content-type": types[extname(rest)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`\n  PLAY      http://localhost:${PORT}/            (real SDK runtime, read-only DEV mock wallet, simulated economy)`);
  console.log(`  SHOWROOM  http://localhost:${PORT}/showroom/   (scene engine, every moment on demand)\n  Edits rebuild automatically; refresh the browser.\n`);
});
