// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { PoolKey } from "./interfaces/IUniswapV4.sol";
import { IGBootPriceFeed } from "./interfaces/IGBootPriceFeed.sol";
import { TickMath } from "./libraries/TickMath.sol";

interface IGBootTwapOracle {
    function consult(bytes32 poolId, uint32 period) external view returns (int24 meanTick, uint32 windowStart);
    function currentTick(bytes32 poolId) external view returns (int24);
}

/// @title GBootPriceFeed
/// @notice Converts RF amounts to $GBOOT at the $GBOOT/RF pool's 30-minute TWAP (read from the
/// GBootFeeHook accumulator). Guards:
///  - not ready: reverts until the pool has 30 minutes of history (OracleNotReady from the hook);
///  - divergence (stale-price guard): reverts while the spot tick is more than MAX_DEVIATION_TICKS
///    (≈ 10.5%) away from the TWAP, i.e. while the TWAP lags a fast move or someone is pushing spot;
///  - the TWAP window never starts earlier than now − PERIOD − 60 s, so no old price is used.
/// Callers add their own maxGbootIn slippage bound. No owner, no parameters to change.
contract GBootPriceFeed is IGBootPriceFeed {
    uint32 public constant PERIOD = 30 minutes;
    int24 public constant MAX_DEVIATION_TICKS = 1_000;
    uint256 internal constant Q96 = 1 << 96;

    IGBootTwapOracle public immutable oracle;
    bytes32 public immutable poolId;
    bool public immutable gbootIsCurrency0;

    error NotGbootPool();
    error PriceUnstable(int24 spotTick, int24 twapTick);

    constructor(PoolKey memory key, address gboot) {
        if (key.hooks == address(0) || (key.currency0 != gboot && key.currency1 != gboot)) revert NotGbootPool();
        oracle = IGBootTwapOracle(key.hooks);
        poolId = keccak256(abi.encode(key));
        gbootIsCurrency0 = key.currency0 == gboot;
    }

    /// @notice The 30-minute arithmetic-mean tick (currency1 per currency0), divergence-guarded.
    function twapTick() public view returns (int24 tick) {
        (tick,) = oracle.consult(poolId, PERIOD);
        int24 spot = oracle.currentTick(poolId);
        int24 gap = spot > tick ? spot - tick : tick - spot;
        if (gap > MAX_DEVIATION_TICKS) revert PriceUnstable(spot, tick);
    }

    /// @notice $GBOOT (wei) worth `rfAmount` RF (wei) at the TWAP. Sinks round up, rewards round down.
    function gbootForRf(uint256 rfAmount, bool roundUp) public view returns (uint256) {
        if (rfAmount == 0) return 0;
        uint256 sqrtP = TickMath.getSqrtPriceAtTick(twapTick());
        Math.Rounding r = roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor;
        // price = sqrtP² / 2^192 = currency1 per currency0.
        return gbootIsCurrency0
            ? Math.mulDiv(Math.mulDiv(rfAmount, Q96, sqrtP, r), Q96, sqrtP, r) // RF per GBOOT = price
            : Math.mulDiv(Math.mulDiv(rfAmount, sqrtP, Q96, r), sqrtP, Q96, r); // GBOOT per RF = price
    }

    /// @notice RF per $GBOOT at the TWAP, 1e18 fixed point (for display and the weekly report).
    function rfPerGbootWad() external view returns (uint256) {
        uint256 sqrtP = TickMath.getSqrtPriceAtTick(twapTick());
        return gbootIsCurrency0
            ? Math.mulDiv(Math.mulDiv(1e18, sqrtP, Q96), sqrtP, Q96)
            : Math.mulDiv(Math.mulDiv(1e18, Q96, sqrtP), Q96, sqrtP);
    }
}
