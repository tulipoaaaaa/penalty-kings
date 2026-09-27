// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IGBootPriceFeed, ISinkLedger } from "./interfaces/IGBootPriceFeed.sol";

interface ISkillGenerations {
    function ownerOf(uint256 friendId) external view returns (address);
    function generation(uint256 friendId) external view returns (uint8);
}

interface ISkillToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @title SkillCup
/// @notice On-chain entries for the weekly Skill Cup (a 5-kick shootout judged by the replay
/// referee). An entry is priced in RF (ENTRY_RF = 10 RF) and paid in $GBOOT converted at the pool's
/// 30-minute TWAP (GBootPriceFeed, rounded up; the entrant's `maxGbootIn` bounds it): half is
/// burned, half goes to the disclosed pot wallet. Burns are recorded per week (sink ledger) and every
/// entry's Friend is stored (`entryFriend`), which the RewardsDistributor uses to tie a reward to a
/// paid entry.
/// Only the owner of a Friend hardwired at Gen 4 or better (≥ 100 RF paid to hardwire) can enter;
/// one entry per Friend per hour, WEEKLY_LIMIT per week. Cheap Gen 5/6 Friends cannot be used to
/// multiply entries. The referee accepts kicks only for entries recorded here. No owner.
contract SkillCup is ISinkLedger {
    /// @notice Entry price in RF (wei): 10 RF, = 100 $GBOOT at the 0.1 RF launch price.
    uint256 public constant ENTRY_RF = 10e18;
    uint8 public constant MAX_GENERATION = 4;
    uint256 public constant COOLDOWN = 1 hours;
    uint256 public constant WEEKLY_LIMIT = 20;

    ISkillGenerations public immutable generations;
    ISkillToken public immutable gboot;
    IGBootPriceFeed public immutable feed;
    address public immutable pot;
    uint256 public immutable start;

    uint256 public entries;
    mapping(uint256 friendId => uint256) public lastEntry;
    mapping(uint256 week => mapping(uint256 friendId => uint256)) public weeklyEntries;
    mapping(uint256 entryId => uint256 friendId) public entryFriend;
    /// @notice $GBOOT burned per 0-based week (week() − 1).
    mapping(uint256 week => uint256 amount) public burnedInWeek;

    error NotFriendOwner();
    error NotHardwired();
    error GenerationTooLow();
    error Cooldown();
    error WeeklyLimit();
    error Slippage(uint256 cost, uint256 maxGbootIn);

    event Entered(uint256 indexed entryId, uint256 indexed friendId, address indexed player, uint256 week);

    constructor(ISkillGenerations generations_, ISkillToken gboot_, IGBootPriceFeed feed_, address pot_, uint256 start_) {
        generations = generations_;
        gboot = gboot_;
        feed = feed_;
        pot = pot_;
        start = start_;
    }

    /// @notice 1-based Cup week (the referee's week number).
    function week() public view returns (uint256) {
        return (block.timestamp - start) / 1 weeks + 1;
    }

    /// @notice Current entry cost in $GBOOT (ENTRY_RF at the TWAP, rounded up).
    function quote() public view returns (uint256) {
        return feed.gbootForRf(ENTRY_RF, true);
    }

    function enter(uint256 friendId, uint256 maxGbootIn) external returns (uint256 entryId) {
        if (generations.ownerOf(friendId) != msg.sender) revert NotFriendOwner();
        uint8 gen = generations.generation(friendId);
        if (gen == 0) revert NotHardwired();
        if (gen > MAX_GENERATION) revert GenerationTooLow();
        uint256 last = lastEntry[friendId];
        if (last != 0 && block.timestamp < last + COOLDOWN) revert Cooldown();
        uint256 current = week();
        if (weeklyEntries[current][friendId] >= WEEKLY_LIMIT) revert WeeklyLimit();
        uint256 cost = quote();
        if (cost > maxGbootIn) revert Slippage(cost, maxGbootIn);
        lastEntry[friendId] = block.timestamp;
        ++weeklyEntries[current][friendId];
        entryId = ++entries;
        entryFriend[entryId] = friendId;
        uint256 burned = cost / 2;
        burnedInWeek[current - 1] += burned;
        gboot.transferFrom(msg.sender, address(this), cost);
        gboot.burn(burned);
        gboot.transfer(pot, cost - burned);
        emit Entered(entryId, friendId, msg.sender, current);
    }
}
