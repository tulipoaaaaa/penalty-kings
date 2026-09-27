// BQ-P2: the game's read-only QA hooks (window.__pkFlow / __pkStats / __pkDirector, set in games/penalty-kings/index.tsx)
// are for the browser tests, which build the game from source with the SDK harness (testGame), not from site/.
// The published site/ does not expose them: scripts/build-site.mjs points each assignment at a throwaway object
// in the built game.js unless PK_QA_HOOKS=1 (a QA build of the site, never published: check:no-dev rejects it).
import { Script } from "node:vm";

export const QA_HOOKS = ["__pkFlow", "__pkStats", "__pkDirector"];

/** game.js with every QA hook assignment sent to a throwaway object. Throws if the bundle no longer matches. */
export function stripQaHooks(js) {
  let out = js;
  for (const hook of QA_HOOKS) {
    const assignment = `window.${hook}=`;
    const count = out.split(assignment).length - 1;
    if (count !== 1) throw new Error(`qa-hooks: expected one "${assignment}" in game.js, found ${count} (index.tsx changed? update scripts/lib/qa-hooks.mjs)`);
    // Same expression shape (a member assignment that starts with an identifier), so it is valid wherever the
    // original was; the hook function is created and dropped, nothing else in the game changes.
    out = out.replace(assignment, "Object.create(null).qaHook=");
  }
  const left = exposedQaHooks(out);
  if (left.length) throw new Error(`qa-hooks: still in game.js: ${left.join(", ")}`);
  new Script(out, { filename: "game.js" }); // still parses
  return out;
}

/** The QA hook names a built file still mentions. */
export const exposedQaHooks = text => QA_HOOKS.filter(hook => text.includes(hook));
