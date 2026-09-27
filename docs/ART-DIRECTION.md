# Penalty Kings: art direction

**Goal:** a pixel-art penalty shootout that people screen-record. It should feel like a
Sunday-league match on TV: crowds that react, weather, commentary, and a shot that lands like a
punch. **The player's Rare Friend is the star.** Its canonical on-chain sprite is never redrawn,
recoloured or distorted.

## Rendering rules

| Rule | Why |
|---|---|
| **Internal canvas 480 × 320** (3:2), integer-upscaled with `imageSmoothingEnabled = false`, `image-rendering: pixelated` | Every pixel stays crisp at 960 px and on a 360 px phone |
| All art is **palette-indexed pixel arrays drawn in code** (no external images) and cached as sprite canvases | Tiny bundle, sandbox-safe, easy palette swaps |
| **Layer order:** sky → far stands (parallax 0.3) → crowd (parallax 0.5) → ad boards → pitch → goal back net → keeper → goal frame → ball → striker → FX → canvas UI (scoreboard, commentator) → DOM HUD | Readable depth; the striker and goal are never covered |
| The Friend is drawn at **4× (64 px)**, the largest character; keepers at 3×; crowd at 1× | Character Spotlight |
| **Friend art is sacred:** only whole-sprite transforms (translate, rotate, squash/stretch, flip) and **separate layers around it** (shadow, boots, headband, cape, trails, sparkles) | Canonical artwork preserved |
| **Crowd of little Friends:** the player's own canonical frames (idle/walk, facing down), downscaled nearest-neighbour to 8–12 px, black mask + 1 px halo in supporter colours, pre-rendered per stadium into one atlas; flags, big PK flags, scarves, banners and the Champions cards are held above/beside the sprite. Motion is continuous-time and eased, snapped to whole pixels; reduced motion drops hops, ripples and cloth waves. Original crowd until the sprite loads | The stands belong to Rare Friends without inventing Friend-like characters or reading anyone else's Friend |

## Palettes

- **Park, sunny Sunday league:** sky `#7ec8ff → #c9ecff`; grass `#4caf50 / #43a047` stripes;
  wooden boards `#8d6e63`. Accents are ice-cream pink `#ff8fab` and kite yellow `#ffd23f`.
- **Pro, floodlit night:** sky `#0b1030 → #1c2a5c`; grass `#2e7d32 / #276b2b`. Floodlight glow
  `#fff6c8` at 25% alpha, flare smoke `#ff5a6e` / `#7fd3ff`, LED ticker `#ccff00` on `#0b0d1a`.
- **Champions, golden arena:** sky `#1a0f00 → #3d2600`; grass `#3b8f3f / #327a36`; gold
  `#ffd23f / #b8860b`, pyro `#ff8c00`; the giant screen frame is `#222`.
- **UI:** ink `#0b0d1a`, paper `#f7f7f2`, volt `#ccff00` (primary action), gold `#ffd23f`
  (rewards), red `#ff5a6e` (miss / live). Simulated values always carry the gold `SIM` chip.
- **Ball rarities:**

  | Rarity | Base | Accent | Trail |
  |---|---|---|---|
  | Scuffed | `#8a7a66` | `#5b4f40` | dust puff |
  | Training | `#f2f2f2` | `#f08a24` | neon streak |
  | Match | `#ffffff` | `#2a6fdb` | clean |
  | Pro | `#ffffff` | `#16a34a` | blue sparkle |
  | Silver | `#d7dde5` | `#8a96a8` | comet |
  | Gold | `#ffd23f` | `#b8860b` | gold sparkle and rays |
  | Golden Boot | `#ffe680` | `#ff8c00` | fire trail, screen-edge glow |

## Motion principles

1. **Anticipation → action → follow-through.** Every run-up has a squash before the step, and
   every dive a crouch before the stretch.
2. **Hit-stop sells impact.** 2 frozen frames (~70 ms) on the strike and on every save or post.
3. **Easing:**
   - `easeOutBack` for things that land: banners, numbers, rank changes;
   - `easeInOutCubic` for the camera;
   - `elastic` for net and post wobble;
   - `bounce` for fallen balls.
4. **Camera:**
   - trauma-based shake (`shake = trauma²`, decaying about 1.8/s);
   - a push-in on the build-up, a punch-in on the strike frame, and ball-follow in flight;
   - 0.35× slow-mo when the ball is within 15% of the frame, and on last-ditch saves.
5. **Particles are pooled** (cap 500) and skipped when frame time exceeds 20 ms.
6. **Reduced motion:** no shake, flashes, slow-mo or screen-edge glow, and 25% of the particles.
   Every beat still reads through pose, colour and text.

## The shot (≈ 3.2 s)

| Beat | Time | What happens |
|---|---|---|
| Build-up | 0.0–0.7 s | Crowd audio ducks, a heartbeat thump, camera pushes in 6%, keeper bounces and taunts |
| Run-up | 0.7–1.2 s | 3 steps with squash and a dust puff each; the Friend's shadow tracks |
| Strike | 1.2 s | 2-frame hit-stop, white flash (skipped in reduced motion), ball squash, shockwave ring, whoosh |
| Flight | 1.2–~2.2 s | Curling arc, rarity trail, spinning ball, camera eases to the goal, keeper dives with stretch frames |
| Outcome | ~2.2–3.2 s | GOAL / SAVE / POST / OVER sequences (below) |
| Reaction | after | Celebration or reaction pose, crowd and commentary, reset |

**Outcome sequences:**
- **GOAL:** the net spring-mesh bulges, confetti in the stadium colours, a crowd wave and roar,
  the scoreboard flips digit by digit, and a Friend celebration.
- **SAVE:** a glove spark, the ball deflects with spin, the keeper's victory pose and taunt
  bubble, and a crowd groan.
- **POST:** a clang, slow-mo, the post vibrates (elastic), and the crowd goes "ooooh".
- **OVER:** the ball sails into the stands, and a fan jumps up and catches it.
- **Streaks:** ×2 adds a heat shimmer over the pitch; ×3 sets the ball on fire, and the crowd
  chant gets louder.

## Character roster: 12 keepers (all original)

| Keeper | Look | Gameplay |
|---|---|---|
| Squeak the Mouse | Tiny grey mouse, pink ears, oversized gloves | Can't reach the top corners |
| Nibbles the Squirrel | Orange, bushy tail, twitchy | Leans to his side during your run-up |
| Snooze the Sloth | Brown, sleepy eyes, long arms, floating Z | Huge reach, barely dives |
| Peacock Pete | Teal and blue, tail fan | Fans his tail toward the side he's faking |
| Octavia the Octopus | Purple, four arms | Covers one third completely; inks the ball on a save |
| Marcel the Mime | Striped shirt, white face, beret | Invisible wall across a third, shimmer hint |
| Disco Dee | Afro, flares, mirror-ball sparkle | Dives on the beat, left then right |
| Big Bento | Round sumo in a mawashi | Fills the centre; stomps shake the camera |
| Chroma the Chameleon | Green, curly tail | Invisible until the kick |
| K-33P | Boxy robot, antenna, visor | Learns your favourite corner; scan-line tell |
| Boo the Ghost | Pale sheet, hollow eyes | Blinks (teleports) to the ball |
| THE FINAL WALL | Brick golem, glowing eyes, crown | Skill Cup boss: guards the middle, then reads you, then covers everything |

## Crowd cast (20+ types, procedurally varied)

Regular fan, drummer, flag-waver, kid on shoulders, grumpy pundit with notepad, confetti-thrower,
sleeper, phone filmer, foam finger, mascot, trumpeter (band), nan knitting, scarf-twirler,
face-painted fan, twins, dad with hot dog, streamer, balloon kid, mega-fan with a flag cape and
the pitch-invader cat. Heads, skin, shirts and accessories are palette-swapped per seat, so rows
never tile. Each type reacts differently: cheer, groan, both hands on the head, jump, point, or
sleep through it. A Mexican wave runs on streaks.

## Stadiums

- **Park:**
  - kites, dog walkers and an ice-cream van;
  - puddles with reflections and a wooden scoreboard;
  - birdsong ambience.
- **Pro:**
  - floodlight cones with moths, and coloured-smoke flares;
  - an LED ticker with in-game jokes, and drums.
- **Champions:**
  - a giant screen replaying your shot, and pyro on goals;
  - a trophy on a plinth, ticker tape and a fireworks finale.
- **Weather:**
  - chosen by day of the week (UTC), overridable in Settings;
  - sun, rain (puddle ripples, slick sheen), snow (orange ball, flakes), fog, or sunset.

## Typography

**Pixelify Sans** (SIL Open Font License 1.1). It's bundled inside the game, because the sandbox
CSP blocks remote fonts, and credited in the README.

**Numbers (B4):** Pixelify's digits read as letters (5≈S, 2≈Z/8, 8≈B, 0≈O) and are not tabular. Digits and
number punctuation (`0-9 + , - . % × −`) come from **Departure Mono** v1.500 by Helena Zhang (SIL Open Font
License 1.1, `games/penalty-kings/assets/DepartureMono-OFL.txt`) through a `unicode-range` face on the same
`PixelifySans` family, so letters stay Pixelify and every number changes without touching markup. Menu headings
(h2/h3) use it too (`PKHead`), because Pixelify's bold C closes into O. The vendored file is a 1.6 KB subset
(`departure-mono-pk-subset.woff2`: digits, number punctuation, A–Z; copyright and licence kept in its name table)
of the official release `DepartureMono-1.500.zip` (woff2 sha256 `5b4fed1d…038cfb`). On the canvas, numbers are
drawn with the bitmap digits of the 4×5 `GLYPHS` font (`gfx/stadium.ts`): scoreboard, streak, target values and
the shot-clock countdown.
