// BQ-X10: the DEV server (dev/server.mjs, `npm run play:dev`) must answer a missing file with a 404 and keep serving.
// It used to send "200" before reading a Showroom file, so a missing one threw ERR_HTTP_HEADERS_SENT inside the
// catch: the request hung and the unhandled rejection killed the server. Runs dev/handler.mjs on a temp dir (no
// esbuild/FriendSDK watchers). Usage: node scripts/test-dev-server.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevHandler } from "../dev/handler.mjs";

const rejections = [];
const onRejection = error => rejections.push(String(error));
process.on("unhandledRejection", onRejection);
process.on("uncaughtException", onRejection);

const root = new URL("..", import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), "pk-dev-server-"));
const play = join(temp, "play"), showroom = join(temp, "showroom");
await mkdir(play, { recursive: true }); await mkdir(showroom, { recursive: true });
await writeFile(join(showroom, "app.js"), "console.log('showroom');");
await writeFile(join(play, "index.html"), "<!doctype html><html><head></head><body>play</body></html>");
await mkdir(join(play, "assets"), { recursive: true }); await writeFile(join(play, "assets/pixelify-test.woff2"), "wOF2");
const server = createServer(createDevHandler({ root, play, showroom }));
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const get = path => fetch(base + path, { signal: AbortSignal.timeout(3000) }).then(async response => ({ status: response.status, body: await response.text() }));

try {
  for (const path of ["/showroom/missing.js", "/showroom/missing.woff2", "/showroom/nested/missing.css", "/missing.html"]) {
    const response = await get(path);
    assert.equal(response.status, 404, `${path}: a missing file is a 404 (got ${response.status})`);
  }
  await new Promise(done => setTimeout(done, 50)); // let any stray rejection surface
  assert.deepEqual(rejections, [], "no unhandled rejection or exception (the server would have died)");
  assert.equal(server.listening, true, "the server is still listening");
  // Still serving after the misses.
  assert.deepEqual(await get("/showroom/app.js"), { status: 200, body: "console.log('showroom');" });
  assert.equal((await get("/showroom/randomness-delay?ms=5000")).body, '{"ms":5000}');
  assert.equal((await get("/pk-dev-randomness.js")).body, "window.__pkDevRandomnessDelayMs = 5000;");
  const index = await get("/");
  assert.equal(index.status, 200);
  assert.match(index.body, /<head><script>/, "the play page still gets the DEV mock wallet");
  // Polish: the game frame is sandboxed (origin "null"), so its fonts are CORS loads: the play files' fonts are
  // font/woff2 with Access-Control-Allow-Origin: * (before, play:dev fell back to system monospace).
  {
    const font = await fetch(`${base}/assets/pixelify-test.woff2`, { headers: { origin: "null" }, signal: AbortSignal.timeout(3000) });
    await font.arrayBuffer();
    assert.equal(font.status, 200, "a font in the play build is served");
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal(font.headers.get("access-control-allow-origin"), "*", "the sandboxed game frame may load the font (CORS)");
  }
} finally {
  server.closeAllConnections?.();
  await new Promise(done => server.close(done));
  await rm(temp, { recursive: true, force: true });
  process.off("unhandledRejection", onRejection); process.off("uncaughtException", onRejection);
}
console.log("PASS test-dev-server: missing files are 404s and the DEV server keeps serving");
