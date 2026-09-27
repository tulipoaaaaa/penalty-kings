// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

/// @dev Minimal slice of Uniswap v4 PositionManager used by the lock.
interface IPositionManager {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title LiquidityLock
/// @notice Holds Uniswap v4 position NFTs until an immutable unlock time. Before then the
/// beneficiary can only collect accrued fees; after it the beneficiary can withdraw the NFT.
/// Nothing else is possible: no owner, no extension, no rescue.
contract LiquidityLock {
    uint256 private constant DECREASE_LIQUIDITY = 0x01;
    uint256 private constant TAKE_PAIR = 0x11;

    IPositionManager public immutable positionManager;
    address public immutable beneficiary;
    uint256 public immutable unlockTime;

    error NotBeneficiary();
    error Locked();

    event FeesCollected(uint256 indexed tokenId, address currency0, address currency1);
    event Withdrawn(uint256 indexed tokenId, address to);

    constructor(IPositionManager positionManager_, address beneficiary_, uint256 unlockTime_) {
        positionManager = positionManager_;
        beneficiary = beneficiary_;
        unlockTime = unlockTime_;
    }

    /// @notice Collect fees by decreasing zero liquidity and taking both currencies to the
    /// beneficiary. The position's liquidity is untouched.
    function collect(uint256 tokenId, address currency0, address currency1) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(currency0, currency1, beneficiary);
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(DECREASE_LIQUIDITY), uint8(TAKE_PAIR)), params),
            block.timestamp
        );
        emit FeesCollected(tokenId, currency0, currency1);
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
