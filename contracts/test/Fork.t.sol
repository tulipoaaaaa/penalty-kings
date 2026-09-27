// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { LiquidityLock, IPositionManager } from "../src/LiquidityLock.sol";
import { PoolSwapper } from "../src/PoolSwapper.sol";
import { PoolKey, IPoolManager, IPositionManagerFull, IPermit2 } from "../src/interfaces/IUniswapV4.sol";

/// Mainnet-fork rehearsal of the $GBOOT/RF launch. Run with:
///   forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL -vv
/// Pool numbers come from scripts/onchain/pool-plan.mjs (GBOOT as token1 case is recomputed here
/// from the same ticks. v2 (0.1 RF per $GBOOT): GBOOT token1 → start 23000, A [-46000, 23000];
/// GBOOT token0 → start -23000, A [-23000, 46000]). Launch default (owner decision "option B"): a
/// PLAIN pool, 1% LP fee, no hook, as in Launch.s.sol. The locked position earns the 1% fee and
/// anyone's LiquidityLock.collect splits it: 50% burned / 50% to the Cup pot, on both sides.
contract ForkLaunchTest is Test {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    GBoot internal gboot;
    LiquidityLock internal lock;
    PoolSwapper internal swapper;
    PoolKey internal key;
    address internal burner = makeAddr("burner");
    address internal pot = makeAddr("cupPot");

    function setUp() public {
        vm.startPrank(burner);
        gboot = new GBoot();
        lock = new LiquidityLock(IPositionManager(POSITION_MANAGER), burner, block.timestamp + 180 days, RF, address(gboot), pot);
        swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        vm.stopPrank();
        bool gbootIs0 = address(gboot) < RF;
        key = PoolKey(gbootIs0 ? address(gboot) : RF, gbootIs0 ? RF : address(gboot), 10_000, 200, address(0));
        deal(RF, burner, 1_000_000e18);
    }

    function _plan() internal view returns (uint160 sqrtStart, int24 lower, int24 upper, bool gbootIs0) {
        gbootIs0 = key.currency0 == address(gboot);
        // Values from scripts/onchain/pool-plan.mjs (getSqrtPriceAtTick(±23000)).
        sqrtStart = gbootIs0 ? uint160(25_087_991_844_255_625_192_629_315_791) : uint160(250_203_434_948_259_642_083_317_319_084);
        (lower, upper) = gbootIs0 ? (int24(-23_000), int24(46_000)) : (int24(-46_000), int24(23_000));
    }

    function testLaunchSwapCollectLock() public {
        (uint160 sqrtStart, int24 lower, int24 upper, bool gbootIs0) = _plan();
        vm.startPrank(burner);
        gboot.approve(PERMIT2, type(uint256).max);
        IERC20(RF).approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(address(gboot), POSITION_MANAGER, type(uint160).max, uint48(block.timestamp + 1 days));
        IPermit2(PERMIT2).approve(RF, POSITION_MANAGER, type(uint160).max, uint48(block.timestamp + 1 days));
        IPositionManagerFull pm = IPositionManagerFull(POSITION_MANAGER);
        pm.initializePool(key, sqrtStart);
        uint256 tokenId = pm.nextTokenId();
        uint256 liquidity = vm.envOr("PLAN_LIQUIDITY_A", uint256(0));
        if (liquidity == 0) liquidity = 1e24; // small test position when no plan is supplied
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, liquidity, type(uint128).max, type(uint128).max, address(lock), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(abi.encodePacked(uint8(0x02), uint8(0x0d)), params), block.timestamp);
        assertEq(pm.ownerOf(tokenId), address(lock), "position minted straight into the lock");
        assertEq(uint256(pm.getPositionLiquidity(tokenId)), liquidity);
        assertEq(IERC20(RF).balanceOf(burner), 1_000_000e18, "position A is single-sided: no RF used");

        // Buy $GBOOT with 1,000 RF, then sell 10% back.
        uint256 rfSupplyStart = IERC20(RF).totalSupply();
        IERC20(RF).approve(address(swapper), type(uint256).max);
        gboot.approve(address(swapper), type(uint256).max);
        uint256 bought = swapper.swapExactIn(key, !gbootIs0, 1_000e18, 1);
        assertGt(bought, 0);
        uint256 sold = swapper.swapExactIn(key, gbootIs0, uint128(bought / 10), 1);
        assertGt(sold, 0);

        // Fees: the 1% LP fee accrued to the locked position (RF on the buy, $GBOOT on the sell).
        // Anyone collects; each side is split 50% burned / 50% to the Cup pot, nothing stays behind.
        vm.stopPrank();
        _collectAndCheck(tokenId, gbootIs0, rfSupplyStart, bought / 10);
        vm.startPrank(burner);
        vm.expectRevert(LiquidityLock.Locked.selector);
        lock.withdraw(tokenId);
        vm.stopPrank();
        vm.warp(block.timestamp + 180 days);
        vm.prank(burner);
        lock.withdraw(tokenId);
        assertEq(pm.ownerOf(tokenId), burner);
    }

    /// Anyone collects; each fee side (1% of the swap input) is split 50% burned / 50% to the pot.
    function _collectAndCheck(uint256 tokenId, bool gbootIs0, uint256 rfSupplyStart, uint256 gbootSold) internal {
        uint256 gbootSupply = gboot.totalSupply();
        vm.prank(makeAddr("anyone"));
        (uint256 burned0, uint256 toPot0, uint256 burned1, uint256 toPot1) = lock.collect(tokenId);
        (uint256 rfBurned, uint256 rfPot) = gbootIs0 ? (burned1, toPot1) : (burned0, toPot0);
        (uint256 gbBurned, uint256 gbPot) = gbootIs0 ? (burned0, toPot0) : (burned1, toPot1);
        assertApproxEqRel(rfBurned + rfPot, 10e18, 1e12, "RF fees = 1% of the 1,000 RF buy");
        assertApproxEqRel(gbBurned + gbPot, gbootSold / 100, 1e12, "GBOOT fees = 1% of the sell");
        assertEq(IERC20(RF).totalSupply(), rfSupplyStart - rfBurned, "RF half burned (RF.burn)");
        assertEq(gboot.totalSupply(), gbootSupply - gbBurned, "GBOOT half burned");
        assertEq(IERC20(RF).balanceOf(pot), rfPot, "RF half to the pot");
        assertEq(gboot.balanceOf(pot), gbPot, "GBOOT half to the pot");
        assertLe(rfBurned, rfPot);
        assertLe(rfPot - rfBurned, 1);
        assertEq(IERC20(RF).balanceOf(address(lock)) + gboot.balanceOf(address(lock)), 0, "no residue");
    }
}
