# Checks only a human can do

1. **Real-browser playtest as your hardwired Friend:**
   - open the Pages preview;
   - connect a wallet on Robinhood mainnet and select your Friend;
   - check your Friend's sprite appears as the striker;
   - buy two balls, place, shoot, redeem in the Locker;
   - try touch on a phone in landscape.
2. **GitHub settings:** Settings → Pages → Source = **GitHub Actions**.
3. **Environment network access:** allow `rpc.mainnet.chain.robinhood.com`,
   `robinhoodchain.blockscout.com` and `rarefriends.com` for the live path.
4. **Submission contact handle:** DONE: `@phon_ro` (pseudonymous, provided by the owner) in `submission/README.md` and `submission/PR.md`.
5. **Review the economy parameter choices that differ from the brief:**
   - 10% of the weekly surplus is retained while a bank grows;
   - the Skill Cup pot is capped at 250k $GBOOT per week;
   - the solvency figure is ≤ 8e-5, from the exact Lundberg bound (the brief's 1e-5 used the
     normal approximation).
6. **Legal review** of token-priced random rewards before any live promotion.
7. **Before announcing Wildcards:** one real mainnet Wildcard draw must fulfil. The Dice
   provider delivers off-chain, and a private fork cannot prove delivery. The callback signature
   is test-checked against the SDK's ChanceGame.
