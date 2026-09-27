// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { EmissionVault } from "../src/EmissionVault.sol";

contract EmissionVaultTest is Test {
    GBoot internal gboot;
    EmissionVault internal drops; // halving mode: 20M vault, 2.5M/week, halves every 4 weeks
    EmissionVault internal flat;  // flat mode: 100k/week
    address internal operator = address(0x0FE);
    address internal player = address(0xA11CE);
    uint256 internal start;

    event Released(uint256 indexed week, address indexed to, uint256 amount);

    function setUp() public {
        vm.warp(1_700_000_000);
        start = block.timestamp + 1 days;
        gboot = new GBoot();
        drops = new EmissionVault(IERC20(address(gboot)), operator, start, 2_500_000e18, 4);
        flat = new EmissionVault(IERC20(address(gboot)), operator, start, 100_000e18, 0);
        gboot.transfer(address(drops), 20_000_000e18);
        gboot.transfer(address(flat), 5_000_000e18);
    }

    function testImmutables() public view {
        assertEq(address(drops.token()), address(gboot));
        assertEq(drops.operator(), operator);
        assertEq(drops.start(), start);
        assertEq(drops.weeklyCap(), 2_500_000e18);
        assertEq(drops.halvingWeeks(), 4);
    }

    function testCurrentWeek() public {
        assertEq(drops.currentWeek(), 0, "before start counts as week 0");
        vm.warp(start);
        assertEq(drops.currentWeek(), 0);
        vm.warp(start + 1 weeks - 1);
        assertEq(drops.currentWeek(), 0);
        vm.warp(start + 1 weeks);
        assertEq(drops.currentWeek(), 1);
        vm.warp(start + 53 weeks + 3 days);
        assertEq(drops.currentWeek(), 53);
    }

    /// 4-week seasons: 10M, 5M, 2.5M ... per season; the sum of all seasons is < 20M.
    function testHalvingSchedule() public view {
        for (uint256 w; w < 4; ++w) assertEq(drops.capOf(w), 2_500_000e18);
        for (uint256 w = 4; w < 8; ++w) assertEq(drops.capOf(w), 1_250_000e18);
        assertEq(drops.capOf(8), 625_000e18);
        assertEq(drops.capOf(12), 312_500e18);
        uint256 total;
        for (uint256 w; w < 4 * 90; ++w) total += drops.capOf(w);
        assertLe(total, 20_000_000e18, "the schedule never asks for more than the vault");
        assertApproxEqAbs(total, 20_000_000e18, 1e6, "and converges to it");
    }

    function testCapReachesZero() public view {
        assertEq(drops.capOf(4 * 255), 0);
        assertEq(drops.capOf(4 * 255 + 3), 0);
        assertEq(drops.capOf(type(uint256).max), 0);
        // 2.5M GBOOT = 2.5e24 < 2^82, so the cap is already 0 after 82 halvings.
        assertEq(drops.capOf(4 * 82), 0);
        assertGt(drops.capOf(4 * 81), 0);
    }

    function testFlatModeSameCapForever() public view {
        assertEq(flat.capOf(0), 100_000e18);
        assertEq(flat.capOf(1_000), 100_000e18);
        assertEq(flat.capOf(type(uint256).max), 100_000e18);
    }

    function testReleaseUpToCapAndEmits() public {
        vm.warp(start);
        vm.expectEmit(true, true, false, true, address(drops));
        emit Released(0, player, 1_000_000e18);
        vm.prank(operator);
        drops.release(player, 1_000_000e18);
        vm.prank(operator);
        drops.release(player, 1_500_000e18); // exactly the cap
        assertEq(drops.released(0), 2_500_000e18);
        assertEq(gboot.balanceOf(player), 2_500_000e18);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EmissionVault.OverWeeklyCap.selector, 0, 2_500_000e18, 2_500_000e18 + 1));
        drops.release(player, 1);
    }

    function testZeroReleaseAllowed() public {
        vm.prank(operator);
        drops.release(player, 0);
        assertEq(drops.released(0), 0);
    }

    function testOnlyOperator() public {
        vm.expectRevert(EmissionVault.NotOperator.selector);
        drops.release(player, 1);
        vm.prank(player);
        vm.expectRevert(EmissionVault.NotOperator.selector);
        drops.release(player, 1);
    }

    /// Unused allowance does not roll over: skipping week 0 still leaves only week 1's cap.
    function testNoRollover() public {
        vm.warp(start + 1 weeks);
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(EmissionVault.OverWeeklyCap.selector, 1, 2_500_000e18, 5_000_000e18));
        drops.release(player, 5_000_000e18);
        drops.release(player, 2_500_000e18);
        vm.stopPrank();
    }

    /// Releases made before `start` count against week 0 (they share its allowance).
    function testPreStartSharesWeekZero() public {
        vm.prank(operator);
        drops.release(player, 2_000_000e18);
        vm.warp(start + 1 hours);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(EmissionVault.OverWeeklyCap.selector, 0, 2_500_000e18, 3_000_000e18));
        drops.release(player, 1_000_000e18);
    }

    function testReleaseAcrossHalvings() public {
        uint256[4] memory weeks_ = [uint256(3), 4, 8, 40];
        uint256[4] memory caps = [uint256(2_500_000e18), 1_250_000e18, 625_000e18, 2_500_000e18 >> 10];
        for (uint256 i; i < 4; ++i) {
            vm.warp(start + weeks_[i] * 1 weeks);
            vm.startPrank(operator);
            vm.expectRevert(abi.encodeWithSelector(EmissionVault.OverWeeklyCap.selector, weeks_[i], caps[i], caps[i] + 1));
            drops.release(player, caps[i] + 1);
            drops.release(player, caps[i]);
            vm.stopPrank();
            assertEq(drops.released(weeks_[i]), caps[i]);
        }
    }

    /// When the vault runs dry the transfer reverts even under the cap.
    function testCannotReleaseMoreThanHeld() public {
        EmissionVault small = new EmissionVault(IERC20(address(gboot)), operator, start, 1_000e18, 0);
        gboot.transfer(address(small), 10e18);
        vm.prank(operator);
        vm.expectRevert();
        small.release(player, 11e18);
    }

    function testFlatReleaseEveryWeek() public {
        for (uint256 w; w < 10; ++w) {
            vm.warp(start + w * 1 weeks);
            vm.prank(operator);
            flat.release(player, 100_000e18);
        }
        assertEq(gboot.balanceOf(player), 1_000_000e18);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzzCapNeverIncreases(uint256 w1, uint256 w2, uint256 cap, uint256 halvingWeeks) public {
        cap = bound(cap, 0, 1e30);
        halvingWeeks = bound(halvingWeeks, 0, 520);
        w2 = bound(w2, 0, type(uint256).max);
        w1 = bound(w1, 0, w2);
        EmissionVault v = new EmissionVault(IERC20(address(gboot)), operator, start, cap, halvingWeeks);
        assertLe(v.capOf(w2), v.capOf(w1));
        assertLe(v.capOf(w1), cap);
    }

    function testFuzzWeeklyTotalBounded(uint256[6] memory amounts, uint256[6] memory offsets) public {
        vm.warp(start + 5 weeks); // week 5: cap 1.25M
        uint256 total;
        for (uint256 i; i < 6; ++i) {
            vm.warp(start + 5 weeks + bound(offsets[i], 0, 1 weeks - 1));
            uint256 amount = bound(amounts[i], 0, 2_000_000e18);
            vm.prank(operator);
            if (total + amount > 1_250_000e18) {
                vm.expectRevert(abi.encodeWithSelector(EmissionVault.OverWeeklyCap.selector, 5, 1_250_000e18, total + amount));
                drops.release(player, amount);
            } else {
                drops.release(player, amount);
                total += amount;
            }
        }
        assertEq(drops.released(5), total);
        assertLe(total, drops.capOf(5));
    }
}
