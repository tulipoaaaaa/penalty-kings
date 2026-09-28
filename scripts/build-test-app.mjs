// TEST APP build (owner's test lane, branch app/test-shell) → dist-test-app/ (gitignored).
// SEPARATE from the judged build: it never writes site/, never runs scripts/build-site.mjs, and never edits
// games/penalty-kings/** (the game is compiled read-only with the SDK's own buildGame into a scratch dir).
//
//   npm run build:test-app                       simulated wallet (default), works offline after first load
//   WALLET=privy PRIVY_APP_ID=… npm run build:test-app   Privy embedded wallet (App ID from env, never committed)
//   WALLET=injected npm run build:test-app       browser wallet (desktop testing)
//   TEST_APP_OUT=dir  BUILD_NUMBER=n             output directory / build number shown in Settings
//   Needs apps/mobile's own packages first:  npm ci --prefix apps/mobile   (Capacitor, pinned; docs/ANDROID-INSTALL.md)
//   The same output is the web bundle of the native shells (apps/mobile/capacitor.config.json webDir).
//
// Output (relative URLs only, so it can be hosted under any base path, e.g. a GitHub Pages project site):
//   index.html  app.js (+chunks)  app.css  sw.js  manifest.webmanifest  icons/  game/ (the SDK child frame)
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { build } from "esbuild";
import { encodeFunctionData } from "viem";
import { buildGame } from "@rarefriends/friendsdk/build";
import { FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import { createArtworkFixture } from "../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, process.env.TEST_APP_OUT ?? "dist-test-app"), WORK = join(ROOT, ".build-test-app");
const APP = join(ROOT, "apps/mobile/web");
// The shell's native bridge imports @capacitor/core from apps/mobile (its own pinned package.json + lockfile).
try { await stat(join(ROOT, "apps/mobile/node_modules/@capacitor/core/package.json")); } catch { throw new Error("build-test-app: run 'npm ci --prefix apps/mobile' first (Capacitor packages of the native shells)"); }
const WALLET = process.env.WALLET ?? "dev";
if (!["dev", "privy", "injected"].includes(WALLET)) throw new Error(`WALLET must be dev, privy or injected (got ${WALLET})`);
const PRIVY_APP_ID = (process.env.PRIVY_APP_ID ?? "").trim() || null;
if (PRIVY_APP_ID && !/^[a-z0-9]{10,40}$/i.test(PRIVY_APP_ID)) throw new Error("PRIVY_APP_ID does not look like a Privy App ID (public id only; never a secret)");

// Version: apps/mobile/web/package.json + build number (CI run number) + short sha. Bumps every build.
const appPackage = JSON.parse(await readFile(join(APP, "package.json"), "utf8"));
const sha = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "local"; } })();
const buildNumber = process.env.BUILD_NUMBER ?? process.env.GITHUB_RUN_NUMBER ?? String(Math.floor(Date.now() / 1000));
const VERSION = `${appPackage.version}+${buildNumber}.${sha}`;

await rm(OUT, { recursive: true, force: true }); await rm(WORK, { recursive: true, force: true });
await mkdir(join(OUT, "game"), { recursive: true });

// 1) The full game (every mode, packs, Bag, Cups, shop, Scouting Book, sound, sharing) as the SDK child frame.
//    Same sources and SDK build as play:dev; QA hooks stay (the test app's Playwright run reads __pkFlow).
const game = await buildGame(join(ROOT, "games/penalty-kings"), { outdir: join(WORK, "game") });
await game.close();
// The child reads its Friend's art from the chain. The test app answers the fixture Friend's (#7730) three
// public registry reads from the SDK's recorded canonical frames, so the simulated app needs no network.
const artwork = await createArtworkFixture();
const { registry } = GENERATION_SPRITE_MANIFEST;
const calls = [["familyOf", [7730n]], ["seedOf", [7730n]], ["frames", [5, 7730]]];
const answers = Object.fromEntries(calls.map(([functionName, args]) => {
  const data = encodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, functionName, args });
  return [data.toLowerCase(), artwork({ to: registry, data })];
}));
const framesHex = (await (async () => {
  const { decodeFunctionResult } = await import("viem");
  return decodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName: "frames", data: answers[encodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, functionName: "frames", args: [5, 7730] }).toLowerCase()] }).map(value => `0x${value.toString(16)}`);
})());
const simArt = `// TEST BUILD: recorded public art for the SDK fixture Friend #7730 (FriendSDK scripts/browser-fixture.mjs), served offline.
(()=>{const R=${JSON.stringify(registry.toLowerCase())},A=${JSON.stringify(answers)},f=fetch.bind(self);
const one=b=>b&&b.method==="eth_call"&&b.params&&b.params[0]&&String(b.params[0].to).toLowerCase()===R?A[String(b.params[0].data).toLowerCase()]:undefined;
const cid=b=>b&&b.method==="eth_chainId"?"0x1237":undefined;
self.fetch=async(input,init)=>{try{const body=init&&typeof init.body==="string"?JSON.parse(init.body):null;
if(body){const list=Array.isArray(body)?body:[body],out=list.map(b=>{const r=one(b)??cid(b);return r===undefined?null:{jsonrpc:"2.0",id:b.id,result:r}});
if(out.every(Boolean))return new Response(JSON.stringify(Array.isArray(body)?out:out[0]),{headers:{"content-type":"application/json"}});}}catch{}
return f(input,init)};})();`;
// OFFLINE: browsers do not route a sandboxed (opaque-origin) frame through the service worker, so the child ships as
// ONE self-contained document (scripts, styles and fonts inline) that the shell fetches through the service worker
// and hands to the SDK as a blob: URL. Same sandbox (allow-scripts only), same bridge; the CSP stays strict: scripts
// run only by their SHA-256 hashes (no 'unsafe-inline' for scripts), fonts only from data: URIs.
const childHtml = await readFile(join(WORK, "game/game.html"), "utf8");
const csp = childHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
if (!csp || !csp.includes("script-src 'self'") || !csp.includes("font-src 'self'") || !childHtml.includes('<script src="./game.js">')) throw new Error("build-test-app: SDK child document changed");
let css = (await readFile(join(WORK, "game/game.css"), "utf8")) + (await readFile(join(WORK, "game/game-layout.css"), "utf8"));
for (const [, path] of css.matchAll(/url\("\.\/(assets\/[^"]+\.woff2)"\)/g)) css = css.replaceAll(`url("./${path}")`, `url("data:font/woff2;base64,${(await readFile(join(WORK, "game", path))).toString("base64")}")`);
if (/url\("\.\//.test(css)) throw new Error("build-test-app: the child CSS references a file that is not inlined");
// The shell bridge (apps/mobile/web/frame-bridge.js): forwards the game's vibration requests to the shell (native
// haptics in the Capacitor app) and reports the game's screen for the Android back button. Test build only.
const frameBridge = await readFile(join(APP, "frame-bridge.js"), "utf8");
if (frameBridge.includes("</script")) throw new Error("build-test-app: frame-bridge.js must not contain </script");
const scripts = [simArt, frameBridge, (await readFile(join(WORK, "game/game.js"), "utf8")).replaceAll("</script", "<\\/script")];
const hashes = scripts.map(text => `'sha256-${createHash("sha256").update(text).digest("base64")}'`).join(" ");
const inlineCsp = csp.replace("script-src 'self'", `script-src ${hashes}`).replace("font-src 'self'", "font-src data:");
const title = childHtml.match(/<title>[^<]*<\/title>/)?.[0] ?? "<title>Penalty Kings</title>";
await writeFile(join(OUT, "game/frame.html"), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${inlineCsp}">${title}<style>${css}</style></head><body><main id="root"></main>${scripts.map(text => `<script>${text}</script>`).join("")}</body></html>\n`);

// 2) The onboarding shell + the SDK's ConnectedGameHost (apps/mobile/web/src).
// The SDK preview ledger starts every Friend at a fixed 20 RF; the test app starts it at the simulated wallet's
// RF instead and reads it back after each purchase (exact literal patch, test build only; fails loudly if the SDK changes).
const ledgerPatch = {
  name: "pk-test-ledger", setup(b) {
    b.onLoad({ filter: /friendsdk[\\/]dist[\\/]game-host\.js$/ }, async args => {
      let source = await readFile(args.path, "utf8");
      const patches = [
        ["rfBalance: 20n * RF }).client;", "rfBalance: (globalThis.__pkTestRfBalance ?? 20n * RF) }).client;"],
        ["ledgers.set(ledgerKey, client);", "ledgers.set(ledgerKey, client); globalThis.__pkTestOnLedger?.(client);"],
      ];
      for (const [from, to] of patches) {
        if (!source.includes(from)) throw new Error(`build-test-app: SDK game-host changed, update the ledger patch: ${from}`);
        source = source.replace(from, to);
      }
      return { contents: source, loader: "js" };
    });
  },
};
const config = { wallet: WALLET, privyAppId: PRIVY_APP_ID, version: VERSION, appId: "com.penaltykings.test", appName: "Penalty Kings (Test)", fixtureFrames: framesHex };
await build({
  entryPoints: { app: join(APP, "src/main.tsx") }, outdir: OUT, bundle: true, format: "esm", splitting: true, platform: "browser", target: "es2022",
  jsx: "automatic", minify: true, sourcemap: false, logLevel: "warning", chunkNames: "chunks/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"', __PK_TEST_CONFIG__: JSON.stringify(config) },
  loader: { ".woff2": "file", ".png": "file" }, assetNames: "assets/[name]-[hash]", plugins: [ledgerPatch],
});

// 3) Static files: index.html, manifest, icons, service worker (precache of every file, versioned cache).
await cp(join(APP, "public"), OUT, { recursive: true });
const html = (await readFile(join(APP, "index.html"), "utf8")).replaceAll("%VERSION%", VERSION);
await writeFile(join(OUT, "index.html"), html);
const files = [];
const walk = async dir => { for (const name of await readdir(dir)) { const path = join(dir, name); if ((await stat(path)).isDirectory()) await walk(path); else files.push(relative(OUT, path).split("\\").join("/")); } };
await walk(OUT);
const precache = ["./", ...files.filter(file => file !== "sw.js").map(file => `./${file}`)].sort();
const digest = createHash("sha256");
for (const file of files.sort()) digest.update(file).update(await readFile(join(OUT, file)));
const cacheName = `pk-test-${VERSION}-${digest.digest("hex").slice(0, 10)}`;
const sw = (await readFile(join(APP, "sw.template.js"), "utf8")).replace("__CACHE__", JSON.stringify(cacheName)).replace("__PRECACHE__", JSON.stringify(precache)).replace("__VERSION__", JSON.stringify(VERSION));
await writeFile(join(OUT, "sw.js"), sw);
await writeFile(join(OUT, "version.json"), JSON.stringify({ version: VERSION, cache: cacheName, wallet: WALLET, privy: Boolean(PRIVY_APP_ID) }) + "\n");
await rm(WORK, { recursive: true, force: true });
console.log(`built TEST APP ${VERSION} (wallet: ${WALLET}${WALLET === "privy" && !PRIVY_APP_ID ? " → falls back to simulated: no PRIVY_APP_ID" : ""}) → ${relative(ROOT, OUT)}/ (${files.length + 1} files, cache ${cacheName})`);
