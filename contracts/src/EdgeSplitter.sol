// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { PoolKey } from "./interfaces/IUniswapV4.sol";

interface ISplitterSwapper {
    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint128 amountIn, uint128 minOut) external returns (uint256 out);
}

interface IBurn {
    function burn(uint256 amount) external;
}

/// @title EdgeSplitter
/// @notice The stadiums' 10% edge (RF) is withdrawn weekly to this contract, which splits it on-chain:
/// 40% RF burned, 30% RF swapped for $GBOOT in the RF/$GBOOT pool and that $GBOOT burned
/// (buy-and-burn), 30% RF to the Golden Boot Cup pot. Only the operator can trigger a split,
/// because it sets the swap's minimum output from a fresh quote (3% slippage). No owner.
/// Dust: under 4 wei the 30% buyback share rounds to 0, so the swap is skipped (a zero-amount
/// v4 swap reverts) and the split still burns 40% and sends the rest to the Cup.
contract EdgeSplitter {
    using SafeERC20 for IERC20;

    uint256 public constant BURN_BPS = 4_000;
    uint256 public constant BUYBACK_BPS = 3_000;

    IERC20 public immutable rf;
    IERC20 public immutable gboot;
    ISplitterSwapper public immutable swapper;
    address public immutable cup;
    address public immutable operator;
    PoolKey public key;

    error NotOperator();
    error NothingToSplit();

    event Split(uint256 rfBurned, uint256 rfSwapped, uint256 gbootBurned, uint256 rfToCup);

    constructor(IERC20 rf_, IERC20 gboot_, ISplitterSwapper swapper_, PoolKey memory key_, address cup_, address operator_) {
        rf = rf_; gboot = gboot_; swapper = swapper_; key = key_; cup = cup_; operator = operator_;
    }

    function split(uint256 minGbootOut) external {
        if (msg.sender != operator) revert NotOperator();
        uint256 total = rf.balanceOf(address(this));
        if (total == 0) revert NothingToSplit();
        uint256 burnRf = (total * BURN_BPS) / 10_000;
        uint256 swapRf = (total * BUYBACK_BPS) / 10_000;
        uint256 toCup = total - burnRf - swapRf;
        IBurn(address(rf)).burn(burnRf);
        uint256 bought;
        if (swapRf != 0) { // total >= 4 wei; below that the buyback share is 0 and the swap is skipped
            rf.forceApprove(address(swapper), swapRf);
            bought = swapper.swapExactIn(key, key.currency0 == address(rf), uint128(swapRf), uint128(minGbootOut));
            IBurn(address(gboot)).burn(bought);
        }
        rf.safeTransfer(cup, toCup);
        emit Split(burnRf, swapRf, bought, toCup);
    }
}
