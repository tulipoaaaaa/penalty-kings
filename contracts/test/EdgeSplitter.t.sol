// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { EdgeSplitter, ISplitterSwapper } from "../src/EdgeSplitter.sol";
import { PoolKey } from "../src/interfaces/IUniswapV4.sol";

/// Burnable stand-in for RF.
contract SplitterMockRF is ERC20 {
    constructor() ERC20("Mock RF", "RF") { _mint(msg.sender, 1e30); }
    function burn(uint256 amount) external { _burn(msg.sender, amount); }
}

/// Swaps RF → GBOOT at a fixed 10 GBOOT per RF (0.1 RF/GBOOT, the launch price), honouring minOut
/// like PoolSwapper. Records the last call so the test can check direction and amounts.
contract SplitterMockSwapper is ISplitterSwapper {
    IERC20 public immutable rf;
    IERC20 public immutable gboot;
    uint256 public ratePerRf = 10;
    bool public lastZeroForOne;
    uint128 public lastAmountIn;
    uint128 public lastMinOut;
    address public lastCurrency0;
    error TooLittleReceived(uint256 received, uint256 minimum);

    constructor(IERC20 rf_, IERC20 gboot_) { rf = rf_; gboot = gboot_; }
    function setRate(uint256 r) external { ratePerRf = r; }

    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint128 amountIn, uint128 minOut) external returns (uint256 out) {
        lastZeroForOne = zeroForOne; lastAmountIn = amountIn; lastMinOut = minOut; lastCurrency0 = key.currency0;
        out = uint256(amountIn) * ratePerRf;
        if (out < minOut) revert TooLittleReceived(out, minOut);
        rf.transferFrom(msg.sender, address(this), amountIn);
        gboot.transfer(msg.sender, out);
    }
}

contract EdgeSplitterTest is Test {
    SplitterMockRF internal rf;
    GBoot internal gboot;
    SplitterMockSwapper internal swapper;
    EdgeSplitter internal splitter;
    PoolKey internal key;
    address internal cup = address(0xC0F);
    address internal operator = address(0x0FE);

    event Split(uint256 rfBurned, uint256 rfSwapped, uint256 gbootBurned, uint256 rfToCup);

    function setUp() public {
        rf = new SplitterMockRF();
        gboot = new GBoot();
        swapper = new SplitterMockSwapper(IERC20(address(rf)), IERC20(address(gboot)));
        gboot.transfer(address(swapper), 50_000_000e18);
        key = _key(address(rf), address(gboot));
        splitter = new EdgeSplitter(IERC20(address(rf)), IERC20(address(gboot)), swapper, key, cup, operator);
    }

    function _key(address a, address b) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey(c0, c1, 10_000, 200, address(0));
    }

    function testConstants() public view {
        assertEq(splitter.BURN_BPS(), 4_000);
        assertEq(splitter.BUYBACK_BPS(), 3_000);
        assertEq(splitter.cup(), cup);
        assertEq(splitter.operator(), operator);
        (address c0, address c1, uint24 fee, int24 spacing, address hooks) = splitter.key();
        assertEq(c0, key.currency0); assertEq(c1, key.currency1);
        assertEq(fee, 10_000); assertEq(spacing, 200); assertEq(hooks, address(0));
    }

    function testSplit403030() public {
        rf.transfer(address(splitter), 1_000e18);
        uint256 rfSupply = rf.totalSupply();
        uint256 gbootSupply = gboot.totalSupply();
        vm.expectEmit(false, false, false, true, address(splitter));
        emit Split(400e18, 300e18, 3_000e18, 300e18);
        vm.prank(operator);
        splitter.split(2_910e18); // quote 3,000 minus 3% slippage
        assertEq(rf.totalSupply(), rfSupply - 400e18, "40% RF burned");
        assertEq(rf.balanceOf(address(swapper)), 300e18, "30% RF swapped");
        assertEq(gboot.totalSupply(), gbootSupply - 3_000e18, "all bought GBOOT burned");
        assertEq(rf.balanceOf(cup), 300e18, "30% RF to the Cup");
        assertEq(rf.balanceOf(address(splitter)), 0);
        assertEq(gboot.balanceOf(address(splitter)), 0);
        assertEq(rf.allowance(address(splitter), address(swapper)), 0, "exact approval used up");
        assertEq(swapper.lastAmountIn(), 300e18);
        assertEq(swapper.lastMinOut(), 2_910e18);
        assertEq(swapper.lastZeroForOne(), key.currency0 == address(rf), "direction RF -> GBOOT");
    }

    /// The swap direction is RF → GBOOT whichever token sorts first.
    function testDirectionBothOrderings() public {
        // Force the other ordering by using a key where the token sort is reversed relative to RF.
        address fakeLow = address(1); // sorts below any real deployment
        PoolKey memory k = PoolKey(fakeLow, address(rf), 10_000, 200, address(0));
        EdgeSplitter s = new EdgeSplitter(IERC20(address(rf)), IERC20(address(gboot)), swapper, k, cup, operator);
        rf.transfer(address(s), 10e18);
        vm.prank(operator);
        s.split(0);
        assertFalse(swapper.lastZeroForOne(), "RF is currency1: oneForZero");
        PoolKey memory k2 = PoolKey(address(rf), address(type(uint160).max), 10_000, 200, address(0));
        EdgeSplitter s2 = new EdgeSplitter(IERC20(address(rf)), IERC20(address(gboot)), swapper, k2, cup, operator);
        rf.transfer(address(s2), 10e18);
        vm.prank(operator);
        s2.split(0);
        assertTrue(swapper.lastZeroForOne(), "RF is currency0: zeroForOne");
    }

    function testOnlyOperator() public {
        rf.transfer(address(splitter), 1e18);
        vm.expectRevert(EdgeSplitter.NotOperator.selector);
        splitter.split(0);
        vm.prank(cup);
        vm.expectRevert(EdgeSplitter.NotOperator.selector);
        splitter.split(0);
    }

    function testNothingToSplit() public {
        vm.prank(operator);
        vm.expectRevert(EdgeSplitter.NothingToSplit.selector);
        splitter.split(0);
    }

    function testSlippageGuardRevertsWholeSplit() public {
        rf.transfer(address(splitter), 1_000e18);
        swapper.setRate(9); // price moved: 2,700 out instead of 3,000
        uint256 rfSupply = rf.totalSupply();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(SplitterMockSwapper.TooLittleReceived.selector, 2_700e18, 2_910e18));
        splitter.split(2_910e18);
        assertEq(rf.totalSupply(), rfSupply, "atomic: nothing burned");
        assertEq(rf.balanceOf(address(splitter)), 1_000e18);
    }

    /// Dust: 1 wei → 0 burned, 0 swapped, 1 wei to the Cup; 9 wei → 3/2/4.
    function testRoundingDustGoesToCup() public {
        rf.transfer(address(splitter), 1);
        vm.expectEmit(false, false, false, true, address(splitter));
        emit Split(0, 0, 0, 1);
        vm.prank(operator);
        splitter.split(0);
        rf.transfer(address(splitter), 9);
        vm.expectEmit(false, false, false, true, address(splitter));
        emit Split(3, 2, 20, 4);
        vm.prank(operator);
        splitter.split(0);
        assertEq(rf.balanceOf(cup), 5);
    }

    function testFuzzSplitConservation(uint256 total, uint256 rate) public {
        total = bound(total, 1, 1_000_000e18);
        rate = bound(rate, 0, 40);
        swapper.setRate(rate);
        rf.transfer(address(splitter), total);
        uint256 rfSupply = rf.totalSupply();
        uint256 gbootSupply = gboot.totalSupply();
        vm.prank(operator);
        splitter.split(0);
        uint256 burned = rfSupply - rf.totalSupply();
        uint256 swapped = rf.balanceOf(address(swapper));
        uint256 toCup = rf.balanceOf(cup);
        assertEq(burned + swapped + toCup, total);
        assertEq(burned, total * 4_000 / 10_000);
        assertEq(swapped, total * 3_000 / 10_000);
        assertGe(toCup, swapped, "Cup share is never rounded below the buyback share");
        assertLe(toCup - total * 3_000 / 10_000, 2, "at most 2 wei of rounding dust");
        assertEq(gbootSupply - gboot.totalSupply(), swapped * rate);
        assertEq(rf.balanceOf(address(splitter)), 0);
        assertEq(gboot.balanceOf(address(splitter)), 0);
    }
}
