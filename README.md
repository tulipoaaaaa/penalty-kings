# Penalty Kings

A Rare Friends penalty shootout. Your hardwired Rare Friend is the striker. You buy balls with
$RAREFRIENDS (RF), reveal each ball's rarity, and flick it past four original keepers. A
fixed-supply game token, **$GBOOT**, is paired with RF. Built on **FriendSDK v0.1.2** for the
Rare Friends Vibeathon.

> The public preview's economy is **simulated** and labelled as such. The wallet connection and
> the hardwired-Friend ownership gate are real. Live contracts are an optional extra, recorded in
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Play:** https://tulipoaaaaa.github.io/penalty-kings/. You need a browser wallet on Robinhood
mainnet (4663) holding a hardwired Generations NFT (generation ≥ 1).

## Quick start

```sh
npm ci                 # Node.js 22+
npm run dev            # http://localhost:4173
npm run build:site     # static site in site/ (Park /, Pro /pro/, Champions /champions/)
```

## Repository map

| Path | What it is |
|---|---|
| `games/penalty-kings/` | The game: React adapter (`index.tsx`), canvas scene, original pixel art, audio, UI, `game.json` (Park) and `tiers/*.json` (all three stadiums). [Game README](games/penalty-kings/README.md) |
| `packages/engine/` | Deterministic shot physics and keeper AI, shared by the game and the Skill Cup referee |
| `verifier/` | Skill Cup referee (Cloudflare Worker). Inputs are committed before the dive exists, dives come from a weekly HMAC secret, and results are signed |
| `contracts/` | Foundry: `GBoot`, `KitShop`, `LiquidityLock`, `PoolSwapper`, `GBootFeeHook` (not deployed), `script/Launch.s.sol`, and unit and mainnet-fork tests |
| `scripts/` | `verify-odds`, `economy-sim`, the pool plan and TickMath port, stadium deployer, weekly Cup/drop computation, budget guard, wallet loader, secret scan, test runners |
| `docs/` | [ECONOMY](docs/ECONOMY.md) · [ADDRESSES](docs/ADDRESSES.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [TX-LOG](docs/TX-LOG.md) · [DROPS](docs/DROPS.md) · [WEEKLY](docs/WEEKLY.md) · [HUMAN-CHECKS](docs/HUMAN-CHECKS.md) |
| `submission/` | Vibeathon submission README and PR text |
| `vendor/` | The official FriendSDK v0.1.2 release archive (sha256 in docs/ADDRESSES.md) |

## Checks

| Command | What it proves |
|---|---|
| `npm run typecheck` | TypeScript across the game, engine and referee |
| `npm run check` | FriendSDK game validation (sandbox boundaries, definition) |
| `npm run verify:odds` | Every stadium: 10,000 bps and exactly 90.00% expected return |
| `npm run test:engine` · `npm run test:verifier` | Physics determinism; the referee's replay, signatures, anti-forgery and rate limits |
| `node scripts/economy-sim.mjs` | Monte Carlo solvency, pool maths, farm check and the scale table (rewrites the ECONOMY.md tables) |
| `npm run test:smoke` · `npm run test:game` | SDK browser harness and the full buy → place → reveal → shoot → HUD flow at 960 px and 360 px |
| `npm run test:real-gate` | The real SDK ownership gate against Robinhood mainnet: read-only, no mocks, needs network |
| `cd contracts && forge test` | Contract unit tests. The `Fork` suites run against a mainnet fork in CI |
| `npm run secret-scan` | No mnemonics or private keys in tracked files (also a pre-commit hook) |

All of these run in GitHub Actions ([ci.yml](.github/workflows/ci.yml)). Every launch step is
also rehearsed on a mainnet fork ([rehearsal.yml](.github/workflows/rehearsal.yml)).

## Safety rules for live transactions

- **Rehearsal first:** every mainnet transaction is rehearsed first on an anvil fork with the
  same code and arguments (`scripts/onchain/lib.mjs`, `forge script`).
- **Hard caps:** spend caps are enforced in `scripts/lib/budget.mjs`: cumulative ETH ≤ funded −
  0.003 ETH reserve, per-swap caps, and ≤ 3% slippage from a fresh quote.
- **Logging:** each transaction is logged in [docs/TX-LOG.md](docs/TX-LOG.md) before sending and
  completed with its receipt afterwards.
- **Secrets:** the burner's secret lives only in the `BURNER_MNEMONIC` environment secret or an
  encrypted Foundry keystore outside the repo. It never goes in git, CI or logs.

## Licence and assets

Source is Apache-2.0. All game art is original and drawn in code. The Friend is its canonical
on-chain sprite, unaltered, loaded with the FriendSDK sprite reader. SDK artwork and sounds are
used under the FriendSDK NOTICE (shipped in the SDK package, `vendor/rarefriends-friendsdk-0.1.2.tgz`) permissions. No
real clubs, crests, players or brands appear.
