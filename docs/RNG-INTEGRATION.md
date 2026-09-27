# RNG integration: the two random rolls (for the Rare Friends SDK v0.2.1 fork)

The founder's SDK v0.2.1 publishes a **public random beacon about every 15 s**. Penalty Kings uses randomness in exactly **two** places:

| Roll | When | What randomness decides | What it never decides |
|---|---|---|---|
| **1. Pack** | Buying and opening a pack | The **rarity of each ball**, and so its fixed RF value | Anything about skill, aim or score |
| **2. Penalty** | After the player has shot | Only the **keeper's dive** (side, timing, trailing leg) | The shot itself: aim, height, power and curl are the player's |

The engine is **deterministic**: `outcome = f(shot input, keeper, seed, context, difficulty)`. Skill fixes the input; randomness supplies only the seed; anyone can recompute the result.

The game-side contract is [`games/penalty-kings/game/randomness.ts`](../games/penalty-kings/game/randomness.ts), tested in `tests/game/randomness.test.ts`, including simulated 0 / 5 / 15 s beacon delays.

---

## Roll 1: pack (rarity per ball)

**Today (v0.1.2):**
- `client.buy(n)`, then `client.play(n)`, then `client.settle(playId)`. The SDK ChanceGame draws each ball's outcome with Dice entropy.
- The game only **animates** the settled outcome: `revealPlan(outcomeId)` in `game/reveal.ts`, the "ethics rule". The reveal can't show anything but the settled result.

**With the beacon:**
- The founder's contract settles each ball from the beacon: `draw_i = H(beacon.value ‖ packCommitment ‖ i)`, mapped through the fixed weights.
- `packDraws(beacon, commitment, count)` shows the reference derivation (SHA-256, the first 4 bytes as a uint32, divided by 2³²).
- **Commitment:** the purchase transaction (buyer, Friend, quantity and a nonce) must be mined **before** the beacon round that settles it. Use "the first beacon round after the purchase block".

| | Data |
|---|---|
| **Weights (bps)** | Scuffed 3150 · Training 2700 · Match 2000 · Pro 1100 · Silver 700 · Gold 250 · Golden Boot 100. These are in `games/penalty-kings/game.json` and asserted by `npm run verify:odds`: they sum to 10,000, with an expected return of exactly 90.00%. |
| **Outcome ids** | 1…7 (Scuffed … Golden Boot). The RF value is `definition.outcomes[id-1].reward`, fixed per stadium in `tiers/*.json`. |
| **On-chain** | Purchase, beacon round → outcome per ball, the inventory (friend-bound ERC-1155) and redemption. |
| **Client** | Animation only. `PackOpening` in `ballui.tsx` shows the sealed pack, the wait, and a reveal sequence from lowest to highest (see "The 0–15 s wait" below). |

## Roll 2: penalty (commit the shot, then the beacon seeds the keeper)

**The flow for one kick:**

1. The player swipes. The engine maps the swipe to a `ShotInput` (`swipeToShot`, in `packages/engine/src/index.ts`) with these ranges:
   - `aimX` ∈ [-1.6, 1.6] (goal units, posts at ±1)
   - `aimY` ∈ [0, 1.6] (bar at 1)
   - `power` ∈ [0, 1]
   - `curl` ∈ [-1, 1]
2. **Commit.** `commitment = SHA-256(friendId | sessionId | kickIndex | canonicalShot(shot))`, via `commitShot` in `game/randomness.ts`.
   - `canonicalShot` gives fixed key order and 4-decimal rounding, so the client and the referee hash identical bytes.
   - The commitment is fixed **before** the beacon round that will seed it is published.
3. **Beacon.** Take the first beacon round published after the commitment: `RandomnessSource.next("penalty", commitment)`.
4. **Seed.** `seed = uint32(SHA-256(beacon.value | commitment)[0..4])`, via `keeperSeed`.
5. **Resolve.** Call `resolveShot(shot, keeperById(keeper), seed, { kickIndex, history }, difficulty)`. It returns `{ result, target, plan, zone, postIn }`.
   - `history` holds the previous kicks' `target.x`.
   - Paid and ranked play uses `NEUTRAL` difficulty.
   - A save happens only if the keeper rig **touches** the ball at the crossing. That rig is `packages/engine/src/keeper-rig.ts`, and it's what the Stage draws.
6. **Score.** `goalPoints(keeper, ballMult, streak, suddenDeath, zone, postIn)`. A ball's `ballMult` is a skill-layer multiplier only; it never changes RF.

**Data formats:**

```jsonc
// Commit record (what the referee stores first; what can be logged on-chain as a hash)
{ "friendId": "336583", "sessionId": "<uuid>", "kickIndex": 2,
  "shot": {"aimX":0.6123,"aimY":0.4,"power":0.7,"curl":-0.1},  // canonical, 4 dp
  "commitment": "0x…32 bytes…" }
// Beacon (SDK v0.2.1)
{ "round": 123456, "value": "0x…32 bytes…" }
// Result (signed by the referee)
{ "commitment": "0x…", "round": 123456, "seed": 305419896, "result": "save", "zone": "corner", "points": 0 }
```

**What goes where:**

| On-chain (minimum) | Client / referee |
|---|---|
| Commitment hash, or a batch Merkle root, plus the beacon round it binds to. Needed only where money depends on the kick (a paid contest or a reward claim). | Swipe capture, the engine (pure TypeScript), rendering, commentary. |
| Signed results feed reward claims (`RewardsDistributor`, part of the undeployed $GBOOT upgrade). | The referee stores inputs **before** the beacon is known, then resolves. |

Free play and the Big Match penalty never pay RF for goals: RF comes only from ball redemption. So in the pilot, roll 2 can run fully client-side with the beacon for fairness and fun. Server verification matters only when a kick decides a prize.

**How the referee verifies** (`verifier/src/core.ts`, already built for the Skill Cup):
- Today the dive seed is `HMAC-SHA256(weekSecret, entryId ‖ kickIndex)`, with the secret revealed at week end.
- With the beacon, replace `diveSeed()` with `keeperSeed(beacon, commitment)`. Everything else stays: inputs are stored before the seed exists, the result is resolved with the shared engine, and the result is signed.
- `replayEntry()` re-resolves every kick from the published inputs and beacon values. Anyone can run it.
- The verifier tests (`npm run test:verifier`) cover exact replay, forged-goal rejection and rate limits.

## The 0–15 s wait (UX)

`suspenseBeats(waitMs)` in `game/randomness.ts` paces the wait:
- **< 0.8 s:** straight to the payoff. Instant randomness adds no delay; the release-to-result time stays ≤ 1.2 s, which the browser tests assert.
- **0.8–5 s:** the ball warms up, then a crowd drumroll, then the payoff.
- **5–15 s:** the ball warms up, the keeper plays mind games (taunts, sway, glove claps, a Match Director micro-moment), then a drumroll, a hush, and the payoff.

For packs: a sealed pack that shakes and glows more as the wait goes on, then a reveal from lowest to highest with a building sting before the best ball. A Golden Boot keeps its full-screen moment.

The Showroom has 0 / 5 / 15 s delay triggers for both flows. The preview's default is 0 s: it uses the SDK's own play and settle.

**How it is built** (`game/suspense.ts`, `gfx/waits.ts`, wired in `index.tsx`):
- **Pacing:** `waitCue(elapsed, expected)` drives the cue, and a wait that overruns its estimate moves up a tier on its own. Waits under 250 ms show nothing.
- **Penalty:** `rollKeeper(shot, context, source, signal)` commits, waits for the beacon and returns `{ commitment, beacon, seed }`.
  - It is used in the `penalties` and `match` modes (`BEACON_MODES`).
  - The tutorial, World Tour, Daily (the same challenge for everyone) and the Skill Cup keep the deterministic `kickSeed`.
  - A pause or session teardown aborts the wait. The kick is dropped unscored and the player aims it again.
- **Pack:** `packCommitment(playIds, { friendId })` fixes the pack's commitment. `packRevealSequence(rarities, waitedMs)` orders the reveal from lowest to highest and places the sting before the best ball.
- **Tests:** `tests/game/suspense.test.ts` covers the order commit → beacon → seed, no timer at 0 s, aborts never scoring, and the pack order. `scripts/test-flow.mjs` covers 2 s and 5 s penalty waits, a pause during a wait, and a 3 s sealed pack.

**Design decision to confirm (keeper tells):** in the beacon modes the keeper's **pre-kick tell** is hidden, because the dive doesn't exist until the shot is committed; a tell shown before that would only be a guess.
- The true tell still plays during the 0.4 s run-up once the beacon lands.
- Disco's beat tell stays, because it depends only on the kick number.
- This makes the Mime and the Robot harder to read. The alternative is to derive tells from something committed before the shot (for example the previous beacon round), which is fair but predictable.

## Entry points (for the fork)

| Purpose | File · symbol |
|---|---|
| Swipe → shot | `packages/engine/src/index.ts` · `swipeToShot`, `swipeAim`, `releasePoint` |
| Resolve a penalty | `packages/engine/src/index.ts` · `resolveShot`, `keeperPlan`, `goalPoints`, `NEUTRAL` |
| Keeper hit geometry (physics = render) | `packages/engine/src/keeper-rig.ts` |
| Free kicks (skill modes, not paid) | `packages/engine/src/freekick.ts` · `resolveFreeKick` |
| Commit / seed / pack draws / simulated beacon | `games/penalty-kings/game/randomness.ts` |
| Wait orchestration (commit → beacon → seed; pack reveal order) | `games/penalty-kings/game/suspense.ts` · `rollKeeper`, `packCommitment`, `packRevealSequence`, `waitCue` |
| Randomness source used by the shell (swap for the v0.2.1 beacon) | `games/penalty-kings/index.tsx` · `randomnessSource()` |
| Reveal driven by the settled outcome | `games/penalty-kings/game/reveal.ts` · `revealPlan` |
| Referee (store → seed → resolve → sign) | `verifier/src/core.ts` · `createReferee`, `diveSeed`, `replayEntry` |
