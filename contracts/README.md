# Penalty Kings contracts

Foundry project (Solidity 0.8.36, the FriendSDK house style: custom errors, immutables, no
owner powers). The stadium prize banks are the **FriendSDK `ChanceGame`**, deployed from the
SDK package's own source (`node_modules/@rarefriends/friendsdk/contracts/src`), not copied here.

| Contract | Purpose | Status |
|---|---|---|
| `GBoot.sol` | $GBOOT: 1B fixed supply minted once; holder `burn`; no owner, mint, pause, tax or blacklist | see docs/DEPLOYMENT.md |
| `LiquidityLock.sol` | Holds the v4 position NFT until an immutable unlock time; the beneficiary may only collect fees until then | see docs/DEPLOYMENT.md |
| `KitShop.sol` | Burns $GBOOT for cosmetic unlocks recorded per friendId; fixed prices, no owner | see docs/DEPLOYMENT.md |

```sh
cd contracts
forge build
forge test --no-match-contract Fork                      # unit tests
forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL   # mainnet-fork tests
```

`lib/` is the OpenZeppelin and forge-std subset shipped in the FriendSDK v0.1.2 package, with
the SDK's `provenance.json` hashes.
