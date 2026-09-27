# $GBOOT upgrade package (designed and tested, NOT deployed)

**Founder decision (2026-09-27):** the Rare Friends pilot ships **without $GBOOT**. The founder deploys his own prototype contracts for the two random rolls (see [RNG-INTEGRATION.md](RNG-INTEGRATION.md)). Everything in this document is kept as a **tested, undeployed upgrade** for later. Nobody has deployed any of it, and no deployment is planned or authorised.

**Status of tokenomics v2:** approved by the owner as a **design only**.

## What is in the package

| Contract (`contracts/src/`) | Role |
|---|---|
| `GBoot.sol` | 100M fixed supply; no owner, mint function, tax or blacklist |
| `EmissionVault.sol` | Weekly release caps that halve on a schedule (drops, cups, rewards) |
| `Bootroom.sol` | Lacing: lock $GBOOT against a Friend for perk tiers 0–3 (cosmetics, XP, cup seeding; no payouts); 50% burn if unlaced early |
| `FriendsAirdrop.sol` | 10M pre-laced airdrop to Friends (Merkle); unclaimed tokens go to Cups after 180 days |
| `EdgeSplitter.sol` | The 10% edge split: 40% RF burned / 30% $GBOOT bought back and burned / 30% Golden Boot Cup |
| `LiquidityLock.sol` | Locks the launch liquidity; `collectAndBurn` burns both fee sides (permissionless) |
| `KitShop.sol`, `SkillCup.sol`, `Wildcards.sol` | $GBOOT sinks (50% burned / 50% pot) |
| `RewardsDistributor.sol` | Farm-proofed $GBOOT rewards: a referee EIP-712 signature, a hardwired Friend of generation ≤ 4, a real Skill Cup entry, per-entry and per-day caps, a season budget |
| `GBootFeeHook.sol`, `GBootPriceFeed.sol` | Fee-burn hook plus a 30-minute TWAP (time-weighted average price) oracle, used to price sinks in RF |
| `BallVault.sol` | Tradeable "Vault Balls" backed 1:1 by RF; a free-price escrow market; enforced edition scarcity |
| `script/Launch.s.sol` | The whole launch wiring, rehearsed on a mainnet fork in CI |

**Tests:** 169 Foundry unit/fuzz/invariant tests plus 7 mainnet-fork tests (`cd contracts && forge test`). The full maths is in [ECONOMY.md](ECONOMY.md), the scarcity rules in [SCARCITY.md](SCARCITY.md), and the legal risks (not legal advice) in [LEGAL.md](LEGAL.md).

## Recorded defaults (owner-approved design)

| Setting | Default | Notes |
|---|---|---|
| **Fee hook** | **Off until audited.** Launch with a plain Uniswap v4 GBOOT/RF pool (no hook). | Without the hook there is no on-chain TWAP. So until the audit, the sinks use **fixed $GBOOT prices**: Skill Cup 100, Wildcards 100, kits as listed. RF-priced sinks switch on with the audited hook plus `GBootPriceFeed`. |
| **Rewards per entry** | **≤ 2 RF-equivalent** per Skill Cup entry | Enforced in `RewardsDistributor` |
| **Rewards per day** | **≤ 3 RF-equivalent** per Friend per day | Enforced |
| **Season 0 bootstrap** | **Proposed: 50,000 $GBOOT** (1% of the 5M rewards allocation) for the first 4-week season, under the same per-entry and per-day caps | The code currently pays **0** in season 0, because there is no previous season's burn to size it by. The proposal adds a one-time bootstrap constant for season 0 only. It's a one-line change plus a test, to be made when the upgrade is revived. At the 3 RF/day cap and 0.1 RF per $GBOOT, 50,000 $GBOOT serves about 1,600 capped Friend-days. |
| **Perk tiers** | Tier 2 at **50%**, tier 3 at **85%** | See the plain-words line below |
| **TWAP window / guard** | 30 minutes; a claim is refused if spot is more than 1,000 ticks (~10.5%) from the TWAP | Relevant only with the audited hook |

**What "50% / 85%" are percentages of, in one line:** they are percentages of the way to the **maximum lacing commitment**, which is 10,000 $GBOOT locked for 52 weeks, measured on a log scale of ($GBOOT × weeks). So 50% (tier 2) needs only about 720 $GBOOT-weeks, e.g. 72 $GBOOT for 10 weeks, and 85% (tier 3) needs about 72,000 $GBOOT-weeks, e.g. 1,400 $GBOOT for 52 weeks.

## Reviving the upgrade later (checklist)

1. An external audit of `GBootFeeHook` + `GBootPriceFeed` (or launch without them, per the default above).
2. For the no-hook default: give `KitShop`, `SkillCup` and `Wildcards` a fixed-$GBOOT-price mode. The current contracts require `GBootPriceFeed`; the fixed-price versions are in git history before the F28 commit `be216b4`.
3. Add the season-0 bootstrap constant and its test.
4. Rehearse `Launch.s.sol` on a fork (`.github/workflows/rehearsal.yml`), then do a legal review (`HUMAN-CHECKS.md`).
5. Only then deploy, from a fresh operator wallet, with every transaction logged in `TX-LOG.md` (rehearsal-first rules in the README).
