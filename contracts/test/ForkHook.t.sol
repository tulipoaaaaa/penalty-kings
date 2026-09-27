// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { GBoot } from "../src/GBoot.sol";
import { GBootFeeHook } from "../src/GBootFeeHook.sol";
import { GBootPriceFeed } from "../src/GBootPriceFeed.sol";
import { PoolSwapper } from "../src/PoolSwapper.sol";
import { KitShop, IGBoot } from "../src/KitShop.sol";
import { SkillCup, ISkillGenerations, ISkillToken } from "../src/SkillCup.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";
import { PoolKey, IPoolManager, IPositionManagerFull, IPermit2 } from "../src/interfaces/IUniswapV4.sol";

interface IStateView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/// Mainnet-fork tests of the (not deployed) fee hook + TWAP oracle against the real Uniswap v4
/// PoolManager on Robinhood Chain: fees are burned on BOTH sides, the hook's slot0 read matches
/// StateView, the TWAP follows swaps, resists a one-block pump, and the sinks price in RF from it.
///   forge test --match-contract Fork --fork-url https://rpc.mainnet.chain.robinhood.com
contract ForkHookTest is Test {
    address constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    /// RF/WETH v4 pool id (docs/ADDRESSES.md, allowlisted).
    bytes32 constant RF_WETH_POOL = 0x9116440ebd86be5f0b850524a0d52a97399c68027d3590fa3526e1039dda2240;
    address internal burner = makeAddr("burner");

    GBoot internal gboot;
    GBootFeeHook internal hook;
    PoolSwapper internal swapper;
    PoolKey internal key;
    bytes32 internal id;
    bool internal gbootIs0;

    function setUp() public {
        address hookAddress = address(uint160(0x4444) << 144 | uint160(0x10C4));
        deployCodeTo("GBootFeeHook.sol:GBootFeeHook", abi.encode(POOL_MANAGER), hookAddress);
        hook = GBootFeeHook(hookAddress);
        vm.startPrank(burner);
        gboot = new GBoot();
        swapper = new PoolSwapper(IPoolManager(POOL_MANAGER));
        gbootIs0 = address(gboot) < RF;
        key = PoolKey(gbootIs0 ? address(gboot) : RF, gbootIs0 ? RF : address(gboot), 0, 200, hookAddress);
        id = keccak256(abi.encode(key));
        // The launch plan (scripts/onchain/pool-plan.mjs): start at ≈ 0.10027 RF per $GBOOT, 55M-style
        // single-sided position (1e24 liquidity here).
        (uint160 sqrtStart, int24 lower, int24 upper) = gbootIs0
            ? (uint160(25_087_991_844_255_625_192_629_315_791), int24(-23_000), int24(46_000))
            : (uint160(250_203_434_948_259_642_083_317_319_084), int24(-46_000), int24(23_000));
        gboot.approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(address(gboot), POSITION_MANAGER, type(uint160).max, uint48(block.timestamp + 1 days));
        IPositionManagerFull pm = IPositionManagerFull(POSITION_MANAGER);
        pm.initializePool(key, sqrtStart);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(1e24), type(uint128).max, type(uint128).max, burner, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(abi.encodePacked(uint8(0x02), uint8(0x0d)), params), block.timestamp);
        deal(RF, burner, 1_000_000e18);
        IERC20(RF).approve(address(swapper), type(uint256).max);
        gboot.approve(address(swapper), type(uint256).max);
        vm.stopPrank();
    }

    function _buy(uint128 rfIn) internal returns (uint256) {
        vm.prank(burner);
        return swapper.swapExactIn(key, !gbootIs0, rfIn, 1);
    }

    function testHookBurnsBothSides() public {
        uint256 supplyBefore = IERC20(RF).totalSupply();
        uint256 gbootBefore = gboot.totalSupply();
        // Exact-in RF → GBOOT: unspecified = GBOOT output; 1% of it is burned.
        uint256 bought = _buy(1_000e18);
        uint256 burned = gbootBefore - gboot.totalSupply();
        assertApproxEqRel(burned * 99, bought, 0.001e18, "1% of the gross GBOOT output is burned");
        // Exact-in GBOOT → RF: unspecified = RF output; 1% of it is burned.
        vm.prank(burner);
        swapper.swapExactIn(key, gbootIs0, uint128(bought / 2), 1);
        assertLt(IERC20(RF).totalSupply(), supplyBefore, "RF-side fee burned");
    }

    /// The hook reads Slot0 from PoolManager storage (POOLS_SLOT 6): it must agree with StateView on
    /// our pool and on the live RF/WETH pool.
    function testSlot0ReadMatchesStateView() public {
        (, int24 viewTick,,) = IStateView(STATE_VIEW).getSlot0(id);
        assertEq(hook.currentTick(id), viewTick);
        _buy(50_000e18);
        (, viewTick,,) = IStateView(STATE_VIEW).getSlot0(id);
        assertEq(hook.currentTick(id), viewTick);
        (, int24 rfWethTick,,) = IStateView(STATE_VIEW).getSlot0(RF_WETH_POOL);
        assertEq(hook.currentTick(RF_WETH_POOL), rfWethTick);
        assertTrue(rfWethTick != 0);
    }

    /// TWAP over real swaps: exact time-weighting of the ticks the pool actually had.
    function testTwapFollowsSwaps() public {
        int24 t0 = hook.currentTick(id);
        vm.expectRevert(GBootFeeHook.OracleNotReady.selector);
        hook.consult(id, 30 minutes);
        vm.warp(block.timestamp + 30 minutes);
        (int24 mean,) = hook.consult(id, 30 minutes);
        assertEq(mean, t0, "no swaps: the start tick");
        _buy(100_000e18);
        int24 t1 = hook.currentTick(id);
        assertTrue(t1 != t0);
        vm.warp(block.timestamp + 10 minutes);
        uint32 windowStart;
        (mean, windowStart) = hook.consult(id, 30 minutes);
        assertEq(windowStart, block.timestamp - 30 minutes);
        int256 expected = (int256(t0) * 1200 + int256(t1) * 600) / 1800;
        assertApproxEqAbs(int256(mean), expected, 1, "20 min at t0, 10 min at t1");
    }

    /// Manipulation window: a one-block pump of ~+60% moves the 30-min TWAP by ≈ 1/1800 per second it
    /// is held, and the divergence guard blocks every conversion while spot is > 1,000 ticks away.
    function testOneBlockPumpBarelyMovesTwapAndIsBlocked() public {
        GBootPriceFeed feed = new GBootPriceFeed(key, address(gboot));
        vm.warp(block.timestamp + 30 minutes);
        uint256 before = feed.gbootForRf(10e18, true);
        assertApproxEqRel(before, 99.73e18, 0.002e18, "10 RF ~ 99.7 GBOOT at launch");
        int24 twapBefore = feed.twapTick();
        _buy(500_000e18); // big pump
        int24 spot = hook.currentTick(id);
        int24 moved = spot > twapBefore ? spot - twapBefore : twapBefore - spot;
        assertGt(moved, 1_000, "spot moved more than 1,000 ticks");
        vm.expectRevert();
        feed.gbootForRf(10e18, true);
        vm.warp(block.timestamp + 12);
        (int24 twapAfter,) = hook.consult(id, 30 minutes);
        int24 drift = twapAfter > twapBefore ? twapAfter - twapBefore : twapBefore - twapAfter;
        assertLe(int256(drift), int256(moved) * 12 / 1800 + 1, "TWAP moves by held-seconds / 1800 of the pump");
    }

    /// Sinks on the real pool: SkillCup (real Generations: #7730's owner) and KitShop charge the TWAP
    /// conversion of their RF price, burn 50% / 100% and record the burn.
    function testSinksChargeTwapOnFork() public {
        GBootPriceFeed feed = new GBootPriceFeed(key, address(gboot));
        vm.warp(block.timestamp + 30 minutes);
        SkillCup cup = new SkillCup(ISkillGenerations(GENERATIONS), ISkillToken(address(gboot)), IGBootPriceFeed(address(feed)), address(this), block.timestamp);
        uint256[] memory prices = new uint256[](1);
        prices[0] = 1.5e18;
        KitShop shop = new KitShop(IGBoot(address(gboot)), IGBootPriceFeed(address(feed)), block.timestamp, prices);
        address owner = ISkillGenerations(GENERATIONS).ownerOf(7730);
        vm.prank(burner);
        gboot.transfer(owner, 10_000e18);
        uint256 quote = cup.quote();
        assertEq(quote, feed.gbootForRf(10e18, true));
        vm.startPrank(owner);
        gboot.approve(address(cup), type(uint256).max);
        gboot.approve(address(shop), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(SkillCup.Slippage.selector, quote, quote - 1));
        cup.enter(7730, quote - 1);
        assertEq(cup.enter(7730, quote), 1);
        shop.buy(7730, 0, shop.quote(0));
        vm.stopPrank();
        assertEq(cup.burnedInWeek(0), quote / 2);
        assertEq(IERC20(address(gboot)).balanceOf(address(this)), quote - quote / 2, "pot");
        assertApproxEqRel(shop.burnedInWeek(0), 14.96e18, 0.002e18, "1.5 RF of cosmetics");
        vm.prank(burner);
        vm.expectRevert(SkillCup.NotFriendOwner.selector);
        cup.enter(7730, type(uint256).max);
    }
}
