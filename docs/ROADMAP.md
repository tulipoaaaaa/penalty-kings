# Roadmap

No dates are promised. Each stage starts **after** the one before it is done; the "after" line says what it waits for.

## 1. Pilot, without $GBOOT (next)

- **What:** Rare Friends forks the game onto its SDK v0.2.1 and runs a pilot. Players sign in with email or Google, get an embedded wallet and a loaned Friend, buy RF, buy balls, open packs and redeem balls for RF. Progress is saved on Rare Friends' backend (Nakama).
- **Randomness:** two rolls only. The pack roll sets each ball's rarity; the penalty roll sets only the keeper's dive. Both come from Rare Friends' public beacon (about every 15 s). Skill decides the shot; a kick never pays RF ([RNG-INTEGRATION.md](RNG-INTEGRATION.md)).
- **Contracts:** Rare Friends deploys the three stadium prize banks and its own roll contracts. **No $GBOOT** (founder decision, 2026-09-27). We deploy nothing.
- **After:** the SDK v0.2.1 pieces are wired ([HANDOFF-RF.md](HANDOFF-RF.md), section 2) and the testnet dry run passes ([PILOT-DRYRUN.md](PILOT-DRYRUN.md)).
- Meanwhile, the judged build stays on FriendSDK v0.1.2, and the test app (branch `app/test-shell`, `test-app-*` releases) stays fully simulated.

## 2. Audit and legal review

- **What:** an external audit of the $GBOOT contract package, and a legal review of paid chance with redeemable prizes, country by country.
- **Audit scope:** `contracts/src` and `contracts/script/Launch.s.sol`, with the audit pack (`docs/AUDIT-PREP.md` on branch `claude/clever-mccarthy-ay7qv7`). The fee-burn hook and its price feed are audited separately before they are ever switched on.
- **Legal:** [LEGAL.md](LEGAL.md). The answer decides where the game may run with real money at all.
- **After:** the pilot shows people play and the prize banks behave as designed.

## 3. $GBOOT launch

- **What:** the tested, undeployed package in [GBOOT-UPGRADE.md](GBOOT-UPGRADE.md), launched with its one default:
  - a **plain Uniswap v4 $GBOOT/RF pool with a 1% LP fee and no hook**;
  - the pool's fees are collected by `LiquidityLock` and split **50% to the Golden Boot Cup pot / 50% burned**;
  - sinks priced at a fixed $GBOOT price until an audited on-chain price exists.
- **Still true:** $GBOOT is optional. RF odds, race points and drops are the same for a player who ignores it ([ECONOMY.md](ECONOMY.md)).
- **After:** a clean audit, a positive legal review, the season-0 bootstrap change, and a fork rehearsal of the launch script (checklist in [GBOOT-UPGRADE.md](GBOOT-UPGRADE.md)).

## 4. Store apps (Apple App Store, Google Play)

- **What:** real, signed store apps, built from the same Capacitor shells as the test app.
- **Why this comes late:**
  - **Licences:** a game where you pay for a random prize that is worth real money counts as real-money gaming in many countries. Each country needs its own licence or a clear legal "no licence needed".
  - **Geo-blocking:** where no licence exists, the app must block those players, reliably, by location.
  - **Apple (App Store Review Guideline 5.3, gaming and contests):** real-money gaming apps must hold the licences for every place they are used, be geo-restricted to those places and be free to download; credit for real-money play may not be sold through in-app purchase.
  - **Google Play (real-money gambling policy):** allowed only in approved countries, with an application to Google, proof of a licence, and age and location checks.
  - **Store approval:** both stores review the app before it goes live, and again with updates.
  - Store rules change; re-read both policies before any submission.
- **After:** the licences and the legal review for the first countries, and a company able to hold them. Until then, testers use the test app ([ANDROID-INSTALL.md](ANDROID-INSTALL.md), [IPHONE-SIDELOAD.md](IPHONE-SIDELOAD.md); [TESTFLIGHT.md](TESTFLIGHT.md) is parked).

## 5. Version 2 features

- **Leagues:** Generation-vs-Generation standings shared across players.
- **Clubs:** membership, club tables and chat.
- **PvP keepers:** play as the keeper against a real player, checked by the same replay referee (`verifier/`).
- **After:** a live backend and the referee deployed and reviewed. Each of these needs shared state the game does not have today ([ECONOMY.md](ECONOMY.md), "C4 social loop: what shipped, and what is NOT now").
