# Judged-build releases

The root preview (https://tulipoaaaaa.github.io/penalty-kings/) is the judged build. It is only redeployed after the full CI run for that exact commit is green (`.github/workflows/pages.yml` runs on `workflow_run` of CI and only deploys on `success`). If anything regresses, revert the branch to the last stable commit below and push; Pages redeploys once CI passes.

| Tag | Commit | Date (UTC) | Evidence |
|---|---|---|---|
| `judging-stable-1` | `18b4bc8` | 2026-09-27 15:26 UTC | **GitHub CI run 100 fully green** (all jobs), deployed to Pages. Includes the freeze fix, free practice `/practice/`, phone layouts, the 0–15 s randomness waits, next goal, odds on every pack, Skill Zones, the daily check-in. The session's git proxy refuses tag pushes (`send-pack: unexpected disconnect`; branch pushes work), so create it on GitHub: Releases → Draft a new release → tag `judging-stable-1` → target `18b4bc8`. |
| (previous baseline) | `8a895fe` | 2026-09-27 | The earlier judged baseline (local full run green; CI's real-gate step was then failing on a stale assertion, fixed in `74d7fad`). Revert target of last resort. |

**Freeze plan:**
- **Sep 29 12:00 UTC:** code freeze for the judged preview; bug fixes only after this.
- **Sep 29 16:00 UTC:** final QA and regenerated screenshots/video.
- **Sep 29 18:00 UTC:** submission text final.
- New work (onboarding app, wallets, live contracts) lives under separate paths (`/app/`, `/live/`) or behind flags, never in the root preview.
