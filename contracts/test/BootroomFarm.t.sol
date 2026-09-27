// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { Bootroom, IBootroomGenerations } from "../src/Bootroom.sol";
import { BootroomMockGenerations } from "./Bootroom.t.sol";

/// "Farm test": can a player extract more than 93% of the RF they spend by lacing $GBOOT in the loop
///  buy balls → GBOOT drops → sell GBOOT → buy balls ...?
///
/// Round 6: lacing no longer boosts any payout. The Bootroom only gives a perk tier (cosmetics, XP,
/// Cup seeding); race points and drops are the same for every Friend. This is an analytical test
/// driven by the REAL Bootroom state (any lace, any tier). Assumptions (all favour the farmer):
///  - Ball odds and RF rewards are games/penalty-kings/game.json (Park; Pro/Champions scale the
///    same table by price): expected RF return 90% of the price.
///  - Drops per ball = TIERS.baseDrop × rarity dropMult, with baseDrop from
///    games/penalty-kings/economy.ts (Park 0.93, Pro 93, Champions 930 GBOOT) and dropMult from
///    RARITIES (1, 1.5, 2, 3, 5, 8, 15); expected dropMult = 2.15. No lacing multiplier exists.
///  - Every GBOOT is sold at the launch price 0.1 RF / GBOOT with NO pool fee, NO slippage and NO
///    price impact (the real pool burns 1% and moves against a seller, so reality is worse).
///  - The weekly caps (the drop base auto-scales with the TWAP, the EmissionVault season cap) are
///    ignored; they can only lower drops.
///  - The GBOOT laced is bought and later sold at the launch price and waits out the full lock
///    (no 50% early-unlace burn), i.e. the lace capital is free apart from time.
/// Result: the expected value per ball is 90% + 2% × (0.93 × 2.15 / 2) = 91.9995% of the price for
/// EVERY lace (tier 0 … 3), ≤ 93%.
contract BootroomFarmTest is Test {
    GBoot internal gboot;
    BootroomMockGenerations internal gens;
    Bootroom internal room;
    address internal farmer = address(0xFA53);
    uint256 internal constant FRIEND = 7730;

    uint256 internal constant BPS = 10_000;
    /// 0.1 RF per GBOOT: RF value = GBOOT × 1 / 10.
    uint256 internal constant PRICE_NUM = 1;
    uint256 internal constant PRICE_DEN = 10;

    // game.json outcomes (chance in bps; RF reward per 10 RF Park ball, as a fraction ×10 of price).
    uint256[7] internal chanceBps = [uint256(3_150), 2_700, 2_000, 1_100, 700, 250, 100];
    uint256[7] internal rewardX10 = [uint256(0), 5, 10, 15, 25, 50, 100]; // reward = price × x / 10
    uint256[7] internal dropMultX100 = [uint256(100), 150, 200, 300, 500, 800, 1_500];

    // economy.ts TIERS: price in RF, baseDrop in GBOOT (×100 to keep 0.93 integral).
    uint256[3] internal tierPriceRf = [uint256(10), 1_000, 10_000];
    uint256[3] internal tierBaseDropX100 = [uint256(93), 9_300, 93_000];

    function setUp() public {
        gboot = new GBoot();
        gens = new BootroomMockGenerations();
        room = new Bootroom(IERC20(address(gboot)), IBootroomGenerations(address(gens)));
        gens.set(FRIEND, farmer, address(0));
        gboot.transfer(farmer, 10_000_000e18);
        vm.prank(farmer);
        gboot.approve(address(room), type(uint256).max);
    }

    /// Expected RF value (wei) per ball of tier `t`, split into the RF return and the drop value,
    /// computed exactly over the outcome table. Drops take no Bootroom input any more.
    function _evPerBall(uint256 t) internal view returns (uint256 rfReturn, uint256 dropValue) {
        uint256 price = tierPriceRf[t] * 1e18;
        for (uint256 i; i < 7; ++i) {
            rfReturn += chanceBps[i] * (price * rewardX10[i] / 10) / BPS;
            // GBOOT wei = baseDrop × mult; × chance; → RF at 0.1.
            uint256 gbootWei = tierBaseDropX100[t] * 1e18 / 100 * dropMultX100[i] / 100;
            dropValue += chanceBps[i] * gbootWei * PRICE_NUM / PRICE_DEN / BPS;
        }
    }

    function _laceMax() internal {
        uint256 maxLace = room.MAX_LACE();
        uint256 maxWeeks = room.MAX_WEEKS();
        vm.prank(farmer); // after the view calls: a prank applies to the next external call only
        room.lace(FRIEND, maxLace, maxWeeks);
    }

    /// Sanity: the economy tables really give a 90% RF return and a 2.15 average drop multiplier.
    function testModelInputs() public view {
        uint256 chanceSum; uint256 multSum;
        for (uint256 i; i < 7; ++i) { chanceSum += chanceBps[i]; multSum += chanceBps[i] * dropMultX100[i]; }
        assertEq(chanceSum, BPS);
        assertEq(multSum, 2_150_000, "E[dropMult] = 2.15");
        for (uint256 t; t < 3; ++t) {
            (uint256 rfReturn, uint256 drops) = _evPerBall(t);
            assertEq(rfReturn, tierPriceRf[t] * 1e18 * 90 / 100, "90% RF return");
            // Drop ≈ 2% of the price (0.93 × 2.15 = 1.9995 GBOOT per 10 RF of price ×0.1).
            assertEq(drops, tierPriceRf[t] * 1e18 * 19_995 / 1_000_000);
        }
    }

    /// The core bound: RF return + drops ≤ 93% of the ball price (exactly 91.9995%), with the Friend
    /// laced to the maximum perk tier. The tier changes nothing a ball pays.
    function testMaxLacedBallValueAtMost93Percent() public {
        _laceMax();
        assertEq(room.perkTier(FRIEND), 3, "maximum perk tier");
        for (uint256 t; t < 3; ++t) {
            uint256 price = tierPriceRf[t] * 1e18;
            (uint256 rfReturn, uint256 dropValue) = _evPerBall(t);
            assertLe(dropValue, price * 2 / 100, "drops <= 2% of the ball price");
            assertLe(rfReturn + dropValue, price * 93 / 100, "ball + drops <= 93%");
            assertEq(rfReturn + dropValue, price * 919_995 / 1_000_000, "exactly 91.9995%");
        }
    }

    /// Over-lacing (1M GBOOT) or stacking laces cannot push past the bound: there is nothing to push.
    function testOverLacingDoesNotHelp() public {
        vm.startPrank(farmer);
        room.lace(FRIEND, 1_000_000e18, 52);
        room.lace(FRIEND, 5_000_000e18, 52);
        vm.stopPrank();
        assertEq(room.perkTier(FRIEND), 3);
        (uint256 r, uint256 d) = _evPerBall(2);
        assertLe(r + d, tierPriceRf[2] * 1e18 * 93 / 100);
    }

    /// Any lace configuration (amount, weeks, time since lacing), every tier: <= 93%, and the value
    /// per ball is identical to an unlaced Friend's.
    function testFuzzAnyLaceAtMost93Percent(uint256 amount, uint256 lockWeeks, uint256 elapsed, uint256 t) public {
        amount = bound(amount, 1, 10_000_000e18);
        lockWeeks = bound(lockWeeks, 1, 52);
        elapsed = bound(elapsed, 0, 60 weeks);
        t = bound(t, 0, 2);
        (uint256 r0, uint256 d0) = _evPerBall(t);
        vm.prank(farmer);
        room.lace(FRIEND, amount, lockWeeks);
        vm.warp(block.timestamp + elapsed);
        assertLe(room.perkTier(FRIEND), 3);
        (uint256 r, uint256 d) = _evPerBall(t);
        assertEq(r + d, r0 + d0, "lacing does not change the value of a ball");
        assertLe(r + d, tierPriceRf[t] * 1e18 * 93 / 100);
    }

    /// The loop itself: start with a bankroll, lace 10k GBOOT (bought at 0.1 = 1,000 RF) for the max
    /// tier, then repeatedly spend everything on Champions balls, receive the expected RF return and
    /// expected drops, sell the drops at 0.1 with no fee, and go again. After the 52-week lock the lace
    /// is sold back at 0.1 (no loss). Total RF extracted never exceeds 93% of total RF spent, and the
    /// bankroll only shrinks.
    function testFarmLoopNeverProfitable() public {
        uint256 bankroll = 1_000_000e18;
        uint256 laceCost = room.MAX_LACE() * PRICE_NUM / PRICE_DEN; // 1,000 RF
        bankroll -= laceCost;
        _laceMax();
        uint256 price = tierPriceRf[2] * 1e18;
        (uint256 rfPerBall, uint256 dropPerBall) = _evPerBall(2);

        uint256 spent; uint256 extracted;
        for (uint256 round; round < 200 && bankroll >= price; ++round) {
            uint256 balls = bankroll / price;
            uint256 cost = balls * price;
            uint256 back = balls * (rfPerBall + dropPerBall);
            spent += cost; extracted += back;
            uint256 next = bankroll - cost + back;
            assertLt(next, bankroll, "every round loses RF");
            bankroll = next;
        }
        assertLe(extracted * 100, spent * 93, "extracted <= 93% of spent");
        vm.warp(block.timestamp + 52 weeks);
        uint256 before = gboot.balanceOf(farmer);
        vm.prank(farmer);
        room.unlace(FRIEND);
        assertEq(gboot.balanceOf(farmer) - before, room.MAX_LACE(), "lace returned in full after expiry");
        bankroll += laceCost;
        assertLt(bankroll, 1_000_000e18, "the farmer ends with less RF than they started");
    }

    /// Recycling the lace capital early (to buy more balls) burns half of it: strictly worse.
    function testEarlyUnlaceRecycleLoses() public {
        _laceMax();
        vm.prank(farmer);
        room.unlace(FRIEND);
        assertEq(room.perkTier(FRIEND), 0, "perk gone");
        assertEq(gboot.balanceOf(farmer), 10_000_000e18 - 10_000e18 / 2, "half the lace burned");
    }
}
