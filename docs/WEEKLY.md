# Weekly reports

Each week gets a report that anyone can re-run. The numbers come from on-chain reads only:

```sh
node scripts/cup/weekly.mjs --from <block> --to <block> --twap <RF per $GBOOT> --pot-rf <Cup RF>
node scripts/cup/weekly.mjs --plan --week <n> --edge-rf <RF>    # offline: the vault budget and the split only
```

**The script is a dry run.** It only reads. It holds no key, creates no wallet client and has no
`--send` flag. The payments it plans are separate, rehearsed transactions, each logged in
[TX-LOG.md](TX-LOG.md): `EmissionVault.release`, `EdgeSplitter.split` and the Cup payouts.

## What each weekly report contains (tokenomics v2)

1. **The drop base.** `min(schedule, 2% × ball price ÷ TWAP ÷ 2.15)` per stadium. The schedule
   is 0.93 / 93 / 930 $GBOOT (Park / Pro / Champions). The base is published in
   [DROPS.md](DROPS.md) before the drops are paid.
2. **Bootroom boosts.** `Bootroom.boostBps(friendId)` is read at the report's end block for
   every Friend that played:
   - Golden Boot race points are multiplied by the boost (×1 to ×2);
   - drops are multiplied by `1 + (boost − 1) ÷ 2` (×1 to ×1.5).
3. **The drop vault's halving budget.** The budget is `capOf(week) − released[week]`, where
   `capOf(week) = 2,500,000 >> ⌊week ÷ 4⌋`. The script checks that the on-chain `capOf` matches
   this schedule. If the boosted drops add up to more than the budget, every Friend's drops are
   scaled down by the same factor.
4. **The edge split.** This is `EdgeSplitter.split` on the week's swept edge:
   - 40% of the RF is burned;
   - 30% buys $GBOOT, which is burned (`minGbootOut` = a fresh quote − 3%);
   - 30% goes to the Golden Boot Cup.

   The integer rounding is the contract's own: the Cup gets the remainder.
5. **Cup results.** The top 10 of the race by boosted points, paid 25 / 18 / 13 / 10 / 8 / 7 /
   6 / 5 / 4 / 4 %. This part also covers the Skill Cup results and the week secret's hash and
   reveal.
6. **Vault releases and burns.** The drop, Cups and bounty vault releases, the LP fees burned by
   `LiquidityLock.collectAndBurn` and the balance of every vault. Every line links a transaction.

The script also writes `weekly-<from>-<to>.json`. It holds the drops per Friend (paid to the
Friend's token-bound account), each Friend's boost, the Cup table, the vault budget and the
split plan.

No live week has started yet. The v2 contracts are not deployed.
