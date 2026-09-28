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

/// Non-reverting "bad" ERC20: transfer / transferFrom can be switched to return false without moving
/// anything (the failure mode SafeERC20 guards against). burn is lenient (caps at the caller's
/// balance) so an unmoved transferFrom is not caught by a burn underflow: the only guard left is the
/// caller checking the returned bool.
contract FalseReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    bool public failTransfer;
    bool public failTransferFrom;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; totalSupply += amount; }
    function setFail(bool transfer_, bool transferFrom_) external { failTransfer = transfer_; failTransferFrom = transferFrom_; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfer) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransferFrom) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function burn(uint256 amount) external {
        uint256 b = balanceOf[msg.sender];
        uint256 x = amount > b ? b : amount;
        balanceOf[msg.sender] = b - x;
        totalSupply -= x;
    }
}
