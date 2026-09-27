// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title GBoot
/// @notice Penalty Kings game token. 100,000,000 fixed supply minted once to the deployer, who
/// distributes it at launch (docs/ECONOMY.md: 55% pool, 20% drop vault, 10% Friends airdrop,
/// 10% Cups & events vault, 5% rewards vault (the RewardsDistributor's EmissionVault: Skill Zone /
/// streak rewards; script/Launch.s.sol), no team allocation). No owner, mint,
/// pause, tax or blacklist. Holders may burn their own tokens.
contract GBoot is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 100_000_000e18;

    constructor() ERC20("Golden Boot", "GBOOT") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
