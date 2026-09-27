// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { GBoot } from "../src/GBoot.sol";
import { KitShop, IGBoot } from "../src/KitShop.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";
import { FixedPriceFeed } from "./Mocks.sol";
import { LiquidityLock, IPositionManager } from "../src/LiquidityLock.sol";

contract MockPositionManager {
    mapping(uint256 => address) public ownerOf;
    bytes public lastUnlockData;
    address public lastCaller;

    function mint(address to, uint256 tokenId) external { ownerOf[tokenId] = to; }
    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        lastUnlockData = unlockData; lastCaller = msg.sender;
    }
    function transferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from && msg.sender == from, "not owner");
        ownerOf[tokenId] = to;
    }
}

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
}

contract LiquidityLockTest is Test {
    MockPositionManager internal pm;
    LiquidityLock internal lock;
    address internal beneficiary = address(0xB0B);
    uint256 internal unlockAt;

    function setUp() public {
        pm = new MockPositionManager();
        unlockAt = block.timestamp + 180 days;
        lock = new LiquidityLock(IPositionManager(address(pm)), beneficiary, unlockAt);
        pm.mint(address(lock), 42);
    }

    function testEarlyWithdrawReverts() public {
        vm.prank(beneficiary);
        vm.expectRevert(LiquidityLock.Locked.selector);
        lock.withdraw(42);
        vm.warp(unlockAt - 1);
        vm.prank(beneficiary);
        vm.expectRevert(LiquidityLock.Locked.selector);
        lock.withdraw(42);
    }

    function testOnlyBeneficiary() public {
        vm.warp(unlockAt);
        vm.expectRevert(LiquidityLock.NotBeneficiary.selector);
        lock.withdraw(42);
    }

    function testWithdrawAfterUnlock() public {
        vm.warp(unlockAt);
        vm.prank(beneficiary);
        lock.withdraw(42);
        assertEq(pm.ownerOf(42), beneficiary);
    }

    function testCollectBurnsBothSidesAndIsPermissionless() public {
        GBoot c0 = new GBoot();
        GBoot c1 = new GBoot();
        // Simulated fees taken to the lock (the mock PositionManager does not move tokens).
        c0.transfer(address(lock), 7e18); c1.transfer(address(lock), 3e18);
        uint256 supply0 = c0.totalSupply();
        uint256 supply1 = c1.totalSupply();
        vm.prank(address(0xBEEF)); // anyone
        lock.collectAndBurn(42, address(c0), address(c1));
        (bytes memory actions, bytes[] memory params) = abi.decode(pm.lastUnlockData(), (bytes, bytes[]));
        assertEq(actions, hex"0111");
        (uint256 tokenId, uint256 liquidity,,,) = abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        assertEq(tokenId, 42); assertEq(liquidity, 0);
        (address a0, address a1, address to) = abi.decode(params[1], (address, address, address));
        assertEq(a0, address(c0)); assertEq(a1, address(c1)); assertEq(to, address(lock), "fees come to the lock, never to the caller");
        assertEq(c0.totalSupply(), supply0 - 7e18, "currency0 fees burned");
        assertEq(c1.totalSupply(), supply1 - 3e18, "currency1 fees burned");
        assertEq(pm.ownerOf(42), address(lock), "position stays locked");
    }

    function testReceivesNft() public view {
        assertEq(lock.onERC721Received(address(0), address(0), 1, ""), LiquidityLock.onERC721Received.selector);
    }
}
