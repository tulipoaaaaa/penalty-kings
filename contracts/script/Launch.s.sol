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

/// $GBOOT launch (tokenomics v2, docs/ECONOMY.md): 100M token distributed in the same transaction
/// sequence: 55M single-sided pool position (locked; LP fees burned), 20M drop vault (4-week seasons,
/// halving), 10M Friends airdrop (pre-laced into the Bootroom), 10M Cups & events vault, 5M FINAL
/// WALL bounty vault; no team allocation. Plus KitShop, SkillCup, Wildcards, Bootroom, EdgeSplitter.
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
    PoolKey internal key;
    string internal prefix;
    uint256 internal firstId;
    uint256 internal positions;

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
        console2.log("positionA", firstId);
        console2.log("unlockTime", lock.unlockTime());
    }

    function _deploy(address burner) internal {
        gboot = new GBoot();
        bool gbootIs0 = address(gboot) < RF;
        prefix = gbootIs0 ? "PLAN_T0_" : "PLAN_T1_";
        key = gbootIs0 ? PoolKey(address(gboot), RF, 10_000, 200, address(0)) : PoolKey(RF, address(gboot), 10_000, 200, address(0));
        // KitShop item ids 0–14 match games/penalty-kings/economy.ts COSMETICS order.
        uint256[15] memory list = [uint256(0), 6, 9, 0, 8, 15, 0, 4, 4, 0, 5, 7, 12, 9, 10];
        uint256[] memory prices = new uint256[](15);
        for (uint256 i; i < 15; ++i) prices[i] = list[i] * 1e18;
        shop = new KitShop(IGBoot(address(gboot)), prices);
        lock = new LiquidityLock(IPositionManager(POSITION_MANAGER), burner, block.timestamp + vm.envOr("UNLOCK_DAYS", uint256(180)) * 1 days);
        swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        // The pot for Skill Cup entries and Wildcards is the disclosed game treasury (the burner).
        skillCup = new SkillCup(ISkillGenerations(GENERATIONS), ISkillToken(address(gboot)), burner, block.timestamp);
        wildcards = new Wildcards(IWildcardGenerations(GENERATIONS), IWildcardToken(address(gboot)), IWildcardEntropy(DICE_ENTROPY), DICE_PROVIDER, burner);
    }

    /// Everything except the pool's 55M leaves the deployer here; the operator is the disclosed burner.
    function _allocate(address operator) internal {
        bootroom = new Bootroom(IERC20(address(gboot)), IBootroomGenerations(GENERATIONS));
        drops = new EmissionVault(IERC20(address(gboot)), operator, block.timestamp, 2_500_000e18, 4);   // 10M per 4-week season, halving
        cups = new EmissionVault(IERC20(address(gboot)), operator, block.timestamp, 100_000e18, 0);      // flat: 100k per week
        bounty = new EmissionVault(IERC20(address(gboot)), operator, block.timestamp, 50_000e18, 0);     // flat: 50k per week
        airdrop = new FriendsAirdrop(IERC20(address(gboot)), IBootroomLace(address(bootroom)), address(cups));
        splitter = new EdgeSplitter(IERC20(RF), IERC20(address(gboot)), ISplitterSwapper(address(swapper)), key, operator, operator);
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
