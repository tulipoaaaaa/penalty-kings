// Bundles tests/game/*.test.ts with esbuild (the game imports @penalty-kings/engine, whose .ts
// sources live under node_modules where Node cannot strip types) and runs them with node --test.
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname, out = join(root, ".dev/game-tests");
rmSync(out, { recursive: true, force: true });
const entries = readdirSync(join(root, "tests/game")).filter(name => name.endsWith(".test.ts")).map(name => join(root, "tests/game", name));
await build({ entryPoints: entries, outdir: out, bundle: true, platform: "node", format: "esm", target: "node22", outExtension: { ".js": ".mjs" }, logLevel: "warning", loader: { ".json": "json" },
  // CommonJS deps (react-dom/server) require() node builtins: give the ESM bundles a real require.
  banner: { js: "import { createRequire as __pkCreateRequire } from \"node:module\"; const require = __pkCreateRequire(import.meta.url);" } });
execFileSync(process.execPath, ["--test", ...entries.map(file => join(out, file.split("/").pop().replace(/\.ts$/, ".mjs")))], { stdio: "inherit" });
