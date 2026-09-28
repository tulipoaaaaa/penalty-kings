# Early access preview

This is a cut-down build of Penalty Kings for early players. It shows four things and hides the rest.
Nothing is deleted: the full game is still there and is still the default build.

## What is in it

| Feature | What the player sees |
|---|---|
| **1. Real-money balls** | The **Ball shop** (with your Friend's rating and the exact odds), buying and opening **packs**, **My Bag**, **redeeming** a ball for RF, and the **Big Match** (kick with your own balls). |
| **2. Practice** | The public **free practice page** (`/practice/`: 5 kicks, no wallet) and, in the game, the **Practice** mode. |
| **3. Daily Challenge** | The same scenario for everyone each day, 3 attempts. |
| **4. Scouting Book** | The 12-keeper sticker album, the ball collection and "How scoring works". |

**Practice in the game is the Penalties mode, renamed "Practice".** It already is the free, no-RF way to play:
the tutorial first, then the 12-keeper ladder that fills the Scouting Book. So Practice and the Scouting Book work
together, and the practice page's "Open the early access game" button leads straight into it.

**Hidden** (still in the code, switched off): Free Kicks, World Tour, Target Practice, Skill Cup, Kit shop, Cups
(the Golden Boot Cup race, Wildcards), the Cup pot banner and winners ticker, Champions Night, Keeper of the Week,
challenge codes, share cards (they carry challenge links), the Market preview, and every $GBOOT line (the Rare Friends
pilot has no $GBOOT). Rules, Settings and the in-game Menu stay.

**No dead ends.** Every button leads to something visible. NEXT GOAL only ever says: unlock the Daily Challenge (the
tutorial's XP does it), play today's Daily Challenge, stamp the next keeper, or beat your Practice best. Results only
offer Play again, Modes, NEXT GOAL and the Scouting Book. The tutorial still unlocks level 2, which now reads
"Level 2: Daily Challenge unlocked". `npm run test:early-access` clicks through all of this.

## How to build and run it

| Command | What it does |
|---|---|
| `npm run build:site:ea` | Builds the early access site into `site-ea/` (Park `/`, Pro `/pro/`, Champions `/champions/`, `/practice/`). |
| `npm run play:ea` | Runs it locally on http://localhost:5199 with the DEV mock wallet (use `PORT=…` for another port). |
| `npm run test:early-access` | Builds `site-ea/`, checks it, then plays it in the real SDK runtime at 960 px and 360 px. |
| `npm run build:site` | The full game, exactly as judged (`site/`). `npm run check:full-identical` proves it is byte-for-byte the build of `d51e550`. |

CI: `.github/workflows/early-access.yml` runs the early access checks only on the `early-access` branch. The judged
CI (`ci.yml`) is unchanged.

## How to switch a feature back on

All the switches are in one file: **`games/penalty-kings/game/features.ts`**. Each feature has a line like:

```ts
worldTour: { label: "World Tour", earlyAccess: false },
```

Change `false` to `true` and rebuild with `npm run build:site:ea`. That brings back its mode card, its menu button and
NEXT GOAL suggestions. A few screens (the Cups and Kit shop screens, the Cup pot banner) are also wrapped in an
"early access region" in the page code (next section): for those, a developer also removes the region. The unit tests
in `tests/game/features.test.ts` list exactly what each switch controls.

**How the build does it (for developers).** Code that differs between the two builds sits in a comment next to the
full-game code, for example:

```tsx
{/*EA{ <EarlyAccessShop … /> }*/}<Shop … />{/*}EA*/}
```

The early access build compiles the part inside `EA{ … }` and drops the full part (`scripts/lib/ea-regions.mjs`, hooked
into the SDK build by `scripts/lib/preset.mjs`). The full build sees only a comment. We used comments, not an `if`,
because the build tool picks the short variable names of the whole game from the letters in the source: even an unused
`if (earlyAccess)` changes every name, and the full game would no longer be byte-identical to the judged one.
`npm run typecheck:ea` type-checks the code inside the comments.

## Friend ratings (payout rate by generation)

A Friend's **rating** is its payout rate: how much of the ball price a ball pays back on average, over many balls.
It depends on the Friend's generation:

| Generation | Gen 6 | Gen 5 | Gen 4 | Gen 3 | Gen 2 | Gen 1 |
|---|---:|---:|---:|---:|---:|---:|
| Rating | 90% | 91% | 92% | 93% | 94% | 95% |

Gen 6 is today's 90%. From Gen 5 (91%) to Gen 1 (95%) it rises one point per generation.

**Where to edit it:** `games/penalty-kings/config/ratings.json`. Change a number, then run
`npm run gen:ratings && npm run verify:odds`. Rules the file enforces: each rating is at least 0 and **below 100%**, in
steps of 0.05 (93, 93.5, 93.25 are fine), and between 67.5% and 97.5% (the range where the odds can stay in rarity
order). `verify:odds` fails if anything is off.

### The odds, generated from the rating

The balls and prizes are the same for everyone. Only the chances change:

| Ball | Prize | Gen 6 (90%) | Gen 5 (91%) | Gen 4 (92%) | Gen 3 (93%) | Gen 2 (94%) | Gen 1 (95%) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Scuffed | 0 | 31.50% | 30.90% | 30.30% | 29.70% | 29.10% | 28.50% |
| Training | 0.5× | 27.00% | 27.00% | 27.00% | 27.00% | 27.00% | 27.00% |
| Match | 1× | 20.00% | 20.20% | 20.40% | 20.60% | 20.80% | 21.00% |
| Pro | 1.5× | 11.00% | 11.20% | 11.40% | 11.60% | 11.80% | 12.00% |
| Silver | 2.5× | 7.00% | 7.20% | 7.40% | 7.60% | 7.80% | 8.00% |
| Gold | 5× | 2.50% | 2.50% | 2.50% | 2.50% | 2.50% | 2.50% |
| Golden Boot | 10× | 1.00% | 1.00% | 1.00% | 1.00% | 1.00% | 1.00% |
| **Expected return** | | **90.00%** | **91.00%** | **92.00%** | **93.00%** | **94.00%** | **95.00%** |
| Max payout per ball | | 10× price | 10× | 10× | 10× | 10× | 10× |
| Bank reserve per ball | | 10× price | 10× | 10× | 10× | 10× | 10× |

**Method.** Start from today's 90% table. For every 0.05 points of rating, move 0.01% of chance from Scuffed (pays 0)
to each of Match, Pro and Silver (1×, 1.5× and 2.5×). That adds exactly 0.05% of return (0.01% × (1 + 1.5 + 2.5)), so
the expected return equals the rating exactly, with whole numbers only: no rounding and no search. One whole point
moves 0.20% to each. The chances always add up to exactly 100%, every rarer ball stays no more likely than the one
before it, and a higher rating never lowers the chance of any paying ball. Gold and Golden Boot never change, so the
jackpot chance and the prize bank reserve are the same for every rating. Code: `games/penalty-kings/game/ratings.ts`.

**Prize bank.** Each ball in flight reserves one top prize (a Golden Boot, 10× the ball price) until it settles, so the
reserve per ball is 10× the price for every rating. A Park bank of 20,000 RF holds 200 balls in flight, as today.
The house margin per ball is (100% − rating) of the price: 10% at Gen 6, 5% at Gen 1.

**Proof.** `npm run verify:odds` checks every rating (and every rating plus the bonus): the exact expected payout in
18-decimal RF units, chances summing to exactly 10,000 basis points, the rarity order, the order across ratings, the
SDK's own roll-to-ball mapping, the max payout and the bank reserve, and that the committed tables match the config.
It prints the table above.

**What the player sees.** The Ball shop leads with "Your rating: 93.00% payout" and the generation table, the Odds
screen shows the exact chances for their rating, and every pack prints "Odds per ball (your rating 93.00%)". The
HUD shows the rating during a Big Match.

## The cosmetic bonus (off by default)

`config/ratings.json` has a bonus: `"bonus": { "enabled": false, "points": 0.5, "cosmetic": "Lucky Laces" }`.
When enabled, a Friend that owns the named cosmetic gets +0.5 points on its rating (Gen 1 would pay 95.5%).
"Lucky Laces" is an original name. Tests check that every generation plus the bonus stays **below 100%**, and the config
check rejects a rating or bonus that would reach 100% or go below 0.

Before switching it on: the bonus needs a way to get the cosmetic (the Kit shop is hidden in early access), and it
doubles the odds tables: one more ChanceGame per generation per stadium (`gen:ratings` writes them).

## Contract and deployment: what the founder needs to decide

Today each stadium has **one** ChanceGame contract, and **its odds are fixed inside it**. The SDK build bakes one
definition per stadium. Per-Friend odds therefore need one of two things:

1. **One ChanceGame per rating (what this build prepares).** `npm run gen:ratings` writes one reviewable definition per
   generation per stadium: `games/penalty-kings/tiers/ratings/<stadium>-gen-<n>.json`, 18 in all (36 with the bonus).
   Each would be deployed as its own contract, and the Rare Friends runtime would open the contract for the player's
   Friend generation. Each needs its own prize bank (18 banks instead of 3).
2. **Contract support.** One contract per stadium that reads the Friend's generation (`Generations.generation(id)`,
   already on-chain) at buy time and rolls on that generation's table. One bank per stadium, but it is a contract
   change that needs its own review and audit.

Either way, the player's generation must come from the chain or the platform at buy time, never from the game.

**What this build does today.** The game shows the rating of the odds the stadium actually rolls with, taken from the
stadium's own definition, so the screen can never disagree with the roll. The player's generation comes from the
platform. SDK v0.1.2 does not pass it to the game, so in the SIMULATED preview the Friend counts as **Gen 3**: the
preview Friend, #7730, is generation 3 on-chain. The early access site is built with the Gen 3 tables
(`previewGeneration` in the config). If a live build ever sees a generation whose rating differs from the stadium's odds,
or no generation at all, the Buy button is off and the shop says why. Nothing is deployed and nothing touches the chain.

## Apple Pay, Google Pay and Google sign-in

None of this is in the game, on purpose: the game runs sandboxed and never sees a wallet, a card or a login.
It plugs into the **WalletProvider seam** on the `app/test-shell` branch (documented in `docs/WALLETS.md` there):

WALLETS_SECTION

## What is simulated and what is real

| Real | Simulated (labelled SIMULATED on screen) |
|---|---|
| The game, the physics, the keepers, Practice, the Daily Challenge, the Scouting Book | The RF balance (the SDK preview wallet holds 20 RF), balls, packs, redeem payouts |
| The odds tables and their math (checked by `verify:odds`) | The player's generation (Gen 3, the preview Friend's) |
| Friend ownership (the SDK's real on-chain gate) | Every price in USD (on-chain snapshot in the preview) |
| | The pack roll: the preview's own draw, not on-chain randomness |

Nothing in early access is deployed, and no keys or real money are involved.
