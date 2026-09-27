// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { GBootFeeHook } from "../src/GBootFeeHook.sol";
import { PoolSwapper } from "../src/PoolSwapper.sol";
import { PoolKey, IPoolManager, IPositionManagerFull, IPermit2 } from "../src/interfaces/IUniswapV4.sol";

/// Mainnet-fork test of the (not deployed) fee hook: RF-side fees are burned, $GBOOT-side fees
/// reach the Cup, and the swapper pays exactly 1% more / receives 1% less.
contract ForkHookTest is Test {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal cup = makeAddr("cup");
    address internal burner = makeAddr("burner");

    function testHookBurnsRfAndPaysCup() public {
        address hookAddress = address(uint160(0x4444) << 144 | uint160(0x44));
        deployCodeTo("GBootFeeHook.sol:GBootFeeHook", abi.encode(POOL_MANAGER, RF, cup), hookAddress);
        vm.startPrank(burner);
        GBoot gboot = new GBoot();
        PoolSwapper swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        bool gbootIs0 = address(gboot) < RF;
        PoolKey memory key = PoolKey(gbootIs0 ? address(gboot) : RF, gbootIs0 ? RF : address(gboot), 0, 200, hookAddress);
        (uint160 sqrtStart, int24 lower, int24 upper) = gbootIs0
            ? (uint160(7_944_237_437_844_371_073_164_709_801), int24(-46_000), int24(23_000))
            : (uint160(790_145_282_602_472_263_393_995_913_049), int24(-23_000), int24(46_000));
        gboot.approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(address(gboot), POSITION_MANAGER, type(uint160).max, uint48(block.timestamp + 1 days));
        IPositionManagerFull pm = IPositionManagerFull(POSITION_MANAGER);
        pm.initializePool(key, sqrtStart);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(62_135_082_016_468_007_977_851_967), type(uint128).max, type(uint128).max, burner, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(abi.encodePacked(uint8(0x02), uint8(0x0d)), params), block.timestamp);

        deal(RF, burner, 10_000e18);
        IERC20(RF).approve(address(swapper), type(uint256).max);
        gboot.approve(address(swapper), type(uint256).max);
        uint256 supplyBefore = IERC20(RF).totalSupply();
        uint256 cupBefore = gboot.balanceOf(cup);
        // Exact-in RF → GBOOT: unspecified = GBOOT output; 1% of it goes to the Cup.
        uint256 bought = swapper.swapExactIn(key, !gbootIs0, 1_000e18, 1);
        uint256 toCup = gboot.balanceOf(cup) - cupBefore;
        assertApproxEqRel(toCup * 99, bought, 0.001e18, "Cup gets 1% of the gross output");
        // Exact-in GBOOT → RF: unspecified = RF output; 1% of it is burned.
        swapper.swapExactIn(key, gbootIs0, uint128(bought / 2), 1);
        assertLt(IERC20(RF).totalSupply(), supplyBefore, "RF-side fee burned");
        vm.stopPrank();
    }
}
