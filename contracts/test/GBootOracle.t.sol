// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { GBootFeeHook } from "../src/GBootFeeHook.sol";
import { GBootPriceFeed } from "../src/GBootPriceFeed.sol";
import { PoolKey, SwapParams } from "../src/interfaces/IUniswapV4.sol";
import { TickMath } from "../src/libraries/TickMath.sol";

/// PoolManager stand-in: answers extsload with a Slot0 word holding the tick it was given.
contract MockOraclePoolManager {
    int24 public tick;
    function setTick(int24 tick_) external { tick = tick_; }
    function extsload(bytes32) external view returns (bytes32) {
        return bytes32((uint256(uint24(tick)) << 160) | uint256(TickMath.getSqrtPriceAtTick(tick)));
    }
}

/// Unit tests of the hook's TWAP accumulator (the fork suite checks it against the real PoolManager).
contract GBootOracleTest is Test {
    MockOraclePoolManager internal pm;
    GBootFeeHook internal hook;
    PoolKey internal key;
    bytes32 internal id;
    address internal constant GBOOT = address(0x1000);
    address internal constant RF = address(0x2000);

    // Brute-force model: change points (time, cumulative at that time, tick in force after it).
    struct Point { uint256 t; int256 cum; int24 tickAfter; }
    Point[] internal pts;

    function setUp() public {
        vm.warp(10_000_000);
        pm = new MockOraclePoolManager();
        address hookAt = address(uint160(0x4444) << 144 | uint160(0x10C4));
        deployCodeTo("GBootFeeHook.sol:GBootFeeHook", abi.encode(address(pm)), hookAt);
        hook = GBootFeeHook(hookAt);
        key = PoolKey(GBOOT, RF, 0, 200, hookAt);
        id = keccak256(abi.encode(key));
    }

    function _init(int24 tick) internal {
        pm.setTick(tick);
        vm.prank(address(pm));
        hook.afterInitialize(address(this), key, TickMath.getSqrtPriceAtTick(tick), tick);
        pts.push(Point(block.timestamp, 0, tick));
    }

    /// A swap now that moves the pool to `newTick` (beforeSwap sees the old tick).
    function _swapTo(int24 newTick) internal {
        vm.prank(address(pm));
        hook.beforeSwap(address(this), key, SwapParams(true, -1, 0), "");
        pm.setTick(newTick);
        Point storage last = pts[pts.length - 1];
        if (last.t == block.timestamp) { last.tickAfter = newTick; return; }
        pts.push(Point(block.timestamp, last.cum + int256(last.tickAfter) * int256(block.timestamp - last.t), newTick));
    }

    function _modelCumAt(uint256 t) internal view returns (int256) {
        Point memory p = pts[0];
        for (uint256 i; i < pts.length && pts[i].t <= t; ++i) p = pts[i];
        return p.cum + int256(p.tickAfter) * int256(t - p.t);
    }

    // ───────────────────────────────────── basics

    function testConstantTickOverWindow() public {
        _init(-23_000);
        vm.warp(block.timestamp + 1 hours);
        (int24 mean, uint32 windowStart) = hook.consult(id, 30 minutes);
        assertEq(mean, -23_000);
        assertEq(windowStart, block.timestamp - 30 minutes);
    }

    function testNotReadyBeforeAPeriodOfHistory() public {
        _init(100);
        vm.warp(block.timestamp + 10 minutes);
        _swapTo(200);
        vm.warp(block.timestamp + 10 minutes);
        vm.expectRevert(GBootFeeHook.OracleNotReady.selector);
        hook.consult(id, 30 minutes);
        vm.warp(block.timestamp + 10 minutes);
        (int24 mean,) = hook.consult(id, 30 minutes);
        assertEq(int256(mean), 166, "(100 x 600 + 200 x 1200) / 1800, floored");
    }

    function testPiecewiseExact() public {
        _init(0);
        vm.warp(block.timestamp + 600);
        _swapTo(1_000);
        vm.warp(block.timestamp + 600);
        _swapTo(-200);
        vm.warp(block.timestamp + 1_200);
        (int24 mean, uint32 windowStart) = hook.consult(id, 30 minutes);
        // Window [600, 2400]: 1000 × 600 − 200 × 1200 = 360,000 over 1,800 s.
        assertEq(windowStart, block.timestamp - 1_800);
        assertEq(mean, 200);
    }

    function testRoundsTowardsNegativeInfinity() public {
        _init(0);
        vm.warp(block.timestamp + 1_799);
        _swapTo(-1);
        vm.warp(block.timestamp + 1);
        vm.warp(block.timestamp + 1_800 - 1);
        _swapTo(-2);
        vm.warp(block.timestamp + 1);
        (int24 mean,) = hook.consult(id, 30 minutes);
        // (−1 × 1799 − 2 × 1) / 1800 = −1.0006 → −2.
        assertEq(mean, -2);
    }

    function testRingKeepsAnHourAfterWrapping() public {
        _init(0);
        for (uint256 i; i < 200; ++i) {
            vm.warp(block.timestamp + 61);
            _swapTo(int24(int256(i % 7)) * 10);
        }
        (,, uint16 count) = hook.oracleState(id);
        assertEq(count, hook.CARDINALITY());
        (int24 mean, uint32 windowStart) = hook.consult(id, 1 hours);
        assertGe(windowStart + 1 hours + 60, block.timestamp + 1);
        assertLe(windowStart + 1 hours, block.timestamp);
        assertGe(mean, 0);
        assertLe(mean, 60);
        vm.expectRevert(GBootFeeHook.BadPeriod.selector);
        hook.consult(id, 1 hours + 1);
    }

    function testOnlyPoolManagerAndFlagAddress() public {
        vm.expectRevert(GBootFeeHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, 0, 0);
        vm.expectRevert(GBootFeeHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, SwapParams(true, -1, 0), "");
        // The same code at an address without the 0x10C4 flags refuses to seed an oracle.
        address wrong = address(uint160(0x4444) << 144 | uint160(0x0044));
        deployCodeTo("GBootFeeHook.sol:GBootFeeHook", abi.encode(address(pm)), wrong);
        vm.prank(address(pm));
        vm.expectRevert(GBootFeeHook.WrongHookAddress.selector);
        GBootFeeHook(wrong).afterInitialize(address(this), key, 0, 0);
        vm.prank(address(pm));
        vm.expectRevert(GBootFeeHook.OracleNotInitialized.selector);
        hook.beforeSwap(address(this), key, SwapParams(true, -1, 0), "");
    }

    // ───────────────────────────────────── fuzz against a brute-force model

    /// Random swap times (dense and sparse) and ticks: the mean tick equals the model's exact average
    /// over [windowStart, now], and windowStart lies in (now − period − 60, now − period].
    function testFuzzMatchesModel(uint16[24] memory gaps, int16[24] memory ticks, uint16 periodSeed) public {
        _init(0);
        for (uint256 i; i < 24; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 400));
            _swapTo(int24(ticks[i]));
        }
        vm.warp(block.timestamp + bound(periodSeed, 0, 300));
        uint32 period = uint32(bound(periodSeed, 60, 1 hours));
        uint256 now_ = block.timestamp;
        if (now_ - period < pts[0].t) {
            vm.expectRevert(GBootFeeHook.OracleNotReady.selector);
            hook.consult(id, period);
            return;
        }
        (int24 mean, uint32 windowStart) = hook.consult(id, period);
        assertLe(windowStart, now_ - period);
        assertGt(uint256(windowStart) + 60, now_ - period);
        int256 delta = _modelCumAt(now_) - _modelCumAt(windowStart);
        int256 elapsed = int256(now_ - windowStart);
        int256 expected = delta / elapsed;
        if (delta < 0 && delta % elapsed != 0) expected--;
        assertEq(int256(mean), expected, "exact mean tick");
    }

    // ───────────────────────────────────── price feed

    function testFeedConvertsAtTheTwap() public {
        // GBOOT is currency0 here: price (currency1 per currency0) = RF per GBOOT = 1.0001^tick.
        _init(-23_000); // ≈ 0.10026 RF per GBOOT
        vm.warp(block.timestamp + 30 minutes);
        GBootPriceFeed feed = new GBootPriceFeed(key, GBOOT);
        assertTrue(feed.gbootIsCurrency0());
        uint256 cost = feed.gbootForRf(10e18, true);
        assertApproxEqRel(cost, 99.73e18, 0.001e18, "10 RF ~ 99.7 GBOOT at 0.10026");
        assertApproxEqRel(feed.rfPerGbootWad(), 0.10026e18, 0.001e18);
        assertGe(cost, feed.gbootForRf(10e18, false), "sinks round up, rewards down");
        // Same pool with GBOOT as currency1: price = GBOOT per RF.
        PoolKey memory flipped = PoolKey(address(0x0100), GBOOT, 0, 200, address(hook));
        bytes32 flippedId = keccak256(abi.encode(flipped));
        pm.setTick(23_000);
        vm.prank(address(pm));
        hook.afterInitialize(address(this), flipped, TickMath.getSqrtPriceAtTick(23_000), 23_000);
        vm.warp(block.timestamp + 30 minutes);
        GBootPriceFeed feed1 = new GBootPriceFeed(flipped, GBOOT);
        assertFalse(feed1.gbootIsCurrency0());
        assertApproxEqRel(feed1.gbootForRf(10e18, true), 99.73e18, 0.001e18);
        (int24 mean,) = hook.consult(flippedId, 30 minutes);
        assertEq(mean, 23_000);
    }

    /// Stale-price / divergence guard: while spot is > 1,000 ticks from the TWAP, conversions revert.
    function testFeedDivergenceGuard() public {
        _init(-23_000);
        vm.warp(block.timestamp + 30 minutes);
        GBootPriceFeed feed = new GBootPriceFeed(key, GBOOT);
        _swapTo(-21_999); // a sudden pump of 1,001 ticks (≈ +10.5%)
        vm.expectRevert(abi.encodeWithSelector(GBootPriceFeed.PriceUnstable.selector, int24(-21_999), int24(-23_000)));
        feed.gbootForRf(10e18, true);
        vm.warp(block.timestamp + 20 minutes);
        (int24 mean,) = hook.consult(id, 30 minutes);
        assertLe(-21_999 - mean, 1_000, "the TWAP caught up");
        feed.gbootForRf(10e18, true);
    }

    function testFeedRejectsForeignPools() public {
        vm.expectRevert(GBootPriceFeed.NotGbootPool.selector);
        new GBootPriceFeed(PoolKey(GBOOT, RF, 0, 200, address(0)), GBOOT);
        vm.expectRevert(GBootPriceFeed.NotGbootPool.selector);
        new GBootPriceFeed(PoolKey(address(0x3), RF, 0, 200, address(hook)), GBOOT);
    }

    /// TickMath port agrees with known values (tick 0 = 2^96; ±23,000 from pool-plan.mjs).
    function testTickMathReferenceValues() public pure {
        assertEq(TickMath.getSqrtPriceAtTick(0), 1 << 96);
        assertEq(TickMath.getSqrtPriceAtTick(-23_000), 25_087_991_844_255_625_192_629_315_791);
        assertEq(TickMath.getSqrtPriceAtTick(23_000), 250_203_434_948_259_642_083_317_319_084);
        assertEq(TickMath.getSqrtPriceAtTick(TickMath.MIN_TICK), 4_295_128_739);
        assertEq(TickMath.getSqrtPriceAtTick(TickMath.MAX_TICK), 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342);
    }
}
