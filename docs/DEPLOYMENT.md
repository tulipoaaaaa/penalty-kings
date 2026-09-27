# Deployment status

| Component | Status |
|---|---|
| Simulated preview (GitHub Pages: `/`, `/pro/`, `/champions/`) | built by `.github/workflows/pages.yml` |
| Burner wallet | not created |
| Hardwired Friend (burner) | — |
| $GBOOT token | not deployed |
| Park / Pro / Champions ChanceGame | not deployed |
| $GBOOT/RF Uniswap v4 pool | not created |
| LiquidityLock | not deployed |
| Live build `/live/` | not published |

## Blockers

- The build container cannot reach `rpc.mainnet.chain.robinhood.com` or
  `robinhoodchain.blockscout.com` (network policy returns 403). A read-only QuickNode connector
  works for reads only. Mainnet sends, anvil fork rehearsals and Blockscout verification wait on
  network access.

This file is updated with every address, tx hash, Blockscout link, the pool id, lock details
and remaining balances as each step completes.
