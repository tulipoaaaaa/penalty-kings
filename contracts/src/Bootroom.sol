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
/// @notice Lock $GBOOT against a Friend for 1–52 weeks to earn a PERK TIER (0–3). Perks are
/// progression only: cosmetic variants, an XP bonus and Cup seeding (display / draw order). A perk
/// tier never changes a payout: it does not touch race points, drops, RF odds, Cup ranks or any
/// $GBOOT reward (docs/ECONOMY.md, "Lacing"). The lace is keyed to the friendId. Only the Friend's
/// current owner or its token-bound account starts or moves its lock (the whitelisted FriendsAirdrop
/// may also start one, never extend one); anyone else may only top up a LIVE lock, as is (gifts).
/// Only the owner or the token-bound account can unlace, and the unlace goes to the caller. Early
/// unlace burns 50%. The tier comes from a log-scaled progress curve, progressBps = 10,000 ×
/// log2(1 + x) / log2(1 + X_MAX) with x = min(amount, MAX_LACE) × weeks (whole $GBOOT-weeks),
/// capped per Friend. No owner, no fees.
contract Bootroom {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_WEEKS = 52;
    /// @notice Only the first 10,000 $GBOOT laced per Friend count towards the perk curve.
    uint256 public constant MAX_LACE = 10_000e18;
    /// @notice GBOOT-weeks for full progress: MAX_LACE for 52 weeks.
    uint256 public constant X_MAX = 520_000;
    uint256 public constant BPS = 10_000;
    /// @notice Progress thresholds for perk tiers 2 and 3.
    uint256 public constant TIER2_BPS = 5_000;
    uint256 public constant TIER3_BPS = 8_500;

    struct Lace { uint128 amount; uint64 unlockAt; uint64 lockWeeks; }

    IERC20 public immutable gboot;
    IBootroomGenerations public immutable generations;
    /// @notice The FriendsAirdrop: besides the Friend itself, the only caller that may START a lock.
    address public immutable airdrop;
    mapping(uint256 friendId => Lace) public laces;

    error BadWeeks();
    error NothingLaced();
    error NotFriend();
    /// @notice A third party laced a Friend with no live lock (only the Friend or the airdrop starts one).
    error NoLiveLock();
    /// @notice The airdrop would extend the Friend's existing lock (or re-lock expired $GBOOT).
    error LockTooShort();
    /// @notice The lace would end after the caller's `maxUnlockAt`.
    error LockTooLong();

    event Laced(uint256 indexed friendId, address indexed from, uint256 amount, uint256 lockWeeks, uint256 unlockAt);
    event Unlaced(uint256 indexed friendId, address indexed to, uint256 returned, uint256 burned);

    constructor(IERC20 gboot_, IBootroomGenerations generations_, address airdrop_) {
        gboot = gboot_; generations = generations_; airdrop = airdrop_;
    }

    /// @notice Lace `amount` for `friendId` for `lockWeeks` (1–52); reverts with LockTooLong when the
    /// resulting lock would end after `maxUnlockAt` (pass block.timestamp + lockWeeks weeks for exactly
    /// the weeks asked, never a longer lock someone else started).
    /// - The Friend's owner or token-bound account starts a lock (also over an expired one) or moves a
    ///   live lock to a later unlock, taking the new weeks; a shorter lace joins the live lock as is.
    /// - The FriendsAirdrop starts a lock on an empty lace, or joins a live lock that already ends no
    ///   earlier than its own weeks would; it never extends a lock or re-locks expired $GBOOT.
    /// - Anyone else only tops up a live lock: the amount adds, the unlock and weeks stay.
    function lace(uint256 friendId, uint256 amount, uint256 lockWeeks, uint256 maxUnlockAt) external {
        if (lockWeeks == 0 || lockWeeks > MAX_WEEKS) revert BadWeeks();
        if (amount == 0) revert NothingLaced();
        Lace storage l = laces[friendId];
        uint256 unlockAt = block.timestamp + lockWeeks * 1 weeks;
        bool live = l.amount != 0 && block.timestamp < l.unlockAt;
        if (msg.sender == generations.ownerOf(friendId) || msg.sender == generations.tokenBoundAccount(friendId)) {
            if (!live || unlockAt > l.unlockAt) { l.unlockAt = uint64(unlockAt); l.lockWeeks = uint64(lockWeeks); }
        } else if (msg.sender == airdrop) {
            if (l.amount == 0) { l.unlockAt = uint64(unlockAt); l.lockWeeks = uint64(lockWeeks); }
            else if (l.unlockAt < unlockAt) revert LockTooShort();
        } else if (!live) {
            revert NoLiveLock();
        }
        if (l.unlockAt > maxUnlockAt) revert LockTooLong();
        l.amount += uint128(amount);
        gboot.safeTransferFrom(msg.sender, address(this), amount);
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

    /// @notice Lacing progress in basis points (0 … 10,000) on the log curve. 0 when nothing whole is
    /// laced or the lace has expired. Progression only: never read by any payout.
    function progressBps(uint256 friendId) public view returns (uint256) {
        Lace memory l = laces[friendId];
        if (l.amount == 0 || block.timestamp >= l.unlockAt) return 0;
        uint256 counted = l.amount > MAX_LACE ? MAX_LACE : l.amount;
        uint256 x = (counted / 1e18) * l.lockWeeks;
        if (x >= X_MAX) return BPS;
        return (BPS * log2Wad(1e18 + x * 1e18)) / log2Wad(1e18 + X_MAX * 1e18);
    }

    /// @notice Perk tier 0–3 for cosmetics, the XP bonus and Cup seeding. 0: no live lace (or less than
    /// one whole $GBOOT); 1: any live lace; 2: progress ≥ 50% (≈ 720 $GBOOT-weeks, e.g. 100 for 8 weeks);
    /// 3: progress ≥ 85% (≈ 72,210 $GBOOT-weeks, e.g. 10,000 for 8 weeks). Not a payout multiplier.
    function perkTier(uint256 friendId) external view returns (uint8) {
        uint256 p = progressBps(friendId);
        if (p == 0) return 0;
        if (p >= TIER3_BPS) return 3;
        if (p >= TIER2_BPS) return 2;
        return 1;
    }

    /// @dev log2 of a 1e18 fixed-point number ≥ 1e18, result in 1e18 fixed point (≈1e-9 precision).
    function log2Wad(uint256 x) public pure returns (uint256 result) {
        uint256 n = 0; // integer part of log2(x / 1e18); stays 0 for x in [1e18, 2e18)
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
