# Audit prep: the $GBOOT contract package

**Status.** Nothing in `contracts/src` is deployed, and no deployment is planned or authorised
([DEPLOYMENT.md](DEPLOYMENT.md)). **Founder decision (2026-09-27): the Rare Friends pilot ships
WITHOUT $GBOOT.** Rare Friends deploys the contracts: its own prototype contracts for the pilot's
two random rolls now ([HANDOFF-RF.md](HANDOFF-RF.md), [RNG-INTEGRATION.md](RNG-INTEGRATION.md)),
and this package only if the $GBOOT upgrade is revived after an audit
([GBOOT-UPGRADE.md](GBOOT-UPGRADE.md), "Reviving the upgrade later"). This repo deploys nothing.

This page is the starting pack for an auditor: what each contract does and holds, whom it trusts,
who can do what, the known limits, the static-analysis triage and the test inventory. The economics
behind every number are in [ECONOMY.md](ECONOMY.md); the contract overview is
[contracts/README.md](../contracts/README.md).

**Scope.** `contracts/src/*.sol`, `contracts/src/interfaces/*`, `contracts/src/libraries/TickMath.sol`
and the wiring in `contracts/script/Launch.s.sol`. Out of scope: the vendored `contracts/lib`
(OpenZeppelin and forge-std as shipped in the FriendSDK v0.1.2 package, with its `provenance.json`
hashes) and the FriendSDK `ChanceGame` (compiled from `node_modules` in tests only).

Toolchain: Solidity 0.8.36, optimizer 200 runs, EVM `cancun`, Foundry; target chain Robinhood
mainnet (chain 4663), Uniswap v4.

## 1. Contracts

"Holds" is what the contract custodies between transactions. "Flows" are the token movements it
performs. Every contract is non-upgradeable; constructor arguments are immutable except where noted.

| Contract | Purpose | Holds | Flows |
|---|---|---|---|
| `GBoot` | $GBOOT, OpenZeppelin ERC20, 100,000,000 fixed supply minted once to the deployer | nothing | `burn` by any holder of their own balance; no mint, owner, pause, tax or blacklist |
| `EmissionVault` | Releases a $GBOOT allocation to one `operator` under an immutable weekly cap (halving every `halvingWeeks`, or flat when 0); unused allowance does not roll over | $GBOOT | `release(to, amount)` by the operator, ≤ `capOf(week)` per week |
| `Bootroom` | Lacing: lock $GBOOT against a `friendId` for 1–52 weeks for a perk tier 0–3 (cosmetics, XP, Cup seeding; never a payout) | $GBOOT (all laces) | `lace` pulls from the caller; `unlace` pays the Friend's owner or token-bound account (TBA) that calls it, burning 50% if before `unlockAt` |
| `FriendsAirdrop` | 10M $GBOOT to hardwired Friends via one Merkle root, delivered pre-laced for 12 weeks | $GBOOT (unclaimed) | `claim` laces into the Bootroom for the `friendId` (never pays a wallet); after 180 days `sweep` sends the rest to `sweepTo` (the Cups & events vault) |
| `KitShop` | Cosmetic unlocks per `friendId`, priced in RF, charged in $GBOOT through the price source | nothing (transient) | `buy` pulls $GBOOT from the buyer and burns 100%; records `burnedInWeek` |
| `SkillCup` | Paid on-chain Skill Cup entries (10 RF, in $GBOOT) for Friends hardwired at Gen ≤ 4; 1 h cooldown, 20 per week | nothing (transient) | `enter` pulls the cost, burns ⌊50%⌋, sends the rest to `pot`; records `entryFriend` and `burnedInWeek` |
| `Wildcards` | An extra Golden Boot Cup draw (10 RF, in $GBOOT) resolved by Dice entropy (Gold 2.5% / Golden Boot 1%) | nothing (transient); ETH only within a call | `draw` pulls the cost, burns ⌊50%⌋, pays the rest to `pot`, forwards the exact oracle fee to Entropy and refunds any excess ETH to the caller |
| `EdgeSplitter` | Splits the stadiums' RF edge: 40% RF burned / 30% swapped to $GBOOT and burned / 30% RF to the Cup | RF until `split` | `split(minGbootOut)` by the operator: `RF.burn`, swap through `PoolSwapper`, `GBoot.burn`, RF to `cup` |
| `LiquidityLock` | Holds the protocol-owned Uniswap v4 position NFTs of the plain $GBOOT/RF pool until `unlockTime` | v4 position NFTs; fee tokens only within a call | `collect` (anyone): takes the LP fees, per side 50% burned / 50% to `pot`; `withdraw` (beneficiary, after `unlockTime`) returns the NFT |
| `PoolSwapper` | Exact-input swap helper over the v4 PoolManager (`unlock / swap / sync / settle / take`) | nothing | pulls `owed` from the caller of `swapExactIn` to the PoolManager, sends the output to that caller |
| `RewardsDistributor` | Farm-proofed $GBOOT Skill Zone / streak rewards (referee EIP-712 signature, Gen ≤ 4, a paid SkillCup entry, 2 RF per entry, 3 RF per Friend per day, season budget) | nothing; it creates and is the only operator of its own `EmissionVault` (the 5M rewards vault) | `claim` releases from its vault to the Friend's TBA |
| `GBootFixedPrice` | Launch-default price source: fixed 0.1 RF per $GBOOT (sinks round up, rewards down) | nothing | view only |
| `GBootFeeHook` | **Off by default, not audited.** v4 hook for a 0%-LP-fee pool: burns 1% of every swap's unspecified side; a 64-checkpoint TWAP accumulator | nothing (fee is taken and burned in the same call) | `afterSwap` takes and burns the fee |
| `GBootPriceFeed` | **Off by default.** RF → $GBOOT at the hook's 30-min TWAP, with a readiness check and a 1,000-tick spot/TWAP divergence guard | nothing | view only |
| `BallVault` | **Design only, not reviewed by Rare Friends.** Transferable "Vault Balls" backed 1:1 by the RF floor of redeemed ChanceGame balls, plus a free-price escrow market | RF backing (Σ floor × supply) and escrowed Vault Balls | `wrap` pulls RF, `unwrap` pays the floor, `buy` pays seller and fee recipient directly |

**Launch wiring** (`script/Launch.s.sol`, rehearsed on a fork in CI, never broadcast): GBoot → plain
v4 pool (1% LP fee, no hook) with 55M single-sided in `LiquidityLock`; 20M drop vault (2.5M/week,
halving every 4 weeks); 10M Cups & events vault (100k/week flat); 10M `FriendsAirdrop`; 5M in the
`RewardsDistributor`'s vault (50k/week, halving every 52 weeks). The sinks and rewards read
`GBootFixedPrice`. One Cup pot address (`CUP_POT`) receives SkillCup, Wildcards, EdgeSplitter and
LiquidityLock payments.

## 2. Trust assumptions

- **Randomness.** `Wildcards` trusts the Dice Entropy V2 contract and provider fixed at construction
  (the same interface as the FriendSDK `ChanceGame`): the callback is accepted only from `entropy`
  with the expected `provider`. The pilot's two rolls (pack, penalty) use the Rare Friends SDK
  v0.2.1 random beacon (~15 s) in Rare Friends' own contracts, not this package
  ([RNG-INTEGRATION.md](RNG-INTEGRATION.md)).
- **Price inputs.** At launch the price is a constant (`GBootFixedPrice`, 0.1 RF per $GBOOT); no
  oracle is read. With the audited hook, `GBootPriceFeed` trusts the `GBootFeeHook` accumulator and
  its read of PoolManager storage (`POOLS_SLOT = 6`, checked on a fork against `StateView`).
- **Operator inputs (off-chain).** The weekly report (`scripts/cup/weekly.mjs`, a read-only dry
  run) takes the Cup pot (`--pot-rf`) and the market price (`--twap`) as operator inputs that are
  NOT read on-chain ([WEEKLY.md](WEEKLY.md)). `EdgeSplitter.split(minGbootOut)` trusts the operator
  to set the minimum output from a fresh quote (3% slippage).
- **Cup pot.** The pot is a disclosed wallet (`CUP_POT`, default the operator in rehearsals), not a
  contract: Cup payouts are operator transactions logged in [TX-LOG.md](TX-LOG.md).
- **FriendSDK / TBA ownership.** `Bootroom`, `SkillCup`, `Wildcards`, `RewardsDistributor` and
  `BallVault` trust the Rare Friends Generations contract for `ownerOf`, `generation` and
  `tokenBoundAccount` (Bootroom and BallVault accept the owner OR the TBA as the Friend's
  controller). A Friend transfer moves control of its lace and rewards with it.
- **Referee signer.** `RewardsDistributor` pays only claims signed by the immutable `referee` key
  (the Skill Cup referee, `verifier/`). A leaked key is bounded by the per-entry, per-day and
  season caps, and by the vault's weekly cap.
- **RF token.** `EdgeSplitter` and `LiquidityLock` call `burn(uint256)` on RF (verified in
  [ADDRESSES.md](ADDRESSES.md)).
- **Uniswap v4.** `PoolSwapper`, `LiquidityLock` and `GBootFeeHook` trust the canonical PoolManager
  and PositionManager addresses in `Launch.s.sol`.

## 3. Admin powers

The claim is "no admin powers". Checked by grep over `contracts/src` for `onlyOwner`, `Ownable`,
`AccessControl`, `onlyRole`, `Pausable`, `Upgradeable`, `UUPS`, `Proxy`, `initialize(`,
`delegatecall` and `selfdestruct`: **no matches**. No contract has an owner, pause, upgrade path,
parameter setter, fee switch or rescue function.

There are, however, **immutable, narrowly scoped privileged addresses**, listed here in full:

| Contract | Role | What it can do | What it cannot do |
|---|---|---|---|
| `EmissionVault` (drops, Cups) | `operator` (an EOA at launch) | Release up to the week's cap to any address | Exceed the cap, change it, or roll allowance over |
| `EdgeSplitter` | `operator` | Trigger `split` and choose `minGbootOut` | Change the 40/30/30 split or the destinations |
| `FriendsAirdrop` | `setter` (the deployer) | Set the Merkle root **once**; that root decides which Friends get how much | Change the root, pay wallets directly, or reclaim before the 180-day sweep (which goes to the Cups vault) |
| `LiquidityLock` | `beneficiary` (the operator at launch) | Withdraw the position NFTs **after `unlockTime`** (default 180 days) | Withdraw earlier, or redirect the LP fees |
| `RewardsDistributor` | `referee` (signing key) | Authorise reward claims within the caps | Pay beyond the per-entry, per-day or season caps |
| `Bootroom` | `airdrop` (the FriendsAirdrop) | Start a lock on an empty lace, or join a live lock that already ends at least as late | Extend a lock or move funds out |
| `BallVault` (design only) | `curator` | Add editions (append-only), mark one discontinued (one-way), set a one-time per-ball mint cap | Touch funds, fees, floors, listings or unwraps; pause |

## 4. Known limitations

- **No hook until audited.** Launch is a plain v4 pool with a 1% LP fee and no hook, so there is no
  on-chain TWAP; `GBootFeeHook` and `GBootPriceFeed` stay undeployed until an audit, and switching
  to them needs a new pool and new sink deployments (the hook is part of the pool key).
- **Fixed prices.** With `GBootFixedPrice`, sinks charge fixed $GBOOT amounts. If $GBOOT falls about
  90% (below ≈ 0.0098 RF), a Wildcard becomes a cheaper route to race points than a ball
  ([ECONOMY.md, "Wildcard farm check"](ECONOMY.md#wildcard-farm-check-rf-cost-per-golden-boot-race-point)).
- **LiquidityLock fee split.** Each fee side is split ⌊50%⌋ burned / the rest to the pot (the odd
  wei goes to the pot); the whole balance of each pool currency is split, so stray transfers to the
  lock are burned/potted the same way. The lock is time-bounded: after `unlockTime` the beneficiary
  can take the positions.
- **Dust.** `EdgeSplitter`: under 4 wei the buyback share rounds to 0 and the swap is skipped (a
  zero-amount v4 swap reverts); the rest still burns and goes to the Cup; at most 2 wei of rounding
  goes to the Cup. `SkillCup` / `Wildcards`: the burn is ⌊cost / 2⌋ and the pot gets the odd wei.
  `Bootroom`: early unlace burns ⌊amount / 2⌋; the perk curve counts whole $GBOOT only (a lace under
  1 $GBOOT gives tier 0).
- **Pre-start behaviour.** Before `start`, `KitShop`, `Wildcards`, `EmissionVault` and
  `RewardsDistributor` clamp to week/day 0, and `SkillCup.week()` returns 1 (its 1-based Cup week),
  so pre-start burns land in sink-ledger week 0. Season 0 has no previous season's burns, so the
  rewards budget for season 0 is **0** (the proposed 50,000 $GBOOT bootstrap is not in the code;
  GBOOT-UPGRADE.md).
- **Season budget fixed once.** `setSeasonBudget` is permissionless and fixes the season's budget on
  its first call as min(halving ceiling, last season's sink burns, the vault balance at that
  moment).
- **Oracle fee drift.** `Wildcards` reads the Entropy fee at call time; callers may overpay and the
  excess is refunded.

## 5. Static analysis (Slither)

Slither 0.11.6 (installed with `pip install slither-analyzer`), 102 detectors, run from `contracts/`:

```sh
slither . --filter-paths 'lib/|test/|node_modules|script/'
```

Results: **77 before** these fixes (base `e6a5d49`), **70 after**. The 7 removed are the five
unchecked transfers and the two uninitialised locals below; the rest is unchanged (only line numbers
moved).

| Detector (impact) | Count | Where | Triage |
|---|---|---|---|
| unchecked-transfer (High) | 5 → 0 | `KitShop.buy`, `SkillCup.enter`, `Wildcards.draw` | **Fixed**: OpenZeppelin `SafeERC20` (`safeTransferFrom` / `safeTransfer`). A test per contract with a token that returns `false` failed before (silent success) and passes now |
| uninitialized-local (Medium) | 2 → 0 | `Bootroom.log2Wad` `n`, `EdgeSplitter.split` `bought` | **Fixed**: explicit `= 0` (no behaviour change; the zero path is pinned by a test each) |
| arbitrary-send-erc20 (High) | 1 | `PoolSwapper.unlockCallback`: `safeTransferFrom(payer, …)` | **False positive**: only the PoolManager may call `unlockCallback`, and it calls back only the `unlock()` caller (this contract) with the data `swapExactIn` encoded, so `payer` is always `swapExactIn`'s `msg.sender`. Commented in the code |
| weak-prng (High) | 6 | `GBootFeeHook` `_write`, `_cumulativeAt`, `consult` | **False positive**: `%` on ring-buffer indices (`% CARDINALITY`) and the round-towards-−∞ check (`delta % elapsed`); no randomness |
| divide-before-multiply (Medium) | 2 | `TickMath.getSqrtPriceAtTick`; `Bootroom.progressBps` | Intended. TickMath is the Uniswap reference algorithm (checked against reference values in tests). `progressBps` counts **whole** $GBOOT-weeks by design (`(counted / 1e18) × weeks`) |
| incorrect-equality (Medium) | 2 | `EdgeSplitter.split` `total == 0`; `GBootFeeHook._write` `last.timestamp == now_` | Intended: an empty-balance guard and a one-write-per-second dedupe |
| unused-return (Medium) | 3 | `PoolSwapper` `settle()`; `GBootPriceFeed.twapTick` ignores `windowStart`; `BallVault._floor` ignores `chanceBps` / `metadataURI` | Accepted: the settled amount is `owed` by construction; the window bound is enforced inside the hook's `consult`; only the reward is needed |
| missing-zero-check (Low) | 11 | constructor addresses (operator, pot, cup, referee, airdrop, beneficiary, provider, sweepTo, poolManager) | Accepted: immutable wiring set once by `Launch.s.sol` and checked in the fork rehearsal. See open question 4 |
| calls-loop (Low) | 7 | `RewardsDistributor` constructor, `sinkBurned`, `seasonCeiling` | Accepted: bounded (≤ 8 sinks × 4 weeks), and the sinks and vault are fixed at construction |
| reentrancy-benign (Low) | 1 | `Wildcards.draw` writes `_drawForSequence` after `entropy.requestV2` | Accepted: `entropy` is immutable and trusted; a synchronous callback would find no draw and revert (`InvalidRandomness`), i.e. fail closed |
| reentrancy-events (Low) | 8 | events after `burn` / `release` / `take` / `lace` calls | Accepted: all state is written before the calls; only event order is affected |
| timestamp (Low) | 18 | week/day/cooldown/lock/claim-window arithmetic, the TWAP | Intended: granularity is hours to weeks |
| assembly, low-level-calls, cyclomatic-complexity, too-many-digits (Info) | 4 | `GBootFeeHook.currentTick` (`extsload` decode); the `Wildcards` ETH refund (checked, reverts `RefundFailed`); `TickMath` | Accepted |
| missing-inheritance, naming-convention (Info) | 6 | minimal local interfaces (`ISplitterSwapper`, `IBootroomLace`, `ISkillToken`, `IGBootTwapOracle`); `_entropyCallback` (the selector the Entropy contract calls); `ENTRY_RF()` getter | Accepted: by design |
| cache-array-length (Optimization) | 1 | `RewardsDistributor.sinkBurned` | Accepted (view, ≤ 8 sinks) |

Beyond Slither, reading the code for this pass found nothing new to fix; the items worth an
auditor's eye are in section 7.

## 6. Tests

`cd contracts && forge test --no-match-contract Fork` runs **206** unit, fuzz and invariant tests
offline (fuzz: 256 runs; needs the root `npm install`, because the BallVault tests compile the SDK
`ChanceGame` from `node_modules`). `forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL`
runs **7** mainnet-fork tests (read-only).

| File | Suites (tests) | Covers |
|---|---|---|
| `BallVault.t.sol` | `BallVaultTest` (29), `BallVaultInvariantTest` (2 invariants), `ForkBallVaultTest` (1 fork) | friend-bound balls, wrap/unwrap round trip, commit/redeem provenance, curator limits, edition caps, the escrow market and fees, reentrancy from ERC-1155 hooks, fuzz solvency; invariants: solvency and provenance |
| `Bootroom.t.sol` | `BootroomTest` (36) | lace/unlace rules (owner, TBA, airdrop, third-party top-ups), `maxUnlockAt`, early-unlace burn and rounding, the perk curve and tier thresholds, `log2Wad` (incl. the integer-part-0 path); fuzz: bounded, monotonic, stacked laces, conservation |
| `BootroomFarm.t.sol` | `BootroomFarmTest` (6) | lacing never makes a farm loop profitable (≤ 93% of ball value; fuzz) |
| `BootroomHijackPoC.t.sol` | `BootroomHijackPoCTest` (7) | the fixed lock-hijack PoCs (dust locks, front-running the airdrop); fuzz: nobody extends the owner's lock |
| `Clubhouse.t.sol` | `SkillCupTest` (9), `WildcardsTest` (7) | entry/draw pricing, burn/pot split (fuzz), generation, ownership, cooldown and weekly limits, pre-start week, Dice callback guards and outcome boundaries, ETH refund, false-returning token reverts |
| `EdgeSplitter.t.sol` | `EdgeSplitterTest` (10) | 40/30/30 split, swap direction for both token orders, operator-only, slippage revert, dust (< 4 wei skips the swap; `bought` = 0); fuzz conservation |
| `EmissionVault.t.sol` | `EmissionVaultTest` (15) | halving and flat caps, no rollover, pre-start week, operator-only; fuzz: the cap never increases, weekly totals bounded |
| `FriendsAirdrop.t.sol` | `FriendsAirdropTest` (20) | OpenZeppelin-compatible Merkle tree, root set once, pre-laced claims, claim window and sweep, lock interplay with the Bootroom; fuzz: wrong amounts rejected |
| `GBootOracle.t.sol` | `GBootOracleTest` (11) | the hook's TWAP accumulator (exact piecewise, rounding, ring wrap, readiness), hook permissions, the price feed's conversion and divergence guard, TickMath reference values; fuzz against a model |
| `LiquidityLock.t.sol` | `LiquidityLockTest` (15), `LiquidityLockInvariantTest` (2 invariants) | lock timing, beneficiary-only withdraw, permissionless collect and the 50/50 split, odd wei, stray transfers, reentrancy; fuzz; invariants: fees in = burned + pot + pending, position stays locked |
| `PenaltyKings.t.sol` | `GBootTest` (2), `KitShopTest` (5), `GBootFixedPriceTest` (2) | fixed supply and burn; kit pricing, slippage, repeat/unknown items, false-returning token reverts; the fixed launch price (fuzz) |
| `RewardsDistributor.t.sol` | `RewardsDistributorTest` (26), `RewardsIntegrationTest` (1), `RewardsInvariantTest` (1 invariant) | every claim guard (signature, domain, malleability, generation, entry, caps, nonce, deadline), season budget and rollover, a real SkillCup entry funding a reward; fuzz caps and budget; invariant: total paid within budget |
| `Fork.t.sol` | `ForkLaunchTest` (1 fork) | launch, swap, collect and the lock on the real PositionManager |
| `ForkHook.t.sol` | `ForkHookTest` (5 fork) | the hook on the real PoolManager: burns both sides, slot0 read = StateView, TWAP follows swaps, one-block pumps blocked, sinks charged at the TWAP |

## 7. Open questions for an auditor

1. **Season budget timing.** `RewardsDistributor.setSeasonBudget` is permissionless and fixes the
   budget on the first call of a season, reading the vault balance at that moment. If the vault were
   ever funded late, an early caller would lock a lower budget for that season. Acceptable given
   `Launch.s.sol` funds it in the same run, or should the budget ignore the balance and cap at
   release time instead?
2. **`GBootFeeHook` storage read.** `currentTick` reads `Slot0` via `extsload` at PoolManager slot 6.
   Is that robust across the deployed v4-core version, and is the 64 × 60 s ring plus the 1,000-tick
   divergence guard sufficient against multi-block TWAP manipulation at the expected liquidity?
3. **Bootroom airdrop whitelist by predicted address.** `Launch.s.sol` predicts the FriendsAirdrop's
   CREATE address from the operator's nonce and checks it after deployment. Is a failed prediction
   fully caught (the script `require`s it), and are there safer patterns (CREATE2) worth the change?
4. **Zero-address wiring.** Constructors do not reject zero addresses (except `LiquidityLock`'s
   currencies and pot). A zero `pot` makes `SkillCup` / `Wildcards` revert (OpenZeppelin ERC20
   refuses transfers to zero), which fails closed; should the constructors check anyway?
5. **Operator-set slippage.** `EdgeSplitter.split(minGbootOut)` trusts the operator's quote. Is a
   3% bound adequate against sandwiching on a 1%-fee pool, and should the split be callable by
   anyone with an on-chain bound once the TWAP exists?
6. **Referee key compromise.** With the caps (2 RF per entry, 3 RF per Friend per day, season budget
   ≤ last season's burns), is the worst case acceptable, given entries themselves cost 10 RF of
   which half is burned?
7. **`Wildcards` refund.** The excess-ETH refund is a low-level call to `msg.sender` at the end of
   `draw`, after all state is written. Any concern with a reentrant `draw` from the refund?
8. **Pre-start ledger.** Pre-start sink burns count in ledger week 0 (season 0) and so size season
   1's rewards budget. Intended, but worth confirming it cannot be gamed before `start`.
9. **Fixed-price mode.** Beyond the documented Wildcard break-even at a ~90% $GBOOT fall, is there
   any other farm loop under `GBootFixedPrice`?
10. **`BallVault`** is a design only: a full review is needed before any deployment, including the
    commit → redeem → wrap provenance check and the market's fee handling.

## 8. Reproduce

```sh
npm install                                   # BallVault tests compile the SDK ChanceGame
cd contracts
forge test --no-match-contract Fork --summary # 206 offline
forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL   # 7 fork tests, read-only
pip install slither-analyzer && slither . --filter-paths 'lib/|test/|node_modules|script/'
```
