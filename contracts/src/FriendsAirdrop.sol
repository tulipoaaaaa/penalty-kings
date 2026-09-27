// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IBootroomLace {
    function lace(uint256 friendId, uint256 amount, uint256 lockWeeks) external;
}

/// @title FriendsAirdrop (v1.1): 10% of $GBOOT to hardwired Friends, delivered PRE-LACED.
/// @notice The deployer sets one Merkle root, once (leaf = keccak256(abi.encode(friendId, amount))).
/// A claim is permissionless because it never pays a wallet: the tokens are laced in the Bootroom
/// for that friendId for LOCK_WEEKS, so the Friend starts with a boost, and its owner (or
/// token-bound account) can unlace after expiry, or early with the Bootroom's 50% burn. After the
/// claim window anyone can sweep what is left to the Cups & events vault. Eligibility rules are
/// published with the root (docs/ECONOMY.md) and apply identically to every Friend.
contract FriendsAirdrop {
    using SafeERC20 for IERC20;

    uint256 public constant LOCK_WEEKS = 12;
    uint256 public constant CLAIM_WINDOW = 180 days;

    IERC20 public immutable gboot;
    IBootroomLace public immutable bootroom;
    address public immutable setter;
    address public immutable sweepTo;
    bytes32 public root;
    uint256 public deadline;
    mapping(uint256 friendId => bool) public claimed;

    error RootAlreadySet();
    error NotSetter();
    error NoRoot();
    error AlreadyClaimed();
    error BadProof();
    error ClaimWindowOpen();
    error ClaimWindowClosed();

    event RootSet(bytes32 root, uint256 deadline);
    event Claimed(uint256 indexed friendId, uint256 amount);
    event Swept(uint256 amount);

    constructor(IERC20 gboot_, IBootroomLace bootroom_, address sweepTo_) {
        gboot = gboot_; bootroom = bootroom_; setter = msg.sender; sweepTo = sweepTo_;
    }

    function setRoot(bytes32 root_) external {
        if (msg.sender != setter) revert NotSetter();
        if (root != bytes32(0)) revert RootAlreadySet();
        root = root_; deadline = block.timestamp + CLAIM_WINDOW;
        gboot.forceApprove(address(bootroom), type(uint256).max);
        emit RootSet(root_, deadline);
    }

    function claim(uint256 friendId, uint256 amount, bytes32[] calldata proof) external {
        if (root == bytes32(0)) revert NoRoot();
        if (block.timestamp > deadline) revert ClaimWindowClosed();
        if (claimed[friendId]) revert AlreadyClaimed();
        bytes32 node = keccak256(bytes.concat(keccak256(abi.encode(friendId, amount))));
        for (uint256 i; i < proof.length; ++i) node = node < proof[i] ? keccak256(abi.encode(node, proof[i])) : keccak256(abi.encode(proof[i], node));
        if (node != root) revert BadProof();
        claimed[friendId] = true;
        bootroom.lace(friendId, amount, LOCK_WEEKS);
        emit Claimed(friendId, amount);
    }

    function sweep() external {
        if (root == bytes32(0) || block.timestamp <= deadline) revert ClaimWindowOpen();
        uint256 amount = gboot.balanceOf(address(this));
        gboot.safeTransfer(sweepTo, amount);
        emit Swept(amount);
    }
}
