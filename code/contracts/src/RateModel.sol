// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IAssetRegistry} from "./interfaces/IAssetRegistry.sol";
import {IRateModel} from "./interfaces/IRateModel.sol";

/// @title RateModel
/// @notice Per-asset interest-rate state and kinked rate curve.
///         Tracks supplyIndex + borrowIndex per asset and accrues them on
///         a linear-per-call basis (Aave v2/Compound pattern). The
///         per-asset reserveFactor lives in AssetRegistry (S14 §4); the
///         rate-curve shape lives here.
/// @dev Spec: S01 §3 (RateModel storage), S14 §3 (rate curve), S14 §5
///            (accrual math), S14 §11 (invariants).
///      Storage scaling: indices and rates are ray-scaled (RAY = 1e27).
///      Token amounts (totalSupply / totalBorrow) stay in native units —
///      Aave-style scaledBalance bookkeeping is the consumer pool's job
///      (Day-3 ShieldedSupplyPool / ShieldedPositionPool).
contract RateModel is IRateModel, AccessControl, Pausable {
    using SafeCast for uint256;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant POOL_ROLE = keccak256("POOL_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public constant RAY = 1e27;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    IAssetRegistry public immutable assetRegistry;

    mapping(uint8 => AssetRateState) private _state;
    mapping(uint8 => RateParams) private _params;

    error InvalidUOptimal(uint128 uOptimalRay);
    error AlreadyInitialized(uint8 assetId);
    error NotInitialized(uint8 assetId);
    error AssetNotConfigured(uint8 assetId);
    error ZeroAddress();

    constructor(address admin, address assetRegistry_) {
        if (admin == address(0)) revert ZeroAddress();
        if (assetRegistry_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        assetRegistry = IAssetRegistry(assetRegistry_);
    }

    /// @notice Initialise an asset with starting indices = RAY (1.0).
    /// @dev Called once per asset; must be paired with a corresponding
    ///      AssetRegistry.enableAsset (we read decimals/reserveFactor from
    ///      there on accrue). Subsequent param tuning goes through
    ///      setRateParams.
    function initializeAsset(uint8 assetId, RateParams calldata p)
        external
        onlyRole(MANAGER_ROLE)
    {
        if (_state[assetId].lastAccrualTimestamp != 0) revert AlreadyInitialized(assetId);
        if (assetRegistry.assets(assetId).token == address(0)) revert AssetNotConfigured(assetId);
        _validateParams(p);

        _state[assetId] = AssetRateState({
            totalSupply: 0,
            totalBorrow: 0,
            // RAY (1e27) fits in uint128 (max ≈ 3.4e38); cast checked anyway.
            supplyIndex: RAY.toUint128(),
            borrowIndex: RAY.toUint128(),
            lastAccrualTimestamp: uint64(block.timestamp),
            paused: false,
            deficit: 0
        });
        _params[assetId] = p;

        emit AssetInitialized(assetId);
        emit RateParamsSet(assetId, p.uOptimalRay, p.slope1Ray, p.slope2Ray);
    }

    /// @notice Update rate parameters for an initialised asset. Accrues
    ///         first so the change applies prospectively only — preserves
    ///         I-SOLV-2 monotonicity by never re-pricing historical accrual.
    function setRateParams(uint8 assetId, RateParams calldata p) external onlyRole(MANAGER_ROLE) {
        if (_state[assetId].lastAccrualTimestamp == 0) revert NotInitialized(assetId);
        _validateParams(p);
        _accrue(assetId);
        _params[assetId] = p;
        emit RateParamsSet(assetId, p.uOptimalRay, p.slope1Ray, p.slope2Ray);
    }

    /// @notice Per-asset accrual. Public — anyone may call (S14 §5.1).
    /// @dev Idempotent within a single block (returns immediately when
    ///      block.timestamp == lastAccrualTimestamp; see S14 §11 inv. 4).
    function accrue(uint8 assetId) external whenNotPaused {
        _accrue(assetId);
    }

    /// @notice Pool-only hook to update aggregate balances after a state-changing op.
    /// @dev Per S01 §3 the contracts maintain per-asset totals via the pool layer;
    ///      RateModel just stores them so rate views can read them in one place.
    function setTotals(uint8 assetId, uint128 totalSupply, uint128 totalBorrow)
        external
        onlyRole(POOL_ROLE)
    {
        if (_state[assetId].lastAccrualTimestamp == 0) revert NotInitialized(assetId);
        _state[assetId].totalSupply = totalSupply;
        _state[assetId].totalBorrow = totalBorrow;
    }

    function setAssetPaused(uint8 assetId, bool paused_) external onlyRole(GUARDIAN_ROLE) {
        if (_state[assetId].lastAccrualTimestamp == 0) revert NotInitialized(assetId);
        _state[assetId].paused = paused_;
        emit AssetPausedStateSet(assetId, paused_);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function state(uint8 assetId) external view returns (AssetRateState memory) {
        return _state[assetId];
    }

    function params(uint8 assetId) external view returns (RateParams memory) {
        return _params[assetId];
    }

    /// @notice Current utilization as a ray-scaled fraction.
    /// @dev U = totalBorrow / totalSupply (per S14 §3). 0 when totalSupply
    ///      is 0, mirroring the empty-pool semantics (no borrowers ⇒ 0 rate).
    function utilizationRay(uint8 assetId) public view returns (uint256) {
        AssetRateState memory s = _state[assetId];
        if (s.totalSupply == 0) return 0;
        return (uint256(s.totalBorrow) * RAY) / uint256(s.totalSupply);
    }

    /// @notice Per-second borrow rate, ray-scaled.
    /// @dev Implements the kinked curve from S14 §3:
    ///        U ≤ uOpt:  rate = slope1 × (U / uOpt)
    ///        U >  uOpt: rate = slope1 + slope2 × ((U - uOpt) / (1 - uOpt))
    ///      slope1/slope2 are interpreted as APR ray-scaled (annualised); the
    ///      returned per-second rate is APR / SECONDS_PER_YEAR.
    function currentBorrowRateRay(uint8 assetId) public view returns (uint256) {
        RateParams memory p = _params[assetId];
        if (p.uOptimalRay == 0) return 0;

        uint256 u = utilizationRay(assetId);
        uint256 aprRay;
        if (u <= uint256(p.uOptimalRay)) {
            aprRay = (uint256(p.slope1Ray) * u) / uint256(p.uOptimalRay);
        } else {
            uint256 excess = u - uint256(p.uOptimalRay);
            uint256 denom = RAY - uint256(p.uOptimalRay);
            aprRay = uint256(p.slope1Ray) + (uint256(p.slope2Ray) * excess) / denom;
        }
        return aprRay / SECONDS_PER_YEAR;
    }

    /// @notice Per-second supply rate, ray-scaled.
    /// @dev Per S14 §3: supplyRate = borrowRate × U × (1 - reserveFactor).
    ///      reserveFactor read from AssetRegistry (S14 §4).
    function currentSupplyRateRay(uint8 assetId) public view returns (uint256) {
        uint256 brate = currentBorrowRateRay(assetId);
        if (brate == 0) return 0;

        uint256 u = utilizationRay(assetId);
        uint16 rfBps = assetRegistry.assets(assetId).reserveFactorBps;
        // supplyRate = brate × U/RAY × (1 - rf/BPS)
        // ordering: multiply first, divide last to limit precision loss
        return (brate * u * (BPS_DENOMINATOR - rfBps)) / (RAY * BPS_DENOMINATOR);
    }

    function _accrue(uint8 assetId) internal {
        AssetRateState storage s = _state[assetId];
        if (s.lastAccrualTimestamp == 0) revert NotInitialized(assetId);

        uint64 nowTs = uint64(block.timestamp);
        if (nowTs == s.lastAccrualTimestamp) return; // S14 §11 inv. 4: idempotent in-block

        uint256 deltaT = uint256(nowTs - s.lastAccrualTimestamp);
        uint256 brate = currentBorrowRateRay(assetId);
        uint256 srate = currentSupplyRateRay(assetId);

        // index_new = index_old × (1 + rate × deltaT) per S14 §5
        // SafeCast.toUint128 reverts on overflow — preserves I-SOLV-2 by
        // refusing to silently wrap an index past uint128.
        s.borrowIndex = ((uint256(s.borrowIndex) * (RAY + brate * deltaT)) / RAY).toUint128();
        s.supplyIndex = ((uint256(s.supplyIndex) * (RAY + srate * deltaT)) / RAY).toUint128();
        s.lastAccrualTimestamp = nowTs;

        emit IndexAccrued(assetId, s.borrowIndex, s.supplyIndex, nowTs);
    }

    function _validateParams(RateParams calldata p) private pure {
        // uOptimal must be strictly inside (0, RAY) — degenerate values
        // collapse the curve and break I-SOLV math.
        if (p.uOptimalRay == 0 || p.uOptimalRay >= RAY) revert InvalidUOptimal(p.uOptimalRay);
    }
}
