// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IAssetRegistry
/// @notice Per-asset config registry for the privacy-lending protocol.
/// @dev Source of truth for which assets are enabled and on what terms.
///      Fields defined per design-v2/subsystems/01_shielded_pools.md §3
///      and design-v2/subsystems/14_interest_and_apys.md §4.
interface IAssetRegistry {
    /// @notice Per-asset configuration.
    /// @dev `reserveFactorBps` is defined in S14 §4 as living in the
    ///      AssetRegistry; the S01 §3 AssetConfig sketch omits it.
    ///      Added here per the two-doc resolution. [inference]
    struct AssetConfig {
        address token;
        address oracleFeed;
        uint8 decimals;
        uint16 ltvBps;
        uint16 liquidationThresholdBps;
        uint16 liquidationBonusBps;
        uint16 protocolFeeOfBonusBps;
        uint16 reserveFactorBps;
        uint16 closeFactorHfThresholdBps;
        uint128 minBorrowSize;
        uint128 dustDebtThreshold;
        bool suppliable;
        bool borrowable;
        bool collateralizable;
        bool enabled;
    }

    event AssetEnabled(uint8 indexed assetId, address indexed token);
    event AssetConfigUpdated(uint8 indexed assetId);
    event AssetDisabled(uint8 indexed assetId);

    function assets(uint8 assetId) external view returns (AssetConfig memory);

    function numAssets() external view returns (uint8);

    function isEnabled(uint8 assetId) external view returns (bool);
}
