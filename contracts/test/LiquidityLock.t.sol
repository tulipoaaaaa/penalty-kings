// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { GBoot } from "../src/GBoot.sol";
import { LiquidityLock, IPositionManager } from "../src/LiquidityLock.sol";

/// PositionManager stand-in that behaves like v4's for the lock's two actions: only the NFT owner may
/// modify, DECREASE_LIQUIDITY(0) + TAKE_PAIR pays the position's accrued fees to the given recipient.
/// Optionally re-enters the lock from inside modifyLiquidities (a hostile PositionManager).
contract FeePositionManager {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public owed;
    bytes public lastUnlockData;
    bool public reenter;
    bytes public reentryError;

    function mint(address to, uint256 tokenId) external { ownerOf[tokenId] = to; }
    function setReenter(bool on) external { reenter = on; }

    /// Fees accrue in the PM (the test transfers the tokens here first).
    function accrue(address currency, uint256 amount) external { owed[currency] += amount; }

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable {
        lastUnlockData = unlockData;
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(keccak256(actions) == keccak256(hex"0111"), "actions");
        (uint256 tokenId, uint256 liquidity,,,) = abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        require(liquidity == 0, "must not remove liquidity");
        require(ownerOf[tokenId] == msg.sender, "not approved");
        if (reenter) {
            try LiquidityLock(msg.sender).collect(tokenId) { reentryError = "none"; }
            catch (bytes memory err) { reentryError = err; }
        }
        (address c0, address c1, address to) = abi.decode(params[1], (address, address, address));
        uint256 a0 = owed[c0];
        uint256 a1 = owed[c1];
        owed[c0] = 0;
        owed[c1] = 0;
        if (a0 > 0) IERC20(c0).transfer(to, a0);
        if (a1 > 0) IERC20(c1).transfer(to, a1);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from && msg.sender == from, "not owner");
        ownerOf[tokenId] = to;
    }
}

/// A burnable token whose burn() tries to re-enter the lock (a hostile currency).
contract ReentrantToken is ERC20 {
    LiquidityLock public lock;
    bytes public reentryError;

    constructor() ERC20("Hostile", "HOST") { _mint(msg.sender, 1e30); }
    function setLock(LiquidityLock lock_) external { lock = lock_; }

    function burn(uint256 amount) external {
        if (address(lock) != address(0)) {
            try lock.collect(42) { reentryError = "none"; }
            catch (bytes memory err) { reentryError = err; }
        }
        _burn(msg.sender, amount);
    }
}

contract LiquidityLockTest is Test {
    FeePositionManager internal pm;
    LiquidityLock internal lock;
    GBoot internal rf;
    GBoot internal gboot;
    address internal beneficiary = address(0xB0B);
    address internal pot = address(0xC0FFEE);
    uint256 internal unlockAt;

    function setUp() public {
        pm = new FeePositionManager();
        rf = new GBoot(); // a burnable stand-in for RF (RF.burn(uint256) is verified on-chain)
        gboot = new GBoot();
        unlockAt = block.timestamp + 180 days;
        lock = new LiquidityLock(IPositionManager(address(pm)), beneficiary, unlockAt, address(rf), address(gboot), pot);
        pm.mint(address(lock), 42);
    }

    function _accrue(uint256 rfFees, uint256 gbootFees) internal {
        rf.transfer(address(pm), rfFees);
        gboot.transfer(address(pm), gbootFees);
        pm.accrue(address(rf), rfFees);
        pm.accrue(address(gboot), gbootFees);
    }

    // ── lock semantics (unchanged) ──

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

    function testReceivesNft() public view {
        assertEq(lock.onERC721Received(address(0), address(0), 1, ""), LiquidityLock.onERC721Received.selector);
    }

    function testConfigSortedAndChecked() public {
        (address c0, address c1) = address(rf) < address(gboot) ? (address(rf), address(gboot)) : (address(gboot), address(rf));
        assertEq(lock.currency0(), c0);
        assertEq(lock.currency1(), c1);
        assertEq(lock.pot(), pot);
        assertEq(lock.BURN_BPS(), 5_000);
        IPositionManager p = IPositionManager(address(pm));
        vm.expectRevert(LiquidityLock.BadConfig.selector);
        new LiquidityLock(p, beneficiary, unlockAt, address(rf), address(rf), pot);
        vm.expectRevert(LiquidityLock.BadConfig.selector);
        new LiquidityLock(p, beneficiary, unlockAt, address(0), address(gboot), pot);
        vm.expectRevert(LiquidityLock.BadConfig.selector);
        new LiquidityLock(p, beneficiary, unlockAt, address(rf), address(gboot), address(0));
    }

    // ── collect: 50% burned / 50% to the pot, both sides ──

    function testCollectSplitsBothSidesAndIsPermissionless() public {
        _accrue(7e18, 3e18);
        uint256 rfSupply = rf.totalSupply();
        uint256 gbootSupply = gboot.totalSupply();
        address anyone = address(0xBEEF);
        vm.prank(anyone);
        lock.collect(42);
        (bytes memory actions, bytes[] memory params) = abi.decode(pm.lastUnlockData(), (bytes, bytes[]));
        assertEq(actions, hex"0111");
        (address a0, address a1, address to) = abi.decode(params[1], (address, address, address));
        assertEq(a0, lock.currency0()); assertEq(a1, lock.currency1());
        assertEq(to, address(lock), "fees come to the lock, never to the caller");
        assertEq(rf.totalSupply(), rfSupply - 3.5e18, "RF: 50% burned");
        assertEq(gboot.totalSupply(), gbootSupply - 1.5e18, "GBOOT: 50% burned");
        assertEq(rf.balanceOf(pot), 3.5e18, "RF: 50% to the pot");
        assertEq(gboot.balanceOf(pot), 1.5e18, "GBOOT: 50% to the pot");
        assertEq(rf.balanceOf(anyone) + gboot.balanceOf(anyone), 0, "the caller gets nothing");
        assertEq(rf.balanceOf(address(lock)) + gboot.balanceOf(address(lock)), 0, "no residue");
        assertEq(pm.ownerOf(42), address(lock), "position stays locked");
    }

    function testCollectEmitsTheSplit() public {
        _accrue(5, 4);
        (uint256 rfIs0) = lock.currency0() == address(rf) ? 1 : 0;
        vm.expectEmit(true, false, false, true, address(lock));
        if (rfIs0 == 1) emit LiquidityLock.FeesCollected(42, address(rf), 2, 3, address(gboot), 2, 2);
        else emit LiquidityLock.FeesCollected(42, address(gboot), 2, 2, address(rf), 2, 3);
        lock.collect(42);
    }

    function testOddWeiGoesToThePot() public {
        _accrue(1, 3);
        lock.collect(42);
        assertEq(rf.balanceOf(pot), 1, "1 wei: burned 0, pot 1");
        assertEq(gboot.balanceOf(pot), 2, "3 wei: burned 1, pot 2");
        assertEq(rf.balanceOf(address(lock)) + gboot.balanceOf(address(lock)), 0);
    }

    function testCollectWithNoFeesIsANoop() public {
        uint256 s0 = rf.totalSupply();
        (uint256 b0, uint256 p0, uint256 b1, uint256 p1) = lock.collect(42);
        assertEq(b0 + p0 + b1 + p1, 0);
        assertEq(rf.totalSupply(), s0);
    }

    function testStrayTransferIsSplitToo() public {
        rf.transfer(address(lock), 10e18); // a donation sits in the lock until the next collect
        lock.collect(42);
        assertEq(rf.balanceOf(pot), 5e18);
        assertEq(rf.balanceOf(address(lock)), 0);
    }

    function testCollectOnAPositionTheLockDoesNotOwnReverts() public {
        pm.mint(address(0xDEAD), 7);
        vm.expectRevert(bytes("not approved"));
        lock.collect(7);
    }

    function testFuzzFeesInEqualBurnedPlusPot(uint256 rfFees, uint256 gbootFees, address caller) public {
        rfFees = bound(rfFees, 0, 1_000_000e18);
        gbootFees = bound(gbootFees, 0, 1_000_000e18);
        vm.assume(caller != pot && caller != address(lock) && caller != address(this) && caller != address(pm));
        _accrue(rfFees, gbootFees);
        uint256 rfSupply = rf.totalSupply();
        uint256 gbootSupply = gboot.totalSupply();
        vm.prank(caller);
        lock.collect(42);
        uint256 rfBurned = rfSupply - rf.totalSupply();
        uint256 gbootBurned = gbootSupply - gboot.totalSupply();
        assertEq(rfBurned + rf.balanceOf(pot), rfFees, "RF: in == burned + pot");
        assertEq(gbootBurned + gboot.balanceOf(pot), gbootFees, "GBOOT: in == burned + pot");
        assertEq(rfBurned, rfFees / 2, "burn rounds down");
        assertEq(gbootBurned, gbootFees / 2, "burn rounds down");
        assertLe(rf.balanceOf(pot) - rfBurned, 1, "pot gets at most the odd wei more");
        assertEq(rf.balanceOf(address(lock)) + gboot.balanceOf(address(lock)), 0, "no residue");
        assertEq(rf.balanceOf(caller) + gboot.balanceOf(caller), 0, "caller gets nothing");
    }

    function testFuzzSplitOf(uint256 amount) public view {
        amount = bound(amount, 0, type(uint256).max / 10_000);
        (uint256 burned, uint256 toPot) = lock.splitOf(amount);
        assertEq(burned + toPot, amount);
        assertEq(burned, amount / 2);
        assertTrue(toPot == burned || toPot == burned + 1);
    }

    // ── reentrancy ──

    function testReentryFromThePositionManagerIsRejected() public {
        _accrue(4e18, 2e18);
        pm.setReenter(true);
        lock.collect(42);
        assertEq(pm.reentryError(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(rf.balanceOf(pot), 2e18, "paid exactly once");
        assertEq(gboot.balanceOf(pot), 1e18, "paid exactly once");
    }

    function testReentryFromAHostileCurrencyIsRejected() public {
        ReentrantToken host = new ReentrantToken();
        LiquidityLock hostileLock = new LiquidityLock(IPositionManager(address(pm)), beneficiary, unlockAt, address(host), address(gboot), pot);
        pm.mint(address(hostileLock), 42);
        host.setLock(hostileLock);
        host.transfer(address(pm), 10e18);
        pm.accrue(address(host), 10e18);
        hostileLock.collect(42);
        assertEq(host.reentryError(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(host.balanceOf(pot), 5e18, "split once");
        assertEq(host.balanceOf(address(hostileLock)), 0);
    }
}

/// Invariant handler: fees accrue, strangers donate, anyone collects, strangers try to withdraw.
contract LockHandler is Test {
    FeePositionManager public pm;
    LiquidityLock public lock;
    GBoot public rf;
    GBoot public gboot;
    address public constant POT = address(0xC0FFEE);
    uint256 public in0;
    uint256 public in1;
    uint256 public collects;

    constructor() {
        pm = new FeePositionManager();
        rf = new GBoot();
        gboot = new GBoot();
        lock = new LiquidityLock(IPositionManager(address(pm)), address(0xB0B), block.timestamp + 180 days, address(rf), address(gboot), POT);
        pm.mint(address(lock), 42);
    }

    function accrue(uint256 a, uint256 b) external {
        a = bound(a, 0, 100_000e18);
        b = bound(b, 0, 100_000e18);
        rf.transfer(address(pm), a); pm.accrue(address(rf), a);
        gboot.transfer(address(pm), b); pm.accrue(address(gboot), b);
        in0 += a; in1 += b;
    }

    function donate(uint256 a) external {
        a = bound(a, 0, 1_000e18);
        rf.transfer(address(lock), a);
        in0 += a;
    }

    function collect(address caller) external {
        vm.prank(caller);
        lock.collect(42);
        collects++;
        assertEq(rf.balanceOf(address(lock)) + gboot.balanceOf(address(lock)), 0, "no residue after collect");
    }

    function tryWithdraw(address caller) external {
        vm.prank(caller);
        try lock.withdraw(42) { revert("withdrew before unlock"); } catch { }
    }
}

contract LiquidityLockInvariantTest is Test {
    LockHandler internal h;

    function setUp() public {
        h = new LockHandler();
        targetContract(address(h));
    }

    /// Every fee (and stray token) that ever reached the lock's position is burned, in the pot, or
    /// still waiting (in the PM or the lock) — nothing is lost, nothing goes elsewhere.
    function invariant_feesInEqualBurnedPlusPotPlusPending() public view {
        GBoot rf = h.rf();
        GBoot gboot = h.gboot();
        address lock = address(h.lock());
        uint256 burned0 = 100_000_000e18 - rf.totalSupply();
        uint256 burned1 = 100_000_000e18 - gboot.totalSupply();
        assertEq(burned0 + rf.balanceOf(h.POT()) + rf.balanceOf(lock) + h.pm().owed(address(rf)), h.in0());
        assertEq(burned1 + gboot.balanceOf(h.POT()) + gboot.balanceOf(lock) + h.pm().owed(address(gboot)), h.in1());
        // Burned ≤ pot on each side, and never by more than one wei per collect.
        assertLe(burned0, rf.balanceOf(h.POT()));
        assertLe(rf.balanceOf(h.POT()) - burned0, h.collects());
        assertLe(burned1, gboot.balanceOf(h.POT()));
        assertLe(gboot.balanceOf(h.POT()) - burned1, h.collects());
    }

    function invariant_positionStaysLocked() public view {
        assertEq(h.pm().ownerOf(42), address(h.lock()));
    }
}
