// DEV ONLY — the request handler of dev/server.mjs (split out so scripts/test-dev-server.mjs can run it without
// the esbuild/FriendSDK watchers). Never part of site/ or Pages.
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

/**
 * FD-3b: the preview's simulated randomness delay (0 / 5 / 15 s), set from the Showroom. DEV ONLY: the
 * game reads window.__pkDevRandomnessDelayMs (preview mode only); the judged preview never sets it (0 s).
 */
export function createDevHandler({ root, play, showroom, randomnessDelayMs = 0 }) {
  let delay = Math.max(0, Math.min(15_000, Number(randomnessDelayMs) || 0));
  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.includes("..")) throw new Error("path traversal");
      if (url.pathname === "/showroom/randomness-delay") {
        if (url.searchParams.has("ms")) delay = Math.max(0, Math.min(15_000, Number(url.searchParams.get("ms")) || 0));
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ ms: delay }));
      }
      if (url.pathname === "/pk-dev-randomness.js") {
        res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
        return res.end(`window.__pkDevRandomnessDelayMs = ${delay};`);
      }
      if (url.pathname.startsWith("/showroom")) {
        const rest = url.pathname.replace(/^\/showroom\/?/, "") || "index.html";
        const file = rest === "index.html" ? join(root, "dev/showroom/index.html")
          : rest.endsWith(".woff2") ? join(root, "games/penalty-kings/assets", normalize(rest)) : join(showroom, normalize(rest));
        const body = await readFile(file); // BQ-X10: read first (a missing file is a 404), then send the 200
        res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        return res.end(body);
      }
      const rest = url.pathname === "/" ? "index.html" : normalize(url.pathname.slice(1));
      let body = await readFile(join(play, rest));
      // The game frame (CSP script-src 'self'): load the dev randomness delay before the game script.
      if (rest === "game.html") body = Buffer.from(body.toString().replace('<script src="./game.js">', '<script src="./pk-dev-randomness.js"></script><script src="./game.js">'));
      if (rest === "index.html") body = Buffer.from(body.toString().replace("<head>", `<head><script>${await readFile(join(root, "dev/mock-wallet.js"), "utf8")}</script>`));
      // The game frame is sandboxed (opaque origin "null"), so its @font-face loads are CORS requests: without this
      // header the fonts were blocked and play:dev fell back to system monospace. GitHub Pages sends the same header.
      res.writeHead(200, { "content-type": types[extname(rest)] ?? "application/octet-stream", "cache-control": "no-store", "access-control-allow-origin": "*" });
      res.end(body);
    } catch {
      // Never write a second head: a response already under way is just ended.
      if (res.headersSent) res.end(); else res.writeHead(404).end("not found");
    }
  };
}
