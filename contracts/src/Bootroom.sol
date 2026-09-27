// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IBootroomGenerations {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenBoundAccount(uint256 tokenId) external view returns (address);
}

interface IBurnableToken {
    function burn(uint256 amount) external;
}

/// @title Bootroom ("Lace your Boots")
/// @notice Lock $GBOOT against a Friend for 1–52 weeks to earn a boost: Golden Boot race points ×
/// boost and weekly drops × (1 + (boost − 1) / 2), applied by the public weekly script. The lace is
/// keyed to the friendId: anyone may lace for a Friend (gifts, the pre-laced airdrop), but only the
/// Friend's current owner or its token-bound account can unlace, and it goes to the caller. Early
/// unlace burns 50%. Boost = min(2, 1 + log2(1 + x) / log2(1 + X_MAX)) with x = min(amount,
/// MAX_LACE) × weeks, so it is log-scaled and capped per Friend. No owner, no fees.
contract Bootroom {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_WEEKS = 52;
    /// @notice Only the first 10,000 $GBOOT laced per Friend count towards the boost.
    uint256 public constant MAX_LACE = 10_000e18;
    /// @notice GBOOT-weeks for the maximum boost: MAX_LACE for 52 weeks.
    uint256 public constant X_MAX = 520_000;
    uint256 public constant BPS = 10_000;

    struct Lace { uint128 amount; uint64 unlockAt; uint64 lockWeeks; }

    IERC20 public immutable gboot;
    IBootroomGenerations public immutable generations;
    mapping(uint256 friendId => Lace) public laces;

    error BadWeeks();
    error NothingLaced();
    error NotFriend();

    event Laced(uint256 indexed friendId, address indexed from, uint256 amount, uint256 lockWeeks, uint256 unlockAt);
    event Unlaced(uint256 indexed friendId, address indexed to, uint256 returned, uint256 burned);

    constructor(IERC20 gboot_, IBootroomGenerations generations_) {
        gboot = gboot_; generations = generations_;
    }

    /// @notice Lace `amount` for `friendId` for `lockWeeks` (1–52). The Friend's owner or token-bound
    /// account may move the lock to a later unlock (taking the new weeks). Anyone else only adds $GBOOT
    /// to the existing lock, and sets `lockWeeks` only when the Friend has nothing laced.
    function lace(uint256 friendId, uint256 amount, uint256 lockWeeks) external {
        if (lockWeeks == 0 || lockWeeks > MAX_WEEKS) revert BadWeeks();
        if (amount == 0) revert NothingLaced();
        gboot.safeTransferFrom(msg.sender, address(this), amount);
        Lace storage l = laces[friendId];
        uint256 unlockAt = block.timestamp + lockWeeks * 1 weeks;
        bool empty = l.amount == 0;
        l.amount += uint128(amount);
        // Only the Friend (owner or token-bound account) sets or moves its lock. A third party (a gift, the
        // airdrop) starts a lock only on an empty lace; otherwise its $GBOOT joins the existing lock as is,
        // so nobody can shorten a Friend's weeks, extend its lock or re-lock expired $GBOOT with dust.
        bool friend = msg.sender == generations.ownerOf(friendId) || msg.sender == generations.tokenBoundAccount(friendId);
        if (friend ? unlockAt > l.unlockAt : empty) { l.unlockAt = uint64(unlockAt); l.lockWeeks = uint64(lockWeeks); }
        emit Laced(friendId, msg.sender, amount, l.lockWeeks, l.unlockAt);
    }

    /// @notice Owner or token-bound account only. Before expiry half is burned.
    function unlace(uint256 friendId) external {
        if (msg.sender != generations.ownerOf(friendId) && msg.sender != generations.tokenBoundAccount(friendId)) revert NotFriend();
        Lace memory l = laces[friendId];
        if (l.amount == 0) revert NothingLaced();
        delete laces[friendId];
        uint256 burned = block.timestamp < l.unlockAt ? l.amount / 2 : 0;
        if (burned > 0) IBurnableToken(address(gboot)).burn(burned);
        gboot.safeTransfer(msg.sender, l.amount - burned);
        emit Unlaced(friendId, msg.sender, l.amount - burned, burned);
    }

    /// @notice Current boost in basis points (10,000 = ×1, 20,000 = ×2). Expired laces give ×1.
    function boostBps(uint256 friendId) public view returns (uint256) {
        Lace memory l = laces[friendId];
        if (l.amount == 0 || block.timestamp >= l.unlockAt) return BPS;
        uint256 counted = l.amount > MAX_LACE ? MAX_LACE : l.amount;
        uint256 x = (counted / 1e18) * l.lockWeeks;
        if (x >= X_MAX) return 2 * BPS;
        return BPS + (BPS * log2Wad(1e18 + x * 1e18)) / log2Wad(1e18 + X_MAX * 1e18);
    }

    /// @notice Drop multiplier in basis points: 1 + (boost − 1) / 2 (×1 … ×1.5).
    function dropBps(uint256 friendId) external view returns (uint256) {
        return BPS + (boostBps(friendId) - BPS) / 2;
    }

    /// @dev log2 of a 1e18 fixed-point number ≥ 1e18, result in 1e18 fixed point (≈1e-9 precision).
    function log2Wad(uint256 x) public pure returns (uint256 result) {
        uint256 n;
        uint256 y = x / 1e18;
        while (y >= 2) { y >>= 1; n++; }
        result = n * 1e18;
        y = x >> n; // in [1e18, 2e18)
        for (uint256 delta = 5e17; delta > 1e9; delta >>= 1) {
            y = (y * y) / 1e18;
            if (y >= 2e18) { result += delta; y >>= 1; }
        }
    }
}
