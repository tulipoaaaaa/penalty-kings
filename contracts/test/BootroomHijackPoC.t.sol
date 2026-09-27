// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { Bootroom, IBootroomGenerations } from "../src/Bootroom.sol";
import { FriendsAirdrop, IBootroomLace } from "../src/FriendsAirdrop.sol";
import { BootroomMockGenerations } from "./Bootroom.t.sol";

/// BQ-P1-12, the Bootroom lock hijack. Before the fix any third party could START a Friend's lock
/// with 1 wei (a lace on an empty Friend took the stranger's weeks), and every later lace, the
/// airdrop's pre-lace and the owner's own, silently joined it:
///   a) 1 wei for 52 weeks, then the airdrop claim: the airdrop was locked 52 weeks;
///   b) 1 wei for 1 week: the airdrop's 12-week pre-lace became 1 week (and a lower perk tier);
///   c) a front-run 1 wei for 52 weeks before the owner's lace(id, 10_000e18, 4): the owner's
///      tokens were locked 52 weeks.
/// All three PoCs passed against the pre-fix code (asserting the hijack). Now only the Friend
/// (owner / token-bound account) or the whitelisted FriendsAirdrop starts a lock, strangers only top
/// up a live lock without moving it, and lace() takes a `maxUnlockAt` bound.
contract BootroomHijackPoCTest is Test {
    GBoot internal gboot;
    BootroomMockGenerations internal gens;
    Bootroom internal room;
    FriendsAirdrop internal drop;
    address internal owner = address(0xA11CE);
    address internal tba = address(0x7BA);
    address internal attacker = address(0xBAD);
    address internal setter = address(0x5E7);
    uint256 internal constant FRIEND = 7730;
    uint256 internal constant DROP = 10_000e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        gboot = new GBoot();
        gens = new BootroomMockGenerations();
        room = new Bootroom(IERC20(address(gboot)), IBootroomGenerations(address(gens)), vm.computeCreateAddress(setter, vm.getNonce(setter)));
        vm.prank(setter);
        drop = new FriendsAirdrop(IERC20(address(gboot)), IBootroomLace(address(room)), address(0xC0F5));
        assertEq(room.airdrop(), address(drop));
        gboot.transfer(address(drop), DROP);
        gens.set(FRIEND, owner, tba);
        gboot.transfer(owner, 1_000_000e18);
        gboot.transfer(attacker, 1_000_000e18);
        vm.prank(owner);
        gboot.approve(address(room), type(uint256).max);
        vm.prank(attacker);
        gboot.approve(address(room), type(uint256).max);
        vm.prank(setter);
        drop.setRoot(keccak256(bytes.concat(keccak256(abi.encode(FRIEND, DROP)))));
    }

    function _claim() internal {
        drop.claim(FRIEND, DROP, new bytes32[](0));
    }

    /// Attacker lace that may revert; returns whether it went through.
    function _attack(uint256 amount, uint256 lockWeeks) internal returns (bool ok) {
        vm.prank(attacker);
        (ok,) = address(room).call(abi.encodeCall(room.lace, (FRIEND, amount, lockWeeks, type(uint256).max)));
    }

    // ------------------------------------------------------------------ PoCs

    function testPoC_a_dust52WeeksBeforeClaimReverts() public {
        vm.prank(attacker);
        vm.expectRevert(Bootroom.NoLiveLock.selector);
        room.lace(FRIEND, 1, 52, type(uint256).max);
        vm.prank(owner);
        _claim();
        (uint128 amount, uint64 unlockAt, uint64 w) = room.laces(FRIEND);
        assertEq(amount, DROP);
        assertEq(unlockAt, block.timestamp + 12 weeks, "airdrop locked 12 weeks, not 52");
        assertEq(w, 12);
    }

    function testPoC_b_dust1WeekBeforeClaimReverts() public {
        vm.prank(attacker);
        vm.expectRevert(Bootroom.NoLiveLock.selector);
        room.lace(FRIEND, 1, 1, type(uint256).max);
        _claim();
        (, uint64 unlockAt, uint64 w) = room.laces(FRIEND);
        assertEq(unlockAt, block.timestamp + 12 weeks, "pre-lace keeps 12 weeks");
        assertEq(w, 12);
        assertEq(room.perkTier(FRIEND), 3, "10k for 12 weeks: tier 3");
    }

    function testPoC_c_frontRunBeforeOwnerLaceReverts() public {
        vm.prank(attacker);
        vm.expectRevert(Bootroom.NoLiveLock.selector);
        room.lace(FRIEND, 1, 52, type(uint256).max);
        vm.prank(owner);
        room.lace(FRIEND, 10_000e18, 4, block.timestamp + 4 weeks);
        (, uint64 unlockAt, uint64 w) = room.laces(FRIEND);
        assertEq(unlockAt, block.timestamp + 4 weeks, "owner's tokens locked 4 weeks, not 52");
        assertEq(w, 4);
    }

    /// Even with a longer live lock in place (the owner's own), the owner's bounded lace reverts
    /// instead of silently joining it.
    function testPoC_c_ownerBoundRevertsOnLongerLiveLock() public {
        vm.prank(owner);
        room.lace(FRIEND, 1, 52, type(uint256).max);
        vm.prank(owner);
        vm.expectRevert(Bootroom.LockTooLong.selector);
        room.lace(FRIEND, 10_000e18, 4, block.timestamp + 4 weeks);
    }

    // ------------------------------------------------------------------ fuzz

    /// Random attacker laces (amounts, weeks, timing) against the owner's live lock: the lock end and
    /// weeks never move; the amount only grows by what the attacker gave.
    function testFuzzThirdPartyNeverExtendsOwnersLock(
        uint256 ownerAmount, uint256 ownerWeeks, uint256[6] memory amounts, uint256[6] memory ws, uint256[6] memory gaps
    ) public {
        ownerAmount = bound(ownerAmount, 1, 100_000e18);
        ownerWeeks = bound(ownerWeeks, 1, 52);
        vm.prank(owner);
        room.lace(FRIEND, ownerAmount, ownerWeeks, block.timestamp + ownerWeeks * 1 weeks);
        (, uint64 unlockAt0, uint64 weeks0) = room.laces(FRIEND);
        assertEq(unlockAt0, block.timestamp + ownerWeeks * 1 weeks);
        uint256 total = ownerAmount;
        for (uint256 i; i < 6; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 20 weeks));
            uint256 a = bound(amounts[i], 0, 10_000e18);
            uint256 w = bound(ws[i], 0, 60);
            bool live = block.timestamp < unlockAt0;
            bool ok = _attack(a, w);
            assertEq(ok, live && a > 0 && w >= 1 && w <= 52, "a third party only tops up a live lock");
            if (ok) total += a;
            (uint128 amount, uint64 unlockAt, uint64 lockWeeks) = room.laces(FRIEND);
            assertEq(unlockAt, unlockAt0, "unlock never moved by a third party");
            assertEq(lockWeeks, weeks0, "weeks never changed by a third party");
            assertEq(amount, total);
        }
    }

    /// Random attacker laces before and after the claim, claimed at a random time in the window:
    /// the airdrop pre-lace always ends exactly 12 weeks after the claim, with 12 weeks.
    function testFuzzAirdropPreLaceKeeps12Weeks(
        uint256[4] memory amounts, uint256[4] memory ws, uint256[4] memory gaps, uint256 claimDelay
    ) public {
        for (uint256 i; i < 2; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 30 days));
            assertFalse(_attack(bound(amounts[i], 1, 10_000e18), bound(ws[i], 1, 52)), "cannot start a lock");
        }
        vm.warp(block.timestamp + bound(claimDelay, 0, 100 days));
        uint256 claimedAt = block.timestamp;
        _claim();
        uint256 total = DROP;
        for (uint256 i = 2; i < 4; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 6 weeks));
            uint256 a = bound(amounts[i], 1, 10_000e18);
            if (_attack(a, bound(ws[i], 1, 52))) total += a;
            (uint128 amount, uint64 unlockAt, uint64 w) = room.laces(FRIEND);
            assertEq(unlockAt, claimedAt + 12 weeks, "pre-lace keeps its 12 weeks");
            assertEq(w, 12);
            assertEq(amount, total);
        }
    }

    /// Whatever an attacker does first, the owner's bounded lace never ends after the owner's bound:
    /// it either locks exactly the weeks asked or reverts.
    function testFuzzOwnerLaceNeverSilentlyLonger(uint256 atkAmount, uint256 atkWeeks, uint256 gap, uint256 ownerWeeks, bool viaTba) public {
        _attack(bound(atkAmount, 1, 10_000e18), bound(atkWeeks, 1, 52));
        vm.warp(block.timestamp + bound(gap, 0, 10 weeks));
        ownerWeeks = bound(ownerWeeks, 1, 52);
        address who = viaTba ? tba : owner;
        if (viaTba) {
            gboot.transfer(tba, 10_000e18);
            vm.prank(tba);
            gboot.approve(address(room), type(uint256).max);
        }
        uint256 bound_ = block.timestamp + ownerWeeks * 1 weeks;
        vm.prank(who);
        room.lace(FRIEND, 10_000e18, ownerWeeks, bound_); // never reverts: nobody else started a lock
        (, uint64 unlockAt, uint64 w) = room.laces(FRIEND);
        assertEq(unlockAt, bound_);
        assertEq(w, ownerWeeks);
    }
}
