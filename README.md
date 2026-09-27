# Penalty Kings

A Rare Friends penalty shootout. Your hardwired Rare Friend is the striker. You buy balls with
$RAREFRIENDS (RF), reveal each ball's rarity, and flick it past four original keepers. A
fixed-supply game token, **$GBOOT**, is paired with RF. Built on **FriendSDK v0.1.2** for the
Rare Friends Vibeathon.

> **RF first.** You play with RF. Every ball is backed by RF in its stadium's prize bank and can
> be redeemed for RF. On-chain randomness sets how much each ball pays, and the average return is
> 90%. **$GBOOT is optional**: it is a bonus layer for skill and loyalty (drops, lacing perks,
> Skill Cup, Wildcards, cosmetics). You never need it to play, and it never changes a ball's RF
> odds. See [docs/ECONOMY.md](docs/ECONOMY.md#rf-first). Nothing here is investment advice.

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

## Dev mode (local only)

Two local pages for playing and inspecting the game. Neither is ever published: `dev/` is not
part of `npm run build:site`, and CI fails if dev code reaches `site/` (`npm run check:no-dev`).

| Page | URL | What it is |
|---|---|---|
| Play | http://localhost:5199/ | The real game in the real SDK runtime, with the simulated preview economy. A **read-only** mock wallet (red DEV bar) impersonates the public owner of a Friend you pick, so the real ownership gate runs against Robinhood mainnet. It cannot sign; every signing method is refused. |
| Showroom | http://localhost:5199/showroom/ | The scene engine on demand. Triggers for goal/save/post/over/wide (produced by the real engine), 8 celebrations, reactions, every rarity reveal including the Golden Boot, walk-out, streak fire, Mexican wave and all commentary. Pickers for keeper (12), stadium, weather and ball. Speed 0.1–2×, pause and frame-step, reduced motion, a 360 px phone frame, a frame-time overlay and a Cast tab. |

**Windows + WSL, step by step**

1. Open the Ubuntu (WSL) terminal.
2. Go to the project: `cd ~/penalty-kings` (or wherever you cloned it; if needed, clone it first with
   `git clone https://github.com/tulipoaaaaa/penalty-kings.git`).
3. Get the latest code: `git pull`
4. Install dependencies (the first time, and after `package-lock.json` changes): `npm ci`
5. Start dev mode: `npm run play:dev`
6. In Windows Chrome, open **http://localhost:5199/** (play) or **http://localhost:5199/showroom/**
   (Showroom). WSL forwards `localhost` to Windows automatically.
7. Edits rebuild automatically; refresh the page. Stop the server with `Ctrl+C`.

If port 5199 is taken, run `PORT=5200 npm run play:dev` and use that port instead. The server binds
`0.0.0.0` so Windows can reach it; it only serves the game build, the Showroom and fonts.

## Repository map

| Path | What it is |
|---|---|
| `games/penalty-kings/` | The game: React adapter (`index.tsx`), canvas scene, original pixel art, audio, UI, `game.json` (Park) and `tiers/*.json` (all three stadiums). [Game README](games/penalty-kings/README.md) |
| `packages/engine/` | Deterministic shot physics and keeper AI, shared by the game and the Skill Cup referee |
| `verifier/` | Skill Cup referee (Cloudflare Worker). Inputs are committed before the dive exists, dives come from a weekly HMAC secret, and results are signed |
| `contracts/` | Foundry: `GBoot`, `KitShop`, `LiquidityLock`, `PoolSwapper`, `GBootFeeHook` (fee burn + TWAP), `GBootPriceFeed`, `RewardsDistributor` (all v2, not deployed), `script/Launch.s.sol`, and unit and mainnet-fork tests |
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
| `node scripts/economy-sim.mjs` | Tokenomics v2 (100M $GBOOT): checks constants against `contracts/src`, halving supply schedule, burns per volume, lacing, airdrop sizing, solvency, pool maths, farm checks, scale table (rewrites the ECONOMY.md tables) |
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
