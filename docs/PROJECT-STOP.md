# Where we stopped, and the natural next steps

The build phase ends at the **code freeze, Sep 29 2026 12:00 UTC**. From then on the Rare Friends founder
takes the project forward; we stay available for opinions and help. No new features after this point.
The judged branch only gets critical fixes (a crash, a soft-lock or a wrong label), each with a test,
and only after telling the owner first.

## 1. The stop point

| Branch / tag | What it holds | State at the stop |
|---|---|---|
| `judging-stable-2` (tag) | The judged Vibeathon build, frozen | sha: _filled in at the freeze_ (created by the owner) |
| `judging-stable-1` (tag) = `18b4bc8` | The first judged snapshot | frozen, never touched |
| [`claude/clever-mccarthy-ay7qv7`](https://github.com/tulipoaaaaa/penalty-kings/tree/claude/clever-mccarthy-ay7qv7) | Active branch; the judged build lives here | full local suite + CI green before every push |
| [`early-access`](https://github.com/tulipoaaaaa/penalty-kings/tree/early-access) | The founder's Early Access preset (4 features, per-Friend rating) | never merged into the judged branch |
| [`app/test-shell`](https://github.com/tulipoaaaaa/penalty-kings/tree/app/test-shell) | Test app: wallet seam, simulated sign-up, Android APK + unsigned iPhone .ipa, handoff docs | Release `test-app-*` (prerelease) |
| `main` | Out of date (Sep 27); its README points to the active branch | not used |

**Read first:** [EARLY-ACCESS.md](EARLY-ACCESS.md) (on `early-access`) · [HANDOFF-RF.md](HANDOFF-RF.md) ·
[AUDIT-PREP.md](AUDIT-PREP.md) · [ROADMAP.md](ROADMAP.md) (on `app/test-shell`) ·
[PILOT-DRYRUN.md](PILOT-DRYRUN.md) (on `app/test-shell`) · [STATUS.md](STATUS.md) · [BUG-QUEST.md](BUG-QUEST.md) ·
[GREATNESS.md](GREATNESS.md).

## 2. What is done

- **The game:** six free modes plus the optional Big Match; Ball shop with a display case, packs,
  reveal, Bag, redeem; Cups, Champions Night; Scouting Book album; share cards and challenge codes;
  Keeper of the Week; Daily streak; free practice page; game feel, sound, atmosphere; reduced-motion
  equivalents everywhere.
- **Quality:** every Bug Quest item (P0, P1, P2, the QA sweeps) fixed or recorded with a test;
  design score 4.9 → 6.5 (GREATNESS.md); an automated overflow sweep in CI; full browser suites in CI.
- **Contracts (not deployed):** 206 offline Foundry tests plus fork tests; SafeERC20; Slither triaged
  (AUDIT-PREP.md). Nothing is deployed from this repo; Rare Friends deploys the pilot.
- **Test app:** installable Android APK and unsigned iPhone .ipa with a fully simulated sign-up
  (email/Google → wallet → buy RF → loan/own a Friend → hardwire → play → pack). Real Privy is wired
  but off.
- **Early Access:** a build preset with only real-money balls, Practice, Daily Challenge and the
  Scouting Book; per-generation payout ratings (gen-6 90% … gen-1 95%) as editable config, with odds
  generated from the rating and verified in `verify:odds`; an optional capped cosmetic bonus.

## 3. What is still simulated

The preview economy (RF balance, packs, reveals, Bag, redemptions, pots, winners, race tables,
Champions Night doubling), the test app's sign-up, wallet, payments and Friend loan, and the random
beacon wait. Everything simulated is labelled SIMULATED / TEST BUILD in the UI. See STATUS.md.

## 4. Left open, and whose it is

| Item | Owner |
|---|---|
| Create the tag `judging-stable-2` on the sha given at the freeze (the session proxy blocks tag pushes) | project owner |
| Paste the submission text into the fork / PR | project owner |
| Create `tulipoaaaaa/penalty-kings-app` and install the Claude GitHub App, to host the iPhone home-screen version (optional) | project owner |
| Android signing secrets (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) so test APKs update in place (optional) | project owner |
| Real-device check of haptics, landscape lock, keep-awake and back button in the test app | project owner |
| The open questions in section 5 | founder |

## 5. Open questions for the founder

1. **Loaned Friend:** who signs pack buys and redeems, and where does a redeemed prize go?
2. **Pack randomness:** does the v0.2.1 beacon replace the stadium contract's Dice request, or is it a new contract (interface, admin roles)?
3. **House edge:** where does the pilot's 10% edge go (no fee-split contract in the pilot; `team` can withdraw it)?
4. **Per-Friend rating:** one stadium contract has one set of odds; per-generation payout needs one contract per rating or a contract change. Which, and who deploys it?
5. **Embedded wallet:** EIP-7702 or ERC-4337; does the ownership check accept it; who pays gas and randomness fees?
6. **Payments:** how do Apple Pay / Google Pay top-ups arrive as RF (provider), plugged into `buyRF()`?
7. **Testnet:** which network and addresses; will v0.2.1 ship deploy tooling that isn't mainnet-only?
8. **Saves:** confirm the Nakama backend and how the game calls it (the seam in `game/platform.ts` is not wired yet).
9. **Keeper tells:** confirm they stay hidden in beacon modes.
10. **Legal:** who owns the review of paid chance with a redeemable prize (18+ gate, regions), and later store licences?
11. **SDK frame:** will v0.2.1 still read `host.css` (we ask for ≥ 11 px toolbar text on phones)?

## 6. The natural next steps (in order)

1. **Founder decisions** on section 5 — they unblock everything below.
2. **SDK v0.2.1 integration:** plug login, embedded wallet, loaned Friend, payments, saves and the beacon
   into the marked seams (`packages/wallet` `WalletProvider`, `game/platform.ts`, the randomness source).
   HANDOFF-RF.md section 2 lists each file and function and how to verify it.
3. **Contracts:** decide the per-rating approach, parameterise the mainnet-only deploy/report scripts,
   run the testnet dry run in PILOT-DRYRUN.md, then an external audit using AUDIT-PREP.md.
4. **Legal review** of paid chance with redeemable prizes before any live promotion.
5. **Early Access launch** from the `early-access` preset once 2–4 are done; a human real-wallet
   playtest first.
6. **Test app on real devices:** a round of phone testing; switch on real Privy (App ID + redirect
   `com.penaltykings.test://auth`); TestFlight / Play internal testing once developer accounts exist.
7. **Later (ROADMAP.md):** the $GBOOT launch after audit and legal (plain 1% pool, fees 50% pot /
   50% burn), store apps (gambling licences per country, geo-blocking, store approval), then v2
   (leagues, clubs, PvP keepers).

## 7. Known polish backlog (not blocking)

From the final design audit and the lanes' reports, none of them blocking:
- pack summary as count-up tiles (Spent / Worth / Net) instead of prose;
- the no-wallet landing page (wordmark, pixel type; the SDK wallet box fills most of it);
- the pot banner is three lines during play at 1280 px;
- keeper dive arms are plain lines;
- one music loop for every stadium; the videos have no audio track;
- Free Kicks mode challenge codes are not an exact replay (a new setup per kick; the Daily is exact);
- `npm run play:dev` could not be exercised here end-to-end (its mock wallet needs mainnet RPC).
