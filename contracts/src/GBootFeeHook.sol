// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

// NOT DEPLOYED — requires audit and Rare Friends review.
// Roadmap v1.2: automates the $GBOOT/RF pool fee split that v1 does by hand.

import { PoolKey, SwapParams } from "./interfaces/IUniswapV4.sol";

interface IPoolManagerTake {
    function take(address currency, address to, uint256 amount) external;
}

interface IBurnable {
    function burn(uint256 amount) external;
}

/// @title GBootFeeHook
/// @notice Uniswap v4 hook for a 0%-LP-fee $GBOOT/RF pool. On every swap it takes FEE_BPS of the
/// swap's unspecified currency: RF is burned, $GBOOT is sent to the Golden Boot Cup. Permissions:
/// afterSwap + afterSwapReturnDelta only (address flags 0x44). No owner, no parameters to change.
contract GBootFeeHook {
    uint256 public constant FEE_BPS = 100;
    uint160 public constant FLAGS = (1 << 6) | (1 << 2);

    address public immutable poolManager;
    address public immutable rf;
    address public immutable cup;

    error NotPoolManager();
    error HookNotImplemented();

    event FeeTaken(address indexed currency, uint256 amount, bool burned);

    constructor(address poolManager_, address rf_, address cup_) {
        poolManager = poolManager_;
        rf = rf_;
        cup = cup_;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, int256 delta, bytes calldata)
        external
        returns (bytes4, int128)
    {
        if (msg.sender != poolManager) revert NotPoolManager();
        bool specifiedIs0 = params.amountSpecified < 0 == params.zeroForOne;
        int128 unspecified = specifiedIs0 ? int128(delta) : int128(delta >> 128);
        address currency = specifiedIs0 ? key.currency1 : key.currency0;
        uint256 amount = uint256(uint128(unspecified < 0 ? -unspecified : unspecified)) * FEE_BPS / 10_000;
        if (amount == 0) return (this.afterSwap.selector, 0);
        if (currency == rf) {
            IPoolManagerTake(poolManager).take(currency, address(this), amount);
            IBurnable(rf).burn(amount);
            emit FeeTaken(currency, amount, true);
        } else {
            IPoolManagerTake(poolManager).take(currency, cup, amount);
            emit FeeTaken(currency, amount, false);
        }
        return (this.afterSwap.selector, int128(int256(amount)));
    }
}
