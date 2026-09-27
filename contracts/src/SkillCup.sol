// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

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
/// referee). An entry costs ENTRY $GBOOT: half is burned, half goes to the disclosed pot wallet.
/// Only the owner of a Friend hardwired at Gen 4 or better (≥ 100 RF paid to hardwire) can enter;
/// one entry per Friend per hour, WEEKLY_LIMIT per week. Cheap Gen 5/6 Friends cannot be used to
/// multiply entries. The referee accepts kicks only for entries recorded here. No owner.
contract SkillCup {
    uint256 public constant ENTRY = 100e18;
    uint8 public constant MAX_GENERATION = 4;
    uint256 public constant COOLDOWN = 1 hours;
    uint256 public constant WEEKLY_LIMIT = 20;

    ISkillGenerations public immutable generations;
    ISkillToken public immutable gboot;
    address public immutable pot;
    uint256 public immutable start;

    uint256 public entries;
    mapping(uint256 friendId => uint256) public lastEntry;
    mapping(uint256 week => mapping(uint256 friendId => uint256)) public weeklyEntries;

    error NotFriendOwner();
    error NotHardwired();
    error GenerationTooLow();
    error Cooldown();
    error WeeklyLimit();

    event Entered(uint256 indexed entryId, uint256 indexed friendId, address indexed player, uint256 week);

    constructor(ISkillGenerations generations_, ISkillToken gboot_, address pot_, uint256 start_) {
        generations = generations_;
        gboot = gboot_;
        pot = pot_;
        start = start_;
    }

    function week() public view returns (uint256) {
        return (block.timestamp - start) / 1 weeks + 1;
    }

    function enter(uint256 friendId) external returns (uint256 entryId) {
        if (generations.ownerOf(friendId) != msg.sender) revert NotFriendOwner();
        uint8 gen = generations.generation(friendId);
        if (gen == 0) revert NotHardwired();
        if (gen > MAX_GENERATION) revert GenerationTooLow();
        uint256 last = lastEntry[friendId];
        if (last != 0 && block.timestamp < last + COOLDOWN) revert Cooldown();
        uint256 current = week();
        if (weeklyEntries[current][friendId] >= WEEKLY_LIMIT) revert WeeklyLimit();
        lastEntry[friendId] = block.timestamp;
        ++weeklyEntries[current][friendId];
        entryId = ++entries;
        gboot.transferFrom(msg.sender, address(this), ENTRY);
        gboot.burn(ENTRY / 2);
        gboot.transfer(pot, ENTRY / 2);
        emit Entered(entryId, friendId, msg.sender, current);
    }
}
