// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test, console2 } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { EmissionVault } from "../src/EmissionVault.sol";
import { SkillCup, ISkillGenerations, ISkillToken } from "../src/SkillCup.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";
import { RewardsDistributor, IRewardsGenerations, IRewardsSkillCup } from "../src/RewardsDistributor.sol";
import { FixedPriceFeed } from "./Mocks.sol";

contract RewardsMockGenerations {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public tokenBoundAccount;
    mapping(uint256 => uint8) public generation;
    function set(uint256 id, address owner, address tba, uint8 gen) external {
        ownerOf[id] = owner; tokenBoundAccount[id] = tba; generation[id] = gen;
    }
}

/// Stand-in for SkillCup (entries + ENTRY_RF) that is also a sink ledger, with settable burns.
contract MockCupSink {
    uint256 public constant ENTRY_RF = 10e18;
    uint256 public immutable start;
    mapping(uint256 => uint256) public entryFriend;
    mapping(uint256 => uint256) public burnedInWeek;
    constructor(uint256 start_) { start = start_; }
    function setEntry(uint256 entryId, uint256 friendId) external { entryFriend[entryId] = friendId; }
    function addBurn(uint256 week, uint256 amount) external { burnedInWeek[week] += amount; }
}

abstract contract RewardsBase is Test {
    GBoot internal gboot;
    RewardsMockGenerations internal gens;
    MockCupSink internal cup;
    MockCupSink internal shopSink;
    FixedPriceFeed internal feed;
    RewardsDistributor internal dist;
    EmissionVault internal vault;
    address internal referee;
    uint256 internal refereeKey;
    uint256 internal start;

    uint256 internal constant FRIEND = 7730;
    address internal owner = address(0xA11CE);
    address internal tba = address(0x7BA);
    uint256 internal constant VAULT_FUNDS = 5_000_000e18;

    function _setUpRewards() internal {
        vm.warp(1_000_000);
        start = block.timestamp;
        (referee, refereeKey) = makeAddrAndKey("referee");
        gboot = new GBoot();
        gens = new RewardsMockGenerations();
        cup = new MockCupSink(start);
        shopSink = new MockCupSink(start);
        feed = new FixedPriceFeed();
        address[] memory sinks = new address[](2);
        (sinks[0], sinks[1]) = (address(cup), address(shopSink));
        dist = new RewardsDistributor(
            IERC20(address(gboot)), IRewardsGenerations(address(gens)), IRewardsSkillCup(address(cup)), IGBootPriceFeed(address(feed)),
            referee, start, 50_000e18, 52, sinks
        );
        vault = dist.vault();
        gboot.transfer(address(vault), VAULT_FUNDS);
        gens.set(FRIEND, owner, tba, 3);
    }

    function _claim(uint256 friendId, uint256 entryId, uint8 kind, uint256 rfValue, uint256 nonce)
        internal
        view
        returns (RewardsDistributor.RewardClaim memory c)
    {
        c = RewardsDistributor.RewardClaim(friendId, entryId, kind, rfValue, nonce, block.timestamp + 1 days);
    }

    function _sign(RewardsDistributor.RewardClaim memory c, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, dist.hashClaim(c));
        return abi.encodePacked(r, s, v);
    }

    function _sign(RewardsDistributor.RewardClaim memory c) internal view returns (bytes memory) {
        return _sign(c, refereeKey);
    }

    /// Burn `amount` in season 0 (week 0) and move to season 1.
    function _fundSeason1(uint256 amount) internal {
        cup.addBurn(0, amount);
        vm.warp(start + 4 weeks);
    }
}

contract RewardsDistributorTest is RewardsBase {
    event Claimed(
        uint256 indexed friendId, uint256 indexed entryId, uint8 kind, uint256 nonce, uint256 rfValue, uint256 gbootAmount, uint256 season, address to
    );
    event SeasonBudgetSet(uint256 indexed season, uint256 ceiling, uint256 sinkBurned, uint256 budget);

    function setUp() public {
        _setUpRewards();
    }

    // ───────────────────────────────────── happy path

    function testHappyPathPaysTokenBoundAccountAtTwap() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1.5e18, 42);
        bytes memory sig = _sign(c);
        vm.expectEmit(true, true, false, true, address(dist));
        emit Claimed(FRIEND, 1, 0, 42, 1.5e18, 15e18, 1, tba);
        vm.prank(address(0xB0B)); // anyone may submit; the TBA is paid
        uint256 paid = dist.claim(c, sig);
        assertEq(paid, 15e18, "1.5 RF at 0.1 RF per GBOOT");
        assertEq(gboot.balanceOf(tba), 15e18);
        assertEq(gboot.balanceOf(address(0xB0B)), 0);
        (bool set, uint128 budget, uint128 spent) = dist.seasons(1);
        assertTrue(set);
        assertEq(budget, 1_000e18, "min(ceiling 200k, burned 1k, balance)");
        assertEq(spent, 15e18);
        assertEq(dist.totalPaid(), 15e18);
        assertTrue(dist.nonceUsed(FRIEND, 42));
        assertEq(dist.entryRf(1), 1.5e18);
        assertEq(dist.dailyRf(FRIEND, dist.currentDay()), 1.5e18);
        assertEq(vault.released(4), 15e18, "released from the rewards vault in week 4");
    }

    /// Skill (kind 0) and streak (kind 1) on the same entry share the 2 RF per-entry cap.
    function testSkillPlusStreakOnOneEntry() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory a = _claim(FRIEND, 1, 0, 1.5e18, 4);
        RewardsDistributor.RewardClaim memory b = _claim(FRIEND, 1, 1, 0.5e18, 5);
        dist.claim(a, _sign(a));
        dist.claim(b, _sign(b));
        assertEq(gboot.balanceOf(tba), 20e18);
        assertEq(dist.entryRf(1), 2e18);
    }

    /// Rewards are RF-valued: the $GBOOT paid follows the TWAP (rounded down).
    function testRfValuedAtTwap() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        feed.setPrice(1e18); // 1 RF per GBOOT (10× launch)
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1.5e18, 1);
        assertEq(dist.claim(c, _sign(c)), 1.5e18);
        feed.setPrice(3e18);
        cup.setEntry(2, FRIEND);
        c = _claim(FRIEND, 2, 0, 1e18, 2);
        assertEq(dist.claim(c, _sign(c)), 333_333_333_333_333_333, "rounded down");
    }

    // ───────────────────────────────────── budget

    function testSeasonZeroHasNoBudget() public {
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.expectRevert(abi.encodeWithSelector(RewardsDistributor.OverBudget.selector, 0, 0, 10e18));
        dist.claim(c, sig);
    }

    function testBudgetIsMinOfCeilingBurnsAndBalance() public {
        assertEq(dist.seasonCeiling(0), 200_000e18, "4 x 50k");
        assertEq(dist.seasonCeiling(13), 100_000e18, "halved after 52 weeks");
        // Burns above the ceiling: the ceiling binds.
        cup.addBurn(1, 150_000e18);
        shopSink.addBurn(3, 150_000e18);
        cup.addBurn(4, 1e30); // season 1 burns count for season 2, not 1
        vm.warp(start + 4 weeks);
        vm.expectEmit(true, false, false, true, address(dist));
        emit SeasonBudgetSet(1, 200_000e18, 300_000e18, 200_000e18);
        assertEq(dist.setSeasonBudget(), 200_000e18);
        // Burns below the ceiling: the burns bind.
        cup.addBurn(4, 0);
        vm.warp(start + 8 weeks);
        assertEq(dist.sinkBurned(1), 1e30);
        assertEq(dist.setSeasonBudget(), 200_000e18);
    }

    function testBudgetCappedByVaultBalance() public {
        address[] memory sinks = new address[](1);
        sinks[0] = address(cup);
        RewardsDistributor poor = new RewardsDistributor(
            IERC20(address(gboot)), IRewardsGenerations(address(gens)), IRewardsSkillCup(address(cup)), IGBootPriceFeed(address(feed)),
            referee, start, 50_000e18, 52, sinks
        );
        gboot.transfer(address(poor.vault()), 7e18);
        cup.addBurn(0, 1_000e18);
        vm.warp(start + 4 weeks);
        assertEq(poor.setSeasonBudget(), 7e18);
    }

    function testSetSeasonBudgetIsPermissionlessAndFixedOnce() public {
        cup.addBurn(2, 500e18);
        vm.warp(start + 5 weeks);
        vm.prank(address(0xCAFE));
        assertEq(dist.setSeasonBudget(), 500e18);
        cup.addBurn(2, 10_000e18); // cannot happen with real sinks (past week); still ignored
        assertEq(dist.setSeasonBudget(), 500e18, "fixed once per season");
    }

    function testOverBudgetReverts() public {
        _fundSeason1(25e18);
        cup.setEntry(1, FRIEND);
        cup.setEntry(2, FRIEND);
        RewardsDistributor.RewardClaim memory a = _claim(FRIEND, 1, 0, 2e18, 1);
        dist.claim(a, _sign(a)); // 20 of 25
        RewardsDistributor.RewardClaim memory b = _claim(FRIEND, 2, 0, 1e18, 2);
        bytes memory sig = _sign(b);
        vm.expectRevert(abi.encodeWithSelector(RewardsDistributor.OverBudget.selector, 1, 25e18, 30e18));
        dist.claim(b, sig);
    }

    /// Unused budget does not roll over: next season's budget comes only from this season's burns.
    function testNoRollover() public {
        _fundSeason1(1_000e18);
        vm.warp(start + 8 weeks);
        assertEq(dist.setSeasonBudget(), 0, "nothing burned in season 1");
    }

    // ───────────────────────────────────── guards

    function testExpiredAndDeadlineTooFar() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.warp(c.deadline + 1);
        vm.expectRevert(RewardsDistributor.Expired.selector);
        dist.claim(c, sig);
        c.deadline = block.timestamp + 7 days + 1;
        sig = _sign(c);
        vm.expectRevert(RewardsDistributor.DeadlineTooFar.selector);
        dist.claim(c, sig);
    }

    function testReplayRejected() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        cup.setEntry(2, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 7);
        bytes memory sig = _sign(c);
        dist.claim(c, sig);
        vm.expectRevert(RewardsDistributor.NonceUsed.selector);
        dist.claim(c, sig);
        // The same nonce for another entry is also spent.
        RewardsDistributor.RewardClaim memory d = _claim(FRIEND, 2, 0, 1e18, 7);
        bytes memory sig2 = _sign(d);
        vm.expectRevert(RewardsDistributor.NonceUsed.selector);
        dist.claim(d, sig2);
    }

    function testBadKind() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 2, 1e18, 1); // 2 = daily login: not paid
        bytes memory sig = _sign(c);
        vm.expectRevert(RewardsDistributor.BadKind.selector);
        dist.claim(c, sig);
    }

    function testSignatureGuards() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 1);
        (, uint256 otherKey) = makeAddrAndKey("impostor");
        bytes memory wrong = _sign(c, otherKey);
        vm.expectRevert(RewardsDistributor.BadSignature.selector);
        dist.claim(c, wrong);
        // A valid signature over different values does not authorise a bigger claim.
        bytes memory sig = _sign(c);
        c.rfValue = 2e18;
        vm.expectRevert(RewardsDistributor.BadSignature.selector);
        dist.claim(c, sig);
        c.rfValue = 1e18;
        // Malleable (high-s) twin and malformed signatures are rejected.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refereeKey, dist.hashClaim(c));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory twin = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(RewardsDistributor.BadSignature.selector);
        dist.claim(c, twin);
        vm.expectRevert(RewardsDistributor.BadSignature.selector);
        dist.claim(c, abi.encodePacked(r, s));
        dist.claim(c, abi.encodePacked(r, s, v));
    }

    /// The signature is bound to this contract and chain (EIP-712 domain).
    function testSignatureBoundToDomain() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.chainId(1);
        vm.expectRevert(RewardsDistributor.BadSignature.selector);
        dist.claim(c, sig);
    }

    function testGenerationGuards() public {
        _fundSeason1(1_000e18);
        gens.set(5, owner, tba, 0);   // not hardwired
        gens.set(6, owner, tba, 5);   // cheap generation
        gens.set(4, owner, tba, 4);   // generation 4: allowed
        cup.setEntry(1, 5);
        cup.setEntry(2, 6);
        cup.setEntry(3, 4);
        RewardsDistributor.RewardClaim memory c = _claim(5, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.expectRevert(RewardsDistributor.NotHardwired.selector);
        dist.claim(c, sig);
        c = _claim(6, 2, 0, 1e18, 1);
        sig = _sign(c);
        vm.expectRevert(RewardsDistributor.GenerationTooLow.selector);
        dist.claim(c, sig);
        c = _claim(4, 3, 0, 1e18, 1);
        dist.claim(c, _sign(c));
        // Generation is read at claim time: a Friend that no longer qualifies cannot claim.
        cup.setEntry(4, FRIEND);
        gens.set(FRIEND, owner, tba, 6);
        c = _claim(FRIEND, 4, 0, 1e18, 1);
        sig = _sign(c);
        vm.expectRevert(RewardsDistributor.GenerationTooLow.selector);
        dist.claim(c, sig);
    }

    function testEntryGuards() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, 999); // someone else's entry
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.expectRevert(RewardsDistributor.UnknownEntry.selector);
        dist.claim(c, sig);
        c = _claim(FRIEND, 0, 0, 0, 2);
        sig = _sign(c);
        vm.expectRevert(RewardsDistributor.UnknownEntry.selector);
        dist.claim(c, sig);
        c = _claim(FRIEND, 77, 0, 1e18, 3); // no such entry
        sig = _sign(c);
        vm.expectRevert(RewardsDistributor.UnknownEntry.selector);
        dist.claim(c, sig);
    }

    function testEntryCap() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        RewardsDistributor.RewardClaim memory a = _claim(FRIEND, 1, 0, 1.5e18, 1);
        dist.claim(a, _sign(a));
        RewardsDistributor.RewardClaim memory b = _claim(FRIEND, 1, 1, 0.5e18 + 1, 2);
        bytes memory sig = _sign(b);
        vm.expectRevert(RewardsDistributor.EntryCap.selector);
        dist.claim(b, sig);
    }

    function testDailyCapResetsNextDay() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        cup.setEntry(2, FRIEND);
        cup.setEntry(3, FRIEND);
        RewardsDistributor.RewardClaim memory a = _claim(FRIEND, 1, 0, 2e18, 1);
        dist.claim(a, _sign(a));
        RewardsDistributor.RewardClaim memory b = _claim(FRIEND, 2, 0, 1e18 + 1, 2);
        bytes memory sig = _sign(b);
        vm.expectRevert(RewardsDistributor.DailyCap.selector);
        dist.claim(b, sig);
        b.rfValue = 1e18;
        dist.claim(b, _sign(b));
        vm.warp(block.timestamp + 1 days);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 3, 0, 2e18, 3);
        dist.claim(c, _sign(c));
        assertEq(gboot.balanceOf(tba), 50e18);
    }

    function testNoTokenBoundAccount() public {
        _fundSeason1(1_000e18);
        gens.set(8, owner, address(0), 2);
        cup.setEntry(1, 8);
        RewardsDistributor.RewardClaim memory c = _claim(8, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.expectRevert(RewardsDistributor.NoTokenBoundAccount.selector);
        dist.claim(c, sig);
    }

    /// Oracle guards propagate: no claim is paid without a TWAP.
    function testNoTwapNoClaim() public {
        _fundSeason1(1_000e18);
        cup.setEntry(1, FRIEND);
        feed.setBroken(true);
        RewardsDistributor.RewardClaim memory c = _claim(FRIEND, 1, 0, 1e18, 1);
        bytes memory sig = _sign(c);
        vm.expectRevert(bytes("oracle down"));
        dist.claim(c, sig);
    }

    /// Only the distributor can release from its vault: the operator is the contract itself.
    function testVaultOperatorIsTheDistributor() public {
        assertEq(vault.operator(), address(dist));
        assertEq(vault.start(), start);
        vm.prank(referee);
        vm.expectRevert(EmissionVault.NotOperator.selector);
        vault.release(referee, 1);
    }

    function testConstructorChecksSinks() public {
        MockCupSink late = new MockCupSink(start + 1);
        address[] memory sinks = new address[](1);
        sinks[0] = address(late);
        vm.expectRevert(RewardsDistributor.BadSinks.selector);
        new RewardsDistributor(
            IERC20(address(gboot)), IRewardsGenerations(address(gens)), IRewardsSkillCup(address(cup)), IGBootPriceFeed(address(feed)),
            referee, start, 50_000e18, 52, sinks
        );
        vm.expectRevert(RewardsDistributor.BadSinks.selector);
        new RewardsDistributor(
            IERC20(address(gboot)), IRewardsGenerations(address(gens)), IRewardsSkillCup(address(cup)), IGBootPriceFeed(address(feed)),
            referee, start, 50_000e18, 52, new address[](0)
        );
    }

    /// The EIP-712 type string the referee signs (verifier/src/rewards.ts) is exactly this one.
    function testTypehashAndDomain() public view {
        assertEq(
            dist.CLAIM_TYPEHASH(),
            keccak256("RewardClaim(uint256 friendId,uint256 entryId,uint8 kind,uint256 rfValue,uint256 nonce,uint256 deadline)")
        );
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Penalty Kings Rewards"),
                keccak256("1"),
                block.chainid,
                address(dist)
            )
        );
        assertEq(dist.domainSeparator(), expected);
    }

    /// Value per entry: the most any entry can earn (2 RF) is 20% of its 10 RF price and 40% of the
    /// 5 RF it burns; so an entry made only to farm rewards loses at least 8 RF (3 RF even if the
    /// entrant also wins back the whole 5 RF pot share).
    function testRewardPerEntryBelowEntryBurn() public view {
        uint256 maxPerEntry = cup.ENTRY_RF() * dist.ENTRY_CAP_BPS() / 10_000;
        assertEq(maxPerEntry, 2e18);
        assertLt(maxPerEntry, cup.ENTRY_RF() / 2, "below the burned half");
        assertLe(dist.DAILY_CAP_RF(), 2 * maxPerEntry, "a day's cap needs >= 2 paid entries");
    }

    // ───────────────────────────────────── fuzz

    /// Any sequence of claims for one Friend on one day never passes the daily cap, and no entry
    /// passes its cap.
    function testFuzzCaps(uint256[8] memory values, uint256[8] memory entrySeeds) public {
        _fundSeason1(1_000_000e18);
        for (uint256 i = 1; i <= 4; ++i) cup.setEntry(i, FRIEND);
        uint256 day = dist.currentDay();
        for (uint256 i; i < 8; ++i) {
            RewardsDistributor.RewardClaim memory c =
                _claim(FRIEND, 1 + entrySeeds[i] % 4, uint8(i % 2), bound(values[i], 0, 3e18), 100 + i);
            try dist.claim(c, _sign(c)) { } catch { }
            assertLe(dist.dailyRf(FRIEND, day), dist.DAILY_CAP_RF());
        }
        for (uint256 e = 1; e <= 4; ++e) assertLe(dist.entryRf(e), 2e18);
        assertLe(gboot.balanceOf(tba), 3e18 * 1e18 / feed.rfPerGbootWad());
    }

    /// Whatever the burns, prices and claims, a season never pays more than its budget, and the
    /// budget never exceeds the halving ceiling or the previous season's burns.
    function testFuzzBudget(uint256 burned, uint256 price, uint256[6] memory values) public {
        burned = bound(burned, 0, 400_000e18);
        price = bound(price, 1e15, 1e19);
        cup.addBurn(2, burned);
        vm.warp(start + 4 weeks);
        feed.setPrice(price);
        for (uint256 i; i < 6; ++i) {
            uint256 friendId = 100 + i;
            gens.set(friendId, owner, tba, 1);
            cup.setEntry(i + 1, friendId);
            RewardsDistributor.RewardClaim memory c = _claim(friendId, i + 1, 0, bound(values[i], 0, 2e18), i);
            try dist.claim(c, _sign(c)) { } catch { }
        }
        dist.setSeasonBudget();
        (, uint128 budget, uint128 paid) = dist.seasons(1);
        assertLe(paid, budget);
        assertLe(budget, burned);
        assertLe(budget, dist.seasonCeiling(1));
        assertEq(gboot.balanceOf(tba), paid);
    }
}

/// Real SkillCup → sink ledger → next season's budget → a referee-signed claim for that entry.
contract RewardsIntegrationTest is Test {
    GBoot internal gboot;
    RewardsMockGenerations internal gens;
    FixedPriceFeed internal feed;
    SkillCup internal cup;
    RewardsDistributor internal dist;
    address internal referee;
    uint256 internal key;
    uint256 internal start;
    address internal player = address(0xA11CE);
    address internal tba = address(0x7BA);

    function setUp() public {
        vm.warp(1_000_000);
        start = block.timestamp;
        (referee, key) = makeAddrAndKey("referee");
        gboot = new GBoot();
        gens = new RewardsMockGenerations();
        feed = new FixedPriceFeed();
        gens.set(7730, player, tba, 3);
        cup = new SkillCup(ISkillGenerations(address(gens)), ISkillToken(address(gboot)), IGBootPriceFeed(address(feed)), address(0x9097), start);
        address[] memory sinks = new address[](1);
        sinks[0] = address(cup);
        dist = new RewardsDistributor(
            IERC20(address(gboot)), IRewardsGenerations(address(gens)), IRewardsSkillCup(address(cup)), IGBootPriceFeed(address(feed)),
            referee, start, 50_000e18, 52, sinks
        );
        gboot.transfer(address(dist.vault()), 1_000_000e18);
        gboot.transfer(player, 10_000e18);
        vm.prank(player);
        gboot.approve(address(cup), type(uint256).max);
    }

    function testRealSkillCupEntryFundsAndUnlocksReward() public {
        vm.startPrank(player);
        for (uint256 i; i < 3; ++i) { cup.enter(7730, 100e18); vm.warp(block.timestamp + 1 hours); }
        vm.stopPrank();
        assertEq(dist.sinkBurned(0), 150e18, "3 entries x 50 burned");
        // Season 1: an entry this season, rewarded from season 0's burns.
        vm.warp(start + 4 weeks);
        vm.prank(player);
        uint256 entryId = cup.enter(7730, 100e18);
        RewardsDistributor.RewardClaim memory c = RewardsDistributor.RewardClaim(7730, entryId, 0, 2e18, entryId * 4, block.timestamp + 3 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, dist.hashClaim(c));
        assertEq(dist.claim(c, abi.encodePacked(r, s, v)), 20e18);
        assertEq(gboot.balanceOf(tba), 20e18);
        (, uint128 budget, uint128 paid) = dist.seasons(1);
        assertEq(budget, 150e18);
        assertEq(paid, 20e18);
        // The player paid 400 $GBOOT (200 burned) and received 20: rewards never pay for entries.
        assertEq(gboot.balanceOf(player), 10_000e18 - 400e18);
    }
}

/// Invariant: the total paid never exceeds the sum of the season budgets, each season stays within
/// its own budget, and every $GBOOT paid left the rewards vault.
contract RewardsHandler is Test {
    RewardsDistributor internal dist;
    MockCupSink internal cup;
    FixedPriceFeed internal feed;
    RewardsMockGenerations internal gens;
    uint256 internal key;
    uint256 public entries;
    uint256 public nonce;
    uint256 public maxSeason;
    uint256 public paidClaims;

    constructor(RewardsDistributor dist_, MockCupSink cup_, FixedPriceFeed feed_, RewardsMockGenerations gens_, uint256 key_) {
        (dist, cup, feed, gens, key) = (dist_, cup_, feed_, gens_, key_);
    }

    function _track() internal {
        uint256 s = dist.currentSeason();
        if (s > maxSeason) maxSeason = s;
    }

    function burn(uint256 amount) external {
        cup.addBurn(dist.vault().currentWeek(), bound(amount, 0, 300_000e18));
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 20 days));
        _track();
    }

    function setPrice(uint256 p) external {
        feed.setPrice(bound(p, 1e15, 1e19));
    }

    function setBudget() external {
        dist.setSeasonBudget();
        _track();
    }

    function claim(uint256 friendSeed, uint256 rf, uint8 kind, bool reuseNonce) external {
        uint256 friendId = 1 + friendSeed % 5;
        gens.set(friendId, address(this), address(uint160(0x7BA0 + friendId)), uint8(1 + friendSeed % 4));
        cup.setEntry(++entries, friendId);
        uint256 n = reuseNonce && nonce > 0 ? nonce : ++nonce;
        RewardsDistributor.RewardClaim memory c =
            RewardsDistributor.RewardClaim(friendId, entries, kind % 3, bound(rf, 0, 3e18), n, block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, dist.hashClaim(c));
        try dist.claim(c, abi.encodePacked(r, s, v)) returns (uint256 amount) { if (amount > 0) ++paidClaims; } catch { }
        _track();
    }
}

contract RewardsInvariantTest is RewardsBase {
    RewardsHandler internal handler;

    function setUp() public {
        _setUpRewards();
        handler = new RewardsHandler(dist, cup, feed, gens, refereeKey);
        // Background sink activity so most seasons have a budget; the handler adds random burns on top.
        for (uint256 w; w < 40; ++w) cup.addBurn(w, 20_000e18);
        vm.warp(start + 4 weeks);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 60
    function invariant_totalPaidWithinBudget() public view {
        uint256 budgets;
        uint256 paidSum;
        for (uint256 s; s <= handler.maxSeason(); ++s) {
            (, uint128 budget, uint128 paid) = dist.seasons(s);
            assertLe(paid, budget, "season within its budget");
            assertLe(budget, dist.seasonCeiling(s), "budget within the halving ceiling");
            budgets += budget;
            paidSum += paid;
        }
        assertEq(paidSum, dist.totalPaid());
        assertLe(dist.totalPaid(), budgets, "total paid <= sum of budgets");
        assertEq(gboot.balanceOf(address(vault)), VAULT_FUNDS - dist.totalPaid(), "every payment came from the vault");
    }

    function afterInvariant() public view {
        console2.log("paid claims in this run", handler.paidClaims(), "total paid", dist.totalPaid());
    }
}
