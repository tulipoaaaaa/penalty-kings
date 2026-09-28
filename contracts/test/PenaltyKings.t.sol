// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { GBoot } from "../src/GBoot.sol";
import { KitShop, IGBoot } from "../src/KitShop.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";
import { FixedPriceFeed, FalseReturnToken } from "./Mocks.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { GBootFixedPrice } from "../src/GBootFixedPrice.sol";

contract GBootTest is Test {
    GBoot internal token;
    function setUp() public { token = new GBoot(); }

    function testFixedSupplyToDeployer() public view {
        assertEq(token.totalSupply(), 100_000_000e18);
        assertEq(token.balanceOf(address(this)), 100_000_000e18);
        assertEq(token.symbol(), "GBOOT");
        assertEq(token.decimals(), 18);
    }

    function testBurnReducesSupply() public {
        token.burn(1e18);
        assertEq(token.totalSupply(), 100_000_000e18 - 1e18);
    }
}

contract KitShopTest is Test {
    GBoot internal token;
    KitShop internal shop;
    FixedPriceFeed internal feed;
    address internal player = address(0xBEEF);

    function setUp() public {
        token = new GBoot();
        feed = new FixedPriceFeed();
        uint256[] memory pricesRf = new uint256[](3);
        pricesRf[0] = 0; pricesRf[1] = 6e18; pricesRf[2] = 40e18; // RF: 60 / 400 $GBOOT at 0.1 RF
        shop = new KitShop(IGBoot(address(token)), IGBootPriceFeed(address(feed)), block.timestamp, pricesRf);
        token.transfer(player, 1000e18);
    }

    function testBuyBurnsAndUnlocks() public {
        vm.startPrank(player);
        token.approve(address(shop), 60e18);
        shop.buy(7730, 1, 60e18);
        vm.stopPrank();
        assertTrue(shop.unlocked(7730, 1));
        assertEq(token.balanceOf(player), 940e18);
        assertEq(token.totalSupply(), 100_000_000e18 - 60e18);
        assertEq(token.balanceOf(address(shop)), 0);
        assertEq(shop.burnedInWeek(0), 60e18, "sink ledger");
    }

    function testFreeItem() public {
        vm.prank(player); shop.buy(1, 0, 0);
        assertTrue(shop.unlocked(1, 0));
    }

    function testRejectsUnknownAndRepeat() public {
        vm.startPrank(player);
        token.approve(address(shop), type(uint256).max);
        vm.expectRevert(KitShop.UnknownItem.selector); shop.buy(1, 3, type(uint256).max);
        shop.buy(1, 2, type(uint256).max);
        vm.expectRevert(KitShop.AlreadyUnlocked.selector); shop.buy(1, 2, type(uint256).max);
        vm.stopPrank();
    }

    /// Prices are in RF: the $GBOOT cost follows the TWAP (rounded up) and maxGbootIn bounds it.
    function testRfPricedAtTwapWithSlippage() public {
        vm.startPrank(player);
        token.approve(address(shop), type(uint256).max);
        feed.setPrice(0.3e18); // 6 RF → 20 $GBOOT
        assertEq(shop.quote(1), 20e18);
        vm.expectRevert(abi.encodeWithSelector(KitShop.Slippage.selector, 20e18, 19e18));
        shop.buy(7730, 1, 19e18);
        shop.buy(7730, 1, 20e18);
        feed.setPrice(3e17 + 1); // rounds up: 6e18 × 1e18 / (3e17 + 1) is not whole
        assertEq(shop.quote(2), 133_333_333_333_333_332_889, "40e18 x 1e18 / (3e17 + 1), rounded up");
        vm.stopPrank();
        assertEq(token.balanceOf(player), 980e18);
    }

    /// A $GBOOT whose transferFrom returns false instead of reverting must not unlock for free
    /// (SafeERC20).
    function testFalseReturningTokenReverts() public {
        FalseReturnToken bad = new FalseReturnToken();
        uint256[] memory pricesRf = new uint256[](1);
        pricesRf[0] = 6e18;
        KitShop badShop = new KitShop(IGBoot(address(bad)), IGBootPriceFeed(address(feed)), block.timestamp, pricesRf);
        bad.mint(player, 1_000e18);
        bad.setFail(false, true);
        vm.startPrank(player);
        bad.approve(address(badShop), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        badShop.buy(7730, 0, type(uint256).max);
        vm.stopPrank();
        assertFalse(badShop.unlocked(7730, 0));
        assertEq(bad.balanceOf(player), 1_000e18);
    }
}

/// The launch default's price source (plain pool, no TWAP): fixed 0.1 RF per $GBOOT.
contract GBootFixedPriceTest is Test {
    function testFixedLaunchPrices() public {
        GBootFixedPrice feed = new GBootFixedPrice();
        assertEq(feed.gbootForRf(10e18, true), 100e18, "Skill Cup entry / Wildcard: 10 RF = 100 GBOOT");
        assertEq(feed.gbootForRf(6e17, true), 6e18, "kit listed at 6 GBOOT");
        assertEq(feed.gbootForRf(2e18, false), 20e18, "per-entry reward cap: 2 RF = 20 GBOOT");
        assertEq(feed.gbootForRf(0, true), 0);
    }

    function testFuzzExactConversion(uint256 rf) public {
        GBootFixedPrice feed = new GBootFixedPrice();
        rf = bound(rf, 0, 1e40);
        assertEq(feed.gbootForRf(rf, true), rf * 10, "exact: 1 RF wei = 10 GBOOT wei, no rounding");
        assertEq(feed.gbootForRf(rf, false), rf * 10);
    }
}
