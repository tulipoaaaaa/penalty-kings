// Every internal link of the built site/ resolves to a file (BQ-P2: /live/ was a 404 on the public site).
// Checks href/src attributes of every HTML page, and the stadium opener's `pages` map (build-site.mjs).
// External (scheme:) links, "#" fragments and "?query"-only links are skipped.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });

/** Internal link targets of one HTML page's text. */
export function internalLinks(html) {
  const out = [];
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) out.push(match[1]);
  for (const match of html.matchAll(/const pages=(\{[^}]*\})/g)) out.push(...Object.values(JSON.parse(match[1])));
  return out.filter(link => link && !/^[a-z][a-z0-9+.-]*:/i.test(link) && !link.startsWith("#") && !link.startsWith("?") && !link.startsWith("//"));
}

/** Does `link`, found in `file`, resolve to a file inside `root`? (A directory means its index.html.) */
export function resolves(root, file, link) {
  const top = resolve(root);
  const clean = decodeURIComponent(link.replace(/[?#].*$/, ""));
  let target = clean.startsWith("/") ? resolve(top, `.${clean}`) : resolve(dirname(file), clean);
  if (target !== top && !target.startsWith(top + sep)) return false;
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
  return existsSync(target) && statSync(target).isFile();
}

/** ["page.html → link", …] for every internal link under `root` that does not resolve. */
export function brokenLinks(root) {
  const broken = [];
  for (const file of walk(root).filter(path => path.endsWith(".html"))) {
    for (const link of internalLinks(readFileSync(file, "utf8"))) if (!resolves(root, file, link)) broken.push(`${relative(root, file)} → ${link}`);
  }
  return broken;
}
