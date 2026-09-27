// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EmissionVault
/// @notice Holds a $GBOOT allocation and releases it to one operator under an immutable weekly
/// cap. Halving mode (drops): the cap halves every `halvingWeeks` (4-week seasons: 10M, 5M, 2.5M…
/// per season for a 20M vault). Flat mode (`halvingWeeks` = 0): the same cap every week. Unused
/// allowance does not roll over. Even a compromised operator key can only take one week's cap.
/// No owner, no parameter changes.
contract EmissionVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable operator;
    uint256 public immutable start;
    uint256 public immutable weeklyCap;
    uint256 public immutable halvingWeeks;
    mapping(uint256 week => uint256 amount) public released;

    error NotOperator();
    error OverWeeklyCap(uint256 week, uint256 cap, uint256 requested);

    event Released(uint256 indexed week, address indexed to, uint256 amount);

    constructor(IERC20 token_, address operator_, uint256 start_, uint256 weeklyCap_, uint256 halvingWeeks_) {
        token = token_; operator = operator_; start = start_; weeklyCap = weeklyCap_; halvingWeeks = halvingWeeks_;
    }

    function currentWeek() public view returns (uint256) {
        return block.timestamp < start ? 0 : (block.timestamp - start) / 1 weeks;
    }

    /// @notice The cap for a week: halves each season in halving mode (0 after 255 halvings).
    function capOf(uint256 week) public view returns (uint256) {
        if (halvingWeeks == 0) return weeklyCap;
        uint256 halvings = week / halvingWeeks;
        return halvings >= 255 ? 0 : weeklyCap >> halvings;
    }

    function release(address to, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        uint256 week = currentWeek();
        uint256 cap = capOf(week);
        uint256 total = released[week] + amount;
        if (total > cap) revert OverWeeklyCap(week, cap, total);
        released[week] = total;
        token.safeTransfer(to, amount);
        emit Released(week, to, amount);
    }
}
