# $GBOOT upgrade package (designed and tested, NOT deployed)

**Founder decision (2026-09-27):** the Rare Friends pilot ships **without $GBOOT**. The founder deploys his own prototype contracts for the two random rolls (see [RNG-INTEGRATION.md](RNG-INTEGRATION.md)). Everything in this document is kept as a **tested, undeployed upgrade** for later. Nobody has deployed any of it, and no deployment is planned or authorised.

**Status of tokenomics v2:** approved by the owner as a **design only**.

## What is in the package

| Contract (`contracts/src/`) | Role |
|---|---|
| `GBoot.sol` | 100M fixed supply; no owner, mint function, tax or blacklist |
| `EmissionVault.sol` | Weekly release caps that halve on a schedule (drops, cups, rewards) |
| `Bootroom.sol` | Lacing: lock $GBOOT against a Friend for perk tiers 0–3 (cosmetics, XP, cup seeding; no payouts); 50% burn if unlaced early. Only the Friend (owner or token-bound account) or the whitelisted airdrop starts a lock; others only top up a live one; `lace(id, amount, weeks, maxUnlockAt)` reverts rather than join a longer lock |
| `FriendsAirdrop.sol` | 10M pre-laced airdrop to Friends (Merkle); unclaimed tokens go to Cups after 180 days |
| `EdgeSplitter.sol` | The 10% edge split: 40% RF burned / 30% $GBOOT bought back and burned / 30% Golden Boot Cup |
| `LiquidityLock.sol` | Locks the launch liquidity; anyone's `collect` splits the 1% LP fees, per side, 50% burned / 50% to the Golden Boot Cup pot |
| `KitShop.sol` | $GBOOT sink for cosmetics: 100% burned |
| `SkillCup.sol`, `Wildcards.sol` | $GBOOT sinks (50% burned / 50% pot) |
| `RewardsDistributor.sol` | Farm-proofed $GBOOT rewards: a referee EIP-712 signature, a hardwired Friend of generation ≤ 4, a real Skill Cup entry, per-entry and per-day caps, a season budget |
| `GBootFixedPrice.sol` | Launch-default price source: a fixed 0.1 RF per $GBOOT for the sinks and rewards (no hook, so no TWAP) |
| `GBootFeeHook.sol`, `GBootPriceFeed.sol` | **Off by default.** Fee-burn hook plus a 30-minute TWAP (time-weighted average price) oracle, used to price sinks in RF after an audit |
| `BallVault.sol` | Tradeable "Vault Balls" backed 1:1 by RF; a free-price escrow market; enforced edition scarcity |
| `script/Launch.s.sol` | The whole launch wiring (the ONE default: plain pool, 1% LP fee, no hook, `LiquidityLock` and `EdgeSplitter` paying the Cup pot `CUP_POT`), rehearsed on a mainnet fork in CI |

**Tests:** 206 Foundry unit/fuzz/invariant tests (`cd contracts && forge test --no-match-contract Fork`, offline) plus 7 mainnet-fork tests (`forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL`). The full maths is in [ECONOMY.md](ECONOMY.md), the scarcity rules in [SCARCITY.md](SCARCITY.md), and the legal risks (not legal advice) in [LEGAL.md](LEGAL.md).

## Recorded defaults (owner-approved design)

| Setting | Default | Notes |
|---|---|---|
| **Pool** | **Owner decision "option B": pool fees feed the pot.** A plain Uniswap v4 GBOOT/RF pool with a **1% LP fee and no hook**. The locked positions earn the fee; anyone's weekly `LiquidityLock.collect` splits each side 50% burned / 50% to the Golden Boot Cup pot. | Before this, the pool had LP fee 0 (the hook burned 1% instead), so the lock's burn collected nothing. The pot sizes are in [ECONOMY.md, "Where the pot comes from"](ECONOMY.md#where-the-pot-comes-from). |
| **Fee hook** | **Off until audited.** | Without the hook there is no on-chain TWAP. So until the audit, the sinks use **fixed $GBOOT prices** through `GBootFixedPrice` (0.1 RF per $GBOOT): Skill Cup 100, Wildcards 100, kits as listed. RF-priced sinks switch on with the audited hook plus `GBootPriceFeed`, which needs a new pool. Known limit of fixed prices: if $GBOOT falls about 90%, Wildcards become a cheaper route to race points than balls (ECONOMY.md, farm check). |
| **Rewards per entry** | **≤ 2 RF-equivalent** per Skill Cup entry | Enforced in `RewardsDistributor` |
| **Rewards per day** | **≤ 3 RF-equivalent** per Friend per day | Enforced |
| **Season 0 bootstrap** | **Proposed: 50,000 $GBOOT** (1% of the 5M rewards allocation) for the first 4-week season, under the same per-entry and per-day caps | The code currently pays **0** in season 0, because there is no previous season's burn to size it by. The proposal adds a one-time bootstrap constant for season 0 only. It's a one-line change plus a test, to be made when the upgrade is revived. At the 3 RF/day cap and 0.1 RF per $GBOOT, 50,000 $GBOOT serves about 1,600 capped Friend-days. |
| **Perk tiers** | Tier 2 at **50%**, tier 3 at **85%** | See the plain-words line below |
| **TWAP window / guard** | 30 minutes; a claim is refused if spot is more than 1,000 ticks (~10.5%) from the TWAP | Relevant only with the audited hook |

**What "50% / 85%" are percentages of, in one line:** they are percentages of the way to the **maximum lacing commitment**, which is 10,000 $GBOOT locked for 52 weeks, measured on a log scale of x = ($GBOOT, capped at 10,000) × weeks: `progressBps = 10,000 × log2(1 + x) ÷ log2(1 + 520,000)` (`Bootroom.progressBps`). Tier 1 is any live lace below 50%, e.g. 72 $GBOOT for 10 weeks (x = 720, just under). Tier 2 (50%) needs x ≥ 721 (√520,001 − 1 ≈ 720.1), e.g. 103 $GBOOT for 7 weeks or 100 for 8. Tier 3 (85%) needs x ≥ 72,211 (520,001^0.85 − 1 ≈ 72,210.03), e.g. 1,400 $GBOOT for 52 weeks (72,800) or 10,000 for 8 weeks; 7,221 for 10 weeks (72,210) is still tier 2.

## Reviving the upgrade later (checklist)

1. An external audit of `GBootFeeHook` + `GBootPriceFeed` (or launch without them, per the default above). The auditor's starting pack (contracts, trust assumptions, privileged roles, Slither triage, test inventory, open questions) is [AUDIT-PREP.md](AUDIT-PREP.md).
2. For the no-hook default, the fixed-$GBOOT-price mode is `GBootFixedPrice` (done: `Launch.s.sol` wires it into `KitShop`, `SkillCup`, `Wildcards` and `RewardsDistributor`).
3. Add the season-0 bootstrap constant and its test.
4. Rehearse `Launch.s.sol` on a fork (`.github/workflows/rehearsal.yml`), then do a legal review (`HUMAN-CHECKS.md`).
5. Only then deploy, from a fresh operator wallet, with every transaction logged in `TX-LOG.md` (rehearsal-first rules in the README).
