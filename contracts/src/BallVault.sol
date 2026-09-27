// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The subset of the FriendSDK ChanceGame (node_modules/@rarefriends/friendsdk/contracts/src/
/// ChanceGame.sol) the vault reads. Every function here is a public function or public getter of
/// that source; nothing is assumed beyond it.
interface IVaultChanceGame {
    function rf() external view returns (address);
    function generations() external view returns (address);
    function outcomeCount() external view returns (uint256);
    function outcomes(uint256 outcomeId)
        external
        view
        returns (uint16 chanceBps, uint256 reward, string memory metadataURI);
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// @dev The ChanceGame's IChanceGenerations subset (same source).
interface IVaultGenerations {
    function ownerOf(uint256 friendId) external view returns (address);
    function generation(uint256 friendId) external view returns (uint8);
    function tokenBoundAccount(uint256 friendId) external view returns (address);
}

/// @title BallVault
/// @notice DESIGN ONLY: NOT DEPLOYED, NOT AUDITED, NOT REVIEWED BY RARE FRIENDS. See
/// docs/BALL-MARKET.md.
///
/// Penalty Kings balls are ERC-1155 outcomes of the FriendSDK ChanceGame. That inventory is
/// friend-bound (`_update` reverts on transfers), so a ball can never leave its Friend's
/// token-bound account (TBA). A ball can only be redeemed: `redeem` burns it and pays its fixed RF
/// reward (the floor) to the TBA. This vault turns a redeemed ball into a transferable "Vault
/// Ball": an ERC-1155 claim that keeps the ball's edition (stadium game, season, tier) and rarity
/// and is backed 1:1 by the RF floor, held here. Anyone holding a Vault Ball can unwrap it for
/// the full floor at any time, with no fee. Holders can also list Vault Balls in a small escrow
/// market at any non-zero price they choose (free-price market: no listing floor).
///
/// Wrapping is three steps by the Friend's controller (owner or TBA, as in ChanceGame):
///   1. `commitWrap` snapshots the TBA's ChanceGame balance of that outcome;
///   2. ChanceGame `redeem(friendId, outcomeId, quantity)` burns the balls and pays RF to the TBA;
///   3. `wrap` checks that the balance fell by at least `quantity` since the snapshot (ChanceGame
///      balances can only fall through `redeem`, because transfers revert), pulls
///      `quantity × floor` RF from the caller and mints the Vault Balls.
/// A TBA that can batch calls does all three (plus the RF approval) in one transaction.
///
/// ENFORCED ON-CHAIN (by this contract and tests):
///  • Solvency: RF held ≥ `backing` = Σ floor × supply over all Vault Balls, at all times.
///  • Unwrap always pays the full floor; no fee or party can reduce it.
///  • Provenance: every Vault Ball minted matches a ball of the same outcome that was burned by
///    ChanceGame `redeem` from that Friend's TBA after the commit.
///  • The floor is read from the ChanceGame's own immutable outcome table; a wrap of an outcome
///    with no reward (Scuffed Ball) reverts.
///  • Market: free price. Listings are escrowed here at any non-zero unit price the seller sets
///    (above or below the floor; unwrapping still pays the floor, so selling below it is the
///    seller's choice); the buyer's `maxUnitPrice` bounds what they pay; fee capped at MAX_FEE_BPS
///    and fixed at deployment; only the seller can cancel; buyer RF goes straight to seller and fee
///    recipient and never touches the backing.
/// ASSUMPTIONS (NOT enforced on-chain):
///  • The curator registers only genuine Penalty Kings ChanceGame deployments, with truthful
///    season and tier labels. The vault checks the game's RF token and that each game is
///    registered once, not who deployed it.
///  • Season metadata is meaningful only if each season is a separate ChanceGame deployment:
///    one deployment cannot tell its balls apart by season.
///  • "Discontinued" is a curator label (one-way). It does not change the floor, and it promises
///    no premium. Any price above the floor is whatever a buyer chooses to pay.
///  • Unwrapping pays RF; it cannot recreate the original friend-bound ball (only ChanceGame
///    `settle` mints balls).
/// The curator has no power over funds, fees, floors, listings or unwraps, and cannot pause.
contract BallVault is ERC1155, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_FEE_BPS = 500;
    uint256 private constant OUTCOME_BITS = 128;

    struct Edition {
        IVaultChanceGame game;
        string season; // e.g. "S1"
        string tier; // "park" | "pro" | "champions"
        bool discontinued;
        /// Max Vault Balls EVER minted per ball id of this edition (0 = uncapped). Set once, never raised.
        uint256 cap;
    }

    /// Vault Balls ever minted per ball id (never decreases, unlike totalSupply) and per edition.
    mapping(uint256 id => uint256) public everMinted;
    mapping(uint256 editionId => uint256) public editionMinted;

    struct PendingWrap {
        address committer;
        uint256 balanceBefore;
        uint256 quantity;
    }

    struct Listing {
        address seller;
        uint256 id;
        uint256 quantity; // units still for sale
        uint256 unitPrice; // RF base units per Vault Ball, any non-zero price (free market, no floor)
    }

    IERC20 public immutable rf;
    address public immutable curator;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;

    /// RF base units owed to Vault Ball holders: Σ floorOf(id) × totalSupply(id).
    uint256 public backing;
    uint256 public editionCount;
    uint256 public listingCount;
    mapping(uint256 editionId => Edition) private _editions;
    mapping(address game => uint256 editionId) public editionOfGame;
    mapping(uint256 id => uint256) public totalSupply;
    mapping(uint256 editionId => mapping(uint256 friendId => mapping(uint256 outcomeId => PendingWrap)))
        public pendingWrap;
    mapping(uint256 listingId => Listing) public listings;

    error InvalidConfiguration();
    error OnlyCurator();
    error InvalidEdition();
    error EditionExists();
    error InvalidOutcome();
    error InvalidQuantity();
    error InvalidFriend();
    error NotFriendController();
    error NoCommit();
    error NotRedeemed();
    error NotSeller();
    error InvalidListing();
    error EditionClosed();
    error EditionCapReached();

    event EditionAdded(uint256 indexed editionId, address indexed game, string season, string tier);
    event EditionDiscontinued(uint256 indexed editionId);
    event EditionCapped(uint256 indexed editionId, uint256 maxPerBall);
    event WrapCommitted(
        uint256 indexed editionId, uint256 indexed friendId, uint256 outcomeId, uint256 quantity
    );
    event Wrapped(
        uint256 indexed id, uint256 indexed friendId, address indexed to, uint256 quantity, uint256 rf
    );
    event Unwrapped(uint256 indexed id, address indexed holder, uint256 quantity, uint256 rf);
    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed id, uint256 quantity, uint256 unitPrice);
    event Bought(uint256 indexed listingId, address indexed buyer, uint256 quantity, uint256 paid, uint256 fee);
    event Cancelled(uint256 indexed listingId, uint256 quantityReturned);

    constructor(IERC20 rf_, address curator_, address feeRecipient_, uint256 feeBps_, string memory uri_)
        ERC1155(uri_)
    {
        if (
            address(rf_).code.length == 0 || curator_ == address(0) || feeRecipient_ == address(0)
                || feeBps_ > MAX_FEE_BPS
        ) revert InvalidConfiguration();
        rf = rf_;
        curator = curator_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    // ── Editions (curator: append-only labels, no power over funds) ────────────────────────────

    function addEdition(IVaultChanceGame game, string calldata season, string calldata tier)
        external
        returns (uint256 editionId)
    {
        if (msg.sender != curator) revert OnlyCurator();
        if (address(game).code.length == 0 || game.rf() != address(rf) || game.outcomeCount() == 0) {
            revert InvalidConfiguration();
        }
        if (editionOfGame[address(game)] != 0) revert EditionExists();
        editionId = ++editionCount;
        _editions[editionId] = Edition(game, season, tier, false, 0);
        editionOfGame[address(game)] = editionId;
        emit EditionAdded(editionId, address(game), season, tier);
    }

    /// One-way. Discontinuing CLOSES WRAPPING for this edition forever: no new Vault Balls of it can
    /// ever be minted (on-chain scarcity for the tradeable supply). Floors and unwraps are unaffected.
    function discontinue(uint256 editionId) external {
        if (msg.sender != curator) revert OnlyCurator();
        _edition(editionId).discontinued = true;
        emit EditionDiscontinued(editionId);
    }

    /// One-time edition cap: the most Vault Balls that can EVER be minted per ball id (rarity) of
    /// this edition. Can be set once, only before any ball of the edition exists, and never raised.
    function capEdition(uint256 editionId, uint256 maxPerBall) external {
        if (msg.sender != curator) revert OnlyCurator();
        Edition storage e = _edition(editionId);
        if (e.cap != 0 || maxPerBall == 0 || editionMinted[editionId] != 0) revert InvalidConfiguration();
        e.cap = maxPerBall;
        emit EditionCapped(editionId, maxPerBall);
    }

    // ── Wrap / unwrap ──────────────────────────────────────────────────────────────────────────

    /// @notice Step 1: snapshot the TBA's balance of `outcomeId` before redeeming `quantity`.
    /// A new commit replaces an unfinished one.
    function commitWrap(uint256 editionId, uint256 friendId, uint256 outcomeId, uint256 quantity)
        external
        nonReentrant
    {
        if (quantity == 0) revert InvalidQuantity();
        Edition storage e = _edition(editionId);
        if (e.discontinued) revert EditionClosed();
        IVaultChanceGame game = e.game;
        _floor(game, outcomeId);
        address account = _controller(game, friendId);
        uint256 held = game.balanceOf(account, outcomeId);
        if (held < quantity) revert InvalidQuantity();
        pendingWrap[editionId][friendId][outcomeId] = PendingWrap(msg.sender, held, quantity);
        emit WrapCommitted(editionId, friendId, outcomeId, quantity);
    }

    /// @notice Step 3 (after ChanceGame `redeem`): pull the RF floor from the caller and mint
    /// Vault Balls to `to`.
    function wrap(uint256 editionId, uint256 friendId, uint256 outcomeId, address to)
        external
        nonReentrant
        returns (uint256 id)
    {
        PendingWrap memory pending = pendingWrap[editionId][friendId][outcomeId];
        if (pending.quantity == 0 || pending.committer != msg.sender) revert NoCommit();
        Edition storage e = _edition(editionId);
        // A commit made before `discontinue` cannot finish (the redeemed RF simply stays in the TBA).
        if (e.discontinued) revert EditionClosed();
        IVaultChanceGame game = e.game;
        address account = _controller(game, friendId);
        // Transfers of ChanceGame balls revert, so the only way this balance falls is `redeem`.
        // New settlements can only raise it, which makes this check fail safe (commit again).
        if (game.balanceOf(account, outcomeId) + pending.quantity > pending.balanceBefore) {
            revert NotRedeemed();
        }
        delete pendingWrap[editionId][friendId][outcomeId];
        uint256 amount = _floor(game, outcomeId) * pending.quantity;
        id = ballId(editionId, outcomeId);
        if (e.cap != 0 && everMinted[id] + pending.quantity > e.cap) revert EditionCapReached();
        everMinted[id] += pending.quantity;
        editionMinted[editionId] += pending.quantity;
        backing += amount;
        totalSupply[id] += pending.quantity;
        rf.safeTransferFrom(msg.sender, address(this), amount);
        emit Wrapped(id, friendId, to, pending.quantity, amount);
        _mint(to, id, pending.quantity, "");
    }

    /// @notice Burn Vault Balls and receive their full RF floor. No fee; nobody can block it.
    function unwrap(uint256 id, uint256 quantity) external nonReentrant {
        if (quantity == 0) revert InvalidQuantity();
        uint256 amount = floorOf(id) * quantity;
        _burn(msg.sender, id, quantity);
        totalSupply[id] -= quantity;
        backing -= amount;
        rf.safeTransfer(msg.sender, amount);
        emit Unwrapped(id, msg.sender, quantity, amount);
    }

    // ── Market (escrow listings, RF-priced) ────────────────────────────────────────────────────

    function list(uint256 id, uint256 quantity, uint256 unitPrice)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        if (quantity == 0) revert InvalidQuantity();
        // Free market: any price. (Unwrapping always pays the RF floor, so selling below it is the seller's choice.)
        if (unitPrice == 0) revert InvalidListing();
        listingId = ++listingCount;
        listings[listingId] = Listing(msg.sender, id, quantity, unitPrice);
        // Escrow without the receiver hook: this contract deliberately rejects direct transfers.
        _update(msg.sender, address(this), _single(id), _single(quantity));
        emit Listed(listingId, msg.sender, id, quantity, unitPrice);
    }

    /// @notice Buy `quantity` units, paying at most `maxUnitPrice` RF each (slippage guard for UIs).
    function buy(uint256 listingId, uint256 quantity, uint256 maxUnitPrice) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (listing.seller == address(0)) revert InvalidListing();
        if (quantity == 0 || quantity > listing.quantity) revert InvalidQuantity();
        if (listing.unitPrice > maxUnitPrice) revert InvalidListing();
        listing.quantity -= quantity;
        uint256 paid = listing.unitPrice * quantity;
        uint256 fee = (paid * feeBps) / 10_000;
        address seller = listing.seller;
        uint256 id = listing.id;
        if (fee != 0) rf.safeTransferFrom(msg.sender, feeRecipient, fee);
        rf.safeTransferFrom(msg.sender, seller, paid - fee);
        emit Bought(listingId, msg.sender, quantity, paid, fee);
        _safeTransferFrom(address(this), msg.sender, id, quantity, "");
    }

    function cancel(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (listing.seller == address(0)) revert InvalidListing();
        if (listing.seller != msg.sender) revert NotSeller();
        uint256 quantity = listing.quantity;
        uint256 id = listing.id;
        delete listings[listingId];
        emit Cancelled(listingId, quantity);
        if (quantity != 0) _safeTransferFrom(address(this), msg.sender, id, quantity, "");
    }

    // ── Views ──────────────────────────────────────────────────────────────────────────────────

    function ballId(uint256 editionId, uint256 outcomeId) public pure returns (uint256) {
        return (editionId << OUTCOME_BITS) | outcomeId;
    }

    function decodeId(uint256 id) public pure returns (uint256 editionId, uint256 outcomeId) {
        return (id >> OUTCOME_BITS, id & type(uint128).max);
    }

    /// The RF floor of one Vault Ball: the ChanceGame reward of its outcome (immutable there).
    function floorOf(uint256 id) public view returns (uint256) {
        (uint256 editionId, uint256 outcomeId) = decodeId(id);
        return _floor(_edition(editionId).game, outcomeId);
    }

    function edition(uint256 editionId)
        external
        view
        returns (address game, string memory season, string memory tier, bool discontinued)
    {
        Edition storage e = _edition(editionId);
        return (address(e.game), e.season, e.tier, e.discontinued);
    }

    /// Solvency margin: RF held minus RF owed (never negative; excess is only stray transfers).
    function surplus() external view returns (uint256) {
        return rf.balanceOf(address(this)) - backing;
    }

    // ── Internals ──────────────────────────────────────────────────────────────────────────────

    function _edition(uint256 editionId) private view returns (Edition storage e) {
        e = _editions[editionId];
        if (address(e.game) == address(0)) revert InvalidEdition();
    }

    function _floor(IVaultChanceGame game, uint256 outcomeId) private view returns (uint256 reward) {
        if (outcomeId == 0 || outcomeId > game.outcomeCount()) revert InvalidOutcome();
        (, reward,) = game.outcomes(outcomeId);
        if (reward == 0) revert InvalidOutcome();
    }

    /// Mirrors ChanceGame._controller: the Friend's owner or its token-bound account.
    function _controller(IVaultChanceGame game, uint256 friendId) private view returns (address account) {
        IVaultGenerations generations = IVaultGenerations(game.generations());
        address owner = generations.ownerOf(friendId);
        if (generations.generation(friendId) == 0) revert InvalidFriend();
        account = generations.tokenBoundAccount(friendId);
        if (msg.sender != owner && msg.sender != account) revert NotFriendController();
    }

    function _single(uint256 value) private pure returns (uint256[] memory array) {
        array = new uint256[](1);
        array[0] = value;
    }
}
