# Status: live, simulated, roadmap

Last updated on 2026-09-27. Each "live" line is checked on-chain or in CI.

## Live on-chain (Robinhood mainnet, chain 4663)

| What | Evidence |
|---|---|
| The builder burner's Friend **#336583**, hardwired at **Generation 2** | [tx 0xd6a6a8b9…c78d0](https://robinhoodchain.blockscout.com/tx/0xd6a6a8b911e7a7eba8b5e5771a4ad17ed3fe3af785a1b7e16e0640e86acc78d0), block 73,713,157. `ownerOf` = burner `0xDB454B035777692EB6bd599297781a7ACC3A25e4`, `generation` = 2 ([TX-LOG](TX-LOG.md)). |

That is the only transaction. **No game contract, $GBOOT token, pool or vault is deployed from this repo, and none will be.** By founder decision, Rare Friends deploys the pilot's contracts.

## Real, but not a deployment

- **Wallet and ownership gate:** the SDK's real wallet connection and Friend ownership check, run against mainnet. The `test:real-gate` CI step admits the real owner of Friend #7730 and rejects a random address.
- **RF price:** the RF/USD price comes from the RF/WETH and WETH/USDG Uniswap v4 pools.
  - The preview uses a labelled on-chain snapshot from block 73,949,883, because the SDK preview may only read the game contract.
  - That figure was checked against an independent read: $0.0014565 per RF, so the pot is about $728 ([ADDRESSES](ADDRESSES.md)).

## Simulated, and labelled SIMULATED in the preview

- The RF balance: 20 RF, the SDK preview default.
- Packs, reveals, the Bag and redemptions.
- $GBOOT drops, Cup pots, race tables and rivals.
- The random beacon's wait. The preview uses 0 s; the Showroom can simulate 0, 5 or 15 s.

## Free, with no wallet

- **Practice page (`/practice/`):** 5 kicks on the real engine and scene, with no wallet, no Friend art and no economy, then "Get your Friend to play for real".

## Roadmap

| Item | Owner | Where it plugs in |
|---|---|---|
| SDK v0.2.1 pilot: sign-up, embedded wallets, loaned Friends, payments and backend | Rare Friends | [HANDOFF-RF.md](HANDOFF-RF.md) |
| The two random rolls on Rare Friends' contracts: the pack roll, and the penalty roll (commit the shot, then the beacon seeds the keeper) | Rare Friends | [RNG-INTEGRATION.md](RNG-INTEGRATION.md), `randomnessSource()` |
| Saved progress on the SDK backend (Nakama) | Rare Friends fork | `game/platform.ts` `remoteProgressStore` |
| Live Skill Cup referee (the beacon replaces the weekly HMAC seed) | later | `verifier/src/core.ts` |
| $GBOOT upgrade (100M supply, RF-paired, farm-proof rewards, free-price ball market) | later, after an audit and a legal review | [GBOOT-UPGRADE.md](GBOOT-UPGRADE.md) |

## Quality gates (CI)

- Every push runs the full CI ([ci.yml](../.github/workflows/ci.yml)).
- The public preview redeploys only after a fully green run.
- The stable baseline is commit `18b4bc8` (CI run 100 green, deployed); the `judging-stable-1` tag has to be created on GitHub ([RELEASES](RELEASES.md)).
