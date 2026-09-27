# Penalty Kings contracts

Foundry project (Solidity 0.8.36, the FriendSDK house style: custom errors, immutables, no
owner powers). The stadium prize banks are the **FriendSDK `ChanceGame`**, deployed from the
SDK package's own source (`node_modules/@rarefriends/friendsdk/contracts/src`), not copied here.

| Contract | Purpose | Status |
|---|---|---|
| `GBoot.sol` | $GBOOT: 1B fixed supply minted once; holder `burn`; no owner, mint, pause, tax or blacklist | see docs/DEPLOYMENT.md |
| `LiquidityLock.sol` | Holds the v4 position NFT until an immutable unlock time; the beneficiary may only collect fees until then | see docs/DEPLOYMENT.md |
| `PoolSwapper.sol` | Exact-input swaps through the PoolManager (unlock / swap / sync / settle / take), used for the launch smoke tests; holds no funds | see docs/DEPLOYMENT.md |
| `GBootFeeHook.sol` | v1.2 design: 1% afterSwap fee on a 0%-LP-fee pool; RF side burned, $GBOOT side to the Cup | **NOT DEPLOYED — requires audit and Rare Friends review** |
| `KitShop.sol` | Burns $GBOOT for cosmetic unlocks recorded per friendId; fixed prices, no owner | see docs/DEPLOYMENT.md |

```sh
cd contracts
forge build
forge test --no-match-contract Fork                      # unit tests
forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL   # mainnet-fork tests (launch, lock, hook)
forge script script/Launch.s.sol --fork-url $ROBINHOOD_RPC_URL --sender <burner>   # launch rehearsal
```

`lib/` is the OpenZeppelin and forge-std subset shipped in the FriendSDK v0.1.2 package, with
the SDK's `provenance.json` hashes.
