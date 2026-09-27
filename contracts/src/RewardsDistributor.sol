// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EmissionVault } from "./EmissionVault.sol";
import { IGBootPriceFeed, ISinkLedger } from "./interfaces/IGBootPriceFeed.sol";

interface IRewardsGenerations {
    function ownerOf(uint256 friendId) external view returns (address);
    function tokenBoundAccount(uint256 friendId) external view returns (address);
    function generation(uint256 friendId) external view returns (uint8);
}

interface IRewardsSkillCup {
    function ENTRY_RF() external view returns (uint256);
    function entryFriend(uint256 entryId) external view returns (uint256);
}

/// @title RewardsDistributor
/// @notice Pays Skill Zone and challenge-streak rewards in $GBOOT, farm-proofed. Every claim needs ALL of:
///  1. the Skill Cup referee's EIP-712 signature over the claim (verifier/ signs it after the 5th kick);
///  2. a Friend that is hardwired with generation ≤ MAX_GENERATION (Generations.generation, read now);
///  3. a PAID on-chain Skill Cup entry of that Friend (`SkillCup.entryFriend(entryId) == friendId`), and
///     at most ENTRY_CAP_BPS (20%) of that entry's RF price in rewards across all kinds: a reward can
///     never be worth more than a fifth of what the entry cost, half of which was burned;
///  4. the Friend's per-day cap (DAILY_CAP_RF, RF-equivalent) not exceeded;
///  5. an unused per-Friend nonce and a deadline that has not passed (and is at most MAX_VALIDITY ahead);
///  6. room in the season budget: budget(s) = min(Σ capOf over the season's 4 weeks of this contract's
///     halving EmissionVault, $GBOOT burned by the sinks (KitShop, SkillCup, Wildcards) in season s − 1,
///     the vault's balance), set once per season by the permissionless `setSeasonBudget`.
/// Reward values are signed in RF terms and converted at the pool's 30-minute TWAP (GBootPriceFeed,
/// rounded down), so the RF value of a reward does not grow with the $GBOOT price.
/// Payment goes to the Friend's token-bound account (anyone may submit the claim). The $GBOOT comes
/// from the EmissionVault this contract creates and is the only operator of: nobody else can release it.
/// Daily-login rewards are NOT paid here: they cannot be farm-proofed (docs/ECONOMY.md, "Rewards").
/// No owner, no parameters to change.
contract RewardsDistributor {
    uint8 public constant KIND_SKILL = 0;
    uint8 public constant KIND_STREAK = 1;
    uint8 public constant MAX_GENERATION = 4;
    uint256 public constant SEASON_WEEKS = 4;
    /// @notice Most RF-equivalent one Friend can claim per day (0-based days from `start`).
    uint256 public constant DAILY_CAP_RF = 3e18;
    /// @notice Most rewards per paid entry, in bps of SkillCup.ENTRY_RF (2 RF of a 10 RF entry).
    uint256 public constant ENTRY_CAP_BPS = 2_000;
    uint256 public constant MAX_VALIDITY = 7 days;
    uint256 public constant MAX_SINKS = 8;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "RewardClaim(uint256 friendId,uint256 entryId,uint8 kind,uint256 rfValue,uint256 nonce,uint256 deadline)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Penalty Kings Rewards");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    /// @dev secp256k1n / 2: signatures with a higher s are malleable and rejected.
    uint256 internal constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    struct RewardClaim {
        uint256 friendId;
        uint256 entryId;
        uint8 kind;
        uint256 rfValue;
        uint256 nonce;
        uint256 deadline;
    }

    struct Season {
        bool set;
        uint128 budget;
        uint128 paid;
    }

    IERC20 public immutable gboot;
    IRewardsGenerations public immutable generations;
    IRewardsSkillCup public immutable skillCup;
    IGBootPriceFeed public immutable feed;
    address public immutable referee;
    EmissionVault public immutable vault;
    uint256 public immutable start;

    address[] internal _sinks;
    mapping(uint256 season => Season) public seasons;
    mapping(uint256 friendId => mapping(uint256 day => uint256 rf)) public dailyRf;
    mapping(uint256 friendId => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(uint256 entryId => uint256 rf) public entryRf;
    uint256 public totalPaid;

    error Expired();
    error DeadlineTooFar();
    error BadKind();
    error NonceUsed();
    error BadSignature();
    error NotHardwired();
    error GenerationTooLow();
    error UnknownEntry();
    error EntryCap();
    error DailyCap();
    error OverBudget(uint256 season, uint256 budget, uint256 wanted);
    error NoTokenBoundAccount();
    error BadSinks();

    event SeasonBudgetSet(uint256 indexed season, uint256 ceiling, uint256 sinkBurned, uint256 budget);
    event Claimed(
        uint256 indexed friendId,
        uint256 indexed entryId,
        uint8 kind,
        uint256 nonce,
        uint256 rfValue,
        uint256 gbootAmount,
        uint256 season,
        address to
    );

    /// @param weeklyCap_ / halvingWeeks_ parameters of the EmissionVault this contract creates (and funds
    /// claims from); fund it by transferring $GBOOT to `vault()`.
    /// @param sinks_ $GBOOT sinks whose `burnedInWeek` sets the season budget; each must share `start_`.
    constructor(
        IERC20 gboot_,
        IRewardsGenerations generations_,
        IRewardsSkillCup skillCup_,
        IGBootPriceFeed feed_,
        address referee_,
        uint256 start_,
        uint256 weeklyCap_,
        uint256 halvingWeeks_,
        address[] memory sinks_
    ) {
        if (sinks_.length == 0 || sinks_.length > MAX_SINKS) revert BadSinks();
        for (uint256 i; i < sinks_.length; ++i) {
            if (ISinkLedger(sinks_[i]).start() != start_) revert BadSinks();
            _sinks.push(sinks_[i]);
        }
        gboot = gboot_;
        generations = generations_;
        skillCup = skillCup_;
        feed = feed_;
        referee = referee_;
        start = start_;
        vault = new EmissionVault(gboot_, address(this), start_, weeklyCap_, halvingWeeks_);
    }

    // ───────────────────────────────────────────── views

    function sinks() external view returns (address[] memory) {
        return _sinks;
    }

    function currentSeason() public view returns (uint256) {
        return vault.currentWeek() / SEASON_WEEKS;
    }

    function currentDay() public view returns (uint256) {
        return block.timestamp < start ? 0 : (block.timestamp - start) / 1 days;
    }

    /// @notice The vault's halving ceiling for a season: Σ capOf(week) over its SEASON_WEEKS weeks.
    function seasonCeiling(uint256 season) public view returns (uint256 total) {
        for (uint256 w = season * SEASON_WEEKS; w < (season + 1) * SEASON_WEEKS; ++w) total += vault.capOf(w);
    }

    /// @notice $GBOOT burned by every sink during a season's weeks.
    function sinkBurned(uint256 season) public view returns (uint256 total) {
        for (uint256 i; i < _sinks.length; ++i) {
            for (uint256 w = season * SEASON_WEEKS; w < (season + 1) * SEASON_WEEKS; ++w) {
                total += ISinkLedger(_sinks[i]).burnedInWeek(w);
            }
        }
    }

    /// @notice EIP-712 domain separator (name "Penalty Kings Rewards", version "1").
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashClaim(RewardClaim calldata c) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(CLAIM_TYPEHASH, c.friendId, c.entryId, c.kind, c.rfValue, c.nonce, c.deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    // ───────────────────────────────────────────── budget

    /// @notice Permissionless: fixes the current season's budget once, from on-chain reads only:
    /// min(seasonCeiling(s), sinkBurned(s − 1), vault balance). Season 0 has no previous season: 0.
    function setSeasonBudget() public returns (uint256 budget) {
        uint256 season = currentSeason();
        Season storage s = seasons[season];
        if (s.set) return s.budget;
        uint256 ceiling = seasonCeiling(season);
        uint256 burned = season == 0 ? 0 : sinkBurned(season - 1);
        budget = ceiling < burned ? ceiling : burned;
        uint256 balance = gboot.balanceOf(address(vault));
        if (balance < budget) budget = balance;
        s.set = true;
        s.budget = uint128(budget);
        emit SeasonBudgetSet(season, ceiling, burned, budget);
    }

    // ───────────────────────────────────────────── claim

    function claim(RewardClaim calldata c, bytes calldata signature) external returns (uint256 amount) {
        _verify(c, signature);
        _consumeCaps(c);
        address to = generations.tokenBoundAccount(c.friendId);
        if (to == address(0)) revert NoTokenBoundAccount();
        amount = feed.gbootForRf(c.rfValue, false);
        uint256 season = _spend(amount);
        nonceUsed[c.friendId][c.nonce] = true;
        if (amount > 0) vault.release(to, amount);
        emit Claimed(c.friendId, c.entryId, c.kind, c.nonce, c.rfValue, amount, season, to);
    }

    /// @dev Deadline, kind, nonce, the referee's signature, the Friend's generation and the paid entry.
    function _verify(RewardClaim calldata c, bytes calldata signature) internal view {
        if (block.timestamp > c.deadline) revert Expired();
        if (c.deadline > block.timestamp + MAX_VALIDITY) revert DeadlineTooFar();
        if (c.kind > KIND_STREAK) revert BadKind();
        if (nonceUsed[c.friendId][c.nonce]) revert NonceUsed();
        if (_recover(hashClaim(c), signature) != referee) revert BadSignature();
        uint8 gen = generations.generation(c.friendId);
        if (gen == 0) revert NotHardwired();
        if (gen > MAX_GENERATION) revert GenerationTooLow();
        if (c.entryId == 0 || skillCup.entryFriend(c.entryId) != c.friendId) revert UnknownEntry();
    }

    /// @dev Per-entry cap (ENTRY_CAP_BPS of the entry price) and the Friend's daily cap, in RF terms.
    function _consumeCaps(RewardClaim calldata c) internal {
        uint256 perEntry = entryRf[c.entryId] + c.rfValue;
        if (perEntry > skillCup.ENTRY_RF() * ENTRY_CAP_BPS / 10_000) revert EntryCap();
        uint256 day = currentDay();
        uint256 perDay = dailyRf[c.friendId][day] + c.rfValue;
        if (perDay > DAILY_CAP_RF) revert DailyCap();
        entryRf[c.entryId] = perEntry;
        dailyRf[c.friendId][day] = perDay;
    }

    /// @dev Charges `amount` to the current season's budget (fixing the budget first if needed).
    function _spend(uint256 amount) internal returns (uint256 season) {
        season = currentSeason();
        setSeasonBudget();
        Season storage s = seasons[season];
        uint256 paid = uint256(s.paid) + amount;
        if (paid > s.budget) revert OverBudget(season, s.budget, paid);
        s.paid = uint128(paid);
        totalPaid += amount;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
