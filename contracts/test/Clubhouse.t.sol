// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { GBoot } from "../src/GBoot.sol";
import { SkillCup, ISkillGenerations, ISkillToken } from "../src/SkillCup.sol";
import { Wildcards, IWildcardGenerations, IWildcardToken, IWildcardEntropy } from "../src/Wildcards.sol";

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
    address internal player = address(0xA11CE);
    address internal pot = address(0x9097);

    function setUp() public {
        token = new GBoot();
        gens = new MockGenerations();
        cup = new SkillCup(ISkillGenerations(address(gens)), ISkillToken(address(token)), pot, block.timestamp);
        gens.set(7730, player, 3);
        gens.set(1, player, 0);
        gens.set(2, player, 6);
        token.transfer(player, 100_000e18);
        vm.prank(player); token.approve(address(cup), type(uint256).max);
    }

    function testEntryBurnsHalfPaysPot() public {
        vm.prank(player);
        uint256 id = cup.enter(7730);
        assertEq(id, 1);
        assertEq(token.balanceOf(pot), 50e18);
        assertEq(token.totalSupply(), 100_000_000e18 - 50e18);
        assertEq(token.balanceOf(address(cup)), 0);
    }

    function testCheapGenerationsRejected() public {
        vm.prank(player);
        vm.expectRevert(SkillCup.GenerationTooLow.selector);
        cup.enter(2);
    }

    function testOwnershipAndHardwiredEnforced() public {
        vm.expectRevert(SkillCup.NotFriendOwner.selector);
        cup.enter(7730);
        vm.prank(player);
        vm.expectRevert(SkillCup.NotHardwired.selector);
        cup.enter(1);
    }

    function testCooldownAndWeeklyLimit() public {
        vm.startPrank(player);
        cup.enter(7730);
        vm.expectRevert(SkillCup.Cooldown.selector);
        cup.enter(7730);
        for (uint256 i = 1; i < 20; ++i) { vm.warp(block.timestamp + 1 hours); cup.enter(7730); }
        vm.warp(block.timestamp + 1 hours);
        if (cup.week() == 1) { vm.expectRevert(SkillCup.WeeklyLimit.selector); cup.enter(7730); }
        vm.warp(cup.start() + 1 weeks);
        cup.enter(7730);
        assertEq(cup.weeklyEntries(2, 7730), 1);
        vm.stopPrank();
    }
}

contract WildcardsTest is Test {
    GBoot internal token;
    MockGenerations internal gens;
    MockEntropy internal dice;
    Wildcards internal wild;
    address internal player = address(0xA11CE);
    address internal provider = address(0xD1CE);
    address internal pot = address(0x9097);

    function setUp() public {
        token = new GBoot();
        gens = new MockGenerations();
        dice = new MockEntropy();
        wild = new Wildcards(IWildcardGenerations(address(gens)), IWildcardToken(address(token)), IWildcardEntropy(address(dice)), provider, pot);
        gens.set(7730, player, 3);
        token.transfer(player, 10_000e18);
        vm.deal(player, 1 ether);
        vm.prank(player); token.approve(address(wild), type(uint256).max);
    }

    function testDrawPaysAndResolvesWithDice() public {
        uint256 fee = dice.FEE();
        vm.prank(player);
        uint256 id = wild.draw{ value: fee }(7730);
        assertEq(token.balanceOf(pot), 50e18);
        assertEq(token.totalSupply(), 100_000_000e18 - 50e18);
        dice.fulfil(wild, 1, provider, bytes32(uint256(99))); // roll 99 → Golden Boot
        (uint256 friendId, uint8 points, bool fulfilled) = wild.drawOf(id);
        assertEq(friendId, 7730); assertEq(points, 2); assertTrue(fulfilled);
    }

    function testOverpaymentRefunded() public {
        uint256 fee = dice.FEE();
        uint256 before = player.balance;
        vm.prank(player);
        wild.draw{ value: fee + 1 ether / 100 }(7730);
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
        for (uint256 i; i < 3; ++i) wild.draw{ value: fee }(7730);
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
        wild.draw{ value: fee - 1 }(7730);
        vm.prank(player);
        wild.draw{ value: fee }(7730);
        vm.expectRevert(Wildcards.UnauthorizedRandomness.selector);
        wild._entropyCallback(1, provider, bytes32(0));
        dice.fulfil(wild, 1, provider, bytes32(uint256(5000)));
        vm.expectRevert(Wildcards.InvalidRandomness.selector);
        dice.fulfil(wild, 1, provider, bytes32(uint256(1)));
    }
}
