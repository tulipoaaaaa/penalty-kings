# Handoff to Rare Friends: forking Penalty Kings onto FriendSDK v0.2.1

**The plan (founder decision, 2026-09-27):**
- Rare Friends forks this repo and adapts it to **SDK v0.2.1**.
- Rare Friends deploys its own prototype contracts for the **two random rolls**: buying a pack, and taking a penalty.
- The pilot ships **without $GBOOT**.
- We deploy nothing. The $GBOOT/tokenomics work is kept as a tested, undeployed package ([GBOOT-UPGRADE.md](GBOOT-UPGRADE.md)).
- The testnet dry run of the pilot contracts (run by Rare Friends, not by us) is [PILOT-DRYRUN.md](PILOT-DRYRUN.md); the order of what comes after the pilot is [ROADMAP.md](ROADMAP.md).

**Two lanes, one repo:**

| Lane | Branch / tag | SDK | What it is |
|---|---|---|---|
| **Judged build** | tag `judging-stable-1` = commit `18b4bc8` (CI run 100 green); `judging-stable-2` follows at the Sep 29 freeze ([RELEASES.md](RELEASES.md)). Current head: `claude/clever-mccarthy-ay7qv7` | **FriendSDK v0.1.2** (vendored, `vendor/rarefriends-friendsdk-0.1.2.tgz`) and stays on it | The SDK game in `games/penalty-kings/` and the public preview (`site/`). The public preview redeploys only after a fully green CI run. |
| **Test app** | branch `app/test-shell`; GitHub pre-releases `test-app-<YYYY-MM-DD>-<run>` (APK + unsigned .ipa, `.github/workflows/test-app.yml`) | FriendSDK v0.1.2 `ConnectedGameHost`; wallet seam ready for v0.2.1 | The owner's test lane: simulated onboarding (`apps/mobile/web/`), the `WalletProvider` seam (`packages/wallet/`), Capacitor shells (`apps/mobile/android`, `apps/mobile/ios`, app id `com.penaltykings.test`). Every screen says **TEST BUILD · SIMULATED**. It never builds or publishes `site/`, and compiles `games/penalty-kings/**` read-only. Install: [ANDROID-INSTALL.md](ANDROID-INSTALL.md), [IPHONE-SIDELOAD.md](IPHONE-SIDELOAD.md). |

The v0.2.1 work happens in Rare Friends' fork. Nothing in the judged build moves to v0.2.1 in this repo.

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
packages/wallet/                TEST APP only: the WalletProvider seam (types.ts) and its providers: DevSimulated (default),
                                Privy (headless, pinned 0.76.2), Injected; SimEconomy (simulated RF, Friend loan, hardwire)
apps/mobile/web/                TEST APP only: onboarding shell (app.tsx), the game host (game-screen.tsx, the SDK's
                                ConnectedGameHost), PWA; built by `npm run build:test-app` into dist-test-app/
apps/mobile/android, ios/       TEST APP only: Capacitor 8 shells around the same bundle (deep link com.penaltykings.test://auth)
contracts/                      Foundry: $GBOOT upgrade package + BallVault (NOT deployed)
site-src/practice/              the free practice page (/practice/): real engine, Stage and Director; no wallet,
                                no Friend art, no economy; CSP connect-src 'none'
dev/                            local only: mock wallet server + Showroom (every scene/moment on demand)
scripts/                        tests, QA, build-site, odds verification, economy sim, secret scan
site/ (built)                   the public static preview: Park /, Pro /pro/, Champions /champions/, free practice /practice/
```

## 2. What SDK v0.2.1 must provide, and where each piece plugs in

The game itself contains **no** wallet, payment or sign-up code; those live outside the sandbox. There are two seams:

- **The app seam** (test app only): `WalletProvider` in `packages/wallet/src/types.ts`. The onboarding shell (`apps/mobile/web/src/app.tsx`) talks only to this interface; `apps/mobile/web/src/game-screen.tsx` is the one file that mounts the game (the SDK's `ConnectedGameHost`).
- **The game seam** (judged game, unchanged): `games/penalty-kings/game/platform.ts` (persistence), `games/penalty-kings/game/randomness.ts` (`RandomnessSource`), and the SDK client calls in `games/penalty-kings/index.tsx`.

| # | v0.2.1 provides | Where it plugs in (file · symbol) | Simulated today | How to verify once wired |
|---|---|---|---|---|
| 1 | **Login** (email one-time code, Google) | `packages/wallet/src/types.ts` · `WalletProvider.login(method: "email" \| "google", { email, getCode, onProgress })` → address; `logout()`, `snapshot()`, `onChange()`. Implement in a new `packages/wallet/src/<name>.ts`, add a `WalletChoice` in `packages/wallet/src/config.ts` (`createProvider`). Native OAuth return: `apps/mobile/web/src/deeplink.ts` (`com.penaltykings.test://auth`) | `DevSimulatedProvider.login` (`dev-simulated.ts`): any 6-digit code, simulated Google. `PrivyProvider` (`privy.ts`) is real Privy login, but only with `WALLET=privy` and a `PRIVY_APP_ID` at build time | Add the provider to `packages/wallet/test/contract.test.ts` (every provider runs the same assertions with its SDK mocked) and run `npm run test:test-app` (wallet unit/contract tests + phone and iPhone Playwright runs). On a device from a `test-app-*` release: email and Google both end on the Friend step, `snapshot().status === "logged-in"`, and every `WalletError` code shows Retry |
| 2 | **Embedded wallet** | Same interface: `getAddress()`, `signMessage()`, `sendTransaction({ to, data, value, label })`, and `identityClient()` (a viem `PublicClient` subset). `game-screen.tsx` passes `account = getAddress()`, `chainId = 4663` and `publicClient = identityClient()` to `ConnectedGameHost`; if v0.2.1 ships its own host that manages the wallet, replace that one file | DevSimulated: keyless address `keccak256("penalty-kings-test-account:<id>")`, fake signatures and hashes flagged SIMULATED. Privy/Injected: real `personal_sign`, but `sendTransaction` throws `blocked` (`allowTransactions` is never set in the test app) | The SDK's own ownership gate (`readGenerationEligibility`, run by `ConnectedGameHost`) passes against the real chain with the embedded address; a signature recovers to `getAddress()`; the first real transaction returns `simulated: false` and an explorer link. Confirm gas sponsorship (EIP-7702 vs ERC-4337, [WALLETS.md](WALLETS.md)) |
| 3 | **Loaned Friend** | App: `ProviderBase.loanFriend()` / `claimOwnedFriend()` / `hardwire()` in `packages/wallet/src/base.ts`, called from `app.tsx` (`getFriend`, `hardwire`). **These are not on the `WalletProvider` interface**: a v0.2.1 provider must supply them (or `getFriends()` must return the loan with `relation: "loaned"`). Game: nothing to change: a loaned Friend is just a `friendId` in `GameComponentProps` that the runtime has verified | `SimEconomy.loanFriend` (`sim-economy.ts`): the SDK fixture Friend #7730, hardwire is a fake transaction | `getFriends()` returns the loan; the SDK ownership gate accepts it; on-chain, the ChanceGame's `_controller(friendId)` accepts the signer (it must be the Friend's owner or its token-bound account). A pack bought with the loaned Friend lands in that Friend's token-bound account |
| 4 | **Payments (buy RF)** | `WalletProvider.buyRF(amountUsd)` → `{ rf, tx }`; `getBalance()` → `{ rf, simulated }`. Shown by the Buy RF sheet in `app.tsx` (`buy`) | `SimEconomy.buyRF`: the "Simulated payment (test)" sheet, $5/$20/$50 converted at the game's recorded snapshot price (`games/penalty-kings/game/price.ts`) | `getBalance()` returns `simulated: false` and rises by the purchased RF on chain; a declined payment maps to `WalletError("declined")`; the in-game `client.buy` then spends that RF |
| 5 | **Nakama saves** | `games/penalty-kings/game/platform.ts` · `ProgressStore`, `remoteProgressStore(friendId, { read, write })` (storage key `progress:<friendId>`, value = the save code). **The shell does not consume `Platform` yet:** `index.tsx` calls `loadProgress()` in the `progress` `useState` initialiser and `saveProgress()` in the effect right after it; route both through the store (its `load` is async) | `localProgressStore`: localStorage where the browser allows it (never inside the SDK sandbox) plus the manual save code | `tests/game/platform.test.ts` (round trip through a fake backend; run by `node scripts/test-game-logic.mjs`). Live: finish a level, reload on another device with the same Friend, progress is back without a code; an old save code still imports |
| 6 | **Randomness beacon** (~15 s) | `games/penalty-kings/game/randomness.ts` · `RandomnessSource.next(kind, commitment, signal)` + `expectedWaitMs()`; return it from `randomnessSource()` in `index.tsx`. Pack roll: `client.buy / play / settle` in `index.tsx` (the reveal only animates the settled outcome, `game/reveal.ts` · `revealPlan`). Penalty roll: `awaitKeeper` → `game/suspense.ts` · `rollKeeper` → `keeperSeed`. Referee: `verifier/src/core.ts` · `diveSeed` | Live: `instantBeacon`. Preview: `simulatedBeacon(0)` (0–15 s delays only in dev builds). Packs: the SDK's Dice-based `play/settle` (in the test app: the SDK preview ledger) | `tests/game/randomness.test.ts` and `tests/game/suspense.test.ts` (commit → beacon → seed order, aborts never score); `npm run test:flow` (2 s / 5 s waits, pause mid-wait). Live: for one kick, recompute `keeperSeed(beacon, commitment)` from the published round and the logged commitment and get the same result; the beacon round is always later than the commitment. Details: [RNG-INTEGRATION.md](RNG-INTEGRATION.md); contract checks: [PILOT-DRYRUN.md](PILOT-DRYRUN.md) |

**Nothing to change for v0.2.1 in the judged build.** It stays on FriendSDK v0.1.2; the table above is for the fork and the test app.

## 3. SDK touchpoints (v0.1.2 → v0.2.1)

| File | v0.1.2 API used | What changes for v0.2.1 |
|---|---|---|
| `games/penalty-kings/index.tsx` | `GameComponentProps { friendId, client, paused }`; `client.read / canBuy / buy / play / settle / redeem / definition / mode`; `GameMenu` (frame); `formatGameAmount` (ui); `maximumPrize` (game); `createFriendReader`, `spriteFrame` (sprites); `createFriendSoundKit` (sounds); `frame.css` | Map these to the v0.2.1 client. A **loaned Friend** is just a `friendId` the runtime has verified. **Pack roll:** keep `buy → play → settle` or the founder's equivalent; the reveal only animates the settled `outcomeId` (`revealPlan`). **Penalty roll:** see [RNG-INTEGRATION.md](RNG-INTEGRATION.md). |
| `games/penalty-kings/game/platform.ts` | Defines `ProgressStore`, `localProgressStore` (save code + localStorage), `remoteProgressStore`, `defaultPlatform`. **Not yet consumed by `index.tsx`** (the shell calls `loadProgress` / `saveProgress` directly) | **Integration points:** `remoteProgressStore` over **Nakama** storage, wired into the shell's `progress` state; a `RandomnessSource` over the **~15 s beacon** |
| `games/penalty-kings/game/randomness.ts` | `simulatedBeacon`, `commitShot`, `keeperSeed`, `packDraws` | Implement `RandomnessSource.next()` with the real beacon |
| `games/penalty-kings/index.tsx` · `randomnessSource()` | Returns `instantBeacon` (live) or the simulated beacon (preview, 0 s by default) | **Integration point:** return the v0.2.1 beacon adapter. The waits (`game/suspense.ts`) already handle 0–15 s. |
| `games/penalty-kings/host.css` | The SDK's `--rf-game-aspect-ratio` / `--rf-game-max-width` host variables | Keep if v0.2.1 still reads host.css; otherwise map to its frame-size option |
| `ui.tsx`, `ballui.tsx` | `formatGameAmount`, the game definition types | Types only |
| `games/penalty-kings/game.json`, `tiers/*.json` | The ChanceGame definition (price, outcome weights and rewards) | Keep, or replace with the founder's contract config. `npm run verify:odds` checks weights = 10,000 bps and a 90.00% return. |
| `scripts/test-*.mjs`, `dev/` | `@rarefriends/friendsdk/testing` `testGame`, the mock wallet | Update to the v0.2.1 test harness |
| `scripts/build-site.mjs` | `friendsdk` build/runner | Update to v0.2.1 hosting |

**Out of scope for the game, and provided by v0.2.1:** Google sign-up, embedded Privy wallets, the loaned Friend, Apple/Google Pay, and the Nakama backend. The game contains **no** wallet, payment or sign-up code; in the test app they sit behind `WalletProvider` (section 2).

**Sandbox facts to keep in mind:**
- The frame is `allow-scripts` only, so there's no storage. That's why the save code and `platform.ts` exist.
- The CSP `connect-src` allows only the chain RPC.
- The test harness forces `prefers-reduced-motion: reduce` and serves only its own Friend's sprite (Friend #7730). The crowd therefore uses the player's own canonical sprite.

## 4. Test commands (judged build: `.github/workflows/ci.yml`; test app: `.github/workflows/test-app.yml`)

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
| `npm run test:test-app` (test app lane, `.github/workflows/test-app.yml`, branch `app/test-shell`) | The wallet seam's unit and contract tests (`packages/wallet/test/`), the native-bridge tests, the test app build, Playwright phone (Chromium) and iPhone (WebKit) runs; the workflow then builds the APK and the unsigned .ipa and publishes a `test-app-*` pre-release |

## 5. Known gaps

- **Persistence:** the SDK sandbox has no storage. The fix is Nakama via `platform.ts` (`remoteProgressStore`), wired into the shell's `progress` state (section 2, row 5); until then the preview uses save codes.
- **Preview wallet:** the SDK preview hard-codes 20 simulated RF (2 Park balls). A bigger preview wallet needs an SDK option.
- **Other Friends' sprites:** the SDK harness answers only its sample Friend. A crowd of *other* Friends would need a sprite source the harness allows.
- **Keeper tells with the beacon:** in the beacon modes the pre-kick tell is hidden (the dive doesn't exist before the shot is committed); see [RNG-INTEGRATION.md](RNG-INTEGRATION.md). This is a design decision to confirm.
- **Phones:** text drawn on the pitch canvas scales with the pitch and is small in portrait (the page suggests landscape). A custom host that ignores `host.css` keeps the 3:2 frame.
- **SDK toolbar text on phones:** below 520 px wide the SDK's own `runtime.css` sets the frame toolbar ("Public preview · simulated", "Friend #…", "Friend wallet") and the mode label to 9 px (`@media (max-width:520px) { .rf-frame-toolbar { font-size: 9px } .rf-frame-mode { font-size: 9px } }`). That is the SDK harness chrome, not our `host.css` (which only sets the frame-size variables), so we leave it; our ≥ 11 px rule (`test:phone`, `test:practice`) covers the game frame and our own pages. Ask for ≥ 11 px in the v0.2.1 host chrome.
- **Keepers faced in the first 90 s:** 3–5, depending on skill. Keepers *seen*, counting the cold open, is 7–9.
- **Real-device playtest:** the browser tests use the SDK's mocked wallet. The test app (`test-app-*` releases: APK, unsigned .ipa) makes a phone playthrough possible, but everything in it is simulated; a playthrough with a real embedded wallet and a real Friend waits for v0.2.1.
- **Legal:** paid chance with a redeemable prize needs legal review before live promotion ([LEGAL.md](LEGAL.md)).

## 6. Art, audio and asset licences

- **Game art:** all original and drawn in code (pitch, three stadiums, crowd props, 12 keepers, ball sprites, UI icons). No real clubs, crests, players or brands.
- **Friends:** canonical Rare Friends Generations sprites, loaded with the SDK sprite reader and never altered. The SDK NOTICE (`node_modules/@rarefriends/friendsdk/NOTICE.md`) allows using SDK-supplied Rare Friends artwork in games, including crowds and animations.
- **Font:** Pixelify Sans, SIL Open Font License 1.1 (`games/penalty-kings/assets/PixelifySans-OFL.txt`). Digits and headings: a subset of Departure Mono by Helena Zhang, SIL Open Font License 1.1 (`games/penalty-kings/assets/DepartureMono-OFL.txt`).
- **Audio:** UI sounds come from the FriendSDK sound kit (the SDK NOTICE applies). Crowd, kick, music and ambience are synthesised in code.
- **Source:** Apache-2.0. The official FriendSDK v0.1.2 archive is vendored in `vendor/`, with its sha256 in `ADDRESSES.md`.

## 7. Hosting notes (GitHub Pages)

`npm run build:site` writes `site/`; the Pages workflow publishes it after `npm run check:no-dev`, which fails on dev-only code, the game's QA hooks, a broken internal link or a stadium without its own `runtime.js`.

- **One `runtime.js` per stadium, by design.** The SDK build bakes that tier's ChanceGame (name, price, odds) into `runtime.js` (and `game.js`), so `site/`, `site/pro/` and `site/champions/` each carry a different ~590 KB `runtime.js`. One shared copy would sell every stadium at one price, so they are not deduplicated; `check:no-dev` checks each carries its own tier's price. Only the small files are byte-identical across tiers (fonts, `game.css`, `runtime.css`: about 88 KB per extra tier).
- **Framing (`frame-ancestors`): not enforceable on GitHub Pages.** Pages cannot send custom response headers, and a `<meta http-equiv="Content-Security-Policy">` cannot carry `frame-ancestors` (browsers ignore it there), nor can a meta tag set `X-Frame-Options`. Today: `game.html` has the SDK's meta CSP (`connect-src` = the chain RPC only; `frame-src 'none'`), `practice/` has its own meta CSP (`connect-src 'none'`), and the stadium host pages (`index.html`) have none (the SDK generates them). So any site can frame the public pages. We did **not** add a JavaScript frame-buster: the host page is the page Rare Friends may itself embed, and the game frame must stay framed by it, so a script is too easy to get wrong for little gain (the practice page has nothing to click-jack; the host page's wallet prompts open in the wallet, not in the page). **When Rare Friends hosts the game**, send real headers instead: `Content-Security-Policy: frame-ancestors 'self' <RF app origins>` on the host pages and `practice/`, and `frame-ancestors 'self'` on `game.html` (it is framed only by its same-origin host page), or the v0.2.1 hosting's equivalent.
