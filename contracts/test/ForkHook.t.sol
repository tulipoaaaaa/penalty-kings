// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { GBootFeeHook } from "../src/GBootFeeHook.sol";
import { PoolSwapper } from "../src/PoolSwapper.sol";
import { PoolKey, IPoolManager, IPositionManagerFull, IPermit2 } from "../src/interfaces/IUniswapV4.sol";

/// Mainnet-fork test of the (not deployed) fee hook: fees are burned on BOTH sides (RF and $GBOOT),
/// and the swapper receives exactly 1% less.
contract ForkHookTest is Test {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal burner = makeAddr("burner");

    function testHookBurnsBothSides() public {
        address hookAddress = address(uint160(0x4444) << 144 | uint160(0x44));
        deployCodeTo("GBootFeeHook.sol:GBootFeeHook", abi.encode(POOL_MANAGER), hookAddress);
        vm.startPrank(burner);
        GBoot gboot = new GBoot();
        PoolSwapper swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        bool gbootIs0 = address(gboot) < RF;
        PoolKey memory key = PoolKey(gbootIs0 ? address(gboot) : RF, gbootIs0 ? RF : address(gboot), 0, 200, hookAddress);
        (uint160 sqrtStart, int24 lower, int24 upper) = gbootIs0
            ? (uint160(25_087_991_844_255_625_192_629_315_791), int24(-23_000), int24(46_000))
            : (uint160(250_203_434_948_259_642_083_317_319_084), int24(-46_000), int24(23_000));
        gboot.approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(address(gboot), POSITION_MANAGER, type(uint160).max, uint48(block.timestamp + 1 days));
        IPositionManagerFull pm = IPositionManagerFull(POSITION_MANAGER);
        pm.initializePool(key, sqrtStart);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(1e24), type(uint128).max, type(uint128).max, burner, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(abi.encodePacked(uint8(0x02), uint8(0x0d)), params), block.timestamp);

        deal(RF, burner, 10_000e18);
        IERC20(RF).approve(address(swapper), type(uint256).max);
        gboot.approve(address(swapper), type(uint256).max);
        uint256 supplyBefore = IERC20(RF).totalSupply();
        uint256 gbootBefore = gboot.totalSupply();
        // Exact-in RF → GBOOT: unspecified = GBOOT output; 1% of it is burned.
        uint256 bought = swapper.swapExactIn(key, !gbootIs0, 1_000e18, 1);
        uint256 burned = gbootBefore - gboot.totalSupply();
        assertApproxEqRel(burned * 99, bought, 0.001e18, "1% of the gross GBOOT output is burned");
        // Exact-in GBOOT → RF: unspecified = RF output; 1% of it is burned.
        swapper.swapExactIn(key, gbootIs0, uint128(bought / 2), 1);
        assertLt(IERC20(RF).totalSupply(), supplyBefore, "RF-side fee burned");
        vm.stopPrank();
    }
}
