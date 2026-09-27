// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { PoolKey, SwapParams, IPoolManager } from "./interfaces/IUniswapV4.sol";

/// @title PoolSwapper
/// @notice Exact-input ERC20 swaps against a Uniswap v4 pool using only the PoolManager's
/// unlock / swap / sync / settle / take interface. Used for the launch smoke tests; holds no funds.
contract PoolSwapper {
    using SafeERC20 for IERC20;

    uint160 private constant MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740;
    uint160 private constant MAX_SQRT_PRICE_MINUS_ONE = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;

    IPoolManager public immutable poolManager;

    error NotPoolManager();
    error TooLittleReceived(uint256 received, uint256 minimum);

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    /// @notice Swap `amountIn` of the input currency for at least `minOut`, paid to msg.sender.
    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint128 amountIn, uint128 minOut) external returns (uint256 out) {
        out = abi.decode(poolManager.unlock(abi.encode(msg.sender, key, zeroForOne, amountIn, minOut)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address payer, PoolKey memory key, bool zeroForOne, uint128 amountIn, uint128 minOut) =
            abi.decode(data, (address, PoolKey, bool, uint128, uint128));
        int256 delta = poolManager.swap(
            key,
            SwapParams(zeroForOne, -int256(uint256(amountIn)), zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE),
            ""
        );
        int128 amount0 = int128(delta >> 128);
        int128 amount1 = int128(delta);
        (address input, address output) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        uint256 owed = uint256(uint128(-(zeroForOne ? amount0 : amount1)));
        uint256 received = uint256(uint128(zeroForOne ? amount1 : amount0));
        if (received < minOut) revert TooLittleReceived(received, minOut);
        poolManager.sync(input);
        IERC20(input).safeTransferFrom(payer, address(poolManager), owed);
        poolManager.settle();
        poolManager.take(output, payer, received);
        return abi.encode(received);
    }
}
