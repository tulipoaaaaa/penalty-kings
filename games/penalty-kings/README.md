# Penalty Kings

Your hardwired Rare Friend is the striker. Buy balls with RF, reveal each ball's rarity, then
flick it past one of four original keepers. Built with **FriendSDK v0.1.2**.

> **Preview economy is SIMULATED.** RF balances, balls, rewards, $GBOOT, the Cup pot, race
> tables and rivals in the preview are simulated and reset on reload. The wallet connection
> and the hardwired-Friend ownership gate are real (SDK runtime).

**Your kick never changes what you win — ball rarity is decided by on-chain randomness. Skill is
for glory, streaks and the leaderboard.**

## Run

```sh
npm ci
npm run dev            # friendsdk dev ./games/penalty-kings  →  http://localhost:4173
npm run build:site     # static site in site/ (Park at /, Pro at /pro/, Champions at /champions/)
```

Requires a browser wallet on Robinhood mainnet (chain 4663) holding a hardwired Rare Friends
Generations NFT (generation ≥ 1).

## Controls

| | Touch / mouse | Keyboard |
|---|---|---|
| Aim | drag up from the ball — direction | ← → |
| Power | drag length (meter beside the ball; red = over the bar) | hold Space, release to shoot |
| Curl | curve the flick | A / D |
| Loft | — | ↑ ↓ |
| Place ball · Warm-up · Continue | buttons | Enter · W · Enter on the reveal |

Warm-up kicks are free and give no score or rewards. Mute and reduced motion are in Settings.
The game pauses whenever the runtime menu is open.

## Rules

1. **Buy balls** in the Kit bag (one SDK consumable per stadium).
2. **Place a ball**: the SDK `play` + `settle` actions draw its rarity. The rarity fixes its RF
   redemption value (kept in your Locker, no expiry), its $GBOOT drop and its score multiplier.
3. **Shoot.** Deterministic pseudo-3D flight (aim, height, curl) resolves goal / save / post /
   over / wide against a seeded keeper dive.
4. **Score** = 100 × keeper multiplier × ball multiplier × streak (×1, ×1.5, ×2 … capped at ×3).
   A save or miss resets the streak. Rounds are 5 kicks; 3+ goals unlocks sudden death at ×2.

### Keepers (original 16 × 16 art)

| Keeper | Style | Score × |
|---|---|---|
| Showboat | commits before you strike, big early dives | 1 |
| Octopus | random guesses, very long reach | 1.25 |
| The Wall | holds the middle, fills the goal | 1.5 |
| Ghost | waits, then reads your aim | 2 |

## Stadiums and odds (identical odds, 90.00% return)

| Ball | Chance | RF value × price | Park 10 RF | Pro 1,000 RF | Champions 10,000 RF | $GBOOT drop × |
|---|---:|---:|---:|---:|---:|---:|
| Scuffed Ball | 31.5% | 0 | 0 | 0 | 0 | 1 |
| Training Ball | 27% | 0.5 | 5 | 500 | 5,000 | 1.5 |
| Match Ball | 20% | 1 | 10 | 1,000 | 10,000 | 2 |
| Pro Ball | 11% | 1.5 | 15 | 1,500 | 15,000 | 3 |
| Silver Ball | 7% | 2.5 | 25 | 2,500 | 25,000 | 5 |
| Gold Ball | 2.5% | 5 | 50 | 5,000 | 50,000 | 8 |
| Golden Boot Ball | 1% | 10 | 100 | 10,000 | 100,000 | 15 |

Every purchased ball reserves the top prize (10 × price) until settled; kept balls stay backed
with no expiry. `game.json` is the Park definition; `tiers/*.json` hold all three. The SDK
runtime runs one chance-game definition per session, so each stadium is its own build/page.

Base $GBOOT drop (simulated preview, launch price 0.01 RF): Park 13, Pro 1,395, Champions 13,953
× the rarity multiplier (average 2.15×, ≈ 2.8% of the ball price).

## Assets

All art is original and drawn in code: pitch, crowd, goal, four keepers, ball, UI. The Friend is
drawn from its canonical on-chain Generations sprite (SDK sprite reader), unaltered. The crowd of
little Friends is that same sprite (the player's own; no other Friend is read), downscaled
nearest-neighbour with its pixels unaltered, with flags, scarves and banners held around it. UI sounds
use the FriendSDK sound kit (code-synthesised, see its NOTICE); crowd/kick sounds are synthesised
noise in `audio.ts`. No real clubs, crests, players or brands.
