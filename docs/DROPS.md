# Weekly $GBOOT ball-drop rates

Every settled ball drops **base × rarity multiplier** $GBOOT. The multipliers are ×1, ×1.5, ×2,
×3, ×5, ×8 and ×15, averaging ×2.15.

Each week's base per stadium is fixed **before** that week's drops are paid:

> base = min(launch schedule, 3% × ball price ÷ TWAP ÷ 2.15, weekly treasury budget)

- TWAP is the $GBOOT/RF time-weighted price over the previous week.
- The weekly treasury budget is 1/52 of the 300M treasury. If it binds, the base is scaled
  down equally for everyone.

Payment comes from the disclosed treasury (the burner wallet). Amounts are computed purely from
on-chain `Settled` events per Friend by `scripts/cup/weekly.mjs`, and anyone can re-run it.

| Week | TWAP (RF / $GBOOT) | Park base | Pro base | Champions base | Treasury cap binding? | Distribution tx |
|---|---:|---:|---:|---:|---|---|
| launch schedule | 0.01 (start price) | 13 | 1,395 | 13,953 | — | — |

The preview game uses the launch schedule and labels every drop as simulated.
