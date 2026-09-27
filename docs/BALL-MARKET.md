# Ball Market (v2 design): BallVault

> **DESIGN ONLY. NOT DEPLOYED. NOT AUDITED. NOT REVIEWED BY RARE FRIENDS.**
> `contracts/src/BallVault.sol` exists only as source code and tests. No vault, no market and no
> Vault Ball exist on any chain. The in-game "Market (coming soon)" panel
> (`games/penalty-kings/ballui.tsx`, `MarketPreview`) shows **simulated** listings only.

## Why a vault is needed

Every Penalty Kings ball is an ERC-1155 outcome of the FriendSDK `ChanceGame`
(`node_modules/@rarefriends/friendsdk/contracts/src/ChanceGame.sol`). Three facts from that source
decide what is possible:

1. **Balls are friend-bound.** `_update` reverts with `FriendBoundInventory` on every transfer
   (only mint and burn are allowed). A ball can never leave its Friend's token-bound account (TBA),
   so it cannot be sold directly. There is no admin switch to change this.
2. **Balls are always redeemable.** `redeem(friendId, outcomeId, quantity)` can be called at any
   time by the Friend's owner or its TBA. It burns the balls and pays `reward × quantity` RF
   **to the TBA**. The reward table is fixed at deployment, and the RF is reserved in
   `rewardLiability`, which "time never releases".
3. **Only `settle` mints balls.** Nothing outside the game can create a ball, and nothing can turn
   RF back into a ball.

So a ball cannot be moved, but its RF floor can. The vault takes a redeemed ball's RF and issues a
transferable claim on exactly that RF that keeps the ball's identity (edition and rarity). That
claim is a **Vault Ball**.

## Flows

### Wrap (ball → Vault Ball)

The caller is the Friend's controller: the owner, or the TBA acting through the owner.

| Step | Call | Effect |
|---|---|---|
| 1 | `BallVault.commitWrap(editionId, friendId, outcomeId, qty)` | Checks the caller controls the Friend (same rule as ChanceGame: Generations `ownerOf` or `tokenBoundAccount`, Friend hardwired). Snapshots the TBA's ChanceGame balance of `outcomeId`. |
| 2 | `ChanceGame.redeem(friendId, outcomeId, qty)` | Burns `qty` balls and pays `qty × floor` RF to the TBA. |
| 3 | `RF.approve(vault, qty × floor)` then `BallVault.wrap(editionId, friendId, outcomeId, to)` | Checks that the TBA's balance fell by at least `qty` since the snapshot, pulls `qty × floor` RF from the caller and mints `qty` Vault Balls to `to`. |

A TBA that can batch calls does all of this in one transaction. For the wrapper it is RF-neutral:
the RF that step 2 pays the TBA is the RF that step 3 locks in the vault. The only cost is gas.

**Why the balance check proves a burn.** ChanceGame balances can only change through `settle`
(mint, +1) and `redeem` (burn); transfers revert. If the balance after step 2 is at most
`snapshot − qty`, then at least `qty` balls of that outcome were redeemed from that TBA after the
commit. If a new ball of the same outcome settles in between (anyone can call `settle`), the
balance goes up and `wrap` reverts with `NotRedeemed`. This fails safe: the redeemed RF sits in
the TBA and the controller commits again. A commit can be used once, only by the address that
made it, and only while that address still controls the Friend.

### Unwrap (Vault Ball → RF)

`unwrap(id, qty)` burns Vault Balls from the caller and pays `qty × floor` RF. There is **no fee**,
and nobody, including the curator, can pause, delay or reduce it. Unwrapping cannot bring the
original friend-bound ball back, because only ChanceGame `settle` mints balls.

### Market (list / buy / cancel)

| Call | Rules |
|---|---|
| `list(id, qty, unitPrice)` | `unitPrice ≥ floor`: a Vault Ball can never be listed below the RF it unwraps to. The units move into escrow in the vault. |
| `buy(listingId, qty, maxUnitPrice)` | The buyer pays `qty × unitPrice` RF directly: `fee = paid × feeBps / 10,000` goes to `feeRecipient`, and the rest goes to the seller. The units leave escrow to the buyer. `maxUnitPrice` is a UI guard. |
| `cancel(listingId)` | Seller only. Returns unsold units. |

`feeRecipient` and `feeBps` are constructor parameters, fixed forever, with `feeBps ≤ 500`
(5%). The intended recipient is the `EdgeSplitter` (40% RF burned, 30% $GBOOT buy-and-burn,
30% Cup pot). Its address is passed at deployment because EdgeSplitter is not deployed either. The
tests use 2.5%. Market payments never pass through the vault's RF balance, so they cannot affect
the backing.

## Floor-price maths

**floor(Vault Ball) = `ChanceGame.outcomes(outcomeId).reward`**, the RF reward of that rarity in the
stadium's game definition. The vault reads it from the game itself, and the game cannot change it.
Outcome IDs are the game-definition order + 1. The table below comes from
`games/penalty-kings/tiers/*.json`, which `scripts/verify-odds.mjs` checks (weights sum to
10,000 bps; rewards are the listed multiples of the price; expected return is exactly 90.00%).

| Outcome ID | Rarity | Chance | × price | Park floor (price 10 RF) | Pro floor (1,000 RF) | Champions floor (10,000 RF) |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Scuffed Ball | 31.50% | 0 | **none: cannot be wrapped** | none | none |
| 2 | Training Ball | 27.00% | 0.5 | 5 RF | 500 RF | 5,000 RF |
| 3 | Match Ball | 20.00% | 1.0 | 10 RF | 1,000 RF | 10,000 RF |
| 4 | Pro Ball | 11.00% | 1.5 | 15 RF | 1,500 RF | 15,000 RF |
| 5 | Silver Ball | 7.00% | 2.5 | 25 RF | 2,500 RF | 25,000 RF |
| 6 | Gold Ball | 2.50% | 5.0 | 50 RF | 5,000 RF | 50,000 RF |
| 7 | Golden Boot Ball | 1.00% | 10.0 | 100 RF | 10,000 RF | 100,000 RF |

Expected floor per ball = Σ chance × reward = 0.9 × price (9 RF at the Park).
ChanceGame's `redeem` reverts on a zero reward, so a Scuffed Ball has no floor and no Vault Ball.

**Solvency.** Let `S(id)` be the Vault Ball supply, including units in escrow. The vault keeps
`backing = Σ floor(id) × S(id)` and guarantees `RF.balanceOf(vault) ≥ backing` at all times.
Wrap adds `qty × floor` to both sides, and unwrap takes `qty × floor` from both. List, buy, cancel
and transfers change neither. The invariant test checks this after random sequences of all six
actions.

**Seller and buyer at a premium.** For a listing at `p` per unit (`p ≥ floor`) and fee rate `f`:
the seller gets `p × (1 − f)`, and the buyer holds a claim worth at least `floor` RF. The buyer's
most they can lose, in RF, is `p − floor`. The seller would rather list than unwrap only when
`p × (1 − f) > floor`.

Vault Ball token ID: `(editionId << 128) | outcomeId`. `edition(editionId)` returns the
stadium game, season label, tier label and discontinued flag.

## Discontinued editions and premiums

The game has seasons (`games/penalty-kings/game/bag.ts`): **S1 is live**, and **S0 is a
discontinued edition that exists only as a labelled sample in the preview** (it is not inventory
and cannot be redeemed). In the vault, an edition is one ChanceGame deployment plus its season and
tier labels. Once an edition is discontinued:

- **Its floor never changes.** Redemption has no deadline in ChanceGame, so every ball still in a
  TBA can still be redeemed, and wrapped, for exactly the same RF. Every Vault Ball still unwraps
  for its floor. `testDiscontinuedKeepsFloorAndUnwrap` checks this.
- **Why a premium can exist:** a discontinued edition gets few or no new balls, and its supply
  only goes down as holders redeem or unwrap. Collectors may pay above the floor for a scarce S0
  Golden Boot Ball or for a specific edition.
- **A premium is never promised.** Market prices come from buyers. They can be zero above the
  floor, and a premium can disappear at any time. The game and this document make no claim about
  future prices. The preview's asks (e.g. "180 RF" for an S0 Golden Boot Ball) are
  **simulated examples**, and the preview says so.
- **"Discontinued" is a label, not an on-chain guarantee of scarcity.** ChanceGame has no stop
  switch. The team can withdraw free stake so that `canBuy` is false, but **anyone** can call
  `fund` and make plays possible again, and committed plays can still settle. The vault's
  `discontinued` flag is set by the curator and is one-way. It changes nothing else.

## What is enforced on-chain, and what is assumed

**Enforced by `BallVault.sol`, with tests in `contracts/test/BallVault.t.sol`:**

- Vault RF ≥ Σ floor × supply at all times (invariant + fuzz), and `backing` equals that sum exactly.
- Unwrap pays the full floor, with no fee and no pause.
- Every Vault Ball matches a ball of the same outcome burned by `redeem` from that Friend's TBA
  after the commit (the provenance invariant, plus the no-redeem, partial-redeem,
  redeem-before-commit and single-use tests).
- Only the Friend's controller can commit, only the committer can wrap, and the committer must
  still control the Friend.
- Floors come from the game's immutable outcome table, and Scuffed/invalid outcomes revert.
- Listings are ≥ floor and escrowed. Only the seller cancels. The fee is ≤ 5% and fixed at
  deployment. Buyer RF never enters the backing.
- Reentrancy: every state-changing entry point is `nonReentrant`, and state is written before
  ERC-1155 receiver hooks run. Tests re-enter `unwrap`/`buy`/`cancel` from receiver hooks, and each
  attempt reverts.
- Direct transfers of Vault Balls into the vault are rejected, so nothing gets stuck.
- The curator can only append editions (each game once, same RF token) and set the one-way
  discontinued flag. The curator has no power over funds, fees, floors, listings or unwraps.

**Assumptions (not enforced):**

- The curator registers only real Penalty Kings ChanceGame deployments, with truthful season and
  tier labels. The vault checks the RF token and uniqueness, not who deployed a game.
- Season labels mean something only if each season is its own ChanceGame deployment. A single
  deployment cannot tell its balls apart by season.
- RF is a standard ERC-20: no fee-on-transfer, no rebasing. The floor is denominated in RF, so its
  value in ETH or USD moves with the RF price.
- The Friend's TBA can accept ERC-1155 mints. The mainnet-fork test shows this for Friend #7730's
  real TBA, and ChanceGame `settle` needs it anyway.

## Honesty rules (unchanged by the market)

- **Rarity is decided by on-chain randomness**: Dice Entropy's word, hashed per play in
  ChanceGame `settle`. No wrap, trade, price or UI action can change a ball's rarity or floor.
- **Ball choice affects only skill-layer fields.** Choosing a ball changes the kick's score
  multiplier, trail and commentary (`kickStyle`). Kicking updates only its career stats
  (`recordKick`: kicks, goals, top bins). Neither changes rarity, season, tier, ID or RF value.
  These rules are tested in `tests/game/bag.test.ts`.
- The Bag always mirrors the on-chain inventory (`syncBag`), and the pack summary reports true
  totals, including losses (`packSummary`). Both are tested.
- Market figures in the game are labelled simulated until a vault is deployed and read live.

## Risks

- **Unaudited design.** This needs an external audit and Rare Friends review before any
  deployment.
- **Curator trust** for edition labels (see the assumptions above). Mitigation: a timelocked or
  multisig curator, with every edition published in `docs/ADDRESSES.md`.
- **Friction and races.** A wrap takes 3 to 4 calls unless the TBA batches them. A settlement
  between commit and wrap forces a re-commit (it fails safe; no funds are at risk).
- **Market risk.** Buyers can overpay: the premium above the floor is unbacked. Wash trading can
  fake prices. The UI must always show the floor next to the ask.
- **Unwrapping cannot be reversed.** A Vault Ball cannot become a friend-bound ball again, so
  anything that depends on holding a ball in the TBA (for example ball choice in the game) is lost
  once it is wrapped.
- **No price oracle, no lending, no leverage.** The vault only holds RF against claims.

## What is NOT deployed

- `BallVault`: not deployed anywhere. No address exists.
- The Penalty Kings stadium `ChanceGame`s: also **not deployed yet** (`games/penalty-kings/live.json`
  is `{}`; see `docs/DEPLOYMENT.md`). The mainnet-fork test therefore deploys the SDK ChanceGame
  **on a local fork only**, against the real RF, Generations, Dice Entropy and provider
  (addresses from `docs/ADDRESSES.md`, with `eth_getCode` confirmed non-empty), and runs a real
  wrap for Friend #7730's real TBA.
- `EdgeSplitter` (the intended fee recipient): not deployed.

## Tests

```sh
npm install                      # the forge tests compile ChanceGame from the SDK package in node_modules
cd contracts
forge test --no-match-contract Fork                                          # unit, fuzz, invariant
forge test --match-contract ForkBallVault --fork-url $ROBINHOOD_RPC_URL -vv  # local fork only
cd .. && node scripts/test-game-logic.mjs                                    # Bag honesty tests
```
