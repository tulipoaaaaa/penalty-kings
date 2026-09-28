# Status: live, simulated, roadmap

Last updated on 2026-09-28 (branch head `d51e550`, CI run 143 green).  Each "live" line is checked on-chain or in CI.

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
- $GBOOT drops, Cup pots, the "last week" winners ticker, race tables and rivals (a simulated rival buys a Pro ball every 15 s so the pot visibly ticks).
- Champions Night's doubled race points (live Cup weights never double).
- The random beacon's wait. The preview uses 0 s; the Showroom can simulate 0, 5 or 15 s.

## What shipped in the judged build

- **Modes:** tutorial, Penalties (12-keeper ladder), Free Kicks, Target Practice, World Tour (30 levels), Daily Challenge; the optional Big Match.
- **Big Match and meta:** Ball shop with a display case and exact odds, packs of 1/2/5/10, pack reveal with true totals, the Bag, redemptions, Cups (Golden Boot Cup pot, draw countdown, winners ticker), Champions Night (Saturday 19:00–21:00 UTC), Kit shop (cosmetics), the Scouting Book sticker album.
- **Retention (XP and cosmetics only):** NEXT GOAL, Keeper of the Week (double XP), the Daily "Day N" streak, share cards and challenge codes.
- **Game feel, sound and atmosphere:** hit-stop, net bulge, near-miss moments, streak fever at 3/5/10, the sound pass (voiced SFX, crowd hush and roar, master limiter), weather, floodlight pool and crowd band, UI press/entry animations, count-up Results. All with reduced-motion equivalents.

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
- Latest branch head `d51e550`: CI run 143 green, mainnet-fork rehearsal run 101 green.
- Local counts on `d51e550`: game-logic 206, engine 54, Match Director 27, referee 15, weekly Cup 9, Foundry 206 offline (plus the `Fork` suites in CI).
- Browser suites in CI: `test:smoke`, `test:practice`, `test:landing`, `test:game`, `test:phone`, `test:modes`, `test:skillzones`, `qa:90s`, `test:flow`, `test:real-gate`, and `test:overflow:ci` (its own job).
- `judging-stable-1` = `18b4bc8` (tagged). Later work (from `135c2db`) goes into `judging-stable-2` at the freeze, Sep 29 ([RELEASES](RELEASES.md)).

## Open items for the founder

- **Freeze (Sep 29 10:00–12:00 UTC):** create the `judging-stable-2` tag on the frozen commit; the submission links already point at it.
- **Media re-record after the freeze fixes:** the judge-path video and its frames (the README now shows `judge-pack-summary.png`, written by `npm run record:judge`), and the money shot cropped to the game frame (no SDK harness chips).
- **Paste by hand:** `submission/README.md` and `submission/PR.md` into the vibeathon fork.
- **Human checks:** a real-wallet playthrough on a phone ([HUMAN-CHECKS](HUMAN-CHECKS.md)), and a legal review before any live promotion of paid chance ([LEGAL](LEGAL.md)).
- **Design decision to confirm:** the pre-kick keeper tell is hidden in beacon mode ([RNG-INTEGRATION](RNG-INTEGRATION.md)).
- **Ask of the SDK v0.2.1 host:** ≥ 11 px toolbar text on phones, a bigger preview wallet option ([HANDOFF-RF](HANDOFF-RF.md)).
