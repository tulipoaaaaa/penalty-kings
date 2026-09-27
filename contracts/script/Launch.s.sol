// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Script, console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { KitShop, IGBoot } from "../src/KitShop.sol";
import { LiquidityLock, IPositionManager } from "../src/LiquidityLock.sol";
import { PoolSwapper } from "../src/PoolSwapper.sol";
import { SkillCup, ISkillGenerations, ISkillToken } from "../src/SkillCup.sol";
import { Wildcards, IWildcardGenerations, IWildcardToken, IWildcardEntropy } from "../src/Wildcards.sol";
import { PoolKey, IPoolManager, IPositionManagerFull, IPermit2 } from "../src/interfaces/IUniswapV4.sol";
import { EmissionVault } from "../src/EmissionVault.sol";
import { Bootroom, IBootroomGenerations } from "../src/Bootroom.sol";
import { FriendsAirdrop, IBootroomLace } from "../src/FriendsAirdrop.sol";
import { EdgeSplitter, ISplitterSwapper } from "../src/EdgeSplitter.sol";
import { GBootFixedPrice } from "../src/GBootFixedPrice.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";
import { RewardsDistributor, IRewardsGenerations, IRewardsSkillCup } from "../src/RewardsDistributor.sol";

/// $GBOOT launch (tokenomics v2, docs/ECONOMY.md): 100M token distributed in the same transaction
/// sequence: 55M single-sided pool position (locked), 20M drop vault (4-week seasons, halving), 10M
/// Friends airdrop (pre-laced into the Bootroom), 10M Cups & events vault, 5M rewards vault (the
/// RewardsDistributor's own halving EmissionVault: Skill Zone / streak rewards); no team allocation.
/// THE ONE DEFAULT (owner decision "option B": pool fees feed the pot): a PLAIN Uniswap v4
/// $GBOOT/RF pool with a 1% LP fee and NO hook (GBootFeeHook stays designed but off until audited).
/// The protocol-owned positions sit in LiquidityLock; anyone may call `collect` (weekly) and each
/// fee side is split on-chain: 50% burned (RF.burn / GBoot.burn), 50% to the Cup pot (`CUP_POT`,
/// default the disclosed burner, the same pot as EdgeSplitter, SkillCup and Wildcards).
/// Without the hook there is no on-chain TWAP, so the sinks and rewards price through
/// GBootFixedPrice (fixed 0.1 RF per $GBOOT: Skill Cup / Wildcard 100 $GBOOT, kits as listed).
/// Plus Bootroom and EdgeSplitter (whose buy-back pays the pool's 1% fee like any swap).
/// `REFEREE_SIGNER` is the address whose EIP-712 signatures authorise reward claims (the referee's
/// reward key, scripts/cup/reward-signer.mjs); it falls back to the burner for rehearsals.
///
/// Rehearse (fork simulation, nothing sent):
///   forge script script/Launch.s.sol --fork-url $ROBINHOOD_RPC_URL --sender $BURNER
/// Send (same script, same env):
///   forge script script/Launch.s.sol --rpc-url $ROBINHOOD_RPC_URL --account pk-burner --sender $BURNER --broadcast
///
/// Env from `node scripts/onchain/pool-plan.mjs --env <floorRF> <smokeRF>`: PLAN_T1_* when $GBOOT
/// sorts after RF (token1), PLAN_T0_* when before (token0); FLOOR_RF_WEI, SMOKE_RF; UNLOCK_DAYS (180).
contract Launch is Script {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    address constant DICE_ENTROPY = 0xd8A0680e7699526B57140ED4EAfdCc7219Dc0A0c;
    address constant DICE_PROVIDER = 0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6;
    /// Uniswap v4 fee units (hundredths of a bip): 10,000 = 1% LP fee, all of it earned by the locked positions.
    uint24 constant LP_FEE = 10_000;
    uint256 constant POOL_GBOOT = 55_000_000e18;
    uint256 constant DROPS_GBOOT = 20_000_000e18;
    uint256 constant AIRDROP_GBOOT = 10_000_000e18;
    uint256 constant CUPS_GBOOT = 10_000_000e18;
    uint256 constant BOUNTY_GBOOT = 5_000_000e18;
    IPositionManagerFull constant PM = IPositionManagerFull(POSITION_MANAGER);

    GBoot internal gboot;
    KitShop internal shop;
    LiquidityLock internal lock;
    PoolSwapper internal swapper;
    SkillCup internal skillCup;
    Wildcards internal wildcards;
    Bootroom internal bootroom;
    EmissionVault internal drops;
    EmissionVault internal cups;
    EmissionVault internal bounty;
    FriendsAirdrop internal airdrop;
    EdgeSplitter internal splitter;
    GBootFixedPrice internal feed;
    RewardsDistributor internal rewards;
    uint256 internal start;
    PoolKey internal key;
    string internal prefix;
    uint256 internal firstId;
    uint256 internal positions;
    address internal pot;

    function run() external {
        vm.startBroadcast();
        _deploy(msg.sender);
        _allocate(msg.sender);
        _mint();
        _smoke();
        vm.stopBroadcast();
        require(PM.ownerOf(firstId) == address(lock), "position A not locked");
        if (positions == 2) require(PM.ownerOf(firstId + 1) == address(lock), "position B not locked");
        console2.log("GBOOT", address(gboot));
        console2.log("KitShop", address(shop));
        console2.log("LiquidityLock", address(lock));
        console2.log("PoolSwapper", address(swapper));
        console2.log("SkillCup", address(skillCup));
        console2.log("Wildcards", address(wildcards));
        console2.log("Bootroom", address(bootroom));
        console2.log("DropVault", address(drops));
        console2.log("CupsVault", address(cups));
        console2.log("BountyVault", address(bounty));
        console2.log("FriendsAirdrop", address(airdrop));
        console2.log("EdgeSplitter", address(splitter));
        console2.log("GBootFixedPrice", address(feed));
        console2.log("CupPot", pot);
        console2.log("RewardsDistributor", address(rewards));
        console2.log("RewardsVault", address(bounty));
        console2.log("positionA", firstId);
        console2.log("unlockTime", lock.unlockTime());
    }

    function _deploy(address burner) internal {
        start = block.timestamp;
        gboot = new GBoot();
        pot = vm.envOr("CUP_POT", burner);
        bool gbootIs0 = address(gboot) < RF;
        prefix = gbootIs0 ? "PLAN_T0_" : "PLAN_T1_";
        // Plain pool: 1% LP fee, no hook. The fee is collected by LiquidityLock and split burn / pot.
        key = gbootIs0 ? PoolKey(address(gboot), RF, LP_FEE, 200, address(0)) : PoolKey(RF, address(gboot), LP_FEE, 200, address(0));
        feed = new GBootFixedPrice();
        // KitShop item ids 0–14 match games/penalty-kings/economy.ts COSMETICS order. Prices are in RF:
        // the economy.ts $GBOOT price × 0.1 RF (the launch price), i.e. list[i] × 1e17 RF wei.
        uint256[15] memory list = [uint256(0), 6, 9, 0, 8, 15, 0, 4, 4, 0, 5, 7, 12, 9, 10];
        uint256[] memory pricesRf = new uint256[](15);
        for (uint256 i; i < 15; ++i) pricesRf[i] = list[i] * 1e17;
        shop = new KitShop(IGBoot(address(gboot)), IGBootPriceFeed(address(feed)), start, pricesRf);
        lock = new LiquidityLock(
            IPositionManager(POSITION_MANAGER), burner, block.timestamp + vm.envOr("UNLOCK_DAYS", uint256(180)) * 1 days, RF, address(gboot), pot
        );
        swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        // One Cup pot for everything: Skill Cup entries, Wildcards, the edge split and the LP fees.
        skillCup = new SkillCup(ISkillGenerations(GENERATIONS), ISkillToken(address(gboot)), IGBootPriceFeed(address(feed)), pot, start);
        wildcards = new Wildcards(
            IWildcardGenerations(GENERATIONS), IWildcardToken(address(gboot)), IGBootPriceFeed(address(feed)), IWildcardEntropy(DICE_ENTROPY), DICE_PROVIDER, pot, start
        );
    }

    /// Everything except the pool's 55M leaves the deployer here; the operator is the disclosed burner.
    function _allocate(address operator) internal {
        drops = new EmissionVault(IERC20(address(gboot)), operator, block.timestamp, 2_500_000e18, 4);   // 10M per 4-week season, halving
        cups = new EmissionVault(IERC20(address(gboot)), operator, block.timestamp, 100_000e18, 0);      // flat: 100k per week
        // The Bootroom whitelists the FriendsAirdrop (the only non-Friend caller that may start a lock)
        // as an immutable, so the airdrop's CREATE address is predicted: it is the operator's very next
        // deployment after the Bootroom. Checked right after both exist.
        address predictedAirdrop = vm.computeCreateAddress(operator, vm.getNonce(operator) + 1);
        bootroom = new Bootroom(IERC20(address(gboot)), IBootroomGenerations(GENERATIONS), predictedAirdrop);
        airdrop = new FriendsAirdrop(IERC20(address(gboot)), IBootroomLace(address(bootroom)), address(cups));
        require(address(airdrop) == predictedAirdrop && bootroom.airdrop() == address(airdrop), "airdrop whitelist");
        require(address(airdrop.bootroom()) == address(bootroom), "airdrop bootroom");
        // Rewards: the distributor creates and alone operates its vault (50k/week, halving every 52 weeks).
        address[] memory sinkList = new address[](3);
        (sinkList[0], sinkList[1], sinkList[2]) = (address(shop), address(skillCup), address(wildcards));
        rewards = new RewardsDistributor(
            IERC20(address(gboot)), IRewardsGenerations(GENERATIONS), IRewardsSkillCup(address(skillCup)), IGBootPriceFeed(address(feed)),
            vm.envOr("REFEREE_SIGNER", operator), start, 50_000e18, 52, sinkList
        );
        bounty = rewards.vault();
        splitter = new EdgeSplitter(IERC20(RF), IERC20(address(gboot)), ISplitterSwapper(address(swapper)), key, pot, operator);
        gboot.transfer(address(drops), DROPS_GBOOT);
        gboot.transfer(address(cups), CUPS_GBOOT);
        gboot.transfer(address(bounty), BOUNTY_GBOOT);
        gboot.transfer(address(airdrop), AIRDROP_GBOOT);
        require(gboot.balanceOf(operator) == POOL_GBOOT, "only the pool allocation remains");
    }

    function _env(string memory name) internal view returns (uint256) {
        return vm.envUint(string.concat(prefix, name));
    }

    function _envTick(string memory name) internal view returns (int24) {
        return int24(vm.envInt(string.concat(prefix, name)));
    }

    function _mint() internal {
        gboot.approve(PERMIT2, POOL_GBOOT);
        IPermit2(PERMIT2).approve(address(gboot), POSITION_MANAGER, uint160(POOL_GBOOT), uint48(block.timestamp + 1 hours));
        PM.initializePool(key, uint160(_env("SQRT_START")));
        uint256 floorLiquidity = vm.envOr(string.concat(prefix, "B_LIQUIDITY"), uint256(0));
        positions = floorLiquidity == 0 ? 1 : 2;
        bytes[] memory params = new bytes[](positions + 1);
        firstId = PM.nextTokenId();
        params[0] = abi.encode(key, _envTick("A_LOWER"), _envTick("A_UPPER"), _env("A_LIQUIDITY"), type(uint128).max, type(uint128).max, address(lock), bytes(""));
        if (positions == 2) {
            uint256 floorRf = vm.envUint("FLOOR_RF_WEI");
            IERC20(RF).approve(PERMIT2, floorRf);
            IPermit2(PERMIT2).approve(RF, POSITION_MANAGER, uint160(floorRf), uint48(block.timestamp + 1 hours));
            params[1] = abi.encode(key, _envTick("B_LOWER"), _envTick("B_UPPER"), floorLiquidity, type(uint128).max, type(uint128).max, address(lock), bytes(""));
        }
        params[positions] = abi.encode(key.currency0, key.currency1);
        bytes memory actions = positions == 1 ? abi.encodePacked(uint8(0x02), uint8(0x0d)) : abi.encodePacked(uint8(0x02), uint8(0x02), uint8(0x0d));
        PM.modifyLiquidities(abi.encode(actions, params), block.timestamp + 30 minutes);
    }

    /// Smoke test: buy $GBOOT with SMOKE_RF (min-out 3% below the exact quote), sell 10% back.
    function _smoke() internal {
        uint256 smoke = vm.envOr("SMOKE_RF", uint256(0));
        if (smoke == 0) return;
        IERC20(RF).approve(address(swapper), smoke);
        bool rfIs0 = key.currency0 == RF;
        uint256 bought = swapper.swapExactIn(key, rfIs0, uint128(smoke), uint128(_env("SMOKE_MIN_GBOOT")));
        gboot.approve(address(swapper), bought / 10);
        swapper.swapExactIn(key, !rfIs0, uint128(bought / 10), 1);
    }
}
