// Builds the LIVE Clubhouse (trusted page, outside the game sandbox) into <outdir>.
// Addresses come from games/penalty-kings/deployments/live.json (written after the $GBOOT launch);
// the referee URL from REFEREE_URL or live.json. Missing values render a "not deployed" state.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export async function buildClubhouse(outdir) {
  let live = {};
  try { live = JSON.parse(await readFile("games/penalty-kings/deployments/live.json", "utf8")); } catch {}
  const refereeUrl = process.env.REFEREE_URL ?? live.refereeUrl;
  const config = { gboot: live.gboot, kitShop: live.kitShop, skillCup: live.skillCup, wildcards: live.wildcards, refereeUrl, explorer: "https://robinhoodchain.blockscout.com" };
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["clubhouse/main.tsx"], bundle: true, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    minify: true, outfile: `${outdir}/app.js`, define: { __PK_LIVE__: JSON.stringify(config), "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
  });
  const connect = ["'self'", "https://rpc.mainnet.chain.robinhood.com", refereeUrl ? new URL(refereeUrl).origin : ""].filter(Boolean).join(" ");
  const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connect}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  await writeFile(`${outdir}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Penalty Kings · Clubhouse (live)</title><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script src="./app.js"></script></body></html>\n`);
  return config;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await buildClubhouse(process.argv[2] ?? "site/live/clubhouse"));
