# Penalty Kings

Your hardwired Rare Friend steps up to the spot: buy balls with $RAREFRIENDS, reveal each
ball's rarity, and flick it past four original keepers, while a $GBOOT game token trades
against RF.

**Builder:** tulipo · CONTACT_TBD · **Category:** Economy Potential (also fits Character
Spotlight and Token Activity) · **SDK:** FriendSDK v0.1.2

[Source code](https://github.com/tulipoaaaaa/penalty-kings) ·
[Game rules](https://github.com/tulipoaaaaa/penalty-kings/blob/main/games/penalty-kings/README.md) ·
[Economy design](https://github.com/tulipoaaaaa/penalty-kings/blob/main/docs/ECONOMY.md) ·
[Deployment record](https://github.com/tulipoaaaaa/penalty-kings/blob/main/docs/DEPLOYMENT.md)

**One sentence:** Penalty Kings makes your Rare Friend the striker in a pixel-art penalty
shootout where every ball is bought with RF and carries an on-chain-random rarity. That rarity
sets its RF redemption value and its drop of $GBOOT, a fixed-supply game token paired with RF.

## Play

**Playable preview (simulated economy):** https://tulipoaaaaa.github.io/penalty-kings/
(Pro stadium: `/pro/` · Champions: `/champions/`)

Requires a browser wallet on **Robinhood mainnet (4663)** holding a **hardwired Rare Friends
Generations NFT (generation ≥ 1)**. The SDK's real wallet connection and ownership gate run
before play. The preview needs no RF, signature or transaction.

- **Aim and shoot, touch:** drag up from the ball. Direction aims, length sets power (the meter
  turns red when the ball will clear the bar), and curving the flick adds curl.
- **Aim and shoot, keyboard:** ← → aim, ↑ ↓ loft, A / D curl, hold **Space** to charge and
  release to shoot.
- **Buttons:** Kit bag (buy balls), Place ball, Warm-up (free practice, no rewards) and Menu
  (Locker, keepers, Cups, Kit shop, Stadiums, Rules, Settings).
- **Settings:** mute and reduced motion. The game pauses whenever the runtime menu is open.

## Rules and rewards

**All balances, purchases, rewards, $GBOOT amounts, Cup pots, race tables and rivals in the
preview are SIMULATED** and reset on reload. The runtime starts each session with 20 simulated
RF.

> **Your kick never changes what you win — ball rarity is decided by on-chain randomness.
> Skill is for glory, streaks and the leaderboard.**

1. **Buy balls** (the SDK consumable) in one of three stadiums:
   - Park: **10 RF**;
   - Pro: **1,000 RF**;
   - Champions: **10,000 RF**.
2. **Place a ball.** The SDK `play` + `settle` actions draw its rarity. The rarity fixes three
   things:
   - its RF redemption value (kept in your Locker, no expiry);
   - its $GBOOT drop;
   - its score multiplier.
3. **Shoot** at one of four original keepers (Showboat, Octopus, The Wall, Ghost). The flight
   and dive are deterministic and seeded, and resolve as goal / save / post / over / wide.
4. **Score** = 100 × keeper × ball multiplier × streak (capped at ×3). Rounds are 5 kicks, and
   3+ goals unlocks sudden death at ×2.

| Ball | Chance | RF value (× price) | Park | Pro | Champions | $GBOOT drop |
|---|---:|---:|---:|---:|---:|---:|
| Scuffed Ball | 31.5% | 0 | 0 RF | 0 RF | 0 RF | ×1 |
| Training Ball | 27% | 0.5 | 5 RF | 500 RF | 5,000 RF | ×1.5 |
| Match Ball | 20% | 1 | 10 RF | 1,000 RF | 10,000 RF | ×2 |
| Pro Ball | 11% | 1.5 | 15 RF | 1,500 RF | 15,000 RF | ×3 |
| Silver Ball | 7% | 2.5 | 25 RF | 2,500 RF | 25,000 RF | ×5 |
| Gold Ball | 2.5% | 5 | 50 RF | 5,000 RF | 50,000 RF | ×8 |
| Golden Boot Ball | 1% | 10 | 100 RF | 10,000 RF | 100,000 RF | ×15 |

- **Return and backing:** expected RF return is **exactly 90.00%** in every stadium, asserted
  in CI. Each purchased ball reserves the 10× top prize until it settles, and kept balls stay
  backed with no expiry. When a stadium's bank is full, the game says "Stadium full — try
  another" before any purchase.
- **$GBOOT drops:** base × rarity multiplier, where the base is Park 13, Pro 1,395 and
  Champions 13,953 at launch. The average drop is worth ≤ 3% of the ball price, and the live
  rate auto-scales with the $GBOOT price, so RF plus drops stays **≤ 93%**. Buying balls is
  never a profitable farm.
- **Golden Boot Cup (weekly):** the top 10 Friends by Gold and Golden Boot balls drawn,
  weighted by stadium. It is verifiable from on-chain settle events.
- **Skill Cup (weekly, simulated):** the best 5-kick shootout against Ghost, re-verified by a
  replay referee.
- **Sinks:**
  - cosmetics (boots, halo kits, net colours, 6 celebrations) are bought with $GBOOT and
    burned;
  - Wildcards and Skill Cup entries are 50% burned and 50% to the pot.

## Economy (RF-paired token)

**$GBOOT:**
- 1,000,000,000 fixed supply; no owner, mint, tax or blacklist.
- 60% pool liquidity (locked), 30% ball-drop treasury, 10% Cup, 0% team.

**Pool:** Uniswap v4 $GBOOT/**RF** with a 1% fee. Every outside buyer goes ETH → RF → $GBOOT.
That adds RF buy pressure and pays the Rare Friends 5% WETH fee to active Friend holders.

**Where the 10% edge goes:** each stadium's weekly surplus is half **burned as RF** and half
paid to the Cup. Pool fees follow the same split: the RF side is burned and the $GBOOT side
goes to the Cup.

**Full design:** [docs/ECONOMY.md](https://github.com/tulipoaaaaa/penalty-kings/blob/main/docs/ECONOMY.md)
covers the money-flow diagram, prize-bank capacity and solvency maths (simulated), pool growth
(×2 needs about 2.6M RF), the farm check, a 50 / 500 / 5,000-player scale table and the
roadmap.

**Live contracts (optional extra, real RF):** see
[docs/DEPLOYMENT.md](https://github.com/tulipoaaaaa/penalty-kings/blob/main/docs/DEPLOYMENT.md).
Nothing is claimed live unless a verified transaction is linked there.

## Run it

Node.js 22+ on Linux or Ubuntu/WSL2.

```sh
git clone https://github.com/tulipoaaaaa/penalty-kings.git
cd penalty-kings
npm ci
npm run dev          # http://localhost:4173 — connect a wallet holding a hardwired Friend
npm run build:site   # static site in site/ (Park /, Pro /pro/, Champions /champions/)
```

## Checks, credits and limitations

**Checks, all run locally on 2026-09-27 and passing:**
- `npm run typecheck`
- `npm run check` (FriendSDK game validation: expected reward 9 RF per 10 RF ball, max 100 RF)
- `npm run verify:odds` (all three stadiums: 10,000 bps, EV 90.00%)
- `npm run test:engine` (5 physics tests)
- `node scripts/economy-sim.mjs` (solvency, pool maths and farm-check assertions)
- `npm run test:smoke` (FriendSDK browser harness at 960 px and 360 px)
- `npm run test:game`: buy → place → reveal → shoot → HUD update at 960 px and 360 px, with
  zero console errors
- `npm run secret-scan`

The same checks run in GitHub Actions.

**Known issues and limitations:**
- Browser tests use the SDK's mocked wallet and RPC. A real-wallet playthrough as a hardwired
  Friend is still outstanding.
- The simulated preview starts with 20 RF, which buys two Park balls. Warm-up kicks are
  unlimited, and the Pro and Champions pages are reference builds that the preview wallet
  cannot afford.
- The sandbox cannot open links, so the in-game stadium selector shows each stadium's path.
- Persistent progress is not supplied by the SDK, so preview progress resets on reload.

**Risks:** live mode (if linked in DEPLOYMENT.md) uses real RF and real wallet transactions. Dice
RNG costs ≤ 0.000025 ETH per request plus gas. Token-priced random rewards need legal review.
Official production publication needs separate Rare Friends review.

**Assets:** all art is original and drawn in code:
- the pitch, crowd, goal and ball;
- four 16 × 16 keepers.

The Friend is its canonical on-chain Generations sprite (FriendSDK sprite reader), unaltered.
UI sounds come from the FriendSDK sound kit, and crowd and kick sounds are synthesised in code.
No real clubs, crests, players or brands appear.
