// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { GBoot } from "../src/GBoot.sol";
import { SkillCup, ISkillGenerations, ISkillToken } from "../src/SkillCup.sol";
import { Wildcards, IWildcardGenerations, IWildcardToken, IWildcardEntropy } from "../src/Wildcards.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";
import { FixedPriceFeed } from "./Mocks.sol";

contract MockGenerations {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint8) public generation;
    function set(uint256 id, address owner, uint8 gen) external { ownerOf[id] = owner; generation[id] = gen; }
}

contract MockEntropy {
    uint128 public constant FEE = 25_000_000_000_000;
    uint64 public next = 1;
    function getFeeV2(address, uint32) external pure returns (uint128) { return FEE; }
    function requestV2(address, bytes32, uint32) external payable returns (uint64) { require(msg.value == FEE); return next++; }
    function fulfil(Wildcards target, uint64 sequence, address provider, bytes32 word) external { target._entropyCallback(sequence, provider, word); }
}

contract SkillCupTest is Test {
    GBoot internal token;
    MockGenerations internal gens;
    SkillCup internal cup;
    FixedPriceFeed internal feed;
    address internal player = address(0xA11CE);
    address internal pot = address(0x9097);

    function setUp() public {
        token = new GBoot();
        gens = new MockGenerations();
        feed = new FixedPriceFeed();
        cup = new SkillCup(ISkillGenerations(address(gens)), ISkillToken(address(token)), IGBootPriceFeed(address(feed)), pot, block.timestamp);
        gens.set(7730, player, 3);
        gens.set(1, player, 0);
        gens.set(2, player, 6);
        token.transfer(player, 100_000e18);
        vm.prank(player); token.approve(address(cup), type(uint256).max);
    }

    function testEntryBurnsHalfPaysPot() public {
        vm.prank(player);
        uint256 id = cup.enter(7730, 100e18);
        assertEq(id, 1);
        assertEq(token.balanceOf(pot), 50e18);
        assertEq(token.totalSupply(), 100_000_000e18 - 50e18);
        assertEq(token.balanceOf(address(cup)), 0);
        assertEq(cup.entryFriend(1), 7730, "entry recorded for the rewards check");
        assertEq(cup.burnedInWeek(0), 50e18, "sink ledger, 0-based week");
    }

    /// RF-priced: ENTRY_RF = 10 RF is 100 $GBOOT at 0.1 RF, 50 at 0.2 RF, 1,000 at 0.01 RF (TWAP).
    function testEntryPricedInRfAtTheTwap() public {
        assertEq(cup.quote(), 100e18);
        feed.setPrice(0.2e18);
        assertEq(cup.quote(), 50e18);
        vm.prank(player);
        cup.enter(7730, 50e18);
        assertEq(token.balanceOf(pot), 25e18);
        feed.setPrice(0.01e18);
        assertEq(cup.quote(), 1_000e18);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(player);
        cup.enter(7730, 1_000e18);
        assertEq(cup.burnedInWeek(0), 25e18 + 500e18);
    }

    function testSlippageBound() public {
        feed.setPrice(0.05e18); // 200 $GBOOT
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(SkillCup.Slippage.selector, 200e18, 199e18));
        cup.enter(7730, 199e18);
    }

    /// Odd costs: the burn rounds down, the pot gets the extra wei; the split always sums to the cost.
    function testFuzzSplitConserves(uint256 price) public {
        price = bound(price, 1e12, 1e24);
        feed.setPrice(price);
        uint256 cost = cup.quote();
        vm.assume(cost <= 100_000e18);
        uint256 supply = token.totalSupply();
        vm.prank(player);
        cup.enter(7730, cost);
        uint256 burned = supply - token.totalSupply();
        assertEq(burned, cost / 2);
        assertEq(token.balanceOf(pot), cost - cost / 2);
    }

    function testCheapGenerationsRejected() public {
        vm.prank(player);
        vm.expectRevert(SkillCup.GenerationTooLow.selector);
        cup.enter(2, type(uint256).max);
    }

    function testOwnershipAndHardwiredEnforced() public {
        vm.expectRevert(SkillCup.NotFriendOwner.selector);
        cup.enter(7730, type(uint256).max);
        vm.prank(player);
        vm.expectRevert(SkillCup.NotHardwired.selector);
        cup.enter(1, type(uint256).max);
    }

    function testCooldownAndWeeklyLimit() public {
        vm.startPrank(player);
        cup.enter(7730, type(uint256).max);
        vm.expectRevert(SkillCup.Cooldown.selector);
        cup.enter(7730, type(uint256).max);
        for (uint256 i = 1; i < 20; ++i) { vm.warp(block.timestamp + 1 hours); cup.enter(7730, type(uint256).max); }
        vm.warp(block.timestamp + 1 hours);
        if (cup.week() == 1) { vm.expectRevert(SkillCup.WeeklyLimit.selector); cup.enter(7730, type(uint256).max); }
        vm.warp(cup.start() + 1 weeks);
        cup.enter(7730, type(uint256).max);
        assertEq(cup.weeklyEntries(2, 7730), 1);
        vm.stopPrank();
    }
}

contract WildcardsTest is Test {
    GBoot internal token;
    MockGenerations internal gens;
    MockEntropy internal dice;
    Wildcards internal wild;
    FixedPriceFeed internal feed;
    address internal player = address(0xA11CE);
    address internal provider = address(0xD1CE);
    address internal pot = address(0x9097);

    function setUp() public {
        token = new GBoot();
        gens = new MockGenerations();
        dice = new MockEntropy();
        feed = new FixedPriceFeed();
        wild = new Wildcards(
            IWildcardGenerations(address(gens)), IWildcardToken(address(token)), IGBootPriceFeed(address(feed)), IWildcardEntropy(address(dice)), provider, pot, block.timestamp
        );
        gens.set(7730, player, 3);
        token.transfer(player, 10_000e18);
        vm.deal(player, 1 ether);
        vm.prank(player); token.approve(address(wild), type(uint256).max);
    }

    function testDrawPaysAndResolvesWithDice() public {
        uint256 fee = dice.FEE();
        vm.prank(player);
        uint256 id = wild.draw{ value: fee }(7730, type(uint256).max);
        assertEq(token.balanceOf(pot), 50e18);
        assertEq(token.totalSupply(), 100_000_000e18 - 50e18);
        dice.fulfil(wild, 1, provider, bytes32(uint256(99))); // roll 99 → Golden Boot
        (uint256 friendId, uint8 points, bool fulfilled) = wild.drawOf(id);
        assertEq(friendId, 7730); assertEq(points, 2); assertTrue(fulfilled);
        assertEq(wild.burnedInWeek(0), 50e18);
    }

    /// PRICE_RF = 10 RF at the TWAP; maxGbootIn bounds it.
    function testDrawPricedInRfWithSlippage() public {
        uint256 fee = dice.FEE();
        feed.setPrice(0.4e18);
        assertEq(wild.quote(), 25e18);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(Wildcards.Slippage.selector, 25e18, 24e18));
        wild.draw{ value: fee }(7730, 24e18);
        vm.prank(player);
        wild.draw{ value: fee }(7730, 25e18);
        assertEq(token.balanceOf(pot), 12.5e18);
        vm.warp(block.timestamp + 1 weeks);
        vm.prank(player);
        wild.draw{ value: fee }(7730, 25e18);
        assertEq(wild.burnedInWeek(1), 12.5e18, "ledger keyed by 0-based week");
    }

    function testOverpaymentRefunded() public {
        uint256 fee = dice.FEE();
        uint256 before = player.balance;
        vm.prank(player);
        wild.draw{ value: fee + 1 ether / 100 }(7730, type(uint256).max);
        assertEq(player.balance, before - fee, "only the exact oracle fee is kept");
        assertEq(address(wild).balance, 0);
    }

    /// The Dice callback must have exactly the SDK ChanceGame's signature.
    function testCallbackSelectorMatchesChanceGame() public pure {
        assertEq(Wildcards._entropyCallback.selector, bytes4(keccak256("_entropyCallback(uint64,address,bytes32)")));
    }

    function testOutcomeBoundaries() public {
        uint256 fee = dice.FEE();
        vm.startPrank(player);
        for (uint256 i; i < 3; ++i) wild.draw{ value: fee }(7730, type(uint256).max);
        vm.stopPrank();
        dice.fulfil(wild, 1, provider, bytes32(uint256(100)));   // Gold
        dice.fulfil(wild, 2, provider, bytes32(uint256(349)));   // Gold
        dice.fulfil(wild, 3, provider, bytes32(uint256(350)));   // nothing
        (, uint8 a,) = wild.drawOf(1); (, uint8 b,) = wild.drawOf(2); (, uint8 c,) = wild.drawOf(3);
        assertEq(a, 1); assertEq(b, 1); assertEq(c, 0);
    }

    function testRejectsWrongFeeForeignCallbackAndReplay() public {
        uint256 fee = dice.FEE();
        vm.prank(player);
        vm.expectRevert(Wildcards.IncorrectOracleFee.selector);
        wild.draw{ value: fee - 1 }(7730, type(uint256).max);
        vm.prank(player);
        wild.draw{ value: fee }(7730, type(uint256).max);
        vm.expectRevert(Wildcards.UnauthorizedRandomness.selector);
        wild._entropyCallback(1, provider, bytes32(0));
        dice.fulfil(wild, 1, provider, bytes32(uint256(5000)));
        vm.expectRevert(Wildcards.InvalidRandomness.selector);
        dice.fulfil(wild, 1, provider, bytes32(uint256(1)));
    }
}
