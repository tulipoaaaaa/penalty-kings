// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal slice of Uniswap v4 PositionManager used by the lock.
interface IPositionManager {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IBurnableCurrency {
    function burn(uint256 amount) external;
}

/// @title LiquidityLock
/// @notice Holds the protocol-owned Uniswap v4 position NFTs of the plain $GBOOT/RF pool (1% LP fee,
/// no hook) until an immutable unlock time. ANYONE can call `collect` (weekly, or whenever): the
/// position's accrued LP fees come to this contract and are split on-chain, per token:
///   - RF side:     50% burned (`RF.burn`, verified in docs/ADDRESSES.md), 50% to the Cup pot;
///   - $GBOOT side: 50% burned (`GBoot.burn`), 50% to the Cup pot.
/// Rounding: burned = ⌊amount × 50%⌋, pot = amount − burned (the odd wei goes to the pot), so
/// everything collected leaves in the same call and nothing stays behind. The whole balance of each
/// pool currency is split, so a stray transfer to the lock is burned/potted the same way.
/// After the unlock time the beneficiary can withdraw the NFTs. Nothing else is possible: no owner,
/// no parameter changes, no extension, no rescue.
contract LiquidityLock is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant DECREASE_LIQUIDITY = 0x01;
    uint256 private constant TAKE_PAIR = 0x11;
    /// @notice Share of each collected fee side that is burned (the rest goes to the Cup pot).
    uint256 public constant BURN_BPS = 5_000;

    IPositionManager public immutable positionManager;
    address public immutable beneficiary;
    uint256 public immutable unlockTime;
    /// @notice The pool's currencies, sorted (currency0 < currency1) as in the PoolKey.
    address public immutable currency0;
    address public immutable currency1;
    /// @notice The Golden Boot Cup pot (receives the non-burned half of both fee sides).
    address public immutable pot;

    error NotBeneficiary();
    error Locked();
    error BadConfig();

    event FeesCollected(
        uint256 indexed tokenId,
        address currency0,
        uint256 burned0,
        uint256 toPot0,
        address currency1,
        uint256 burned1,
        uint256 toPot1
    );
    event Withdrawn(uint256 indexed tokenId, address to);

    constructor(IPositionManager positionManager_, address beneficiary_, uint256 unlockTime_, address rf_, address gboot_, address pot_) {
        if (rf_ == address(0) || gboot_ == address(0) || rf_ == gboot_ || pot_ == address(0) || pot_ == address(this)) revert BadConfig();
        positionManager = positionManager_;
        beneficiary = beneficiary_;
        unlockTime = unlockTime_;
        (currency0, currency1) = rf_ < gboot_ ? (rf_, gboot_) : (gboot_, rf_);
        pot = pot_;
    }

    /// @notice Collect the position's fees (decrease zero liquidity, take both currencies HERE) and
    /// split each side 50% burned / 50% to the pot. Permissionless: the caller receives nothing.
    /// A position of another pool reverts inside the PositionManager (unsettled deltas).
    function collect(uint256 tokenId)
        external
        nonReentrant
        returns (uint256 burned0, uint256 toPot0, uint256 burned1, uint256 toPot1)
    {
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(currency0, currency1, address(this));
        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(DECREASE_LIQUIDITY), uint8(TAKE_PAIR)), params),
            block.timestamp
        );
        (burned0, toPot0) = _split(currency0);
        (burned1, toPot1) = _split(currency1);
        emit FeesCollected(tokenId, currency0, burned0, toPot0, currency1, burned1, toPot1);
    }

    /// @notice Preview of how `amount` of one fee side is split (burned rounds down).
    function splitOf(uint256 amount) public pure returns (uint256 burned, uint256 toPot) {
        burned = (amount * BURN_BPS) / 10_000;
        toPot = amount - burned;
    }

    function _split(address currency) internal returns (uint256 burned, uint256 toPot) {
        (burned, toPot) = splitOf(IERC20(currency).balanceOf(address(this)));
        if (burned > 0) IBurnableCurrency(currency).burn(burned);
        if (toPot > 0) IERC20(currency).safeTransfer(pot, toPot);
    }

    function withdraw(uint256 tokenId) external nonReentrant {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (block.timestamp < unlockTime) revert Locked();
        positionManager.transferFrom(address(this), beneficiary, tokenId);
        emit Withdrawn(tokenId, beneficiary);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
