// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

// NOT DEPLOYED — requires audit and Rare Friends review.
// OFF BY DEFAULT: the launch default (owner decision "option B") is a PLAIN pool with a 1% LP fee and no
// hook, whose fees LiquidityLock splits 50% burned / 50% to the Cup pot. This hook (fee 0 + a 1% hook fee
// burned on both sides + an on-chain TWAP for RF-priced sinks, docs/ECONOMY.md "TWAP") is the upgrade
// path after an audit; it needs a new pool, since the hook is part of the pool key.

import { PoolKey, SwapParams } from "./interfaces/IUniswapV4.sol";

interface IPoolManagerTake {
    function take(address currency, address to, uint256 amount) external;
}

interface IExtsload {
    function extsload(bytes32 slot) external view returns (bytes32);
}

interface IBurnable {
    function burn(uint256 amount) external;
}

/// @title GBootFeeHook
/// @notice Uniswap v4 hook for a 0%-LP-fee $GBOOT/RF pool.
///  1. Fee burn (afterSwap + afterSwapReturnDelta): on every swap it takes FEE_BPS of the swap's
///     unspecified currency and BURNS it, whichever side it is.
///  2. TWAP oracle (afterInitialize + beforeSwap): a time-weighted tick accumulator. Before each swap
///     (the first in each second) it adds `tick × elapsed` using the pool's tick BEFORE the swap, i.e.
///     the tick that prevailed since the previous write, so the accumulator is exact. A ring of
///     CARDINALITY checkpoints spaced ≥ CHECKPOINT_INTERVAL apart keeps ≥ 63 minutes of history, so
///     any period up to MAX_PERIOD (1 hour) can be read. `consult` returns the arithmetic-mean tick
///     over a window that starts at most CHECKPOINT_INTERVAL before `now − period` (never later).
/// Permissions: afterInitialize | beforeSwap | afterSwap | afterSwapReturnDelta (address flags 0x10C4).
/// No owner, no parameters to change.
contract GBootFeeHook {
    uint256 public constant FEE_BPS = 100;
    /// @notice afterInitialize (1 << 12) | beforeSwap (1 << 7) | afterSwap (1 << 6) | afterSwapReturnDelta (1 << 2).
    uint160 public constant FLAGS = (1 << 12) | (1 << 7) | (1 << 6) | (1 << 2);
    uint160 internal constant ALL_HOOK_MASK = (1 << 14) - 1;
    /// @notice Minimum spacing of stored checkpoints (the accumulator itself updates on every write).
    uint32 public constant CHECKPOINT_INTERVAL = 60;
    uint16 public constant CARDINALITY = 64;
    /// @notice Longest readable period: (CARDINALITY − 1) × CHECKPOINT_INTERVAL = 63 min ≥ 60 min.
    uint32 public constant MAX_PERIOD = 1 hours;
    /// @dev Uniswap v4 PoolManager: `mapping(PoolId => Pool.State) internal _pools` sits at slot 6 and
    /// Slot0 is the first word of Pool.State (v4-core StateLibrary.POOLS_SLOT; checked on a fork
    /// against StateView.getSlot0 in ForkHook.t.sol).
    bytes32 internal constant POOLS_SLOT = bytes32(uint256(6));

    struct Observation {
        uint32 timestamp;
        int56 tickCumulative;
        /// @dev The tick in force just before this write (constant since the previous write).
        int24 prevTick;
    }

    struct Oracle {
        Observation latest;
        uint16 index; // ring index of the newest checkpoint
        uint16 count; // checkpoints stored (≤ CARDINALITY)
        bool initialized;
    }

    address public immutable poolManager;
    mapping(bytes32 poolId => Oracle) internal _oracles;
    mapping(bytes32 poolId => Observation[64]) internal _checkpoints;

    error NotPoolManager();
    error HookNotImplemented();
    error WrongHookAddress();
    error OracleNotInitialized();
    error OracleNotReady();
    error BadPeriod();

    event FeeTaken(address indexed currency, uint256 amount, bool burned);

    constructor(address poolManager_) {
        poolManager = poolManager_;
    }

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert NotPoolManager();
        _;
    }

    // ───────────────────────────────────────────── hook callbacks

    /// @notice Seeds the pool's oracle. Reverts if this contract does not sit at an address whose hook
    /// flags are exactly FLAGS: otherwise beforeSwap would not be called and the TWAP would be wrong.
    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick) external onlyPoolManager returns (bytes4) {
        if (uint160(address(this)) & ALL_HOOK_MASK != FLAGS) revert WrongHookAddress();
        bytes32 id = keccak256(abi.encode(key));
        Observation memory first = Observation(uint32(block.timestamp), 0, tick);
        _oracles[id] = Oracle(first, 0, 1, true);
        _checkpoints[id][0] = first;
        return this.afterInitialize.selector;
    }

    /// @notice Records the pre-swap tick into the accumulator. Returns no delta and no fee override.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int256, uint24)
    {
        bytes32 id = keccak256(abi.encode(key));
        _write(id, currentTick(id));
        return (this.beforeSwap.selector, 0, 0);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, int256 delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        bool specifiedIs0 = params.amountSpecified < 0 == params.zeroForOne;
        int128 unspecified = specifiedIs0 ? int128(delta) : int128(delta >> 128);
        address currency = specifiedIs0 ? key.currency1 : key.currency0;
        uint256 amount = uint256(uint128(unspecified < 0 ? -unspecified : unspecified)) * FEE_BPS / 10_000;
        if (amount == 0) return (this.afterSwap.selector, 0);
        IPoolManagerTake(poolManager).take(currency, address(this), amount);
        IBurnable(currency).burn(amount);
        emit FeeTaken(currency, amount, true);
        return (this.afterSwap.selector, int128(int256(amount)));
    }

    // ───────────────────────────────────────────── oracle

    function _write(bytes32 id, int24 tickBefore) internal {
        Oracle storage o = _oracles[id];
        if (!o.initialized) revert OracleNotInitialized();
        Observation memory last = o.latest;
        uint32 now_ = uint32(block.timestamp);
        if (last.timestamp == now_) return; // nothing elapsed: the tick in force since `last` has zero weight
        Observation memory next = Observation(
            now_, last.tickCumulative + int56(tickBefore) * int56(uint56(now_ - last.timestamp)), tickBefore
        );
        o.latest = next;
        if (now_ - _checkpoints[id][o.index].timestamp >= CHECKPOINT_INTERVAL) {
            uint16 index = (o.index + 1) % CARDINALITY;
            _checkpoints[id][index] = next;
            o.index = index;
            if (o.count < CARDINALITY) ++o.count;
        }
    }

    /// @notice The pool's current tick, read from the PoolManager's storage.
    function currentTick(bytes32 poolId) public view returns (int24 tick) {
        bytes32 data = IExtsload(poolManager).extsload(keccak256(abi.encodePacked(poolId, POOLS_SLOT)));
        assembly ("memory-safe") {
            tick := signextend(2, shr(160, data))
        }
    }

    /// @notice Arithmetic-mean tick over [windowStart, now], where windowStart ≤ now − period and
    /// windowStart > now − period − CHECKPOINT_INTERVAL. Rounds towards negative infinity.
    function consult(bytes32 poolId, uint32 period) external view returns (int24 meanTick, uint32 windowStart) {
        if (period == 0 || period > MAX_PERIOD) revert BadPeriod();
        Oracle memory o = _oracles[poolId];
        if (!o.initialized) revert OracleNotInitialized();
        uint32 now_ = uint32(block.timestamp);
        int24 tickNow = currentTick(poolId);
        if (now_ < period) revert OracleNotReady();
        uint32 target = now_ - period;
        // No swap since `target`: the current tick held over the whole window.
        if (o.latest.timestamp <= target) return (tickNow, target);

        int56 cumNow = o.latest.tickCumulative + int56(tickNow) * int56(uint56(now_ - o.latest.timestamp));
        int56 cumStart;
        (cumStart, windowStart) = _cumulativeAt(poolId, o, target);
        int56 delta = cumNow - cumStart;
        int56 elapsed = int56(uint56(now_ - windowStart));
        meanTick = int24(delta / elapsed);
        if (delta < 0 && delta % elapsed != 0) meanTick--;
    }

    /// @dev The tick cumulative at `target` when it can be reconstructed exactly, else at the newest
    /// checkpoint before it (at most CHECKPOINT_INTERVAL earlier). Requires o.latest.timestamp > target.
    function _cumulativeAt(bytes32 poolId, Oracle memory o, uint32 target) internal view returns (int56, uint32) {
        uint16 oldest = o.count < CARDINALITY ? 0 : (o.index + 1) % CARDINALITY;
        Observation[64] storage ring = _checkpoints[poolId];
        if (ring[oldest].timestamp > target) revert OracleNotReady();
        // Binary search for the newest checkpoint at or before `target` (chronological positions 0 … count − 1).
        uint256 lo = 0;
        uint256 hi = o.count - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (ring[(oldest + mid) % CARDINALITY].timestamp <= target) lo = mid;
            else hi = mid - 1;
        }
        Observation memory r = ring[(oldest + lo) % CARDINALITY];
        if (target < r.timestamp + CHECKPOINT_INTERVAL || lo + 1 >= o.count) return (r.tickCumulative, r.timestamp);
        // Every write between r and the next checkpoint happened before r + CHECKPOINT_INTERVAL ≤ target
        // (a later write would itself be a checkpoint), so next.prevTick held over [target, next]: exact.
        // (When r is the newest checkpoint, o.latest < r + CHECKPOINT_INTERVAL ≤ target, which the caller
        // excluded, so `next` is always a stored checkpoint here.)
        Observation memory next = ring[(oldest + lo + 1) % CARDINALITY];
        return (next.tickCumulative - int56(next.prevTick) * int56(uint56(next.timestamp - target)), target);
    }

    /// @notice Oracle state for a pool: the latest write and how many checkpoints are stored.
    function oracleState(bytes32 poolId) external view returns (Observation memory latest, uint16 index, uint16 count) {
        Oracle memory o = _oracles[poolId];
        return (o.latest, o.index, o.count);
    }

    function checkpoint(bytes32 poolId, uint16 index) external view returns (Observation memory) {
        return _checkpoints[poolId][index];
    }
}
