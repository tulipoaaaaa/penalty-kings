// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IGBootPriceFeed, ISinkLedger } from "./interfaces/IGBootPriceFeed.sol";

interface IGBoot {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @title KitShop
/// @notice Burns $GBOOT for cosmetic unlocks recorded per Rare Friend. Prices are fixed in RF at
/// deployment and converted to $GBOOT at the pool's 30-minute TWAP when you buy
/// (cost = ⌈priceRf ÷ TWAP⌉, GBootPriceFeed); the buyer's `maxGbootIn` bounds the cost. 100% of
/// the $GBOOT is burned and recorded per week (the RewardsDistributor's sink ledger). There is no
/// owner. Cosmetics carry no RF value or redemption promise.
contract KitShop is ISinkLedger {
    using SafeERC20 for IERC20;

    IGBoot public immutable gboot;
    IGBootPriceFeed public immutable feed;
    uint256 public immutable start;
    uint256 public immutable itemCount;
    mapping(uint256 itemId => uint256 rfWei) public priceRf;
    mapping(uint256 friendId => mapping(uint256 itemId => bool)) public unlocked;
    mapping(uint256 week => uint256 amount) public burnedInWeek;

    error UnknownItem();
    error AlreadyUnlocked();
    error Slippage(uint256 cost, uint256 maxGbootIn);

    event Unlocked(uint256 indexed friendId, uint256 indexed itemId, address indexed buyer, uint256 burned);

    constructor(IGBoot gboot_, IGBootPriceFeed feed_, uint256 start_, uint256[] memory pricesRf) {
        gboot = gboot_;
        feed = feed_;
        start = start_;
        itemCount = pricesRf.length;
        for (uint256 i; i < pricesRf.length; ++i) priceRf[i] = pricesRf[i];
    }

    /// @notice 0-based week from `start` (the sink ledger's key).
    function week() public view returns (uint256) {
        return block.timestamp < start ? 0 : (block.timestamp - start) / 1 weeks;
    }

    /// @notice Current $GBOOT cost of an item (the TWAP conversion of its RF price, rounded up).
    function quote(uint256 itemId) public view returns (uint256) {
        if (itemId >= itemCount) revert UnknownItem();
        uint256 rf = priceRf[itemId];
        return rf == 0 ? 0 : feed.gbootForRf(rf, true);
    }

    /// @notice Anyone may unlock an item for any Friend; the payer's $GBOOT is burned.
    function buy(uint256 friendId, uint256 itemId, uint256 maxGbootIn) external {
        uint256 cost = quote(itemId);
        if (unlocked[friendId][itemId]) revert AlreadyUnlocked();
        if (cost > maxGbootIn) revert Slippage(cost, maxGbootIn);
        unlocked[friendId][itemId] = true;
        if (cost != 0) {
            burnedInWeek[week()] += cost;
            IERC20(address(gboot)).safeTransferFrom(msg.sender, address(this), cost);
            gboot.burn(cost);
        }
        emit Unlocked(friendId, itemId, msg.sender, cost);
    }
}
