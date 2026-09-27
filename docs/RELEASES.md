# Judged-build releases

The root preview (https://tulipoaaaaa.github.io/penalty-kings/) is the judged build. It is only redeployed after the full CI run for that exact commit is green (`.github/workflows/pages.yml` runs on `workflow_run` of CI and only deploys on `success`). If anything regresses, revert the branch to the last stable commit below and push; Pages redeploys once CI passes.

| Tag | Commit | Date (UTC) | Evidence |
|---|---|---|---|
| `judging-stable-1` | `18b4bc8` | 2026-09-27 | **Tagged** by the owner (via the frozen branch `judging-1`; neither may be moved, rebased or deleted). CI run 100 fully green, deployed to Pages at 15:27 UTC. |
| `judging-stable-2` | (at the code freeze, Sep 29 12:00 UTC) | — | Everything from `135c2db` on (CI run 102 green) plus the Bug Quest fixes and the design round. The exact sha is reported at the freeze. Earlier baseline for reference: `8a895fe`. |

**Freeze plan:**
- **Sep 29 12:00 UTC:** code freeze for the judged preview; bug fixes only after this.
- **Sep 29 16:00 UTC:** final QA and regenerated screenshots/video.
- **Sep 29 18:00 UTC:** submission text final.
- New work (onboarding app, wallets, live contracts) lives under separate paths (`/app/`, `/live/`) or behind flags, never in the root preview.
