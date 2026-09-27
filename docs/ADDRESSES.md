# Addresses and sources

Every external address used by Penalty Kings, where it came from, and how it was checked on
Robinhood mainnet (chain 4663). Reads were made through a QuickNode Robinhood endpoint on
2026-09-27 (around block 73,657,545). **UNVERIFIED** entries are never sent funds.

| Name | Address | Source | On-chain check | Status |
|---|---|---|---|---|
| RF ($RAREFRIENDS) | `0x0779369854d3EcdEA927206718FFD7730C67B71f` | rarefriends.com/docs/contracts; FriendSDK `contracts/README.md` | code present; `symbol()` = `RAREFRIENDS`; `totalSupply()` = 951,420,552.59; bytecode has `burn(uint256)` (`0x42966c68`) and `burnFrom` (`0x79cc6790`) | verified |
| Generations | `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` | rarefriends.com/docs/contracts; FriendSDK | `token()` = RF | verified |
| Genesis | `0x116EaA62241751E0c98dA43d458600c6C17cD361` | rarefriends.com/docs/contracts | not read (not used by our scripts) | recorded |
| ActivationManager | `0xD4A35e11318E3679168d409184B788bcF9F283Ac` | rarefriends.com/docs/contracts; **Sourcify full match** (`src/ActivationManager.sol`) | `hardwire(uint8 expectedGeneration)`: Generations picks the highest generation the holder's live RF balance affords (≥ 10^(6−gen) RF) and reverts on mismatch; pays the denomination, **half burned** (`RF.burn`), half to Friend reward streams; `retired()` = false | verified |
| RF/WETH hook | `0x7A65d0194e6Cc43971C31CE7D1471Da01D42A0cC` | rarefriends.com/docs/contracts; Sourcify full match (`RareFriendsHook`) | pool key via `RareFriendsMarket.poolKey()` (dynamic fee flag, tick spacing 60) | verified |
| Market | `0x99930E551b6f849bAabC4B491053eF28a700C4F2` | rarefriends.com/docs/contracts; **Sourcify full match** (`RareFriendsMarket`) | `buyExactRF(rfAmount, maxWethIn, recipient, deadline)` pays WETH (`weth()` below); no quote view, so quotes are exact simulations at the current block | verified |
| WETH (Robinhood Chain) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | `RareFriendsMarket.weth()` on-chain; Sourcify (TransparentUpgradeableProxy) | `deposit()` used in the fork rehearsal | verified |
| Reserve | `0xA850B2499c064900EfF341745807e1cB0d71a52b` | rarefriends.com/docs/contracts | not read | recorded |
| Token-bound account impl | `0xED038886c002B285EB0f74971e967B02F6af8ea5` | rarefriends.com/docs/contracts | not read (the SDK resolves wallets) | recorded |
| Dice Entropy | `0xd8a0680e7699526b57140ed4eafdcc7219dc0a0c` | FriendSDK `contracts/README.md` (pinned by the SDK CLI) | checked by SDK deploy tooling at deploy time | SDK-pinned |
| Dice provider | `0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6` | FriendSDK `contracts/README.md` | as above | SDK-pinned |
| RF/WETH v4 pool id | `0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240` | rarefriends.com/docs/contracts | StateView `getSlot0` → sqrtPriceX96 59949106155254258080182211, tick −143740; `getLiquidity` 147865847752143433133351 (≈ 112 ETH + 195M RF virtual) | verified |
| RF/WETH pool key | currency0 RF, currency1 WETH, fee `0x800000` (dynamic), tickSpacing 60, hooks `0x7A65…A0cC` | `RareFriendsMarket.poolKey()` on-chain | `keccak256(abi.encode(key))` = the pool id above (recomputed 2026-09-27, block 73,793,321); RF and WETH `decimals()` = 18 | verified |
| USDG (Global Dollar, Paxos) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | web search result summary (sources listed: Paxos USDG mainnet page, Robinhood Chain address lists); those pages are blocked from this sandbox, so the on-chain checks are the evidence | code present; `symbol()` = `USDG`, `name()` = `Global Dollar`, `decimals()` = **6**, `totalSupply()` ≈ 688.6M; Sourcify exact match `ERC1967Proxy`, EIP-1967 implementation `0x68184C449E1a8f34fA18d289737129FD27B66f8F` = Sourcify match `contracts/stablecoins/USDG.sol:USDG`. Clones named "USDG" exist on this chain; only this address is used | verified |
| WETH/USDG v4 pool (deepest) | id `0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593` · currency0 WETH, currency1 USDG, fee 500 (0.05%), tickSpacing 10, hooks `0x0` (none) | PoolManager `Initialize` logs filtered on (currency0 = WETH, currency1 = USDG): **338** pools, 22 with in-range liquidity; this one has the largest `StateView.getLiquidity` | initialized in tx `0x36515a2d044af31b35d06b06fdb1ed0ca307117083a530d5331d1f6ded62ea43` (block 8,793,983); id recomputed from the key; `getLiquidity` 54,700,254,881,350,032 (next: fee 200/ts 4 no-hook pool 32,569,036,587,964,904; then a hooked fee-3500 pool 7.67e15); `getSlot0` sqrtPriceX96 4129642798072125940494846, tick −197248 → ≈ $2,717 per WETH (block 73,793,321) | verified |
| Uniswap v4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | Uniswap docs `content/protocols/v4/deployments.mdx` ("Robinhood Chain: 4663"), Uniswap/docs commit `1c7597d` | returned by `poolManager()` on StateView, PositionManager and Quoter | verified |
| Uniswap v4 PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | same | `poolManager()` = PoolManager | verified |
| Uniswap v4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | same | `poolManager()` = PoolManager; pool reads succeed | verified |
| Uniswap v4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | same | `poolManager()` = PoolManager | verified |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | same; also Uniswap swapping-API supported chains | not read | recorded |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same | `DOMAIN_SEPARATOR()` answers | verified |
| Deterministic CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | forge-std `CREATE2_FACTORY` (Arachnid deterministic-deployment-proxy); was used by `Launch.s.sol` to place `GBootFeeHook` at a mined address with hook flags `0x10C4`; the launch default is now a plain pool with no hook, so only the (audited) hook upgrade would need it | `eth_getCode` returns the proxy bytecode (`0x7fff…e03601600081602082378035828234f5…`), checked 2026-09-27 (block ≈ 73,841,000); a fork simulation of `Launch.s.sol` (2026-09-27) placed the hook through it at salt 45,554 (`0xc879…10c4`), initialized the pool and minted position A into the lock | verified |
| PONS v2 factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | owner brief | `approvedPairTokens(RF)` = **false** (2026-09-27) → launch via Uniswap v4 directly | checked |

## Live RF/USD price (game/price.ts)

The game shows no fixed or illustrative price. `games/penalty-kings/game/price.ts` sends two
read-only `eth_call`s to `https://rpc.mainnet.chain.robinhood.com` (the host the SDK CSP allows):
`StateView.getSlot0(RF/WETH pool id)` and `StateView.getSlot0(WETH/USDG pool id)`, then

- WETH per RF = (sqrtPriceX96 / 2^96)² (RF is currency0; both tokens have 18 decimals);
- USD per WETH = (sqrtPriceX96 / 2^96)² × 10^(18 − 6) (WETH is currency0; USDG has 6 decimals; USDG is taken as $1);
- usdPerRf = WETH per RF × USD per WETH.

The result is cached for 60 s and labelled "live · Xs ago"; a failed read shows "—". Sample read
at block 73,793,321 (2026-09-27): RF/WETH sqrtPriceX96 59977880447322165122003233 (tick −143730) →
5.731e-7 WETH per RF; WETH/USDG → $2,716.9 per WETH; **1 RF ≈ $0.001557**.

Context only (not used): the native-ETH/USDG pools (currency0 = `0x0`) are separate from the WETH
pools; the deepest one seen (id `0x54f7…ba32`, fee 460, tickSpacing 9, no hooks) had about 2.7× the
in-range liquidity of the WETH/USDG pool above. The owner asked for WETH/USDG, so that is what the
game reads; both quoted ≈ $2,717–2,718 per ETH at the same block.

## Vendored packages

| Package | Source | SHA-256 |
|---|---|---|
| `vendor/rarefriends-friendsdk-0.1.2.tgz` | https://github.com/spokesz/friendsdk/releases/download/v0.1.2/rarefriends-friendsdk-0.1.2.tgz | `a6352e187916089b6829c5387fe87f386c5774004f181990e4e3c8ae641cfe83` |

## Burner wallet

`0xDB454B035777692EB6bd599297781a7ACC3A25e4` is the owner's burner (the owner created it and holds its key). The address generated by the first session, `0x4475…83cd`, was never funded and is abandoned.

Verified-source note: Blockscout sits behind a Cloudflare challenge that blocks datacenter IPs, so sources were read from **Sourcify** (`sourcify.dev/server/v2/contract/4663/<address>`), which reports full matches for the same deployments.

## Our deployments

None yet. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Pons launchpad (checked 2026-09-27, block 73,858,608; read-only)

| Contract | Address | Source | Verified |
|---|---|---|---|
| Pons V2 LaunchFactory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | Official repo github.com/ponsdotdev/pons-labs (README) | Code present (24 KB). `owner()` = `0x263ed295dAFaE1d9AAdD6E56c4B6F9f38eE019Dd`. |
| Pons V1 LaunchFactory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` | Same README | V1 pairs every launch with WETH (Uniswap v3, locked LP) |

- **Can $GBOOT launch on Pons against RF?** Not today. V2 launches pair only with tokens in the owner-controlled allowlist `approvedPairTokens` (`setPairTokenApproved` is `onlyOwner`). `approvedPairTokens(RF 0x0779…B71f)` = **false**, and `pairTokenEconomics(RF)` is unset. `approvedPairTokens(USDG)` = true, which shows the check works.
- A Pons V2 launch trades on a bonding curve first, then "graduates" into a full-range **Uniswap v4** pool in the chosen pair token. A curve fee (≤ 10%) and a creator tax (≤ 10%) apply.
- To launch on Pons against RF, the Pons team must approve RF as a pair token.

**Price check (FD-5, 2026-09-27, block 73,949,883):**
- An independent `cast call StateView.getSlot0` on both pools gives 1 RF = **$0.0014565** (WETH/RF 5.367e-7 × $2,713.6/WETH).
- The game's own `fetchRfPrice()`, the live-stadium path, returns the identical value, so the 500,000 RF pot shows ≈ $728.
- The preview's labelled on-chain snapshot was refreshed to this block; the previous snapshot, at block 73,793,321, was 6.5% stale.
