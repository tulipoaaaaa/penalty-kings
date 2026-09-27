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
2. **Bootroom perk tiers (progression only).** `Bootroom.perkTier(friendId)` (0–3) is read at the
   report's end block for every Friend that played and published with its XP bonus and next
   week's Cup seeding (tier first, then friendId). **It is never applied to a payout:** drops and
   race points are the same for every Friend, and paid ties still go to the lower friendId
   (round 6: lacing no longer multiplies race points ×2 or drops ×1.5).
3. **The drop vault's halving budget.** The budget is `capOf(week) − released[week]`, where
   `capOf(week) = 2,500,000 >> ⌊week ÷ 4⌋`. The script checks that the on-chain `capOf` matches
   this schedule. If the drops add up to more than the budget, every Friend's drops are scaled
   down by the same factor.
4. **The edge split.** This is `EdgeSplitter.split` on the week's swept edge:
   - 40% of the RF is burned;
   - 30% buys $GBOOT, which is burned (`minGbootOut` = a fresh quote − 3%);
   - 30% goes to the Golden Boot Cup.

   The integer rounding is the contract's own: the Cup gets the remainder.
5. **Cup results.** The top 10 of the race by points, paid 25 / 18 / 13 / 10 / 8 / 7 / 6 / 5 /
   4 / 4 %. This part also covers the Skill Cup results and the week secret's hash and reveal.
6. **Rewards.** When `RewardsDistributor` is in `deployments/live.json` (`rewards`): the season,
   its halving ceiling, the previous season's sink burns (`sinkBurned`), the budget
   (`setSeasonBudget` is permissionless and on-chain only) and what was paid. Every claim is a
   `Claimed` event of a referee-signed, capped claim for a paid Skill Cup entry.
7. **Vault releases and burns.** The drop and Cups vault releases, the rewards claims, the sink
   burns per week (`burnedInWeek` of KitShop, SkillCup and Wildcards), the `LiquidityLock.collect` fee splits (burned / to the pot) and the
   balance of every vault. Every line links a transaction.

The script also writes `weekly-<from>-<to>.json`. It holds the drops per Friend (paid to the
Friend's token-bound account), each Friend's perk tier and XP bonus, the Cup seeding, the Cup
table, the vault budget, the rewards budget and the split plan.

No live week has started yet. The v2 contracts are not deployed.
