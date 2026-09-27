# Bug Quest: fix round

Four read-only review agents audited the code at `90c7e74`; their findings are the BQ items below. The BQ-X items were found by the design audits ([GREATNESS.md](GREATNESS.md)).

**Rules:**
- Re-verify on the current head first.
- Every fix gets a test that fails before the fix and passes after it.
- One bug per commit.
- CI must be green before every push.
- Nothing is deployed on-chain.

**P0 and all P1s are fixed.**

| ID | Status | Commit | Test |
|---|---|---|---|
| BQ-P0-1 Pack soft-lock on Change mode | **fixed** | `5dd1d6a` | `scripts/test-flow.mjs` 11b "leaving a pack mid-reveal clears it; Penalties and Big Match start" (960 + 360); before: `__pkFlow()` stuck at pack:true, stage:true |
| BQ-P1-1 Stage streak off by one | **fixed** | `64095db` | `tests/game/stage-streak.test.ts` (goals 1,2,3 → streak was [2,3,4], now [1,2,3]; chant from goal 2) |
| BQ-P1-2 Ball passes through the keeper on non-goal results | **fixed** | `be16e2f` | `tests/game/keeper-sync.test.ts` "every result type" (48,000 fuzzed kicks, every keeper × NEUTRAL + L0–L8: 1,653 mismatches before, 0 after; goal rates unchanged) |
| BQ-P1-3 The mouse's "top corners are always open" tell is false | **fixed** | `c36203c` | `packages/engine/test/engine.test.ts` "the mouse never saves a top-bin shot" (10,000/rung: 8.1% at NEUTRAL, up to 23.1% at L8 before; 0 after) |
| BQ-P1-4 Clocks run behind the rotate overlay | **fixed** | `30b3056` | `scripts/test-flow.mjs` 5d "rotate card up for 6 s during a live shot clock: no timeout, no kick lost" (960) |
| BQ-P1-5 Results XP omits per-kick XP and mid-session level-ups | **fixed** | `9ed2f6d` | `scripts/test-flow.mjs` 5a2 "Results XP == HUD XP gain; mid-session level-up listed" (was 80 vs 205) |
| BQ-P1-6 Redeem the selected ball, then Kick → Ball shop | **fixed** | `56ff942` | `scripts/test-flow.mjs` 12b "carousel 'Kick with this ball' kicks with the shown ball" (960 + 360) |
| BQ-P1-7 $GBOOT spent without confirmation (Skill Cup, Play again, Kit shop) | **fixed** | `cc0d90f` | `scripts/test-flow.mjs` 14 "Kit shop try-on is free; buying needs a confirmation" + "Skill Cup entry and Results 'Play again' spend only after a confirmation" (was 248.33 vs 252.33 on try-on) |
| BQ-P1-8 Public site dead end without a wallet | **fixed** | `8cc3641` | `scripts/test-landing.mjs` (390×844, no wallet: CTA 354×56 above the fold, clip playing, tap → /practice/); timed out before the fix |
| BQ-P1-9 Kick off button 73×24 px | **fixed** | `286e535` | `scripts/test-phone.mjs` "title CTA 960x640 / 1280x800" (was 73×24, now 104×44) |
| BQ-P1-10 Tap targets under 44 px | **fixed** (Results/hub/Settings/Ball shop already ≥44; now covered) | `f38bb67` | `scripts/test-phone.mjs` + `scripts/test-practice.mjs` tap-target checks at 44 px (were: Skip intro 91×40, practice links 17 px, stadium bar 14 px) |
| BQ-P1-11 Pot banner covers the commentary line | **fixed** | `d3754e0` | `scripts/test-game.mjs` "BQ-P1-11" overlap assertion (360/960/1280 px); it failed before the fix (banner bottom 75 px vs strip top 53 px at 960) |
| BQ-P1-12 Bootroom lock-hijack (three PoCs) | **fixed** | `82d45a7` | `contracts/test/BootroomHijackPoC.t.sol` (all three PoCs succeeded before and revert after) + 3 fuzz tests; forge 169 → 184 passing |


**Already fixed before this round** (the owner's sync note, confirmed on the head):

| Item | Commit |
|---|---|
| Bar-in / "OFF THE BAR!" label (y band) | `a51e5ae`, `13d7ea6` |
| Clubhouse gated off the public site | `23161f5` |
| Pot banner freshness tag | `bd55d5c` |
| Stuck celebration | `135c2db` |
| Wildcard note | `63da5d5` |

## Goal rates per keeper and rung

The full before/after table (12 keepers × NEUTRAL + L0–L8, 4 simulated players, 20,000 shots per cell, same seeds) is in [BUG-QUEST-rates.md](BUG-QUEST-rates.md). `node --experimental-strip-types scripts/keeper-goal-rates.ts` regenerates it.
- BQ-P1-2 changed no goal rate: only non-goals became saves.
- BQ-P1-3 moved **only the mouse**: NEUTRAL 63.7 → 66.1 %, L8 41.4 → 50.4 %. At L8, +5.6 of the +9.0 points are top-bin shots that used to be saved, which is the tell becoming true. This is more than ±2 pts on the upper rungs. **Owner decision (2026-09-27): no retune.** The mouse is the easy keeper, and his tell being true fits his character.
- The difficulty sim still holds the 55–65 % band.

## Found during the fix round

| Item | Fix | Commit | Test |
|---|---|---|---|
| The first-goal crowd wave was lost if every tutorial kick was saved (likelier after BQ-P1-2) | The first goal in the next free mode gets it | see git log "First-goal celebration" | `qa:90s` waves ≥ 1 at 360 px (5 repeat runs) |
| `test:landing` needed a prior site build | It builds the site first | see git log | `npm run test:landing` from a clean `site/` |

**All P2s are handled** (BQ-P2-5, the free-kick wall ball radius, merged on the owner's decision). Engine commits were cherry-picked, so their shas are in `git log --grep=BQ-P2`.

## P2 (engine / difficulty)

| Item | Fix | Test |
|---|---|---|
| BQ-P2-1 The mime was flat across the ladder and the ghost got easier on harder rungs | They get the ladder's extra read (mime steps to your side of the wall, the ghost appears where you aimed); NEUTRAL and L0–L3 unchanged. Table in [BUG-QUEST-rates.md](BUG-QUEST-rates.md) | `packages/engine/test/bq-p2.test.ts` (all 12 keepers monotone L3 → L8) |
| BQ-P2-2 The difficulty history counted every mode (Skill Cup, Big Match, Target, tutorial) | Only ladder modes (Penalties, Free Kicks, World Tour, Daily) record a kick (`recordsDifficulty`) | `tests/game/bq-p2.test.ts` |
| BQ-P2-3 A read could send the keeper against his lean/scan, so the run-up tell pointed the wrong way | `adjustPlan` re-points the squirrel's and disco's lean and the robot's scan at the final dive (the peacock's fan stays a fake by design); the shell shows the final plan's tell in the run-up in every mode, not only beacon modes. Gameplay-neutral (tells are drawing only) | `packages/engine/test/bq-p2.test.ts` |
| BQ-P2-4 A NaN pointer sample became a NaN shot; a swipe with near-zero duration (coalesced events) read as a huge overhit | `swipeToShot` rejects any non-finite sample or scale; `releasePoint` ignores non-finite samples; a swipe spanning under `MIN_SWIPE_MS` (30 ms, the old floor) or running backwards is capped at `OVERHIT` (no rise) | `packages/engine/test/bq-p2.test.ts` |
| BQ-P2-5 The free-kick wall tested the ball's centre point, so half a ball could pass through heads, boots or the wall's end | The wall test includes `FK_BALL_RADIUS` (0.11 m) on the sides, over the top and under a jumped wall. The frame test is documented as deliberately different from penalties (0.045 band, no in-off-the-post; crossing interpolated from the 30 Hz path). Balance: `freekick-sim` good-swipe goal rate with keeper 43 → 41 % overall (18–20 m 45 → 38 %, 21–24 m 43 → 40 %, 25 m+ unchanged); the C1b 18 m natural-pace scoring band is 0.78–0.94 (was 0.70–0.94), so that one comfort check is now ≥ 0.15 at 18 m (owner may want a retune) | `packages/engine/test/bq-p2.test.ts` |
| BQ-P2-6 A shot-clock timeout pushed its placeholder x: 0 into the robot's kick history (three timeouts made him forget your favourite side) | The timeout record is flagged `timedOut`; the keeper history is `keeperHistory(kicks)`, which skips it (both call sites). The Skill Cup referee is unaffected (its keeper ignores history) | `tests/game/bq-p2.test.ts` |
| BQ-P2-7 The free-kick knuckleball preview flew a different seed from the strike | ALREADY FIXED in ae5bad5 (C1b): the preview and the strike both resolve `kickSetup(setup, sessionSeed, kickIndex, keeper)` with the same aim wobble | `tests/game/freekick-sync.test.ts` "the trajectory preview flies the strike's own seed" |
| BQ-P2-8 In off the bar / OFF THE BAR! / the crossbar line were guessed from the crossing height (y > 0.93 or 0.9), and a free-mode bar-in goal read "centre · in off the post · SKILL ZONE: in off the bar" | The engine flags the woodwork it touched (`ShotOutcome.hitPost/hitBar`, `FreeKickOutcome` too; no new rolls, verifier unchanged); the kick record keeps `hitBar`; Skill Zone XP, the banner, the Stage's crossbar line and the Director (new `goal:bar-in` / `first:bar-in` lines) use it; the inline "in off the post/bar" words are said once (left out when the Skill Zone label says it) | `packages/engine/test/bq-p2.test.ts`, `tests/game/bq-p2.test.ts`, `packages/game-director/test/director.test.ts` |


## P2 (contracts / docs)

| Item | Status | Commit | Test |
|---|---|---|---|
| EdgeSplitter reverted on dust under 4 wei (zero-amount v4 swap) | fixed: skip the swap and $GBOOT burn when the buyback share is 0 | `0f42dfb` | `testDustUnder4WeiSkipsSwap` (mock swapper reverts on 0 like v4) |
| `SkillCup.week()` underflowed before `start` | fixed: returns 1 before start | `a47a37c` | `testWeekBeforeStartDoesNotUnderflow` |
| GBoot natspec named a "FINAL WALL bounty vault" | fixed: the 5 % goes to the rewards vault | `397c99a` | comment only |
| `economy.ts` drop-rate comment said 3 % × volume | fixed: 2 % × ball price ÷ TWAP ÷ 2.15, capped | `c057961` | comment only |
| BallVault natspec implied a price floor | fixed: free-price market, any non-zero price | `32b634f` | comment only |
| GBOOT-UPGRADE KitShop share and perk-tier examples | fixed: KitShop burns 100 %; exact tier examples | `747f166` | `testDocumentedPerkTierExamples` |
| README row did not say LiquidityLock splits LP fees | fixed | `3f32ba1` | docs only |
| Offline forge runs need `--no-match-contract Fork` | fixed in README, HANDOFF-RF, GBOOT-UPGRADE | `4edc9ea` | docs only |
| The weekly report's pot and TWAP are operator inputs | fixed in the header and WEEKLY.md; the report now records both inputs | `ea3de25`, `5cd8c01` | docs; output field |

forge: 198 → 201 passing offline; 7/7 fork tests.

## P2 (UI)

| Item | Status | Commit | Test (what failed before) |
|---|---|---|---|
| Ball shop → open pack → My Bag → Close ended on an empty pitch | fixed: returns to Modes | `5b9655d` | `test-flow` UI P2 run (the five menus already returned to Modes) |
| Big Match Results said "No packs opened" for 0 RF packs; totals never reset | fixed | `e4abf96` | `test-flow` UI P2 run |
| Results "Play again" started a match with no ball | fixed: same ball (or last-used/best if redeemed) | `233a7d1` | `test-flow` UI P2 run ("Choose ball") |
| Kit shop and Rules missing from Modes | fixed (≥ 44 px) | `16d0413` | `test-flow` UI P2 run |
| Tapping the pot line on title/Modes opened nothing | fixed: opens Odds; closing returns | `78bef65` | `test-flow` UI P2 run |
| Copy: "x1.2" multipliers, "the Shop" | fixed (×, Ball shop) | `3f060b2` | copy test in `tests/game/bq-p2.test.ts` |
| Reduce motion: device setting didn't lock the box; a device change wiped the player's choice | fixed: on if either asks; locked and labelled when the device asks | `0f32a74` | `test-flow` UI P2 run |
| Pack card still flipped with the in-game reduce-motion setting | fixed | `42a5d0e` | `test-flow` UI P2 run |
| BQ-X6 attract title over the pot banner | already fixed by C3c (`6448109`); check added; the sound toggle also covered the "P" at 390×844 (fixed) | `fe972e2`, `91d721f` | `test-phone` title overlap check at 5 sizes |
| BQ-X7 replay under the tutorial coach panel | fixed: the tip clears when the replay starts | `08f7de7` | `test-flow` UI P2 run |
| BQ-X9 side effects in a `setPack` updater | already fixed by B5 (`f40bf76`) | — | — |

## P2 (build / hosting)

| Item | Status | Commit | Test (what failed before) |
|---|---|---|---|
| QA hooks (`__pkFlow`, `__pkStats`, `__pkDirector`) shipped in `site/` | fixed: stripped at build (`PK_QA_HOOKS=1` keeps them for a local QA build) | `0e25d27` | `check:no-dev` (9 hits before) |
| Latent `/live/` 404 and Clubhouse link without a deployment | fixed: links only to pages the build makes | `016f854` | `npm run test:site-links` (16 deployment combinations) |
| frame-ancestors | documented: GitHub Pages can't send headers; headers for RF hosting in HANDOFF-RF | `0dbabb9` | docs only |
| SDK toolbar 9 px on phones | the SDK's own `runtime.css`; documented as a v0.2.1 host request | `ddce6c1` | docs only |
| Practice page scrolled 3–33 px on landscape phones | fixed | `2cdcc62` | `test-practice` no-overflow check at 6 sizes |
| `runtime.js` per stadium | not a duplicate (each carries its tier's price and odds); guarded | `3b5bdbf` | `check:no-dev` |
| BQ-X10 dev server hung on a missing Showroom file | fixed: read first, 404 | `c7ea46d` | `npm run test:dev-server` |

## Integrated-build QA sweep (after all Part B/C merges, at `b388316`)

A read-only audit played the whole judge path at 1280×800, 844×390 and 390×844 in full and reduced motion. It found no P0s and no page or console errors. Fixes:

| Item | Status | Commit | Test (what failed before) |
|---|---|---|---|
| Big Match: 3+ goals then a miss on kick 5 ended the match without sudden death | fixed | `5f073f4` | `tests/game/match.test.ts` |
| Tutorial Results: "Next up: Free Kicks" contradicted NEXT GOAL | fixed (teaser hidden when NEXT GOAL shows) | `86f68ba` | `test-flow` |
| Tutorial coaching toast covered the Friend (desktop) and the commentary strip (844×390) | fixed | `a14e312` | `test-phone` toast overlap at 6 sizes |
| Results tiles scrolled out of view on landscape phones | fixed (sticky button footer) | `5a0928e` | `test-phone --results-only`, both motion modes |
| "Shot clock pressure!" with no shot clock | fixed | `781677e` | `packages/game-director/test/director.test.ts` |
| HUD pot said "on-chain snapshot" twice | fixed | `fcf92ff` | `tests/game/pot-hud.test.ts` |
| Stale SCORE box on the title and pack reveal | fixed | `0aa0f29` | `test-game` |
| Closing Results (× / Escape) left a dead pitch | fixed (goes to Modes) | `5cbf2f2` | `test-flow` |
| Discovery toast cut off with "…" on phones | fixed (wraps to 2 lines) | `bce88db` | `test-phone` |
| "BEST STREAK: 0"; Cups weights wrong on Champions Night | fixed | `dbe9c11` | `tests/game/copy-qa10.test.ts` |
| Live stadiums would claim "×2 tonight" Cup points on Champions Night, but the weekly Cup report never doubles | fixed: only the simulated preview race doubles | `25ed6da` | `tests/game/weekly.test.ts`, `copy-qa10.test.ts` |

Left as they are (design, or for the owner): Target Practice's clock pauses during flight (R6-C8 design, so a round takes longer than 60 s of real time); canvas commentary is drawn at 8 px on the 480×320 canvas; in Big Match the next kick unlocks while the Friend is still walking back.
