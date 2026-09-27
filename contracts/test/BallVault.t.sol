// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BallVault, IVaultChanceGame } from "../src/BallVault.sol";
// The real FriendSDK ChanceGame, compiled from the SDK package (not a mock of it).
import { ChanceGame } from "@friendsdk/ChanceGame.sol";

contract MockRF is ERC20("Rare Friends", "RAREFRIENDS") {
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Minimal stand-in for Generations: exactly the IChanceGenerations surface ChanceGame calls.
contract MockGenerations {
    address public immutable token;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint8) public generation;
    mapping(uint256 => address) public tokenBoundAccount;

    constructor(address token_) {
        token = token_;
    }

    function setFriend(uint256 id, address owner, uint8 gen, address tba) external {
        ownerOf[id] = owner;
        generation[id] = gen;
        tokenBoundAccount[id] = tba;
    }
}

/// Dice Entropy V2 stand-in: zero fee, sequence numbers; tests deliver the callback themselves.
contract MockEntropy {
    uint64 public seq;

    function getFeeV2(address, uint32) external pure returns (uint128) {
        return 0;
    }

    function requestV2(address, bytes32, uint32) external payable returns (uint64) {
        return ++seq;
    }
}

/// An ERC-1155 receiver that re-enters the vault from its acceptance hook.
contract Reenterer is IERC1155Receiver {
    BallVault public vault;
    uint8 public mode; // 0 accept, 1 re-enter unwrap, 2 re-enter buy, 3 re-enter cancel
    uint256 public listingId;

    constructor(BallVault vault_) {
        vault = vault_;
    }

    function arm(uint8 mode_, uint256 listingId_) external {
        mode = mode_;
        listingId = listingId_;
    }

    function approve(IERC20 token) external {
        token.approve(address(vault), type(uint256).max);
    }

    function buy(uint256 id, uint256 quantity) external {
        vault.buy(id, quantity, type(uint256).max);
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        if (msg.sender == address(vault)) {
            if (mode == 1) vault.unwrap(id, 1);
            if (mode == 2) vault.buy(listingId, 1, type(uint256).max);
            if (mode == 3) vault.cancel(listingId);
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
    }
}

/// Shared fixture: the real SDK ChanceGame with the Park table (games/penalty-kings/tiers/park.json,
/// as asserted by scripts/verify-odds.mjs), a hardwired Friend with owner + TBA, and the vault.
abstract contract VaultFixture is Test {
    uint256 internal constant PRICE = 10e18;
    uint256 internal constant FRIEND = 7;

    MockRF internal rf;
    MockGenerations internal generations;
    MockEntropy internal entropy;
    ChanceGame internal game;
    BallVault internal vault;
    uint256 internal edition;

    address internal owner = makeAddr("owner");
    address internal tba = makeAddr("tba");
    address internal curator = makeAddr("curator");
    address internal splitter = makeAddr("edgeSplitter");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal provider = makeAddr("diceProvider");

    function _parkTable() internal pure returns (ChanceGame.Outcome[] memory table) {
        uint16[7] memory chances = [uint16(3150), 2700, 2000, 1100, 700, 250, 100];
        uint256[7] memory multX10 = [uint256(0), 5, 10, 15, 25, 50, 100];
        table = new ChanceGame.Outcome[](7);
        for (uint256 i; i < 7; ++i) {
            table[i] = ChanceGame.Outcome(chances[i], (PRICE * multX10[i]) / 10, "");
        }
    }

    function _deploy(uint256 feeBps) internal {
        rf = new MockRF();
        generations = new MockGenerations(address(rf));
        entropy = new MockEntropy();
        game = new ChanceGame(
            address(rf), address(generations), address(entropy), provider, "Ball", "BALL", PRICE, _parkTable()
        );
        rf.mint(address(this), 1_000_000e18);
        rf.approve(address(game), type(uint256).max);
        game.fund(100_000e18);
        generations.setFriend(FRIEND, owner, 5, tba);
        vault = new BallVault(IERC20(address(rf)), curator, splitter, feeBps, "");
        vm.prank(curator);
        edition = vault.addEdition(IVaultChanceGame(address(game)), "S1", "park");
        for (uint256 i; i < 5; ++i) {
            address who = [owner, tba, alice, bob, splitter][i];
            rf.mint(who, 100_000e18);
            vm.prank(who);
            rf.approve(address(vault), type(uint256).max);
        }
        vm.prank(tba);
        rf.approve(address(game), type(uint256).max);
    }

    /// Buy, play, randomise and settle `n` balls for FRIEND through the real ChanceGame.
    function _pull(uint256 n, bytes32 word) internal {
        vm.startPrank(tba);
        game.buy(FRIEND, n);
        (, uint256 batchId) = game.play(FRIEND, n);
        uint64 sequence = game.requestRandomness(batchId);
        vm.stopPrank();
        vm.prank(address(entropy));
        game._entropyCallback(sequence, provider, word);
        for (uint256 id = batchId; id < batchId + n; ++id) game.settle(id);
    }

    /// The most-held redeemable outcome (reward > 0) and its count.
    function _best() internal view returns (uint256 outcome, uint256 held) {
        for (uint256 o = 2; o <= 7; ++o) {
            uint256 b = game.balanceOf(tba, o);
            if (b > held) (outcome, held) = (o, b);
        }
    }

    /// The full wrap flow as the TBA would batch it: commit → ChanceGame.redeem → wrap.
    function _wrap(uint256 outcome, uint256 quantity, address to) internal returns (uint256 id) {
        vm.startPrank(tba);
        vault.commitWrap(edition, FRIEND, outcome, quantity);
        game.redeem(FRIEND, outcome, quantity);
        id = vault.wrap(edition, FRIEND, outcome, to);
        vm.stopPrank();
    }

    function _floor(uint256 outcome) internal view returns (uint256 reward) {
        (, reward,) = game.outcomes(outcome);
    }
}

contract BallVaultTest is VaultFixture {
    uint256 internal outcome;

    function setUp() public {
        _deploy(250);
        _pull(40, keccak256("penalty-kings"));
        uint256 held;
        (outcome, held) = _best();
        assertGe(held, 4, "fixture needs at least 4 balls of one redeemable outcome");
    }

    function _solvent() internal view {
        assertGe(rf.balanceOf(address(vault)), vault.backing(), "vault RF >= sum of floors");
    }

    // ── Why the vault exists ───────────────────────────────────────────────────────────────

    function testChanceGameBallsAreFriendBound() public {
        vm.prank(tba);
        vm.expectRevert(ChanceGame.FriendBoundInventory.selector);
        game.safeTransferFrom(tba, alice, outcome, 1, "");
    }

    // ── Wrap / unwrap ──────────────────────────────────────────────────────────────────────

    function testWrapUnwrapRoundTrip() public {
        uint256 floor = _floor(outcome);
        uint256 tbaRf = rf.balanceOf(tba);
        uint256 heldBefore = game.balanceOf(tba, outcome);
        uint256 id = _wrap(outcome, 3, alice);

        assertEq(id, vault.ballId(edition, outcome));
        assertEq(vault.balanceOf(alice, id), 3);
        assertEq(vault.totalSupply(id), 3);
        assertEq(vault.floorOf(id), floor);
        assertEq(vault.backing(), 3 * floor);
        assertEq(rf.balanceOf(address(vault)), 3 * floor);
        assertEq(game.balanceOf(tba, outcome), heldBefore - 3, "the friend-bound balls were burned");
        assertEq(rf.balanceOf(tba), tbaRf, "redeem paid the TBA exactly what the wrap pulled");

        // The claim is transferable, unlike the ball.
        vm.prank(alice);
        vault.safeTransferFrom(alice, bob, id, 1, "");
        uint256 bobRf = rf.balanceOf(bob);
        vm.prank(bob);
        vault.unwrap(id, 1);
        assertEq(rf.balanceOf(bob), bobRf + floor, "unwrap pays the full floor, no fee");
        assertEq(vault.backing(), 2 * floor);
        _solvent();
    }

    function testEditionMetadataKept() public {
        uint256 id = _wrap(outcome, 1, alice);
        (uint256 editionId, uint256 outcomeId) = vault.decodeId(id);
        assertEq(editionId, edition);
        assertEq(outcomeId, outcome);
        (address g, string memory season, string memory tier, bool discontinued) = vault.edition(editionId);
        assertEq(g, address(game));
        assertEq(season, "S1");
        assertEq(tier, "park");
        assertFalse(discontinued);
    }

    function testWrapByOwnerPayingOwnRF() public {
        uint256 floor = _floor(outcome);
        uint256 ownerRf = rf.balanceOf(owner);
        vm.startPrank(owner);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        game.redeem(FRIEND, outcome, 1); // RF goes to the TBA, as in ChanceGame
        vault.wrap(edition, FRIEND, outcome, owner);
        vm.stopPrank();
        assertEq(rf.balanceOf(owner), ownerRf - floor);
        assertEq(vault.balanceOf(owner, vault.ballId(edition, outcome)), 1);
        _solvent();
    }

    function testWrapWithoutRedeemReverts() public {
        vm.startPrank(tba);
        vault.commitWrap(edition, FRIEND, outcome, 2);
        vm.expectRevert(BallVault.NotRedeemed.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
        game.redeem(FRIEND, outcome, 1); // only half of the commit
        vm.expectRevert(BallVault.NotRedeemed.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
        vm.stopPrank();
    }

    function testRedeemBeforeCommitDoesNotCount() public {
        vm.startPrank(tba);
        game.redeem(FRIEND, outcome, 1);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        vm.expectRevert(BallVault.NotRedeemed.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
        vm.stopPrank();
    }

    function testCommitIsSingleUse() public {
        _wrap(outcome, 1, alice);
        vm.prank(tba);
        vm.expectRevert(BallVault.NoCommit.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
    }

    function testCannotCommitMoreThanHeld() public {
        uint256 held = game.balanceOf(tba, outcome);
        vm.prank(tba);
        vm.expectRevert(BallVault.InvalidQuantity.selector);
        vault.commitWrap(edition, FRIEND, outcome, held + 1);
    }

    function testScuffedBallHasNoFloorAndCannotWrap() public {
        vm.prank(tba);
        vm.expectRevert(BallVault.InvalidOutcome.selector);
        vault.commitWrap(edition, FRIEND, 1, 1);
        uint256 scuffed = vault.ballId(edition, 1);
        vm.expectRevert(BallVault.InvalidOutcome.selector);
        vault.floorOf(scuffed);
        vm.prank(tba);
        vm.expectRevert(BallVault.InvalidOutcome.selector);
        vault.commitWrap(edition, FRIEND, 8, 1);
    }

    function testUnwrapMoreThanHeldReverts() public {
        uint256 id = _wrap(outcome, 1, alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.unwrap(id, 2);
        vm.prank(bob);
        vm.expectRevert();
        vault.unwrap(id, 1);
    }

    function testDirectTransferToVaultRejected() public {
        uint256 id = _wrap(outcome, 1, alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.safeTransferFrom(alice, address(vault), id, 1, "");
    }

    // ── Access control ─────────────────────────────────────────────────────────────────────

    function testOnlyControllerCanCommit() public {
        vm.prank(alice);
        vm.expectRevert(BallVault.NotFriendController.selector);
        vault.commitWrap(edition, FRIEND, outcome, 1);
    }

    function testOnlyCommitterCanWrap() public {
        vm.prank(owner);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        vm.prank(tba);
        game.redeem(FRIEND, outcome, 1);
        vm.prank(tba);
        vm.expectRevert(BallVault.NoCommit.selector);
        vault.wrap(edition, FRIEND, outcome, tba);
        vm.prank(alice);
        vm.expectRevert(BallVault.NoCommit.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
    }

    function testCommitterMustStillControlFriend() public {
        vm.startPrank(owner);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        game.redeem(FRIEND, outcome, 1);
        vm.stopPrank();
        generations.setFriend(FRIEND, alice, 5, tba); // Friend NFT sold before the wrap
        vm.prank(owner);
        vm.expectRevert(BallVault.NotFriendController.selector);
        vault.wrap(edition, FRIEND, outcome, owner);
    }

    function testUnhardwiredFriendRejected() public {
        generations.setFriend(FRIEND, owner, 0, tba);
        vm.prank(owner);
        vm.expectRevert(BallVault.InvalidFriend.selector);
        vault.commitWrap(edition, FRIEND, outcome, 1);
    }

    function testCuratorOnlyAndAppendOnly() public {
        vm.expectRevert(BallVault.OnlyCurator.selector);
        vault.addEdition(IVaultChanceGame(address(game)), "S2", "park");
        vm.expectRevert(BallVault.OnlyCurator.selector);
        vault.discontinue(edition);
        vm.prank(curator);
        vm.expectRevert(BallVault.EditionExists.selector);
        vault.addEdition(IVaultChanceGame(address(game)), "S2", "park");
        vm.prank(curator);
        vm.expectRevert(BallVault.InvalidEdition.selector);
        vault.discontinue(99);
    }

    function testEditionMustUseVaultRF() public {
        MockRF other = new MockRF();
        MockGenerations otherGen = new MockGenerations(address(other));
        ChanceGame otherGame = new ChanceGame(
            address(other), address(otherGen), address(entropy), provider, "Ball", "BALL", PRICE, _parkTable()
        );
        vm.prank(curator);
        vm.expectRevert(BallVault.InvalidConfiguration.selector);
        vault.addEdition(IVaultChanceGame(address(otherGame)), "S1", "park");
    }

    function testFeeCappedAtConstruction() public {
        vm.expectRevert(BallVault.InvalidConfiguration.selector);
        new BallVault(IERC20(address(rf)), curator, splitter, 501, "");
        vm.expectRevert(BallVault.InvalidConfiguration.selector);
        new BallVault(IERC20(address(rf)), curator, address(0), 100, "");
    }

    function testDiscontinuedKeepsFloorAndUnwrap() public {
        uint256 id = _wrap(outcome, 2, alice);
        uint256 floor = vault.floorOf(id);
        vm.prank(curator);
        vault.discontinue(edition);
        (,,, bool discontinued) = vault.edition(edition);
        assertTrue(discontinued);
        assertEq(vault.floorOf(id), floor, "discontinuing never changes the floor");
        // Discontinuing closes wrapping forever: no new Vault Balls of this edition, ever.
        vm.prank(tba);
        vm.expectRevert(BallVault.EditionClosed.selector);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        // Existing Vault Balls keep their full floor.
        vm.prank(alice);
        vault.unwrap(id, 2);
        assertEq(vault.backing(), 0);
        _solvent();
    }

    function testEditionCapIsOneTimeAndLimitsEverMinted() public {
        vm.prank(curator);
        vault.capEdition(edition, 3);
        vm.prank(curator);
        vm.expectRevert(BallVault.InvalidConfiguration.selector);
        vault.capEdition(edition, 10); // never raised
        uint256 id = _wrap(outcome, 3, alice);
        assertEq(vault.everMinted(id), 3);
        // Unwrapping does not free room under the cap: the cap counts every Vault Ball ever minted.
        vm.prank(alice);
        vault.unwrap(id, 3);
        vm.startPrank(tba);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        game.redeem(FRIEND, outcome, 1);
        vm.expectRevert(BallVault.EditionCapReached.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
        vm.stopPrank();
        _solvent();
    }

    function testCommitBeforeDiscontinueCannotFinish() public {
        vm.prank(tba);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        vm.prank(curator);
        vault.discontinue(edition);
        vm.startPrank(tba);
        game.redeem(FRIEND, outcome, 1);
        vm.expectRevert(BallVault.EditionClosed.selector);
        vault.wrap(edition, FRIEND, outcome, alice);
        vm.stopPrank();
    }

    // ── Market ─────────────────────────────────────────────────────────────────────────────

    function testListBuyCancelWithFee() public {
        uint256 id = _wrap(outcome, 3, alice);
        uint256 floor = vault.floorOf(id);
        uint256 ask = floor * 2;

        vm.prank(alice);
        // Free market: listing below the floor is allowed (the seller's choice); a zero price is not.
        vm.expectRevert(BallVault.InvalidListing.selector);
        vault.list(id, 1, 0);

        vm.prank(alice);
        uint256 listingId = vault.list(id, 3, ask);
        assertEq(vault.balanceOf(address(vault), id), 3, "escrowed");
        assertEq(vault.balanceOf(alice, id), 0);

        uint256 aliceRf = rf.balanceOf(alice);
        uint256 bobRf = rf.balanceOf(bob);
        uint256 splitterRf = rf.balanceOf(splitter);
        uint256 vaultRf = rf.balanceOf(address(vault));

        vm.prank(bob);
        vm.expectRevert(BallVault.InvalidListing.selector);
        vault.buy(listingId, 1, ask - 1); // price guard
        vm.prank(bob);
        vm.expectRevert(BallVault.InvalidQuantity.selector);
        vault.buy(listingId, 4, ask);

        vm.prank(bob);
        vault.buy(listingId, 2, ask);
        uint256 paid = 2 * ask;
        uint256 fee = (paid * 250) / 10_000;
        assertEq(rf.balanceOf(bob), bobRf - paid);
        assertEq(rf.balanceOf(alice), aliceRf + paid - fee);
        assertEq(rf.balanceOf(splitter), splitterRf + fee);
        assertEq(rf.balanceOf(address(vault)), vaultRf, "market payments never touch the backing");
        assertEq(vault.balanceOf(bob, id), 2);

        vm.prank(bob);
        vm.expectRevert(BallVault.NotSeller.selector);
        vault.cancel(listingId);
        vm.prank(alice);
        vault.cancel(listingId);
        assertEq(vault.balanceOf(alice, id), 1, "unsold unit returned");
        assertEq(vault.balanceOf(address(vault), id), 0);

        vm.prank(bob);
        vm.expectRevert(BallVault.InvalidListing.selector);
        vault.buy(listingId, 1, ask);
        vm.prank(alice);
        vm.expectRevert(BallVault.InvalidListing.selector);
        vault.cancel(listingId);
        _solvent();
    }

    function testEscrowedBallsStayBacked() public {
        uint256 id = _wrap(outcome, 2, alice);
        uint256 floor = vault.floorOf(id);
        vm.prank(alice);
        vault.list(id, 2, floor);
        assertEq(vault.backing(), 2 * floor);
        vm.prank(alice);
        vm.expectRevert(); // escrowed units cannot be unwrapped by the seller
        vault.unwrap(id, 1);
        _solvent();
    }

    function testZeroFeeVault() public {
        BallVault free = new BallVault(IERC20(address(rf)), curator, splitter, 0, "");
        vm.prank(curator);
        uint256 e = free.addEdition(IVaultChanceGame(address(game)), "S1", "park");
        vm.startPrank(tba);
        rf.approve(address(free), type(uint256).max);
        free.commitWrap(e, FRIEND, outcome, 1);
        game.redeem(FRIEND, outcome, 1);
        uint256 id = free.wrap(e, FRIEND, outcome, alice);
        vm.stopPrank();
        vm.prank(alice);
        uint256 listingId = free.list(id, 1, 1_000e18);
        vm.prank(bob);
        rf.approve(address(free), type(uint256).max);
        uint256 splitterRf = rf.balanceOf(splitter);
        vm.prank(bob);
        free.buy(listingId, 1, 1_000e18);
        assertEq(rf.balanceOf(splitter), splitterRf);
    }

    // ── Reentrancy ─────────────────────────────────────────────────────────────────────────

    function _reentererWithListing(uint8 mode) internal returns (Reenterer r, uint256 listingId, uint256 id) {
        r = new Reenterer(vault);
        rf.mint(address(r), 10_000e18);
        r.approve(IERC20(address(rf)));
        id = _wrap(outcome, 3, alice);
        uint256 floor = vault.floorOf(id);
        vm.prank(alice);
        listingId = vault.list(id, 3, floor);
        r.arm(mode, listingId);
    }

    function testReentrantUnwrapFromBuyHookReverts() public {
        (Reenterer r, uint256 listingId,) = _reentererWithListing(1);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.buy(listingId, 1);
    }

    function testReentrantBuyFromBuyHookReverts() public {
        (Reenterer r, uint256 listingId,) = _reentererWithListing(2);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.buy(listingId, 1);
    }

    function testReentrantCancelFromWrapHookReverts() public {
        (Reenterer r, uint256 listingId,) = _reentererWithListing(3);
        vm.startPrank(tba);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        game.redeem(FRIEND, outcome, 1);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.wrap(edition, FRIEND, outcome, address(r));
        vm.stopPrank();
        assertEq(vault.balanceOf(address(vault), vault.ballId(edition, outcome)), 3, "listing untouched");
        listingId;
    }

    function testReceiverContractWorksWhenHonest() public {
        (Reenterer r, uint256 listingId, uint256 id) = _reentererWithListing(0);
        r.buy(listingId, 2);
        assertEq(vault.balanceOf(address(r), id), 2);
        _solvent();
    }

    // ── Fuzz ───────────────────────────────────────────────────────────────────────────────

    function testFuzzWrapUnwrapSolvency(uint8 wrapQty, uint8 unwrapQty, uint16 askMult) public {
        uint256 held = game.balanceOf(tba, outcome);
        uint256 w = bound(wrapQty, 1, held);
        uint256 id = _wrap(outcome, w, alice);
        _solvent();
        uint256 floor = vault.floorOf(id);
        uint256 listed = w / 2;
        if (listed != 0) {
            vm.prank(alice);
            uint256 listingId = vault.list(id, listed, floor + (floor * bound(askMult, 0, 1_000)) / 100);
            vm.prank(bob);
            vault.buy(listingId, listed, type(uint256).max);
            _solvent();
        }
        uint256 u = bound(unwrapQty, 0, w - listed);
        if (u != 0) {
            vm.prank(alice);
            vault.unwrap(id, u);
        }
        if (listed != 0) {
            vm.prank(bob);
            vault.unwrap(id, listed);
        }
        assertEq(vault.backing(), (w - listed - u) * floor);
        assertEq(rf.balanceOf(address(vault)), vault.backing(), "no RF leaks in or out of the backing");
    }
}

/// Invariant handler: random wraps, unwraps, transfers, listings, buys and cancels.
contract VaultHandler is Test {
    BallVault internal vault;
    ChanceGame internal game;
    IERC20 internal rf;
    uint256 internal edition;
    uint256 internal friend;
    address internal tba;
    address[3] internal actors;
    uint256[] public ids;
    uint256[] internal openListings;

    constructor(BallVault vault_, ChanceGame game_, uint256 edition_, uint256 friend_, address tba_, address[3] memory actors_) {
        vault = vault_;
        game = game_;
        rf = IERC20(address(vault_.rf()));
        edition = edition_;
        friend = friend_;
        tba = tba_;
        actors = actors_;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function wrap(uint256 outcomeSeed, uint256 qty, uint256 actorSeed) external {
        uint256 outcome = bound(outcomeSeed, 2, 7);
        uint256 held = game.balanceOf(tba, outcome);
        if (held == 0) return;
        qty = bound(qty, 1, held);
        vm.startPrank(tba);
        vault.commitWrap(edition, friend, outcome, qty);
        game.redeem(friend, outcome, qty);
        uint256 id = vault.wrap(edition, friend, outcome, actors[actorSeed % 3]);
        vm.stopPrank();
        for (uint256 i; i < ids.length; ++i) if (ids[i] == id) return;
        ids.push(id);
    }

    function unwrap(uint256 idSeed, uint256 actorSeed, uint256 qty) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address actor = actors[actorSeed % 3];
        uint256 bal = vault.balanceOf(actor, id);
        if (bal == 0) return;
        vm.prank(actor);
        vault.unwrap(id, bound(qty, 1, bal));
    }

    function transfer(uint256 idSeed, uint256 fromSeed, uint256 toSeed, uint256 qty) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address from = actors[fromSeed % 3];
        uint256 bal = vault.balanceOf(from, id);
        if (bal == 0) return;
        vm.prank(from);
        vault.safeTransferFrom(from, actors[toSeed % 3], id, bound(qty, 1, bal), "");
    }

    function list(uint256 idSeed, uint256 actorSeed, uint256 qty, uint256 premium) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        address actor = actors[actorSeed % 3];
        uint256 bal = vault.balanceOf(actor, id);
        if (bal == 0) return;
        uint256 price = vault.floorOf(id) + bound(premium, 0, 500e18);
        vm.prank(actor);
        openListings.push(vault.list(id, bound(qty, 1, bal), price));
    }

    function buy(uint256 listingSeed, uint256 actorSeed, uint256 qty) external {
        if (openListings.length == 0) return;
        uint256 listingId = openListings[listingSeed % openListings.length];
        (address seller,, uint256 left,) = vault.listings(listingId);
        if (seller == address(0) || left == 0) return;
        vm.prank(actors[actorSeed % 3]);
        vault.buy(listingId, bound(qty, 1, left), type(uint256).max);
    }

    function cancel(uint256 listingSeed) external {
        if (openListings.length == 0) return;
        uint256 index = listingSeed % openListings.length;
        uint256 listingId = openListings[index];
        (address seller,,,) = vault.listings(listingId);
        if (seller == address(0)) return;
        vm.prank(seller);
        vault.cancel(listingId);
        openListings[index] = openListings[openListings.length - 1];
        openListings.pop();
    }
}

contract BallVaultInvariantTest is VaultFixture {
    VaultHandler internal handler;
    address internal carol = makeAddr("carol");

    function setUp() public {
        _deploy(300);
        _pull(120, keccak256("invariant"));
        rf.mint(carol, 100_000e18);
        vm.prank(carol);
        rf.approve(address(vault), type(uint256).max);
        handler = new VaultHandler(vault, game, edition, FRIEND, tba, [alice, bob, carol]);
        targetContract(address(handler));
    }

    /// Vault RF ≥ Σ floor × supply, and the running `backing` equals that sum exactly.
    function invariantSolvent() public view {
        uint256 owed;
        for (uint256 i; i < handler.idCount(); ++i) {
            uint256 id = handler.ids(i);
            owed += vault.floorOf(id) * vault.totalSupply(id);
            uint256 held = vault.balanceOf(alice, id) + vault.balanceOf(bob, id)
                + vault.balanceOf(carol, id) + vault.balanceOf(address(vault), id);
            assertEq(held, vault.totalSupply(id), "supply = holders + escrow");
        }
        assertEq(vault.backing(), owed, "backing = sum of floors");
        assertGe(rf.balanceOf(address(vault)), owed, "vault RF >= sum of floors");
    }

    /// Wrapped supply of each outcome never exceeds the balls burned from the Friend's TBA.
    function invariantProvenance() public view {
        for (uint256 i; i < handler.idCount(); ++i) {
            uint256 id = handler.ids(i);
            (, uint256 outcomeId) = vault.decodeId(id);
            uint256 minted = vault.totalSupply(id);
            // 120 balls were pulled; every wrapped unit left the TBA's ChanceGame balance.
            assertLe(minted + game.balanceOf(tba, outcomeId), 120);
        }
    }
}

/// Mainnet-fork check against the REAL Robinhood Chain contracts (RF, Generations, Dice Entropy
/// and provider from docs/ADDRESSES.md). No Penalty Kings ChanceGame is deployed yet
/// (games/penalty-kings/live.json is empty, docs/DEPLOYMENT.md "not deployed"), so the SDK
/// ChanceGame is deployed on the fork only. Run with:
///   forge test --match-contract ForkBallVault --fork-url $ROBINHOOD_RPC_URL -vv
/// Skipped when not on a chain-4663 fork.
contract ForkBallVaultTest is Test {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    address constant ENTROPY = 0xd8A0680e7699526B57140ED4EAfdCc7219Dc0A0c;
    address constant PROVIDER = 0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6;
    uint256 constant FRIEND = 7730; // hardwired Friend already used by Fork.t.sol

    function testRealGenerationsWrapFlow() public {
        if (block.chainid != 4663) {
            vm.skip(true);
            return;
        }
        uint256 price = 10e18;
        ChanceGame.Outcome[] memory table = new ChanceGame.Outcome[](7);
        uint16[7] memory chances = [uint16(3150), 2700, 2000, 1100, 700, 250, 100];
        uint256[7] memory multX10 = [uint256(0), 5, 10, 15, 25, 50, 100];
        for (uint256 i; i < 7; ++i) table[i] = ChanceGame.Outcome(chances[i], (price * multX10[i]) / 10, "");
        ChanceGame game = new ChanceGame(RF, GENERATIONS, ENTROPY, PROVIDER, "Ball", "BALL", price, table);
        deal(RF, address(this), 50_000e18);
        IERC20(RF).approve(address(game), type(uint256).max);
        game.fund(20_000e18);

        BallVault vault = new BallVault(IERC20(RF), address(this), makeAddr("edgeSplitter"), 250, "");
        uint256 edition = vault.addEdition(IVaultChanceGame(address(game)), "S1", "park");

        (bool ok, bytes memory data) = GENERATIONS.staticcall(abi.encodeWithSignature("tokenBoundAccount(uint256)", FRIEND));
        require(ok, "tokenBoundAccount");
        address tba = abi.decode(data, (address));
        deal(RF, tba, 1_000e18);

        vm.startPrank(tba);
        IERC20(RF).approve(address(game), type(uint256).max);
        IERC20(RF).approve(address(vault), type(uint256).max);
        game.buy(FRIEND, 20);
        (, uint256 batchId) = game.play(FRIEND, 20);
        vm.stopPrank();
        uint128 fee = IEntropyFee(ENTROPY).getFeeV2(PROVIDER, game.CALLBACK_GAS_LIMIT());
        vm.deal(address(this), uint256(fee) + 1 ether);
        uint64 sequence = game.requestRandomness{ value: fee }(batchId);
        vm.prank(ENTROPY); // the real Dice callback cannot arrive on a fork; deliver it as Entropy
        game._entropyCallback(sequence, PROVIDER, keccak256("fork"));
        for (uint256 id = batchId; id < batchId + 20; ++id) game.settle(id);

        uint256 outcome;
        uint256 held;
        for (uint256 o = 2; o <= 7; ++o) {
            uint256 b = game.balanceOf(tba, o);
            if (b > held) (outcome, held) = (o, b);
        }
        assertGt(held, 0);
        (, uint256 floor,) = game.outcomes(outcome);

        vm.startPrank(tba);
        vault.commitWrap(edition, FRIEND, outcome, 1);
        game.redeem(FRIEND, outcome, 1);
        uint256 wrapped = vault.wrap(edition, FRIEND, outcome, tba);
        vm.stopPrank();
        assertEq(vault.balanceOf(tba, wrapped), 1);
        assertEq(IERC20(RF).balanceOf(address(vault)), floor);

        // A stranger is not a controller under the real Generations.
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(BallVault.NotFriendController.selector);
        vault.commitWrap(edition, FRIEND, outcome, 1);
    }
}

interface IEntropyFee {
    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint128);
}
