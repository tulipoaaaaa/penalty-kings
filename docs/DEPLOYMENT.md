# Deployment status

> **Founder decision (2026-09-27): no deployments from this repo.** Rare Friends deploys its own contracts for the pilot's two random rolls (SDK v0.2.1), and the pilot ships without $GBOOT. The "not deployed" rows below are final for this repo; see [STATUS.md](STATUS.md) and [GBOOT-UPGRADE.md](GBOOT-UPGRADE.md).

| Component | Status |
|---|---|
| Simulated preview (GitHub Pages: `/`, `/pro/`, `/champions/`) | built by `.github/workflows/pages.yml` |
| Burner wallet | `0xDB454B035777692EB6bd599297781a7ACC3A25e4` (owner-created; key held by the owner and supplied only as a session environment variable). Funded by the owner: 0.00596 ETH and 10,000 RF left after hardwiring (read via RPC, Sep 27) |
| Hardwired Friend (burner) | **Friend #336583, Generation 2**: hardwired by the owner (tx in [TX-LOG](TX-LOG.md)) and verified on-chain (`ownerOf` = burner, `generation` = 2). The burner also holds a temporary Friend, #336584 |
| $GBOOT token | not deployed |
| Park / Pro / Champions ChanceGame | not deployed |
| $GBOOT/RF Uniswap v4 pool | not created |
| LiquidityLock | not deployed |
| Live build `/live/` | not published |
| Skill Cup referee (Cloudflare Worker) | built and tested, not deployed. A live Skill Cup also needs an SDK bridge action for kick inputs and signatures (the sandbox CSP allows only the Robinhood RPC); see ECONOMY.md |

## Rehearsals (mainnet fork, nothing broadcast)

Every launch step runs in CI against an anvil fork of Robinhood mainnet, using a throwaway key
created at runtime and funded **on the fork only**
([`.github/workflows/rehearsal.yml`](../.github/workflows/rehearsal.yml)):

| Step | Script | Result (run 1, 2026-09-27) |
|---|---|---|
| $GBOOT + KitShop + LiquidityLock + PoolSwapper; pool init; position A (600M $GBOOT) and floor position B (250k RF) minted straight into the lock; 1,000 RF buy + 10% sell-back | `contracts/script/Launch.s.sol` | passed ([run](https://github.com/tulipoaaaaa/penalty-kings/actions/runs/36296904970)) |
| Park ChanceGame via the SDK's own `deployGame` / `fundDeployment`, 20k RF stake; price, max prize and free stake verified | `scripts/onchain/stadium.mjs park 20000` | passed: deploy 4,405,603 gas · approve 46,390 · fund 210,340 |
| Lock semantics on real PositionManager (collect fees only; early withdraw reverts; withdraw after 180 days) | `contracts/test/Fork.t.sol` | passed ([CI](https://github.com/tulipoaaaaa/penalty-kings/actions/runs/36296746654)) |

At the measured 0.023 gwei, a full stadium deployment costs ≈ 0.0001 ETH in gas.

## Blockers

- The build container cannot reach `rpc.mainnet.chain.robinhood.com` or
  `robinhoodchain.blockscout.com` (network policy returns 403). A read-only QuickNode connector
  works for reads only. Mainnet sends, anvil fork rehearsals and Blockscout verification wait on
  network access.

This file is updated with every address, tx hash, Blockscout link, the pool id, lock details
and remaining balances as each step completes.
