// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IGBootPriceFeed } from "../src/interfaces/IGBootPriceFeed.sol";

/// Test price feed: a settable RF-per-GBOOT price (1e18 fixed point), converted like GBootPriceFeed
/// (sinks round up, rewards round down). Default: the 0.1 RF launch price.
contract FixedPriceFeed is IGBootPriceFeed {
    uint256 public rfPerGbootWad = 0.1e18;
    bool public broken;

    function setPrice(uint256 rfPerGbootWad_) external { rfPerGbootWad = rfPerGbootWad_; }
    function setBroken(bool broken_) external { broken = broken_; }

    function gbootForRf(uint256 rfAmount, bool roundUp) external view returns (uint256) {
        require(!broken, "oracle down");
        return Math.mulDiv(rfAmount, 1e18, rfPerGbootWad, roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor);
    }
}
