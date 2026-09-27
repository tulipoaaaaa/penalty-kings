# Design greatness round (Part B)

The goal is to close the gap between "good" and "great" where a judge's first 30 seconds are decided.

**Inputs:**
- [research](greatness/research.md) (R1 juice, R2 football moments, R3 pixel art, R4 UI/UX, R5 sound);
- [audit of surfaces 1–6](greatness/audit-surfaces-1-6.md) and [audit of surfaces 7–12](greatness/audit-surfaces-7-12.md). Both are read-only, with screenshots at 1280×800 and 844×390 on build `274944f`, which already includes the `ee923c2` polish.

**Rules for every build:**
- Before/after screenshots go in `docs/screenshots/greatness/`.
- Reduced motion turns off shake, flash and slow-mo.
- Soak test: p95 frame time under 25 ms, and no page errors.
- At most +100 KB gzipped in total.
- Original art only. The Friend's canonical sprite is layered, never redrawn.
- CI must be green before every push.
- Builds start only after Bug Quest P0 and all P1s are merged and green.

## Baseline scores (0–10, before)

| # | Surface | Wow | Read | Motion | Cohesion | Delight | **Overall** |
|---|---|---|---|---|---|---|---|
| 1 | Title / showreel / attract | 6 | 4 | 6 | 5 | 6 | **5.5** |
| 2 | The kick | 5 | 4 | 6 | 7 | 5 | **5** |
| 3 | Celebrations and reactions | 4 | 5 | 4 | 6 | 6 | **5** |
| 4 | 12 keepers + THE FINAL WALL | 6 | 5 | 5 | 8 | 8 | **6.5** |
| 5 | Stadiums + weather | 7 | 5 | 6 | 8 | 7 | **6.5** |
| 6 | Balls and rarity | 6 | 4 | 5 | 7 | 6 | **5.5** |
| 7 | Pack → reveal → Bag → choose | 4 | 3 | 4 | 5 | 3 | **4** |
| 8 | HUD, menus, Modes, Results, shops, Cups | 5 | 4 | 4 | 6 | 4 | **5** |
| 9 | Typography and numbers | 5 | 2 | 5 | 7 | 4 | **3** |
| 10 | Sound (structural audit) | 3 | 4 | 4 | 5 | 3 | **4** |
| 11 | Onboarding + practice (landing page alone: 2) | 4 | 6 | 6 | 5 | 4 | **5** |
| 12 | Scouting Book, submission, README hero | 3 | 5 | 3 | 5 | 4 | **4** |

## Bugs the audits found (tracked in [BUG-QUEST.md](BUG-QUEST.md) as BQ-X items)

| ID | Bug | Status |
|---|---|---|
| BQ-X1 | The pot banner hides the commentator strip | = BQ-P1-11, **fixed** in `7877c4d` (the strip drops below the banner) |
| BQ-X2 | The pack panel (`.pk-pack`) hides the canvas reveal (spotlight, rays, rarity banner) | open, fixed by build B5 |
| BQ-X3 | The pack summary scrolls the odds and honesty lines out of view | open, fixed by B5 |
| BQ-X4 | About 14 of the 20 `Sfx` names are silent (whoosh, 11 keeper save voices, shot-clock beep, honks) | open, fixed by B3 |
| BQ-X5 | Roars stack (goal + chant, Golden Boot ×2) with no limiter | open, fixed by B3 |
| BQ-X6 | The attract title panel overlaps the pot banner | open |
| BQ-X7 | The net-cam replay plays under the tutorial coach panel | open |
| BQ-X8 | The canvas `GLYPHS` font has no digits (a number drawn with it is blank) | open, fixed by B4 |
| BQ-X9 | `flipCard` / `revealAll` have side effects inside a `setPack` updater (double-fire under StrictMode) | open |
| BQ-X10 | Dev only: `dev/server.mjs` crashes on a missing Showroom file (sends a 200 header before reading) | open (P2) |

## The greatness list (ranked by impact ÷ effort)

| Rank | Build | Surface | Gap (from the audits) | Technique (source) | Impact 1–5 | Effort (h) | Risk | Main files |
|---|---|---|---|---|---|---|---|---|
| 1 | **B1 Goal moment** | 2, 3 | The camera zooms *out* at the goal; no hit-stop; a full-screen white strike flash | Hit-stop of 50 ms on contact, 90 ms on the net and 120 ms on the post (Vlambeer "Art of Screenshake"; Nijman). Zoom-in camera punch on the net point. Trauma-based pixel-snapped shake (Eiserloh). Local contact star in place of the full-screen flash. Net bulge and ripple (Verlet grid, R2). Confetti tuned per stadium | 5 | 5 | low | `gfx/stage.ts` resolve/play, `gfx/core.ts` Camera, `gfx/friend.ts` drawContactFlash |
| 2 | **B3 Sound pass** | 10 | 14 silent SFX, stacked roars, no bus, sound off by default with the toggle buried in Settings | Master compressor/limiter bus; a crowd hush before each kick (duck about 12 dB, then a +18 dB swell on the goal); layered kick (click + pitch-dropping thump + slap, ±5 % pitch); a metallic post clang; wire every `Sfx` name; one roar per event; sound on after the first gesture, with a visible toggle on the title and HUD (R5) | 5 | 6 | low–med | `audio.ts`, `index.tsx` playSfx, `gfx/stage.ts` sfx calls |
| 3 | **B4 Legible numbers** | 9 | Pixelify Sans: 5≈S, 2≈Z/8, 8≈B, 0≈O; no tabular digits ("20 RF" reads as 80) | A `unicode-range` digit override with an OFL/CC0 pixel font with tabular digits (Departure Mono, OFL, is the candidate; verify the licence file before adding); bitmap digits on canvas for the scoreboard, timers and targets (R3) | 5 | 3.5 | low | `style.css` @font-face, `practice.css`, `gfx/stadium.ts` GLYPHS, `gfx/stage.ts` scoreboard |
| 4 | **B5 Pack reveal owns the stage** | 7 | The DOM panel covers the canvas reveal; small 0.35 s flips; odds scroll away | Collapse the panel while the stage reveal runs. A sealed-pack "tear" of 800 ms, then a flip per ball with glow by rarity tier, light rays for Gold and up, and a stinger per rarity (Hearthstone, Marvel Snap, Balatro, R4). ≤ 6 s in total, skippable, with an odds/honesty strip pinned outside the scroll | 5 | 5 | med | `ballui.tsx` PackOpening, `index.tsx` pack sequence, `style.css` .pk-pack, `gfx/waits.ts` |
| 5 | **B2 Near-miss drama** | 2, 3 | Post and bar hits are faint; saves have no "almost" | Post CLANG (hit-stop 120 ms, tremor, spark, "WOODWORK!" banner); keeper fingertip deflection spin; a "SO CLOSE" beat; slow motion (0.3×) on the last ~400 ms of a close call, at most 1 in 3 kicks (Peggle's extreme fever, R1/R2) | 4 | 3 | low | `gfx/stage.ts`, `gfx/ball.ts`, `audio.ts` |
| 6 | **B10 Money shot + README hero** | 12 | No hero image or GIF anywhere; first submission image comes after 60 lines; no cast sheet | A 15 s money-shot clip (cold-open goal → post clang → Golden Boot reveal → streak fever) as a small webm plus a GIF for the README tops; a cast sheet from `docs/screenshots/keepers.png` | 5 | 3 | low | `scripts/record-judge-path.mjs` (new money-shot mode), `README.md`, `submission/README.md` |
| 7 | **B6 Streak fever** | 3 | Streaks are text only | Fever states at 3, 5 and 10 (heat shimmer, fire trail, crowd chant, stinger arpeggio transposed +2 semitones per step) (Peggle, R1/R5) | 3 | 2 | low | `gfx/stage.ts`, `audio.ts` |
| 8 | **B7 Ball readable in flight** | 6 | The ball is ~5 px in flight; Silver, Standard and Scuffed look identical; 1 px trails | Bigger in-flight sprite with a 1 px outline, and a ribbon trail in the rarity colour (R3 colour-coding) | 4 | 3 | low–med | `gfx/stage.ts` drawBallLayer, `gfx/ball.ts` |
| 9 | **B8 Cold open leads with a goal** | 1 | The first 10 s are a logo plate plus five keeper cuts; no goal | Logo slam → top-bin goal with the net-cam push within ~4 s → keepers; decluttered text in the first 2 s | 4 | 3 | low | `gfx/showreel.ts` MONTAGE, `gfx/reelplayer.ts`, `tests/game/showreel.test.ts` |
| 10 | **B9 UI feel** | 8 | No press states or transitions; Results are static | Consistent press/hover (2 px depth), 150–250 ms eased screen transitions, count-up reward tiles with rising ticks, NEXT GOAL as the primary Results button (R4) | 3 | 3 | low | `style.css`, `ui.tsx` Results |
| 11 | B11 Friend eases aside in flight | 2 | The Friend hides the left third of the goal during the ball's flight | Fade to ~45 % and ease aside after the strike | 3 | 2.5 | med (a geometry test reads the kick pose) | `gfx/stage.ts` drawFriendLayer, `gfx/kick.ts` |
| 12 | B12 Celebrations with follow-through | 3 | Rigid transforms; the knee-slide reads as "fell over" | Anticipation → overshoot → follow-through on reaction/celebration beats (Jonasson & Purho, R1) | 3 | 4 | low | `gfx/friend.ts` |

**Deferred unless time remains:**
- darker crowd band behind the goal, and a floodlight pool and vignette (4–5 h, performance risk);
- weather polish;
- keeper arm shapes and a Final Wall boss presence;
- skippable replay of screamers;
- practice difficulty (5/5 naive swipes is too easy) and the practice end card in pixel type;
- shop layout (display case first, Buy above the fold);
- Scouting Book visual pass.

**Build order**, after Part A P0/P1 are green: B1 → B3 → B4 → B5 → B2 → B10 (recorded after B1–B5) → B6 → B7 → B8 → B9. B11 and B12 are cut first if time runs short. Feature work stops at Sep 29 10:00 UTC.

## After (filled in as builds land)

| # | Surface | Before | After | Shipped |
|---|---|---|---|---|
| (filled at the freeze) | | | | |
