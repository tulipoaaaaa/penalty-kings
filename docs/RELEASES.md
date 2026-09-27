# Judged-build releases

The root preview (https://tulipoaaaaa.github.io/penalty-kings/) is the judged build. It is only redeployed after the full CI run for that exact commit is green (`.github/workflows/pages.yml` runs on `workflow_run` of CI and only deploys on `success`). If anything regresses, revert the branch to the last stable commit below and push; Pages redeploys once CI passes.

| Tag | Commit | Date (UTC) | Evidence |
|---|---|---|---|
| `judging-stable-1` | `8a895fe` | 2026-09-27 | Local full run green: typecheck, `friendsdk check` + `friendsdk test` (960/360), engine 28, verifier 6, game-logic 34, Foundry 121 (non-fork), test:game / test:flow (13 scenarios incl. speed) / test:modes / qa:90s (26–27 shots). The tag exists locally; the session's git proxy refused tag pushes, so create it on GitHub (Releases → Draft a new release → tag `judging-stable-1` → target commit `8a895fe`). |

**Freeze plan:**
- **Sep 29 12:00 UTC:** code freeze for the judged preview; bug fixes only after this.
- **Sep 29 16:00 UTC:** final QA and regenerated screenshots/video.
- **Sep 29 18:00 UTC:** submission text final.
- New work (onboarding app, wallets, live contracts) lives under separate paths (`/app/`, `/live/`) or behind flags, never in the root preview.
