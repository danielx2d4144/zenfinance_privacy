// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/// @title IOracle
/// @notice Per-asset USD price feed.
/// @dev Spec: design-v2/subsystems/05_oracle_and_keepers.md §2
///      Prices are reported scaled to 1e8 (Chainlink/Stork convention).
///      Reverts with PriceStale if the latest update is older than the
///      configured per-asset staleness window. Day-1 implementation backs
///      this with manually-pushed prices; the full Stork pull integration
///      lands on Day 9.
interface IOracle {
    struct PriceData {
        uint128 priceUsd1e8;
        uint64 updatedAt;
    }

    event PriceUpdated(uint8 indexed assetId, uint128 priceUsd1e8, uint64 updatedAt);
    event StalenessWindowSet(uint8 indexed assetId, uint32 windowSeconds);
    event FeedConfigured(uint8 indexed assetId, address feed);

    function getPrice(uint8 assetId) external view returns (uint128 priceUsd1e8);

    function priceData(uint8 assetId) external view returns (PriceData memory);

    function stalenessWindow(uint8 assetId) external view returns (uint32);
}
