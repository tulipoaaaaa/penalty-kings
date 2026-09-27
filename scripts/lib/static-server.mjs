// Tiny static file server for tests of the built site/ (localhost only). Returns { url, close }.
// Paths are resolved inside `root` (with a separator check, so "../site-other" cannot escape it);
// a directory serves its index.html; anything unreadable is a 404.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webm": "video/webm",
};

export async function serveStatic(root, { base = "/" } = {}) {
  const top = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!path.startsWith(base)) { response.writeHead(404).end(); return; }
      let file = resolve(join(top, path.slice(base.length)));
      if (file !== top && !file.startsWith(top + sep)) { response.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(body);
    } catch { response.writeHead(404).end("not found"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${server.address().port}${base}`, close: () => new Promise(done => server.close(done)) };
}
