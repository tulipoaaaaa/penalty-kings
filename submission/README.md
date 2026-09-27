# Penalty Kings

Your hardwired Rare Friend is the striker in a pixel-art football game. You swipe to shoot
penalties and free kicks against 12 original keepers. In the Big Match you open packs of balls
bought with $RAREFRIENDS; each ball's rarity comes from on-chain randomness and sets its RF value.

**Builder:** tulipo · contact **@phon_ro** · **Category:** Economy Potential (also fits
Character Spotlight and Token Activity) · **SDK:** FriendSDK v0.1.2 · UX shaped by founder feedback

[Source code](https://github.com/tulipoaaaaa/penalty-kings) ·
[Economy design](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/ECONOMY.md) ·
[Ball market design](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/BALL-MARKET.md) ·
[Deployment record](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/DEPLOYMENT.md) ·
[Action-flow audit](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/FLOW-AUDIT.md)

**One sentence:** Penalty Kings makes your Rare Friend the striker in a skill-based pixel-art
shootout. The optional Big Match sells packs of balls for RF whose rarity is decided by
on-chain randomness: every ball is backed by RF and redeemable, and it drops $GBOOT, a
fixed-supply game token designed to pair with RF.

## Play

**Playable preview (simulated economy):** https://tulipoaaaaa.github.io/penalty-kings/
(Pro stadium: `/pro/` · Champions: `/champions/`)

The preview requires a browser wallet on **Robinhood mainnet (4663)** holding a **hardwired Rare
Friends Generations NFT (generation ≥ 1)**. The SDK's real wallet connection and ownership gate
run before play. The preview needs no RF, signature or transaction; every purchase and reward
in it is **SIMULATED** and labelled.

**Controls**
- **Touch / mouse:** swipe up from the ball. Where you release aims the shot and the reticle
  shows the landing point; speed sets the pace; bending the swipe curls the ball.
- **Keyboard:** arrow keys aim, A / D curl, W / S topspin (free kicks), hold **Space** to charge and
  release to shoot.
- **Quick shot** button; **Menu** (Bag, Ball shop, Cups, Scouting Book, Rules, Settings).
- **Settings:** mute, reduced motion, haptics. The game pauses whenever the runtime menu is open.

**Free modes (skill only, no RF):**
- tutorial (3 coached kicks);
- Penalties against a ladder of 12 keepers, each with a stamp in the Scouting Book;
- Free Kicks: a wall, wind, curl and knuckleballs, with wall heights by stadium;
- Target Practice: 60 s, combos, crossbar bonus;
- World Tour: 30 data-driven levels with 3-star objectives;
- Daily Challenge: the same scenario for everyone that day.

A difficulty director keeps goal rates in a 55–65% band.

**Big Match (optional, RF):**
1. **Buy** a pack of 1 / 2 / 5 / 10 balls.
2. **Open** it (the SDK `play` + `settle`).
3. **Reveal** the balls one by one or all at once. You see the true totals: spent, pulled, net.
4. Keep the balls in your **Bag**, which tracks each ball's kicks, goals and top bins, your lucky ball, editions, and an S0 discontinued sample.
5. **Choose** a ball to kick. Choosing changes only the score multiplier, trail and commentary. It never changes rarity, RF value, odds or prizes, and balls are not used up by kicking.
6. **Redeem** any ball for its RF value at any time.

> **Your kick never changes what you win: ball rarity is decided by on-chain randomness.
> Skill is for glory, streaks, stars and the leaderboard.**

| Ball | Chance | RF value (× price) | Park (10 RF) | Pro (1,000 RF) | Champions (10,000 RF) |
|---|---:|---:|---:|---:|---:|
| Scuffed | 31.5% | 0 | 0 RF | 0 RF | 0 RF |
| Training | 27% | 0.5 | 5 RF | 500 RF | 5,000 RF |
| Match | 20% | 1 | 10 RF | 1,000 RF | 10,000 RF |
| Pro | 11% | 1.5 | 15 RF | 1,500 RF | 15,000 RF |
| Silver | 7% | 2.5 | 25 RF | 2,500 RF | 25,000 RF |
| Gold | 2.5% | 5 | 50 RF | 5,000 RF | 50,000 RF |
| Golden Boot | 1% | 10 | 100 RF | 10,000 RF | 100,000 RF |

- The expected RF return is **exactly 90.00%** in every stadium, asserted in CI. Every ball
  reserves the top prize until it settles.
- USD figures convert with the real RF price from the RF/WETH and WETH/USDG Uniswap v4 pools on
  4663. In the SDK preview this is a labelled on-chain snapshot, because the preview may only
  read the game contract. Live stadiums read the price every 60 s and show "—" on failure.

## Economy ($GBOOT, tokenomics v2: designed and tested, NOT deployed)

**Supply:** 100M $GBOOT, fixed, with no owner, mint, tax or blacklist. The allocation:

| Share | Amount | Use |
|---|---:|---|
| RF-paired Uniswap v4 pool | 55M | liquidity locked; fees burned on both sides |
| Ball-drop vault | 20M | weekly cap with halving |
| Friends airdrop | 10M | pre-laced |
| Cups vault | 10M | |
| Rewards vault (RewardsDistributor) | 5M | capped Skill Zone rewards |
| Team | 0% | |

**Edge split:** the 10% edge is split 40% RF burned, 30% $GBOOT buy-back and burn, 30% Golden
Boot Cup.

**Sinks:**
- the Skill Cup and Wildcards (50% of each is burned);
- cosmetics;
- the Bootroom's early-unlace burn.

**Drops** are worth at most ~2% of the ball price (lacing no longer boosts them), so RF plus drops stays ≤ 92% (≤ 93% asserted). Buying balls is never a profitable farm: this is fuzz-tested in Foundry.

**Ball market v2 (design only):** BallVault turns redeemed, friend-bound balls into transferable
Vault Balls backed 1:1 by RF. It includes an escrow market with a floor price, and discontinued
editions keep their floor.

Full maths, supply over time, scale tables and risks are in
[docs/ECONOMY.md](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/ECONOMY.md).
The v2 revisions (lacing for cosmetics, XP and seeding only, and RF-priced sinks) await the
owner's confirmation before any deployment.

## What is live, simulated, and roadmap

- **Live on-chain (Robinhood 4663):** only the builder burner's Friend **#336583 hardwired at Gen
  2**, [tx 0xd6a6a8b9…c78d0](https://robinhoodchain.blockscout.com/tx/0xd6a6a8b911e7a7eba8b5e5771a4ad17ed3fe3af785a1b7e16e0640e86acc78d0).
  No game contract, $GBOOT or pool is deployed.
- **Simulated (preview):** RF balance (20 RF, the SDK default), packs, reveals, rewards, $GBOOT,
  Cup pots, race tables and rivals.
- **Roadmap (v1.1):**
  - an onboarding web app: email / Apple / Google sign-in with an embedded wallet, gasless play,
    card on-ramp to RF, and "get your player" hardwiring;
  - saved progress;
  - the live Skill Cup referee;
  - live stadiums and the BallVault.

## Run it

Node.js 22+ on Linux or Ubuntu/WSL2.

```sh
git clone https://github.com/tulipoaaaaa/penalty-kings.git
cd penalty-kings
npm ci
npm run dev          # connect a wallet holding a hardwired Friend
npm run build:site   # static site in site/ (Park /, Pro /pro/, Champions /champions/)
```

## Checks, credits and limitations

**Checks** (in GitHub Actions; the preview only redeploys after a fully green CI run):
- `friendsdk check` + the SDK browser harness at 960 px and 360 px, and typecheck;
- engine tests (28): zones, keepers, the difficulty director, the swipe mapping regression table,
  free-kick physics;
- game-logic tests (34): levels, progress, daily, target, the reveal ethics rule, prizes, the
  live-price maths, pitch geometry, Bag honesty, and an action-flow state machine covering every
  action in ≈69k states;
- browser tests:
  - the buy → open → reveal → Bag → kick → redeem flow;
  - every free mode;
  - a 13-scenario action-flow audit: double release, key plus mouse, walkout, pack reveal, resize mid-swipe, and speed (release → result ≤ 1.2 s);
  - 90-second first-session QA;
- odds verification (EV 90.00%); the economy simulator; the Skill Cup referee (replay match, signed results);
- Foundry: 167 unit, fuzz and invariant tests, including the tokenomics v2 vaults, the Bootroom farm bound, the rewards budget invariant, the TWAP oracle
  and BallVault solvency invariants, plus mainnet-fork tests;
- a real mainnet ownership-gate test; the secret scan.

**Known issues and limitations:**
- **Saved progress:** the SDK sandbox has no storage (no `allow-same-origin`), so preview progress
  resets on reload, and the Daily limit is not enforceable there. This is an SDK capability gap;
  we'd welcome a save API.
- The preview wallet holds 20 simulated RF, which buys a 2-ball Park pack.
- Browser tests use the SDK's mocked wallet; a human real-wallet playthrough is recommended.
- **Risks:** live mode would use real RF. Paid chance with a redeemable prize needs legal review
  before any live promotion (an 18+ gate and region notices are planned). Official production
  publication needs Rare Friends review.

**Assets:** all art is original and drawn in code:
- the pitch, the three stadiums, crowd, goal and wall;
- 12 keepers;
- ball sprites per rarity.

The Friend is its canonical on-chain Generations sprite (FriendSDK sprite reader), unaltered. The
crowd of little Friends reuses the player's own sprite (downscaled nearest-neighbour, pixels
unaltered, props held around it); no other Friend's art is read.
UI sounds come from the FriendSDK sound kit; crowd, kick and music are synthesised in code. No
real clubs, crests, players or brands appear.
