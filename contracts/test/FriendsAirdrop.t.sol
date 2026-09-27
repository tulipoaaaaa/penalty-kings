// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { Bootroom, IBootroomGenerations } from "../src/Bootroom.sol";
import { FriendsAirdrop, IBootroomLace } from "../src/FriendsAirdrop.sol";
import { BootroomMockGenerations } from "./Bootroom.t.sol";

contract FriendsAirdropTest is Test {
    GBoot internal gboot;
    BootroomMockGenerations internal gens;
    Bootroom internal room;
    FriendsAirdrop internal drop;

    address internal setter = address(0x5E7);
    address internal cupsVault = address(0xC0F5);
    address internal owner = address(0xA11CE);
    address internal anyone = address(0xF00);

    uint256[4] internal ids = [uint256(7730), 1, 42, 9999];
    uint256[4] internal amounts = [uint256(10_000e18), 2_500e18, 1e18, 777e18];
    bytes32[4] internal leaves;
    bytes32 internal root;
    uint256 internal constant FUNDED = 10_000_000e18;

    event RootSet(bytes32 root, uint256 deadline);
    event Claimed(uint256 indexed friendId, uint256 amount);
    event Swept(uint256 amount);
    event Laced(uint256 indexed friendId, address indexed from, uint256 amount, uint256 lockWeeks, uint256 unlockAt);

    function _leaf(uint256 id, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(id, amount))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// Proof for leaf i in the 4-leaf tree ((0,1),(2,3)).
    function _proof(uint256 i) internal view returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = leaves[i ^ 1];
        p[1] = i < 2 ? _hashPair(leaves[2], leaves[3]) : _hashPair(leaves[0], leaves[1]);
    }

    function setUp() public {
        vm.warp(1_700_000_000);
        gboot = new GBoot();
        gens = new BootroomMockGenerations();
        room = new Bootroom(IERC20(address(gboot)), IBootroomGenerations(address(gens)));
        vm.prank(setter);
        drop = new FriendsAirdrop(IERC20(address(gboot)), IBootroomLace(address(room)), cupsVault);
        gboot.transfer(address(drop), FUNDED);
        for (uint256 i; i < 4; ++i) leaves[i] = _leaf(ids[i], amounts[i]);
        root = _hashPair(_hashPair(leaves[0], leaves[1]), _hashPair(leaves[2], leaves[3]));
        gens.set(7730, owner, address(0));
    }

    function _setRoot() internal {
        vm.prank(setter);
        drop.setRoot(root);
    }

    function testConstants() public view {
        assertEq(drop.LOCK_WEEKS(), 12);
        assertEq(drop.CLAIM_WINDOW(), 180 days);
        assertEq(drop.setter(), setter);
        assertEq(drop.sweepTo(), cupsVault);
    }

    /// Reference layout: OpenZeppelin StandardMerkleTree leaves (double-hashed abi.encode) and
    /// commutative sorted-pair hashing, as in OZ MerkleProof.processProof (OZ's MerkleProof is not
    /// vendored in lib/, so its loop is restated here). The contract accepts exactly those proofs.
    function testTreeMatchesOpenZeppelinLayout() public view {
        for (uint256 i; i < 4; ++i) {
            bytes32 node = leaves[i];
            bytes32[] memory p = _proof(i);
            for (uint256 j; j < p.length; ++j) node = _hashPair(node, p[j]);
            assertEq(node, root);
            assertEq(leaves[i], keccak256(bytes.concat(keccak256(abi.encode(ids[i], amounts[i])))));
        }
    }

    // --------------------------------------------------------------- setRoot

    function testSetRootOnceBySetter() public {
        vm.expectRevert(FriendsAirdrop.NotSetter.selector);
        drop.setRoot(root);
        vm.expectEmit(false, false, false, true, address(drop));
        emit RootSet(root, block.timestamp + 180 days);
        _setRoot();
        assertEq(drop.root(), root);
        assertEq(drop.deadline(), block.timestamp + 180 days);
        assertEq(gboot.allowance(address(drop), address(room)), type(uint256).max);
        vm.prank(setter);
        vm.expectRevert(FriendsAirdrop.RootAlreadySet.selector);
        drop.setRoot(bytes32(uint256(1)));
    }

    /// A zero root does not count as "set": the setter can still set a real one later (and the
    /// deadline restarts from that call).
    function testZeroRootDoesNotLock() public {
        vm.prank(setter);
        drop.setRoot(bytes32(0));
        vm.warp(block.timestamp + 10 days);
        _setRoot();
        assertEq(drop.deadline(), block.timestamp + 180 days);
    }

    // ----------------------------------------------------------------- claim

    function testClaimBeforeRootReverts() public {
        vm.expectRevert(FriendsAirdrop.NoRoot.selector);
        drop.claim(ids[0], amounts[0], _proof(0));
    }

    function testClaimLacesFor12Weeks() public {
        _setRoot();
        vm.expectEmit(true, true, false, true, address(room));
        emit Laced(7730, address(drop), 10_000e18, 12, block.timestamp + 12 weeks);
        vm.expectEmit(true, false, false, true, address(drop));
        emit Claimed(7730, 10_000e18);
        vm.prank(anyone); // permissionless: never pays the caller
        drop.claim(ids[0], amounts[0], _proof(0));
        assertTrue(drop.claimed(7730));
        (uint128 amount, uint64 unlockAt, uint64 lockWeeks) = room.laces(7730);
        assertEq(amount, 10_000e18);
        assertEq(unlockAt, block.timestamp + 12 weeks);
        assertEq(lockWeeks, 12);
        assertEq(gboot.balanceOf(anyone), 0);
        assertEq(gboot.balanceOf(address(room)), 10_000e18);
        assertEq(gboot.balanceOf(address(drop)), FUNDED - 10_000e18);
        // 10k × 12 = 120,000 GBOOT-weeks → ≈ 88.85% progress → perk tier 3 (cosmetics / XP / seeding only).
        assertApproxEqAbs(room.progressBps(7730), 8_885, 1);
        assertEq(room.perkTier(7730), 3);
    }

    function testAllLeavesClaimable() public {
        _setRoot();
        for (uint256 i; i < 4; ++i) drop.claim(ids[i], amounts[i], _proof(i));
        uint256 sum = amounts[0] + amounts[1] + amounts[2] + amounts[3];
        assertEq(gboot.balanceOf(address(room)), sum);
        assertEq(gboot.balanceOf(address(drop)), FUNDED - sum);
    }

    function testDoubleClaimReverts() public {
        _setRoot();
        drop.claim(ids[1], amounts[1], _proof(1));
        vm.expectRevert(FriendsAirdrop.AlreadyClaimed.selector);
        drop.claim(ids[1], amounts[1], _proof(1));
    }

    function testBadProofs() public {
        _setRoot();
        vm.expectRevert(FriendsAirdrop.BadProof.selector);
        drop.claim(ids[0], amounts[0] + 1, _proof(0)); // wrong amount
        vm.expectRevert(FriendsAirdrop.BadProof.selector);
        drop.claim(ids[1], amounts[1], _proof(0)); // wrong proof
        vm.expectRevert(FriendsAirdrop.BadProof.selector);
        drop.claim(ids[0], amounts[0], new bytes32[](0)); // empty proof
        // Second-preimage: an inner node is not a valid leaf.
        bytes32[] memory p = new bytes32[](1);
        p[0] = _hashPair(leaves[2], leaves[3]);
        vm.expectRevert(FriendsAirdrop.BadProof.selector);
        drop.claim(uint256(leaves[0]), uint256(leaves[1]), p);
    }

    /// Single-leaf tree: root == leaf, empty proof.
    function testSingleLeafRoot() public {
        vm.prank(setter);
        FriendsAirdrop single = new FriendsAirdrop(IERC20(address(gboot)), IBootroomLace(address(room)), cupsVault);
        gboot.transfer(address(single), 5e18);
        vm.prank(setter);
        single.setRoot(_leaf(5, 5e18));
        single.claim(5, 5e18, new bytes32[](0));
        (uint128 amount,,) = room.laces(5);
        assertEq(amount, 5e18);
    }

    /// The claimed lace belongs to the Friend: its owner can unlace after 12 weeks, 50% burned if earlier.
    function testOwnerUnlacesAfterExpiryOrBurnsHalfEarly() public {
        _setRoot();
        drop.claim(ids[0], amounts[0], _proof(0));
        drop.claim(ids[1], amounts[1], _proof(1));
        gens.set(1, owner, address(0));
        vm.warp(block.timestamp + 12 weeks - 1);
        vm.prank(owner);
        room.unlace(1); // early: half burned
        assertEq(gboot.balanceOf(owner), 1_250e18);
        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        room.unlace(7730); // on time: all back
        assertEq(gboot.balanceOf(owner), 1_250e18 + 10_000e18);
    }

    function testClaimWindowBoundaries() public {
        _setRoot();
        uint256 deadline = drop.deadline();
        vm.warp(deadline);
        drop.claim(ids[0], amounts[0], _proof(0)); // still open at the deadline second
        vm.expectRevert(FriendsAirdrop.ClaimWindowOpen.selector);
        drop.sweep();
        vm.warp(deadline + 1);
        vm.expectRevert(FriendsAirdrop.ClaimWindowClosed.selector);
        drop.claim(ids[1], amounts[1], _proof(1));
    }

    /// An underfunded airdrop fails the claim atomically (no claimed flag set).
    function testUnderfundedClaimReverts() public {
        vm.prank(setter);
        FriendsAirdrop poor = new FriendsAirdrop(IERC20(address(gboot)), IBootroomLace(address(room)), cupsVault);
        vm.prank(setter);
        poor.setRoot(root);
        vm.expectRevert();
        poor.claim(ids[0], amounts[0], _proof(0));
        assertFalse(poor.claimed(ids[0]));
    }

    // ----------------------------------------------------------------- sweep

    function testSweepBeforeRootOrWindowReverts() public {
        vm.expectRevert(FriendsAirdrop.ClaimWindowOpen.selector);
        drop.sweep();
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(FriendsAirdrop.ClaimWindowOpen.selector);
        drop.sweep(); // still no root
        _setRoot();
        vm.warp(block.timestamp + 180 days);
        vm.expectRevert(FriendsAirdrop.ClaimWindowOpen.selector);
        drop.sweep();
    }

    function testSweepAfter180DaysToCupsVault() public {
        _setRoot();
        drop.claim(ids[0], amounts[0], _proof(0));
        vm.warp(block.timestamp + 180 days + 1);
        uint256 left = FUNDED - amounts[0];
        vm.expectEmit(false, false, false, true, address(drop));
        emit Swept(left);
        vm.prank(anyone); // permissionless
        drop.sweep();
        assertEq(gboot.balanceOf(cupsVault), left);
        assertEq(gboot.balanceOf(address(drop)), 0);
        // Idempotent: a second sweep moves 0 (e.g. tokens sent later are swept too).
        drop.sweep();
        assertEq(gboot.balanceOf(cupsVault), left);
        gboot.transfer(address(drop), 1e18);
        drop.sweep();
        assertEq(gboot.balanceOf(cupsVault), left + 1e18);
    }

    function testFuzzWrongAmountRejected(uint256 i, uint256 amount) public {
        _setRoot();
        i = bound(i, 0, 3);
        vm.assume(amount != amounts[i]);
        vm.expectRevert(FriendsAirdrop.BadProof.selector);
        drop.claim(ids[i], amount, _proof(i));
    }
}
