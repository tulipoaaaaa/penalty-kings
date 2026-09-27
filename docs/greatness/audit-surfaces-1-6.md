# Penalty Kings: design audit, lane A (surfaces 1–6)

Branch: `claude/clever-mccarthy-ay7qv7` @ 274944f. Read-only; no tracked file was changed.
Captures: `A=artifacts/audit`
- Real SDK harness (testGame, price fixture, full motion, real swipes): `A/game-desk/` (1280×800) and `A/game-phone/` (844×390). Each has 20 title frames every 0.6 s, attract-a/b, and 3 tutorial kicks (aim, a canvas sequence every ~45 ms, and after-* DOM frames).
- Showroom (canvas at native 480×320, Friend = SDK sample #7730): `A/sr/`. Contact sheets are `A/S-*.png`, `A/sheet-kick*.png` and `A/phone-*.png`.
- Scripts: `A/capture-game.mjs`, `A/capture-showroom.mjs`, `A/sheet.mjs`.

## Scores (0–10)

| # | Surface | Wow | Read | Motion | Cohesion | Delight | **Overall** |
|---|---|---|---|---|---|---|---|
| 1 | Title / showreel / attract | 6 | 4 | 6 | 5 | 6 | **5.5** |
| 2 | The kick | 5 | 4 | 6 | 7 | 5 | **5** |
| 3 | Celebrations and reactions | 4 | 5 | 4 | 6 | 6 | **5** |
| 4 | 12 keepers + Final Wall | 6 | 5 | 5 | 8 | 8 | **6.5** |
| 5 | Stadiums + weather | 7 | 5 | 6 | 8 | 7 | **6.5** |
| 6 | Balls and rarity | 6 | 4 | 5 | 7 | 6 | **5.5** |

## BROKEN (bugs)
1. **The Cup pot banner hides the commentator on every screen.** The DOM `.pk-pot` sits at top-centre and is about 35 logical px tall. The canvas commentary box is drawn at y 26–48, also centred, so it sits directly underneath. The commentator is unreadable on the title, in play and on phone. See `game-desk/title-00.png`, `kick1-aim.png`, `kick1-after-0.png` and `phone-title.png`. Touches `gfx/stage.ts drawCommentary()` (y) or `style.css .pk-pot`. Fix: about 0.5 h, low risk.
2. **The attract title panel draws over the pot banner.** The pot text shows through the logo panel (`game-desk/attract-b.png`). Touches `style.css` (.pk-title z-order / top offset).
3. **The NET-CAM replay plays underneath the tutorial coach panel.** The replay's key action is covered (`game-desk/after-tutorial.png`, `phone-kick.png`). Hide `.pk-coach` while `stage.replayingNow`, in `index.tsx`.
4. **A missing file under /showroom/ crashes the dev server** (dev only). `dev/server.mjs` calls `writeHead(200)` before `readFile`. When the read fails, the catch calls `writeHead(404)`, which throws an uncaught `ERR_HTTP_HEADERS_SENT`. Reproduce with `curl localhost:PORT/showroom/nope.js`.
5. Minor issues:
   - The walk-out draws the Friend washed-out grey, which reads like a disabled sprite (`sr/walkout-*.png`).
   - The keeper-leg tell `leg!` / `LEG!` is raw text on the pitch and reads like debug output.
   - Cold open, first 2 s: the title plate "PENALTY KINGS" stacks on the Champions jumbotron "PENALTY KINGS", the caption and the commentator. That is four overlapping texts (`game-desk/title-00.png`, `title-02.png`).

## 1. Title / showreel / attract (the first 10 s)
Shots: `game-desk/title-00..19.png`, `attract-a/b.png`, `phone-title.png`, `S-reel.png`.
The block-dissolve cuts, stadium changes and keeper signature moments are good energy. But the first 10.08 s (logo, then Octavia, Boo, Bento, Chroma and the Final Wall) contain **no goal**. The big yellow logo only appears after "Skip intro".

| Gap | Technique | h | Risk | Files |
|---|---|---|---|---|
| No goal in the first 10 s | Reorder the MONTAGE: a 0.7 s logo slam, then a top-bin goal with the net-cam push, then keepers. Keep the Final Wall as the button. | 1.5 | low (showreel.test may pin the order) | `gfx/showreel.ts MONTAGE`, `tests/game/showreel.test.ts` |
| The logo "slam" is a small static plate | Big pixel logo scaling 1.6→1 (outBack), with 2 frames of shake, a floodlight flash and a dust ring. The logo cut hides the jumbotron text. | 2 | low | `gfx/reelplayer.ts drawOverlay()`, `apply()` |
| Stage direction shown as text ("*floodlights thunk on*") and caption clutter | Keep one caption per cut, drop stage directions, and make titles and captions never share space with the commentator | 0.5 | low | `gfx/showreel.ts`, `reelplayer.ts` |
| The big Friend in the foreground covers the ball and the goal mouth throughout | In reel cuts, use a camera push toward the goal (the Friend leaves the frame), or draw the Friend at 70 % scale at the lower left | 2 | low | `gfx/reelplayer.ts apply()`, `stage.ts drawFriendLayer()` |

## 2. The kick
Shots: `sheet-kick1a/b.png`, `sheet-kick2.png`, `sheet-kick3.png`, `kick1-zoom.png`, `kick2-zoom.png`, `S-goal.png`, `S-save.png`, `S-post.png`, `S-overwide.png`, `S-postzoom.png`.

| Gap | Technique | h | Risk | Files |
|---|---|---|---|---|
| **The Friend occludes the left third of the goal during flight.** Top-left saves happen behind its head (`S-save.png` 700–900 ms, `kick2-zoom.png`, `S-ballflight.png` r0). | After the strike, drop the Friend to about 45 % alpha and ease it 15–20 px down and left. Or move the penalty camera so the taker stands at the lower left edge. | 2–3 | low–med (the geometry test reads kickPose) | `gfx/stage.ts drawFriendLayer()`, `gfx/kick.ts PENALTY_VIEW / kickPose()` |
| The goal lands without impact. `resolve()` sets `camera.targetZoom = 1`, so the camera zooms **out** at the moment of the goal, and there is no goal hit-stop. | Add 90 ms of hit-stop, then a zoom punch to about 1.25 on the net point (targetX/Y = end), a stronger net impulse, and a 2-frame flash on the net only. Ease back after 0.6 s. | 2 | low | `gfx/stage.ts resolve()`, `gfx/core.ts Camera` |
| The strike flash whitens the **whole screen** (0.35 alpha fillRect; `kick1-seq-09-417ms.png`) | Replace it with a local contact star, 3 frames of hit-stop (about 50 ms) and 4–6 radial speed lines at the ball | 1 | low | `gfx/stage.ts play()` @STRIKE_AT, render (`flash` fillRect), `gfx/friend.ts drawContactFlash()` |
| The ball in flight is about 5 px with 1 px dotted trails, so it gets lost against busy crowds | Start the ball at r about 5 and shrink it with depth to 3. Add a 1 px dark outline and a ribbon trail: a polyline of the last 6 positions, rarity colour, tapering. | 3 | low–med | `gfx/stage.ts drawBallLayer()`, `gfx/ball.ts drawBall()`, `emitTrail()` |
| The keeper reads as late: the ball visually reaches the keeper while he still stands (`kick1-zoom.png` 606–655 ms) | Add a 1-frame anticipation crouch at the strike and draw the ball's arc to peak later (y ease-out), so screen overlap happens at the dive, not before it. Visual only; physics untouched. | 3 | med (physics=render contract) | `gfx/stage.ts penaltyBallArt()`, `gfx/keepers.ts lookFor()` |
| Post and bar hits are faint: no woodwork flash, and the wobble is barely visible | Flash the post white for 2 frames, show a clang burst sprite, increase `postWobble` amplitude, and add 60 ms of hit-stop | 1 | low | `gfx/stage.ts resolve()` post branch, `gfx/stadium.ts drawGoalFrame()` |

## 3. Celebrations and reactions
Shots: `S-celebA.png`, `S-celebB.png`, `S-react.png`, `S-finale.png`, `game-desk/kick1-after-0..3.png`, `kick3-after-1.png`.
All 8 celebrations are rigid transforms of the SDK's 4-direction walk frames. The knee-slide reads as "Friend fell over", and badge-kiss is barely visible. The miss/save/post reactions move 2–3 px and cannot be read. Keeper taunt bubbles are good but sit at a fixed spot.

| Gap | Technique | h | Risk | Files |
|---|---|---|---|---|
| The miss/save/post reactions are invisible | Triple the amplitudes. Add a hands-on-head overlay (2 small pixel "arm" rects like drawKickLeg), a sweat-drop particle, and a 0.4 s crowd "ooh" rise | 2 | low | `gfx/friend.ts reactionBeat()`, `drawFriend()` |
| Celebrations lack anticipation and follow-through | Give each beat a squash anticipation (0.1 s), overshoot and settle. The knee-slide should use `facing:"up"` with sy 0.7 and a grass spray, not the side walk frame. Add a heart pop to badge-kiss. | 3 | low | `gfx/friend.ts celebrationBeat()` |
| The goal hero moment is small: confetti from the net, a 12 px GOAL on the jumbotron | Stadium-wide beat: a crowd flash-card wave, a camera lift, and the jumbotron showing the Friend's sprite ×4 with "GOAL" | 3 | low | `gfx/stage.ts resolve()`, `gfx/stadium.ts drawProFx/drawChampionsFx`, `crowd.ts react()` |
| Celebrations end with a pose snap back to idle scale and position | Ease 0.25 s back to the kick-home pose | 1 | low | `gfx/stage.ts friendBeat()` / `drawFriendLayer()` |

## 4. The 12 keepers + THE FINAL WALL
Shots: `sr/keepers-sheet.png`, `S-kpidle.png`, `S-kpsave.png`, `S-wall.png`, `sr/cast.png`.
The silhouettes are strong and charming (mouse, sloth, peacock, octopus, mime, robot, ghost). The idle/cheer/taunt/sad frames differ by only 1–2 px. In game a keeper is about 20 px tall and sinks into the crowd noise; the octopus, ghost and chameleon lose contrast. Dive arms are drawn as long straight lines that look like a broom handle (`S-kpsave.png` octopus, peacock; `sheet-kick1b.png`).

| Gap | Technique | h | Risk | Files |
|---|---|---|---|---|
| Line-drawn dive arms | Stepped pixel arm segments (2 px, outlined) with a glove sprite at the end | 3 | med (arms are display-only, but check the hitbox overlay) | `gfx/keepers.ts keeperArms()`, `drawKeeper()` |
| Emotion frames are too subtle | Make taunt, sad and cheer distinct silhouettes: arms up, slump by 3 rows, a signature prop per keeper | 4–6 | low | `gfx/keepers.ts` designs / `lookFor()` |
| Keepers lack contrast in Pro/Champions | A 1 px dark outline on the keeper, plus a soft dark halo behind the goal (see 5) | 1 | low | `gfx/keepers.ts drawKeeper()` |
| The Final Wall does not feel like a boss: same footprint and a thin red tint | An entrance beat (a stomp with dust and shake), 1.3× in-game scale inside its hit mask, glowing eyes, a crumbling-brick particle burst on goals conceded | 4 | med (the scale must match the engine mask) | `gfx/stage.ts drawDivingKeeper()`, `gfx/keepers.ts`, `packages/engine keeper-rig` |

## 5. Stadiums + weather
Shots: `S-stad.png` (3 stadiums × 5 weathers), `S-stadbig.png`, `S-finale.png`, `S-moments.png`.
Pro (floodlights, tiers, tifo) and Champions (gold roof, trophy stage) look great at a glance. But the stands are high-frequency multicolour noise directly behind the goal. The lower 40 % of the pitch is empty flat stripes. Sunset only changes Park, and Pro/Champions sunset is identical to sun. Rain and snow are hard to see at 1×.

| Gap | Technique | h | Risk | Files |
|---|---|---|---|---|
| Crowd noise behind the goal | Value compression: darken and desaturate the band behind the goal mouth by 25–35 % (depth of field), with 3 values per tier | 3 | med (layer cache/perf) | `gfx/stadium.ts bowlShade()`, `paintPro/paintChampions`, `gfx/crowd.ts` draw |
| Flat pitch with no light | A floodlight pool (radial lighten) on the box, a vignette, mow-stripe perspective and specular wet pitch in rain | 2 | low | `gfx/stadium.ts drawPitch()`, `drawCameraGrade()` |
| Weather is weak and sunset is ignored at night stadiums | Denser, 2-layer rain/snow (near streaks are bigger), fog as a depth gradient, and a warm rim-grade for sunset in all stadiums | 2 | low | `gfx/stadium.ts drawWeather()`, `THEMES` |

## 6. Balls and rarity
Shots: `sr/ball-sheet.png`, `S-ballflight.png`, `S-revealA.png`, `S-revealB.png`, `sr/streak-fire.png`.
The ball sprites at 24/32 px are excellent: distinct patterns and a sheen sweep. In game (9 px) Silver, Standard and Scuffed are indistinguishable grey dots. Trails for rarities 1–5 are sparse 1 px dots. Reveals 1–6 share the same timing and only change colour, with the ball about 14 px inside a thick frame. Only the Golden Boot reveal escalates.

| Gap | Technique | h | Risk | Files |
|---|---|---|---|---|
| In-flight identity is lost | Per-rarity ribbon trail (see 2) plus a 1 px coloured rim glow for Pro and above | 2 | low | `gfx/ball.ts emitTrail()`, `drawBall()` |
| Reveal escalation is flat across tiers 1–6 | Tiered anticipation: charge time grows with tier, a shake at 5 and above, a ball at 32→48 px with a squash pop, and a tier-coloured shockwave ring | 3 | low (ETHICS: driven only by the RevealPlan) | `gfx/stage.ts drawReveal()`, `game/reveal.ts` plan fields |

## Top 8 gaps by impact/effort
1. **Move the commentary box out from under the Cup banner** (bug). `stage.ts drawCommentary` / `.pk-pot`. 0.5 h, low.
2. **Goal punch:** 90 ms hit-stop and a zoom-IN on the net point instead of zoom-out. `stage.ts resolve()`. 2 h, low.
3. **Replace the full-screen strike whiteout** with a local contact star, hit-stop and speed lines. `stage.ts play()`, `friend.ts drawContactFlash`. 1 h, low.
4. **Stop the Friend occluding the goal after the strike** (fade and ease aside). `stage.ts drawFriendLayer`, `kick.ts`. 2–3 h, low–med.
5. **Put a goal in the first 10 s of the cold open, plus a real logo slam.** `showreel.ts MONTAGE`, `reelplayer.ts`. 3 h, low.
6. **Bigger, outlined ball with a per-rarity ribbon trail.** `stage.ts drawBallLayer`, `ball.ts`. 3 h, low–med.
7. **Readable miss/save/post reactions, and celebrations with anticipation and follow-through.** `friend.ts reactionBeat / celebrationBeat`. 3–4 h, low.
8. **Value-compress the crowd behind the goal and add a floodlight pool on the pitch,** for keeper and ball readability. `stadium.ts bowlShade / drawPitch`, `crowd.ts`. 4–5 h, med.
