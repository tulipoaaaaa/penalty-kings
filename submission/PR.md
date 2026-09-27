# Pull request for spokesz/rarefriends-vibeathon

**Title:** Add Penalty Kings submission

**Body (paste as-is):**

Adds `submissions/penalty-kings/README.md`.

- **Project:** Penalty Kings
- **Builder / contact:** tulipo · @phon_ro
- **Category:** Economy Potential (also Character Spotlight, Token Activity)
- **One sentence:** Your hardwired Rare Friend is the striker in a skill-based pixel-art
  shootout. The optional Big Match sells packs of balls for RF whose rarity comes from on-chain
  randomness: every ball is RF-backed and redeemable, and drops $GBOOT, a fixed-supply game
  token designed to pair with RF.
- **Source:** https://github.com/tulipoaaaaa/penalty-kings (FriendSDK v0.1.2)
- **Playable preview (simulated economy):** https://tulipoaaaaa.github.io/penalty-kings/
- **Requirements:** a browser wallet on Robinhood mainnet (4663) holding a hardwired
  Generations NFT (generation ≥ 1). The real SDK ownership gate is kept.
- **How to play:**
  - Swipe up from the ball to shoot (keyboard: arrows, A/D curl, Space).
  - Free modes: tutorial, Penalties vs 12 keepers, Free Kicks, Target Practice, World Tour
    (30 levels) and a Daily Challenge.
  - Big Match: buy a pack → open (SDK play + settle) → reveal → Bag → choose a ball → kick →
    redeem for RF at any time.
- **Economy:**
  - Balls cost 10 / 1,000 / 10,000 RF with identical odds and a 90.00% RTP.
  - Rewards are 0–10× the ball price, and the top prize is reserved per ball.
  - $GBOOT v2: 100M fixed supply in an RF-paired pool; the edge is split 40% RF burn / 30%
    $GBOOT buy-back and burn / 30% Cup; drops ≤ 3% of the ball price (≤ 93% total).
  - Designed and Foundry-tested; not deployed.
  - Full design: [docs/ECONOMY.md](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/ECONOMY.md)
- **What is live:** only the builder burner's Friend #336583 hardwire,
  [tx 0xd6a6a8b9…c78d0](https://robinhoodchain.blockscout.com/tx/0xd6a6a8b911e7a7eba8b5e5771a4ad17ed3fe3af785a1b7e16e0640e86acc78d0).
  Everything economic in the preview is simulated and labelled. The roadmap is in the README.
- **Checks** (all run in GitHub Actions):
  - typecheck, `friendsdk check` and the SDK harness at 960 and 360 px;
  - engine (28), game-logic (34) and referee tests;
  - browser flow, modes, a 13-scenario action-flow audit and 90-second QA;
  - odds verification and the economy simulator;
  - Foundry: 121 unit/fuzz tests plus mainnet-fork tests;
  - a real mainnet ownership gate and a secret scan.
- **Known issues:**
  - Preview progress resets on reload (the SDK sandbox has no storage; a save API would help).
  - The preview wallet holds 20 simulated RF.
  - A human real-wallet playtest is recommended.
  - Paid chance needs legal review before any live promotion.
- **Credits:** original code-drawn art and synthesised audio; the Friend's canonical Generations
  sprite is unaltered; UI sounds come from the FriendSDK sound kit. UX shaped by founder feedback.
