# Penalty Kings: design audit, lane B (surfaces 7–12)

Branch `claude/clever-mccarthy-ay7qv7` @ 274944f (fast-forwarded in the worktree). Read-only: no tracked file was changed and nothing was committed.
Screenshots are in `artifacts/audit/B/` in the worktree `` (141 PNGs). Captures are named `<step>-1280x800.png` and `<step>-844x390.png`.
Capture scripts: `artifacts/audit/capB.mjs` (the SDK `testGame` harness, price fixture, real swipes, reducedMotion "no-preference"), `artifacts/audit/showB.mjs` (dev Showroom on :5277), `artifacts/audit/practiceB.mjs` (built `site/` served statically) and `artifacts/audit/glyphs.mjs` (font glyph sheet).
The run pulled 2 × Scuffed from a 2-ball Park pack, the worst outcome, which made a good honesty test. Page errors: none.

## Score table (0–10)

| # | Surface | Wow | Read | Motion/feel | Cohesion | Delight | **Overall** |
|---|---|---|---|---|---|---|---|
| 7 | Pack → reveal → Bag → choose ball | 4 | 3 | 4 | 5 | 3 | **4** |
| 8 | HUD, menus, Modes, Results, shops, Cups | 5 | 4 | 4 | 6 | 4 | **5** |
| 9 | Typography and numbers | 5 | 2 | 5 | 7 | 4 | **3** |
| 10 | Sound (structural) | 3 | 4 | 4 | 5 | 3 | **4** |
| 11 | Onboarding, tutorial, no-wallet practice (and landing) | 4 | 6 | 6 | 5 | 4 | **5** (landing page alone: 2) |
| 12 | Scouting Book, submission sheet, README hero | 3 | 5 | 3 | 5 | 4 | **4** |

---

## BROKEN (separate from polish)

1. **The commentary strip is hidden under the pot banner** on every in-game frame, at 1280×800 and at 844×390 (`03-tutorial-aim-*`, `07-hud-penalties-*`, `21-bigmatch-hud-*`). The canvas strip slides to y=26 logical (`gfx/stage.ts` drawCommentary, about line 784). The DOM `.pk-pot` banner (`style.css:47`) is taller than that, so the tutorial's "Swipe up from the ball" line and all Director commentary cannot be read.
2. **The canvas reveal is covered by the pack DOM panel.** `.pk-pack` sits at `bottom:13cqh`, `max-height:40cqh` (`style.css:208`) and covers the spotlight, god rays and rarity banner that `stage.showReveal` draws. At 1280×800 only the top of the ball shows (`18-pack-t02364-1280x800.png`). At 844×390 the panel covers the whole canvas (`18-pack-t02114-844x390.png`). The best motion in the game (`showroom-reveal-goldenboot-t1250.png`) never appears in the real flow.
3. **The pack summary scrolls the honesty lines out of view.** After `pack-summary` mounts, the 40cqh panel scrolls, so "Odds per ball" and "Rarity decided by…" sit above the fold at the exact moment the result lands (`19-pack-summary-*`).
4. **About 14 of the 20 `Sfx` names are silent.** `playSfx` (`index.tsx:416-426`) handles kick, whistle, roar/chant, groan, ooh, clang, net, glove/stomp/heartbeat and nothing else. Dropped sounds:
   - `whoosh` on every strike;
   - every keeper signature sound on a save (`stage.ts:344`: squeak, chitter, yawn, honk, blub, mime, disco, hiss, beep, boo, rumble);
   - the Director moments `shot-clock` (beep), `vuvuzela` and `air-horn` (honk) in `game/director.ts:109,114,126`;
   - `reveal` and `reveal-top`.
5. **Double roars with no limiter.** A goal with streak ≥ 2 fires `roar` and `chant`, and both call `crowd.roar()` (`stage.ts:336-337`). A Golden Boot reveal fires `sfx("roar")` (`stage.ts:362`) and `crowd.reveal(top)` also calls `this.roar()` (`audio.ts` reveal). Every voice connects straight to `context.destination` with no bus or compressor, so these stack into clipping.
6. **Latent issues:**
   - The 4×5 `GLYPHS` font (`gfx/stadium.ts:84`) has no digits, so any number passed to `glyphText` draws blank.
   - `flipCard` and `revealAll` play sound and start the Stage reveal inside a `setPack` updater (`index.tsx:1079-1090`). Updaters must be pure, so this double-fires under StrictMode or a concurrent re-render.
7. **Sound is off by default** (`index.tsx:104` `useState(true)`), and the only toggle is Menu → Settings. `unlockAudio()` does nothing while muted, so a judge or stranger hears nothing unless they find that toggle. Not a crash, but it removes the whole audio layer from the first impression.

---

## 7. Pack opening → reveal → Bag → choose ball: 4/10

Screens: `14-ballshop-top`, `15-ballshop-odds`, `16-confirm-preview`, `17-bought`, `18-pack-t*` (16 frames at each size), `19-pack-summary`, `20-bag`, `20b-collection`, `20c-market`, `22-carousel`, `23-bigmatch-banner`. Showroom (the art the flow hides): `showroom-reveal-{scuffed,gold,goldenboot}-t*`, `showroom-packwait-t*`.

**Honesty is excellent.**
- Odds are printed on the pack.
- `revealPlan` is a pure function of the settled outcome, with no fake near-misses.
- The summary gives spent, pulled and net in red or green.
- Scuffed is explained.

**The "electric" half is missing.**
- In the preview `expectedWaitMs()` is 0, so the sealed-pack art never shows ("RANDOMNESS ON ITS WAY", shaking pack, meter). The flow cuts from a host confirm dialog to a small bordered DOM panel with two 76×100 "?" cards.
- The stage reveal plays behind that panel (BROKEN 2).
- The card flip is a 0.35 s `rotateY(90→0)` with no build-up, and it is not synced to the stage beat.
- A bad pack ends in a paragraph of text with no consolation beat.
- Every money figure in this flow is ambiguous in Pixelify: "Spent 20 RF" and "−20 RF" read as 80, and "2 Scuffed Balls" reads as 8 (see §9).

**Gaps to 10:**

| Gap | Technique | Effort | Risk | Files / functions |
|---|---|---|---|---|
| Let the stage own the reveal | While `runPackSequence` runs, collapse `PackOpening` to a bottom strip of card slots (≈18cqh) or hide it until each `showReveal` finishes (2.4 s, or 3.8 s for a Golden Boot). Mount the summary after the best reveal. Keep a one-line odds and honesty ribbon pinned, outside the scroll area. | 3–4 h | Low. The flow tests wait on `pack-summary` and `reveal-all` test ids, which stay. | `ballui.tsx` PackOpening; `style.css:208-225`; `index.tsx` runPackSequence / flipCard / revealAll (1018-1090) |
| Sealed-pack beat even at 0 s wait | Always play a fixed 700–900 ms "tear" on the stage. The duration must not depend on the outcome (so it stays honest) and "Reveal all" skips it. Reuse `drawPackWait` art with a tear animation and particles. | 2 h | Low (the fixed duration is outcome-independent) | `index.tsx` openPack; `gfx/waits.ts`; `game/suspense.ts` packRevealSequence |
| Cards with anticipation | Face-down cards idle-wobble; tapping gives a 60 ms squash, a flip, and a rarity-coloured edge flash. A Gold or Golden Boot card gets a gold rim sweep and a stage flash. Tier colour comes from the true rarity only. | 2 h | Low | `style.css` `.pk-card`, `@keyframes pk-flip`; `ui.tsx` ballGlow |
| Summary as a scoreboard, not prose | Three big tiles (Spent / Worth / Net) using clear numerals, a small "$GBOOT +x" chip and the best-ball chip, then the prose line underneath. | 1.5 h | Low | `ballui.tsx:87-94` |
| Scuffed consolation beat | A dust puff, a crowd "aww", and "+1.86 $GBOOT · collection +1" ticking up. It must not imply an almost-win: no near-miss imagery. | 1 h | Medium (check against the ethics rule in `game/reveal.ts`) | `gfx/stage.ts` showReveal (rarity 0 branch) |
| Carousel "choose" moment | Show the ball bigger on a pedestal with its score multiplier ("×1 · Scuffed"), its trail preview, and swipe-to-browse. It is currently a plain 48px ball with text. | 2 h | Low | `ballui.tsx:149-169` BallCarousel; `style.css:250-256` |

---

## 8. HUD, menus, Modes, Results, shops, Cups: 5/10

Screens: `07-hud-penalties`, `07b-hud-strike`, `07c-hud-resolve`, `08-menu-hub`, `09-cups(-scrolled)`, `09b-odds`, `10-kitshop(-scrolled)`, `12-rules`, `13-settings`, `05-results-tutorial`, `05b-...-later` (the card flip), `06-modes`, `21-bigmatch-hud`, at both sizes.

**Good:**
- One consistent chunky pixel-panel language: striped green menu header, 2px borders, hard shadows, volt and gold tones.
- Menu icons are original pixel SVGs.
- The Odds table is the best-structured screen: tabular alignment and rarity chips.
- Results tiles read well at a glance, and the keeper-card flip is a nice touch.

**Weak:**
- **HUD clutter at the top centre.** The pot banner is 3 lines (value, USD, "on-chain snapshot · block 73,949,883 · ends in …" and a SIMULATED tag). It is the biggest HUD element in every frame, above both the score and the kick counter, and it hides commentary (BROKEN 1).
- **Menus are walls of text:**
  - Cups: a token glossary box, the pot paragraph, 10 rows, then Wildcard.
  - Ball shop: the "Before your first pack" glossary sits above the tiers, which sit above pack size. The Buy button and the ball display case (the most appealing visual) are below the fold.
- **No navigation between menus.** Sub-menus have no back-to-Menu button: × closes everything. `GameMenu` is the same element across menus, so switching menus has no transition.
- **Modes screen:** six text-only cards with no icon, art, lock art or progress. The NEXT GOAL pill is good.
- **Results:** there is no celebration choreography (no count-up, no star stamp). "Play again" is the primary button even when the NEXT GOAL is elsewhere.
- **Kit shop:** a list of text buttons with a 10px colour swatch and no preview of the item on the Friend.

**Gaps to 10:**

| Gap | Technique | Effort | Risk | Files |
|---|---|---|---|---|
| Pot banner as a single-line chip | A one-line chip ("🏆 500,000 RF ≈ $728 · SIM") in the top-left under the mode chip. Snapshot, block and ends go in a tap-for-details popover (odds menu). This also frees the commentary lane. | 1.5 h | Low: the tests read `pot`, `pot-usd` and `pot-age` test ids, which stay in the DOM | `index.tsx:1271-1275`; `style.css:47-56` |
| Shop order | Order the shop as: display case (hero, ball selection glow), then pack size, then the cost/max tiles with the Buy button, then the odds line. The first-pack explainer becomes a collapsible `<details>`, open only on first view. | 2 h | Low | `ballui.tsx` Shop (26-66); `index.tsx:1344-1350` |
| Back navigation and transitions | Add a "‹ Menu" button in the body header of sub-menus opened from the hub. Key the body by `menu` for a 150 ms slide or fade. | 1 h | Low | `index.tsx:1337` GameMenu children; `style.css:282` pk-menu-in |
| Results celebration | Tiles count up (400 ms, `steps()` easing to stay pixel-like), stars stamp in one by one with a thud sfx, unlock badges slide in. The primary CTA follows `nextGoal()`. | 2.5 h | Low | `ui.tsx` Results (242-273); `style.css` |
| Modes with art | A 32px pixel icon per mode (reuse keeper, wall and target sprites), a lock silhouette plus an XP bar for locked modes, and a best score per mode. | 3 h | Low | `ui.tsx` ModeSelect (125-135) |
| Kit shop preview | A live `BallSpin`-style mini canvas of the Friend wearing the hovered kit, boots or net. Use the existing `drawFriend` with a layers override. | 3 h | Medium | `index.tsx:1395-1407`; `gfx/friend.ts` |

---

## 9. Typography and numbers: 3/10

**Evidence:** `artifacts/audit/B/typo-glyph-sheet.png`.
- In Pixelify Sans, at every size from 11 to 24px and in both weights, **5 = S, 2 = Z, 8 = B, 0 = O**, and the bold C closes into O. Headings render as "OUPS" (Cups), "Soouting 8ook" and "8all shop".
- `measureText`: "1" is 3px wide and every other digit is 5px, at 8px and at 24px. The font has **no tabular figures**, so `font-variant-numeric: tabular-nums` (`style.css:371`) does nothing and numbers jitter.
- Canvas text is 8px `fillText` on a 480×320 buffer, scaled ×2.67 on desktop and ×1.2 on a phone. The result is anti-aliased mush: "SCORE" reads "SOORE", "KICK" reads "KIOK".
- The auditor misread these values while working: +120 as +180, 20 RF as 80 RF, "Level 2" as "Level 8", "kick 1/5" as "1/S", and the Market row "S1 · Park · 50 RF" shows S-prefixed edition codes next to "S0"-looking numbers.

**Every numeric display** (all Pixelify unless noted):

| Display | File:line | Risk |
|---|---|---|
| Pot value, USD, age, block number, "ends in 0d 7h 7m" | `index.tsx:1273-1274`; `game/prizes.ts:22`; `game/price.ts:80,96,107` | 500,000 reads as S00,000; money |
| HUD RF balance, Bag count, Unopened | `index.tsx:1280` | money |
| HUD LV / XP ("LV 2 · 44/200 XP") | `index.tsx:1281` | 2↔8 |
| Kick counter, timer, hits, streak ("kick 1/5", "12 s left") | `index.tsx:1260` kickLabel; `index.tsx:1284` | 5↔S |
| Wind label | `index.tsx:1284` windLabel | |
| Shot clock (bar only, no digits) | `index.tsx:1285` | ok |
| Canvas scoreboard (5 digits, 8px, flip) and "N IN A ROW" | `gfx/stage.ts:768-778` | illegible on phone |
| Canvas commentary text (may contain numbers) | `gfx/stage.ts:790` | |
| Target Practice ring values 100/200/500 and countdown | `gfx/setpieces.ts:225`, `gfx/setpieces.ts:240` | 5 and 2 |
| Wait overlay meter and copy | `gfx/waits.ts:12-13` | |
| Showreel titles and captions | `gfx/reelplayer.ts:111-129` | |
| Goal banner sub ("+120 points · side") | `index.tsx:846-847` | 2↔8 |
| Results tiles (goals/kicks, points, +XP) and the final line | `ui.tsx:249-253`; `index.tsx:964-980` | |
| Daily tiles (attempts, best, streak) and calendar days | `ui.tsx:176-180` | |
| Tour stars "★ 12/90", "1-3" level ids, "Free kick 25 m" | `ui.tsx:142,150,155` | |
| Odds line % (31.5 / 27 / 20 / 11 / 7 / 2.5 / 1) | `ballui.tsx:22` | 20% reads 80%; **odds** |
| Odds table (chance, RF value, $GBOOT drop) | `ui.tsx:91-92` | **odds** |
| Ball case (%, RF) | `ui.tsx:65` | |
| Stadium price table (RF, USD) and RF price line | `ui.tsx:107,116` | |
| Tier cards (10 / 1,000 / 10,000 RF, top prize) | `ballui.tsx:44-45` | |
| Pack size radios (1 / 2 / 5 / 10 balls) | `ballui.tsx:50-51` | 2 and 5 → 8 and S |
| Cost tile, max prize tile, Buy button "Buy pack · 20 RF", "Open N unopened" | `ballui.tsx:54-63` | **money** |
| Pack cards RF value, summary spent / pulled / net / $GBOOT / scuffed count | `ballui.tsx:84,89-92` | **money** |
| Bag counts ×n, per-ball RF, kicks, goals, top bins, "Redeem N RF" | `ballui.tsx:119,124,127` | money |
| Carousel "1 goals in 1 kicks" | `ballui.tsx:160` | |
| Collection ×n | `ballui.tsx:144` | |
| Market floor and ask | `ballui.tsx:181` | S0 / S1 versus 50 |
| Cups race table points, your rank, pot $GBOOT, Wildcard price, Skill Cup pot and entry, curve % | `index.tsx:1371-1391` | |
| Kit shop prices and balance, burned | `index.tsx:1396,1406` | |
| Settings: level, XP, stars, stamps, bests | `index.tsx:1429-1430` | |
| Scouting Book multipliers (×1.5, ×2, +50%, 100/200/500, ×5), keeper read % and ×mult, "0/12 stamped", "0/7 pulled", discovery "7/60" | `ui.tsx:188-207,232`; `index.tsx:1362` | |
| Practice page: "Kick 1 of 5", end "5 of 5", canvas scoreboard | `site-src/practice/main.ts`; `practice.css:18,42,75` | |

**Gaps to 10:**

| Gap | Technique | Effort | Risk | Files |
|---|---|---|---|---|
| Clear numerals everywhere in the DOM | Add a second `@font-face` for the family with `unicode-range: U+0030-0039, U+0025, U+002C, U+002E, U+002B, U+2212`, pointing at a pixel face with distinct, monospaced digits. Candidates (OFL): Departure Mono, VT323, Silkscreen. Pick one, then check 5/S, 2/Z and 8/B with `artifacts/audit/glyphs.mjs`. Every number changes without touching markup, and tabular alignment comes for free. | 1.5 h | Low (≈6 KB woff2 subset) | `style.css:2-3`; `site-src/practice/practice.css:2-3`; `games/penalty-kings/assets/` |
| Headings C/O and B/8 | Either render uppercase headings at weight 400, where C is open, or switch h2/h3 and chips to the same clear face. | 1 h | Low | `style.css:289,317,329,348` |
| Canvas digits as bitmaps | Add digits 0–9, `/ . , % × + -` to the 4×5 `GLYPHS` (or add a 3×5 set). Draw the scoreboard, target values, countdown and wait meter with `glyphText` at integer scale instead of 8px `fillText`. This also fixes the latent digit gap (BROKEN 6). | 2 h | Low | `gfx/stadium.ts:84-98`; `gfx/stage.ts:768-778`; `gfx/setpieces.ts:224-240`; `gfx/waits.ts:12` |
| Money formatting | Stable decimals and a thin space before the unit ("20 RF"). Right-align money in tiles. | 0.5 h | Low | `ballui.tsx:14`; `index.tsx:230` |

---

## 10. Sound (structural): 4/10

`audio.ts` synthesises a crowd, a per-stadium ambience and a chiptune loop. UI stingers come from the SDK `createFriendSoundKit`.

**Good:**
- Per-stadium ambience beds: park birdsong, Pro ultras drums, floodlight hum and rain, Champions anthem pad and claps.
- Music and ambience duck under reveals and stings.
- The reveal arpeggio pitch rises with the true rarity.
- The drumroll scales with the wait level.

**Weak:**
- **Off by default, with the toggle buried** (BROKEN 7). The judge video is also silent (`-an`).
- **About 70% of event names are dropped** (BROKEN 4): no whoosh on the strike, no keeper personalities on saves, no shot-clock beep.
- **No master bus.** Every `burst`, `tone` and `hit` goes to `context.destination`, with no DynamicsCompressor or limiter. Stacked roars clip (BROKEN 5).
- **Envelopes are soft for transients.** `burst` attack is `min(0.25, 0.2·dur)`, so the kick attack is 18 ms, the post clang 60 ms and the glove thud 24 ms. Percussive hits want 1–3 ms.
- **The post clang uses noise.** `playSfx("clang")` calls `crowd.post()`, a Q=9 noise burst. The tonal `clang()` exists but is never called.
- **Goal sound is a UI chime.** "net" maps to the SDK "reward" sparkle; there is no net-swish or ball-in-net thump.
- **Heartbeat** is one 120 Hz noise thud, not a lub-dub pair.
- **No variation.** `roar`, `groan` and `ooh` are identical every time (fixed freq, Q and gain). The ambience beds are static filtered noise with no LFO swell, so they sound like TV static. The music is one 16-note arpeggio on a fixed 180 ms tick, looping forever with no stadium or mode variation.
- **No silence before the kick.** At the run-up the stage calls heartbeat and whistle, but music and ambience are not ducked, and there is no hush or gap before the strike. The tension beat is lost.
- **No result stingers.** There is no distinct sound for a save, a miss (wide or over), a streak level-up or a star earned on Results. Only the crowd reacts.

**Gaps to 10:**

| Gap | Technique | Effort | Risk | Files |
|---|---|---|---|---|
| Audible by default | Unmute on the first user gesture (Kick off or Play already calls `unlockAudio`). Add a persistent 🔊/🔇 pixel toggle on the title screen and in the HUD `.pk-actions`. Remember the choice per session. | 1 h | Low: the SDK wants gesture unlock, which this keeps | `index.tsx:104`, `1006`, `1291-1301`, `1313`; `style.css` |
| Master bus and limiter | Route everything through a master gain, then a DynamicsCompressor (threshold −10 dB, ratio 8, attack 3 ms), then the destination. Add separate SFX, crowd, music and ambience buses. | 1 h | Low | `audio.ts` (burst/tone/hit targets); `index.tsx:262` |
| Map every Sfx | Add whoosh (bandpassed noise with a filter sweep of 1.2 kHz to 300 Hz over 180 ms), `honk`, `beep`, and 11 keeper signature voices (2–3 oscillators each: squeak = sine chirp up, yawn = saw glide down, blub = LP-filtered sine bubbles, and so on). | 3 h | Low | `index.tsx:416-426` playSfx; `audio.ts` new methods |
| Pre-kick hush | When aiming starts, duck ambience to 0.4 and music to 0.2. Cut to about 0.1 for 150 ms just before `STRIKE_AT`, then slam back on the result. | 1 h | Low | `audio.ts` duck; stage "strike" event in `index.tsx:~307` |
| Transients and variation | Give `burst` an explicit attack parameter (2 ms for kick, post and thud). Randomise ±8% filter freq, ±1.5 dB gain and a random noise offset per call. Build a 2–3-layer goal (thump + net swish + roar). Add a slow LFO on bed gain and cutoff for crowd swell. | 2 h | Low | `audio.ts` burst/bed/roar |
| Music variation | Per-stadium key or tempo, an A/B section every 8 bars, drop the arp during penalties and add a stinger on GOAL. | 2 h | Low | `audio.ts` startMusic |
| De-dup roars | Make `chant` its own sound (rhythmic claps plus a vowel-formant "oh-oh" band). Skip `sfx("roar")` on a top reveal, since `crowd.reveal()` already roars. | 0.5 h | Low | `index.tsx:420`; `gfx/stage.ts:362` |

---

## 11. Onboarding, tutorial and the no-wallet practice page: 5/10 (landing 2/10)

Screens: `01-title-cold`, `02-title-attract`, `03-tutorial-aim`, `04-tutorial-banner-GOAL`, `05-results-tutorial`, `practice-00-load/01-ready/02-strike/03-result/04-end`, and `landing-*` at both sizes.

**Timings** (headless, local):
- Practice: page load 0.1 s, shootable at **3.05 s**, first result at **5.3 s**, at both sizes.
- Game (SDK harness): title after about 1.7 s. The tutorial aim is available within about 1 s of "Kick off".

**Good:**
- The cold-open showreel.
- Big "Kick off" / "Skip intro ▸" buttons.
- A 3-kick tutorial that unlocks Free Kicks, World Tour, Daily and Target Practice, then introduces a rival keeper card.
- The practice page is honest ("FREE · NO WALLET"), the pitch is big, and the end card has clear CTAs.

**Weak:**
- **The landing page for a stranger with no wallet is a grey box** saying "No browser wallet found. Check for wallet" (`landing-1280x800.png`). The free practice link is a small underlined link in the top-right corner.
- **The tutorial coach text is a 6-line paragraph** (`03-tutorial-aim-*`) covering the striker at desktop and the crowd on phone. It explains aim, height, pace, fly-over and the trailing leg all at once, with no animated swipe hint on the pitch.
- **The attract screen stacks** the rule line and the SIMULATED paragraph under the CTA, in italic 11px.
- **Practice is too easy.** Five naive straight-ish swipes scored 5/5 with no near miss.
- **The practice end card is in the system mono font**, not the pixel type ("You scored 5 of 5." at 13px). The CTA sits under two paragraphs of text.
- **Practice has no visible target reticle or ghost-swipe demo** before the first touch.

**Gaps to 10:**

| Gap | Technique | Effort | Risk | Files |
|---|---|---|---|---|
| Landing that sells | When no wallet is found, render the showreel canvas (reuse `gfx/showreel.ts` and `reelplayer.ts`) behind a big "▶ Free practice: kick now" button. Put "Connect wallet to play with your Friend" second. | 3 h | Medium: the SDK host owns the frame, so wrap it outside in the landing HTML | `scripts/build-site.mjs` (landing index.html) |
| Coach marks | Replace the paragraph with 3 step toasts (kick 1: "Swipe up", kick 2: "Aim for a corner", kick 3: "Faster = pace"). Add an animated ghost hand or finger trail from the ball, drawn on the canvas, that disappears on the first touch. | 3 h | Low | `index.tsx` tutorial text source (grep "Tutorial: swipe up"); `gfx/stage.ts` add ghostSwipe |
| Practice difficulty curve | Use the keeper ladder (mouse, then a harder keeper for kicks 4–5) or the Director's difficulty so a first-timer lands 3–4 of 5, with at least one save shown. | 1 h | Low | `site-src/practice/main.ts` |
| Practice end card cohesion | Use Pixelify for headings with clear numerals, add a big score ("4 / 5") with the five result pips, and make the CTA the first element. | 1 h | Low | `site-src/practice/practice.css:75`; `main.ts` |
| Title clean-up | Keep one line under the CTA; move the rule and SIMULATED text into a single "ⓘ" chip. | 0.5 h | Low | `index.tsx:1308-1318` |

---

## 12. Scouting Book, submission README and README hero: 4/10

Screens: `11-book(-scrolled)-*`, `05b-results-tutorial-later-*`. Docs: `README.md`, `submission/README.md`, `docs/screenshots/judge-pack.png`.

**Scouting Book.** The idea is excellent: keeper cards with tells, read % and multipliers, a ball collection with ??? silhouettes, and a discovery meter. The execution is a scrolling modal of text cards:
- 64px keeper portraits drawn at 0.8 scale and 35% alpha when unseen, so they look like dim thumbnails;
- the "How scoring works" wall comes first;
- no page-turn or stamp animation when a keeper is stamped;
- no rarity-coloured glow on collected balls.

**README hero.** `README.md` has **no image, GIF or video at all**; the top is five blockquotes about pilot status and RF.

**`submission/README.md`:**
- The first image appears after about 60 lines.
- The video is a `.webm` link to a blob page, which does not play inline in a README.
- The 2×2 frame grid includes `judge-pack.png`, which shows **two Scuffed balls and "−20 RF"** in the ambiguous font (it reads as "−80 RF"). That makes the economy look like a loss machine.
- There is no character sheet (Friend + 12 keeper cast) even though the category claims "Character Spotlight". `docs/screenshots/keepers.png` exists but is not used.

**Gaps to 10:**

| Gap | Technique | Effort | Risk | Files |
|---|---|---|---|---|
| Hero GIF or MP4 at the top of both READMEs | Cut a 6–8 s loop (cold-open title → GOAL celebration → Golden Boot god-ray reveal from the Showroom, labelled "Showroom: every rarity") with Playwright's ffmpeg (palettegen/paletteuse, 480 px wide, < 3 MB). Commit it as `docs/media/hero.gif` and put it on line 3. | 2 h | Low | `scripts/record-judge-path.mjs` (add a GIF export); `README.md`; `submission/README.md` |
| Replace the Scuffed pack frame | Show `judge-pack` from a pull that includes a Gold, captioned "outcome as drawn (simulated)". Keep the two-Scuffed frame as a second "honest loss" frame so it is balanced rather than hidden. Re-shoot after the numeral fix. | 1 h | Low (keep the SIMULATED labels) | `scripts/record-judge-path.mjs`; `docs/screenshots/` |
| Character sheet | Add a "Cast" section: your Friend (the #7730 sample) on a pedestal, plus the 12 keepers from `keepers.png` with a name and one-line tell each. | 1.5 h | Low | `submission/README.md` |
| Book as a book | Two-page spread (keepers left, balls right), 2× crisp portraits at full alpha with a grey silhouette when unseen, a stamp slam when a keeper is stamped (sfx thud plus a rotation), rarity glow on pulled balls, and "How scoring works" collapsed into a tab. | 4 h | Low | `ui.tsx` ScoutingBook / KeeperCard / KeeperPortrait (187-234); `style.css` `.pk-book*` |

---

## Top 8 gaps by impact / effort

| Rank | Gap | Surfaces | Effort | Impact |
|---|---|---|---|---|
| 1 | **Clear numerals:** a `unicode-range` digit font override in the DOM plus bitmap digits on the canvas scoreboard and targets | 9, 7, 8, 11 | 3.5 h | Fixes misread money and odds ("20 RF" as 80, "20%" as 80%, "5" as S). This is an honesty issue as well as readability. |
| 2 | **Unhide the pot/commentary clash:** a one-line pot chip in the top-left, details on tap | 8, 11 | 1.5 h | Restores tutorial and Director commentary on every frame (BROKEN 1). |
| 3 | **Let the stage reveal play:** collapse or defer the DOM pack panel; pin the odds and honesty ribbon; add a fixed 800 ms sealed-pack tear | 7 | 5 h | Moves the gamble moment from about 4/10 to about 8/10. The best art is already built. |
| 4 | **Sound on after first gesture plus a visible toggle**, then map the dropped Sfx (whoosh, keeper voices, beep, honk) | 10 | 4 h | Turns the audio layer on for everyone and roughly doubles the per-kick feedback. |
| 5 | **Master bus with limiter, pre-kick hush, fast transients, de-dup roars** | 10 | 2.5 h | Removes clipping and makes every kick land. |
| 6 | **README and submission hero GIF, a balanced pack frame, a character sheet** | 12 | 4.5 h | This is the first thing judges see; there is no visual there today. |
| 7 | **No-wallet landing with an attract reel and a big "Free practice" CTA**, plus a practice difficulty curve and a pixel-type end card | 11 | 5 h | A stranger's first 5 seconds currently show a grey error box. |
| 8 | **Shop and Results hierarchy:** display case first, Buy above the fold, first-pack explainer collapsible; Results count-up, star stamps and NEXT GOAL as the primary CTA | 8 | 4.5 h | Reduces text walls and adds reward feel after every session. |
