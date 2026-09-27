# Handoff to Rare Friends: forking Penalty Kings onto FriendSDK v0.2.1

**The plan (founder decision, 2026-09-27):**
- Rare Friends forks this repo and adapts it to **SDK v0.2.1**.
- Rare Friends deploys its own prototype contracts for the **two random rolls**: buying a pack, and taking a penalty.
- The pilot ships **without $GBOOT**.
- We deploy nothing. The $GBOOT/tokenomics work is kept as a tested, undeployed package ([GBOOT-UPGRADE.md](GBOOT-UPGRADE.md)).

**Judged baseline:**
- Tag `judging-stable-1` = commit `18b4bc8` (CI run 100 green). `judging-stable-2` follows at the Sep 29 freeze (see [RELEASES.md](RELEASES.md)).
- The current head is on branch `claude/clever-mccarthy-ay7qv7`.
- The public preview redeploys only after a fully green CI run.

## 1. Architecture map

```
games/penalty-kings/            the SDK game (runs sandboxed in the SDK iframe)
  index.tsx                     the shell: screens, sessions, input, the action-flow guards, and ALL SDK runtime calls
  game.json, tiers/*.json       ChanceGame definitions: Park / Pro / Champions prices, odds, rewards
  game/                         pure game logic: progress, levels (World Tour), daily, target, flow (the state machine),
                                reveal (ethics), prizes and price, bag, savecode, director adapter, firstsession,
                                randomness (the two rolls), suspense (the 0–15 s waits), platform (the v0.2.1 seams),
                                rewards/bracket (XP only)
  gfx/                          the canvas scene: Stage, stadiums, crowd, keepers, ball, kick animation, set pieces,
                                showreel and reel player, commentary
  ui.tsx, ballui.tsx, style.css menus, shop, pack opening, Bag, carousel (the pixel-HUD style)
  layout.tsx, host.css          phone layouts: the rotate card; host.css sets the SDK frame's aspect ratio
                                on phones (2:1 landscape, 9:16 portrait) through the SDK's documented host variables
  audio.ts                      synthesised crowd, music and ambience
packages/engine/                deterministic shot physics + keeper AI + keeper rig (physics = render); shared with the referee
packages/game-director/         Match Director: pacing, moment deck, keeper rotation, 275 commentary lines (cosmetic only)
verifier/                       Skill Cup referee (Cloudflare Worker): stores inputs → seed → resolve → sign
contracts/                      Foundry: $GBOOT upgrade package + BallVault (NOT deployed)
site-src/practice/              the free practice page (/practice/): real engine, Stage and Director; no wallet,
                                no Friend art, no economy; CSP connect-src 'none'
dev/                            local only: mock wallet server + Showroom (every scene/moment on demand)
scripts/                        tests, QA, build-site, odds verification, economy sim, secret scan
site/ (built)                   the public static preview: Park /, Pro /pro/, Champions /champions/, free practice /practice/
```

## 2. SDK touchpoints (v0.1.2 → v0.2.1)

| File | v0.1.2 API used | What changes for v0.2.1 |
|---|---|---|
| `games/penalty-kings/index.tsx` | `GameComponentProps { friendId, client, paused }`; `client.read / canBuy / buy / play / settle / redeem / definition / mode`; `GameMenu` (frame); `formatGameAmount` (ui); `maximumPrize` (game); `createFriendReader`, `spriteFrame` (sprites); `createFriendSoundKit` (sounds); `frame.css` | Map these to the v0.2.1 client. A **loaned Friend** is just a `friendId` the runtime has verified. **Pack roll:** keep `buy → play → settle` or the founder's equivalent; the reveal only animates the settled `outcomeId` (`revealPlan`). **Penalty roll:** see [RNG-INTEGRATION.md](RNG-INTEGRATION.md). |
| `games/penalty-kings/game/platform.ts` | Defaults: `localProgressStore` (save code + localStorage), `instantBeacon` | **Integration points:** `remoteProgressStore` over **Nakama** storage; a `RandomnessSource` over the **~15 s beacon** |
| `games/penalty-kings/game/randomness.ts` | `simulatedBeacon`, `commitShot`, `keeperSeed`, `packDraws` | Implement `RandomnessSource.next()` with the real beacon |
| `games/penalty-kings/index.tsx` · `randomnessSource()` | Returns `instantBeacon` (live) or the simulated beacon (preview, 0 s by default) | **Integration point:** return the v0.2.1 beacon adapter. The waits (`game/suspense.ts`) already handle 0–15 s. |
| `games/penalty-kings/host.css` | The SDK's `--rf-game-aspect-ratio` / `--rf-game-max-width` host variables | Keep if v0.2.1 still reads host.css; otherwise map to its frame-size option |
| `ui.tsx`, `ballui.tsx` | `formatGameAmount`, the game definition types | Types only |
| `games/penalty-kings/game.json`, `tiers/*.json` | The ChanceGame definition (price, outcome weights and rewards) | Keep, or replace with the founder's contract config. `npm run verify:odds` checks weights = 10,000 bps and a 90.00% return. |
| `scripts/test-*.mjs`, `dev/` | `@rarefriends/friendsdk/testing` `testGame`, the mock wallet | Update to the v0.2.1 test harness |
| `scripts/build-site.mjs` | `friendsdk` build/runner | Update to v0.2.1 hosting |

**Out of scope for the game, and provided by v0.2.1:** Google sign-up, embedded Privy wallets, the loaned Friend, Apple/Google Pay, and the Nakama backend. The game contains **no** wallet, payment or sign-up code.

**Sandbox facts to keep in mind:**
- The frame is `allow-scripts` only, so there's no storage. That's why the save code and `platform.ts` exist.
- The CSP `connect-src` allows only the chain RPC.
- The test harness forces `prefers-reduced-motion: reduce` and serves only its own Friend's sprite (Friend #7730). The crowd therefore uses the player's own canonical sprite.

## 3. Test commands (all in CI: `.github/workflows/ci.yml`)

| Command | What it proves |
|---|---|
| `npm run typecheck` · `npm run check` | TypeScript; FriendSDK game validation |
| `npm run test:smoke` | The SDK's own browser harness at 960 and 360 px (what reviewers run) |
| `npm run test:engine` · `npm run test:director` · `npm run test:verifier` | Physics and keeper determinism; Director cadence and cosmetic-only output; the referee's replay and signatures |
| `node scripts/test-game-logic.mjs` | Levels, progress, save codes, prices, geometry, Bag honesty, the action-flow state machine (every action in every state), keeper render = physics (2,000 penalties + 1,000 free kicks), the two-roll randomness contract |
| `npm run test:game` · `test:flow` · `test:modes` · `qa:90s` | The buy → open → reveal → Bag → kick → redeem flow; awkward interleavings, 2–5 s randomness waits and speed; every mode; the first 90 s with reduced motion on and off |
| `npm run test:phone` · `npm run test:practice` | Phone layouts at 360×800, 390×844, 800×360 and 844×390 (fit, ≥ 11 px text, tap targets, a real touch swipe); the free practice page (5 kicks → CTA, no wallet or RPC requests) |
| `npm run sim:difficulty` · `npm run verify:odds` | Goal-rate band 55–65%; exact odds and a 90.00% return |
| `cd contracts && forge test --no-match-contract Fork` | The $GBOOT upgrade package + BallVault (undeployed), offline; the `Fork` suites need `--match-contract Fork --fork-url $ROBINHOOD_RPC_URL` |
| `npm run secret-scan` | No keys or personal data in tracked files (also a pre-commit hook) |

## 4. Known gaps

- **Persistence:** the SDK sandbox has no storage. The fix is Nakama via `platform.ts`; until then the preview uses save codes.
- **Preview wallet:** the SDK preview hard-codes 20 simulated RF (2 Park balls). A bigger preview wallet needs an SDK option.
- **Other Friends' sprites:** the SDK harness answers only its sample Friend. A crowd of *other* Friends would need a sprite source the harness allows.
- **Keeper tells with the beacon:** in the beacon modes the pre-kick tell is hidden (the dive doesn't exist before the shot is committed); see [RNG-INTEGRATION.md](RNG-INTEGRATION.md). This is a design decision to confirm.
- **Phones:** text drawn on the pitch canvas scales with the pitch and is small in portrait (the page suggests landscape). A custom host that ignores `host.css` keeps the 3:2 frame.
- **Keepers faced in the first 90 s:** 3–5, depending on skill. Keepers *seen*, counting the cold open, is 7–9.
- **Real-device playtest:** the browser tests use the SDK's mocked wallet. A human playthrough on a phone is still needed.
- **Legal:** paid chance with a redeemable prize needs legal review before live promotion ([LEGAL.md](LEGAL.md)).

## 5. Art, audio and asset licences

- **Game art:** all original and drawn in code (pitch, three stadiums, crowd props, 12 keepers, ball sprites, UI icons). No real clubs, crests, players or brands.
- **Friends:** canonical Rare Friends Generations sprites, loaded with the SDK sprite reader and never altered. The SDK NOTICE (`node_modules/@rarefriends/friendsdk/NOTICE.md`) allows using SDK-supplied Rare Friends artwork in games, including crowds and animations.
- **Font:** Pixelify Sans, SIL Open Font License 1.1 (`games/penalty-kings/assets/PixelifySans-OFL.txt`). Digits and headings: a subset of Departure Mono by Helena Zhang, SIL Open Font License 1.1 (`games/penalty-kings/assets/DepartureMono-OFL.txt`).
- **Audio:** UI sounds come from the FriendSDK sound kit (the SDK NOTICE applies). Crowd, kick, music and ambience are synthesised in code.
- **Source:** Apache-2.0. The official FriendSDK v0.1.2 archive is vendored in `vendor/`, with its sha256 in `ADDRESSES.md`.

## 6. Hosting notes (GitHub Pages)

`npm run build:site` writes `site/`; the Pages workflow publishes it after `npm run check:no-dev`, which fails on dev-only code, the game's QA hooks, a broken internal link or a stadium without its own `runtime.js`.

- **One `runtime.js` per stadium, by design.** The SDK build bakes that tier's ChanceGame (name, price, odds) into `runtime.js` (and `game.js`), so `site/`, `site/pro/` and `site/champions/` each carry a different ~590 KB `runtime.js`. One shared copy would sell every stadium at one price, so they are not deduplicated; `check:no-dev` checks each carries its own tier's price. Only the small files are byte-identical across tiers (fonts, `game.css`, `runtime.css`: about 88 KB per extra tier).
- **Framing (`frame-ancestors`): not enforceable on GitHub Pages.** Pages cannot send custom response headers, and a `<meta http-equiv="Content-Security-Policy">` cannot carry `frame-ancestors` (browsers ignore it there), nor can a meta tag set `X-Frame-Options`. Today: `game.html` has the SDK's meta CSP (`connect-src` = the chain RPC only; `frame-src 'none'`), `practice/` has its own meta CSP (`connect-src 'none'`), and the stadium host pages (`index.html`) have none (the SDK generates them). So any site can frame the public pages. We did **not** add a JavaScript frame-buster: the host page is the page Rare Friends may itself embed, and the game frame must stay framed by it, so a script is too easy to get wrong for little gain (the practice page has nothing to click-jack; the host page's wallet prompts open in the wallet, not in the page). **When Rare Friends hosts the game**, send real headers instead: `Content-Security-Policy: frame-ancestors 'self' <RF app origins>` on the host pages and `practice/`, and `frame-ancestors 'self'` on `game.html` (it is framed only by its same-origin host page), or the v0.2.1 hosting's equivalent.
