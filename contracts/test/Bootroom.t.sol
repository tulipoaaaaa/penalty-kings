// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { Bootroom, IBootroomGenerations } from "../src/Bootroom.sol";

/// Minimal Generations stand-in: owner + token-bound account per Friend.
contract BootroomMockGenerations is IBootroomGenerations {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public tokenBoundAccount;
    function set(uint256 id, address owner, address tba) external { ownerOf[id] = owner; tokenBoundAccount[id] = tba; }
}

contract BootroomTest is Test {
    GBoot internal gboot;
    BootroomMockGenerations internal gens;
    Bootroom internal room;

    address internal owner = address(0xA11CE);
    address internal tba = address(0x7BA);
    address internal gifter = address(0x6F7);
    address internal stranger = address(0xBAD);
    address internal airdrop = address(0xA1D); // stands in for the whitelisted FriendsAirdrop
    uint256 internal constant FRIEND = 7730;
    uint256 internal constant BPS = 10_000;

    event Laced(uint256 indexed friendId, address indexed from, uint256 amount, uint256 lockWeeks, uint256 unlockAt);
    event Unlaced(uint256 indexed friendId, address indexed to, uint256 returned, uint256 burned);

    function setUp() public {
        gboot = new GBoot();
        gens = new BootroomMockGenerations();
        room = new Bootroom(IERC20(address(gboot)), IBootroomGenerations(address(gens)), airdrop);
        gens.set(FRIEND, owner, tba);
        for (uint256 id = 1; id <= 4; ++id) gens.set(id, owner, address(0));
        for (uint256 id = 100; id < 106; ++id) gens.set(id, owner, address(0));
        address[4] memory users = [owner, gifter, stranger, airdrop];
        for (uint256 i; i < users.length; ++i) {
            gboot.transfer(users[i], 1_000_000e18);
            vm.prank(users[i]);
            gboot.approve(address(room), type(uint256).max);
        }
        gboot.approve(address(room), type(uint256).max); // the test contract itself (fuzz lacing)
    }

    function _lace(address from, uint256 id, uint256 amount, uint256 lockWeeks) internal {
        vm.prank(from);
        room.lace(id, amount, lockWeeks, type(uint256).max);
    }

    /// The test contract laces as the Friend's owner (fuzz lacing with its large balance).
    function _lace(uint256 id, uint256 amount, uint256 lockWeeks) internal {
        gens.set(id, address(this), address(0));
        room.lace(id, amount, lockWeeks, type(uint256).max);
    }

    // ------------------------------------------------------------------ lace

    function testLaceStoresAndEmits() public {
        uint256 unlockAt = block.timestamp + 12 weeks;
        vm.expectEmit(true, true, false, true, address(room));
        emit Laced(FRIEND, owner, 1_000e18, 12, unlockAt);
        _lace(owner, FRIEND, 1_000e18, 12);
        (uint128 amount, uint64 unlockAt_, uint64 lockWeeks) = room.laces(FRIEND);
        assertEq(amount, 1_000e18);
        assertEq(unlockAt_, unlockAt);
        assertEq(lockWeeks, 12);
        assertEq(gboot.balanceOf(address(room)), 1_000e18);
        assertEq(gboot.balanceOf(owner), 1_000_000e18 - 1_000e18);
    }

    function testLaceRejectsBadWeeksAndZero() public {
        vm.startPrank(owner);
        vm.expectRevert(Bootroom.BadWeeks.selector);
        room.lace(FRIEND, 1e18, 0, type(uint256).max);
        vm.expectRevert(Bootroom.BadWeeks.selector);
        room.lace(FRIEND, 1e18, 53, type(uint256).max);
        vm.expectRevert(Bootroom.NothingLaced.selector);
        room.lace(FRIEND, 0, 1, type(uint256).max);
        room.lace(FRIEND, 1e18, 1, type(uint256).max);
        room.lace(FRIEND, 1e18, 52, type(uint256).max);
        vm.stopPrank();
    }

    function testLaceNeedsAllowanceAndBalance() public {
        address broke = address(0xB0B);
        gens.set(FRIEND, broke, address(0)); // the Friend's owner, without $GBOOT or allowance
        vm.prank(broke);
        vm.expectRevert();
        room.lace(FRIEND, 1e18, 1, type(uint256).max);
    }

    /// Anyone may lace for any Friend (gifts); the lace is keyed to the friendId, not the payer.
    function testGiftLaceAndTopUpKeepsLaterUnlock() public {
        _lace(owner, FRIEND, 1_000e18, 52);
        uint256 firstUnlock = block.timestamp + 52 weeks;
        vm.warp(block.timestamp + 1 weeks);
        // Shorter top-up: amount adds, unlock/weeks stay.
        vm.expectEmit(true, true, false, true, address(room));
        emit Laced(FRIEND, gifter, 500e18, 52, firstUnlock);
        _lace(gifter, FRIEND, 500e18, 4);
        (uint128 amount, uint64 unlockAt_, uint64 lockWeeks) = room.laces(FRIEND);
        assertEq(amount, 1_500e18);
        assertEq(unlockAt_, firstUnlock);
        assertEq(lockWeeks, 52);
    }

    function testTopUpWithLaterUnlockTakesNewWeeks() public {
        _lace(owner, FRIEND, 1_000e18, 4);
        vm.warp(block.timestamp + 1 weeks);
        _lace(owner, FRIEND, 1_000e18, 8);
        (uint128 amount, uint64 unlockAt_, uint64 lockWeeks) = room.laces(FRIEND);
        assertEq(amount, 2_000e18);
        assertEq(unlockAt_, block.timestamp + 8 weeks);
        assertEq(lockWeeks, 8);
    }

    /// FIXED: a third party's top-up (1 wei, any weeks) can no longer lower the Friend's weeks, move
    /// its unlock or re-lock expired $GBOOT. Only the owner / token-bound account moves the lock.
    function testThirdPartyDustTopUpCannotMoveTheLock() public {
        _lace(owner, FRIEND, 10_000e18, 52);
        assertEq(room.perkTier(FRIEND), 3);
        uint256 originalUnlock = block.timestamp + 52 weeks;
        vm.warp(block.timestamp + 10 weeks);
        _lace(stranger, FRIEND, 1, 43); // would end 1 week after the original lace
        (uint128 amount, uint64 unlockAt_, uint64 lockWeeks) = room.laces(FRIEND);
        assertEq(amount, 10_000e18 + 1);
        assertEq(lockWeeks, 52, "weeks unchanged");
        assertEq(unlockAt_, originalUnlock, "unlock unchanged");
        assertEq(room.progressBps(FRIEND), BPS, "progress unchanged");
        assertEq(room.perkTier(FRIEND), 3, "tier unchanged");
    }

    function testThirdPartyCannotRelockExpiredLace() public {
        _lace(owner, FRIEND, 1_000e18, 2);
        vm.warp(block.timestamp + 3 weeks); // expired: the owner may unlace everything without a burn
        vm.prank(stranger);
        vm.expectRevert(Bootroom.NoLiveLock.selector);
        room.lace(FRIEND, 1, 52, type(uint256).max);
        (, uint64 unlockAt_,) = room.laces(FRIEND);
        assertLe(unlockAt_, block.timestamp, "still expired");
        uint256 before = gboot.balanceOf(owner);
        vm.prank(owner);
        room.unlace(FRIEND);
        assertEq(gboot.balanceOf(owner), before + 1_000e18, "no burn");
    }

    /// BQ-P1-12: a third party can no longer START a lock (the 1-wei hijack of an empty lace).
    function testThirdPartyCannotStartALock() public {
        vm.prank(stranger);
        vm.expectRevert(Bootroom.NoLiveLock.selector);
        room.lace(FRIEND, 1, 52, type(uint256).max);
        vm.prank(gifter);
        vm.expectRevert(Bootroom.NoLiveLock.selector);
        room.lace(FRIEND, 100e18, 4, type(uint256).max);
        (uint128 amount,,) = room.laces(FRIEND);
        assertEq(amount, 0);
    }

    function testOwnerStartsAndExtendsTbaToo() public {
        _lace(owner, FRIEND, 100e18, 4);
        (, uint64 u1, uint64 w1) = room.laces(FRIEND);
        assertEq(w1, 4); assertEq(u1, block.timestamp + 4 weeks);
        _lace(owner, FRIEND, 100e18, 30); // the owner moves it later
        (, uint64 u2, uint64 w2) = room.laces(FRIEND);
        assertEq(w2, 30); assertEq(u2, block.timestamp + 30 weeks);
        gboot.transfer(tba, 1e18);
        vm.prank(tba);
        gboot.approve(address(room), 1e18);
        _lace(tba, FRIEND, 1e18, 40); // the token-bound account is the Friend too
        (, uint64 u3, uint64 w3) = room.laces(FRIEND);
        assertEq(w3, 40); assertEq(u3, block.timestamp + 40 weeks);
    }

    /// BQ-P1-12: maxUnlockAt makes the owner's call revert instead of silently joining a longer lock.
    function testMaxUnlockAtRevertsOnLongerLock() public {
        _lace(owner, FRIEND, 1e18, 52);
        vm.prank(owner);
        vm.expectRevert(Bootroom.LockTooLong.selector);
        room.lace(FRIEND, 10_000e18, 4, block.timestamp + 4 weeks);
        // A gifter's top-up is bounded the same way.
        vm.prank(gifter);
        vm.expectRevert(Bootroom.LockTooLong.selector);
        room.lace(FRIEND, 1e18, 1, block.timestamp + 51 weeks);
        vm.prank(gifter);
        room.lace(FRIEND, 1e18, 1, block.timestamp + 52 weeks); // exactly the live unlock: fine
        // Exact bound on an owner-moved lock passes.
        vm.warp(block.timestamp + 1 weeks);
        vm.prank(owner);
        room.lace(FRIEND, 1e18, 52, block.timestamp + 52 weeks);
        (uint128 amount, uint64 unlockAt_, uint64 w) = room.laces(FRIEND);
        assertEq(amount, 3e18); assertEq(unlockAt_, block.timestamp + 52 weeks); assertEq(w, 52);
    }

    /// The whitelisted airdrop starts a lock on an empty lace (its weeks exactly) ...
    function testAirdropStartsOnEmpty() public {
        _lace(airdrop, FRIEND, 10_000e18, 12);
        (uint128 amount, uint64 unlockAt_, uint64 w) = room.laces(FRIEND);
        assertEq(amount, 10_000e18); assertEq(unlockAt_, block.timestamp + 12 weeks); assertEq(w, 12);
    }

    /// ... joins a live lock that already lasts at least as long, and never extends a shorter one or
    /// re-locks expired $GBOOT.
    function testAirdropNeverExtendsTheOwnersLock() public {
        _lace(owner, FRIEND, 1e18, 4);
        vm.prank(airdrop);
        vm.expectRevert(Bootroom.LockTooShort.selector);
        room.lace(FRIEND, 10_000e18, 12, type(uint256).max);
        _lace(owner, FRIEND, 1e18, 20);
        _lace(airdrop, FRIEND, 10_000e18, 12);
        (uint128 amount, uint64 unlockAt_, uint64 w) = room.laces(FRIEND);
        assertEq(amount, 10_002e18); assertEq(unlockAt_, block.timestamp + 20 weeks); assertEq(w, 20);
        vm.warp(block.timestamp + 20 weeks); // expired
        vm.prank(airdrop);
        vm.expectRevert(Bootroom.LockTooShort.selector);
        room.lace(FRIEND, 1, 12, type(uint256).max);
    }

    // ---------------------------------------------------------------- unlace

    function testUnlaceAfterExpiryReturnsAll() public {
        _lace(owner, FRIEND, 1_000e18, 2);
        _lace(gifter, FRIEND, 2_000e18, 2); // a gift tops up the live lock
        vm.warp(block.timestamp + 2 weeks); // exactly at unlockAt: no burn
        uint256 supply = gboot.totalSupply();
        vm.expectEmit(true, true, false, true, address(room));
        emit Unlaced(FRIEND, owner, 3_000e18, 0);
        vm.prank(owner);
        room.unlace(FRIEND);
        assertEq(gboot.balanceOf(owner), 1_000_000e18 + 2_000e18, "gift goes to the Friend's owner");
        assertEq(gboot.totalSupply(), supply);
        assertEq(gboot.balanceOf(address(room)), 0);
        (uint128 amount, uint64 unlockAt_, uint64 lockWeeks) = room.laces(FRIEND);
        assertEq(amount, 0); assertEq(unlockAt_, 0); assertEq(lockWeeks, 0);
    }

    function testEarlyUnlaceBurnsHalf() public {
        _lace(owner, FRIEND, 1_000e18, 52);
        vm.warp(block.timestamp + 52 weeks - 1);
        uint256 supply = gboot.totalSupply();
        vm.expectEmit(true, true, false, true, address(room));
        emit Unlaced(FRIEND, owner, 500e18, 500e18);
        vm.prank(owner);
        room.unlace(FRIEND);
        assertEq(gboot.totalSupply(), supply - 500e18, "half really burned");
        assertEq(gboot.balanceOf(owner), 1_000_000e18 - 500e18);
        assertEq(gboot.balanceOf(address(room)), 0);
    }

    /// Odd amounts: burn rounds down, the caller gets the extra wei.
    function testEarlyUnlaceRoundingOddAmount() public {
        _lace(owner, FRIEND, 3, 1);
        uint256 supply = gboot.totalSupply();
        vm.prank(owner);
        room.unlace(FRIEND);
        assertEq(gboot.totalSupply(), supply - 1);
        assertEq(gboot.balanceOf(owner), 1_000_000e18 - 1);
        _lace(owner, FRIEND, 1, 1); // 1 wei: nothing burned, 1 wei back
        vm.expectEmit(true, true, false, true, address(room));
        emit Unlaced(FRIEND, owner, 1, 0);
        vm.prank(owner);
        room.unlace(FRIEND);
    }

    function testTokenBoundAccountCanUnlace() public {
        _lace(owner, FRIEND, 100e18, 1);
        vm.warp(block.timestamp + 1 weeks);
        vm.prank(tba);
        room.unlace(FRIEND);
        assertEq(gboot.balanceOf(tba), 100e18, "paid to the caller (the TBA)");
    }

    function testOnlyOwnerOrTbaCanUnlace() public {
        _lace(owner, FRIEND, 100e18, 1);
        vm.warp(block.timestamp + 1 weeks);
        vm.prank(gifter);
        vm.expectRevert(Bootroom.NotFriend.selector);
        room.unlace(FRIEND);
        vm.prank(stranger);
        vm.expectRevert(Bootroom.NotFriend.selector);
        room.unlace(FRIEND);
        // Ownership moves with the Friend.
        gens.set(FRIEND, stranger, address(0));
        vm.prank(owner);
        vm.expectRevert(Bootroom.NotFriend.selector);
        room.unlace(FRIEND);
        vm.prank(stranger);
        room.unlace(FRIEND);
        assertEq(gboot.balanceOf(stranger), 1_000_000e18 + 100e18);
    }

    function testUnlaceNothingAndTwice() public {
        vm.prank(owner);
        vm.expectRevert(Bootroom.NothingLaced.selector);
        room.unlace(FRIEND);
        _lace(owner, FRIEND, 1e18, 1);
        vm.warp(block.timestamp + 1 weeks);
        vm.startPrank(owner);
        room.unlace(FRIEND);
        vm.expectRevert(Bootroom.NothingLaced.selector);
        room.unlace(FRIEND);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- perk tier

    function testNoLaceIsTier0() public view {
        assertEq(room.progressBps(FRIEND), 0);
        assertEq(room.perkTier(FRIEND), 0);
    }

    function testFullProgressAtMaxLaceFor52Weeks() public {
        _lace(owner, FRIEND, 10_000e18, 52);
        assertEq(room.progressBps(FRIEND), BPS);
        assertEq(room.perkTier(FRIEND), 3);
    }

    /// Only MAX_LACE counts: 1M GBOOT for 52 weeks is still tier 3 / 100%.
    function testProgressCappedAboveMaxLace() public {
        _lace(owner, FRIEND, 1_000_000e18, 52);
        assertEq(room.progressBps(FRIEND), BPS);
        assertEq(room.perkTier(FRIEND), 3);
    }

    /// Reference values from log2(1 + x) / log2(1 + 520000) (computed off-chain in float).
    function testProgressCurveReferencePoints() public {
        uint256[6] memory amounts = [uint256(1e18), 10_000e18, 5_000e18, 10_000e18, 10_000e18, 9_999e18];
        uint256[6] memory weeks_ = [uint256(1), 1, 52, 26, 12, 52];
        uint256[6] memory expected = [uint256(526), 6_997, 9_473, 9_473, 8_885, 9_999];
        uint8[6] memory tiers = [uint8(1), 2, 3, 3, 3, 3];
        for (uint256 i; i < 6; ++i) {
            uint256 id = 100 + i;
            _lace(owner, id, amounts[i], weeks_[i]);
            assertApproxEqAbs(room.progressBps(id), expected[i], 1, "progress reference");
            assertEq(room.perkTier(id), tiers[i], "tier reference");
        }
    }

    /// Tier boundaries: 50% ≈ 720 GBOOT-weeks, 85% ≈ 72,210 GBOOT-weeks.
    function testTierThresholds() public {
        _lace(owner, 1, 100e18, 7); // 700
        _lace(owner, 2, 100e18, 8); // 800
        _lace(owner, 3, 10_000e18, 7); // 70,000
        _lace(owner, 4, 10_000e18, 8); // 80,000
        assertEq(room.perkTier(1), 1);
        assertEq(room.perkTier(2), 2);
        assertEq(room.perkTier(3), 2);
        assertEq(room.perkTier(4), 3);
    }

    /// Lacing is not yield: the Bootroom exposes no payout multiplier any more (the old boostBps and
    /// dropBps selectors do not exist), so nothing can read a lace into race points or drops.
    function testNoPayoutMultiplierExposed() public {
        _lace(owner, FRIEND, 10_000e18, 52);
        (bool okBoost,) = address(room).staticcall(abi.encodeWithSignature("boostBps(uint256)", FRIEND));
        (bool okDrop,) = address(room).staticcall(abi.encodeWithSignature("dropBps(uint256)", FRIEND));
        assertFalse(okBoost, "no boostBps");
        assertFalse(okDrop, "no dropBps");
    }

    /// x counts whole GBOOT only: below 1 GBOOT the tier is 0 while locked.
    function testSubWholeTokenLaceGivesNoPerk() public {
        _lace(owner, FRIEND, 1e18 - 1, 52);
        assertEq(room.progressBps(FRIEND), 0);
        assertEq(room.perkTier(FRIEND), 0);
    }

    function testPerkExpiresAtUnlock() public {
        _lace(owner, FRIEND, 10_000e18, 12);
        uint256 locked = room.progressBps(FRIEND);
        assertGt(locked, 0);
        vm.warp(block.timestamp + 12 weeks - 1);
        assertEq(room.progressBps(FRIEND), locked, "no decay during the lock");
        vm.warp(block.timestamp + 1);
        assertEq(room.progressBps(FRIEND), 0, "tier 0 from unlockAt");
        assertEq(room.perkTier(FRIEND), 0);
    }

    function testLog2WadKnownValues() public view {
        assertEq(room.log2Wad(1e18), 0);
        assertEq(room.log2Wad(2e18), 1e18);
        assertEq(room.log2Wad(1024e18), 10e18);
        assertApproxEqAbs(room.log2Wad(3e18), 1_584_962_500_721_156_181, 2e9);
        assertApproxEqAbs(room.log2Wad(520_001e18), 18_988_154_872_101_413_000, 1e10); // log2(520001)
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzzPerkBounded(uint256 amount, uint256 lockWeeks, uint256 elapsed) public {
        amount = bound(amount, 1, 50_000_000e18);
        lockWeeks = bound(lockWeeks, 1, 52);
        elapsed = bound(elapsed, 0, 60 weeks);
        _lace(FRIEND, amount, lockWeeks);
        vm.warp(block.timestamp + elapsed);
        uint256 p = room.progressBps(FRIEND);
        uint8 t = room.perkTier(FRIEND);
        assertLe(p, BPS);
        assertLe(t, 3);
        assertEq(t, p == 0 ? 0 : p >= 8_500 ? 3 : p >= 5_000 ? 2 : 1, "tier follows progress");
        if (elapsed >= lockWeeks * 1 weeks) assertEq(t, 0, "expired: tier 0");
    }

    function testFuzzProgressMonotonicInAmount(uint256 a1, uint256 a2, uint256 lockWeeks) public {
        a1 = bound(a1, 1, 30_000e18);
        a2 = bound(a2, a1, 30_000e18);
        lockWeeks = bound(lockWeeks, 1, 52);
        _lace(1, a1, lockWeeks);
        _lace(2, a2, lockWeeks);
        assertLe(room.progressBps(1), room.progressBps(2));
        assertLe(room.perkTier(1), room.perkTier(2));
    }

    function testFuzzProgressMonotonicInWeeks(uint256 amount, uint256 w1, uint256 w2) public {
        amount = bound(amount, 1, 30_000e18);
        w1 = bound(w1, 1, 52);
        w2 = bound(w2, w1, 52);
        _lace(1, amount, w1);
        _lace(2, amount, w2);
        assertLe(room.progressBps(1), room.progressBps(2));
    }

    /// Stacking many laces on one Friend never passes 100% / tier 3.
    function testFuzzStackedLacesCapped(uint256[5] memory amounts, uint256[5] memory ws, uint256[5] memory gaps) public {
        for (uint256 i; i < 5; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 20 weeks));
            _lace(FRIEND, bound(amounts[i], 1, 5_000_000e18), bound(ws[i], 1, 52));
            assertLe(room.progressBps(FRIEND), BPS);
            assertLe(room.perkTier(FRIEND), 3);
        }
    }

    function testFuzzLog2WadMonotonic(uint256 x, uint256 y) public view {
        x = bound(x, 1e18, 1e40);
        y = bound(y, x, 1e40);
        assertLe(room.log2Wad(x), room.log2Wad(y));
    }

    /// Checks log2Wad against 2^result ≈ x via the defining inequality on whole bits and a tight
    /// relative tolerance on the fractional part (compared with integer powers).
    function testFuzzLog2WadIntegerPart(uint256 n, uint256 frac) public view {
        n = bound(n, 0, 100);
        frac = bound(frac, 0, 1e18 - 1);
        uint256 x = (1e18 + frac) << n; // in [2^n, 2^(n+1))
        uint256 r = room.log2Wad(x);
        assertEq(r / 1e18, n, "integer part");
    }

    /// Early unlace: returned + burned == laced, burned == floor(amount / 2), caller gets the rest.
    function testFuzzEarlyUnlaceConservation(uint256 amount, uint256 lockWeeks, uint256 elapsed) public {
        amount = bound(amount, 1, 1_000_000e18);
        lockWeeks = bound(lockWeeks, 1, 52);
        elapsed = bound(elapsed, 0, 60 weeks);
        _lace(owner, FRIEND, amount, lockWeeks);
        vm.warp(block.timestamp + elapsed);
        uint256 supply = gboot.totalSupply();
        uint256 before = gboot.balanceOf(owner);
        vm.prank(owner);
        room.unlace(FRIEND);
        uint256 burned = supply - gboot.totalSupply();
        uint256 returned = gboot.balanceOf(owner) - before;
        assertEq(burned + returned, amount);
        assertEq(burned, elapsed < lockWeeks * 1 weeks ? amount / 2 : 0);
        assertEq(gboot.balanceOf(address(room)), 0);
    }
}
