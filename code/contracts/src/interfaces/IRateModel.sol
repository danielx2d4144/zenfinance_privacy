// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IRateModel
/// @notice Per-asset rate state + kinked rate curve.
/// @dev Spec: design-v2/subsystems/01_shielded_pools.md §3 (RateModel)
///            design-v2/subsystems/14_interest_and_apys.md §3, §5
///      Indices are ray-scaled (precision = 1e27); rates are per-second
///      ray-scaled. Linear-per-accrual is intentional (Aave/Compound v2
///      pattern; see S14 §5.2 for error analysis).
interface IRateModel {
    struct AssetRateState {
        uint128 totalSupply;
        uint128 totalBorrow;
        uint128 supplyIndex;
        uint128 borrowIndex;
        uint64 lastAccrualTimestamp;
        bool paused;
        uint128 deficit;
    }

    struct RateParams {
        uint128 uOptimalRay;
        uint128 slope1Ray;
        uint128 slope2Ray;
    }

    event RateParamsSet(uint8 indexed assetId, uint128 uOptimal, uint128 slope1, uint128 slope2);
    event IndexAccrued(
        uint8 indexed assetId,
        uint128 borrowIndex,
        uint128 supplyIndex,
        uint64 timestamp
    );
    event AssetInitialized(uint8 indexed assetId);
    event AssetPausedStateSet(uint8 indexed assetId, bool paused);

    function utilizationRay(uint8 assetId) external view returns (uint256);

    function currentBorrowRateRay(uint8 assetId) external view returns (uint256);

    function currentSupplyRateRay(uint8 assetId) external view returns (uint256);

    function accrue(uint8 assetId) external;

    function state(uint8 assetId) external view returns (AssetRateState memory);

    function setTotals(uint8 assetId, uint128 totalSupply, uint128 totalBorrow) external;
}
