// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { LiquidityLock, IPositionManager } from "../src/LiquidityLock.sol";
import { PoolSwapper } from "../src/PoolSwapper.sol";
import { GBootFeeHook } from "../src/GBootFeeHook.sol";
import { GBootPriceFeed } from "../src/GBootPriceFeed.sol";
import { PoolKey, IPoolManager, IPositionManagerFull, IPermit2 } from "../src/interfaces/IUniswapV4.sol";

/// Mainnet-fork rehearsal of the $GBOOT/RF launch. Run with:
///   forge test --match-contract Fork --fork-url $ROBINHOOD_RPC_URL -vv
/// Pool numbers come from scripts/onchain/pool-plan.mjs (GBOOT as token1 case is recomputed here
/// from the same ticks. v2 (0.1 RF per $GBOOT): GBOOT token1 → start 23000, A [-46000, 23000];
/// GBOOT token0 → start -23000, A [-23000, 46000]). Round 6: the launch pool is LP fee 0 + the
/// GBootFeeHook (1% burned inside every swap, TWAP accumulator), as in Launch.s.sol.
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

    GBootFeeHook internal hook;

    function setUp() public {
        address hookAddress = address(uint160(0x4444) << 144 | uint160(0x10C4));
        deployCodeTo("GBootFeeHook.sol:GBootFeeHook", abi.encode(POOL_MANAGER), hookAddress);
        hook = GBootFeeHook(hookAddress);
        vm.startPrank(burner);
        gboot = new GBoot();
        lock = new LiquidityLock(IPositionManager(POSITION_MANAGER), burner, block.timestamp + 180 days);
        swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        vm.stopPrank();
        bool gbootIs0 = address(gboot) < RF;
        key = PoolKey(gbootIs0 ? address(gboot) : RF, gbootIs0 ? RF : address(gboot), 0, 200, address(hook));
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

        // Fees: the hook already burned 1% on both sides inside the swaps; the LP fee is 0, so
        // collectAndBurn (still permissionless) finds nothing. Withdraw reverts before unlock.
        assertLt(IERC20(RF).totalSupply(), rfSupplyStart, "RF-side hook fee burned");
        assertLt(gboot.totalSupply(), 100_000_000e18, "GBOOT-side hook fee burned");
        uint256 gbootSupply = gboot.totalSupply();
        lock.collectAndBurn(tokenId, key.currency0, key.currency1);
        assertEq(gboot.totalSupply(), gbootSupply, "no LP fees to collect");
        // The TWAP is live from the pool's history: 30 minutes after the swaps it reads the new price.
        GBootPriceFeed feed = new GBootPriceFeed(key, address(gboot));
        vm.warp(block.timestamp + 30 minutes);
        assertGt(feed.gbootForRf(10e18, true), 0);
        vm.expectRevert(LiquidityLock.Locked.selector);
        lock.withdraw(tokenId);
        vm.stopPrank();
        vm.warp(block.timestamp + 180 days);
        vm.prank(burner);
        lock.withdraw(tokenId);
        assertEq(pm.ownerOf(tokenId), burner);
    }
}
