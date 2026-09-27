// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IGBootPriceFeed } from "./interfaces/IGBootPriceFeed.sol";

/// @title GBootFixedPrice
/// @notice The launch default's price source (plain $GBOOT/RF pool, no hook, so no on-chain TWAP):
/// a FIXED 0.1 RF per $GBOOT, the launch price. The RF-priced sinks therefore charge fixed $GBOOT
/// amounts: a Skill Cup entry or a Wildcard (10 RF) = 100 $GBOOT, a kit = its listed $GBOOT price;
/// rewards are paid at the same rate (2 RF-equivalent = 20 $GBOOT). Sinks round up, rewards round
/// down. Replaced by GBootPriceFeed (30-minute TWAP) only with the audited GBootFeeHook, which needs
/// a new pool and new sink deployments. No owner, nothing to change.
contract GBootFixedPrice is IGBootPriceFeed {
    uint256 public constant RF_PER_GBOOT_WAD = 0.1e18;

    function gbootForRf(uint256 rfAmount, bool roundUp) external pure returns (uint256) {
        return Math.mulDiv(rfAmount, 1e18, RF_PER_GBOOT_WAD, roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor);
    }
}
