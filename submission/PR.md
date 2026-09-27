# Pull request for spokesz/rarefriends-vibeathon

**Title:** Add Penalty Kings submission

**Body (paste as-is):**

Adds `submissions/penalty-kings/README.md`.

- **Project:** Penalty Kings
- **Builder / contact:** tulipo · [PSEUDONYMOUS HANDLE]
- **Category:** Economy Potential (also Character Spotlight, Token Activity)
- **One sentence:** Your hardwired Rare Friend is the striker in a pixel-art penalty shootout.
  Every ball costs $RAREFRIENDS and carries an on-chain-random rarity, which sets its RF
  redemption value and its drop of $GBOOT, a fixed-supply game token paired with RF.
- **Source:** https://github.com/tulipoaaaaa/penalty-kings (FriendSDK v0.1.2)
- **Playable preview (simulated economy):** https://tulipoaaaaa.github.io/penalty-kings/
- **Requirements:** a browser wallet on Robinhood mainnet (4663) holding a hardwired
  Generations NFT (generation ≥ 1). The real SDK ownership gate is kept.
- **Economy:**
  - Balls cost 10 / 1,000 / 10,000 RF in three stadiums, with identical odds and a 90.00% RTP.
  - Rewards are 0–10× the ball price, and every ball reserves the top prize.
  - $GBOOT (1B fixed supply) trades in a $GBOOT/RF pool, so buyers must route through RF.
  - Half of each stadium's surplus is burned as RF; half funds a weekly Golden Boot Cup.
- **Full design:** [docs/ECONOMY.md](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/ECONOMY.md)
- **Live contracts:** optional and labelled. See
  [docs/DEPLOYMENT.md](https://github.com/tulipoaaaaa/penalty-kings/blob/HEAD/docs/DEPLOYMENT.md);
  anything not listed there with a verified transaction is not live.
- **Checks:** typecheck, `friendsdk check`, the SDK browser harness at 960 px and 360 px, an
  interaction test (buy → place → reveal → shoot → HUD), a real mainnet ownership-gate test
  (read-only), odds verification, the economy simulator, Foundry unit and mainnet-fork tests,
  Skill Cup referee tests and a secret scan. All run in GitHub Actions.
- **Known issues:**
  - The preview wallet holds 20 simulated RF (the SDK default), so the Pro and Champions pages
    are reference builds.
  - A real-wallet playtest by a human is still recommended.
