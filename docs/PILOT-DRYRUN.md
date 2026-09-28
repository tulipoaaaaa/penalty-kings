# Pilot dry run on a testnet (for Rare Friends to run)

**Who runs this:** Rare Friends. They deploy the pilot contracts and hold the deployer. **We run nothing
on-chain**, hold no key and deploy nothing ([DEPLOYMENT.md](DEPLOYMENT.md)). Nothing on this page has
been run on a testnet; the commands are what we would expect to pass.

**Founder decision (2026-09-27): the pilot ships WITHOUT $GBOOT.** So the pilot is RF-only: players buy
balls with RF, a random roll sets each ball's rarity, and they redeem balls for RF. The penalty roll
only decides the keeper's dive and never pays anything ([RNG-INTEGRATION.md](RNG-INTEGRATION.md)).

## 0. What is in the pilot, and what is deferred

| In the pilot | Source | Role |
|---|---|---|
| **Stadium prize banks**: Park (10 RF), Pro (1,000 RF), Champions (10,000 RF) | FriendSDK `ChanceGame` (`node_modules/@rarefriends/friendsdk/contracts/src/ChanceGame.sol`), configured by `games/penalty-kings/tiers/{park,pro,champions}.json`. Deployed and funded with the SDK's own `deployGame` / `fundDeployment` through `scripts/onchain/stadium.mjs` | Pack roll: `buy → play → randomness → settle → redeem`; friend-bound ball inventory (ERC-1155) |
| **Rare Friends' prototype contracts for the two rolls** (SDK v0.2.1 beacon, ~15 s) | Rare Friends' fork (not in this repo) | Either replaces the ChanceGame's Dice request with the beacon for the pack roll, or sits beside it. The penalty roll can stay client-side in the pilot (no money depends on a kick) |
| Existing chain contracts, reused | RF token, Rare Friends Generations (ownership, generation, token-bound account), the randomness provider | Read or called by the ChanceGame |

| Deferred (NOT in the pilot) | Why |
|---|---|
| Everything in `contracts/src/`: `GBoot`, `EmissionVault`, `Bootroom`, `FriendsAirdrop`, `KitShop`, `SkillCup`, `Wildcards`, `EdgeSplitter`, `LiquidityLock`, `PoolSwapper`, `RewardsDistributor`, `GBootFixedPrice`, `GBootFeeHook`, `GBootPriceFeed` | The $GBOOT upgrade package ([GBOOT-UPGRADE.md](GBOOT-UPGRADE.md)). Needs an audit and legal review first ([ROADMAP.md](ROADMAP.md)) |
| `contracts/script/Launch.s.sol`, `scripts/onchain/launch.mjs`, `scripts/onchain/pool-plan.mjs` | The $GBOOT launch wiring (pool, lock, vaults). Not run for the pilot |
| `BallVault.sol` | Design only, not reviewed by Rare Friends |
| Skill Cup referee (`verifier/`), `scripts/cup/new-week.mjs`, `scripts/cup/reward-signer.mjs` | Paid Skill Cup and $GBOOT rewards are not in the pilot. **Do not run the two key generators** for the pilot |

The AUDIT-PREP roles table (the `operator`, `setter`, `beneficiary`, `referee`, `airdrop` and `curator`
addresses; on branch `claude/clever-mccarthy-ay7qv7`, `docs/AUDIT-PREP.md` section 3) covers only the
deferred package. **In the pilot, none of those roles exists.** The only privileged role in a pilot
stadium is the ChanceGame's `team` (see step 4).

## 1. Prerequisites

**Held by Rare Friends, never by us, never in this repo:**
- A **testnet RPC URL**, and a **funded deployer** on that testnet (gas plus the RF for the stadium stakes).
- A **test player**: a wallet that owns a hardwired Generations Friend (generation ≥ 1) on that testnet,
  with RF in the Friend's token-bound account (TBA). Plus a loaned Friend if v0.2.1 loans are in scope.

**Tools:** Node ≥ 22, `npm ci` at the repo root (installs the vendored FriendSDK v0.1.2), Foundry
(`forge`, `cast`, `anvil`; CI pins v1.5.1 in `.github/workflows/rehearsal.yml`).

**Environment variables (names only; values stay in the operator's shell):**

| Name | Used by | Meaning |
|---|---|---|
| `ROBINHOOD_RPC_URL` | `scripts/onchain/lib.mjs`, `scripts/cup/weekly.mjs`, `forge test --fork-url` | The RPC the scripts read from and fork |
| `BURNER_PRIVATE_KEY` or `BURNER_MNEMONIC` (or the Foundry keystore `pk-burner`) | `scripts/lib/wallet.mjs` (`loadBurner`) | The deployer's signer. For a fork rehearsal use a **throwaway** mnemonic, as CI does |
| `REHEARSE_AS` | `scripts/onchain/lib.mjs` | Fork only: impersonate an address without loading any key |
| `FORK_FUND_RF`, `FORK_FUND_ETH` | `scripts/onchain/lib.mjs` (`fundFork`) | Fork only: give the rehearsal signer RF/ETH on the anvil fork |
| `SOLC` | `scripts/onchain/lib.mjs` (`forgeBuild`) | Optional: a local solc for offline builds |

**One limitation to know before starting.** Our scripts and the FriendSDK v0.1.2 deploy scripts are
**Robinhood-mainnet-only**: `scripts/onchain/lib.mjs` defines chain 4663, the SDK's
`scripts/contracts/common.mjs` hard-codes the mainnet RF, Generations, Dice Entropy and provider
addresses and refuses any other chain id, and `scripts/cup/weekly.mjs` hard-codes the mainnet
Generations address. So there are two ways to run this plan:

- **A. Mainnet fork (works today, unchanged):** an `anvil` fork of Robinhood mainnet (chain id 4663).
  Every command below runs as written. This is what `.github/workflows/rehearsal.yml` already does in CI.
- **B. A real testnet (Rare Friends' tooling):** deploy with the v0.2.1 deploy tooling and the testnet's
  own RF, Generations and randomness addresses. Our scripts would need those addresses as parameters
  (not done: `stadium.mjs`, `lib.mjs`, `weekly.mjs`); until then use `cast` for the checks, as shown.

**Never** pass `--send` to any `scripts/onchain/*.mjs` script during the dry run: with `--send` the
scripts sign and broadcast to `ROBINHOOD_RPC_URL` after the fork rehearsal. **Never** write testnet
manifests into `games/penalty-kings/deployments/`: `scripts/build-site.mjs` builds a live stadium from
any manifest there, and `scripts/cup/weekly.mjs` reads them. Use a throwaway checkout for B.

## 2. Offline gates (no chain, run first)

| Command | Pass looks like |
|---|---|
| `npm run verify:odds` | `park      price 10 RF · EV 90.00% · max prize 100 RF (10× price) · weights 10000 bps`, the same for `pro` (1000 RF, max 10000 RF) and `champions` (10000 RF, max 100000 RF), then `PASS verify-odds: all tiers exact` |
| `node scripts/economy-sim.mjs --smoke` | Ends with `PASS economy-sim smoke (tokenomics v2 constants match contracts/src)`. Its prize-bank solvency table is the part that matters for the pilot (stakes 20,000 / 200,000 / 2,000,000 RF hold 200 / 20 / 20 balls in flight; [ECONOMY.md](ECONOMY.md), "Prize-bank solvency and capacity"); the $GBOOT tables are for the deferred package |
| `npm run test:cup` | `# pass 9`, `# fail 0` (the weekly maths, used by the report in step 8) |
| `node scripts/test-game-logic.mjs` | `# fail 0` (includes `tests/game/randomness.test.ts`, `suspense.test.ts`, `platform.test.ts`: the two-roll contract, commit → beacon → seed order, pack reveal order) |
| `cd contracts && forge test --no-match-contract Fork` | All pass (201 on `app/test-shell`; 206 on `claude/clever-mccarthy-ay7qv7` after the Slither fixes). The deferred package stays green; it is **not** deployed |

## 3. Deploy and fund the three stadiums

**A (fork rehearsal, as CI does it):**

```sh
export BURNER_MNEMONIC="<a throwaway mnemonic generated for this run>"   # fork only; never a funded key
FORK_FUND_RF=40000   node scripts/onchain/stadium.mjs park 20000        # NO --send
FORK_FUND_RF=400000  node scripts/onchain/stadium.mjs pro 200000
FORK_FUND_RF=4000000 node scripts/onchain/stadium.mjs champions 2000000
```

Pass looks like, per stadium: `[stadium:<tier>] rehearsal PASSED { chainId: 4663, game: '0x…', … }` and
`[stadium:<tier>] dry run only (no --send). Planned txs: [ '<tier> ChanceGame deploy gas≈…', '… approval gas≈…', '… fund gas≈…' ]`.
The script itself throws `FREEZE: <tier> game state mismatch` unless `price`, `maxPrize` and
`freeStake` match the tier file and the stake. The recorded Park rehearsal used deploy 4,405,603 gas,
approve 46,390 and fund 210,340 ([DEPLOYMENT.md](DEPLOYMENT.md), "Rehearsals"). The stake must cover
the top prize (the script refuses otherwise), and `canBuy` needs `freeStake ≥ maxPrize`.

**B (testnet):** deploy one `ChanceGame` per tier with constructor
`(rf, generations, entropy, provider, "<tier name>", "Ball", price, outcomes)` taken from
`tiers/<tier>.json` (or the founder's equivalent contract with the same terms), then `approve` and `fund(stake)`.
Stakes can be smaller than mainnet on a testnet but must be ≥ the top prize (100 / 10,000 / 100,000 RF).

## 4. Verify addresses, terms and roles (per stadium)

With `$RPC` the testnet (or fork) RPC and `$GAME` the stadium address:

| Check | Command | Pass |
|---|---|---|
| RF wired | `cast call $GAME "rf()(address)" --rpc-url $RPC` | The network's RF token |
| Generations wired | `cast call $GAME "generations()(address)"` and `cast call <generations> "token()(address)"` | Generations as expected, and its `token()` is the same RF (the constructor enforces it) |
| Randomness wired | `cast call $GAME "entropy()(address)"`, `"provider()(address)"` | The randomness contract and provider Rare Friends intends (for v0.2.1: the beacon contract) |
| Terms | `"price()(uint256)"`, `"maxPrize()(uint256)"`, `"outcomeCount()(uint256)"`, `"outcomes(uint256)(uint16,uint256,string)"` for ids 1…7 | Park: price `10e18`, maxPrize `100e18`; Pro ×100; Champions ×1,000. `outcomeCount` = 7. Chances 3150 / 2700 / 2000 / 1100 / 700 / 250 / 100 bps; rewards 0 / 0.5 / 1 / 1.5 / 2.5 / 5 / 10 × price, exactly as in `tiers/<tier>.json` |
| Bank | `"freeStake()(uint256)"`, `"reservedPlays()(uint256)"`, `"rewardLiability()(uint256)"` | `freeStake` = the stake; both others 0 |
| Roles | `"team()(address)"` | The deployer. `team` can only `withdrawSurplus(recipient, amount)` up to `freeStake()`; it cannot change the terms, the odds, the randomness source or anyone's balls. Nothing else is privileged |
| Ball token | `"consumable()(address)"` | A contract (the prepaid "Ball" units) |
| No $GBOOT | the deployment record | No address from the deferred list in section 0 is deployed or referenced |

For Rare Friends' own roll contracts: list every privileged address and what it can and cannot do, in
the same shape as the table above, before the pilot opens.

## 5. Pack purchase → randomness → settle

From the test player (the Friend's owner, acting through its TBA, or the TBA itself). `$FRIEND` is the
Friend id, `$TBA` its token-bound account (`cast call <generations> "tokenBoundAccount(uint256)(address)" $FRIEND`).

1. **Approve and buy** (from the TBA): `approve($GAME, n × price)` on RF, then `buy($FRIEND, n)`.
   Pass: a `Purchased(friendId, quantity, payment)` event with `payment = n × price`; the TBA's
   `consumable` balance +n; `reservedPlays` + n × maxPrize. A buy from any other address reverts
   `NotFriendWallet`; a buy the bank cannot cover reverts `InsufficientStake` (the game checks `canBuy` first).
2. **Play:** `play($FRIEND, n)`. Pass: n `Played(playId, friendId, batchId)` events sharing one `batchId`
   (the first play id); the consumable balance −n; `pendingPlays` + n.
3. **Randomness.** Today (v0.1.2 Dice): anyone calls `requestRandomness(batchId)` with exactly
   `getFeeV2(provider, 200000)` in value; pass: `RandomnessRequested`, then `RandomnessFulfilled` from the
   provider; `randomness(batchId)` shows `requested = true, fulfilled = true`. A second request reverts
   `RandomnessAlreadyRequested`. **With the v0.2.1 beacon:** the purchase must be mined **before** the
   beacon round that settles it ("the first beacon round after the purchase block",
   [RNG-INTEGRATION.md](RNG-INTEGRATION.md), Roll 1). Pass: the round used is strictly later than the
   purchase block, for every batch.
   *On a mainnet fork (A)* the real provider never calls back into a local fork. Start `anvil` with
   `--auto-impersonate` and deliver the callback yourself from the entropy address
   (`_entropyCallback(sequenceNumber, provider, word)`); that proves the plumbing, not the randomness.
   The test player on a fork is likewise an impersonated real Friend owner, as
   `scripts/test-clubhouse-e2e.mjs` does with the SDK fixture Friend #7730.
4. **Settle:** anyone calls `settle(playId)` for each play. Pass: `Settled(playId, friendId, outcomeId)`
   with `outcomeId` in 1…7; ERC-1155 id `outcomeId` +1 in the TBA; `reservedPlays` − maxPrize and
   `rewardLiability` + that outcome's reward, per play; `pendingPlays` back to 0. Settling before the
   randomness lands reverts `RandomnessPending`; settling twice reverts `InvalidPlay`.
5. **Recompute:** v0.1.2: `roll = keccak256(abi.encode(word, game, chainid, batchId, playId)) % 10000`
   and `outcomeForRoll(roll)` equals the settled outcome. Beacon: the founder's derivation (reference:
   `packDraws` in `games/penalty-kings/game/randomness.ts`, `draw_i = H(beacon ‖ commitment ‖ i)`)
   reproduces every settled outcome from the public beacon value.
6. **Game side:** the reveal shows exactly the settled outcomes, lowest to highest (`revealPlan`,
   `packRevealSequence`), and the wait UI copes with 0–15 s (`npm run test:flow` covers 2 s / 5 s waits).

**Distribution (optional, larger sample):** over ≥ 1,000 Park balls, the share of each outcome
should sit near 31.5 / 27 / 20 / 11 / 7 / 2.5 / 1% (Scuffed is 31.5% ± about 1.5 points at 1,000 balls).
The exact odds are already fixed by the on-chain table (step 4) and `verify:odds`; this is a sanity look.

## 6. Redeem

From the Friend's owner or TBA: `redeem($FRIEND, outcomeId, quantity)`.

Pass: `Redeemed(friendId, outcomeId, quantity, payment)` with `payment = reward × quantity`; the TBA's RF
+payment; the ERC-1155 balance −quantity; `rewardLiability` −payment. Redeeming a Scuffed Ball
(reward 0) reverts `InvalidOutcome`; redeeming from any other address reverts `NotFriendController`;
transferring a ball to another wallet reverts `FriendBoundInventory` (balls are friend-bound).

## 7. The edge (the "fee split" in the pilot)

With no $GBOOT there is **no on-chain fee split in the pilot**: `EdgeSplitter` (40% RF burned / 30%
buy-and-burn / 30% Cup) and `LiquidityLock` (LP fees 50% burned / 50% pot) are deferred. The 10% edge
stays in each stadium as free stake. What to verify is exact accounting:

- Record `freeStake()` before a batch; after N balls are settled and redeemed,
  `freeStake_after − freeStake_before = N × price − Σ rewards paid` (exactly, in wei).
- `rf.balanceOf($GAME) = freeStake() + reservedPlays() + rewardLiability()` at every step (by definition;
  a failing `freeStake()` call would mean the bank is under-funded).
- `withdrawSurplus` from any address but `team` reverts `OnlyTeam`; above `freeStake()` it reverts
  `InsufficientStake`.

Where the pilot's edge goes (kept as bank growth, withdrawn by `team`, or shared) is a founder decision;
publish it with the pilot. The deferred splits can be rehearsed on a mainnet fork only
(`.github/workflows/rehearsal.yml`, `Launch.s.sol`); that is not part of the pilot.

## 8. Weekly report (dry run)

`scripts/cup/weekly.mjs` only reads; it holds no key and has no `--send` flag.

- **Offline:** `node scripts/cup/weekly.mjs --plan --week 0`. Pass: the first line is
  `DRY RUN: read-only. Nothing is signed or sent.`
- **Against the fork (A):** with the fork's stadium manifests in a throwaway checkout's
  `games/penalty-kings/deployments/<tier>.json` (fields `chainId, game, rf, generations, entropy,
  provider, deploymentBlock`, as `stadium.mjs` writes them), run
  `node scripts/cup/weekly.mjs --from <deploy block> --to <latest block> --rpc <fork RPC>`.
  Pass: `Balls settled` equals the number of `Settled` events from step 5; one row per Friend that
  played; and the three notes `No Bootroom in deployments/live.json…`, `No dropVault in deployments/live.json…`
  and `No RewardsDistributor in deployments/live.json…`, which confirm that no $GBOOT contract is wired.
  The report's drops, Cup table and edge-split lines are $GBOOT concepts and are ignored for the pilot.
  It writes `weekly-<from>-<to>.json` in the working directory (do not commit it).
- **On a real testnet (B):** the script reads Generations at its mainnet address, so it needs that
  address as a parameter first; until then, count `Settled` events per stadium with `cast logs`.

## 9. The penalty roll (client-side in the pilot)

No money depends on a kick, so the pilot may run the penalty roll in the client with the beacon for
fairness ([RNG-INTEGRATION.md](RNG-INTEGRATION.md), Roll 2). Verify on a device with the v0.2.1
`RandomnessSource` wired (HANDOFF-RF.md, section 2, row 6): for a logged kick, the beacon round is
later than the commitment, and `keeperSeed(beacon, commitment)` plus `resolveShot` reproduce the result.
If the pilot ever pays for a kick, it needs the referee (`verifier/`) and an on-chain commitment first.

## 10. What "pass" means overall

| Step | Pass |
|---|---|
| 2. Offline gates | All five commands pass as shown |
| 3. Deploy | Three stadiums deployed and funded; `rehearsal PASSED` (A) or the same state (B) |
| 4. Wiring and roles | Every row of the table matches; the only privileged role is `team`; no deferred contract exists |
| 5. Pack flow | Buy → play → randomness → settle works for Park, Pro and Champions; every outcome recomputes from public randomness; with the beacon, every round is later than its purchase |
| 6. Redeem | RF arrives in the TBA equal to reward × quantity; the reverts listed happen |
| 7. Edge | The accounting identity holds exactly; `withdrawSurplus` is `team`-only and capped |
| 8. Weekly | The dry run counts every settled ball and reports no $GBOOT contract |
| 9. Penalty | Seeds recompute from the beacon and the commitment |

**Stop rules** (from `scripts/onchain/lib.mjs`): any reverted or unexpected transaction is a **FREEZE**:
stop, investigate read-only, and change nothing before the cause is understood. Record every testnet
transaction (purpose, target, function, arguments, hash) in Rare Friends' own log, not in this repo's
[TX-LOG.md](TX-LOG.md), which is for Robinhood mainnet.
