// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IGBootPriceFeed, ISinkLedger } from "./interfaces/IGBootPriceFeed.sol";

interface IWildcardGenerations {
    function ownerOf(uint256 friendId) external view returns (address);
    function generation(uint256 friendId) external view returns (uint8);
}

interface IWildcardToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @dev Dice's deployed Entropy V2 interface (same as the FriendSDK ChanceGame).
interface IWildcardEntropy {
    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint128);
    function requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit) external payable returns (uint64);
}

/// @title Wildcards
/// @notice An extra Golden Boot Cup draw bought with $GBOOT (half burned, half to the pot wallet).
/// The draw uses Dice randomness with the ball table's top odds: Gold 2.5% (1 race point),
/// Golden Boot 1% (2 race points), otherwise nothing. Results are events read by the weekly script,
/// which counts them at the Park weight (×1).
/// PRICE_RF = 10 RF, paid in $GBOOT at the pool's 30-minute TWAP (GBootPriceFeed, rounded up; the
/// buyer's `maxGbootIn` bounds it): the same gross price as a Park ball at every $GBOOT price but with
/// no RF payout, so Wildcards are always a dearer route to race points than balls (docs/ECONOMY.md,
/// "Wildcard farm check"). Burns are recorded per week (sink ledger).
contract Wildcards is ISinkLedger {
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_RF = 10e18;
    uint32 public constant CALLBACK_GAS_LIMIT = 200_000;

    IWildcardGenerations public immutable generations;
    IWildcardToken public immutable gboot;
    IGBootPriceFeed public immutable feed;
    uint256 public immutable start;
    IWildcardEntropy public immutable entropy;
    address public immutable provider;
    address public immutable pot;

    struct Draw {
        uint256 friendId;
        uint8 points; // 0, 1 (Gold) or 2 (Golden Boot) once fulfilled
        bool fulfilled;
    }

    uint256 public draws;
    mapping(uint256 drawId => Draw) public drawOf;
    mapping(uint64 sequenceNumber => uint256 drawId) private _drawForSequence;
    /// @notice $GBOOT burned per 0-based week from `start`.
    mapping(uint256 week => uint256 amount) public burnedInWeek;

    error NotFriendOwner();
    error NotHardwired();
    error IncorrectOracleFee();
    error UnauthorizedRandomness();
    error InvalidRandomness();
    error RefundFailed();
    error Slippage(uint256 cost, uint256 maxGbootIn);

    event WildcardRequested(uint256 indexed drawId, uint256 indexed friendId, uint64 sequenceNumber);
    event WildcardDrawn(uint256 indexed drawId, uint256 indexed friendId, uint8 points);

    constructor(
        IWildcardGenerations generations_,
        IWildcardToken gboot_,
        IGBootPriceFeed feed_,
        IWildcardEntropy entropy_,
        address provider_,
        address pot_,
        uint256 start_
    ) {
        generations = generations_;
        gboot = gboot_;
        feed = feed_;
        start = start_;
        entropy = entropy_;
        provider = provider_;
        pot = pot_;
    }

    /// @notice 0-based week from `start` (the sink ledger's key).
    function week() public view returns (uint256) {
        return block.timestamp < start ? 0 : (block.timestamp - start) / 1 weeks;
    }

    /// @notice Current $GBOOT price of one draw (PRICE_RF at the TWAP, rounded up).
    function quote() public view returns (uint256) {
        return feed.gbootForRf(PRICE_RF, true);
    }

    function draw(uint256 friendId, uint256 maxGbootIn) external payable returns (uint256 drawId) {
        if (generations.ownerOf(friendId) != msg.sender) revert NotFriendOwner();
        if (generations.generation(friendId) == 0) revert NotHardwired();
        uint256 fee = entropy.getFeeV2(provider, CALLBACK_GAS_LIMIT);
        if (msg.value < fee) revert IncorrectOracleFee();
        uint256 cost = quote();
        if (cost > maxGbootIn) revert Slippage(cost, maxGbootIn);
        drawId = ++draws;
        drawOf[drawId].friendId = friendId;
        uint256 burned = cost / 2;
        burnedInWeek[week()] += burned;
        IERC20(address(gboot)).safeTransferFrom(msg.sender, address(this), cost);
        gboot.burn(burned);
        IERC20(address(gboot)).safeTransfer(pot, cost - burned);
        uint64 sequenceNumber = entropy.requestV2{ value: fee }(
            provider, keccak256(abi.encode(address(this), block.chainid, drawId)), CALLBACK_GAS_LIMIT
        );
        _drawForSequence[sequenceNumber] = drawId;
        emit WildcardRequested(drawId, friendId, sequenceNumber);
        // The oracle fee can move between quote and inclusion: callers may overpay; the excess returns.
        if (msg.value > fee) {
            (bool ok,) = msg.sender.call{ value: msg.value - fee }("");
            if (!ok) revert RefundFailed();
        }
    }

    function _entropyCallback(uint64 sequenceNumber, address provider_, bytes32 randomNumber) external {
        if (msg.sender != address(entropy) || provider_ != provider) revert UnauthorizedRandomness();
        uint256 drawId = _drawForSequence[sequenceNumber];
        Draw storage result = drawOf[drawId];
        if (drawId == 0 || result.fulfilled) revert InvalidRandomness();
        uint256 roll = uint256(randomNumber) % 10_000;
        result.points = roll < 100 ? 2 : roll < 350 ? 1 : 0;
        result.fulfilled = true;
        emit WildcardDrawn(drawId, result.friendId, result.points);
    }
}
