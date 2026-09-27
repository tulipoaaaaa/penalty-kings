// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title GBoot
/// @notice Penalty Kings game token. Fixed supply minted once to the deployer; no owner, mint,
/// pause, tax or blacklist. Holders may burn their own tokens (the KitShop sink uses this).
contract GBoot is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    constructor() ERC20("Golden Boot", "GBOOT") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
