# Pull request for spokesz/rarefriends-vibeathon

**Title:** Add Penalty Kings submission

**Body (paste as-is):**

Adds `submissions/penalty-kings/README.md`.

- **Project:** Penalty Kings
- **Builder / contact:** tulipo · @phon_ro
- **Category:** Economy Potential (also Character Spotlight, Token Activity)
- **One sentence:** Your hardwired Rare Friend is the striker in a skill-based pixel-art
  shootout. The optional Big Match sells packs of balls for RF whose rarity comes from on-chain
  randomness, and every ball is RF-backed and redeemable.
- **Pilot:** Rare Friends forks the repo and adapts it to FriendSDK v0.2.1, and deploys its own
  contracts for the two random rolls:
  - pack buy: the rarity of each ball;
  - penalty: the shot is committed first, then the beacon seeds only the keeper's dive.

  The pilot ships without $GBOOT. This repo deploys nothing.
- **Links:**
  - Playable preview (simulated economy): https://tulipoaaaaa.github.io/penalty-kings/
  - Free practice, no wallet: https://tulipoaaaaa.github.io/penalty-kings/practice/ (a few kicks
    against the keepers, then "Get your Friend to play for real")
  - Judge-path video (under 60 s, first kick within 10 s): https://github.com/tulipoaaaaa/penalty-kings/blob/claude/clever-mccarthy-ay7qv7/docs/media/judge-path.webm
    (showreel → tutorial → Modes with the next goal → Free Kicks → buy/open a pack → Big Match kick)
  - Money shot (15 s): https://github.com/tulipoaaaaa/penalty-kings/blob/claude/clever-mccarthy-ay7qv7/docs/media/money-shot.gif
  - Source (FriendSDK v0.1.2): https://github.com/tulipoaaaaa/penalty-kings/tree/claude/clever-mccarthy-ay7qv7
  - Judged build: https://github.com/tulipoaaaaa/penalty-kings/tree/judging-stable-2 (tag created at the freeze)
- **Requirements:** a browser wallet on Robinhood mainnet (4663) holding a hardwired
  Generations NFT (generation ≥ 1). The real SDK ownership gate is kept.
- **Built for a ~15 s random beacon:**
  - packs: a sealed pack that builds while you wait, then a lowest-to-highest reveal;
  - penalties: the ball warms up, the keeper plays mind games, the crowd drumrolls.

  It works just as well with instant randomness (release → result ≤ 1.2 s).
- **Modes:**
  - Free (skill only, no RF): tutorial, Penalties vs a ladder of 12 keepers, Free Kicks, Target
    Practice (60 s), World Tour (30 levels, 3 stars each) and a Daily Challenge.
  - Big Match (optional, RF): buy a pack → open (SDK play + settle) → reveal → Bag → choose a
    ball → kick → redeem for RF at any time.
  - Swipe up from the ball to shoot (keyboard: arrows, A/D curl, Space).
- **Features:**
  - Ball shop with a display case of every ball and its exact odds; packs of 1/2/5/10; the Bag;
    Cups (the Golden Boot Cup pot, draw countdown, winners ticker) and Champions Night
    (Saturday 19:00–21:00 UTC); a Kit shop (cosmetics only); the Scouting Book sticker album.
  - Share cards and challenge codes (a friend replays your exact kicks against the same keeper).
  - Keeper of the Week (double XP), a Daily streak ("Day N" check-in, a cosmetic on day 7), and a
    NEXT GOAL line that always points at a free unlock. Progression is XP and cosmetics only.
  - The free practice page, and a no-wallet landing with a big practice button.
  - Game feel, sound and atmosphere: hit-stop and net bulge on goals, post clangs and close-call
    slow motion, streak fever at 3/5/10, a synthesised crowd that hushes and roars, weather and
    floodlights, and a Match Director with 275 commentary lines. Everything has a reduced-motion
    equivalent.
- **Economy:**
  - Balls cost 10 / 1,000 / 10,000 RF, with identical odds and a 90.00% RTP (asserted in CI). The exact
    odds are printed on every pack.
  - Rewards are 0–10× the ball price; the top prize is reserved per ball.
  - $GBOOT (100M fixed supply, RF-paired) is a tested, **undeployed** upgrade package, approved as
    a design only. See [docs/GBOOT-UPGRADE.md](https://github.com/tulipoaaaaa/penalty-kings/blob/claude/clever-mccarthy-ay7qv7/docs/GBOOT-UPGRADE.md).
- **What is live, what is simulated:**
  - Live: only the builder burner's Friend #336583 hardwire,
    [tx 0xd6a6a8b9…c78d0](https://robinhoodchain.blockscout.com/tx/0xd6a6a8b911e7a7eba8b5e5771a4ad17ed3fe3af785a1b7e16e0640e86acc78d0).
    Nothing else is deployed.
  - Real but not a deployment: the SDK wallet connection and ownership gate, and the RF/USD price
    (a labelled on-chain snapshot in the preview).
  - **SIMULATED** and labelled in the preview: the 20 RF balance, packs, reveals, the Bag,
    redemptions, $GBOOT drops, Cup pots, winners, race tables, rivals and Champions Night's
    doubled race points. The roadmap is in the README.
- **Checks** (all run in GitHub Actions):
  - typecheck, `friendsdk check`, the secret scan, and a site build with no dev-only code;
  - game-logic (206), engine (54), Match Director (27), Skill Cup referee (15) and weekly Cup (9) tests;
  - browser suites: the SDK harness at 960 and 360 px, the buy → redeem flow, every mode, Skill
    Zones, an action-flow audit (including 2 s and 5 s randomness waits), phone
    layouts at 360×800 / 390×844 / 800×360 / 844×390, the free practice page and no-wallet
    landing, a 90-second QA with reduced motion on and off, and an overflow sweep (4 viewports × 2 fonts);
  - odds verification, the difficulty simulation and the economy simulator;
  - Foundry: 206 unit/fuzz/invariant tests offline, plus mainnet-fork tests and a fork rehearsal;
  - a real mainnet ownership gate.
- **Known issues:**
  - The SDK v0.1.2 sandbox has no storage, so the preview uses save codes; SDK v0.2.1 brings a backend.
  - The preview wallet holds 20 simulated RF.
  - A human real-wallet playtest is recommended.
  - Paid chance needs legal review before any live promotion.
- **Credits:** original code-drawn art and synthesised audio; the Friend's canonical Generations
  sprite is unaltered; UI sounds come from the FriendSDK sound kit. UX shaped by founder feedback.
