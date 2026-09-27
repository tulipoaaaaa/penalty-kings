# Scarcity rules and on-chain transparency (round 6 F30)

**Status:** designed and tested; NOTHING here is deployed yet (see `docs/DEPLOYMENT.md`). Every rule states whether it is **enforced on-chain** or a **policy**.

## Scarcity rules

| Rule | How | Enforced? |
|---|---|---|
| **$GBOOT supply is fixed at 100M** | `GBoot.sol` mints once in the constructor; no owner, no mint function | **On-chain** |
| **Emissions only fall** | `EmissionVault.capOf(week) = weeklyCap >> ⌊week / halvingWeeks⌋`; drops and rewards can never exceed it | **On-chain** |
| **Every burn is permanent** | `burn()` on the token (RF and $GBOOT); `LiquidityLock.collect` burns 50% of both LP-fee sides and sends 50% to the Cup pot (permissionless) | **On-chain** |
| **Every ball is backed 1:1 by RF** | The SDK ChanceGame reserves the top prize per ball in flight, and a held ball redeems for its fixed RF value at any time | **On-chain** (SDK contract) |
| **Tradeable balls are backed 1:1** | `BallVault`: vault RF ≥ Σ floors of all Vault Balls (invariant-tested); unwrap always pays the floor, with no fee and no pause | **On-chain** |
| **A discontinued edition is never re-minted as tradeable balls** | `BallVault.discontinue` closes wrapping forever (`EditionClosed`) | **On-chain**, for Vault Balls |
| **Edition caps** | `BallVault.capEdition`: set once, never raised; counts every Vault Ball ever minted | **On-chain**, for Vault Balls |
| **Friend-bound balls of an old season** | The SDK ChanceGame has no stop switch: anyone can `fund` it and play again | **Not enforceable**; stated plainly |
| **Odds and prizes are fixed per stadium** | ChanceGame outcome weights and rewards are set at deployment; the game UI reads them | **On-chain** |
| **No hidden supply** | 0% team allocation; the vault addresses are public | **On-chain** (allocation in `Launch.s.sol`) |

## On-chain transparency

Once live, anyone can verify every number with a public RPC read (no API key). These are the event sources:

| What | Source |
|---|---|
| **Emissions** (drops, rewards) | `EmissionVault` `Released(to, amount, week)` events plus `capOf(week)` |
| **Burns** | `Transfer(from, 0x0, amount)` on $GBOOT and RF, `LiquidityLock.FeesCollected` events, the Skill Cup / Wildcards 50% burns |
| **Buy-backs** | `EdgeSplitter` split events (40% RF burn / 30% $GBOOT buy-back and burn / 30% Cup) |
| **Ball supply** | ChanceGame `Settled(playId, friendId, outcomeId)` / `Redeemed` events; BallVault `Wrapped` / `Unwrapped` and `everMinted(id)` |
| **Prize backing** | ChanceGame free stake and reserved stake; BallVault `backing()` |

`scripts/cup/weekly.mjs` prints the week's emissions, burns and split from these reads. It holds no key and never signs. `docs/WEEKLY.md` explains how to reproduce it.
