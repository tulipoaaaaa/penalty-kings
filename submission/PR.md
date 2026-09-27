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
- **Pilot:** being adapted by Rare Friends to FriendSDK v0.2.1. Rare Friends deploys its own
  contracts for the two random rolls:
  - pack buy: the rarity of each ball;
  - penalty: the shot is committed first, then the beacon seeds only the keeper's dive.

  The pilot ships without $GBOOT.
- **Source:** https://github.com/tulipoaaaaa/penalty-kings (FriendSDK v0.1.2)
- **Playable preview (simulated economy):** https://tulipoaaaaa.github.io/penalty-kings/
- **Requirements:** a browser wallet on Robinhood mainnet (4663) holding a hardwired
  Generations NFT (generation ≥ 1). The real SDK ownership gate is kept.
- **Free practice, no wallet:** https://tulipoaaaaa.github.io/penalty-kings/practice/ (a few kicks
  against the keepers, then "Get your Friend to play for real").
- **Built for a ~15 s random beacon:**
  - packs: a sealed pack that builds while you wait, then a lowest-to-highest reveal;
  - penalties: the ball warms up, the keeper plays mind games, the crowd drumrolls.

  It works just as well with instant randomness (release → result ≤ 1.2 s).
- **How to play:**
  - Swipe up from the ball to shoot (keyboard: arrows, A/D curl, Space).
  - Free modes: tutorial, Penalties vs 12 keepers, Free Kicks, Target Practice, World Tour
    (30 levels) and a Daily Challenge.
  - Big Match: buy a pack → open (SDK play + settle) → reveal → Bag → choose a ball → kick →
    redeem for RF at any time.
- **Economy:**
  - Balls cost 10 / 1,000 / 10,000 RF, with identical odds and a 90.00% RTP (asserted in CI).
  - Rewards are 0–10× the ball price; the top prize is reserved per ball.
  - $GBOOT (100M fixed supply, RF-paired) is a tested, **undeployed** upgrade package, approved as
    a design only. See [docs/GBOOT-UPGRADE.md](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/GBOOT-UPGRADE.md).
- **What is live:** only the builder burner's Friend #336583 hardwire,
  [tx 0xd6a6a8b9…c78d0](https://robinhoodchain.blockscout.com/tx/0xd6a6a8b911e7a7eba8b5e5771a4ad17ed3fe3af785a1b7e16e0640e86acc78d0).
  Nothing else is deployed. Everything economic in the preview is simulated and labelled. The roadmap is in the README.
- **Checks** (all run in GitHub Actions):
  - typecheck, `friendsdk check` and the SDK harness at 960 and 360 px;
  - engine (28), game-logic (34) and referee tests;
  - browser flow, modes, a 13-scenario action-flow audit and 90-second QA;
  - odds verification and the economy simulator;
  - Foundry: 169 unit/fuzz/invariant tests plus mainnet-fork tests;
  - a real mainnet ownership gate and a secret scan.
- **Known issues:**
  - The SDK v0.1.2 sandbox has no storage, so the preview uses save codes; SDK v0.2.1 brings a backend.
  - The preview wallet holds 20 simulated RF.
  - A human real-wallet playtest is recommended.
  - Paid chance needs legal review before any live promotion.
- **Credits:** original code-drawn art and synthesised audio; the Friend's canonical Generations
  sprite is unaltered; UI sounds come from the FriendSDK sound kit. UX shaped by founder feedback.
