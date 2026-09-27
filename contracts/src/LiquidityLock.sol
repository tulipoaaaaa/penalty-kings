// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

/// @dev Minimal slice of Uniswap v4 PositionManager used by the lock.
interface IPositionManager {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IBurnableCurrency {
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/// @title LiquidityLock
/// @notice Holds Uniswap v4 position NFTs until an immutable unlock time. Anyone can collect the
/// accrued LP fees at any time and BOTH sides are burned (RF and $GBOOT); after the unlock time the
/// beneficiary can withdraw the NFT. Nothing else is possible: no owner, no extension, no rescue.
contract LiquidityLock {
    uint256 private constant DECREASE_LIQUIDITY = 0x01;
    uint256 private constant TAKE_PAIR = 0x11;

    IPositionManager public immutable positionManager;
    address public immutable beneficiary;
    uint256 public immutable unlockTime;

    error NotBeneficiary();
    error Locked();

    event FeesBurned(uint256 indexed tokenId, address currency0, uint256 burned0, address currency1, uint256 burned1);
    event Withdrawn(uint256 indexed tokenId, address to);

    constructor(IPositionManager positionManager_, address beneficiary_, uint256 unlockTime_) {
        positionManager = positionManager_;
        beneficiary = beneficiary_;
        unlockTime = unlockTime_;
    }

    /// @notice Collect the position's fees (decrease zero liquidity, take both currencies here) and
    /// burn them. Permissionless: the caller cannot receive anything. A wrong currency pair reverts
    /// inside the PositionManager (unsettled deltas).
    function collectAndBurn(uint256 tokenId, address currency0, address currency1) external {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(currency0, currency1, address(this));
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(DECREASE_LIQUIDITY), uint8(TAKE_PAIR)), params),
            block.timestamp
        );
        uint256 burned0 = IBurnableCurrency(currency0).balanceOf(address(this));
        uint256 burned1 = IBurnableCurrency(currency1).balanceOf(address(this));
        if (burned0 > 0) IBurnableCurrency(currency0).burn(burned0);
        if (burned1 > 0) IBurnableCurrency(currency1).burn(burned1);
        emit FeesBurned(tokenId, currency0, burned0, currency1, burned1);
    }

    function withdraw(uint256 tokenId) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (block.timestamp < unlockTime) revert Locked();
        positionManager.transferFrom(address(this), beneficiary, tokenId);
        emit Withdrawn(tokenId, beneficiary);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
