# Bug Quest: fix round

Four read-only review agents audited the code at `90c7e74`; their findings are the BQ items below. The BQ-X items were found by the design audits ([GREATNESS.md](GREATNESS.md)).

**Rules:**
- Re-verify on the current head first.
- Every fix gets a test that fails before the fix and passes after it.
- One bug per commit.
- CI must be green before every push.
- Nothing is deployed on-chain.

This table is updated as each fix lane merges.

| ID | Status | Commit | Test |
|---|---|---|---|
| BQ-P0-1 Pack soft-lock on Change mode | in progress (lane A1) | | |
| BQ-P1-1 Stage streak off by one | in progress (lane A2) | | |
| BQ-P1-2 Ball passes through the keeper on non-goal results | in progress (lane A2) | | |
| BQ-P1-3 The mouse's "top corners are always open" tell is false | in progress (lane A2) | | |
| BQ-P1-4 Clocks run behind the rotate overlay | in progress (lane A1) | | |
| BQ-P1-5 Results XP omits per-kick XP and mid-session level-ups | in progress (lane A1) | | |
| BQ-P1-6 Redeem the selected ball, then Kick → Ball shop | in progress (lane A1) | | |
| BQ-P1-7 $GBOOT spent without confirmation (Skill Cup, Play again, Kit shop) | in progress (lane A1) | | |
| BQ-P1-8 Public site dead end without a wallet | **fixed** | `8cc3641` | `scripts/test-landing.mjs` (390×844, no wallet: CTA 354×56 above the fold, clip playing, tap → /practice/); timed out before the fix |
| BQ-P1-9 Kick off button 73×24 px | **fixed** | `286e535` | `scripts/test-phone.mjs` "title CTA 960x640 / 1280x800" (was 73×24, now 104×44) |
| BQ-P1-10 Tap targets under 44 px | **fixed** (Results/hub/Settings/Ball shop already ≥44; now covered) | `f38bb67` | `scripts/test-phone.mjs` + `scripts/test-practice.mjs` tap-target checks at 44 px (were: Skip intro 91×40, practice links 17 px, stadium bar 14 px) |
| BQ-P1-11 Pot banner covers the commentary line | **fixed** | `d3754e0` | `scripts/test-game.mjs` "BQ-P1-11" overlap assertion (360/960/1280 px); it failed before the fix (banner bottom 75 px vs strip top 53 px at 960) |
| BQ-P1-12 Bootroom lock-hijack (three PoCs) | **fixed** | `82d45a7` | `contracts/test/BootroomHijackPoC.t.sol` (all three PoCs succeeded before and revert after) + 3 fuzz tests; forge 169 → 184 passing |


**Already fixed before this round** (the owner's sync note, confirmed on the head):

| Item | Commit |
|---|---|
| Bar-in / "OFF THE BAR!" label (y band) | `a51e5ae`, `13d7ea6` |
| Clubhouse gated off the public site | `23161f5` |
| Pot banner freshness tag | `bd55d5c` |
| Stuck celebration | `135c2db` |
| Wildcard note | `63da5d5` |

The P2 list and the goal-rate table per keeper and rung are added as they land.
