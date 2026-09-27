// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

interface IGBoot {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @title KitShop
/// @notice Burns $GBOOT for cosmetic unlocks recorded per Rare Friend. Prices are fixed at
/// deployment; there is no owner. Cosmetics carry no RF value or redemption promise.
contract KitShop {
    IGBoot public immutable gboot;
    uint256 public immutable itemCount;
    mapping(uint256 itemId => uint256 price) public price;
    mapping(uint256 friendId => mapping(uint256 itemId => bool)) public unlocked;

    error UnknownItem();
    error AlreadyUnlocked();

    event Unlocked(uint256 indexed friendId, uint256 indexed itemId, address indexed buyer, uint256 burned);

    constructor(IGBoot gboot_, uint256[] memory prices) {
        gboot = gboot_;
        itemCount = prices.length;
        for (uint256 i; i < prices.length; ++i) price[i] = prices[i];
    }

    /// @notice Anyone may unlock an item for any Friend; the payer's $GBOOT is burned.
    function buy(uint256 friendId, uint256 itemId) external {
        if (itemId >= itemCount) revert UnknownItem();
        if (unlocked[friendId][itemId]) revert AlreadyUnlocked();
        unlocked[friendId][itemId] = true;
        uint256 cost = price[itemId];
        if (cost != 0) {
            gboot.transferFrom(msg.sender, address(this), cost);
            gboot.burn(cost);
        }
        emit Unlocked(friendId, itemId, msg.sender, cost);
    }
}
