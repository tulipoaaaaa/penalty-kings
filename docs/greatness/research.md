# Penalty Kings: Polish Research (R1–R5 + Top 12)

Context: 480×320 logical canvas, drawn in code, shown at 960×640 (integer 2×) and on phones. WebAudio synthesised SFX. React DOM menus.

Timing convention: 1 frame = 16.7 ms at 60 fps. "(approx.)" means the figure comes from memory of talks, source dumps or frame-stepping footage, not from an official spec. Treat those as starting values to tune, not as facts.

Verified web facts in this pass: font licences (R3). Web fetch to itch.io, Google Fonts and departuremono.com was blocked by the sandbox proxy, so the font facts come from search-result summaries. Everything else is from domain knowledge.

---

## R1: Game feel and juice

Ranked by payoff for a one-shot kick game.

1. **Hit-stop (freeze frame) on the strike and on the net or post hit.**
   - Source: Vlambeer "sleep" trick (Nijman, *The Art of Screenshake*, INDIGO 2013); Celeste `Celeste.Freeze(0.05f)` on dash (from the decompiled source); fighting games use 6–12 frames on heavy hits.
   - Numbers: light 30–50 ms (2–3 f), medium 60–90 ms (4–5 f), huge 100–150 ms (6–9 f). More than 200 ms reads as lag. Scale with shot power.
   - Penalty Kings: freeze the sim for 50 ms at boot contact (keep drawing so the flash shows), 90 ms when the ball hits the net, 120 ms on a post clang. Audio keeps playing.

2. **Anticipation → impact → follow-through on the kick.**
   - Source: Disney's 12 principles as used in *Juice it or lose it* (Jonasson & Purho, GDC Europe 2012); Hades attack wind-ups.
   - Numbers: anticipation 80–150 ms (lean back, crouch squash 0.9 × 1.1); impact 1–2 f; follow-through 150–250 ms with ease-out overshoot.
   - Penalty Kings: after release, run the kicker's plant, leg-cock and strike frames before the ball leaves. Leg overshoots, then settles. The keeper starts his dive anticipation 60 ms before contact.

3. **Directional camera kick, then damped screenshake.**
   - Source: Nijman, *Art of Screenshake* (the "camera kick" and "screenshake" steps); the trauma model from Squirrel Eiserloh's GDC 2016 talk *Math for Game Programmers: Juicing Your Cameras With Math*.
   - Numbers: offset = maxOffset · trauma², with trauma in 0–1 decaying at about 1.5–2 per second. Max offset at 480 px wide: 3–6 px. Use Perlin/smoothed noise, not white noise. Kick the camera 2–4 px along the shot direction and recover with ease-out over 150 ms.
   - Penalty Kings: kick = +0.25 trauma, goal = +0.6, post = +0.5 plus a horizontal-only shake. Round the shake offset to whole logical pixels to avoid shimmer.

4. **White flash (1–2 frames) on contact.**
   - Source: Nijman ("hit flash"); Hades and Dead Cells enemy hit flash.
   - Numbers: 1 frame full white, 1 frame 50% tint; total 33–50 ms.
   - Penalty Kings: flash the ball sprite white on strike. Flash the post white on a clang. Flash the whole net white-cyan for 2 f on a goal.

5. **Squash and stretch the ball along its velocity.**
   - Source: *Juice it or lose it* (the ball stretch demo in their Breakout).
   - Numbers: stretch = 1 + min(speed/k, 0.5) along velocity, 1/stretch across it. Impact squash 0.6 × 1.4 for 2 f.
   - Penalty Kings: at 480 px, render the ball at 1.2–1.5× in its first 3 frames, then settle. Add a 2–4 px after-image trail (3 ghosts at 60/35/15% alpha).

6. **Easing everywhere; nothing linear.**
   - Source: Penner easing functions; *Juice it or lose it*; Balatro UI.
   - Numbers: UI enter easeOutBack (overshoot s = 1.7) over 250–350 ms. Exit easeInQuad over 150 ms. Values settle with a critically damped or slightly underdamped spring (ζ 0.5–0.7, ω 20–30 rad/s).
   - Penalty Kings: one `spring(value, target, vel, dt)` helper drives score pops, keeper dive settle, banners and the aim reticle.

7. **Particle hierarchy: few big, some medium, many tiny.**
   - Source: Vlambeer; Nuclear Throne; Hades VFX breakdowns.
   - Numbers per event: 1 primary shape (ring or shockwave, 150–250 ms), 3–6 secondary chunks (grass or turf, 300–500 ms, with gravity), 10–30 tertiary sparks (1 px, 200–400 ms, fade). Cap about 150 live particles for phones.
   - Penalty Kings: kick = turf chunks plus a dust puff. Net hit = white expanding ring plus net-knot sparks. Goal = confetti in team colours (1×2 px rectangles, rotating by flipping width and height).

8. **Stack cheap effects so no single one has to carry the moment.**
   - Source: Nijman's talk (30 or so tiny steps that add up); *Juice it or lose it*.
   - Numbers: a goal gets about 8 layers inside 400 ms: freeze, flash, shake, net bulge, confetti, crowd roar, stinger, banner.
   - Penalty Kings: build a `fx.goal(power)` recipe that fires every layer from one call. Use it as the tuning surface.

9. **Slow motion (time scale) on the decisive moment.**
   - Source: Peggle "Extreme Fever" (camera zooms in and slows as the ball nears the last peg, with a drum roll); Nidhogg's final-kill beat.
   - Numbers: time scale 0.25–0.35 over the last 12–20% of the ball's flight. Ease in over 100 ms, hold, snap back to 1.0 at impact (the snap is the punch). Keep the whole slow-mo under 700 ms real time.
   - Penalty Kings: when the shot outcome is uncertain (ball within 20 px of keeper hands or post), run bullet-time plus a 1.1× zoom toward the ball. Use it on at most 1 in 3 kicks so it stays special.

10. **Permanence: leave marks.**
    - Source: Nijman ("permanence": shells and corpses stay).
    - Penalty Kings: divots on the penalty spot, grass scuffs where the keeper landed, and a ball-shaped dent in the net that relaxes over 1.5 s. Across a session, keep a few past ball marks on the ad boards.

11. **Scale feedback with the player's skill (a crescendo).**
    - Source: Balatro (pitch and flame build as the score grows); Peggle's Ode to Joy only on the final peg; Vampire Survivors chest escalation.
    - Numbers: tie intensity to a 0–1 value such as `excite = f(power, cornerness, streak)`.
    - Penalty Kings: a top-corner screamer on a 5-streak should look about three times bigger than a bottom-middle tap-in. Drive every fx amplitude from `excite`.

12. **Eyes and faces (make things feel alive).**
    - Source: *Juice it or lose it* added googly eyes to Breakout blocks; Celeste's hair colour shows dash state.
    - Penalty Kings: the keeper's 2 px eyes track the ball. Crowd face pixels flip to open-mouth on a goal. The kicker gets a 3-frame fist pump.

13. **Input buffering and forgiving windows.**
    - Source: Celeste (coyote time about 0.1 s, jump buffer about 0.08 s; Matt Thorson's "Celeste and forgiveness" thread).
    - Penalty Kings: accept a swipe that starts up to 100 ms before the aim state is ready. Snap near-corner aim 2–3 px inward rather than punishing it.

14. **Zoom punch (small FOV or scale pulse).**
    - Source: Hades on crits; Rocket League on goal.
    - Numbers: scale 1.0 → 1.04 → 1.0 over 180 ms (easeOutQuad up, easeInOut back).
    - Penalty Kings: at 480×320, render the world to an offscreen canvas and draw it with a scale about the goal centre. Round to whole pixels or use nearest-neighbour.

**Reference clips**
- Celeste dash: 3-frame freeze (50 ms), then burst, hair colour change and screen-edge particles. Frame-step any dash in a 60 fps capture.
- Nuclear Throne or Vlambeer "Art of Screenshake" talk (YouTube, about 30 min): watch around 4:00–20:00 as the same shooter gains layers one by one. Each shot gets roughly 20–40 ms of "sleep" on hit (approx.).
- Peggle Extreme Fever: the ball approaches the last orange peg, slows to about 0.3×, a drum roll plays, then impact triggers the Ode to Joy blast, a rainbow and fireworks. Slow-mo lasts about 1–2 s; the celebration runs about 5–8 s.

---

## R2: Football games that nail the moment

1. **Net physics: the goal must visibly catch the ball.**
   - Source: FIFA/FC net cloth; Football Strike (Miniclip); Flick Kick Football.
   - Numbers: net as a grid of Verlet points (for example 12×6) with pinned edges and 2–3 constraint iterations. Impulse spreads over a 2–3 cell radius, peak bulge 6–10 px at 480 wide, settle over about 600–900 ms with damping 0.9–0.95 per frame.
   - Penalty Kings: draw the net as 1 px lines between Verlet nodes. The ball sinks into the bulge and drops. This is the single most "real" thing we can add.

2. **Slow-mo on the final approach plus a snap at impact.**
   - Source: Football Strike and Score! Hero; Peggle-style.
   - Numbers: see R1 #9 (0.3× for about 300–500 ms real time).
   - Penalty Kings: trigger on close calls: the keeper's fingertip within 12 px, or the ball within 8 px of the frame.

3. **Near-miss drama: the post clang is its own event.**
   - Source: FIFA/FC post sound; Flick Kick; real TV (the crowd "ooooh").
   - Numbers: metallic ring decaying 0.8–1.5 s, 90–120 ms freeze, post vibrates ±1 px for 300 ms, crowd "ohhh" swell starting about 150 ms after the clang and peaking at 600 ms.
   - Penalty Kings: add a distinct outcome tier "WOODWORK" with a banner and its own sound. Near misses make players try again.

4. **Fingertip save as a hero moment for the keeper.**
   - Source: FIFA save animations; Score! Hero.
   - Numbers: the ball deflects with 30–50% of its speed retained and a spin change. 60 ms freeze on touch. The keeper holds a stretch pose for 150 ms.
   - Penalty Kings: a "TIPPED!" state when the ball passes within 4 px of the glove edge. Add a ball-spin particle and a rising crowd groan.

5. **Crowd swell that follows tension.**
   - Source: Sensible Soccer (crowd roar on goal); PES/FIFA crowd ducking on penalties.
   - Numbers: bed at −24 dB during the run-up, dropping to −30 dB (near silence) just before the kick. On goal, +18 dB swell with a 150 ms attack, 2–3 s sustain and a 2 s release.
   - Penalty Kings: see R5. The dip is as important as the roar.

6. **Goal explosion as a player-owned signature.**
   - Source: Rocket League goal explosions (cosmetic, unlocked or bought, about 2 s long, pushes nearby cars away).
   - Numbers: a burst of about 1.5–2.5 s; the replay starts about 3 s after the goal.
   - Penalty Kings: unlockable goal-explosion cosmetics (confetti, fireworks, pixel lightning, "8-bit disco"). Cheap to make, strong motivation to collect.

7. **Instant replay with the right angle, and make it skippable.**
   - Source: Rocket League replays (skippable once all players vote); Score! Hero.
   - Numbers: replay 2–4 s, ball flight at 0.5×, "REPLAY" chyron in a corner, film grain or scanlines. Skippable on tap after 300 ms.
   - Penalty Kings: store the ball trajectory (60 samples) and keeper frames, then re-render from a side angle or a tighter zoom. Only replay screamers (excite > 0.7).

8. **Commentary timing through text callouts.**
   - Source: Sensible World of Soccer banners; FIFA commentary lands 300–800 ms after the event.
   - Numbers: first banner within 150 ms (punchy, one word: "GOAL!", "SAVED!", "POST!"). Second descriptor at 600–900 ms ("TOP BINS", "PANENKA", "SCREAMER 94 km/h").
   - Penalty Kings: two-tier banners. Word 1 pops with easeOutBack. Word 2 slides in under it with the shot stats.

9. **Swipe shape becomes the curve (Flick Kick style).**
   - Source: Flick Kick Football (swipe path controls curl), Football Strike, Score! Hero.
   - Numbers: curve from the lateral deviation at swipe mid-point. Power from swipe speed, clamped. Show a dotted aim guide that fades after the first few kicks.
   - Penalty Kings: let a curved swipe bend the ball. Show a live swipe trail (6–8 px thick, tapering) so the input feels connected.

10. **Mario Strikers "power shot" charge.**
    - Source: Mario Strikers Charged and Battle League (Mega Strike and Hyper Strike charge meters, timing-bar minigame).
    - Penalty Kings: a timing-bar "perfect strike" window of about 80–120 ms. A perfect hit gives extra shake, a golden ball trail and a guaranteed replay.

11. **Distinct outcome tiers with distinct audiovisual identities.**
    - Source: Score! Hero star ratings; Flick Kick target zones.
    - Penalty Kings: MISS / SAVED / POST / GOAL / TOP BINS / SCREAMER. Each tier gets its own colour, banner and stinger so players learn them by ear.

12. **Keeper personality and tells.**
    - Source: FIFA keeper pre-kick movement; Football Strike keeper sways.
    - Penalty Kings: the keeper shuffles, bounces or waves arms. Give him occasional readable tells (a lean 1 px left for 200 ms) so good players can "read" him.

13. **Scoreboard or "shootout board" drama.**
    - Source: TV penalty shootout graphics (ticks and crosses per kick); FIFA shootout UI.
    - Penalty Kings: a row of 5 dots that fill green or red with a pop. The decisive-kick dot pulses beforehand.

14. **Crowd camera flashes and pitch-side boards reacting.**
    - Source: FIFA/FC stadium effects; Rocket League arena lighting on goal.
    - Penalty Kings: random 1 px white flashes in the stands for 1 s after a goal. LED boards switch to "GOAL" and cycle colours.

**Reference clips**
- Rocket League goal: explosion about 0–2 s, "GOAL" UI plus scorer name about 0.5 s in, replay from about 3 s (skippable), kickoff countdown 3 s.
- Flick Kick Football: swipe, ball curl, net ripple about 0.5 s, "Goal!" banner and score tick-up about 0.8–1.2 s. Wall and target-bonus variants.
- Real shootout TV broadcast: silence and tight shot on the kicker (about 2–3 s), strike, a roughly 0.3 s reaction delay, then the roar with a crowd-shot cut within about 1 s.

---

## R3: Pixel-art excellence

1. **Integer scaling only; nearest-neighbour everywhere.**
   - Source: common practice in Celeste, Shovel Knight and Eastward.
   - Numbers: 480×320 → 960×640 is exactly 2×. On phones pick the largest integer that fits and letterbox the rest, or allow a fractional fit and accept slight shimmer.
   - Penalty Kings: `ctx.imageSmoothingEnabled = false` plus CSS `image-rendering: pixelated`. Round all draw positions: `Math.round(x)`.

2. **Silhouette first.**
   - Source: "silhouette test" (Team Fortress 2 art talk, Pedro Medeiros/Saint11 tutorials).
   - Penalty Kings: fill the kicker, keeper and ball solid black and check they still read. The keeper's arm span must read as a distinct shape against the net (add a 1 px darker outline on the keeper only).

3. **Limited, ramped palette (16–32 colours).**
   - Source: Celeste, Dead Cells (limited ramps); Lospec palettes such as PICO-8 (16), Endesga 32 and Resurrect 64.
   - Numbers: 3–5 shades per ramp, hue-shifted (shadows shift toward blue or purple, highlights toward yellow) by about 10–20° per step.
   - Penalty Kings: define `PAL` in one module. Grass ramp 4 steps, kit ramps 3 steps each. Kits swap by ramp index, not by hex.

4. **Hue-shifted shading, not black shading.**
   - Source: Saint11 tutorials; Sea of Stars; Owlboy.
   - Penalty Kings: player shadows are a dark green-teal on grass, never `rgba(0,0,0,.5)`. The stadium night mode shifts ramps toward blue.

5. **Readability at small sizes: key objects get the most contrast.**
   - Source: Dead Cells (Thomas Vasseur's 3D-to-pixel pipeline; the player always pops); Celeste.
   - Numbers: the ball needs the highest value contrast on screen. Keep 1 px dark outline plus 1 px specular. At 6–8 px diameter, draw it as a hand-placed sprite, not a circle fill.
   - Penalty Kings: desaturate or darken the crowd and background about 20–30% so the ball, keeper and aim marker own the contrast.

6. **Sub-pixel animation (shift colours, not positions).**
   - Source: classic pixel technique; Owlboy and Eastward idle breathing.
   - Penalty Kings: the keeper's idle bob moves shading 1 px rather than the sprite. The net sway fakes half-pixel motion with a mid-tone. Chest rise by colour swap on 2–3 px.

7. **Rarity colour-coding with fixed, learnable hues.**
   - Source: Diablo/WoW (grey, white, green, blue, purple, orange); Balatro editions (foil, holographic, polychrome, negative shaders); Marvel Snap card finishes.
   - Penalty Kings: ball and kit cosmetics use common = grey, rare = blue, epic = purple, legendary = gold (with an animated 1 px shine sweep every 2 s). Keep it consistent in menus and in game.

8. **Ordered (Bayer) dithering for gradients and fades.**
   - Source: Return of the Obra Dinn (1-bit dithering); Eastward sky gradients.
   - Numbers: a 4×4 Bayer matrix used as a threshold. Use it for sky, floodlight cones and screen transitions (dissolve with a dither mask over 250–400 ms).
   - Penalty Kings: floodlight cones and the vignette get dithered 2-colour bands. Screen transitions use a Bayer wipe.

9. **Lighting on pixel art: additive glow sprites plus palette-swap lighting.**
   - Source: Eastward (dynamic lights over pixel art); Sea of Stars (day and night cycle, dynamic lights); Dead Cells (normal maps from 3D).
   - Penalty Kings: night matches get floodlight glow (radial gradient, `globalCompositeOperation='lighter'`, quantised or dithered). Player sprites get a rim-light colour on the side facing the lights.

10. **Motion smears and multi-frame arcs instead of more frames.**
    - Source: Dead Cells and Hades attack smears; the Street Fighter III smear frame.
    - Penalty Kings: the kick leg gets a 1-frame smear arc (3–4 px wide, 2-tone). The keeper dive gets a 1-frame stretched body.

11. **Animation timing on holds (animate "on twos" with key-pose holds).**
    - Source: Celeste and Hollow Knight animation practice.
    - Numbers: idle 6–10 fps. Actions 12–15 fps with a longer contact frame (2–3× duration).
    - Penalty Kings: at 60 fps, strike pose holds 4 frames, other kick frames 2–3 frames each.

12. **UI pixel font at native size only.**
    - Source: general practice (Balatro renders m6x11 crisp and animates it per glyph).
    - Penalty Kings: draw canvas text at exactly 1× (or an integer multiple of) the font's design pixel size, snapped to whole pixels. In DOM, use `font-size` in multiples of the design size and `-webkit-font-smoothing: none` (only partly effective).

13. **Per-glyph text animation.**
    - Source: Balatro (wobbling or bouncing letters); Celeste dialogue.
    - Penalty Kings: "GOAL!" letters pop in staggered by 40 ms, each with easeOutBack, then sine-wobble 1 px at 4 Hz with a phase offset per letter.

**Legible pixel digits: font recommendations to replace Pixelify Sans for numbers**

Pixelify Sans is proportional and fairly decorative; its 5/S and 2/8 can blur at small sizes. For scores, timers, coins and km/h:

| Font | Licence | Why for digits | Source |
|---|---|---|---|
| **Departure Mono** (Helena Zhang) | SIL OFL 1.1 | Monospaced, so digits are naturally tabular. Clean, distinct 5/S and 2/8; slashed or dotted zero style. Pixel-perfect at multiples of **11 px**. Best overall for score and stats rows. | https://github.com/rektdeckard/departure-mono · https://departuremono.com |
| **monogram** (datagoblin) | **CC0** | Tiny monospace bitmap (about 5×7 cap), made for legibility at small sizes. Tabular digits by construction. 104 glyphs, 10 KB. Ideal for 480×320 HUD. | https://datagoblin.itch.io/monogram |
| **m5x7** (Daniel Linssen) | CC0 (credit appreciated) | 5×7 pixel font widely used in jams, with very clear numerals. | https://managore.itch.io/m5x7 |
| **m6x11 / m6x11plus** (Daniel Linssen) | Free with attribution (not OFL or CC0; check the itch page terms) | The Balatro font. Chunky, very legible digits, with proven "juicy" number feel. Use only if attribution in credits is acceptable. | https://managore.itch.io/m6x11 |
| **Pixel Operator / Pixel Operator Mono** (Jayvee Enaguas) | **CC0 1.0** | Has Mono and "8"-size variants. Clear, square numerals and unambiguous 0/O. | https://fontlibrary.org/en/font/pixel-operator · https://notabug.org/HarvettFox96/ttf-pixeloperator |
| **Jersey 10** (Sarah Cadigan-Fried) | SIL OFL | Sporty "jersey number" pixel display face on Google Fonts. Perfect thematically for big score numbers and shirt numbers. Proportional, so pad or center numbers. | https://fonts.google.com/specimen/Jersey+10 · https://github.com/scfried/soft-type-jersey |
| **Kenney Mini Square / Kenney Pixel (and Mono variants)** | **CC0** | Blocky, highly legible, has mono variants. | https://kenney.nl/assets/kenney-fonts |
| **Press Start 2P** (CodeMan38) | SIL OFL | 8×8 arcade classic with unambiguous digits. Wide, so use it only for short numbers or titles. | https://fonts.google.com/specimen/Press+Start+2P |

Recommendation: use **Departure Mono** for DOM menus and stats (OFL, tabular) and **monogram** or a hand-coded bitmap digit table for canvas HUD numbers. For the hero "3–2" scoreboard, use **Jersey 10** at an integer size. The zero-dependency option: a 12-entry array of 5×7 bitmaps drawn with `fillRect`. Give 5 a flat top and a hard corner, give 2 a flat base, and give 8 two stacked closed loops with a pinched waist. Total about 1 KB, crisp at every integer scale.

Licence note: search summaries confirmed OFL for Departure Mono and Jersey 10, CC0 for monogram and Pixel Operator, "CC0, credit appreciated" for m5x7 and "free with attribution" for m6x11. Direct pages were not fetchable from the sandbox, so re-check the licence file when vendoring.

**Reference clips or descriptions**
- Balatro score counting: m6x11 digits jitter and scale-pulse (about 1.0 → 1.2 → 1.0) on every chip or mult add, with a rising pitch. Numbers stay crisp because scaling happens on a pixel grid.
- Celeste title and chapter card: limited palette, hue-shifted ramps, dithered background gradients, integer-scaled 320×180.
- Dead Cells hit: 1-frame smear plus white flash plus a hit-stop of about 3–4 frames (approx.), with enemy readability kept by dark background values.

---

## R4: UI/UX polish and delight

1. **First kick within 5 s: boot straight into the pitch.**
   - Source: Flappy Bird, Crossy Road, Vampire Survivors (one button to start); mobile FTUE practice.
   - Numbers: time to first input under 2 s, first kick under 5 s, no modal before the first kick.
   - Penalty Kings: load straight into a playable penalty with a ghost-hand "swipe" hint (looping 1.2 s). Menus appear after the first result. Defer audio unlock to that first touch, which is required on iOS anyway.

2. **Teach by doing in under 10 s: one mechanic per kick.**
   - Source: Nintendo "kishōtenketsu" level-teaching; Score! Hero tutorial.
   - Penalty Kings: kick 1 teaches swipe = shoot. Kick 2 adds "swipe curve = bend". Kick 3 introduces the keeper actually diving. Hint text shows at most 4 words.

3. **Button press states with physical depth.**
   - Source: Balatro buttons, Marvel Snap, Duolingo 3D buttons.
   - Numbers: pressed = translateY(+2 px), bottom shadow from 4 px to 2 px, and brightness 0.95 in 1 frame (no transition on press, about 80 ms transition on release). Hover lifts 1 px and scales 1.02.
   - Penalty Kings: CSS: `:active{transform:translateY(2px);box-shadow:0 2px 0 var(--edge)}`, pixel-art bevels (1 px highlight top and left, 2 px shadow bottom). Play a quiet "tick" SFX on pointerdown, not on click.

4. **Number tick-ups with pitch and scale pulses.**
   - Source: Balatro (chips × mult counting); slot machines; Vampire Survivors gold counting; Peggle score bucket.
   - Numbers: count duration = clamp(200 ms + 40 ms × log2(delta), 300 ms, 1500 ms), easeOutCubic. Tick SFX every step at up to about 25 per second, with pitch rising 1 semitone per step up to +12. Scale pulse 1.15 on finish with a spring back.
   - Penalty Kings: coins and XP after each kick count up. The final digit lands with a "ding" and a sparkle.

5. **Pack or loot reveal: anticipation, tell, reveal.**
   - Source: Hearthstone pack opening (drag the pack to the centre; cards glow by rarity before flipping — orange for legendary, plus a special sound — so the rarity "tell" comes before the reveal); Marvel Snap (card upgrade "splits" and finish sweeps with a rising sound); Balatro booster packs (pack tears, cards fan out with bounce).
   - Numbers: anticipation 400–800 ms (shake intensifying), rarity glow tell 300 ms, flip 150–250 ms (scaleX 1 → 0 → 1 with face swap at 0). Legendaries get an extra 500 ms hold plus a light burst.
   - Penalty Kings: ball or kit crates shake, glow in the rarity colour, burst with pixel confetti, then the item bounces in. Let players tap to reveal each card (agency) and skip after the first.

6. **Screen transitions that hide loads and feel physical.**
   - Source: Celeste (circle wipe); Balatro (swirl); Sea of Stars.
   - Numbers: 250–400 ms total. Iris or circle wipe with easeInOutCubic, or a Bayer-dither wipe (R3 #8). Never block input longer than 400 ms.
   - Penalty Kings: an iris wipe centred on the ball when going to results; a dither wipe to menus.

7. **Micro-interactions on hover and idle.**
   - Source: Balatro (cards sway with sine and tilt toward the cursor); Marvel Snap (3D tilt).
   - Numbers: idle sway ±1–2° at 0.5 Hz with a phase per card; tilt up to 8° toward the pointer.
   - Penalty Kings: the ball select screen slowly spins and bobs the current ball. Shop items breathe with a 1 px bob.

8. **Juicy toggles and sliders.**
   - Source: Duolingo, Balatro settings.
   - Penalty Kings: the sound toggle plays the sound it toggles. The volume slider plays a tick at the new level.

9. **Result screen hierarchy: one hero stat.**
   - Source: Score! Hero star rating; Rocket League end screen (MVP).
   - Penalty Kings: show the stars or crowns first (staggered 150 ms, each with a stinger note up a scale). Coins tick up after. The "Next" button appears last and pulses once so the eye knows where to go.

10. **Streak display that raises stakes visibly.**
    - Source: Duolingo streak flame; NBA Jam "He's on fire!".
    - Penalty Kings: a streak counter with a flame that grows at 3, 5 and 10. At 5 or more the ball gets a fire trail and the music gains a layer.

11. **Respect the thumb (mobile ergonomics).**
    - Source: Apple HIG (44 pt minimum touch target); Material (48 dp).
    - Penalty Kings: all DOM buttons at least 44 CSS px on phones. Swipe zone is the bottom 60% of the screen. Pause and settings go in the top corners.

12. **Toasts and unlock pops with sound and haptics.**
    - Source: Vampire Survivors unlock banners; Marvel Snap.
    - Numbers: `navigator.vibrate(10–20)` for taps, `[30,40,60]` for goals (Android only; iOS Safari ignores it).
    - Penalty Kings: a small haptic on kick contact and a double-pulse on goal.

13. **Reduced-motion and "juice level" settings.**
    - Source: accessibility practice; Celeste Assist Mode.
    - Penalty Kings: read `prefers-reduced-motion` and scale down shake and flash (keep hit-stop). Cap flashes at 3 per second (WCAG 2.3.1 limit).

**Reference clips or descriptions**
- Hearthstone pack: drag the pack to the centre (about 0.5 s), burst, 5 face-down cards whose glow colour reveals rarity. Click each card to flip (about 0.3 s); a legendary triggers an extra glow burst and voice line.
- Balatro hand score: each card trigger lifts the card about 10% with a spring, flies a "+chips" number, ticks the counter up and raises the pitch. The final chips × mult total "slams" with a flame effect if it beats the blind. Each trigger is roughly 0.2–0.4 s (approx.; speeds up with the game-speed setting).
- Marvel Snap card upgrade: press-and-hold charges (about 1 s), the card cracks, the frame breaks and a finish sweep plays. Accompanied by a rising sting.

---

## R5: Sound design (procedural WebAudio that sounds premium)

1. **Layer every hero sound: transient + body + tail.**
   - Source: standard game audio practice (e.g. GDC audio talks; Hades and Celeste SFX).
   - Numbers: kick = (a) click: 3–8 ms highpassed noise (>2 kHz); (b) thump: sine 160 → 50 Hz exponential pitch drop over 80–120 ms, amplitude attack 1 ms and decay 150 ms; (c) leather slap: bandpass noise at 1–1.5 kHz, Q about 1, 40 ms.
   - Penalty Kings: `sfx.kick(power)` sums the three layers. Power scales thump gain (+6 dB) and lowers its end frequency a little.

2. **Randomise pitch and gain on every play.**
   - Source: universal practice (Wwise and FMOD randomisers).
   - Numbers: pitch ±3–6% (about ±1 semitone), gain ±1.5 dB, filter cutoff ±10%. Never play two identical kicks in a row.
   - Penalty Kings: `rand(0.95,1.05)` on `playbackRate` or oscillator frequency. Randomise the noise buffer start offset.

3. **Silence before the big kick (the tension dip).**
   - Source: film sound ("the absence of sound"); FIFA/PES shootout crowd ducking; real stadium hush.
   - Numbers: when aim locks, duck the crowd 10–14 dB over 600–800 ms and low-pass it to about 800 Hz. Keep only a faint heartbeat (55–60 Hz sine thumps, 70–90 bpm) at −28 dB. Contact restores full-band audio instantly.
   - Penalty Kings: a `tension` parameter (0–1) drives crowd gain, low-pass cutoff and heartbeat. The contrast makes the goal roar enormous.

4. **Crowd bed with tension dynamics.**
   - Source: football game crowd systems (EA FIFA "crowd layers": ambient, anticipation, reaction).
   - Numbers: 2–3 looping noise layers. Pink or brown noise → bandpass formant pairs (about 500 Hz and 1.2 kHz, Q 2–4) to suggest "ahh". Slow random gain LFO 0.1–0.3 Hz ±3 dB for murmur. Goal roar: +18 dB, 150 ms attack, formants shift up (to about 700 Hz and 1.5 kHz), 2–3 s hold, 2 s release. "Ohhh" on near miss: formant glide downward over 800 ms.
   - Penalty Kings: build one `crowd` graph with `targetLevel` and `vowel` params and ramp them via `setTargetAtTime` (time constant 0.05–0.4 s).

5. **Pre-impact whoosh.**
   - Source: film and game foley (sword swings, Hades dash).
   - Numbers: noise → bandpass sweeping 400 Hz → 3 kHz over the 120–180 ms before contact, gain rising from −30 to −12 dB, cut at contact. For the ball in flight, a Doppler-ish whoosh: bandpass centre tracks ball speed and gain tracks closeness to the goal.
   - Penalty Kings: leg-swing whoosh during the anticipation frames. A quieter "air rip" follows fast shots.

6. **Net swish with a filter sweep.**
   - Source: foley practice.
   - Numbers: white noise → bandpass 5 kHz → 2 kHz sweep over 250–350 ms, Q about 0.7. Add a soft low "thud" (sine 90 Hz, 60 ms) for the ball hitting the back of the net.
   - Penalty Kings: net sound gain scales with the Verlet bulge amplitude.

7. **Post clang with inharmonic partials.**
   - Source: modal synthesis. A free–free bar's partial ratios are about 1 : 2.76 : 5.40 : 8.93.
   - Numbers: fundamental 700–900 Hz, 4 sine partials at those ratios. Decays 1.5 s / 0.9 s / 0.5 s / 0.3 s (higher partials die faster). Add a 5 ms noise click and a slight detune (±3 cents) for beating.
   - Penalty Kings: `sfx.post()`; the crossbar gets a lower fundamental than the posts. Pair it with the crowd "ohhh".

8. **Musical stingers tied to streaks, climbing the scale.**
   - Source: Peggle (pitch rises per peg hit in a shot; Ode to Joy on the final peg); Balatro (rising pitch per score trigger); Tetris Effect.
   - Numbers: goal stinger = major triad arpeggio, 60–80 ms per note, square or triangle wave with a 5 ms attack and 200 ms decay. Each streak level transposes up 2 semitones (cap at +12). At 5+ add an octave and a vibrato (5 Hz, ±10 cents).
   - Penalty Kings: `stinger(streak)`. A miss plays a descending minor second (a "wah-wah") at low volume, never punishing.

9. **Master bus: gentle compression plus a limiter.**
   - Source: standard mastering practice.
   - Numbers: `DynamicsCompressorNode` threshold −18 dB, knee 12, ratio 4, attack 0.003 s, release 0.25 s. Final "limiter" compressor with threshold −3 dB, ratio 20, attack 0.001 s. Target peaks around −1 dBFS.
   - Penalty Kings: all SFX → sfxBus. Crowd → crowdBus (sidechain-style ducking by automating crowd gain −4 dB for 150 ms on each kick). Both → master compressor → destination.

10. **Convolution-free reverb.**
    - Source: Schroeder/Freeverb topology (parallel feedback combs plus series allpasses); feedback delay networks.
    - Numbers: 4 `DelayNode` combs (29.7, 37.1, 41.1, 43.7 ms) with feedback gains 0.7–0.8 and a lowpass (about 3 kHz) in each loop (damping), summed into 2 allpass-ish short delays (5 and 1.7 ms, feedback 0.5). Wet at −14 to −18 dB for a "stadium" feel. Alternatively one slapback delay at 120–180 ms, feedback 0.2, lowpassed to 2 kHz: it reads as a stadium echo and is very cheap.
    - Penalty Kings: send only the crowd, post clang and stingers to the reverb. Keep the kick dry for punch.

11. **Proper envelopes: no clicks, exponential decays.**
    - Source: synthesis fundamentals.
    - Numbers: always ramp from 0.0001, never 0. Use `exponentialRampToValueAtTime` for decays and `setTargetAtTime` for smooth moves. Minimum attack 1–2 ms to avoid clicks. `stop()` the source only after the envelope reaches silence.
    - Penalty Kings: one `env(gainNode, a, d, s, r)` helper used by every SFX.

12. **Noise shaping: pink or brown instead of white.**
    - Source: common synthesis practice.
    - Numbers: brown noise = integrate white noise (`last = (last + 0.02*w)/1.02`, then ×3.5). Pink via the Paul Kellet filter. Pre-render 2 s buffers once at boot, loop them and randomise the start offset.
    - Penalty Kings: crowd = pink, rumble or thump tails = brown, sparks and net = white highpassed.

13. **Subtle saturation for warmth and loudness.**
    - Source: analogue emulation practice.
    - Numbers: a `WaveShaperNode` with tanh curve (k about 2–3) on the kick and stingers, `oversample='2x'`. Adds harmonics so the thump reads on phone speakers, which cannot reproduce under about 150 Hz.
    - Penalty Kings: add a 2nd harmonic (sine at 2× the thump frequency, −10 dB) so the kick is audible on phone speakers.

14. **Time audio against the visuals.**
    - Source: film sound sync; Nijman's talk (sound is half the feel).
    - Numbers: impact sound must fire on the contact frame, not after hit-stop. Schedule with `ctx.currentTime + 0.005`. The crowd reaction lags 150–300 ms (human reaction). Stinger at 100–200 ms.
    - Penalty Kings: the event bus timestamps the contact. Audio fires immediately; visuals freeze. That split sells the impact.

15. **Mute-safe and resumable.**
    - Source: iOS WebAudio constraints.
    - Penalty Kings: `ctx.resume()` on first pointerdown. Handle `visibilitychange` by suspending. Persist mute. Keep a master volume around −6 dB below full scale by default so juicy peaks have headroom.

**Reference clips or descriptions**
- Peggle Extreme Fever: drum roll during slow-mo (about 1–2 s), silence for 1 frame, impact, then Ode to Joy with fireworks. Per-peg hit pitch climbs a scale within a shot.
- FIFA/FC penalty: the crowd hushes from roughly 1 s before the kick with whistles and scattered shouts, then the net ripple is followed about 0.2–0.4 s later by a full roar and commentator.
- Balatro scoring: each card trigger plays a short "chip" sound pitched up a step. The final total "slam" has a low thump plus a sizzle when on fire.

---

## Top 12 overall (ranked by impact ÷ effort for a 1–2 day window)

| # | Change | Effort | Why |
|---|---|---|---|
| 1 | **Hit-stop** on contact (50 ms), net (90 ms) and post (120 ms), with audio not frozen | 1 h | Biggest feel gain per line of code |
| 2 | **Crowd tension dip then roar** (duck 12 dB and low-pass before the kick, +18 dB swell on goal) | 2–3 h | Makes every goal feel huge through contrast |
| 3 | **Trauma-based screenshake plus directional camera kick**, pixel-snapped | 1–2 h | Standard juice; scales with `excite` |
| 4 | **Layered kick SFX** (click + pitch-dropping thump + slap) with ±5% pitch random and a 2nd harmonic for phones | 2 h | Replaces "beep" feel with a premium thud |
| 5 | **Verlet net bulge** plus net swish sweep | 3–4 h | The signature football moment |
| 6 | **Post clang tier** (modal partials, freeze, shake, "ohhh", "WOODWORK" banner) | 2 h | Near-miss drama drives "one more go" |
| 7 | **Two-tier goal banner** with per-glyph pop and wobble ("GOAL!" then "TOP BINS · 94 km/h") | 2 h | Commentary timing without VO |
| 8 | **Swap numeric font**: Departure Mono (OFL) in DOM and a monogram or bitmap digit table on canvas | 1–2 h | Fixes 5/S and 2/8 legibility; tabular scores |
| 9 | **Slow-mo on close calls** (0.3× for the last about 400 ms, snap back at impact, at most 1 in 3 kicks) | 2 h | Creates fingertip-save and near-miss tension |
| 10 | **Number tick-ups** with rising-pitch ticks and a finish pulse; **button press states** with depth plus a tick SFX | 2–3 h | Menu and reward polish players feel immediately |
| 11 | **Streak stingers** (arpeggio transposed +2 st per streak) plus a fire trail at 5+ | 2 h | Rewards skill, builds a session arc |
| 12 | **Instant boot into a playable kick** with a ghost-swipe hint; menus after the first result | 2–4 h | Delivers the first kick within 5 s |

Stretch goals if time remains: skippable replay for screamers, rarity-glow crate reveal, Bayer-dither transitions, Schroeder "stadium" reverb send, keeper eye-tracking.
