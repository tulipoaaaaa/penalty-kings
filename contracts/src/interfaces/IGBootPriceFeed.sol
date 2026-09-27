// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

/// @notice RF → $GBOOT conversion at the pool's TWAP (GBootPriceFeed). Sinks round up, rewards round down.
interface IGBootPriceFeed {
    function gbootForRf(uint256 rfAmount, bool roundUp) external view returns (uint256);
}

/// @notice Per-week burn ledger kept by every $GBOOT sink (KitShop, SkillCup, Wildcards). `week` is
/// 0-based from `start()`, the same numbering as EmissionVault.currentWeek() for the same start.
interface ISinkLedger {
    function start() external view returns (uint256);
    function burnedInWeek(uint256 week) external view returns (uint256);
}
