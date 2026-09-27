# Penalty Kings contracts

Foundry project (Solidity 0.8.36, the FriendSDK house style: custom errors, immutables, no
owner powers). The stadium prize banks are the **FriendSDK `ChanceGame`**, deployed from the
SDK package's own source (`node_modules/@rarefriends/friendsdk/contracts/src`), not copied here.

| Contract | Purpose | Status |
|---|---|---|
| `GBoot.sol` | $GBOOT: 1B fixed supply minted once; holder `burn`; no owner, mint, pause, tax or blacklist | see docs/DEPLOYMENT.md |
| `LiquidityLock.sol` | Holds the v4 position NFTs of the plain 1%-fee pool until an immutable unlock time; ANYONE may `collect` the LP fees, split per side 50% burned / 50% to the Cup pot (reentrancy-guarded, fuzz + invariant tested) | not deployed |
| `GBootFixedPrice.sol` | Launch-default price source for the sinks and rewards: a fixed 0.1 RF per $GBOOT (no hook, so no TWAP) | not deployed |
| `PoolSwapper.sol` | Exact-input swaps through the PoolManager (unlock / swap / sync / settle / take), used for the launch smoke tests; holds no funds | see docs/DEPLOYMENT.md |
| `GBootFeeHook.sol` | OFF by default (launch = plain pool, 1% LP fee, no hook); upgrade path after an audit: 1% of every swap burned on both sides + a 30-minute-capable TWAP tick accumulator (beforeSwap / afterInitialize, 64 checkpoints ≥ 60 s apart) | **NOT DEPLOYED — requires audit and Rare Friends review** |
| `GBootPriceFeed.sol` | RF → $GBOOT at the 30-minute TWAP, with a readiness and a 1,000-tick divergence guard; replaces GBootFixedPrice for KitShop, SkillCup, Wildcards and RewardsDistributor only with the audited hook | not deployed |
| `RewardsDistributor.sol` | $GBOOT Skill Zone / streak rewards: referee EIP-712 signature, gen ≤ 4 hardwired Friend, a paid SkillCup entry, 2 RF per entry, 3 RF per Friend per day, nonce, expiry, season budget = min(halving ceiling, last season's sink burns); owns its EmissionVault | not deployed |
| `BallVault.sol` | v2 design: transferable "Vault Balls" backed 1:1 by the RF floor of redeemed balls, plus an escrow market above the floor (docs/BALL-MARKET.md) | **NOT DEPLOYED — design only; requires audit and Rare Friends review** |
| `KitShop.sol` | Burns $GBOOT for cosmetic unlocks recorded per friendId; fixed RF prices charged at the price source (`maxGbootIn`), weekly burn ledger, no owner | see docs/DEPLOYMENT.md |

```sh
cd contracts
forge build
forge test --no-match-contract Fork                      # unit tests (BallVault tests compile the SDK ChanceGame from ../node_modules: run npm install first)
forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL   # mainnet-fork tests (launch, lock, hook)
forge script script/Launch.s.sol --fork-url $ROBINHOOD_RPC_URL --sender <burner>   # launch rehearsal
```

`lib/` is the OpenZeppelin and forge-std subset shipped in the FriendSDK v0.1.2 package, with
the SDK's `provenance.json` hashes.
