// The stadium links of the published game pages (scripts/build-site.mjs), as a pure function so
// scripts/test-site-links.mjs can check every combination of live deployments.
export const TIERS = [["park", "Park · 10 RF"], ["pro", "Pro · 1,000 RF"], ["champions", "Champions · 10,000 RF"]];

/** Output directory of a stadium page, relative to site/ ("" is the site root). */
export const tierDir = (tier, live) => (live ? (tier === "park" ? "live/" : `live/${tier}/`) : tier === "park" ? "" : `${tier}/`);

/**
 * Links for the page of `tier` (`live`: its LIVE build). `liveTiers`: the tiers with a LIVE build;
 * `clubhouse`: whether site/live/clubhouse/ is built. Returns { root, bar (inner HTML), pages (id → href) }.
 */
export function stadiumNav({ tier, live, liveTiers, clubhouse }) {
  const depth = (tier === "park" ? 0 : 1) + (live ? 1 : 0);
  const root = depth ? "../".repeat(depth) : "./";
  const base = live ? `${root}live/` : root;
  const href = id => (id === "park" ? base : `${base}${id}/`);
  // BQ-P2 (/live/ 404): link only to pages the build makes. A LIVE page lists only the tiers with a LIVE build;
  // "Live — real RF" opens the first LIVE build (Park's when there is one); the Clubhouse only when it is built.
  const shown = TIERS.filter(([id]) => !live || liveTiers.has(id));
  const links = shown.map(([id, label]) => id === tier ? `<strong aria-current="page">${label}</strong>` : `<a href="${href(id)}">${label}</a>`).join(" ");
  const firstLive = TIERS.map(([id]) => id).find(id => liveTiers.has(id));
  const club = clubhouse ? ` <a href="${root}live/clubhouse/">Clubhouse (live)</a>` : "";
  const other = live ? `<a href="${root}">Simulated preview</a>${club}` : firstLive ? `<a href="${root}${tierDir(firstLive, true)}">Live — real RF</a>${club}` : "";
  const practice = `<a class="practice" href="${root}practice/">Try a free practice kick</a>`;
  const pages = Object.fromEntries(TIERS.filter(([id]) => id !== tier && (!live || liveTiers.has(id))).map(([id]) => [id, href(id)]));
  return { root, bar: `${links} ${other} ${practice}`, pages };
}
