# Weekly $GBOOT ball-drop rates

Every settled ball drops **base × rarity multiplier × the Friend's drop boost** in $GBOOT.

- **Rarity multipliers:** ×1, ×1.5, ×2, ×3, ×5, ×8 and ×15. The average is ×2.15.
- **Drop boost:** comes from the Bootroom. It is `1 + (boostBps − 1) ÷ 2`, so it ranges from ×1
  to ×1.5.

Each week's base per stadium is fixed **before** that week's drops are paid:

> base = min(launch schedule, 2% × ball price ÷ TWAP ÷ 2.15)

- **TWAP** is the $GBOOT/RF time-weighted price over the previous week.
- **The farm limit:** at ×1 a ball's drop is worth ≤ 2% of its price, and ≤ 3% at the maximum
  boost. RF return plus drop value is therefore ≤ 93% of the ball price.
- **The week's total** is capped by the drop vault: `capOf(week) = 2,500,000 >> ⌊week ÷ 4⌋`
  $GBOOT, less anything already released that week. When the cap binds, every Friend's drops are
  scaled down by the same factor.

Drops are paid from the drop vault (`EmissionVault`), whose operator is the disclosed burner.
`scripts/cup/weekly.mjs` computes the amounts purely from on-chain `Settled` events and
`Bootroom.boostBps`, and anyone can re-run it.

| Week | TWAP (RF / $GBOOT) | Park base | Pro base | Champions base | Vault cap (capOf) | Cap binding? | Distribution tx |
|---|---:|---:|---:|---:|---:|---|---|
| launch schedule | 0.1 (nominal start) | 0.93 | 93 | 930 | 2,500,000 (weeks 0–3) | — | — |

The preview game uses the launch schedule and labels every drop as simulated.
